/**
 * Yacht: the old dice game. Five dice, up to three rolls a turn, keeping any between rolls; then the
 * dice must be scored in one of twelve boxes, each used once. Twelve turns each, and the higher
 * total wins.
 *
 * The boxes, by the classic rules: ones to sixes score the dice showing that face; a full house
 * (three of one face and two of another) scores all five; four of a kind scores the four; a little
 * straight (1 to 5) and a big straight (2 to 6) score 30; choice scores all five, whatever they
 * are; and a yacht — five alike — scores 50. Dice that do not fit a box score nothing there.
 *
 * Pure, so yacht.test.ts can play hundreds of games without a page.
 */

export const CATS = [
  'ones',
  'twos',
  'threes',
  'fours',
  'fives',
  'sixes',
  'full',
  'four',
  'little',
  'big',
  'choice',
  'yacht',
] as const
export type Cat = (typeof CATS)[number]
export type Side = 0 | 1
export type Card = Partial<Record<Cat, number>>

/** how many of each face, 1 to 6, at indexes 1 to 6 */
export const countsOf = (dice: number[]) => {
  const c = [0, 0, 0, 0, 0, 0, 0]
  for (const d of dice) c[d]++
  return c
}
/** what five dice would score in a box */
export function score(dice: number[], cat: Cat): number {
  const c = countsOf(dice)
  const sum = dice.reduce((s, d) => s + d, 0)
  const face = CATS.indexOf(cat) + 1
  if (face <= 6) return c[face] * face
  switch (cat) {
    case 'full':
      return c.includes(3) && c.includes(2) ? sum : 0
    case 'four': {
      const f = c.findIndex((n) => n >= 4)
      return f > 0 ? 4 * f : 0
    }
    case 'little':
      return [1, 2, 3, 4, 5].every((f) => c[f] === 1) ? 30 : 0
    case 'big':
      return [2, 3, 4, 5, 6].every((f) => c[f] === 1) ? 30 : 0
    case 'choice':
      return sum
    default:
      return c.includes(5) ? 50 : 0
  }
}
export const total = (card: Card) => CATS.reduce((s, k) => s + (card[k] ?? 0), 0)
export const open = (card: Card) => CATS.filter((k) => card[k] === undefined)

/* --------------------------------------------------------------------------- the dice as multisets */

/** a hand of dice by how many of each face, as one number: the count of face f is digit f - 1 in base 6 */
const code = (c: number[]) => c[1] + 6 * (c[2] + 6 * (c[3] + 6 * (c[4] + 6 * (c[5] + 6 * c[6]))))
const decode = (k: number) => {
  const c = [0]
  for (let f = 1; f <= 6; f++) {
    c.push(k % 6)
    k = Math.floor(k / 6)
  }
  return c
}
const add = (a: number[], b: number[]) => a.map((v, i) => v + b[i])
const size = (c: number[]) => c.reduce((s, v) => s + v, 0)
/** every way `n` dice can fall, as counts, with its chance */
const ROLLS: { c: number[]; p: number }[][] = (() => {
  const out: { c: number[]; p: number }[][] = []
  for (let n = 0; n <= 5; n++) {
    const tally = new Map<number, number>()
    for (let seq = 0; seq < 6 ** n; seq++) {
      const c = [0, 0, 0, 0, 0, 0, 0]
      for (let k = 0, s = seq; k < n; k++, s = Math.floor(s / 6)) c[(s % 6) + 1]++
      tally.set(code(c), (tally.get(code(c)) ?? 0) + 1)
    }
    out.push([...tally].map(([k, m]) => ({ c: decode(k), p: m / 6 ** n })))
  }
  return out
})()
/** every handful that can be kept from a hand: for each face, none of it up to all of it */
function keeps(c: number[]): number[][] {
  let out: number[][] = [[0, 0, 0, 0, 0, 0, 0]]
  for (let f = 1; f <= 6; f++) {
    const next: number[][] = []
    for (const k of out)
      for (let n = 0; n <= c[f]; n++) {
        const x = [...k]
        x[f] = n
        next.push(x)
      }
    out = next
  }
  return out
}
const diceOf = (c: number[]) => c.flatMap((n, f) => Array<number>(n).fill(f))

/* --------------------------------------------------------------------------- the computer */

export const LEVELS = ['easy', 'fair', 'hard'] as const
export type Level = (typeof LEVELS)[number]
/**
 * What each box is worth on an average turn aimed at it, so a box is filled where the dice beat that
 * rather than where they score most: by score alone, three ones and a two and a three go into
 * choice for 8 and spend the box that averages 22, where in ones they cost one point of par.
 * Measured alone over 200 games: Hard scores about 160 with these, 152 with none, and 156 with
 * each box's own average under this rule put in their place
 */
export const PAR: Record<Cat, number> = {
  ones: 2,
  twos: 5,
  threes: 8,
  fours: 11,
  fives: 14,
  sixes: 17,
  full: 16,
  four: 12,
  little: 12,
  big: 12,
  choice: 22,
  yacht: 14,
}
/** the best box for these dice among those still open, by score less par — or by score alone */
export function bestBox(dice: number[], card: Card, withPar = true): Cat {
  let best = open(card)[0]
  let bv = -Infinity
  for (const k of open(card)) {
    const v = score(dice, k) - (withPar ? PAR[k] : 0)
    if (v > bv) {
      bv = v
      best = k
    }
  }
  return best
}

/**
 * Which dice to keep, and what that is worth on average, by working out every keep and every way
 * the rest can fall, `rolls` rolls ahead: a hand with no rolls left is worth its best box (less par,
 * or not), and a hand with rolls left is worth its best keep's average over the next roll.
 */
export function plan(
  dice: number[],
  card: Card,
  rolls: number,
  withPar = true,
): { keep: number[]; value: number } {
  const memo = new Map<number, number>()
  const boxes = open(card)
  // a hand's best box, once for each of the 252 hands five dice can make
  const finals = new Map<number, number>()
  const final = (c: number[]) => {
    const key = code(c)
    let v = finals.get(key)
    if (v === undefined) {
      const d = diceOf(c)
      v = Math.max(...boxes.map((k) => score(d, k) - (withPar ? PAR[k] : 0)))
      finals.set(key, v)
    }
    return v
  }
  const worth = (c: number[], r: number): number => {
    if (r === 0) return final(c)
    const key = code(c) * 4 + r
    const hit = memo.get(key)
    if (hit !== undefined) return hit
    let best = -Infinity
    for (const k of keeps(c)) best = Math.max(best, average(k, r))
    memo.set(key, best)
    return best
  }
  const average = (k: number[], r: number) =>
    ROLLS[5 - size(k)].reduce((s, o) => s + o.p * worth(add(k, o.c), r - 1), 0)
  const c = countsOf(dice)
  if (rolls === 0) return { keep: [...dice], value: final(c) }
  let keep = c
  let value = -Infinity
  for (const k of keeps(c)) {
    const v = average(k, rolls)
    if (v > value + 1e-9) {
      value = v
      keep = k
    }
  }
  return { keep: diceOf(keep), value }
}
/** the dice to hold, as a mark for each of the five as they lie */
export function holdFor(dice: number[], keep: number[]): boolean[] {
  const left = [...keep]
  return dice.map((d) => {
    const i = left.indexOf(d)
    if (i < 0) return false
    left.splice(i, 1)
    return true
  })
}

/**
 * The computer's keep, with `rolls` rolls still to come this turn. Easy keeps the face it has most
 * of; Fair looks one roll ahead at what scores most; Hard looks at every roll left, and weighs each
 * box against what it is usually worth.
 */
export function chooseKeep(dice: number[], card: Card, rolls: number, level: Level): boolean[] {
  if (level === 'easy') {
    const c = countsOf(dice)
    let f = 6
    for (let x = 6; x >= 1; x--) if (c[x] > c[f]) f = x
    return dice.map((d) => d === f)
  }
  const p = level === 'fair' ? plan(dice, card, Math.min(1, rolls), false) : plan(dice, card, rolls)
  return holdFor(dice, p.keep)
}
export const chooseBox = (dice: number[], card: Card, level: Level): Cat =>
  bestBox(dice, card, level === 'hard')

/* --------------------------------------------------------------------------- a game */

export type Game = {
  cards: [Card, Card]
  turn: Side
  dice: number[]
  held: boolean[]
  /** rolls left this turn: 3 before the first */
  rolls: number
  over: boolean
}
export const newGame = (first: Side = 0): Game => ({
  cards: [{}, {}],
  turn: first,
  dice: [1, 1, 1, 1, 1],
  held: [false, false, false, false, false],
  rolls: 3,
  over: false,
})
/** roll every die not held */
export function roll(g: Game, rand: () => number): Game {
  if (g.over || g.rolls === 0) return g
  // nothing can be held before the first roll (see hold), and filling a box lets go of everything
  return {
    ...g,
    dice: g.dice.map((d, i) => (g.held[i] ? d : 1 + Math.floor(rand() * 6))),
    rolls: g.rolls - 1,
  }
}
export const hold = (g: Game, held: boolean[]): Game =>
  g.rolls === 3 || g.rolls === 0 ? g : { ...g, held }
/** score the dice in a box, and pass the turn */
export function fill(g: Game, cat: Cat): Game {
  if (g.over || g.rolls === 3 || g.cards[g.turn][cat] !== undefined) return g
  const cards: [Card, Card] = [{ ...g.cards[0] }, { ...g.cards[1] }]
  cards[g.turn][cat] = score(g.dice, cat)
  const over = open(cards[0]).length === 0 && open(cards[1]).length === 0
  // a side with nothing left to fill takes no turn: how a game alone is played
  const other: Side = g.turn === 0 ? 1 : 0
  return {
    ...g,
    cards,
    turn: open(cards[other]).length ? other : g.turn,
    held: [false, false, false, false, false],
    rolls: 3,
    over,
  }
}
/** a whole turn for one side at a level */
export function playTurn(g: Game, level: Level, rand: () => number): Game {
  let s = roll(g, rand)
  while (s.rolls > 0) {
    const keep = chooseKeep(s.dice, s.cards[s.turn], s.rolls, level)
    if (keep.every(Boolean)) break
    s = roll(hold(s, keep), rand)
  }
  return fill(s, chooseBox(s.dice, s.cards[s.turn], level))
}
/** a card with every box already filled, for the side that is not playing in a game alone */
export const FULL: Card = Object.fromEntries(CATS.map((k) => [k, 0]))
/** a game alone: the other side's card full from the start, so every turn is the player's */
export const soloGame = (): Game => ({ ...newGame(0), cards: [{}, FULL] })
/** a whole game for one side alone, at a level: its total */
export function solo(level: Level, rand: () => number): number {
  let g = soloGame()
  while (!g.over) g = playTurn(g, level, rand)
  return total(g.cards[0])
}

/* --------------------------------------------------------------------------- what is kept */

export const YACHT_KEY = 'lab_yacht_v1'
export const LOOKS = ['felt', 'wood', 'sea'] as const
export type Tally = { won: number; lost: number; drawn: number }
export type Saved = {
  level: Level
  look: (typeof LOOKS)[number]
  /** mark the dice the best player would keep */
  advice: boolean
  record: Record<Level, Tally>
  /** the best total in a game alone */
  best: number
}
const NONE: Tally = { won: 0, lost: 0, drawn: 0 }
export const EMPTY: Saved = {
  level: 'fair',
  look: 'felt',
  advice: false,
  record: { easy: NONE, fair: NONE, hard: NONE },
  best: 0,
}
const whole = (v: unknown, max = 1e6) =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < max ? v : 0
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
    record[l] = { won: whole(x.won), lost: whole(x.lost), drawn: whole(x.drawn) }
  }
  return {
    level: pick(LEVELS, o.level, EMPTY.level),
    look: pick(LOOKS, o.look, EMPTY.look),
    advice: typeof o.advice === 'boolean' ? o.advice : EMPTY.advice,
    record,
    // the most twelve boxes can hold is 297 — five of each face, 105; a full house of three sixes
    // and two fives, 28; four sixes, 24; the straights and choice, 30 each; a yacht, 50 — and
    // anything over that was not a game
    best: whole(o.best, 298),
  }
}
