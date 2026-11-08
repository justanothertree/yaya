/**
 * Which unit a word names — the one table both halves of recorded-once agree on.
 *
 * ⚠️ THE SAME TABLE AS `chronicle_unit()` IN docs/2026-11-09-chronicle-sets-links.DRAFT.sql, and
 * units.test.ts reads that file to prove it. Evan's rule (§19g): "Link exercises to activities only
 * when their actual normalized units match. Don't infer compatibility from names or mix seconds
 * with reps." A Circuit exercise's unit and a Chronicle activity's metric each map to one of these,
 * or to nothing.
 *
 * ⚠️ NOTHING MATCHES NOTHING. "other", "laps", "pages" and an empty metric cannot be compared with
 * anything — including each other, because two things both called "other" are not known to be the
 * same thing. Those are listed as needing a decision, never linked by guess.
 */
export type Unit = 'reps' | 'sec' | 'min' | 'hr' | 'mi' | 'km'

export const UNIT_WORDS: Readonly<Record<string, Unit>> = {
  rep: 'reps',
  reps: 'reps',
  repetition: 'reps',
  repetitions: 'reps',
  sec: 'sec',
  secs: 'sec',
  s: 'sec',
  second: 'sec',
  seconds: 'sec',
  min: 'min',
  mins: 'min',
  minute: 'min',
  minutes: 'min',
  hr: 'hr',
  hrs: 'hr',
  h: 'hr',
  hour: 'hr',
  hours: 'hr',
  mi: 'mi',
  mile: 'mi',
  miles: 'mi',
  km: 'km',
  kms: 'km',
  kilometre: 'km',
  kilometres: 'km',
  kilometer: 'km',
  kilometers: 'km',
}

export function unitOf(word: string | null | undefined): Unit | null {
  const k = (word ?? '').trim().toLowerCase()
  /* ⚠️ OWN KEYS ONLY: a plain lookup answers "constructor" with Object's constructor */
  return Object.hasOwn(UNIT_WORDS, k) ? UNIT_WORDS[k] : null
}

/** Why an exercise can or cannot count toward an activity — the server's three refusals, in its words. */
export type Fit =
  | { ok: true }
  | { ok: false; why: 'no-metric' | 'unknown' | 'different'; exercise: string; activity: string }

export function fit(
  exerciseUnit: string | null | undefined,
  metric: string | null | undefined,
): Fit {
  const e = (exerciseUnit ?? '').trim()
  const m = (metric ?? '').trim()
  if (!m) return { ok: false, why: 'no-metric', exercise: e, activity: m }
  const a = unitOf(e)
  const b = unitOf(m)
  if (!a || !b) return { ok: false, why: 'unknown', exercise: e || 'none', activity: m }
  if (a !== b) return { ok: false, why: 'different', exercise: e, activity: m }
  return { ok: true }
}

/** The refusal as a person reads it — the same sentences chronicle_exercise_link raises. */
export function fitText(f: Fit): string | null {
  if (f.ok) return null
  if (f.why === 'no-metric') return 'that activity does not count anything'
  if (f.why === 'unknown') return `those units cannot be compared (${f.exercise} and ${f.activity})`
  return `they count different things (${f.exercise} and ${f.activity})`
}
