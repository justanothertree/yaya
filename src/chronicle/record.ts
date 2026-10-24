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
   * The journal: everything you have written about this sitting, oldest first.
   *
   * ⚠️ IT REPLACES `note` AND `note` IS STILL HERE. One text column meant a session you wanted to
   * say three things about got one, and saying the third meant rewriting the first two — "instead
   * of just a single note id want to be able to journal multiple things into an activity". The
   * notes live in `chronicle_notes` now and the column is frozen where it stood: unread by this
   * app, intact as a rollback, still carried by export and import so no backup loses anything.
   * See docs/2026-10-23-chronicle-notes.sql.
   */
  notes: Note[]
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
   * Whether friends may see this activity's sittings on their timeline. False for everything
   * until its owner says otherwise.
   *
   * ⚠️ THE ACTIVITY IS THE SHARING UNIT, NOT THE SITTING, and that is the decision this column
   * exists to make cheap. A sitting is created by pressing a button and nobody will tick a box
   * each time; an activity is a named thing you already curate. So "friends can see my Gym" is
   * one decision that holds for every Gym sitting there will ever be — and "and they never learn
   * Therapy exists" is the same decision, left alone.
   *
   * ⚠️ IT IS ONE OF THREE SWITCHES and shows nothing by itself. The chronicle block on the
   * profile must exist and must ask for a timeline, and the viewer must be a friend. See
   * docs/2026-10-23-chronicle-friends-timeline.sql.
   */
  shared: boolean
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
/**
 * ⚠️ THE FIRST OF EACH PAIR IS A CONTRACT WITH STORED DATA, not a label. `locked`, `free` and
 * `life` are what sits in `chronicle_activities.cat` for every row anybody has ever written, what
 * `chronicle_goals.cat` points at, and what `chronicle_sum(p_cat)` and `chronicle_totals` filter
 * on.
 *
 * ⚠️ AND THE SERVER ALREADY REFUSES A FOURTH WORD — `chronicle_activities_cat_check` and
 * `chronicle_goal_cat_known` both spell the three out. So a rename is not the silent-mismatch trap
 * it looks like; it is an exception the first time anybody saves an activity. (That was worth
 * checking rather than assuming: the sibling note in §4 of CLAUDE.md is about `profile_blocks
 * .block_type`, which has NO constraint, and the habit of expecting that here would have been
 * wrong.)
 *
 * What `satisfies` buys, then, is WHEN it fails rather than whether: at the keyboard, naming the
 * three it must be one of, instead of in front of somebody trying to rename an activity. It is
 * also a contract the type system can hold for free, where a test would be a second copy of the
 * list to keep level — the thing §11 of the standard exists to avoid. The labels stay free to be
 * re-worded, which is the half that is allowed to change.
 */
export const CATS = [
  ['locked', 'Locked In'],
  ['free', 'Free Time'],
  ['life', 'Life'],
] as const satisfies ReadonlyArray<readonly [Activity['cat'], string]>

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
/** one thing written about a sitting, at the moment it was written */
export type Note = { id: string; at: string; body: string }

export type Span = { start: string; end: string | null }

/**
 * The stretch a span occupies inside a window, clipped to it — or null when it does not reach.
 *
 * ⚠️ IT EXISTS SO THE SUM AND THE UNION CANNOT DISAGREE. `overlapMs` asks how LONG a span is in
 * here and `coveredMs` asks WHERE it is, and those were two copies of the same five lines — the
 * midnight rule, the open-entry rule, the backwards-span rule and the two clamps. Three callers of
 * one function beats three copies of one subtraction, which is the same argument `lane` is built
 * on; here it is stronger, because the two answers are compared against each other in a test.
 */
function clip(e: Span, fromMs: number, toMs: number, nowMs: number): [number, number] | null {
  const a = Date.parse(e.start)
  if (!Number.isFinite(a)) return null
  const raw = e.end == null ? nowMs : Date.parse(e.end)
  const b = Number.isFinite(raw) ? raw : nowMs
  /* ⚠️ a backwards span contributes nothing rather than a negative: the table refuses one, so
     this is about a row that arrived from somewhere else being unable to make a total smaller */
  if (b <= a) return null
  const lo = Math.max(a, fromMs)
  const hi = Math.min(b, toMs)
  return hi > lo ? [lo, hi] : null
}

export function overlapMs(e: Span, fromMs: number, toMs: number, nowMs: number): number {
  const c = clip(e, fromMs, toMs, nowMs)
  return c ? c[1] - c[0] : 0
}

/**
 * How much of a window has ANY span on it, in milliseconds — the union, counting no minute twice.
 *
 * ⚠️ THIS IS A DIFFERENT QUESTION FROM THE SUM, AND THREE FIGURES ON THE SITE WERE ANSWERING IT
 * WITH ONE. "% of the day recorded" was `blocks.reduce((n, b) => n + b.width, 0)`, clamped to 100 —
 * so a day of 9-to-5 work with a one-hour call inside it and music over the whole lot read **70.8%
 * of the day** about a day holding **33.3%**, and the month grid turned that into **1,020 minutes
 * recorded** of a day that held 480. Four overlapping morning sittings read **100% of the day** and
 * a full **1,440 minutes** while the entire afternoon was blank.
 *
 * ⚠️ AND THE CLAMP WAS THE WORST PART, not the saving grace. It was there on purpose — "103% of
 * your day reads as a bug while 100% reads as a full day" — and that reasoning is right about the
 * symptom and wrong about the cause: capping the number is what turned a visibly broken figure
 * into a confidently wrong one. A union cannot exceed its window, so nothing needs clamping.
 *
 * ⚠️ OVERLAP IS ALLOWED AND MUST STAY ALLOWED. None of the ten functions that write to
 * `chronicle_entries` tests for it, deliberately: a podcast while washing up is two activities over
 * the same minutes, and a constraint forbidding that would be the tidy-looking rule that locks the
 * room — CLAUDE.md §4 has the entries-table version of that story. The record is right; the
 * sentence read off it was wrong.
 *
 * ⚠️ THE SUM IS STILL THE RIGHT ANSWER TO ITS OWN QUESTION. "Written down 9h" on a day covering
 * eight hours is honest — you spent nine hours' worth of attention — so `Focused` and `Written
 * down` stay sums. Only the figure with "of the day" after it is a union.
 */
export function coveredMs(
  spans: readonly Span[],
  fromMs: number,
  toMs: number,
  nowMs: number,
): number {
  const cuts: Array<[number, number]> = []
  for (const s of spans) {
    const c = clip(s, fromMs, toMs, nowMs)
    if (c) cuts.push(c)
  }
  if (cuts.length === 0) return 0
  /* ⚠️ sorted by START, which is what makes one pass enough: every later stretch either extends
     the one being carried or begins a new one, and nothing already passed can be reopened */
  cuts.sort((x, y) => x[0] - y[0])
  let total = 0
  let [lo, hi] = cuts[0]
  for (let i = 1; i < cuts.length; i++) {
    const [a, b] = cuts[i]
    if (a > hi) {
      total += hi - lo
      lo = a
      hi = b
    } else if (b > hi) {
      /* ⚠️ `b > hi` rather than plain assignment: a short stretch wholly inside a long one must
         not shorten it. Two sittings 9–17 and 11–12 sort in that order, so the second is swallowed
         whole — assigning unconditionally would have reported five hours of the eight. */
      hi = b
    }
  }
  return total + (hi - lo)
}

/**
 * The same, as a share of the window, 0–100.
 *
 * ⚠️ THE WINDOW'S OWN WIDTH IS THE DENOMINATOR, never a constant. `score.ts` divided by
 * `DAY_MINS = 24 * 60`, and a day is not always 1440 minutes: measured in New York,
 * `dayBounds('2026-03-08')` is **1380** and `dayBounds('2026-11-01')` is **1500**. So a fully
 * recorded spring-forward day read 95.8% and could never reach 100, and a fall-back day could
 * exceed it — which the clamp then hid. Asking the window is both shorter and right.
 */
export function coveredPct(
  spans: readonly Span[],
  fromMs: number,
  toMs: number,
  nowMs: number,
): number {
  const width = toMs - fromMs
  if (!(width > 0)) return 0
  return (coveredMs(spans, fromMs, toMs, nowMs) / width) * 100
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

/**
 * Which ends of a sitting fall outside the day being read.
 *
 * ⚠️ THE THIRD HALF OF THE RULE ABOVE. `overlapMs` splits the minutes at midnight and `amountIn`
 * keeps the quantity on the day the session started — and the CLOCK TIMES were left saying the
 * whole sitting on both days. Measured through ⏱ Fill a gap, 23:00 Wed to 01:00 Thu: today's log
 * and yesterday's each read `1h · 11:00 PM – 1:00 AM`. The length is right on each day and the
 * range is the whole two hours on both, so the row contradicts itself — and on today, 11:00 PM is
 * a time that has not happened yet, in a room that refuses a future sitting on purpose.
 *
 * ⚠️ FLAGS RATHER THAN A FORMATTED STRING, so this can be asked a question. The words are
 * `toLocaleTimeString`'s and belong to the component; what is testable is the decision, which has
 * a UNIT in it — a boundary, and whether an end sitting exactly ON it counts as outside.
 *
 * ⚠️ `toMs` IS EXCLUSIVE, so a sitting that ends exactly at midnight ends inside the day it
 * belongs to and is not marked. That matches `overlapMs`, which would otherwise credit it with a
 * moment of the next day.
 */
export function straddles(
  e: Span,
  fromMs: number,
  toMs: number,
  nowMs: number,
): { before: boolean; after: boolean } {
  const s = Date.parse(e.start)
  /* a running sitting reaches to now, which is how a timer left going overnight is marked */
  const t = e.end ? Date.parse(e.end) : nowMs
  return {
    before: Number.isFinite(s) && s < fromMs,
    after: Number.isFinite(t) && t > toMs,
  }
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

/**
 * A quantity, written the way somebody would write it.
 *
 * ⚠️ IT EXISTS BECAUSE A ROW DISAGREED WITH ITSELF. The seed's year goal is titled "20,000 reps"
 * — the member typed that comma, because that is how the number reads — and the meter two lines
 * under it said "180 / 20000 reps". The same number, twice, inches apart, in two different
 * notations. `toLocaleString` is already the house answer for this: Circuit and the finance
 * panels both use it, and chronicle simply never did.
 *
 * ⚠️ TWO DECIMAL PLACES, which is a rule this room already had and had not named. `Looking` did
 * `Math.round(r.amount * 100) / 100` by hand for the same reason the meter rounds its minutes —
 * "29.983 / 30" is a number that looks broken rather than nearly done. Having it in one place
 * means the log, the totals and a goal cannot drift into three different answers about one
 * quantity. The platform's own default is three, which is a digit nobody asked for.
 *
 * ⚠️ AND IT FOLLOWS THE READER'S LOCALE, which is why the tests assert grouping rather than a
 * comma: the separator is a space in France and a full stop in Germany, and a test that demanded
 * "20,000" would be asserting the machine it ran on.
 */
export function countText(n: number): string {
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 })
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
export type Block = {
  activity: string
  left: number
  width: number
  cut: boolean
  /**
   * Which session this block IS, when the caller knows.
   *
   * ⚠️ OPTIONAL, BECAUSE NOT EVERY CALLER HAS ONE. `lane` lays out anything with a start and an
   * end — a plan has no entry id and the day strip draws those too — so this carries through when
   * it is there and is absent when it is not. It exists so a block can be a door: the week grid
   * had seven columns of coloured marks that named a session in a `title` and a tooltip does not
   * exist on a phone, so the only way to find out what one was, was to count rows in the log.
   */
  id?: string
}

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
  spans: Array<Span & { activity: string; id?: string }>,
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
      id: s.id,
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

/* ── a datetime-local value, which is a STRING and not a moment ─────────────────────────────── */

/**
 * Read `YYYY-MM-DDTHH:mm` as local wall-clock time.
 *
 * ⚠️ PARSED BY HAND RATHER THAN BY `new Date(s)`. The spec says a date-TIME form without an
 * offset is local and a date-ONLY form is UTC, which is a distinction nobody remembers and the
 * difference is a whole timezone — so a value that loses its time part would silently jump. The
 * fields are right there; reading them is three lines and cannot drift.
 */
export function readLocal(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value)
  if (!m) return null
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), 0, 0)
  return Number.isNaN(d.getTime()) ? null : d
}

/** write a moment back as `YYYY-MM-DDTHH:mm`, which is what a datetime-local input wants */
export function writeLocal(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

/**
 * Move a datetime-local value by whole minutes.
 *
 * ⚠️ IT MOVES ALONG THE TIMELINE, AND THE DST CASE IS THE ONE THAT MATTERS: on a spring-forward
 * day 1:30 + 60 has to land at 3:30, because 2:30 never happens. Measured in America/New_York on
 * 2026-03-08 — both this and `setMinutes(getMinutes() + n)` answer 03:30, so the field version is
 * NOT wrong here and an earlier draft of this comment said it was. The trap CLAUDE.md records is
 * `setDate` before `setHours`, which is a different thing: setting a date field while the hour
 * field is also moving. Epoch arithmetic is kept because it has no field normalisation to reason
 * about at all, not because the alternative is broken.
 */
export function nudgeLocal(value: string, byMins: number): string {
  const d = readLocal(value)
  if (!d) return value
  return writeLocal(new Date(d.getTime() + byMins * 60_000))
}

/**
 * How long a span of two datetime-local values is, in minutes — or null if either is unreadable.
 *
 * ⚠️ IT MAY BE NEGATIVE AND IT IS NOT CLAMPED. An end before a start is a thing somebody can type
 * on the way to typing something else, and the editor wants to SAY so rather than show a cheerful
 * zero; clamping here would take that away from it.
 */
export function minsBetweenLocal(from: string, to: string): number | null {
  const a = readLocal(from)
  const b = readLocal(to)
  if (!a || !b) return null
  return Math.round((b.getTime() - a.getTime()) / 60_000)
}

/** a datetime-local value as the clock face a person reads */
export function clockOfLocal(value: string): string {
  const d = readLocal(value)
  if (!d) return '—'
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

/**
 * Which block a tap at `pct` down a lane meant, or null for "none of them".
 *
 * ⚠️ THE LANE DOES THE HIT TESTING BECAUSE THE BLOCKS CANNOT. Making each block a button is the
 * obvious move and it is wrong on a phone: a block's height IS its duration, so a half-hour
 * sitting in a 24-hour column is about six pixels. Measured in the week grid at 375 — fifteen
 * controls between 30×5 and 30×10, every one of them under the 24px floor, and no amount of
 * styling can fix a target whose size is the data. One handler on the lane has no such problem.
 *
 * ⚠️ `near` IS IN PERCENT OF THE DAY AND IT IS WHAT MAKES THIS USABLE. An exact containment test
 * is the same six pixels wearing a different hat. A tolerance of about a percent is fifteen
 * minutes of a day — roughly a finger — so a tap just above or below a thin block still finds it.
 *
 * ⚠️ AND THE NEAREST WINS, NOT THE FIRST. Blocks can touch or overlap, and with a tolerance two
 * can be in range at once; taking the first would make the answer depend on the order the day
 * was fetched in, which is not a thing a person can see or predict.
 */
export function blockAt(blocks: readonly Block[], pct: number, near = 1): Block | null {
  let best: Block | null = null
  let bestGap = Infinity
  for (const b of blocks) {
    const top = b.left
    const bottom = b.left + b.width
    const gap = pct < top ? top - pct : pct > bottom ? pct - bottom : 0
    if (gap <= near && gap < bestGap) {
      best = b
      bestGap = gap
    }
  }
  return best
}
