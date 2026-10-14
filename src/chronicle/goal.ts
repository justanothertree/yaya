import { localISO } from '../circuit/dates'
import { localMidnight, type Activity } from './record'

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
  /**
   * Whether this one goes on your profile.
   *
   * ⚠️ ONE TICK PER GOAL, never one for all of them. A goal is free text somebody wrote about
   * their own life — "Ring the dentist" is the mild end of what people put here — so agreeing to
   * show the hours you spent is a different act from agreeing to show what you are trying to fix
   * about yourself. And it is only HALF the switch: the chronicle block has to be asking for goals
   * as well, so neither tick alone shows anybody anything.
   */
  shared: boolean
  /** what you have told it, for a goal you move by hand */
  progress: number
  done: boolean
  note: string | null
  sort: number
  /**
   * What the record should count towards this goal — one activity, or one category, or neither.
   *
   * ⚠️ NEITHER IS THE NORMAL CASE and must stay cheap: every goal that existed before step 3 has
   * both of these null and goes on being moved by hand. A source is an upgrade to a goal, not the
   * shape of one.
   *
   * ⚠️ AND AT MOST ONE OF THEM, enforced by a check constraint rather than by a rule up here. A
   * goal counting an activity AND a category would need a story about which wins, and a story
   * nobody can see is a number nobody can explain.
   */
  activity: string | null
  cat: 'locked' | 'free' | 'life' | null
  /**
   * Which of the two things a derived goal counts.
   *
   * ⚠️ WITHOUT THIS A SOURCE COULD ONLY EVER MEAN MINUTES, so "100 pages this month" was
   * unsayable while "100 minutes" was. Counting an amount needs ONE activity rather than a
   * category — a category's activities have different metrics, and adding pages to reps to miles
   * gives a number with no unit — which the table refuses and the save function corrects.
   */
  counts: 'minutes' | 'amount'
  /**
   * How long you think it will take, in minutes — or null for "no idea".
   *
   * ⚠️ MINUTES, LIKE EVERYTHING ELSE HERE: the tallies, the targets, a routine's steps and a
   * plan's span are all minutes, and an estimate in its own unit would be the one number on
   * screen that had to be converted before it could be compared with any of them.
   *
   * ⚠️ AND NULL IS A REAL ANSWER, not a missing one. Most things worth writing down are written
   * down before anybody knows how long they take, so a guess is optional — which is exactly why
   * `weight` below has to report how many it could not count.
   */
  est: number | null
  /**
   * 0 normal, 1 important, 2 urgent — and it is the ORDER, not a decoration.
   *
   * ⚠️ IT DOES NOT COMPETE WITH `sort`. `sort` has been the server's order key since the table
   * existed and the room never set it, so every row is 0 and the list has really been ordered by
   * creation all along. That left priority free to become the first key of ONE ordering, with sort
   * and created_at behind it, rather than a second opinion about where a row belongs.
   */
  priority: 0 | 1 | 2
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

/** Whether the record answers for this goal, rather than you doing. */
export const derived = (g: Goal): boolean => !!g.activity || !!g.cat

/**
 * What the number on a goal counts, when the box was left empty.
 *
 * ⚠️ A TARGET ALWAYS CARRIES A UNIT, or the number means nothing in six months. That part was
 * always right; the DEFAULT was not. Everything fell back to "done", so pointing a goal at an
 * activity and asking for 30 minutes produced **"60 / 30 done"** — a row whose number counts
 * minutes and whose word says something else. The room's own seeded goals read "35 / 30 minutes",
 * which is what it should have been saying all along.
 *
 * ⚠️ THE ROOM USUALLY KNOWS THE UNIT, SO IT SHOULD NOT ASK. A derived goal counting time is
 * counting MINUTES; one counting an amount is counting the activity's own metric — the word
 * already typed against it, "pages" or "reps". Only a goal you move by hand has a number nobody
 * can name, and "done" is the honest fallback for exactly that one.
 *
 * ⚠️ A TYPED WORD STILL WINS, always. This fills an empty box; it does not correct anybody.
 * Somebody counting an activity's minutes who calls them "pomodoros" means pomodoros.
 */
export function unitFor(
  typed: string,
  of: {
    counts: 'minutes' | 'amount'
    /** the goal's source activity, already resolved — null for a category or for neither */
    activity?: Activity | null
    cat?: 'locked' | 'free' | 'life' | null
  },
): string {
  const said = typed.trim()
  if (said) return said
  /* an amount is only sayable against one activity, and only if that activity named its metric */
  if (of.activity && of.counts === 'amount') return of.activity.metric?.trim() || 'done'
  if (of.activity || of.cat) return 'minutes'
  return 'done'
}

/**
 * Where a tally answer about one goal over one window is filed.
 *
 * ⚠️ THE WINDOW IS PART OF THE KEY, AND LEAVING IT OUT WAS A BUG FOR AS LONG AS REPEATING GOALS
 * EXISTED. A repeating goal is asked about more than one window on a single load — the window
 * strip has to count what is unfinished in Today AND in Tomorrow, which for "30 minutes drawing"
 * are two different numbers about one row. Keyed by goal id alone they both answer to `got[id]`,
 * `jsonb_object_agg` keeps the LAST of a duplicate key, and tomorrow's empty window — zero, every
 * time, because tomorrow has not happened — overwrote the real reading. Every repeating derived
 * goal on the site read 0 / 30 with the minutes sitting in the day's totals two inches above it.
 *
 * ⚠️ IT IS THE SAME MISTAKE THE SERVER'S OWN TALLY HAD, found the day before this one and fixed
 * one layer down: `chronicle_tally` grew per-ask keys so a streak could ask about thirty windows.
 * The caller that had been colliding all along was not looked at, because the room it renders in
 * cannot be seen without a session — which is what dev/chroniclePreview.ts now exists for. The
 * fix below is the same shape: say which window you are asking about, and read back the answer to
 * that question rather than to the goal.
 */
export const windowKey = (id: string, fromISO: string): string => `${id}@${fromISO}`

/** The key `tallyAsks` files this goal's answer under, looked at from this day. */
export function tallyKey(g: Goal, on: string): string | null {
  const w = goalWindow(g, on)
  return w ? windowKey(g.id, dayStartISO(w.from)) : null
}

/**
 * How much has actually been done — the one place that decides WHICH number counts.
 *
 * ⚠️ IT IS ONE FUNCTION BECAUSE IT WAS NEARLY THREE. `share`, `finished` and the room's own
 * readout each need "how far along is this", and a derived goal takes that from the tally while a
 * hand-moved one takes it from its own column. Three places asking that question is three chances
 * for a bar, a tick and a number to disagree about the same goal on the same screen.
 *
 * ⚠️ A MISSING TALLY IS ZERO, NOT THE STORED PROGRESS. A derived goal's `progress` column is
 * never written — the server does not touch it and the room offers no way to — so falling back to
 * it would show a stale or empty number as though it were a reading. Zero while the tally loads
 * is honest; the stored value would be a lie with a plausible shape.
 *
 * ⚠️ AND `on` IS REQUIRED RATHER THAN DEFAULTING TO TODAY. "How far along is this" has no answer
 * without a day: a daily goal is 35 of 30 today and 0 of 30 tomorrow, about the same row. A
 * default would have let the Tomorrow view keep asking the question it cannot name and keep
 * getting a number with a plausible shape — see windowKey, which is about exactly that. There
 * are four callers and every one of them already has the day in hand.
 */
export function reached(g: Goal, tally: Record<string, number> | undefined, on: string): number {
  if (!derived(g)) return g.progress
  const k = tallyKey(g, on)
  return (k ? tally?.[k] : undefined) ?? 0
}

/**
 * How far along a goal is, 0 to 1 — or null when there is nothing to measure.
 *
 * ⚠️ A TICK-BOX HAS NO FRACTION. A goal with no target is done or it is not, and reporting it as
 * 0% or 100% would invite a progress bar onto something that has no middle. Null is the honest
 * answer and the caller draws a box instead of a bar.
 */
export function share(
  g: Goal,
  tally: Record<string, number> | undefined,
  on: string,
): number | null {
  if (g.target == null || !(g.target > 0)) return null
  return Math.max(0, Math.min(1, reached(g, tally, on) / g.target))
}

/** Whether a goal counts as finished, by either of the two ways it can be. */
export const finished = (
  g: Goal,
  tally: Record<string, number> | undefined,
  on: string,
): boolean => {
  if (g.done) return true
  const s = share(g, tally, on)
  return s != null && s >= 1
}

/**
 * What to ask the server for, for the goals on screen.
 *
 * ⚠️ THE WINDOWS ARE WORKED OUT HERE AND SENT, which is the whole reason this function exists.
 * Postgres's `date_trunc('week', …)` starts a week on MONDAY and this site starts it on Sunday —
 * so a tally that computed its own windows would disagree with the view above it for one day in
 * seven, forever. The server is given ranges and does arithmetic it cannot have an opinion about.
 */
export function tallyAsks(
  goals: Goal[],
  on: string,
): Array<{ key: string; id: string; from: string; to: string }> {
  const out: Array<{ key: string; id: string; from: string; to: string }> = []
  for (const g of goals) {
    if (!derived(g)) continue
    const w = goalWindow(g, on)
    /* ⚠️ a lifetime goal has no window, so a source on one has nothing to add up over. It is
       allowed to exist — it just counts by hand, like it did before. */
    if (!w) continue
    const from = dayStartISO(w.from)
    /* ⚠️ a key per WINDOW, not per goal — see windowKey, and the bug it is named after */
    out.push({ key: windowKey(g.id, from), id: g.id, from, to: dayStartISO(w.to) })
  }
  return out
}

/* ⚠️ borrowed rather than written again — see localMidnight, which says why there is one of it */
const dayStartISO = (iso: string): string => localMidnight(iso).toISOString()

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

/**
 * How many windows back a streak looks.
 *
 * ⚠️ THIRTY, WHICH IS A MONTH OF DAYS AND HALF A YEAR OF WEEKS. A streak needs a run of windows
 * asked for at once, and the server caps the batch — so this is the number that decides both how
 * long a run can be reported and how much work a page load does. Thirty days is long enough that
 * nobody's daily streak is silently truncated in the first month, and if one is, the number stops
 * being a motivator and becomes a lie.
 */
export const STREAK_BACK = 30

/** the same window, n of its own size earlier */
function windowBack(scope: Scope, on: string, n: number): Window | null {
  if (scope === 'life') return null
  const w = windowOf(scope, on)
  if (!w || n <= 0) return w
  const d = dayOf(w.from)
  /* ⚠️ calendar steps, not multiples of days: a month back from 31 March is not 31 days, and a
     year back across a leap day is not 365. setMonth and setDate are the only arithmetic that
     knows that. */
  if (scope === 'day') d.setDate(d.getDate() - n)
  else if (scope === 'week') d.setDate(d.getDate() - 7 * n)
  else if (scope === 'month') d.setMonth(d.getMonth() - n)
  else if (scope === 'quarter') d.setMonth(d.getMonth() - 3 * n)
  else d.setFullYear(d.getFullYear() - n)
  return windowOf(scope, localISO(d))
}

/** What a window still asks of you: how many things, and how long they are guessed to take. */
export type Weight = {
  /** unfinished goals in this window */
  left: number
  /** the sum of the estimates among them, in minutes */
  mins: number
  /** how many of them carry no estimate at all */
  vague: number
}

/**
 * How much is left in a window, and how much of that is actually known.
 *
 * ⚠️ `mins` IS A FLOOR, AND `vague` IS WHY. An estimate is optional, so summing the ones that
 * exist and showing the total as "the day's work" understates it by however many were never
 * guessed — and it understates it silently, which is worse, because the number looks complete.
 * Five things of which two are guessed at twenty minutes each is not a forty-minute day. The
 * caller gets both numbers and has to say both; there is deliberately no single figure to show.
 *
 * ⚠️ AND IT COUNTS THE UNFINISHED ONLY, through `finished`, which is the same question the window
 * strip asks. A weight that included things already done would go up as the day went well.
 */
export function weight(
  goals: Goal[],
  tally: Record<string, number> | undefined,
  scope: Scope,
  on: string,
): Weight {
  let left = 0
  let mins = 0
  let vague = 0
  for (const g of goals) {
    if (!inScope(g, scope, on) || finished(g, tally, on)) continue
    left++
    if (g.est != null && g.est > 0) mins += g.est
    else vague++
  }
  return { left, mins, vague }
}

/** A stretch of real time, as instants — what a comparison is actually made over. */
export type Stretch = { fromMs: number; toMs: number }

/**
 * This window so far, and THE SAME STRETCH of the window before it.
 *
 * ⚠️ THE SAME STRETCH, NOT THE WHOLE PREVIOUS WINDOW, and that is the entire point of this
 * function. On Tuesday morning "this week" is a day and a half and last week was seven days, so
 * "4h less than last week" is arithmetically true and completely misleading — it compares a
 * fragment with a finished thing and reports the calendar as a collapse in effort. Every morning
 * would open with bad news. The honest comparison is this week SO FAR against the same number of
 * hours into last week, which is what somebody means when they ask.
 *
 * ⚠️ AND THE EARLIER RANGE IS CLAMPED TO ITS OWN WINDOW. If the elapsed stretch ever exceeded the
 * window's length the "before" range would run past the previous window's end and into the
 * current one, so a week would partly compare against itself.
 *
 * `part` says the current window is still running, so the caller can say "so far" rather than
 * presenting a fragment as a finished total.
 */
export function likeForLike(
  scope: Scope,
  on: string,
  nowMs: number,
): { now: Stretch; before: Stretch; part: boolean } | null {
  if (scope === 'life') return null
  const w = windowOf(scope, on)
  const p = windowBack(scope, on, 1)
  if (!w || !p) return null
  const fromMs = localMidnight(w.from).getTime()
  const toMs = localMidnight(w.to).getTime()
  const pFrom = localMidnight(p.from).getTime()
  const pTo = localMidnight(p.to).getTime()
  /* how much of the window on screen has actually happened — the whole of it for a past window */
  const elapsed = Math.max(0, Math.min(nowMs, toMs) - fromMs)
  const part = nowMs > fromMs && nowMs < toMs
  return {
    now: { fromMs, toMs: fromMs + elapsed },
    before: { fromMs: pFrom, toMs: Math.min(pTo, pFrom + elapsed) },
    part,
  }
}

/** the key a streak ask uses, so one goal can be asked about many windows */
export const streakKey = (id: string, back: number): string => `${id}|${back}`

/**
 * What to ask for, to work out the streaks of every repeating goal on the books.
 *
 * ⚠️ ONLY REPEATING GOALS WITH A SOURCE. A one-off has no run of windows to have a streak over,
 * and a hand-moved goal keeps its progress in a single column — there is no per-window history to
 * count, so a streak would be invented rather than measured.
 */
export function streakAsks(
  goals: Goal[],
  on: string,
  back = STREAK_BACK,
): Array<{ key: string; id: string; from: string; to: string }> {
  const out: Array<{ key: string; id: string; from: string; to: string }> = []
  for (const g of goals) {
    if (!repeats(g) || !derived(g) || g.target == null) continue
    for (let i = 0; i <= back; i++) {
      const w = windowBack(g.scope, on, i)
      if (!w) break
      out.push({
        key: streakKey(g.id, i),
        id: g.id,
        from: dayStartISO(w.from),
        to: dayStartISO(w.to),
      })
    }
  }
  return out
}

/**
 * How many windows in a row this goal has been met.
 *
 * ⚠️ THE WINDOW YOU ARE IN DOES NOT BREAK IT. A five day streak at nine in the morning on the
 * sixth day is still five — today is not a failure, it is unfinished. So the run is counted from
 * the last COMPLETED window, and today adds one if it has already been met. Counting today as a
 * miss would mean every streak read zero every morning, which is the opposite of the thing a
 * streak is for.
 */
/**
 * How each of the last windows went: one mark per window, oldest first.
 *
 * ⚠️ IT COSTS NOTHING, which is the whole reason it exists. `streakAsks` already fetches thirty-one
 * windows for every repeating goal and `streakOf` throws all but the run away — the room was
 * paying for a month of history and showing a single number. These are the same answers, read
 * instead of discarded.
 *
 * ⚠️ AND TODAY IS ITS OWN KIND OF MARK. The window you are in is not a miss, it is unfinished —
 * the same rule `streakOf` is built on, where a five-day run at nine in the morning is still five.
 * Drawing today as a gap would make every morning look like a broken streak.
 */
export type Mark = 'met' | 'missed' | 'now'

export function marksOf(g: Goal, got: Record<string, number>, back = STREAK_BACK): Mark[] {
  if (!repeats(g) || !derived(g) || g.target == null || !(g.target > 0)) return []
  const out: Mark[] = []
  /* oldest first, so the row reads left to right the way a calendar does and the streak is the
     run on its right-hand end */
  for (let i = back; i >= 0; i--) {
    const had = got[streakKey(g.id, i)]
    if (i === 0 && !(had != null && had >= g.target)) out.push('now')
    else out.push(had != null && had >= g.target ? 'met' : 'missed')
  }
  return out
}

export function streakOf(g: Goal, got: Record<string, number>, back = STREAK_BACK): number {
  if (!repeats(g) || !derived(g) || g.target == null || !(g.target > 0)) return 0
  const met = (i: number) => (got[streakKey(g.id, i)] ?? 0) >= g.target!
  let run = met(0) ? 1 : 0
  for (let i = 1; i <= back; i++) {
    if (!met(i)) break
    run++
  }
  return run
}
