/**
 * Gin rummy for two: you and the computer. Ten cards each; on your turn draw from the stock or
 * take the top discard, then discard one. Arrange your hand into melds — three or four of a rank,
 * or three or more in a row of one suit — and the cards left over are deadwood. With ten or less
 * you may knock; with none, it is gin. Pure, so gin.test.ts can play thousands of hands.
 *
 * Cards are the Hold'em toy's 0–51 (rank = c >> 2, 0 a two and 12 an ace; suit = c & 3). Here an
 * ace is low: it counts one, and a run may start at it but never turn the corner past the king.
 */
import { rankOf, shuffled, suitOf, type Card } from './poker'
import { rng } from './bricks'

/** an ace is 0, a two 1, … a king 12 */
export const gRank = (c: Card) => (rankOf(c) === 12 ? 0 : rankOf(c) + 1)
export const value = (c: Card) => Math.min(10, gRank(c) + 1)
export const deadwood = (cs: Card[]) => cs.reduce((a, c) => a + value(c), 0)

/** every meld that can be made from these cards */
export function allMelds(cards: Card[]): Card[][] {
  const out: Card[][] = []
  const byRank = new Map<number, Card[]>()
  for (const c of cards) byRank.set(gRank(c), [...(byRank.get(gRank(c)) ?? []), c])
  for (const same of byRank.values()) {
    if (same.length >= 3) {
      if (same.length === 4) {
        out.push(same)
        for (let k = 0; k < 4; k++) out.push(same.filter((_, j) => j !== k))
      } else out.push(same)
    }
  }
  for (let s = 0; s < 4; s++) {
    const suit = cards.filter((c) => suitOf(c) === s).sort((a, b) => gRank(a) - gRank(b))
    for (let i = 0; i < suit.length; i++)
      for (let j = i + 2; j < suit.length; j++) {
        const run = suit.slice(i, j + 1)
        if (run.every((c, k) => k === 0 || gRank(c) === gRank(run[k - 1]) + 1)) out.push(run)
        else break
      }
  }
  return out
}

/** the arrangement with the least deadwood: the melds chosen and what is left over */
export function arrange(cards: Card[]): { melds: Card[][]; dead: Card[]; points: number } {
  const melds = allMelds(cards)
  let best = { melds: [] as Card[][], dead: cards, points: deadwood(cards) }
  const go = (from: number, used: Set<Card>, chosen: Card[][]) => {
    const dead = cards.filter((c) => !used.has(c))
    const pts = deadwood(dead)
    if (pts < best.points) best = { melds: chosen.slice(), dead, points: pts }
    for (let k = from; k < melds.length; k++) {
      const m = melds[k]
      if (m.some((c) => used.has(c))) continue
      for (const c of m) used.add(c)
      chosen.push(m)
      go(k + 1, used, chosen)
      chosen.pop()
      for (const c of m) used.delete(c)
    }
  }
  go(0, new Set(), [])
  return best
}

/** the defender's cards that can be added to the knocker's melds, taken off one at a time */
export function layOff(melds: Card[][], dead: Card[]): { left: Card[]; laid: Card[] } {
  const ms = melds.map((m) => m.slice())
  let left = dead.slice()
  const laid: Card[] = []
  for (let changed = true; changed; ) {
    changed = false
    for (const c of left) {
      const m = ms.find((m) => {
        const set = m.every((x) => gRank(x) === gRank(m[0]))
        if (set) return gRank(c) === gRank(m[0]) && m.length < 4
        const lo = m.reduce((a, x) => (gRank(x) < gRank(a) ? x : a))
        const hi = m.reduce((a, x) => (gRank(x) > gRank(a) ? x : a))
        return (
          suitOf(c) === suitOf(m[0]) && (gRank(c) === gRank(lo) - 1 || gRank(c) === gRank(hi) + 1)
        )
      })
      if (m) {
        m.push(c)
        laid.push(c)
        left = left.filter((x) => x !== c)
        changed = true
        break
      }
    }
  }
  return { left, laid }
}

/* ---------------------------------------------------------------------------- a hand */

export type Hand = {
  hands: [Card[], Card[]]
  stock: Card[]
  pile: Card[]
  turn: 0 | 1
  /** draw, then discard */
  phase: 'draw' | 'discard'
  /** the card just taken from the pile, which may not go straight back */
  took: Card | null
  /** cards each player has taken from the pile: a clue to what they collect */
  picked: [Card[], Card[]]
  over: null | Result
}
export type Result = {
  winner: 0 | 1 | null
  points: number
  how: 'gin' | 'knock' | 'undercut' | 'void'
  knocker: 0 | 1 | null
  shown: [{ melds: Card[][]; dead: Card[] }, { melds: Card[][]; dead: Card[] }]
}
export function deal(seed: number, first: 0 | 1 = 0): Hand {
  const d = shuffled(rng(seed))
  return {
    hands: [d.slice(0, 10), d.slice(10, 20)],
    pile: [d[20]],
    stock: d.slice(21),
    turn: first,
    phase: 'draw',
    took: null,
    picked: [[], []],
    over: null,
  }
}
export function draw(h: Hand, from: 'stock' | 'pile'): Hand {
  if (h.over || h.phase !== 'draw') return h
  const me = h.turn
  const card = from === 'stock' ? h.stock[0] : h.pile[h.pile.length - 1]
  if (card === undefined) return h
  const hands = h.hands.map((x, i) => (i === me ? [...x, card] : x)) as Hand['hands']
  const picked = h.picked.map((x, i) =>
    i === me && from === 'pile' ? [...x, card] : x,
  ) as Hand['picked']
  return {
    ...h,
    hands,
    stock: from === 'stock' ? h.stock.slice(1) : h.stock,
    pile: from === 'pile' ? h.pile.slice(0, -1) : h.pile,
    phase: 'discard',
    took: from === 'pile' ? card : null,
    picked,
  }
}
/** discard a card; with `knock`, end the hand on it (allowed at ten deadwood or less) */
export function discard(h: Hand, card: Card, knock = false): Hand {
  if (h.over || h.phase !== 'discard' || card === h.took || !h.hands[h.turn].includes(card))
    return h
  const me = h.turn
  const them = (me === 0 ? 1 : 0) as 0 | 1
  const mine = h.hands[me].filter((c) => c !== card)
  const hands = h.hands.map((x, i) => (i === me ? mine : x)) as Hand['hands']
  const after: Hand = {
    ...h,
    hands,
    pile: [...h.pile, card],
    turn: them,
    phase: 'draw',
    took: null,
  }
  if (knock) {
    const a = arrange(mine)
    if (a.points > 10) return h
    const d = arrange(hands[them])
    const gin = a.points === 0
    const off = gin ? { left: d.dead, laid: [] } : layOff(a.melds, d.dead)
    const theirs = deadwood(off.left)
    const shown = [] as unknown as Result['shown']
    shown[me] = { melds: a.melds, dead: a.dead }
    shown[them] = { melds: d.melds, dead: off.left }
    let r: Result
    if (gin) r = { winner: me, points: 25 + theirs, how: 'gin', knocker: me, shown }
    else if (theirs <= a.points)
      r = { winner: them, points: 25 + a.points - theirs, how: 'undercut', knocker: me, shown }
    else r = { winner: me, points: theirs - a.points, how: 'knock', knocker: me, shown }
    return { ...after, over: r }
  }
  // the stock down to its last two with nobody out: the hand is void
  if (after.stock.length <= 2) {
    const shown = [0, 1].map((i) => {
      const x = arrange(hands[i])
      return { melds: x.melds, dead: x.dead }
    }) as Result['shown']
    return { ...after, over: { winner: null, points: 0, how: 'void', knocker: null, shown } }
  }
  return after
}

/* ---------------------------------------------------------------------------- the computer */

/**
 * ⚠️ TWO LEVELS, NOT THREE, BECAUSE A THIRD WOULD NOT BE STRONGER. A "fair" that threw the card
 * leaving the least deadwood beat a random discarder 77.6% of hands, and every attempt at a level
 * above it — holding out for gin, counting outs, keeping away from what the other player collects,
 * swept over twelve settings — came out at 50.9-55.5% on the sweep's own deals and 51.8% on 1,200
 * fresh ones: within noise of no better. Gin is a game of luck at this depth, and a level that
 * only claimed to be harder would be a lie on a button.
 */
export const LEVELS = ['easy', 'hard'] as const
export type Level = (typeof LEVELS)[number]

/**
 * Hard's discard: the card that leaves the least deadwood, the heavier on a tie, counting too how
 * many unseen cards would bring what is left down further (its "outs"), and keeping away from
 * cards the other player would want — the same rank as, or close in suit to, what they have taken
 * from the pile.
 */
function bestDiscard(
  h: Hand,
  cards: Card[],
  forbid: Card | null,
  level: Level,
): { card: Card; points: number } {
  const them = h.turn === 0 ? 1 : 0
  const seen = new Set([...cards, ...h.pile])
  const unseen =
    level === 'hard' ? Array.from({ length: 52 }, (_, c) => c).filter((c) => !seen.has(c)) : []
  let best = { card: cards.find((c) => c !== forbid)!, points: Infinity, score: Infinity }
  for (const c of cards) {
    if (c === forbid) continue
    const rest = cards.filter((x) => x !== c)
    const points = arrange(rest).points
    let score = points - value(c) * 0.01
    if (level === 'hard') {
      const outs = unseen.filter((u) => arrange([...rest, u]).points < points).length
      const wanted = h.picked[them].some(
        (a) =>
          gRank(a) === gRank(c) || (suitOf(a) === suitOf(c) && Math.abs(gRank(a) - gRank(c)) <= 2),
      )
      score += -outs * 0.35 + (wanted ? 1.5 : 0)
    }
    if (score < best.score) best = { card: c, points, score }
  }
  return { card: best.card, points: best.points }
}

/**
 * The computer's whole turn: draw, discard, and knock whenever it can — in gin, waiting for a
 * better hand loses more than it wins (measured: holding out for gin won 41% of hands against a
 * player who knocked at once). Easy takes the discard only when it makes a meld outright and
 * throws any unmatched card; Hard takes the discard whenever it lowers its deadwood and discards
 * as above.
 */
export function play(h: Hand, level: Level, rand: () => number = Math.random): Hand {
  const me = h.turn
  const hand = h.hands[me]
  const top = h.pile[h.pile.length - 1]
  const now = arrange(hand).points
  let takePile = false
  if (top !== undefined) {
    if (level === 'easy') takePile = arrange([...hand, top]).melds.some((m) => m.includes(top))
    else takePile = bestDiscard(h, [...hand, top], top, level).points < now
  }
  let next = draw(h, takePile ? 'pile' : 'stock')
  const held = next.hands[me]
  let choice: { card: Card; points: number }
  if (level === 'easy') {
    const dead = arrange(held).dead.filter((c) => c !== next.took)
    const pool = dead.length ? dead : held.filter((c) => c !== next.took)
    const card = pool[Math.floor(rand() * pool.length)]
    choice = { card, points: arrange(held.filter((c) => c !== card)).points }
  } else choice = bestDiscard(next, held, next.took, level)
  next = discard(next, choice.card, choice.points <= 10)
  return next
}

/* ---------------------------------------------------------------------------- what is kept */

export const GIN_KEY = 'lab_gin_v1'
export const FELTS = ['green', 'blue', 'red'] as const
export const BACKS = ['lattice', 'stripes', 'stars'] as const
export type Tally = { won: number; lost: number; gins: number }
export type Saved = {
  level: Level
  felt: (typeof FELTS)[number]
  back: (typeof BACKS)[number]
  /** show the best arrangement of your hand as you play */
  melds: boolean
  record: Record<Level, Tally>
}
const NONE: Tally = { won: 0, lost: 0, gins: 0 }
export const EMPTY: Saved = {
  level: 'hard',
  felt: 'green',
  back: 'lattice',
  melds: true,
  record: { easy: NONE, hard: NONE },
}
const whole = (v: unknown) =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 1e6 ? v : 0
export function readSaved(text: string | null): Saved {
  let v: unknown
  try {
    v = JSON.parse(text ?? 'null')
  } catch {
    return EMPTY
  }
  if (typeof v !== 'object' || !v || Array.isArray(v)) return EMPTY
  const o = v as Record<string, unknown>
  const pick = <T>(list: readonly T[], x: unknown, d: T): T =>
    list.includes(x as T) ? (x as T) : d
  const rec = (typeof o.record === 'object' && o.record ? o.record : {}) as Record<string, unknown>
  const record = {} as Record<Level, Tally>
  for (const l of LEVELS) {
    const x = (typeof rec[l] === 'object' && rec[l] ? rec[l] : {}) as Record<string, unknown>
    record[l] = { won: whole(x.won), lost: whole(x.lost), gins: whole(x.gins) }
  }
  return {
    level: pick(LEVELS, o.level, EMPTY.level),
    felt: pick(FELTS, o.felt, EMPTY.felt),
    back: pick(BACKS, o.back, EMPTY.back),
    melds: typeof o.melds === 'boolean' ? o.melds : EMPTY.melds,
    record,
  }
}
