import {
  choose,
  cost,
  deal,
  drawCard,
  isEight,
  legal,
  pass,
  playCard,
  type Hand,
  type Level,
} from './eights'
import type { Card } from './poker'
import type { Rules, Seat } from '../lab/social/room'

/**
 * Crazy eights as a match by turns (src/lab/matches): hands of the toy's own game for two, seven
 * cards each, first to so many points. A move plays a card (an eight with the suit it names),
 * draws one, or keeps the card just drawn rather than play it. Out first takes the points left in
 * the other hand. Together, the friends hold one hand and take its moves in turn.
 *
 * ⚠️ THE HANDS, THE STOCK AND THE CARD JUST DRAWN ARE KEPT BACK (Rules.hidden). The table sees that
 * a card was drawn, never which; each player fetches their own hand from lab-move. What travels is
 * what a table shows: the pile, face up, the suit to follow, how many each holds and the stock has,
 * the suits each has been seen unable to follow (which the toy's Hard counts on, as a player
 * would), and every finished hand with the loser's cards laid down, so its points are what they
 * show. A hand in play is refused unless pile, hands and stock make one deck.
 *
 * The server deals each hand (the first with the friend's yes, the rest through Rules.roll, the
 * sides taking turns to begin), and shuffles the pile back into the stock when it runs out. A hand
 * past MAX_MOVES is void, so two players who can neither play nor draw cannot hold a match for ever.
 */
export type Ended = { winner: Seat | null; points: number; left: Card[] }
export type EightsGame = {
  target: number
  done: Ended[]
  first: Seat
  between: boolean
  pile: Card[]
  suit: number
  turn: Seat
  /** whether the player to move has drawn this turn: the card itself is theirs alone */
  drawn: boolean
  short: boolean[][]
  sizes: [number, number]
  stockLeft: number
  moves: number
  hands: [Card[] | null, Card[] | null]
  stock: Card[] | null
  drew: Card | null
}
export type EightsMove = { play: Card; suit?: number } | { draw: true } | { pass: true }

export const TARGETS = [50, 100] as const
export const MAX_HANDS = 30
export const MAX_MOVES = 400

export function readEightsSettings(s: Record<string, unknown>): { target: number } | null {
  const target = s.target ?? 100
  return (TARGETS as readonly unknown[]).includes(target) ? { target: target as number } : null
}

export const totals = (g: { done: Ended[] }): [number, number] => {
  const t: [number, number] = [0, 0]
  for (const r of g.done) if (r.winner !== null) t[r.winner] += r.points
  return t
}
const matchOver = (g: EightsGame) =>
  Math.max(...totals(g)) >= g.target || g.done.length >= MAX_HANDS
export const whoseMove = (g: EightsGame): Seat | null => (g.between ? null : g.turn)

const fresh = (target: number): EightsGame => ({
  target,
  done: [],
  first: 1,
  between: true,
  pile: [],
  suit: 0,
  turn: 0,
  drawn: false,
  short: [
    [false, false, false, false],
    [false, false, false, false],
  ],
  sizes: [0, 0],
  stockLeft: 0,
  moves: 0,
  hands: [null, null],
  stock: null,
  drew: null,
})

const known = (g: EightsGame) => !!g.hands[0] && !!g.hands[1] && !!g.stock
const toHand = (g: EightsGame): Hand => ({
  hands: [g.hands[0]!, g.hands[1]!],
  stock: g.stock!,
  pile: g.pile,
  suit: g.suit,
  turn: g.turn,
  drew: g.drew,
  short: g.short,
  winner: null,
})
function fromHand(g: EightsGame, h: Hand, counted = true): EightsGame {
  const next: EightsGame = {
    ...g,
    pile: h.pile,
    suit: h.suit,
    turn: h.turn as Seat,
    drawn: h.drew !== null,
    drew: h.drew,
    short: h.short.map((s) => [...s]),
    sizes: [h.hands[0].length, h.hands[1].length],
    stockLeft: h.stock.length,
    moves: g.moves + (counted ? 1 : 0),
    hands: [h.hands[0], h.hands[1]],
    stock: h.stock,
  }
  if (h.winner !== null) {
    const loser = h.winner === 0 ? 1 : 0
    const left = [...h.hands[loser]]
    const ended: Ended = {
      winner: h.winner as Seat,
      points: left.reduce((a, c) => a + cost(c), 0),
      left,
    }
    return { ...next, done: [...g.done, ended], between: true }
  }
  // a hand that will not end is void: nobody scores, and the next is dealt
  if (next.moves >= MAX_MOVES)
    return { ...next, done: [...g.done, { winner: null, points: 0, left: [] }], between: true }
  return next
}

function dealt(g: EightsGame, rand: () => number): EightsGame {
  const first: Seat = g.first === 0 ? 1 : 0
  const h = deal(2, rand, first)
  return { ...fromHand({ ...g, between: false, moves: 0 }, h, false), first, moves: 0 }
}

const isCard = (x: unknown): x is Card =>
  Number.isInteger(x) && (x as number) >= 0 && (x as number) < 52
const isSuit = (x: unknown): x is number => x === 0 || x === 1 || x === 2 || x === 3

function moved(g: EightsGame, m: EightsMove, s: Seat): EightsGame | null {
  if (whoseMove(g) !== s) return null
  if ('pass' in m) {
    if (!g.drawn) return null
    return known(g) ? fromHand(g, pass(toHand(g))) : g
  }
  if ('draw' in m) {
    if (g.drawn) return null
    if (!known(g)) return g
    const h = toHand(g)
    if (legal(h).length) return null
    return fromHand(g, drawCard(h, Math.random))
  }
  if (g.pile.includes(m.play)) return null
  if (isEight(m.play) !== (m.suit !== undefined)) return null
  if (!known(g)) return g
  const h = toHand(g)
  if (!legal(h).includes(m.play)) return null
  return fromHand(g, playCard(h, m.play, m.suit))
}

/* ---------------------------------------------------------------- the wire ------------------ */

const cardList = (x: unknown, max = 52): x is Card[] =>
  Array.isArray(x) && x.length <= max && x.every(isCard) && new Set(x).size === x.length

function readEnded(x: unknown): Ended | null {
  const o = x as { winner?: unknown; points?: unknown; left?: unknown } | null
  if (!o || typeof o !== 'object' || !cardList(o.left)) return null
  if (o.winner === null)
    return o.points === 0 && o.left.length === 0 ? { winner: null, points: 0, left: [] } : null
  if (o.winner !== 0 && o.winner !== 1) return null
  // what the loser held, at the toy's own prices: the points can only be that
  if (o.points !== o.left.reduce((a, c) => a + cost(c), 0)) return null
  return { winner: o.winner, points: o.points as number, left: [...o.left] }
}

export function replayPublic(target: number, x: unknown): EightsGame | null {
  const o = x as Record<string, unknown> | null
  if (!o || typeof o !== 'object' || !Array.isArray(o.done) || o.done.length > MAX_HANDS)
    return null
  const done = o.done.map(readEnded)
  if (done.some((r) => !r)) return null
  const { first, between, pile, suit, turn, drawn, short, sizes, stockLeft, moves } = o
  if ((first !== 0 && first !== 1) || typeof between !== 'boolean' || typeof drawn !== 'boolean')
    return null
  if ((turn !== 0 && turn !== 1) || !isSuit(suit) || !cardList(pile)) return null
  if (
    !Array.isArray(short) ||
    short.length !== 2 ||
    !short.every(
      (s) => Array.isArray(s) && s.length === 4 && s.every((b) => typeof b === 'boolean'),
    )
  )
    return null
  if (
    !Array.isArray(sizes) ||
    sizes.length !== 2 ||
    !sizes.every((n) => Number.isInteger(n) && n >= 0)
  )
    return null
  if (!Number.isInteger(stockLeft) || (stockLeft as number) < 0) return null
  if (!Number.isInteger(moves) || (moves as number) < 0 || (moves as number) >= MAX_MOVES)
    return null
  const g: EightsGame = {
    ...fresh(target),
    done: done as Ended[],
    first,
    between,
    pile: [...pile],
    suit,
    turn,
    drawn,
    short: (short as boolean[][]).map((s) => [...s]),
    sizes: [sizes[0], sizes[1]],
    stockLeft: stockLeft as number,
    moves: moves as number,
  }
  if (g.between) return matchOver(g) && g.done.length > 0 ? g : null
  if (matchOver(g)) return null
  // one deck: the pile, both hands and the stock; and the suit to follow is the top card's, unless
  // an eight named another
  if (!g.pile.length || g.pile.length + g.sizes[0] + g.sizes[1] + g.stockLeft !== 52) return null
  const top = g.pile[g.pile.length - 1]
  if (!isEight(top) && (top & 3) !== g.suit) return null
  return g
}

/* ---------------------------------------------------------------- the rules ----------------- */

export function eightsRules(target: number): Rules<EightsGame, EightsMove> & {
  roll: (g: EightsGame, rand: () => number) => EightsGame
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
    roll: (g, rand) => (g.between && !matchOver(g) ? dealt(g, rand) : g),
    encode: (g) => ({
      done: g.done,
      first: g.first,
      between: g.between,
      pile: g.pile,
      suit: g.suit,
      turn: g.turn,
      drawn: g.drawn,
      short: g.short,
      sizes: g.sizes,
      stockLeft: g.stockLeft,
      moves: g.moves,
    }),
    decode: (x) => replayPublic(target, x),
    readMove: (x) => {
      const o = x as Record<string, unknown> | null
      if (!o || typeof o !== 'object') return null
      const keys = Object.keys(o).sort().join()
      if (keys === 'draw' && o.draw === true) return { draw: true }
      if (keys === 'pass' && o.pass === true) return { pass: true }
      if (keys === 'play' && isCard(o.play)) return { play: o.play }
      if (keys === 'play,suit' && isCard(o.play) && isSuit(o.suit))
        return { play: o.play, suit: o.suit }
      return null
    },
    modes: ['versus', 'together'],
    computer: {
      side: 1,
      levels: ['easy', 'fair', 'hard'],
      choose: (g, level) => {
        const c = choose(toHand(g), level as Level, Math.random)
        if (c.kind === 'draw') return { draw: true }
        if (c.kind === 'pass') return { pass: true }
        return isEight(c.card) ? { play: c.card, suit: c.suit ?? c.card & 3 } : { play: c.card }
      },
    },
    result: (g) => {
      if (whoseMove(g) !== null) return null
      const [a, b] = totals(g)
      return a > b ? 0 : b > a ? 1 : 'draw'
    },
    begun: (g) => g.done.length > 0 || g.moves > 0,
    hidden: {
      secret: (g) => ({ hands: g.hands, stock: g.stock, drew: g.drew }),
      join: (g, secret) => {
        const o = secret as { hands?: unknown; stock?: unknown; drew?: unknown } | null
        if (!o || !Array.isArray(o.hands) || o.hands.length !== 2) return null
        if (g.between) return { ...g }
        const [a, b] = o.hands
        if (!cardList(a) || !cardList(b) || !cardList(o.stock)) return null
        if (a.length !== g.sizes[0] || b.length !== g.sizes[1] || o.stock.length !== g.stockLeft)
          return null
        const all = [...a, ...b, ...o.stock, ...g.pile]
        if (all.length !== 52 || new Set(all).size !== 52) return null
        // the card just drawn, exactly when the table says one was, and in the drawer's hand
        const drew = o.drew
        if (
          g.drawn !== (drew !== null) ||
          (drew !== null && !(isCard(drew) && [a, b][g.turn].includes(drew)))
        )
          return null
        return { ...g, hands: [[...a], [...b]], stock: [...o.stock], drew: drew as Card | null }
      },
      mine: (g, side) => ({ hand: g.hands[side], drew: g.turn === side ? g.drew : null }),
      // nothing in a move is hidden: a card played is face up, and a draw names no card
      logged: (m) => m,
      accept: (g) => dealt(g, Math.random),
    },
  }
}
