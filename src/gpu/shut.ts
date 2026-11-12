/**
 * Shut the box: nine tiles, 1 to 9, all up. Roll two dice and shut any tiles still up that add up
 * to the roll — one tile or several. Roll again, and again, until a roll cannot be made from the
 * tiles left; what is left, added up, is the score, and lower is better. Shut every tile and you
 * have shut the box, which scores nothing at all. Once the 7, 8 and 9 are all down you may roll
 * one die instead of two.
 *
 * Pure, so shut.test.ts can play thousands of turns without a page. The tiles still up are a
 * number with a bit for each: bit 0 for the 1, up to bit 8 for the 9.
 */

export const ALL = 0b111111111
export const tilesOf = (up: number) =>
  [1, 2, 3, 4, 5, 6, 7, 8, 9].filter((t) => up & (1 << (t - 1)))
export const sum = (up: number) => tilesOf(up).reduce((s, t) => s + t, 0)
/** may one die be rolled: the 7, 8 and 9 all down */
export const oneDieAllowed = (up: number) => (up & 0b111000000) === 0

/** every set of tiles still up that adds up to a roll, each as a number like `up` */
export function ways(up: number, roll: number): number[] {
  const out: number[] = []
  // every subset of the tiles that are up
  for (let s = up; s > 0; s = (s - 1) & up) if (sum(s) === roll) out.push(s)
  return out
}
/** each total two dice (or one) can make, with its chance */
export const ROLLS: Record<1 | 2, { roll: number; p: number }[]> = {
  1: [1, 2, 3, 4, 5, 6].map((roll) => ({ roll, p: 1 / 6 })),
  2: Array.from({ length: 11 }, (_, k) => ({ roll: k + 2, p: (6 - Math.abs(k + 2 - 7)) / 36 })),
}

/* --------------------------------------------------------------------------- playing it best */

/**
 * The lowest score to expect from here, playing as well as can be: for each roll, the best tiles to
 * shut; and where one die is allowed, whichever of one or two dice expects less. Worked out once for
 * all 512 sets of tiles, from the fewest up.
 */
export const EXPECT: Float64Array = (() => {
  const e = new Float64Array(ALL + 1)
  // a set's every subset has fewer tiles up, so counting up through the numbers reaches each subset
  // before the set itself
  for (let up = 0; up <= ALL; up++) {
    if (up === 0) continue
    const by = (dice: 1 | 2) =>
      ROLLS[dice].reduce((s, { roll, p }) => {
        const w = ways(up, roll)
        return s + p * (w.length ? Math.min(...w.map((x) => e[up & ~x])) : sum(up))
      }, 0)
    e[up] = oneDieAllowed(up) ? Math.min(by(1), by(2)) : by(2)
  }
  return e
})()
/** the chance of shutting the box from here, playing to shut it rather than to score low */
export const SHUT_CHANCE: Float64Array = (() => {
  const c = new Float64Array(ALL + 1)
  c[0] = 1
  for (let up = 1; up <= ALL; up++) {
    const by = (dice: 1 | 2) =>
      ROLLS[dice].reduce((s, { roll, p }) => {
        const w = ways(up, roll)
        return s + p * (w.length ? Math.max(...w.map((x) => c[up & ~x])) : 0)
      }, 0)
    c[up] = oneDieAllowed(up) ? Math.max(by(1), by(2)) : by(2)
  }
  return c
})()
/** how many dice the best player rolls here */
export function bestDice(up: number): 1 | 2 {
  if (!oneDieAllowed(up)) return 2
  const by = (dice: 1 | 2) =>
    ROLLS[dice].reduce((s, { roll, p }) => {
      const w = ways(up, roll)
      return s + p * (w.length ? Math.min(...w.map((x) => EXPECT[up & ~x])) : sum(up))
    }, 0)
  return by(1) < by(2) ? 1 : 2
}

/* --------------------------------------------------------------------------- the computer */

export const LEVELS = ['easy', 'fair', 'hard'] as const
export type Level = (typeof LEVELS)[number]
/**
 * The tiles the computer shuts for a roll: Easy any way that adds up; Fair the way with the fewest
 * tiles, the biggest first — the usual rule of thumb; Hard the way that expects the least to be
 * left, from the table above.
 */
export function chooseWay(up: number, roll: number, level: Level, rand: () => number): number {
  const w = ways(up, roll)
  if (!w.length) return 0
  if (level === 'easy') return w[Math.floor(rand() * w.length)]
  if (level === 'fair')
    return [...w].sort(
      (a, b) =>
        tilesOf(a).length - tilesOf(b).length || Math.max(...tilesOf(b)) - Math.max(...tilesOf(a)),
    )[0]
  return w.reduce((best, x) => (EXPECT[up & ~x] < EXPECT[up & ~best] ? x : best))
}
export const chooseDice = (up: number, level: Level): 1 | 2 =>
  !oneDieAllowed(up) ? 2 : level === 'hard' ? bestDice(up) : level === 'fair' ? 1 : 2

/** a die, 1 to 6 */
const die = (rand: () => number) => 1 + Math.floor(rand() * 6)
/** a whole turn at a level: what is left up at the end */
export function playTurn(level: Level, rand: () => number): number {
  let up = ALL
  for (;;) {
    if (!up) return 0
    const n = chooseDice(up, level)
    const roll = die(rand) + (n === 2 ? die(rand) : 0)
    const x = chooseWay(up, roll, level, rand)
    if (!x) return up
    up &= ~x
  }
}

/* --------------------------------------------------------------------------- a game on the page */

export type Turn = {
  up: number
  /** the dice showing, empty before the first roll */
  dice: number[]
  /** the dice are waiting to be used: tiles to pick that add up to them */
  live: boolean
  /** tiles picked towards the roll, not yet shut */
  picked: number
  over: boolean
}
export const newTurn = (): Turn => ({ up: ALL, dice: [], live: false, picked: 0, over: false })
export const rollTotal = (t: Turn) => t.dice.reduce((s, d) => s + d, 0)
/** roll one die or two, when a roll is due; the turn ends at once if no tiles up can make it */
export function roll(t: Turn, n: 1 | 2, rand: () => number): Turn {
  if (t.over || t.live || (n === 1 && !oneDieAllowed(t.up))) return t
  const dice = n === 1 ? [die(rand)] : [die(rand), die(rand)]
  const total = dice.reduce((s, d) => s + d, 0)
  const over = !ways(t.up, total).length
  return { ...t, dice, live: !over, picked: 0, over }
}
/** pick or let go of a tile towards the roll; when the picked tiles add up to it, they shut */
export function pick(t: Turn, tile: number): Turn {
  const bit = 1 << (tile - 1)
  if (!t.live || !(t.up & bit)) return t
  const picked = t.picked ^ bit
  const total = rollTotal(t)
  if (sum(picked) > total) return t
  if (sum(picked) < total) return { ...t, picked }
  const up = t.up & ~picked
  return { ...t, up, live: false, picked: 0, over: up === 0 }
}
export const score = (t: Turn) => sum(t.up)

/* --------------------------------------------------------------------------- what is kept */

export const SHUT_KEY = 'lab_shut_v1'
export const LOOKS = ['wood', 'felt', 'brass'] as const
export type Tally = { won: number; lost: number; drawn: number }
export type Saved = {
  level: Level
  look: (typeof LOOKS)[number]
  /** show what each choice is worth, as the best player reckons it */
  odds: boolean
  record: Record<Level, Tally>
  /** alone: the lowest score, and how many times the box was shut */
  best: number | null
  shut: number
  turns: number
}
const NONE: Tally = { won: 0, lost: 0, drawn: 0 }
export const EMPTY: Saved = {
  level: 'fair',
  look: 'wood',
  odds: false,
  record: { easy: NONE, fair: NONE, hard: NONE },
  best: null,
  shut: 0,
  turns: 0,
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
  // a score is what is left of 45, so nothing else was a turn
  const best =
    typeof o.best === 'number' && Number.isInteger(o.best) && o.best >= 0 && o.best <= 45
      ? o.best
      : null
  return {
    level: pick(LEVELS, o.level, EMPTY.level),
    look: pick(LOOKS, o.look, EMPTY.look),
    odds: typeof o.odds === 'boolean' ? o.odds : EMPTY.odds,
    record,
    best,
    shut: whole(o.shut),
    turns: whole(o.turns),
  }
}
