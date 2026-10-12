import { localISO } from '../circuit/dates'

/**
 * A goal, and the window it is judged over.
 *
 * ⚠️ THE ONE IDEA THIS MODULE EXISTS FOR. The thing asked for was a planner across "today /
 * tomorrow / daily / weekly / monthly / yearly / years", which is three different things wearing
 * one coat: a DATE (today, tomorrow), a RHYTHM (daily, weekly, monthly, yearly) and a SCALE
 * (years). Writing six views that each know their own rules is how a planner becomes six
 * half-agreeing planners.
 *
 * So a goal carries a SCOPE — the size of window it is judged over — and either an ANCHOR (a
 * one-off, in that window) or a REPEAT (every window of that size, forever). Looking ahead is then
 * one question asked six times with a different window, and the views hold no rules at all.
 *
 * See docs/2026-10-12-chronicle-design.md for the whole design and the SQL behind it.
 */
export type Scope = 'day' | 'week' | 'month' | 'quarter' | 'year' | 'life'

/** Smallest first, which is the order the room shows them in. */
export const SCOPES: readonly Scope[] = ['day', 'week', 'month', 'quarter', 'year', 'life']

export type Goal = {
  id: string
  title: string
  scope: Scope
  /** the local ISO date the window starts at, or null for a repeat and for 'life' */
  anchor: string | null
  /** every N windows; only 1 is honoured today — see the note on `repeats` */
  every: number | null
  /** null for a tick-box; a number for a quantity, which always has a unit */
  target: number | null
  unit: string | null
  progress: number
  done: boolean
  note: string | null
  sort: number
}

/** Inclusive `from`, EXCLUSIVE `to`, both local ISO dates. Null for 'life', which has no window. */
export type Window = { from: string; to: string }

/**
 * ⚠️ SUNDAY, BECAUSE THE REST OF THE SITE ALREADY SAYS SUNDAY. The Circuit's own month grid does
 * `d.setDate(d.getDate() - d.getDay())` with the comment "back to Sunday", so a chronicle week
 * running Monday to Sunday would mean the same site disagreed with itself about which days are
 * "this week" — and somebody looking at a weekly goal beside the Circuit's calendar would be
 * reading two different weeks. One home for a decision beats being right in isolation.
 *
 * ⚠️ IT IS DUPLICATED IN Feed.tsx, which is worth knowing: that file decides the same thing
 * inline for its calendar. Sharing it would mean the Circuit importing from chronicle, which is
 * backwards while chronicle is the newer and less proven of the two. Named here so the next
 * person who changes one knows to change the other.
 */
const WEEK_STARTS_ON = 0

/** A local date from a local ISO string. Noon, so a DST shift cannot move the day. */
const dayOf = (iso: string): Date => {
  const [y, m, d] = iso.split('-').map(Number)
  /**
   * ⚠️ NOON, AND IT IS ONE OF TWO GUARDS THAT ARE INDIVIDUALLY SUFFICIENT — measured, not assumed.
   * Perturbing this to midnight on its own leaves every test green, and so does changing plusDays
   * to add milliseconds on its own; only doing BOTH turns the daylight-saving test red. They are
   * belt and braces, which is worth saying because it is why neither can be shown to be load
   * bearing by deleting the other one.
   *
   * ⚠️ AND THE REASON IS NOT THE ONE I FIRST WROTE HERE. This claimed that local midnight "may
   * not exist" on a spring-forward day — it says 00:00:00 GMT-0500 quite happily in
   * America/New_York, because the US shifts at 2am. The true version is narrower: a few zones
   * shift AT midnight (Iran, and Cuba historically), so midnight is not universally a real
   * instant, while noon is twelve hours from either edge and no shift anybody performs reaches
   * it. The comment was wrong about the mechanism before it was corrected, which is exactly the
   * kind of sentence this file is not allowed to keep.
   */
  return new Date(y, (m ?? 1) - 1, d ?? 1, 12, 0, 0, 0)
}

/** N days on from a local ISO date, as a local ISO date. */
const plusDays = (iso: string, n: number): string => {
  const d = dayOf(iso)
  /* ⚠️ setDate, NOT a milliseconds sum: calendar arithmetic cannot be wrong about a day, while
     24h × n is wrong by an hour across a shift. With the noon anchor above, an hour is not enough
     to cross a date boundary — so this is the second of the two guards, not the only one. See the
     note on dayOf for the measurement that showed each is sufficient alone. */
  d.setDate(d.getDate() + n)
  return localISO(d)
}

/**
 * The window a scope covers, given any day inside it.
 *
 * ⚠️ HALF-OPEN, `from` INCLUSIVE AND `to` EXCLUSIVE, which is the only arrangement where one
 * window's end is the next one's start. Inclusive ends mean every comparison needs a +1 day
 * somewhere, and the +1 is where the off-by-one lives — the test asserts the windows tile without
 * a gap or an overlap rather than asserting any particular pair of dates.
 */
export function windowOf(scope: Scope, on: string): Window | null {
  if (scope === 'life') return null
  const d = dayOf(on)
  if (scope === 'day') return { from: on, to: plusDays(on, 1) }
  if (scope === 'week') {
    const back = (d.getDay() - WEEK_STARTS_ON + 7) % 7
    const from = plusDays(on, -back)
    return { from, to: plusDays(from, 7) }
  }
  const y = d.getFullYear()
  const m = d.getMonth()
  if (scope === 'month') {
    return { from: localISO(new Date(y, m, 1, 12)), to: localISO(new Date(y, m + 1, 1, 12)) }
  }
  if (scope === 'quarter') {
    const q = Math.floor(m / 3) * 3
    return { from: localISO(new Date(y, q, 1, 12)), to: localISO(new Date(y, q + 3, 1, 12)) }
  }
  return { from: localISO(new Date(y, 0, 1, 12)), to: localISO(new Date(y + 1, 0, 1, 12)) }
}

/**
 * Whether a goal repeats rather than sitting in one window.
 *
 * ⚠️ ONLY EVERY-ONE IS HONOURED, and the column is deliberately wider than that. "Every other
 * week" needs a PHASE to say which weeks, and a repeating goal has no anchor to take one from —
 * so N above 1 is a shape the model cannot place yet. The constraint allows 1 to 52 because a
 * check is cheaper to widen than to narrow, the room only ever writes 1, and everything asked for
 * — daily, weekly, monthly, yearly — is every-one of some scope.
 */
export const repeats = (g: Goal): boolean => g.every != null && g.every >= 1

/**
 * Which window of its own scope a goal belongs to, for a day you are looking at.
 *
 * A repeating goal belongs to whichever window contains that day; a one-off belongs to the window
 * its anchor names, wherever you happen to be looking from.
 */
export function goalWindow(g: Goal, on: string): Window | null {
  if (g.scope === 'life') return null
  if (repeats(g)) return windowOf(g.scope, on)
  return g.anchor ? windowOf(g.scope, g.anchor) : null
}

/**
 * Does this goal belong in the list for this scope, looked at from this day?
 *
 * ⚠️ MATCHED ON SCOPE AS WELL AS ON DATES, and that is what keeps the six lists readable. A
 * year-long target of a hundred points is not a thing to do today, even though today is inside the
 * year — so a view shows what you are aiming at AT ITS OWN CADENCE, and each goal appears in
 * exactly one of them. Overlap alone would put every yearly goal in all six lists, which is the
 * difference between a planner and a wall of text.
 */
export function inScope(g: Goal, scope: Scope, on: string): boolean {
  if (g.scope !== scope) return false
  if (scope === 'life') return true
  if (repeats(g)) return true
  const w = windowOf(scope, on)
  return !!w && !!g.anchor && g.anchor >= w.from && g.anchor < w.to
}

/**
 * How far along a goal is, 0 to 1 — or null when there is nothing to measure.
 *
 * ⚠️ A TICK-BOX HAS NO FRACTION. A goal with no target is done or it is not, and reporting it as
 * 0% or 100% would invite a progress bar onto something that has no middle. Null is the honest
 * answer and the caller draws a box instead of a bar.
 */
export function share(g: Goal): number | null {
  if (g.target == null || !(g.target > 0)) return null
  return Math.max(0, Math.min(1, g.progress / g.target))
}

/** Whether a goal counts as finished, by either of the two ways it can be. */
export const finished = (g: Goal): boolean => {
  if (g.done) return true
  const s = share(g)
  return s != null && s >= 1
}

/**
 * The last day a window actually covers.
 *
 * ⚠️ BECAUSE `to` IS EXCLUSIVE AND NAMING IT WOULD BE A LIE. A month window ends at the first of
 * the next month, so showing `to` on screen tells somebody their month runs to 1 November. One
 * day back is the honest label.
 *
 * ⚠️ AND IT LIVES HERE RATHER THAN IN THE JSX, which is where I first wrote it — with
 * `toISOString().slice(0, 10)`, the one thing dates.ts has a comment at the top of the file
 * warning against: that is UTC, so for anybody behind UTC it returns tomorrow's date all evening.
 * Calendar arithmetic belongs next to the rest of the calendar arithmetic, where it is tested.
 */
export const lastDay = (w: Window): string => plusDays(w.to, -1)

/** Today, and the day after, as local ISO dates — the two views that name a day. */
export const today = (): string => localISO(new Date())
export const tomorrow = (): string => plusDays(today(), 1)
