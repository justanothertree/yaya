import { overlapMs, type Span } from './record'

/**
 * Intention against record — what you meant a day to be, beside what it was.
 *
 * ⚠️ THIS IS THE HALF OF "LOOKING AHEAD" THE HORIZONS DO NOT COVER, and it is the HTML app's
 * `planned` store. A goal says what you are aiming at over a window — thirty minutes of drawing a
 * day, twenty pages a month. A plan says where in tomorrow the drawing goes. They are different
 * questions and both get asked: one is the target, the other is the appointment.
 *
 * ⚠️ AND A PLAN IS NEVER WORK DONE. Nothing here can add to a tally, a total or a goal; that is
 * enforced one layer down by `chronicle_plans` being its own table rather than a flag on
 * `chronicle_entries` — see the migration, which says why. The comparison below is the only place
 * the two numbers meet, and it keeps them in separate columns.
 */

/** A span you intend to spend. The server's shape, same keys as an entry minus the amount. */
export type Plan = {
  id: string
  activity: string
  /** ISO instants, as the server sends them */
  start: string
  end: string | null
  note: string | null
}

/**
 * A planned span, as short as it can be said.
 *
 * ⚠️ THE MERIDIEM ONCE, NOT TWICE — WITHIN ONE DAY. "7:00 AM–7:45 AM" is 112px of a 302px row
 * before the activity or any of its three buttons get a say, and it overflowed the list by 45px.
 * A plan row cannot answer that by hiding its time the way a log entry does, because for a plan
 * the time IS the content, so saying "AM" once was the cheapest 27px in the row.
 *
 * ⚠️ AND NEVER ACROSS TWO. `chronicle_plans` allows a span of a full day, so 11:00 AM to 10:00 AM
 * is legal — and collapsing that reads "11:00–10:00 AM", one morning running backwards. When an
 * end falls outside the day being read, the weekday is named there instead and nothing is
 * collapsed: see `straddles`, which answers which ends those are.
 *
 * ⚠️ IT TAKES THE WORDS AS ARGUMENTS so it can be asked a question. `toLocaleTimeString` answers
 * differently per locale and per machine, and a rule about COLLAPSING is not a rule about what a
 * clock face says — so the caller formats and this decides.
 */
export function saySpan(
  from: string,
  to: string,
  out: { before: boolean; after: boolean } = { before: false, after: false },
  dayOf: (which: 'from' | 'to') => string = () => '',
): string {
  if (out.before || out.after) {
    return (out.before ? dayOf('from') : '') + from + '–' + (out.after ? dayOf('to') : '') + to
  }
  /* the trailing run of LETTERS, which is the meridiem where there is one and nothing at all in a
     24-hour locale. Asking for letters rather than excluding separators is the point: Chrome puts
     a narrow no-break space before AM/PM, and a class that had to exclude that character either
     carries it literally — an eslint error, and invisible in a diff — or in an escape. */
  const tail = to.match(/\p{L}+$/u)?.[0]
  return tail && from.endsWith(tail)
    ? from.slice(0, -tail.length).trim() + '–' + to
    : from + '–' + to
}

/** One activity's day: how much was meant, how much happened. */
export type Against = {
  activity: string
  planned: number
  did: number
}

/**
 * Planned and actual minutes per activity over a window.
 *
 * ⚠️ ONE ROW PER ACTIVITY APPEARING IN EITHER LIST, which is the whole claim. There are two ways a
 * day misses its plan and they are opposite: something planned and not done, and something done
 * that was never planned. A readout built by walking the PLANS — the obvious way to write this —
 * can only ever show the first, so an afternoon that vanished into something else would come back
 * reporting a day that went exactly as intended. Both kinds of miss, or it is not a comparison.
 *
 * ⚠️ AND IT BORROWS `overlapMs` FOR BOTH SIDES. A plan from 23:00 to 01:00 belongs to two days an
 * hour each, exactly as the session would — so the two columns cannot disagree about what a span
 * is worth over a window, because they are the same arithmetic asked twice.
 *
 * ⚠️ A PLAN IN THE FUTURE STILL COUNTS AS PLANNED. Three hours blocked out for this evening read
 * `planned 3h · did 0` at breakfast, and that is a forecast rather than a failure — the caller
 * knows whether the day is over and this does not need to guess.
 */
export function against(
  plans: Plan[],
  entries: Array<Span & { activity: string }>,
  fromMs: number,
  toMs: number,
  nowMs: number,
): Against[] {
  const rows = new Map<string, Against>()
  const row = (activity: string): Against => {
    const had = rows.get(activity)
    if (had) return had
    const made = { activity, planned: 0, did: 0 }
    rows.set(activity, made)
    return made
  }
  for (const p of plans) {
    const ms = overlapMs(p, fromMs, toMs, nowMs)
    if (ms > 0) row(p.activity).planned += ms / 60_000
  }
  for (const e of entries) {
    const ms = overlapMs(e, fromMs, toMs, nowMs)
    if (ms > 0) row(e.activity).did += ms / 60_000
  }
  /* most-planned first, then most-done — so the day reads as "what was it for" rather than as
     whichever order the two queries happened to come back in */
  return [...rows.values()].sort((a, b) => b.planned - a.planned || b.did - a.did)
}

/** What a window was meant to hold and what it held, in minutes. */
export function dayAgainst(
  plans: Plan[],
  entries: Array<Span & { activity: string }>,
  fromMs: number,
  toMs: number,
  nowMs: number,
): { planned: number; did: number } {
  const all = against(plans, entries, fromMs, toMs, nowMs)
  return {
    planned: all.reduce((n, r) => n + r.planned, 0),
    did: all.reduce((n, r) => n + r.did, 0),
  }
}

/**
 * Where a new plan should start and end, for the day on screen.
 *
 * ⚠️ THE NEXT FREE HOUR RATHER THAN A BLANK PAIR OF FIELDS, which is the same lesson Fill a gap
 * taught: two datetimes typed from scratch on a phone is the reason a feature goes unused. The
 * rule is one sentence — after the last thing already planned for that day, or the next whole hour
 * if nothing is, and an hour long.
 *
 * ⚠️ AND IT CANNOT RUN PAST THE DAY IT IS ON. A plan starting at 23:30 would otherwise default to
 * ending inside tomorrow, which the day it was added from would then only half show.
 */
export function planOpens(
  plans: Plan[],
  fromMs: number,
  toMs: number,
  nowMs: number,
): { fromMs: number; toMs: number } {
  const HOUR = 3_600_000
  const ends = plans
    .map((p) => (p.end == null ? NaN : Date.parse(p.end)))
    .filter((t) => Number.isFinite(t) && t > fromMs && t < toMs)
  const nextHour = Math.ceil(nowMs / HOUR) * HOUR
  const onToday = nowMs >= fromMs && nowMs < toMs
  const after = ends.length ? Math.max(...ends) : null
  const start = Math.max(
    fromMs,
    Math.min(after ?? (onToday ? nextHour : fromMs + 9 * HOUR), toMs - HOUR),
  )
  return { fromMs: start, toMs: Math.min(toMs, start + HOUR) }
}
