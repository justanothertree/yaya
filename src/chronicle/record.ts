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
  /**
   * How it went, 1 to 5 — the HTML app's `quality`, and null for the vast majority.
   *
   * ⚠️ UNRATED IS THE NORMAL STATE, not a missing value, which is why every reading of this has to
   * say how much time it could not account for. A figure covering a third of the hours, shown
   * without saying so, is a figure that looks complete — the same trap an estimate on a goal sets,
   * and `weight` in goal.ts answers it the same way.
   *
   * ⚠️ AND UNLIKE `amount`, IT DOES SPLIT AT MIDNIGHT. A quantity belongs to the session; a rating
   * is a property OF the minutes, so an hour either side of midnight is an hour of rated time on
   * each day. chronicle_moods sums the overlap for exactly that reason.
   */
  quality: number | null
}

/**
 * The colours an activity may be given, and nothing else.
 *
 * ⚠️ A FIXED SET RATHER THAN A FREE PICKER, which is a deliberate narrowing of something the
 * column would allow. `<input type="color">` can return #000000, and this site has a near-black
 * card AND a light theme — so a free choice can produce a dot nobody can see, on one theme or the
 * other, with no way to tell you have done it. Every colour here is mid-luminance on purpose: each
 * one reads against both.
 *
 * ⚠️ AND IT IS NINE TAPS, NOT A DIALOG. The OS colour picker on a phone is a modal with a spectrum
 * in it, for a decision whose whole value is being quick — see `ui-for-the-non-technical`.
 *
 * ⚠️ THE SERVER DOES NOT ENFORCE THIS LIST, and should not: the column is free text, an imported
 * file may carry any colour somebody's older row had, and refusing it on the way in would lose
 * data to a preference. The room shows whatever it is given and offers these.
 */
export const COLOURS: readonly string[] = [
  '#e5533d',
  '#e08b2f',
  '#d9b320',
  '#4caf50',
  '#3d9ae5',
  '#8b5cf6',
  '#e06ba8',
  '#7a8a99',
]

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
  /**
   * How long a single sitting ought to be, in minutes — or null, which is most of them.
   *
   * ⚠️ THIS IS NOT A GOAL POINTING AT THE ACTIVITY, and the difference is the whole point. A goal
   * counts a WINDOW: thirty minutes of drawing today is met by six five-minute sessions. This
   * counts each SESSION, and six five-minute sessions is the exact thing somebody setting one is
   * trying to stop doing. Same number, opposite question — so it is a column here rather than
   * another row in chronicle_goals.
   */
  session: number | null
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

/**
 * What the server says about a window's minutes, keyed by rating: '1'…'5' and 'none'.
 *
 * ⚠️ RAW, NOT BUCKETED, deliberately. "4 and 5 are good" is a product decision, and a server that
 * returned good/mid/poor would be a second place that rule lived — see `moodOf`, which is the one
 * place it lives and the one place it is tested.
 */
export type Moods = Record<string, number>

/** A window's minutes, divided by how the time went. */
export type Mood = {
  good: number
  fine: number
  rough: number
  unrated: number
  /** good + fine + rough — the time there is actually an opinion about */
  rated: number
}

/**
 * Bucket a window's minutes.
 *
 * ⚠️ EVERY MINUTE LANDS IN EXACTLY ONE BUCKET, and the test asserts that as a property rather than
 * checking particular numbers: good + fine + rough + unrated is the whole window, always. A bucket
 * rule with a gap in it — forgetting that 3 is a rating, or reading 1-2 as 1 only — loses time
 * silently, and silently is how a reading of your own month becomes quietly wrong.
 *
 * ⚠️ AND IT IS MINUTES RATHER THAN AN AVERAGE. Averaging the ratings weights a five-minute session
 * the same as a three-hour one, so an afternoon that went badly is cancelled by two good five
 * minute ones. Time is what was actually spent.
 */
export function moodOf(m: Moods | null | undefined): Mood {
  const at = (k: string) => {
    const v = m?.[k]
    return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0
  }
  const good = at('4') + at('5')
  const fine = at('3')
  const rough = at('1') + at('2')
  return { good, fine, rough, unrated: at('none'), rated: good + fine + rough }
}

/**
 * The word for one rating — the same three the aggregate uses.
 *
 * ⚠️ THE ROW SAYS THE BUCKET AND THE EDITOR HOLDS THE NUMBER. Five words in a log row is a legend
 * somebody has to learn; three is a thing you can read. The precision is not lost, it is just kept
 * where it is being set rather than where it is being skimmed.
 */
export const moodWord = (q: number | null): string | null =>
  q == null ? null : q >= 4 ? 'good' : q === 3 ? 'fine' : 'rough'

/** the five, for the picker — numbers with the word they fall under */
export const MOODS = [
  [1, 'rough'],
  [2, 'poor'],
  [3, 'fine'],
  [4, 'good'],
  [5, 'flying'],
] as const

/**
 * Did this sitting reach the length its activity asks for?
 *
 * `null` means there is nothing to say — either the activity has no target, or the session is
 * still going and has not got there YET.
 *
 * ⚠️ A RUNNING SESSION IS NEVER SHORT. Five minutes into a thirty-minute target you have not
 * failed, you are five minutes in — and marking it short while it runs would put a reproach on
 * screen for the entire first half of every sitting, which is the opposite of what a target like
 * this is for. It turns true the moment you pass the line and never turns false until you stop.
 *
 * ⚠️ AND IT IS THE WHOLE SPAN, NOT THE OVERLAP WITH THE DAY YOU ARE LOOKING AT. A session's LENGTH
 * belongs to the session, the same way its `amount` does — so a sitting from 23:00 to 00:30 is an
 * hour and a half of work seen from either day. Judging it by the overlap would call it short on
 * the morning side and not on the evening side: the same sitting, two verdicts, depending on which
 * day you happened to open.
 */
export function metSession(e: Span, target: number | null, nowMs: number): boolean | null {
  if (target == null || !(target > 0)) return null
  /* an unbounded window, so a running session measures to the clock and a backwards one to zero */
  const mins = overlapMs(e, -Infinity, Infinity, nowMs) / 60_000
  if (mins >= target) return true
  return e.end == null ? null : false
}

/**
 * How far through its intended length a running sitting is.
 *
 * ⚠️ THE TARGET ONLY EVER SPOKE AFTERWARDS. `session_mins` has existed since the sitting-length
 * work, and `metSession` reads it to mark a finished session SHORT — so the room could tell you
 * that you stopped early, and never that you were about to. That is the wrong half: "you failed"
 * is a verdict, "seven minutes left" is a reason to keep going.
 *
 * ⚠️ AND IT IS THE HALF OF THE HTML APP'S `DURATION` FIELD WORTH HAVING. That form takes a length
 * when you press Start; this room already knows one, per activity, set once instead of typed every
 * time. The thing it was missing was not the number — it was showing it while it matters.
 *
 * ⚠️ `pct` IS CLAMPED AND `over` IS NOT. A bar past its own end is a rendering fault; a sitting
 * past its target is an ordinary and good thing, and the two must not be the same number.
 */
export function sitting(
  elapsedMins: number,
  target: number | null,
): { pct: number; over: boolean; left: number } | null {
  if (target == null || !(target > 0)) return null
  const done = Math.max(0, elapsedMins)
  return {
    pct: Math.min(100, (done / target) * 100),
    over: done >= target,
    left: Math.max(0, target - done),
  }
}

/**
 * How long nothing has been recorded, and what the last thing was.
 *
 * ⚠️ IT IS THE ONE FACT A TIME TRACKER CAN OFFER THAT A CLOCK CANNOT. "Timer stopped" is something
 * you can see — the Start button is right there. The useful half is the hole: that it is nine in
 * the evening and nothing has been written down since lunch. That is the number `⏱ Fill a gap`
 * exists to close, and the room never said it.
 *
 * ⚠️ NULL WHILE SOMETHING IS RUNNING, because there is no gap — you are in the middle of the
 * thing. Null also when nothing has finished yet, since "it has been 20 hours" counted from a
 * midnight nobody was awake for is a true number nobody wants.
 */
export function gapSince(
  spans: Array<Span & { activity: string }>,
  nowMs: number,
): { ms: number; activity: string } | null {
  let last: (Span & { activity: string }) | null = null
  for (const s of spans) {
    if (s.end == null) return null
    const ended = Date.parse(s.end)
    if (!Number.isFinite(ended) || ended > nowMs) continue
    if (!last || ended > Date.parse(last.end!)) last = s
  }
  if (!last) return null
  return { ms: nowMs - Date.parse(last.end!), activity: last.activity }
}

/** Where one span sits on a day, as percentages of that day's width. */
export type Block = { activity: string; left: number; width: number; cut: boolean }

/**
 * A day laid out as a strip: one block per span, positioned across the window.
 *
 * ⚠️ IT COSTS NOTHING, like the streak marks. The day's entries are already in hand with their
 * exact ends — the log draws them as a column of LENGTHS and throws the placement away, so the
 * one thing the record cannot currently tell you is the SHAPE of a day: that the morning was
 * solid and the afternoon went somewhere else. Same spans, read instead of discarded.
 *
 * ⚠️ AND THE WIDTH IS `overlapMs`, NOT A SECOND SUBTRACTION. Only the left edge is new arithmetic
 * here; the length of every block is the same function the totals, the goals and the day's
 * categories all use. A strip that disagreed with the minutes printed beside it would be two
 * answers to one question — and the test asserts that pairing rather than any particular pixel.
 *
 * ⚠️ `cut` SAYS THE SPAN RUNS PAST THIS DAY, which a clipped block cannot say by itself: a
 * session from 23:00 to 01:00 is a block hard against the right edge on one day and against the
 * left on the next, and without the flag both look like sessions that happened to end at midnight.
 */
export function lane(
  spans: Array<Span & { activity: string }>,
  fromMs: number,
  toMs: number,
  nowMs: number,
): Block[] {
  const width = toMs - fromMs
  if (!(width > 0)) return []
  const out: Block[] = []
  for (const s of spans) {
    const ms = overlapMs(s, fromMs, toMs, nowMs)
    if (ms <= 0) continue
    const began = Date.parse(s.start)
    const ended = s.end == null ? nowMs : Date.parse(s.end)
    const lo = Math.max(began, fromMs)
    out.push({
      activity: s.activity,
      left: ((lo - fromMs) / width) * 100,
      width: (ms / width) * 100,
      cut: began < fromMs || (Number.isFinite(ended) ? ended : nowMs) > toMs,
    })
  }
  return out
}

/**
 * How far through the window the clock is, 0 to 100 — or null when it is not inside it.
 *
 * ⚠️ NULL RATHER THAN 0 OR 100 FOR A DAY THAT IS NOT TODAY. A marker pinned to one end of every
 * past day reads as a thing that happened at midnight, and on a future day it would claim the day
 * had already started.
 */
export function nowAt(fromMs: number, toMs: number, nowMs: number): number | null {
  if (!(toMs > fromMs)) return null
  if (nowMs < fromMs || nowMs > toMs) return null
  return ((nowMs - fromMs) / (toMs - fromMs)) * 100
}
