import type { Goal, Scope } from '../chronicle/goal'
import { today as todayISO } from '../chronicle/goal'
import {
  localMidnight,
  overlapMs,
  type Activity,
  type Entry,
  type Moods,
} from '../chronicle/record'
import type { NewGoal, Routine, Total } from '../chronicle/cloud'
import type { Plan } from '../chronicle/plan'

// ── DEV-ONLY chronicle preview store ─────────────────────────────────────────
// Chronicle is members-only and keeps NO local copy — by design, see the long note at the top of
// chronicle/cloud.ts. The consequence nobody wrote down: dev/previewMember.ts flips the UI gate
// but never creates a Supabase session, so in the preview every chronicle RPC answers nothing and
// the room renders its empty state and only its empty state.
//
// That had already cost real work. A whole tick of 375px audits came back "0 undersized, 0
// off-edge, 0 clipped" against a room that contained a paragraph and two buttons, and a streak
// chip was called verified on the strength of the module exporting the function that makes it. It
// is the same shape as `.park-field` always being rendered: the room being there does not mean
// anything is in it. #dev-park exists because the park could not otherwise be walked, and this is
// the same debt one room over.
//
// WHAT IT PROVES: that the room renders — every state a goal and an entry can be in, laid out at
// every viewport, with the editors drivable and the empty states reachable.
//
// WHAT IT CANNOT PROVE: any number. The sums here are the BROWSER's arithmetic, so a figure that
// looks right in the preview says nothing about what `chronicle_minutes` would return for the
// same window. That question has two homes already and neither is this file: vitest over goal.ts
// and record.ts for the rules, and a simulated session in SQL for the server. An unfaithful
// double looks exactly like a product bug, so this one borrows `overlapMs` rather than writing a
// second opinion about what a span is worth, and otherwise answers only what it was told.
//
// What it is NOT: no login, no credentials, no Supabase session, no database access. Nothing here
// persists — a reload is a fresh seed, which is a feature: it is how an empty state gets looked
// at twice. Every name is invented; this file is committed to a public repo.
//
// Enable:  localStorage.setItem('dev_preview_member','1'); location.reload()

/** today's local midnight, shifted by whole days, at a given wall-clock time */
const at = (daysAgo: number, h: number, m = 0): Date => {
  const d = localMidnight(todayISO())
  /* ⚠️ setDate BEFORE setHours. The other order crosses a DST boundary and lands an hour out —
     the same trap the two guards in goal.ts are each written against. */
  d.setDate(d.getDate() - daysAgo)
  d.setHours(h, m, 0, 0)
  return d
}

/**
 * A finished session, `daysAgo` days back, starting at hour `h`.
 *
 * ⚠️ ON TODAY THE HOUR IS A CEILING, NOT THE TIME. A fixture is read at whatever o-clock it
 * happens to be, and "today at 19:00" is in the FUTURE for most of the day — which is not a
 * product bug but reads as several. It made the gap form look like it was defaulting to a span
 * the day did not contain, and it would make any "what have I done so far" reading wrong. So a
 * session on today is pulled back to fit before now, keeping its length.
 *
 * ⚠️ WHICH MEANS TODAY IS CRAMPED IN THE SMALL HOURS, and that is the honest trade: read at
 * 00:41 there are only 41 minutes for today to have happened in, so the seeded sessions pile up
 * against midnight and overlap. Everything still counts on the right day, which is what the
 * streak and the tallies need. Anything being judged on how a NORMAL day lays out wants reading
 * later in the day, or on one of the earlier ones, which are at their stated hours.
 */
const span = (
  id: string,
  activity: string,
  daysAgo: number,
  h: number,
  mins: number,
  amount: number | null = null,
  note: string | null = null,
  quality: number | null = null,
): Entry => {
  let a = at(daysAgo, h)
  if (daysAgo === 0) {
    const latest = Date.now() - mins * 60_000
    if (a.getTime() > latest) a = new Date(Math.max(localMidnight(todayISO()).getTime(), latest))
  }
  return {
    id,
    activity,
    start: a.toISOString(),
    end: new Date(a.getTime() + mins * 60_000).toISOString(),
    note,
    amount,
    quality,
  }
}

const goal = (g: Partial<Goal> & { id: string; title: string; scope: Scope }): Goal => ({
  anchor: null,
  every: null,
  target: null,
  unit: null,
  progress: 0,
  done: false,
  note: null,
  sort: 0,
  activity: null,
  cat: null,
  counts: 'minutes',
  est: null,
  priority: 0,
  ...g,
})

type Store = {
  acts: Activity[]
  ents: Entry[]
  goals: Goal[]
  routines: Routine[]
  plans: Plan[]
}

/**
 * The seed.
 *
 * ⚠️ CHOSEN TO LIGHT UP EVERY BRANCH, not to look like a plausible week. There is a goal at zero,
 * one part way, one exactly met, one past its target so the bar's clamp is visible, a tick-box
 * ticked and another not, a hand-moved number, a goal on a category, a goal counting an amount
 * rather than minutes, an archived activity, an auto one, and a timer that is running right now.
 * A tidy fixture exercises the happy path and nothing else.
 *
 * ⚠️ AND THE DRAWING DAYS HAVE A HOLE IN THEM — 0, 1, 2, 3 then 5, 6, no 4. So the streak is FOUR
 * while six windows in the last week were met, which is the one seed shape that can tell a run
 * from a count. Seven unbroken days agrees with both and distinguishes neither.
 */
function seed(): Store {
  const a = (
    id: string,
    name: string,
    cat: Activity['cat'],
    extra: Partial<Activity> = {},
  ): Activity => ({
    id,
    name,
    cat,
    colour: null,
    archived: false,
    auto: false,
    metric: null,
    session: null,
    ...extra,
  })
  return {
    acts: [
      a('pv-draw', 'Drawing', 'locked', { session: 30 }),
      a('pv-write', 'Writing', 'locked', { metric: 'pages' }),
      a('pv-gym', 'Gym', 'free', { metric: 'reps', session: 60 }),
      a('pv-dish', 'Dishes', 'life'),
      a('pv-site', 'Chronicle (on the site)', 'free', { auto: true }),
      a('pv-old', 'Guitar', 'free', { archived: true }),
    ],
    ents: [
      span('pv-e1', 'pv-draw', 0, 10, 35, null, null, 5),
      span('pv-e2', 'pv-draw', 1, 10, 42, null, 'the hands again', 2),
      span('pv-e3', 'pv-draw', 2, 9, 31),
      span('pv-e4', 'pv-draw', 3, 11, 50),
      /* no day 4 — see the note above */
      span('pv-e5', 'pv-draw', 5, 10, 38),
      span('pv-e6', 'pv-draw', 6, 10, 33),
      span('pv-e7', 'pv-write', 2, 14, 50, 4, null, 3),
      span('pv-e8', 'pv-write', 5, 15, 40, 3),
      span('pv-e9', 'pv-gym', 0, 7, 45, 60, null, 4),
      span('pv-e10', 'pv-gym', 3, 7, 40, 55),
      span('pv-e11', 'pv-dish', 0, 19, 12),
      /* ⚠️ a span that crosses midnight, because that is the one case where the two window rules
         disagree: the minutes split across both days and the amount does not. */
      span('pv-e12', 'pv-write', 4, 23, 90, 2),
      /* ⚠️ THE WEEK BEFORE, so the like-for-like comparison has something to compare with — and
         pv-e15 is deliberately LATE in its day: it falls inside last week but outside the stretch
         that has elapsed this week, so an implementation comparing against the whole previous
         window counts it and the correct one does not. The difference is visible on screen. */
      span('pv-e13', 'pv-draw', 9, 10, 45, null, null, 4),
      span('pv-e14', 'pv-write', 8, 14, 60, 5, null, 3),
      span('pv-e15', 'pv-gym', 7, 10, 50, 65),
      span('pv-e16', 'pv-dish', 8, 19, 20),
      /* the running one — no end. The stopwatch has no other way to be seen in the pane. */
      {
        id: 'pv-run',
        activity: 'pv-site',
        start: new Date(Date.now() - 7 * 60_000).toISOString(),
        end: null,
        note: null,
        amount: null,
        quality: null,
      },
    ],
    goals: [
      goal({
        id: 'pv-g1',
        title: '30 minutes drawing',
        scope: 'day',
        every: 1,
        target: 30,
        unit: 'minutes',
        activity: 'pv-draw',
      }),
      /* ⚠️ a guess AND a flag, so the row shows both chips at once and they have to fit */
      goal({
        id: 'pv-g2',
        title: 'Ring the dentist',
        scope: 'day',
        anchor: todayISO(),
        sort: 1,
        est: 10,
        priority: 2,
      }),
      goal({
        id: 'pv-g3',
        title: 'Water the plants',
        scope: 'day',
        anchor: todayISO(),
        done: true,
        sort: 2,
      }),
      goal({
        id: 'pv-g4',
        title: 'Wash up every evening',
        scope: 'day',
        every: 1,
        target: 10,
        unit: 'minutes',
        activity: 'pv-dish',
        sort: 3,
      }),
      /* ⚠️ and one with a guess but no flag, and one flagged with NO guess — because the day's
         weight has to report what it could not count, and a seed where everything is estimated
         agrees with a version that silently ignores the gap */
      goal({
        id: 'pv-g5',
        title: 'Pack for the trip',
        est: 40,
        priority: 1,
        scope: 'day',
        /* ⚠️ at(-1, …) is TOMORROW — the only goal the Tomorrow view can show by itself */
        anchor: localISO(at(-1, 12)),
      }),
      goal({
        id: 'pv-g6',
        title: 'Five hours locked in',
        scope: 'week',
        every: 1,
        target: 300,
        unit: 'minutes',
        cat: 'locked',
      }),
      goal({
        id: 'pv-g7',
        title: '20 pages',
        scope: 'month',
        anchor: todayISO(),
        target: 20,
        unit: 'pages',
        activity: 'pv-write',
        counts: 'amount',
      }),
      goal({
        id: 'pv-g8',
        title: 'Read ten books',
        scope: 'quarter',
        anchor: todayISO(),
        target: 10,
        unit: 'books',
        progress: 3,
      }),
      goal({
        id: 'pv-g9',
        title: '20,000 reps',
        scope: 'year',
        anchor: todayISO(),
        target: 20000,
        unit: 'reps',
        activity: 'pv-gym',
        counts: 'amount',
      }),
      goal({ id: 'pv-g10', title: 'Learn to sail', scope: 'life', note: 'the boat comes later' }),
      goal({
        id: 'pv-g11',
        title: 'Finish the back fence',
        scope: 'life',
        target: 4,
        unit: 'panels',
        progress: 4,
        done: true,
        sort: 1,
      }),
    ],
    /**
     * ⚠️ FOUR PLANS THAT COVER THE THREE READINGS, because the comparison has three outcomes and a
     * fixture with one of them proves nothing: something planned and done (Drawing), something
     * planned and skipped (Writing), something still to come this evening (Gym), and — the one the
     * obvious implementation hides — a day that also held something nobody planned at all, which
     * the seeded Dishes session supplies for free.
     */
    plans: [
      {
        id: 'pv-p1',
        activity: 'pv-draw',
        start: at(0, 10).toISOString(),
        end: new Date(at(0, 10).getTime() + 60 * 60_000).toISOString(),
        note: null,
      },
      {
        id: 'pv-p2',
        activity: 'pv-write',
        start: at(0, 14).toISOString(),
        end: new Date(at(0, 14).getTime() + 90 * 60_000).toISOString(),
        note: 'the difficult chapter',
      },
      {
        id: 'pv-p3',
        activity: 'pv-gym',
        start: at(-1, 7).toISOString(),
        end: new Date(at(-1, 7).getTime() + 45 * 60_000).toISOString(),
        note: null,
      },
      {
        id: 'pv-p4',
        activity: 'pv-draw',
        start: at(-1, 10).toISOString(),
        end: new Date(at(-1, 10).getTime() + 30 * 60_000).toISOString(),
        note: null,
      },
    ],
    routines: [
      {
        id: 'pv-r1',
        name: 'Morning',
        steps: [
          { activity: 'pv-dish', mins: 10 },
          { activity: 'pv-draw', mins: 30 },
          { activity: 'pv-write', mins: null },
        ],
      },
    ],
  }
}

/* ⚠️ the local calendar date of a Date, never toISOString().slice(0,10) — see dates.ts, which has
   a warning at the top of the file about exactly that: it is UTC, so it reads as tomorrow all
   evening for anybody behind it, and this seeds an anchor the Tomorrow view is checked against */
const localISO = (d: Date): string =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

const BLANK = 'dev_chron_blank'
const blank = (): Store => ({ acts: [], ents: [], goals: [], routines: [], plans: [] })

/** sessionStorage, which can throw — see the rule about every read of it being wrapped */
const asked = (): boolean => {
  try {
    return window.sessionStorage?.getItem(BLANK) === '1'
  } catch {
    return false
  }
}

/**
 * ⚠️ THE EMPTY CHOICE HAS TO SURVIVE THE RELOAD IT NEEDS. The first version of this had an
 * `empty()` that cleared the store in place — and a store the component had already read, so
 * nothing on screen changed, and the reload that would have shown the empty room re-seeded it.
 * A control that cannot do the thing it is named after is the same unfaithful-double problem this
 * file's header is about, one layer in. The flag lives in sessionStorage so the seed can consult
 * it on the way up, and in sessionStorage rather than localStorage so closing the tab forgets it.
 */
/**
 * ⚠️ BUILT ON FIRST USE, NOT AT MODULE SCOPE, and that is a bundle-size decision rather than a
 * performance one. `let S = seed()` is a statement-level call: rollup cannot prove it pure, so
 * it keeps the module for its side effect — and the whole seed, every invented name in it, was
 * measurably in the production bundle as unreachable dead weight. dev/previewMember.ts does not
 * leak, because everything in it is a plain literal assigned to an export nobody reaches. Behind
 * a function there is nothing to run at import time and the module drops out entirely. Measured
 * both ways: grep the built bundle for a string only this file contains.
 */
let S: Store | undefined
const db = (): Store => (S ??= asked() ? blank() : seed())

/** ids for anything made in the preview, so they cannot collide with the seed's */
let next = 1
const mint = (p: string): string => `${p}-new-${next++}`

/* ── reads ──────────────────────────────────────────────────────────────────── */

/**
 * ⚠️ SORTED LIKE chronicle_goals_mine, because the ORDER is a server decision and the room
 * renders whatever order it is handed. This returned the seed array and the first flagged goal
 * duly rendered second — which looks exactly like the priority ordering not working, and it was
 * working: it had been proven in SQL minutes earlier. A double that gets the order wrong is the
 * "unfaithful double" trap, and this is the third time reading the server first has been the
 * answer.  is a stable sort, so insertion order stands in for created_at.
 */
export const pvGoals = (): Goal[] =>
  db()
    .goals.map((g) => ({ ...g }))
    .sort((a, b) => b.priority - a.priority || a.sort - b.sort)
export const pvActivities = (): Activity[] => db().acts.map((x) => ({ ...x }))
export const pvRoutines = (): Routine[] =>
  db().routines.map((r) => ({ ...r, steps: r.steps.map((s) => ({ ...s })) }))

export const pvEntries = (fromISO: string, toISO: string): Entry[] => {
  const from = Date.parse(fromISO)
  const to = Date.parse(toISO)
  const now = Date.now()
  return db()
    .ents.filter((e) => overlapMs(e, from, to, now) > 0)
    .map((e) => ({ ...e }))
}

/**
 * What one goal's source is worth over one window.
 *
 * ⚠️ `overlapMs` RATHER THAN A SUBTRACTION, so the midnight-splitting rule is the project's own
 * and not a second guess at it — and the amount branch counts by the day the session STARTED,
 * which is the one place the two measures part company. See Entry.amount.
 */
function worth(g: Goal, fromISO: string, toISO: string): number {
  const from = Date.parse(fromISO)
  const to = Date.parse(toISO)
  const now = Date.now()
  const cat = new Map(db().acts.map((x) => [x.id, x.cat]))
  let total = 0
  for (const e of db().ents) {
    if (g.activity ? e.activity !== g.activity : g.cat ? cat.get(e.activity) !== g.cat : true)
      continue
    if (g.counts === 'amount') {
      const s = Date.parse(e.start)
      if (e.amount != null && s >= from && s < to) total += e.amount
    } else {
      total += overlapMs(e, from, to, now) / 60_000
    }
  }
  return total
}

export const pvTally = (
  asks: Array<{ id: string; from: string; to: string; key?: string }>,
): Record<string, number> => {
  const out: Record<string, number> = {}
  for (const ask of asks) {
    const g = db().goals.find((x) => x.id === ask.id)
    /* ⚠️ A GOAL WITH NEITHER SOURCE IS NOT ANSWERED, as chronicle_tally's own join requires —
       it returned 0 for a hand-moved goal, which is a different claim from "I have nothing to
       say about that". The room never asks (tallyAsks skips them), so nothing was wrong on
       screen; the contract was. */
    if (!g || (!g.activity && !g.cat)) continue
    out[ask.key ?? ask.id] = worth(g, ask.from, ask.to)
  }
  return out
}

/**
 * ⚠️ EVERY ACTIVITY, INCLUDING ONES WITH NO TIME IN THE WINDOW. This built its rows from the
 * ENTRIES, so a quiet activity simply was not in the answer — while `chronicle_totals` selects
 * from the activities and LEFT JOINs the sums precisely so that it appears at 0. The room filters
 * those out itself, so nothing on screen was wrong; the double was answering a different question
 * from the one the server answers, which is how a double starts producing false bugs.
 */
export const pvTotals = (fromISO: string, toISO: string): Total[] => {
  const from = Date.parse(fromISO)
  const to = Date.parse(toISO)
  const now = Date.now()
  const out = new Map<string, Total>(
    db().acts.map((a) => [
      a.id,
      {
        activity: a.id,
        name: a.name,
        cat: a.cat,
        auto: a.auto,
        mins: 0,
        metric: a.metric,
        /* only when there is a metric to total: a zero beside no unit reads as a bug */
        amount: a.metric ? 0 : null,
      },
    ]),
  )
  for (const e of db().ents) {
    const ms = overlapMs(e, from, to, now)
    if (ms <= 0) continue
    const row = out.get(e.activity)
    if (!row) continue
    row.mins += ms / 60_000
    const began = Date.parse(e.start)
    if (row.metric && e.amount != null && began >= from && began < to)
      row.amount = (row.amount ?? 0) + e.amount
  }
  return [...out.values()].sort((x, y) => y.mins - x.mins)
}

/* ── writes ─────────────────────────────────────────────────────────────────── */

export const pvSaveGoal = (g: NewGoal): { id: string } => {
  const id = g.id ?? mint('pv-g')
  const made = goal({
    ...g,
    id,
    note: g.note ?? null,
    sort: g.sort ?? 0,
    activity: g.activity ?? null,
    cat: g.cat ?? null,
    counts: g.counts ?? 'minutes',
  })
  const i = db().goals.findIndex((x) => x.id === id)
  /* ⚠️ an edit keeps the progress and the tick, which live in their own columns and are not on
     the save path — the same division the server makes. Overwriting them here would make the
     preview's edit destroy a tick that the real one preserves. */
  if (i < 0) db().goals.push(made)
  else db().goals[i] = { ...made, progress: db().goals[i].progress, done: db().goals[i].done }
  return { id }
}

export const pvProgress = (id: string, progress: number, done: boolean): boolean => {
  const g = db().goals.find((x) => x.id === id)
  if (g) Object.assign(g, { progress, done })
  return !!g
}

export const pvDropGoal = (id: string): boolean => {
  db().goals = db().goals.filter((g) => g.id !== id)
  return true
}

export const pvSaveActivity = (
  name: string,
  cat: Activity['cat'],
  colour: string | null,
  id?: string,
  metric?: string | null,
  session?: number | null,
): { id: string } => {
  const made = id ?? mint('pv-a')
  const found = db().acts.find((x) => x.id === made)
  if (found)
    Object.assign(found, { name, cat, colour, metric: metric || null, session: session || null })
  else
    db().acts.push({
      id: made,
      name,
      cat,
      colour,
      archived: false,
      auto: false,
      metric: metric || null,
      session: session || null,
    })
  return { id: made }
}

export const pvArchive = (id: string, archived: boolean): boolean => {
  const found = db().acts.find((x) => x.id === id)
  if (found) found.archived = archived
  return !!found
}

export const pvStop = (note: string | null): { why: string } | null => {
  const open = db().ents.find((e) => e.end == null)
  if (!open) return null
  const now = Date.now()
  /* ⚠️ under a second leaves no trace — the mis-press threshold, mirrored from chronicle_stop */
  if (now - Date.parse(open.start) < 1000) db().ents = db().ents.filter((e) => e !== open)
  else {
    open.end = new Date(now).toISOString()
    open.note = note
  }
  return null
}

/** ⚠️ closes whatever was running, like chronicle_start — one open entry is a table invariant */
export const pvStart = (activity: string): { why: string } | null => {
  if (!db().acts.some((x) => x.id === activity))
    return { why: 'that is not one of your activities' }
  pvStop(null)
  db().ents.push({
    id: mint('pv-e'),
    activity,
    start: new Date().toISOString(),
    end: null,
    note: null,
    amount: null,
    quality: null,
  })
  return null
}

export const pvAddEntry = (
  activity: string,
  fromISO: string,
  toISO: string,
  note: string | null,
): { why: string } | null => {
  if (Date.parse(toISO) <= Date.parse(fromISO)) return { why: 'that ends before it starts' }
  db().ents.push({
    id: mint('pv-e'),
    activity,
    start: fromISO,
    end: toISO,
    note,
    amount: null,
    quality: null,
  })
  return null
}

export const pvDropEntry = (id: string): boolean => {
  db().ents = db().ents.filter((e) => e.id !== id)
  return true
}

export const pvEditEntry = (
  id: string,
  fromISO: string,
  toISO: string,
  note: string | null,
): { why: string } | null => {
  const e = db().ents.find((x) => x.id === id)
  if (!e) return { why: 'that entry is gone' }
  if (Date.parse(toISO) <= Date.parse(fromISO)) return { why: 'that ends before it starts' }
  Object.assign(e, { start: fromISO, end: toISO, note })
  return null
}

export const pvAmount = (id: string, amount: number | null): boolean => {
  const e = db().ents.find((x) => x.id === id)
  if (e) e.amount = amount
  return !!e
}

export const pvQuality = (id: string, quality: number | null): boolean => {
  const e = db().ents.find((x) => x.id === id)
  if (e) e.quality = quality
  return !!e
}

/** ⚠️ the OVERLAP, as chronicle_moods does — a rating is a property of the minutes, not of the
    session, so an hour either side of midnight is rated time on both days */
export const pvMoods = (fromISO: string, toISO: string): Moods => {
  const from = Date.parse(fromISO)
  const to = Date.parse(toISO)
  const now = Date.now()
  const out: Moods = {}
  for (const e of db().ents) {
    const ms = overlapMs(e, from, to, now)
    if (ms <= 0) continue
    const k = e.quality == null ? 'none' : String(e.quality)
    out[k] = (out[k] ?? 0) + ms / 60_000
  }
  return out
}

export const pvSaveRoutine = (
  name: string,
  steps: Array<{ activity: string; mins: number | null }>,
  id?: string,
): { id: string } => {
  const made = id ?? mint('pv-r')
  /* ⚠️ a step naming an activity that is not yours is dropped, as chronicle_routine_save does */
  const mine = steps.filter((s) => db().acts.some((x) => x.id === s.activity))
  const r = db().routines.find((x) => x.id === made)
  if (r) Object.assign(r, { name, steps: mine })
  else db().routines.push({ id: made, name, steps: mine })
  return { id: made }
}

export const pvPlans = (fromISO: string, toISO: string): Plan[] => {
  const from = Date.parse(fromISO)
  const to = Date.parse(toISO)
  return db()
    .plans.filter((p) => Date.parse(p.start) < to && Date.parse(p.end ?? p.start) > from)
    .sort((a, b) => a.start.localeCompare(b.start))
    .map((p) => ({ ...p }))
}

export const pvPlanSave = (
  activity: string,
  fromISO: string,
  toISO: string,
  note: string | null,
  id?: string,
): { id: string } | { why: string } => {
  if (Date.parse(toISO) <= Date.parse(fromISO)) return { why: 'that span ends before it starts' }
  if (Date.parse(toISO) - Date.parse(fromISO) > 86_400_000)
    return { why: 'that is more than a day' }
  if (!db().acts.some((a) => a.id === activity)) return { why: 'no such activity' }
  const made = id ?? mint('pv-p')
  const had = db().plans.find((p) => p.id === made)
  if (had) Object.assign(had, { activity, start: fromISO, end: toISO, note })
  else db().plans.push({ id: made, activity, start: fromISO, end: toISO, note })
  return { id: made }
}

export const pvPlanDrop = (id: string): boolean => {
  db().plans = db().plans.filter((p) => p.id !== id)
  return true
}

/** ⚠️ the plan stays, as chronicle_plan_did leaves it — see the note on planDid */
export const pvPlanDid = (id: string): { why: string } | null => {
  const p = db().plans.find((x) => x.id === id)
  if (!p || p.end == null) return { why: 'no such plan' }
  return pvAddEntry(p.activity, p.start, p.end, p.note)
}

export const pvDropRoutine = (id: string): boolean => {
  db().routines = db().routines.filter((r) => r.id !== id)
  return true
}

/**
 * Empty the store, or re-seed it, from the console.
 *
 * ⚠️ THE EMPTY STATES ARE THE HALF THAT IS NEVER SEEN. A seeded room shows eleven goals and a
 * full day; the sentences somebody reads on their first visit are only reachable by clearing it,
 * and the other way to reach a first visit — a fresh origin on :4173 — has no preview harness at
 * all, because the harness is DEV-only.
 *
 * Both reload, because the room reads its data once on mount: setting a module variable under a
 * component that has already read it changes nothing on screen, which is a trap worth not leaving
 * lying around in a file whose whole job is to be looked through.
 *
 * In the pane:  window.__chron.empty()   /   window.__chron.seed()
 */
const remember = (on: boolean): void => {
  try {
    if (on) window.sessionStorage?.setItem(BLANK, '1')
    else window.sessionStorage?.removeItem(BLANK)
  } catch {
    /* private window, blocked site data — the reload below just re-seeds, which is the default */
  }
}

export const pvEmpty = (): void => {
  S = blank()
  remember(true)
}

export const pvReseed = (): void => {
  S = seed()
  remember(false)
}

if (import.meta.env.DEV && typeof window !== 'undefined')
  (window as unknown as { __chron: unknown }).__chron = {
    empty: () => {
      pvEmpty()
      location.reload()
    },
    seed: () => {
      pvReseed()
      location.reload()
    },
  }
