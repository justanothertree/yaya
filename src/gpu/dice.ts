/**
 * Ten thousand: the folk dice game of pushing your luck. Roll six dice, set aside at least one
 * that scores, then bank what this turn has made or roll the rest and risk it — a roll that scores
 * nothing loses the whole turn. Score with all six and you roll all six again. First to 10,000.
 * Pure, so dice.test.ts can play thousands of games without a page.
 *
 * Scoring (one common set of house rules, stated on the page):
 *   a 1 = 100, a 5 = 50; three of a kind = the face × 100, three 1s = 1,000;
 *   four of a kind doubles three's, five doubles again, six doubles again;
 *   1-2-3-4-5-6 = 1,500; three pairs = 750.
 *
 * ⚠️ THE CHANCE OF SCORING NOTHING IS COUNTED, NOT ESTIMATED. `bustChance` enumerates every way n
 * dice can land, so the page can print the real odds of the next roll, and the test checks them
 * against the fractions published for this game.
 */

export type Face = 1 | 2 | 3 | 4 | 5 | 6
export const TARGET = 10_000

const counts = (dice: readonly number[]) => {
  const c = [0, 0, 0, 0, 0, 0, 0]
  for (const d of dice) c[d]++
  return c
}

const kind = (face: number, n: number) => (face === 1 ? 1000 : face * 100) * 2 ** (n - 3)

/**
 * What a set of dice scores if every die in it counts, or null if any die is dead weight. Dice set
 * aside must all score: you may not keep a 3 to pad a roll.
 */
export function scoreOf(dice: readonly number[]): number | null {
  if (!dice.length) return null
  const c = counts(dice)
  if (dice.length === 6) {
    if (c.slice(1).every((n) => n === 1)) return 1500
    if (c.filter((n) => n === 2).length === 3) return 750
  }
  let total = 0
  for (let f = 1; f <= 6; f++) {
    let n = c[f]
    if (n >= 3) {
      total += kind(f, n)
      n = 0
    }
    if (n > 0) {
      if (f === 1) total += 100 * n
      else if (f === 5) total += 50 * n
      else return null
    }
  }
  return total
}

/** every subset of a roll's positions that scores, with its points — the choices a player has */
export function options(roll: readonly number[]): { keep: number[]; points: number }[] {
  const out: { keep: number[]; points: number }[] = []
  const n = roll.length
  for (let mask = 1; mask < 1 << n; mask++) {
    const keep: number[] = []
    for (let i = 0; i < n; i++) if (mask & (1 << i)) keep.push(i)
    const points = scoreOf(keep.map((i) => roll[i]))
    if (points !== null) out.push({ keep, points })
  }
  return out
}

/** does any die in this roll score at all */
export const scores = (roll: readonly number[]) =>
  roll.some((d) => d === 1 || d === 5) || counts(roll).some((n) => n >= 3) || scoreOf(roll) !== null

/** the exact chance that n dice score nothing, by counting all 6^n ways they can land */
export function bustChance(n: number): number {
  let bust = 0
  const roll = new Array(n).fill(1)
  const total = 6 ** n
  for (let k = 0; k < total; k++) {
    let x = k
    for (let i = 0; i < n; i++) {
      roll[i] = (x % 6) + 1
      x = Math.floor(x / 6)
    }
    if (!scores(roll)) bust++
  }
  return bust / total
}
export const BUST: readonly number[] = [0, 1, 2, 3, 4, 5, 6].map((n) => (n ? bustChance(n) : 0))

export function roll(n: number, rand: () => number): Face[] {
  return Array.from({ length: n }, () => (1 + Math.floor(rand() * 6)) as Face)
}

/* ---------------------------------------------------------------------------- a turn */

export type Turn = {
  /** the dice just rolled, still on the table */
  roll: Face[]
  /** points set aside this turn, not yet banked */
  points: number
  /** dice still free to roll after what has been set aside */
  free: number
  bust: boolean
}

export const newTurn = (rand: () => number): Turn => {
  const r = roll(6, rand)
  return { roll: r, points: 0, free: 6, bust: !scores(r) }
}

/**
 * Set aside the dice at these positions of the current roll. Returns the turn after it, or null if
 * the choice does not score. Setting aside all six ("hot dice") frees all six again.
 */
export function setAside(t: Turn, keep: number[]): Turn | null {
  const pts = scoreOf(keep.map((i) => t.roll[i]))
  if (pts === null || t.bust) return null
  const free = t.free - keep.length
  return {
    roll: t.roll.filter((_, i) => !keep.includes(i)),
    points: t.points + pts,
    free: free === 0 ? 6 : free,
    bust: false,
  }
}

/** roll the free dice again */
export function rollOn(t: Turn, rand: () => number): Turn {
  const r = roll(t.free, rand)
  return { roll: r, points: t.points, free: t.free, bust: !scores(r) }
}

/* ---------------------------------------------------------------------------- the computer */

/**
 * Roughly what having n dice still to roll is worth, in points — so a keep can be judged as the
 * points it takes now plus the dice it leaves. Keeping nothing back (all six scored) frees six.
 */
export const DICE_WORTH = [0, 25, 50, 100, 200, 300, 450]

/**
 * The computer's choice from a roll: the keep worth most, counting the dice it leaves to roll. So
 * with a 1 and a 5 among six dice it keeps only the 1 — five dice to roll are worth more than 50
 * points now — but it never breaks up a triple or a six-dice combination.
 */
export function chooseKeep(roll: readonly number[]): number[] {
  let best: { keep: number[]; value: number } | null = null
  for (const o of options(roll)) {
    const left = roll.length - o.keep.length
    const value = o.points + DICE_WORTH[left === 0 ? 6 : left]
    if (!best || value > best.value) best = { keep: o.keep, value }
  }
  return best ? best.keep : []
}

/** how many points it wants in hand before banking, by how many dice it would roll next */
export const BANK_AT = [0, 300, 300, 400, 1000, 2000, Infinity]

/** whether the computer banks: enough in hand for the risk, or enough to win */
export function wantsBank(t: Turn, mine: number, theirs: number): boolean {
  if (mine + t.points >= TARGET) return true
  // well behind near the end, it has to gamble
  const behind = theirs - mine > 2500 && theirs > TARGET * 0.7
  return t.points >= BANK_AT[t.free] * (behind ? 2 : 1)
}

/* ---------------------------------------------------------------------------- what is kept */

export const DICE_KEY = 'lab_dice_v1'
export type Saved = { won: number; lost: number; bestTurn: number; fewestTurns: number }
export const EMPTY: Saved = { won: 0, lost: 0, bestTurn: 0, fewestTurns: 0 }
export function readSaved(text: string | null): Saved {
  const out = { ...EMPTY }
  let v: unknown
  try {
    v = JSON.parse(text ?? 'null')
  } catch {
    return out
  }
  if (typeof v !== 'object' || !v || Array.isArray(v)) return out
  const o = v as Record<string, unknown>
  for (const k of Object.keys(EMPTY) as (keyof Saved)[]) {
    const x = o[k]
    if (typeof x === 'number' && Number.isInteger(x) && x >= 0 && x <= 1e9) out[k] = x
  }
  return out
}

export function seeded(seed: number) {
  let s = seed >>> 0 || 1
  return () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    return (s >>> 0) / 2 ** 32
  }
}
