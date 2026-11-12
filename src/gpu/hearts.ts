/**
 * Hearts for four: you and three computers. Pass three cards, then play thirteen tricks, following
 * suit when you can; every heart you take costs a point and the queen of spades thirteen, unless
 * one player takes all twenty-six and "shoots the moon". First to a hundred ends the game, and the
 * lowest score wins. Pure, so hearts.test.ts can play thousands of hands without a page.
 *
 * Cards are the Hold'em toy's: 0–51, rank = c >> 2 (0 is a two, 12 an ace), suit = c & 3 with
 * 0 spades, 1 hearts, 2 diamonds, 3 clubs.
 */
import { rankOf, shuffled, suitOf, type Card } from './poker'

export const SPADES = 0
export const HEARTS = 1
export const CLUBS = 3
export const QUEEN = 10 * 4 + SPADES
export const TWO_CLUBS = 0 * 4 + CLUBS
export const points = (c: Card) => (c === QUEEN ? 13 : suitOf(c) === HEARTS ? 1 : 0)
export const PASS = ['left', 'right', 'across', 'hold'] as const
export type PassWay = (typeof PASS)[number]
/** who receives from seat `i`: seats run clockwise 0 (you), 1 left, 2 across, 3 right */
export const passTo = (i: number, way: PassWay) =>
  way === 'left' ? (i + 1) % 4 : way === 'right' ? (i + 3) % 4 : way === 'across' ? (i + 2) % 4 : i

export type Hand = {
  hands: Card[][]
  /** the trick on the table, in the order played, and who led it */
  trick: { seat: number; card: Card }[]
  leader: number
  turn: number
  /** cards each seat has taken in tricks */
  taken: Card[][]
  broken: boolean
  tricks: number
  /** suits each seat has shown it holds none of — public knowledge, for the computer */
  void: boolean[][]
  played: Card[]
}
const sortHand = (h: Card[]) =>
  h.sort((a, b) => {
    const order = [3, 2, 0, 1] // clubs, diamonds, spades, hearts
    return order.indexOf(suitOf(a)) - order.indexOf(suitOf(b)) || rankOf(a) - rankOf(b)
  })
export function deal(rand: () => number): Card[][] {
  const d = shuffled(rand)
  return [0, 1, 2, 3].map((s) => sortHand(d.slice(s * 13, s * 13 + 13)))
}
/** swap the passed cards, three from each seat, and start the hand with whoever holds the two of clubs */
export function startHand(hands: Card[][], passed: Card[][] | null, way: PassWay): Hand {
  const hs = hands.map((h) => h.slice())
  if (passed && way !== 'hold') {
    for (let i = 0; i < 4; i++) hs[i] = hs[i].filter((c) => !passed[i].includes(c))
    for (let i = 0; i < 4; i++) hs[passTo(i, way)].push(...passed[i])
    hs.forEach(sortHand)
  }
  const leader = hs.findIndex((h) => h.includes(TWO_CLUBS))
  return {
    hands: hs,
    trick: [],
    leader,
    turn: leader,
    taken: [[], [], [], []],
    broken: false,
    tricks: 0,
    void: [0, 1, 2, 3].map(() => [false, false, false, false]),
    played: [],
  }
}

/** the cards a seat may play now */
export function legal(h: Hand, seat = h.turn): Card[] {
  const hand = h.hands[seat]
  if (h.tricks === 0 && !h.trick.length) return hand.includes(TWO_CLUBS) ? [TWO_CLUBS] : []
  if (h.trick.length) {
    const suit = suitOf(h.trick[0].card)
    const follow = hand.filter((c) => suitOf(c) === suit)
    if (follow.length) return follow
    // nothing to follow with: anything, except no points on the very first trick if it can be helped
    if (h.tricks === 0) {
      const clean = hand.filter((c) => !points(c))
      if (clean.length) return clean
    }
    return hand
  }
  // leading: no hearts until they are broken, unless hearts are all there is
  if (!h.broken) {
    const rest = hand.filter((c) => suitOf(c) !== HEARTS)
    if (rest.length) return rest
  }
  return hand
}

/** the winner of a full trick: the highest card of the suit led */
export function winnerOf(trick: { seat: number; card: Card }[]): number {
  const suit = suitOf(trick[0].card)
  let best = trick[0]
  for (const t of trick) if (suitOf(t.card) === suit && rankOf(t.card) > rankOf(best.card)) best = t
  return best.seat
}

export function playCard(h: Hand, card: Card): Hand {
  const seat = h.turn
  const hands = h.hands.map((x, i) => (i === seat ? x.filter((c) => c !== card) : x))
  const trick = [...h.trick, { seat, card }]
  const voids = h.void.map((v) => v.slice())
  if (h.trick.length && suitOf(card) !== suitOf(h.trick[0].card))
    voids[seat][suitOf(h.trick[0].card)] = true
  const broken = h.broken || suitOf(card) === HEARTS || card === QUEEN
  const played = [...h.played, card]
  if (trick.length < 4)
    return { ...h, hands, trick, turn: (seat + 1) % 4, broken, void: voids, played }
  const w = winnerOf(trick)
  const taken = h.taken.map((t, i) => (i === w ? [...t, ...trick.map((x) => x.card)] : t))
  return {
    ...h,
    hands,
    trick: [],
    leader: w,
    turn: w,
    taken,
    broken,
    tricks: h.tricks + 1,
    void: voids,
    played,
  }
}
export const handOver = (h: Hand) => h.tricks === 13

/** the points each seat takes from a finished hand: a moon puts 26 on everyone else */
export function score(h: Hand): number[] {
  const pts = h.taken.map((t) => t.reduce((a, c) => a + points(c), 0))
  const moon = pts.indexOf(26)
  return moon >= 0 ? pts.map((_, i) => (i === moon ? 0 : 26)) : pts
}

/* ---------------------------------------------------------------------------- the computer */

export const LEVELS = ['easy', 'fair', 'hard'] as const
export type Level = (typeof LEVELS)[number]

/** three cards to pass: the queen and the big spades, then the highest hearts, then the highest of the rest */
export function choosePass(hand: Card[], level: Level, rand: () => number = Math.random): Card[] {
  if (level === 'easy') return [...hand].sort(() => rand() - 0.5).slice(0, 3)
  const spades = hand.filter((c) => suitOf(c) === SPADES)
  const danger = (c: Card) => {
    if (c === QUEEN || ((rankOf(c) === 11 || rankOf(c) === 12) && suitOf(c) === SPADES))
      return spades.length <= 4 ? 100 + rankOf(c) : 0
    if (suitOf(c) === HEARTS) return 40 + rankOf(c)
    if (suitOf(c) === SPADES) return 0
    return rankOf(c) * 2 - hand.filter((x) => suitOf(x) === suitOf(c)).length
  }
  return [...hand].sort((a, b) => danger(b) - danger(a)).slice(0, 3)
}

/** a sensible card by the usual habits: duck when you can, win cheap tricks late, dump danger when void */
function habit(h: Hand): Card {
  const options = legal(h)
  if (options.length === 1) return options[0]
  const seat = h.turn
  const lowest = (cs: Card[]) => cs.reduce((a, c) => (rankOf(c) < rankOf(a) ? c : a))
  const highest = (cs: Card[]) => cs.reduce((a, c) => (rankOf(c) > rankOf(a) ? c : a))
  const queenOut = !h.played.includes(QUEEN) && !h.hands[seat].includes(QUEEN)
  if (!h.trick.length) {
    // lead low from the longest safe suit; never lead a spade at or above the queen while she is out
    const safe = options.filter(
      (c) => !(suitOf(c) === SPADES && rankOf(c) >= 10 && queenOut) && c !== QUEEN,
    )
    const pool = safe.length ? safe : options
    return lowest(pool)
  }
  const suit = suitOf(h.trick[0].card)
  const following = suitOf(options[0]) === suit
  const top = h.trick
    .filter((t) => suitOf(t.card) === suit)
    .reduce((a, t) => (rankOf(t.card) > rankOf(a.card) ? t : a))
  const onTable = h.trick.reduce((a, t) => a + points(t.card), 0)
  if (following) {
    const under = options.filter((c) => rankOf(c) < rankOf(top.card))
    // last to play to a clean trick: take it with the highest, getting rid of a big card for free
    if (h.trick.length === 3 && onTable === 0 && !(suit === SPADES && options.includes(QUEEN)))
      return highest(
        options.filter((c) => c !== QUEEN).length ? options.filter((c) => c !== QUEEN) : options,
      )
    if (under.length) return highest(under)
    // must win it: as cheaply as possible, unless last, when the highest costs nothing more
    return h.trick.length === 3
      ? highest(
          options.filter((c) => c !== QUEEN).length ? options.filter((c) => c !== QUEEN) : options,
        )
      : lowest(options)
  }
  // void in the suit led: the queen first, then the big spades, then the highest heart, then the highest card
  if (options.includes(QUEEN)) return QUEEN
  const bigSpade = options.filter((c) => suitOf(c) === SPADES && rankOf(c) > 10)
  if (bigSpade.length && queenOut) return highest(bigSpade)
  const hearts = options.filter((c) => suitOf(c) === HEARTS)
  if (hearts.length) return highest(hearts)
  return highest(options)
}

/**
 * The computer's card. Easy plays any legal card; Fair plays by habit; Hard deals the unseen cards
 * out many ways consistent with who has shown a void, plays each deal to the end by habit after
 * each card it could play, and plays the card that cost it least on average.
 */
export function chooseCard(
  h: Hand,
  level: Level,
  rand: () => number = Math.random,
  samples = 24,
): Card {
  const options = legal(h)
  if (options.length === 1) return options[0]
  if (level === 'easy') return options[Math.floor(rand() * options.length)]
  if (level === 'fair') return habit(h)
  const seat = h.turn
  const seen = new Set([...h.played, ...h.hands[seat], ...h.trick.map((t) => t.card)])
  const unseen = Array.from({ length: 52 }, (_, c) => c).filter((c) => !seen.has(c))
  const cost = new Map<Card, number>(options.map((c) => [c, 0]))
  for (let k = 0; k < samples; k++) {
    // deal the unseen cards to the others, respecting the voids they have shown
    const need = [0, 1, 2, 3].map((i) => (i === seat ? 0 : h.hands[i].length))
    const guess: Card[][] = [[], [], [], []]
    const pool = [...unseen].sort(() => rand() - 0.5)
    let ok = true
    for (const c of pool) {
      const who = [0, 1, 2, 3].filter(
        (i) => i !== seat && guess[i].length < need[i] && !h.void[i][suitOf(c)],
      )
      if (!who.length) {
        ok = false
        break
      }
      guess[who[Math.floor(rand() * who.length)]].push(c)
    }
    if (!ok) {
      // the voids could not all be kept: deal ignoring them rather than lose the sample
      const free = [...unseen].sort(() => rand() - 0.5)
      for (let i = 0; i < 4; i++) guess[i] = i === seat ? [] : free.splice(0, need[i])
    }
    for (const card of options) {
      let sim: Hand = { ...h, hands: h.hands.map((x, i) => (i === seat ? x : guess[i])) }
      sim = playCard(sim, card)
      while (!handOver(sim)) sim = playCard(sim, habit(sim))
      const s = score(sim)
      // what it costs: my points, less a little of what the others took, so a moon is resisted
      cost.set(card, cost.get(card)! + s[seat] - (s.reduce((a, x) => a + x, 0) - s[seat]) * 0.05)
    }
  }
  let best = options[0]
  for (const c of options) if (cost.get(c)! < cost.get(best)!) best = c
  return best
}

/* ---------------------------------------------------------------------------- what is kept */

export const HEARTS_KEY = 'lab_hearts_v1'
export const FELTS = ['green', 'blue', 'red'] as const
export const BACKS = ['lattice', 'stripes', 'stars'] as const
export const ENDS = [50, 100] as const
export type Tally = { won: number; played: number; moons: number }
export type Saved = {
  level: Level
  felt: (typeof FELTS)[number]
  back: (typeof BACKS)[number]
  /** the score that ends a game */
  end: (typeof ENDS)[number]
  record: Record<Level, Tally>
}
const NONE: Tally = { won: 0, played: 0, moons: 0 }
export const EMPTY: Saved = {
  level: 'fair',
  felt: 'green',
  back: 'lattice',
  end: 100,
  record: { easy: NONE, fair: NONE, hard: NONE },
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
    const played = whole(x.played)
    record[l] = { won: Math.min(played, whole(x.won)), played, moons: whole(x.moons) }
  }
  return {
    level: pick(LEVELS, o.level, EMPTY.level),
    felt: pick(FELTS, o.felt, EMPTY.felt),
    back: pick(BACKS, o.back, EMPTY.back),
    end: pick(ENDS, o.end, EMPTY.end),
    record,
  }
}
