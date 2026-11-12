/**
 * Crazy eights: you against one to three computers. Play a card that matches the top of the pile
 * by suit or by rank; an eight goes on anything, and whoever plays it names the suit to follow. A
 * player who cannot play draws one, and may play it if it fits. The first to run out of cards
 * takes the points left in everyone else's hand — fifty for an eight, ten for a picture, an ace
 * one, the rest their number — and the first to a hundred wins.
 *
 * Pure, so eights.test.ts can play thousands of hands without a page. Cards are the Hold'em toy's:
 * 0–51, rank = c >> 2 (0 a two, 6 an eight, 12 an ace), suit = c & 3.
 */
import { rankOf, shuffled, suitOf, type Card } from './poker'
import { whole } from './kept'

export const EIGHT = 6
export const isEight = (c: Card) => rankOf(c) === EIGHT
/** what a card left in hand costs at the end */
export const cost = (c: Card) => {
  const r = rankOf(c)
  return r === EIGHT ? 50 : r === 12 ? 1 : r >= 9 ? 10 : r + 2
}

export type Hand = {
  hands: Card[][]
  stock: Card[]
  /** the discard pile, its top last */
  pile: Card[]
  /** the suit to follow: the top card's, or the one named with an eight */
  suit: number
  turn: number
  /** whether the player to move has drawn this turn already, and may now only play that card */
  drew: Card | null
  /** suits each player has been seen unable to follow: public, for the computer */
  short: boolean[][]
  winner: number | null
}
const sortHand = (h: Card[]) => h.sort((a, b) => suitOf(a) - suitOf(b) || rankOf(a) - rankOf(b))

export function deal(players: number, rand: () => number, first = 0): Hand {
  const d = shuffled(rand)
  const n = players === 2 ? 7 : 5
  const hands = Array.from({ length: players }, (_, i) => sortHand(d.slice(i * n, i * n + n)))
  let rest = d.slice(players * n)
  // the first card turned up is never an eight: it goes back in the middle of the stock
  let top = rest.findIndex((c) => !isEight(c))
  if (top < 0) top = 0
  const start = rest[top]
  rest = rest.filter((_, i) => i !== top)
  return {
    hands,
    stock: rest,
    pile: [start],
    suit: suitOf(start),
    turn: first,
    drew: null,
    short: hands.map(() => [false, false, false, false]),
    winner: null,
  }
}
export const top = (h: Hand) => h.pile[h.pile.length - 1]
/** whether a card may go on the pile now */
export const fits = (h: Hand, c: Card) =>
  isEight(c) || suitOf(c) === h.suit || rankOf(c) === rankOf(top(h))
/** the cards the player to move may play: after a draw, only the card drawn */
export function legal(h: Hand): Card[] {
  if (h.winner !== null) return []
  if (h.drew !== null) return fits(h, h.drew) ? [h.drew] : []
  return h.hands[h.turn].filter((c) => fits(h, c))
}
const next = (h: Hand) => (h.turn + 1) % h.hands.length

/** play a card; an eight needs the suit to name */
export function playCard(h: Hand, c: Card, named?: number): Hand {
  if (!legal(h).includes(c)) return h
  const hands = h.hands.map((x, i) => (i === h.turn ? x.filter((y) => y !== c) : x))
  const suit = isEight(c) ? (named ?? suitOf(c)) : suitOf(c)
  const out = hands[h.turn].length === 0
  return {
    ...h,
    hands,
    pile: [...h.pile, c],
    suit,
    turn: out ? h.turn : next(h),
    drew: null,
    winner: out ? h.turn : null,
  }
}
/**
 * Draw one, when nothing in hand will go: the stock, shuffled back from the pile under the top card
 * when it runs out. A drawn card that fits may then be played; one that does not ends the turn —
 * and either way, the player has shown it held nothing of the suit asked for.
 */
export function drawCard(h: Hand, rand: () => number): Hand {
  if (h.winner !== null || h.drew !== null) return h
  let stock = h.stock
  let pile = h.pile
  if (!stock.length) {
    stock = pile.slice(0, -1).sort(() => rand() - 0.5)
    pile = pile.slice(-1)
  }
  const short = h.short.map((s, i) => (i === h.turn ? s.map((x, k) => x || k === h.suit) : s))
  if (!stock.length) return { ...h, short, turn: next(h) }
  const c = stock[0]
  const hands = h.hands.map((x, i) => (i === h.turn ? sortHand([...x, c]) : x))
  const after = { ...h, hands, stock: stock.slice(1), pile, short }
  return fits(after, c) ? { ...after, drew: c } : { ...after, turn: next(h) }
}
/** keep the card just drawn rather than play it */
export const pass = (h: Hand): Hand => (h.drew === null ? h : { ...h, drew: null, turn: next(h) })
/** the points a finished hand pays its winner */
export const payout = (h: Hand) =>
  h.hands.reduce((t, x, i) => (i === h.winner ? t : t + x.reduce((a, c) => a + cost(c), 0)), 0)

/* --------------------------------------------------------------------------- the computer */

export const LEVELS = ['easy', 'fair', 'hard'] as const
export type Level = (typeof LEVELS)[number]
export type Choice =
  | { kind: 'play'; card: Card; suit?: number }
  | { kind: 'draw' }
  | { kind: 'pass' }

/** the suit to name with an eight: the one held most of, or for Hard one the next player lacks */
function nameSuit(h: Hand, after: Card[], level: Level): number {
  const counts = [0, 1, 2, 3].map((s) => after.filter((c) => suitOf(c) === s && !isEight(c)).length)
  let best = counts.indexOf(Math.max(...counts))
  if (level === 'hard') {
    const nxt = next(h)
    const theyLack = [0, 1, 2, 3].filter((s) => h.short[nxt][s])
    const mine = theyLack.filter((s) => counts[s] > 0)
    if (mine.length) best = mine.reduce((a, s) => (counts[s] > counts[a] ? s : a))
  }
  return best
}
/** the computer's turn: a card to play, or a draw, or keeping a drawn card */
export function choose(h: Hand, level: Level, rand: () => number = Math.random): Choice {
  const me = h.turn
  const options = legal(h)
  if (!options.length) return h.drew !== null ? { kind: 'pass' } : { kind: 'draw' }
  const hand = h.hands[me]
  if (level === 'easy') {
    const c = options[Math.floor(rand() * options.length)]
    return { kind: 'play', card: c, suit: isEight(c) ? Math.floor(rand() * 4) : undefined }
  }
  // keep the eights for when nothing else will go, unless going out with one
  const plain = options.filter((c) => !isEight(c))
  const pool = plain.length ? plain : options
  const nxt = next(h)
  const danger = h.hands.some((x, i) => i !== me && x.length <= 2)
  const score = (c: Card) => {
    const rest = hand.filter((x) => x !== c)
    // a card that leaves many of its own suit behind keeps the next turn easy
    let v = rest.filter((x) => suitOf(x) === suitOf(c)).length * 3
    // shed the costly ones first, and quickly when somebody is about to go out
    v += cost(c) * (danger ? 0.6 : 0.15)
    if (level === 'hard') {
      // a suit the next player has been seen without: switching to it may make them draw
      if (h.short[nxt][suitOf(c)]) v += 6
      // a rank change into a suit they hold plenty of helps them: avoid when they are close
      if (h.hands[nxt].length <= 2 && !h.short[nxt][suitOf(c)]) v -= 2
    }
    return v
  }
  const c = pool.reduce((a, x) => (score(x) > score(a) ? x : a))
  return {
    kind: 'play',
    card: c,
    suit: isEight(c)
      ? nameSuit(
          h,
          hand.filter((x) => x !== c),
          level,
        )
      : undefined,
  }
}
export function apply(h: Hand, ch: Choice, rand: () => number): Hand {
  if (ch.kind === 'draw') return drawCard(h, rand)
  if (ch.kind === 'pass') return pass(h)
  return playCard(h, ch.card, ch.suit)
}
/** a whole hand among computers, for the tests: who went out, and the points */
export function playHand(levels: Level[], rand: () => number, first = 0) {
  let h = deal(levels.length, rand, first)
  for (let k = 0; k < 2000 && h.winner === null; k++)
    h = apply(h, choose(h, levels[h.turn], rand), rand)
  return { winner: h.winner, points: h.winner === null ? 0 : payout(h) }
}

/* --------------------------------------------------------------------------- what is kept */

export const EIGHTS_KEY = 'lab_eights_v1'
export const FELTS = ['green', 'blue', 'red'] as const
export const BACKS = ['lattice', 'stripes', 'stars'] as const
export type Tally = { won: number; played: number }
export type Saved = {
  level: Level
  players: 2 | 3 | 4
  felt: (typeof FELTS)[number]
  back: (typeof BACKS)[number]
  record: Record<Level, Tally>
}
const NONE: Tally = { won: 0, played: 0 }
export const EMPTY: Saved = {
  level: 'fair',
  players: 3,
  felt: 'green',
  back: 'lattice',
  record: { easy: NONE, fair: NONE, hard: NONE },
}
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
    record[l] = { won: whole(x.won), played: whole(x.played) }
  }
  return {
    level: pick(LEVELS, o.level, EMPTY.level),
    players: pick([2, 3, 4] as const, o.players, EMPTY.players),
    felt: pick(FELTS, o.felt, EMPTY.felt),
    back: pick(BACKS, o.back, EMPTY.back),
    record,
  }
}
