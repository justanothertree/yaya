import {
  allMelds,
  arrange,
  chooseDiscard,
  chooseDraw,
  deadwood,
  deal,
  discard,
  draw,
  gRank,
  type Hand,
  type Result,
} from './gin'
import { suitOf, type Card } from './poker'
import type { Rules, Seat } from '../lab/social/room'

/**
 * Gin rummy as a match by turns (src/lab/matches): hands of the toy's own gin, first to so many
 * points. A move is half a turn — a draw, then a discard (with a knock, when it may) — so a card
 * drawn from the stock is seen by its holder before they throw.
 *
 * ⚠️ THE HANDS AND THE STOCK ARE KEPT BACK (Rules.hidden), as Sea battle's fleets are: in the
 * match's secret, never the state. The server deals each hand with its own random numbers (the
 * first with the friend's yes, the rest through Rules.roll as a hand ends), and each player fetches
 * their own hand from lab-move, which shows nobody the other's. What travels is what a table shows:
 * the discard pile, whose turn and which half, the cards each has taken from the pile, how many are
 * left in the stock — and every finished hand laid down, both arrangements, as gin is scored.
 *
 * A stored match is refused unless its cards account for one deck exactly, and every finished
 * hand's points are what its laid-down cards say. Together, the friends hold one hand and take its
 * half-turns in turn; the computer plays the toy's own gin at three levels (gin.ts).
 */
export type GinGame = {
  target: number
  /** every finished hand, in order */
  done: Result[]
  /** who began the hand in play */
  first: Seat
  /** no hand in play: the last one ended, and the next is not dealt yet (or the match is over) */
  between: boolean
  pile: Card[]
  turn: Seat
  phase: 'draw' | 'discard'
  took: Card | null
  picked: [Card[], Card[]]
  stockLeft: number
  /** each side's hand and the stock: only on the server */
  hands: [Card[] | null, Card[] | null]
  stock: Card[] | null
}
export type GinMove = { draw: 'stock' | 'pile' } | { discard: Card; knock: boolean }

export const TARGETS = [50, 100] as const
/** hands past this many, the match ends where it stands: far more than a hundred points takes */
export const MAX_HANDS = 25

export function readGinSettings(s: Record<string, unknown>): { target: number } | null {
  const target = s.target ?? 50
  return (TARGETS as readonly unknown[]).includes(target) ? { target: target as number } : null
}

/** each side's points over the finished hands */
export const totals = (g: GinGame): [number, number] => {
  const t: [number, number] = [0, 0]
  for (const r of g.done) if (r.winner !== null) t[r.winner] += r.points
  return t
}
const matchOver = (g: GinGame) => Math.max(...totals(g)) >= g.target || g.done.length >= MAX_HANDS

export const whoseMove = (g: GinGame): Seat | null => (g.between ? null : g.turn)

const fresh = (target: number): GinGame => ({
  target,
  done: [],
  first: 1,
  between: true,
  pile: [],
  turn: 0,
  phase: 'draw',
  took: null,
  picked: [[], []],
  stockLeft: 0,
  hands: [null, null],
  stock: null,
})

/** a new hand, dealt from a seed the server's random numbers chose; the sides take turns to begin */
function dealt(g: GinGame, rand: () => number): GinGame {
  const first: Seat = g.first === 0 ? 1 : 0
  const h = deal(Math.floor(rand() * 2 ** 32), first)
  return {
    ...g,
    first,
    between: false,
    pile: h.pile,
    turn: h.turn,
    phase: h.phase,
    took: null,
    picked: [[], []],
    stockLeft: h.stock.length,
    hands: h.hands,
    stock: h.stock,
  }
}

const known = (g: GinGame) => !!g.hands[0] && !!g.hands[1] && !!g.stock
/** the toy's own hand, for its own rules: only where the hands are known */
const toHand = (g: GinGame): Hand => ({
  hands: [g.hands[0]!, g.hands[1]!],
  stock: g.stock!,
  pile: g.pile,
  turn: g.turn,
  phase: g.phase,
  took: g.took,
  picked: g.picked,
  over: null,
})
function fromHand(g: GinGame, h: Hand): GinGame {
  const next: GinGame = {
    ...g,
    pile: h.pile,
    turn: h.turn,
    phase: h.phase,
    took: h.took,
    picked: h.picked,
    stockLeft: h.stock.length,
    hands: h.hands,
    stock: h.stock,
  }
  return h.over ? { ...next, done: [...g.done, h.over], between: true } : next
}

const isCard = (x: unknown): x is Card =>
  Number.isInteger(x) && (x as number) >= 0 && (x as number) < 52

/** the half-turn, or null if it is not one; on the server, with the hands known, every rule */
function moved(g: GinGame, m: GinMove, s: Seat): GinGame | null {
  if (whoseMove(g) !== s) return null
  if ('draw' in m) {
    if (g.phase !== 'draw') return null
    if (m.draw === 'pile' ? !g.pile.length : g.stockLeft === 0) return null
    if (!known(g)) return g
    return fromHand(g, draw(toHand(g), m.draw))
  }
  if (g.phase !== 'discard' || m.discard === g.took || g.pile.includes(m.discard)) return null
  if (!known(g)) return g
  const hand = g.hands[s]!
  if (!hand.includes(m.discard)) return null
  if (m.knock && arrange(hand.filter((c) => c !== m.discard)).points > 10) return null
  return fromHand(g, discard(toHand(g), m.discard, m.knock))
}

/* ---------------------------------------------------------------- the wire ------------------ */

const cardList = (x: unknown, max = 52): x is Card[] =>
  Array.isArray(x) && x.length <= max && x.every(isCard) && new Set(x).size === x.length
const isMeld = (m: Card[]) => allMelds(m).some((x) => x.length === m.length)

/** a finished hand as laid down, or null unless its points are what its cards say */
function readResult(x: unknown): Result | null {
  const o = x as Record<string, unknown> | null
  if (!o || typeof o !== 'object') return null
  const { winner, points, how, knocker, shown } = o
  if (!['gin', 'knock', 'undercut', 'void'].includes(how as string)) return null
  if (!Array.isArray(shown) || shown.length !== 2) return null
  const laid = shown.map((s) => {
    const v = s as { melds?: unknown; dead?: unknown } | null
    if (!v || !Array.isArray(v.melds) || !cardList(v.dead, 11)) return null
    if (!v.melds.every((m) => cardList(m, 10) && m.length >= 3 && isMeld(m))) return null
    return { melds: (v.melds as Card[][]).map((m) => [...m]), dead: [...(v.dead as Card[])] }
  })
  if (!laid[0] || !laid[1]) return null
  const all = laid.flatMap((l) => [...l!.melds.flat(), ...l!.dead])
  if (new Set(all).size !== all.length) return null
  const r = { winner, points, how, knocker, shown: laid } as Result
  if (how === 'void') return winner === null && points === 0 && knocker === null ? r : null
  if (knocker !== 0 && knocker !== 1) return null
  const mine = deadwood(laid[knocker]!.dead)
  const theirs = deadwood(laid[knocker === 0 ? 1 : 0]!.dead)
  const other = knocker === 0 ? 1 : 0
  const want =
    how === 'gin'
      ? mine === 0 && winner === knocker && points === 25 + theirs
      : how === 'undercut'
        ? mine > 0 &&
          mine <= 10 &&
          theirs <= mine &&
          winner === other &&
          points === 25 + mine - theirs
        : mine > 0 && mine <= 10 && theirs > mine && winner === knocker && points === theirs - mine
  return want ? r : null
}

/** the match anybody in it may see, or null if no deal and no play could have made it */
export function replayPublic(target: number, x: unknown): GinGame | null {
  const o = x as Record<string, unknown> | null
  if (!o || typeof o !== 'object' || !Array.isArray(o.done)) return null
  const done = o.done.map(readResult)
  if (done.some((r) => r === null) || done.length > MAX_HANDS) return null
  const { first, between, pile, turn, phase, took, picked, stockLeft } = o
  if ((first !== 0 && first !== 1) || typeof between !== 'boolean') return null
  if ((turn !== 0 && turn !== 1) || (phase !== 'draw' && phase !== 'discard')) return null
  if (!cardList(pile) || (took !== null && !isCard(took))) return null
  if (!Array.isArray(picked) || picked.length !== 2 || !picked.every((p) => cardList(p)))
    return null
  if (!Number.isInteger(stockLeft) || (stockLeft as number) < 0) return null
  const g: GinGame = {
    target,
    done: done as Result[],
    first,
    between,
    pile: [...pile],
    turn,
    phase,
    took: took as Card | null,
    picked: [[...picked[0]], [...picked[1]]],
    stockLeft: stockLeft as number,
    hands: [null, null],
    stock: null,
  }
  if (g.between) {
    // no hand in play only once the match is over, between deals being the server's own moment
    return matchOver(g) && g.done.length > 0 ? g : null
  }
  if (matchOver(g)) return null
  // one deck: two hands of ten, the drawer's eleventh, the pile and the stock
  if (g.stockLeft + g.pile.length + 20 + (g.phase === 'discard' ? 1 : 0) !== 52) return null
  if (g.took !== null && (g.phase !== 'discard' || g.pile.includes(g.took))) return null
  return g
}

/* ---------------------------------------------------------------- the rules ----------------- */

export function ginRules(target: number): Rules<GinGame, GinMove> & {
  roll: (g: GinGame, rand: () => number) => GinGame
} {
  return {
    fresh: () => fresh(target),
    turn: whoseMove,
    legal: (g, m, by) => {
      const s = whoseMove(g)
      return s !== null && (by === undefined || by === s) && moved(g, m, s) !== null
    },
    apply: (g, m) => {
      const s = whoseMove(g)
      return s === null ? g : (moved(g, m, s) ?? g)
    },
    // a hand that ended is followed by the next, dealt by the server, unless the match is won
    roll: (g, rand) => (g.between && !matchOver(g) ? dealt(g, rand) : g),
    encode: (g) => ({
      done: g.done,
      first: g.first,
      between: g.between,
      pile: g.pile,
      turn: g.turn,
      phase: g.phase,
      took: g.took,
      picked: g.picked,
      stockLeft: g.stockLeft,
    }),
    decode: (x) => replayPublic(target, x),
    readMove: (x) => {
      const o = x as Record<string, unknown> | null
      if (!o || typeof o !== 'object') return null
      const keys = Object.keys(o).sort().join()
      if (keys === 'draw' && (o.draw === 'stock' || o.draw === 'pile')) return { draw: o.draw }
      if (keys === 'discard,knock' && isCard(o.discard) && typeof o.knock === 'boolean')
        return { discard: o.discard, knock: o.knock }
      return null
    },
    modes: ['versus', 'together'],
    computer: {
      side: 1,
      levels: ['easy', 'fair', 'hard'],
      choose: (g, level) => {
        const h = toHand(g)
        const l = level as 'easy' | 'fair' | 'hard'
        if (g.phase === 'draw') return { draw: chooseDraw(h, l) }
        const c = chooseDiscard(h, l, Math.random)
        return { discard: c.card, knock: c.knock }
      },
    },
    result: (g) => {
      if (whoseMove(g) !== null) return null
      const [a, b] = totals(g)
      return a > b ? 0 : b > a ? 1 : 'draw'
    },
    begun: (g) => g.done.length > 0 || g.pile.length > 1 || g.phase === 'discard',
    hidden: {
      secret: (g) => ({ hands: g.hands, stock: g.stock }),
      join: (g, secret) => {
        const o = secret as { hands?: unknown; stock?: unknown } | null
        if (!o || !Array.isArray(o.hands) || o.hands.length !== 2) return null
        if (g.between) return { ...g }
        const [a, b] = o.hands
        if (!cardList(a, 11) || !cardList(b, 11) || !cardList(o.stock)) return null
        // the hands are ten each and the drawer's eleven; with the pile and the stock, one deck
        for (const s of [0, 1] as Seat[])
          if ([a, b][s].length !== (g.phase === 'discard' && g.turn === s ? 11 : 10)) return null
        if (o.stock.length !== g.stockLeft) return null
        const all = [...a, ...b, ...o.stock, ...g.pile]
        if (all.length !== 52 || new Set(all).size !== 52) return null
        if (g.took !== null && ![a, b][g.turn].includes(g.took)) return null
        return { ...g, hands: [[...a], [...b]], stock: [...o.stock] }
      },
      mine: (g, side) => g.hands[side],
      // nothing in a move is hidden: a stock draw names no card, and a discard is face up
      logged: (m) => m,
      accept: (g) => dealt(g, Math.random),
    },
  }
}

/** a card's place in a hand sorted for the eye: by suit, then rank */
export const handOrder = (a: Card, b: Card) => suitOf(a) - suitOf(b) || gRank(a) - gRank(b)
