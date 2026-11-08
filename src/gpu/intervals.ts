/**
 * The Lab's ear trainer: two notes, and the distance between them by name. Six stages, each adding
 * intervals that are harder to tell from the ones already there, unlocked by getting eight of ten
 * right; and questions lean towards the intervals you miss, so practice goes where it is needed.
 *
 * Pure, so all of it can be asked a question without a browser. (Whether a person can hear the
 * difference is the one thing no test here can check.)
 */

export type Interval = { semis: number; name: string; short: string; sound: string }

/** what each one sounds like, in words — the handle a beginner holds it by */
export const INTERVALS: Interval[] = [
  { semis: 1, name: 'Minor 2nd', short: 'm2', sound: 'tense — two notes rubbing' },
  { semis: 2, name: 'Major 2nd', short: 'M2', sound: 'a step, the start of a scale' },
  { semis: 3, name: 'Minor 3rd', short: 'm3', sound: 'sad, the minor chord’s heart' },
  { semis: 4, name: 'Major 3rd', short: 'M3', sound: 'bright, the major chord’s heart' },
  { semis: 5, name: 'Perfect 4th', short: 'P4', sound: 'strong and plain, a bugle call' },
  { semis: 6, name: 'Tritone', short: 'TT', sound: 'restless — it wants to move' },
  { semis: 7, name: 'Perfect 5th', short: 'P5', sound: 'open and hollow, a power chord' },
  { semis: 8, name: 'Minor 6th', short: 'm6', sound: 'bittersweet, leaning down' },
  { semis: 9, name: 'Major 6th', short: 'M6', sound: 'warm and sweet' },
  { semis: 10, name: 'Minor 7th', short: 'm7', sound: 'bluesy, wants to fall back' },
  { semis: 11, name: 'Major 7th', short: 'M7', sound: 'sharp, a step short of home' },
  { semis: 12, name: 'Octave', short: 'P8', sound: 'the same note, higher' },
]
export const byShort = (s: string) => INTERVALS.find((i) => i.short === s)!

/** the intervals each stage asks about: easy to tell apart first, near neighbours later */
export const STAGES: string[][] = [
  ['P8', 'P5', 'M3'],
  ['P8', 'P5', 'M3', 'm3'],
  ['P8', 'P5', 'P4', 'M3', 'm3'],
  ['P8', 'P5', 'P4', 'M3', 'm3', 'M2', 'm7'],
  ['P8', 'P5', 'P4', 'M3', 'm3', 'M2', 'm7', 'M6', 'm6'],
  INTERVALS.map((i) => i.short),
]
export const ROUND = 10
export const PASS = 8

export type Direction = 'up' | 'down' | 'together'
export type Question = { interval: string; first: number; second: number; direction: Direction }

/** the notes stay where a small speaker and an untrained ear both do well: C3 to G5 */
export const LOW = 48
export const HIGH = 79

export type Stats = Record<string, { asked: number; right: number }>

/**
 * How much to lean towards each interval: one share for being in the stage, and up to three more
 * for how often it has been missed — so a weak one comes up about four times as often as one
 * never missed, and a new one (nothing to go on) is treated as half missed.
 */
export function weights(set: readonly string[], stats: Stats): number[] {
  return set.map((s) => {
    const st = stats[s]
    const miss = st && st.asked ? 1 - st.right / st.asked : 0.5
    return 1 + 3 * miss
  })
}

export function pick<T>(items: readonly T[], w: readonly number[], rand: () => number): T {
  const total = w.reduce((a, b) => a + b, 0)
  let r = rand() * total
  for (let i = 0; i < items.length; i++) {
    r -= w[i]
    if (r < 0) return items[i]
  }
  return items[items.length - 1]
}

/** one question: an interval leaning on the weak ones, never the same as the last if there is a
 *  choice, and a root placed so both notes stay in range */
export function question(
  set: readonly string[],
  stats: Stats,
  direction: Direction | 'mixed',
  rand: () => number,
  last?: string,
): Question {
  const pool = set.length > 1 && last ? set.filter((s) => s !== last) : set
  const iv = pick(pool, weights(pool, stats), rand)
  const semis = byShort(iv).semis
  const root = LOW + Math.floor(rand() * (HIGH - LOW - semis + 1))
  const dir: Direction =
    direction === 'mixed'
      ? (['up', 'down', 'together'] as const)[Math.floor(rand() * 3)]
      : direction
  return dir === 'down'
    ? { interval: iv, first: root + semis, second: root, direction: dir }
    : { interval: iv, first: root, second: root + semis, direction: dir }
}

/** the answer to a question, from its notes — what the page checks against, not a stored label */
export const answerOf = (q: Question) => INTERVALS.find((i) => i.semis === Math.abs(q.second - q.first))!.short // prettier-ignore

/** a stage passed opens the next */
export const unlocked = (passed: number) => Math.min(STAGES.length - 1, passed)

export const NOTE_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B']
export const noteName = (m: number) => `${NOTE_NAMES[m % 12]}${Math.floor(m / 12) - 1}`

/* --------------------------------------------------------------------------- what is kept */

export const INTERVALS_KEY = 'lab_intervals_v1'
export type Saved = {
  /** how many stages have been passed — the next is open */
  passed: number
  stats: Stats
  /** best score out of ROUND, per stage */
  best: number[]
}
export const EMPTY_SAVED: Saved = { passed: 0, stats: {}, best: [] }

const int = (v: unknown, max: number) =>
  Number.isInteger(v) && (v as number) >= 0 && (v as number) <= max ? (v as number) : null

export function readSaved(text: string | null): Saved {
  const out: Saved = { passed: 0, stats: {}, best: [] }
  let v: unknown
  try {
    v = JSON.parse(text ?? 'null')
  } catch {
    return out
  }
  if (typeof v !== 'object' || !v || Array.isArray(v)) return out
  const o = v as Record<string, unknown>
  out.passed = int(o.passed, STAGES.length) ?? 0
  if (typeof o.stats === 'object' && o.stats && !Array.isArray(o.stats))
    for (const i of INTERVALS) {
      const s = (o.stats as Record<string, unknown>)[i.short]
      if (typeof s !== 'object' || !s) continue
      const asked = int((s as { asked?: unknown }).asked, 1e6)
      const right = int((s as { right?: unknown }).right, 1e6)
      if (asked !== null && right !== null && right <= asked) out.stats[i.short] = { asked, right }
    }
  if (Array.isArray(o.best))
    out.best = o.best.slice(0, STAGES.length).map((b) => int(b, ROUND) ?? 0)
  return out
}

/** a question answered, into the stats */
export function record(stats: Stats, interval: string, right: boolean): Stats {
  const s = stats[interval] ?? { asked: 0, right: 0 }
  return { ...stats, [interval]: { asked: s.asked + 1, right: s.right + (right ? 1 : 0) } }
}
