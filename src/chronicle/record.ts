/**
 * The record — what you actually did, as opposed to what you meant to.
 *
 * Step 2 of docs/2026-10-12-chronicle-design.md. An entry is a span of time against an activity,
 * and the running timer IS an entry with no end — which is what lets it survive a closed tab and
 * turn up on a phone. The database enforces one open entry per person with a partial unique index,
 * so "what am I doing right now" has exactly one answer rather than a most-likely one.
 *
 * ⚠️ EVERYTHING HERE IS PURE, AND THAT IS THE POINT. The hard part of a time tracker is not the
 * timer, it is the arithmetic of attributing a span to a day — and a span can begin yesterday,
 * cross midnight, and still be running. That question has an exact answer, so it is asked here
 * where it can be tested, rather than in a component where it can only be eyeballed.
 */

/** A span against an activity. `end` null is the timer that is still going. */
export type Entry = {
  id: string
  activity: string
  /** ISO instants, as the server sends them */
  start: string
  end: string | null
  note: string | null
  /**
   * How much of the activity's metric this session produced, or null.
   *
   * ⚠️ AN AMOUNT DOES NOT SPLIT ACROSS MIDNIGHT, which is the one place it behaves unlike the
   * minutes beside it. A session from 23:00 to 01:00 gives an hour to each day because time
   * genuinely elapsed in both; five pages written across midnight are not two and a half pages
   * each side. The quantity belongs to the session, so it counts against the day the session
   * STARTED — see chronicle_sum, where the two window rules sit side by side.
   */
  amount: number | null
}

export type Activity = {
  id: string
  name: string
  cat: 'locked' | 'free' | 'life'
  colour: string | null
  archived: boolean
  /**
   * Written by the site rather than by you — one per room, see useVisits.
   *
   * ⚠️ IT IS SHOWN, NOT HIDDEN. "Paint 4h" meaning the room was open is a different claim from
   * having painted for four hours, and reading a week back is exactly when the difference matters.
   * Otherwise these are ordinary activities: editable, categorisable, archivable, and countable
   * towards a goal like any other.
   */
  auto: boolean
  /**
   * A thing to count besides time — "pages", "reps", "miles".
   *
   * ⚠️ TIME IS THE ONLY UNIVERSAL MEASURE AND A POOR ONE for anything whose point is a quantity.
   * Half an hour of writing is not the achievement; four pages is. The HTML app had this as
   * metricLabel on an activity and metricValues on an entry, and it is the one thing an activity
   * can carry that changes what a goal is allowed to count.
   */
  metric: string | null
}

/**
 * The three categories, in the order the room shows them.
 *
 * ⚠️ THESE ARE THE WORDS THE HTML APP USED, which is the only reason they are the right words.
 * The first version of this list said "Committed / Yours / Upkeep" — my invention, and reported
 * exactly as you would expect: "i dont understand the choices". The app being rebuilt has said
 * `Locked In`, `Free Time` and `Life` on screen for its whole life, in a picker, in a filter row
 * and in the day's totals. Somebody who has used it knows what they mean, and no amount of my
 * being pleased with a synonym is worth making them learn it twice.
 *
 * The stored values are unchanged — `locked`, `free`, `life` — so this was only ever a label.
 */
export const CATS = [
  ['locked', 'Locked In'],
  ['free', 'Free Time'],
  ['life', 'Life'],
] as const

/**
 * How much of an entry falls inside a window, in milliseconds.
 *
 * ⚠️ THE OVERLAP, NOT THE WHOLE SPAN, and this is the one piece of arithmetic the rest of the
 * module is built on. A session from 23:00 to 01:00 is two hours long and belongs to two days —
 * one hour each. Attributing it to the day it STARTED would make a night's work vanish from
 * tomorrow; attributing it to both in full would count it twice and make eight hours of logging
 * report sixteen. The sum of its overlaps with any set of windows that tile a range is exactly
 * its length inside that range, and the test asserts that rather than any particular hour.
 *
 * ⚠️ AN OPEN ENTRY IS MEASURED TO `nowMs` AND NO FURTHER. A running timer has no end, so its
 * length is "so far" — and the caller passes the clock rather than this reading it, so a test can
 * ask about a running timer without waiting.
 */
/**
 * The two fields anything time-shaped has to have.
 *
 * ⚠️ SO overlapMs TAKES WHAT IT READS, RATHER THAN AN ENTRY. It only ever looks at the two
 * ends, and a PLAN is the same two ends about the future — see chronicle/plan.ts. Widening the
 * parameter is what lets both sides of "planned against actual" be measured by the same
 * function, which is the only reason the two columns cannot disagree about what a span is worth.
 */
export type Span = { start: string; end: string | null }

export function overlapMs(e: Span, fromMs: number, toMs: number, nowMs: number): number {
  const a = Date.parse(e.start)
  if (!Number.isFinite(a)) return 0
  const raw = e.end == null ? nowMs : Date.parse(e.end)
  const b = Number.isFinite(raw) ? raw : nowMs
  /* ⚠️ a backwards span contributes nothing rather than a negative: the table refuses one, so
     this is about a row that arrived from somewhere else being unable to make a total smaller */
  if (b <= a) return 0
  const lo = Math.max(a, fromMs)
  const hi = Math.min(b, toMs)
  return hi > lo ? hi - lo : 0
}

/**
 * A session's quantity, if it belongs to this window — otherwise null.
 *
 * ⚠️ THIS IS WHERE A QUANTITY PARTS COMPANY WITH THE MINUTES BESIDE IT, and the two rules are
 * deliberately next to each other because that is the only way to read them as a pair. Time
 * genuinely elapses in both of the days a session straddles, so `overlapMs` splits it. Five pages
 * written across midnight are not two and a half pages each side — the quantity belongs to the
 * SESSION, so it counts once, against the day the session started.
 *
 * ⚠️ AND THE DAY LIST WAS SHOWING IT TWICE. `chronicle_sum` and `chronicle_totals` have had this
 * rule since the column existed; the entry row in Timer.tsx asked only whether the amount was
 * non-null, so one session of Writing from 23:00 to 00:30 read "1h · 2 pages" on one day and
 * "30m · 2 pages" on the next. The minutes were right both times. Anybody reading two days
 * counted four pages from a session that produced two, and the list disagreed with the totals and
 * with every goal counting that metric. A rule enforced in two places out of three is a rule the
 * third place contradicts.
 */
export function amountIn(e: Entry, fromMs: number, toMs: number): number | null {
  if (e.amount == null) return null
  const s = Date.parse(e.start)
  if (!Number.isFinite(s)) return null
  return s >= fromMs && s < toMs ? e.amount : null
}

/** Minutes per activity id inside a window — what a day's totals are made of. */
export function minutesByActivity(
  entries: Entry[],
  fromMs: number,
  toMs: number,
  nowMs: number,
): Record<string, number> {
  const out: Record<string, number> = {}
  for (const e of entries) {
    const ms = overlapMs(e, fromMs, toMs, nowMs)
    if (ms <= 0) continue
    out[e.activity] = (out[e.activity] ?? 0) + ms / 60_000
  }
  return out
}

/** Minutes per category, which is the reading the three categories exist for. */
export function minutesByCat(
  entries: Entry[],
  acts: Activity[],
  fromMs: number,
  toMs: number,
  nowMs: number,
): Record<string, number> {
  const catOf = new Map(acts.map((a) => [a.id, a.cat]))
  const out: Record<string, number> = {}
  for (const e of entries) {
    const ms = overlapMs(e, fromMs, toMs, nowMs)
    if (ms <= 0) continue
    const c = catOf.get(e.activity) ?? 'free'
    out[c] = (out[c] ?? 0) + ms / 60_000
  }
  return out
}

/**
 * A length of time, as a person would say it.
 *
 * ⚠️ NO LEADING ZERO HOUR AND NO BARE MINUTES OVER AN HOUR. "0h 7m" and "83m" are both things a
 * clock says and neither is what anybody reads out loud. Under a minute says seconds, because a
 * timer that has just started must visibly be running.
 */
export function spanText(ms: number): string {
  if (!(ms > 0)) return '0m'
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  const rest = m % 60
  return rest ? `${h}h ${rest}m` : `${h}h`
}

/** The clock face for a running timer: h:mm:ss, which is the one place seconds belong. */
export function clockText(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = s % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(sec).padStart(2, '0')
  return h ? `${h}:${mm}:${ss}` : `${m}:${ss}`
}

/**
 * Local midnight on a date.
 *
 * ⚠️ BUILT FROM PARTS, NEVER PARSED, and this is the one home for that. `new Date('2026-10-12')`
 * is parsed as UTC midnight — the 11th at 8pm in New York — so a day built that way starts four
 * hours early and a late-evening session is counted against the wrong date. The trap
 * circuit/dates.ts opens with a warning about.
 *
 * ⚠️ AND IT LIVES HERE BECAUSE IT WAS ABOUT TO EXIST THREE TIMES. `dayBounds` below needed it,
 * `tallyAsks` in goal.ts needed it to send a window to the server, and the looking-back panel
 * needed it to ask for one — and I had written it separately in all three before noticing, with a
 * comment in the third saying so rather than fixing it. Three copies of a rule about midnight is
 * how one of them quietly stops agreeing with the others. record.ts is the leaf nothing else in
 * chronicle imports from, so it is the only one of the three that can hold it.
 */
export const localMidnight = (iso: string): Date => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, (m ?? 1) - 1, d ?? 1, 0, 0, 0, 0)
}

/** The local day a window covers, as millisecond bounds — half-open, like every other window. */
export function dayBounds(iso: string): { fromMs: number; toMs: number } {
  const from = localMidnight(iso)
  const to = new Date(from.getFullYear(), from.getMonth(), from.getDate() + 1, 0, 0, 0, 0)
  return { fromMs: from.getTime(), toMs: to.getTime() }
}
