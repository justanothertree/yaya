import type { Goal, Scope } from '../chronicle/goal'
import { today as todayISO } from '../chronicle/goal'
import {
  localMidnight,
  overlapMs,
  type Activity,
  type Entry,
  type Moods,
} from '../chronicle/record'
import type { NewGoal, Putback, Routine, Total } from '../chronicle/cloud'
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
  /* ⚠️ private unless a fixture says otherwise, which is what the column's default does */
  shared: false,
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
      a('pv-draw', 'Drawing', 'locked', { session: 30, colour: '#8b5cf6' }),
      a('pv-write', 'Writing', 'locked', { metric: 'pages', colour: '#3d9ae5' }),
      a('pv-gym', 'Gym', 'free', { metric: 'reps', session: 60, colour: '#4caf50' }),
      /**
       * ⚠️ THREE OF THESE CARRY A COLOUR, AND DISHES DELIBERATELY DOES NOT. Every activity here
       * had `colour: null` until a round trip through the room's own export was checked field by
       * field and found the one column it could not have tested — which is the column with the
       * history: a restored file is the only way an activity can get a colour, and a rename used
       * to delete it (see docs/2026-10-13-chronicle-silent-erasures.sql). A fixture that leaves a
       * field at its default makes every save of that field a no-op, so losing it reads as a pass.
       * One row keeps the null so the absent case stays covered too.
       */
      a('pv-dish', 'Dishes', 'life'),
      /**
       * ⚠️ ONE DELIBERATELY LONG NAME, because several layout decisions in this room were made
       * against one and say so — the bar list's fixed name column ellipsing to "C." (Looking.tsx),
       * and the row whose buttons wrapped (index.css). The auto activity used to be that name and
       * is now called what the room is called, so the stress case lives on an ordinary activity
       * instead. A member really does write names this long.
       */
      a('pv-long', 'Writing the difficult chapter', 'locked', { metric: 'pages' }),
      /**
       * ⚠️ NAMED EXACTLY WHAT THE ROOM IS CALLED, because that is what the real one is named.
       * `pvVisit` finds its auto activity the way chronicle_visit does — one per room, matched on
       * `auto && name === room` — and the room's title is "Chronicle". This seed said "Chronicle
       * (on the site)", a clearer label and an unfaithful one: no match, so the first visit minted
       * a SECOND auto activity beside it. Two auto rows for one room cannot happen on the server,
       * so the double was inventing a state the product has no code to reach.
       */
      a('pv-site', 'Chronicle', 'free', { auto: true }),
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
      /**
       * ⚠️ THREE SITTINGS FROM EARLIER YEARS, so the Years view has something to be a view OF.
       * Everything else in this seed is inside the last ten days, which makes a lifetime of one
       * year — and a one-row list cannot show whether the rows line up, whether the bar is scaled
       * against the biggest year or the total, or what an empty year does. `daysAgo` is counted
       * back from today, so these stay in the past whenever the seed is read.
       */
      span('pv-e17', 'pv-draw', 400, 10, 95, null, null, 4),
      span('pv-e18', 'pv-write', 430, 14, 140, 9, null, 3),
      span('pv-e19', 'pv-gym', 800, 7, 60, 40),
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
      /**
       * ⚠️ TWO OF THESE ARE SHARED AND THE REST ARE NOT, because a fixture where every goal is
       * private makes the profile block's goals list untestable and one where they all are makes
       * the per-goal tick a no-op. Both switches have to be exercisable from the seed, or the
       * only thing the workbench can show is the empty case — which passes every check there is.
       */
      goal({
        id: 'pv-g1',
        title: '30 minutes drawing',
        scope: 'day',
        every: 1,
        target: 30,
        unit: 'minutes',
        activity: 'pv-draw',
        shared: true,
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
        shared: true,
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
      /**
       * ⚠️ THE LONG ONE, AND SHARED, because both surfaces that draw a goal title give it a
       * fixed column and an ellipsis — the row in this room and the card on a profile — and a
       * fixture whose longest title is twenty-one characters tests neither. The column allows 120;
       * this is 71, which is what somebody actually writes when a goal is a whole job rather than
       * a word. It is also `done`, so the strike-through lands on a title that has to ellipse.
       */
      goal({
        id: 'pv-g11',
        title: 'Finish the back fence, including the gate and the post by the shed',
        scope: 'life',
        target: 4,
        unit: 'panels',
        progress: 4,
        done: true,
        sort: 1,
        shared: true,
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
/**
 * The stand-in for a timestamp the double does not keep.
 *
 * ⚠️ A FIXED MOMENT RATHER THAN `new Date()`, so two exports of an unchanged store are the same
 * bytes — which is the property `chronicle_export` orders its lists for, and a harness that
 * churned on every call could not be used to check it.
 */
const EPOCH = new Date(0).toISOString()

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
        colour: a.colour,
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
    /**
     * ⚠️ AN AMOUNT NEEDS AN ACTIVITY THAT COUNTS ONE, which chronicle_goal_save corrects rather
     * than refuses — a goal with a nonsense pairing is still a goal somebody is writing down, so
     * it measures time instead. Both halves of the correction: no activity at all, and an
     * activity that names no metric. The second was the one a goal could be saved through, and it
     * made a goal that read 0 for ever against a source with minutes in it.
     */
    counts:
      g.counts === 'amount' &&
      db()
        .acts.find((a) => a.id === g.activity)
        ?.metric?.trim()
        ? 'amount'
        : 'minutes',
  })
  const i = db().goals.findIndex((x) => x.id === id)
  /* ⚠️ an edit keeps the progress and the tick, which live in their own columns and are not on
     the save path — the same division the server makes. Overwriting them here would make the
     preview's edit destroy a tick that the real one preserves. */
  if (i < 0) db().goals.push(made)
  else
    db().goals[i] = {
      ...made,
      progress: db().goals[i].progress,
      done: db().goals[i].done,
      /* ⚠️ and the note, for the same reason and a worse one: `saveGoal` does not send the field
         at all, so every edit used to arrive here as null and overwrite it. chronicle_goal_save
         reads null as "leave it alone" now; '' still clears. */
      note: g.note === undefined || g.note === null ? db().goals[i].note : g.note.trim() || null,
    }
  return { id }
}

export const pvProgress = (id: string, progress: number, done: boolean): boolean => {
  const g = db().goals.find((x) => x.id === id)
  if (g) Object.assign(g, { progress, done })
  return !!g
}

/** ⚠️ owner-scoped by construction here, the way the `owner = auth.uid()` clause does it there */
export const pvShareGoal = (id: string, on: boolean): boolean => {
  const g = db().goals.find((x) => x.id === id)
  if (!g) return false
  g.shared = on
  return true
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
    Object.assign(found, {
      name,
      cat,
      /* ⚠️ null leaves the colour alone, '' clears it — chronicle_activity_save's rule. The room
         passes null here on every rename because it has no colour picker, so reading null as
         "clear it" meant a rename deleted whatever a restored file had put there. */
      colour: colour === null ? found.colour : colour.trim() || null,
      metric: metric || null,
      session: session || null,
    })
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
/**
 * ⚠️ IT REFUSES AN ARCHIVED ACTIVITY, AND THE WORDS ARE THE SERVER'S. chronicle_start checks
 * `archived_at is null` and raises 'no such activity' for both "not yours" and "put away", so
 * that the refusal cannot be used to tell those apart.
 *
 * The double used to check only that the id existed, and that is not a small infidelity: the
 * Routines list offered a ▶ on a step whose activity had been archived, which worked perfectly
 * here and would have answered "no such activity" on the live site. An unfaithful double does not
 * only invent bugs — it hides them, and this one hid a real one until the check was copied.
 */
export const pvStart = (activity: string): { why: string } | null => {
  const a = db().acts.find((x) => x.id === activity)
  if (!a || a.archived) return { why: 'no such activity' }
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
  /**
   * ⚠️ chronicle_entry_add'S THREE CHECKS, IN ITS ORDER AND ITS WORDS. The order is part of the
   * contract: a span that is both backwards and four days long is answered about being backwards.
   *
   * ⚠️ AND NO ARCHIVED CHECK HERE, which looks like an inconsistency with pvStart and is not.
   * `chronicle_entry_add` asks only `owner = auth.uid()`, while `chronicle_start` also asks
   * `archived_at is null`. Writing down an hour you already spent on something you have since put
   * away is recording history; only STARTING a new sitting on it is refused. Copying the stricter
   * rule across would have invented a refusal the server does not make.
   */
  if (!toISO || !fromISO || Date.parse(toISO) <= Date.parse(fromISO))
    return { why: 'that span ends before it starts' }
  /* a sitting is a sitting and not a holiday — the server's bound is 24 hours */
  if (Date.parse(toISO) - Date.parse(fromISO) > 86_400_000)
    return { why: 'that is more than a day' }
  /**
   * ⚠️ AND NOT IN THE FUTURE — the start, not the end, the same check chronicle_running_fix has
   * always made. Two doors wrote a sitting nobody had sat: ⏱ Fill a gap, and ✓ on tomorrow's
   * plan, which goes through chronicle_plan_did straight into this function.
   *
   * ⚠️ LAST OF THE THREE, so that nothing already refused changes its answer — a span that is
   * both in the future and longer than a day is still answered about its length.
   */
  if (Date.parse(fromISO) > Date.now()) return { why: 'that is in the future' }
  if (!db().acts.some((x) => x.id === activity)) return { why: 'no such activity' }
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
  activity?: string | null,
): { why: string } | null => {
  const e = db().ents.find((x) => x.id === id)
  /**
   * ⚠️ THE SPAN IS JUDGED BEFORE THE ENTRY IS LOOKED FOR, because that is the order
   * chronicle_entry_edit judges them in — its `if not found` comes after the update, so a bad
   * span against an id that is not there is answered about the SPAN. The double used to answer
   * 'that entry is gone' first, and in its own words rather than the server's.
   */
  if (!fromISO || !toISO) return { why: 'both ends, please' }
  if (Date.parse(toISO) <= Date.parse(fromISO)) return { why: 'that span ends before it starts' }
  if (Date.parse(toISO) - Date.parse(fromISO) > 86_400_000)
    return { why: 'that is more than a day' }
  /* ⚠️ the same rule pvAddEntry keeps, because a rule only one of them keeps is one you get
     around by adding a legal sitting and then editing it forward */
  if (Date.parse(fromISO) > Date.now()) return { why: 'that is in the future' }
  /**
   * ⚠️ NULL LEAVES IT WHERE IT IS, and a named activity has to be one of yours — the same two
   * rules chronicle_entry_edit keeps. The second one matters more than it looks: the server
   * checks it because a foreign key would happily accept somebody else's activity, which would
   * leave you holding a row that points into another person's list and puts your minutes in
   * their totals. A double that accepted any uuid would make that look fine here.
   */
  if (activity != null && !db().acts.some((a) => a.id === activity))
    return { why: 'that is not one of your activities' }
  if (!e) return { why: 'no such entry' }
  /* ⚠️ null leaves the note alone, '' clears it — chronicle_entry_edit's rule, and the reason a
     caller that forgets this argument can no longer destroy what somebody wrote */
  Object.assign(e, {
    start: fromISO,
    end: toISO,
    note: note === null ? e.note : note.trim() || null,
    activity: activity ?? e.activity,
  })
  return null
}

/**
 * Correcting the one open sitting, the way `chronicle_running_fix` does it.
 *
 * ⚠️ IT KEEPS ALL FOUR OF THAT FUNCTION'S RULES, and three of them are refusals rather than
 * behaviour: there has to be something running, a start cannot be in the future or more than a
 * day ago, and an activity has to be one of yours. A double that accepted any of those would make
 * the room look as though it worked and leave the server to say no.
 */
export const pvFixRunning = (
  fromISO: string | null,
  activity: string | null,
): { why: string } | null => {
  const e = db().ents.find((x) => x.end == null)
  if (!e) return { why: 'nothing is running' }
  if (fromISO != null) {
    const when = Date.parse(fromISO)
    if (when > Date.now()) return { why: 'that is in the future' }
    if (Date.now() - when > 24 * 3_600_000) return { why: 'that is more than a day ago' }
  }
  if (activity != null && !db().acts.some((a) => a.id === activity))
    return { why: 'that is not one of your activities' }
  /* ⚠️ null leaves each one alone — the rule every save path in this module keeps */
  Object.assign(e, { start: fromISO ?? e.start, activity: activity ?? e.activity })
  return null
}

export const pvAmount = (id: string, amount: number | null): boolean => {
  const e = db().ents.find((x) => x.id === id)
  if (e) e.amount = amount
  return !!e
}

/* ⚠️ 1 TO 5, as chronicle_entry_quality insists; null is "no opinion" and goes through. Nothing in
   the room can send a 6, which is the reason to refuse one here rather than a reason not to: a
   bound only the UI keeps is a bound that goes the day somebody builds a second way in. */
export const pvQuality = (id: string, quality: number | null): boolean => {
  if (quality != null && (quality < 1 || quality > 5)) return false
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

/**
 * A stretch of time in a room, as `chronicle_visit` records it.
 *
 * ⚠️ THE THREE RULES THAT FUNCTION KEEPS, and all three matter to what the room shows:
 *  - the seconds are clamped to between 30 and 600, so one report can never claim more than ten
 *    minutes however long the caller thought it was;
 *  - the activity is found or made, named after the room and marked `auto`, which is what makes
 *    "Paint 4h" visibly a room that was open rather than four hours of painting;
 *  - a finished entry for it that ended under THREE MINUTES ago is EXTENDED rather than added to,
 *    which is why the beat is two minutes and why the client restarts its stretch after each one.
 */
export const pvVisit = (room: string, secs: number): void => {
  const name = room.trim()
  if (!name || name.length > 40) return
  const span = Math.min(Math.max(Math.round(secs) || 0, 30), 600)
  const now = Date.now()
  let act = db().acts.find((a) => a.auto && a.name === name)
  if (!act) {
    act = {
      id: mint('pv-a'),
      name,
      cat: 'free',
      colour: null,
      archived: false,
      auto: true,
      metric: null,
      session: null,
    }
    db().acts.push(act)
  }
  const recent = db()
    .ents.filter((e) => e.activity === act.id && e.end != null && now - Date.parse(e.end) < 180_000)
    .sort((a, b) => Date.parse(b.end!) - Date.parse(a.end!))[0]
  if (recent) recent.end = new Date(now).toISOString()
  else
    db().ents.push({
      id: mint('pv-e'),
      activity: act.id,
      start: new Date(now - span * 1000).toISOString(),
      end: new Date(now).toISOString(),
      note: null,
      amount: null,
      quality: null,
    })
}

/**
 * The whole account as one document, the way `chronicle_export` builds it.
 *
 * ⚠️ IT MIRRORS THE SERVER'S FIELD NAMES, NOT THIS MODULE'S. The double stores the shapes the
 * room reads — `start`, `end`, `cat` — while the file carries the column names, `started_at`,
 * `ended_at`, `archived_at`. A double that exported its own vocabulary would make the harness
 * agree with a file nobody will ever receive.
 *
 * ⚠️ AND EVERY LIST IS ORDERED, for the same reason the function orders them: two exports of
 * unchanged data should be the same bytes.
 */
export const pvExport = (): Record<string, unknown> => ({
  kind: 'chronicle',
  version: 1,
  at: new Date().toISOString(),
  activities: [...db().acts]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((a) => ({
      id: a.id,
      name: a.name,
      cat: a.cat,
      colour: a.colour,
      /* the double keeps a boolean where the table keeps the moment it happened */
      archived_at: a.archived ? EPOCH : null,
      created_at: EPOCH,
      auto: a.auto,
      metric: a.metric,
      session_mins: a.session,
    })),
  entries: [...db().ents]
    .sort((x, y) => Date.parse(x.start) - Date.parse(y.start) || x.id.localeCompare(y.id))
    .map((e) => ({
      id: e.id,
      activity: e.activity,
      started_at: e.start,
      ended_at: e.end,
      note: e.note,
      amount: e.amount,
      quality: e.quality,
      created_at: e.start,
    })),
  goals: [...db().goals]
    .sort((a, b) => a.sort - b.sort || a.id.localeCompare(b.id))
    .map((g) => ({
      id: g.id,
      title: g.title,
      scope: g.scope,
      anchor: g.anchor,
      repeat_every: g.every,
      target: g.target,
      unit: g.unit,
      progress: g.progress,
      /* `done` is a boolean here and a moment there, the same as `archived` above */
      done_at: g.done ? EPOCH : null,
      note: g.note,
      sort: g.sort,
      activity: g.activity,
      cat: g.cat,
      counts: g.counts,
      est_mins: g.est,
      priority: g.priority,
      created_at: EPOCH,
      updated_at: EPOCH,
    })),
  routines: [...db().routines]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((r) => ({
      id: r.id,
      name: r.name,
      steps: r.steps,
      created_at: EPOCH,
      updated_at: EPOCH,
    })),
  plans: [...db().plans]
    .sort((a, b) => Date.parse(a.start) - Date.parse(b.start) || a.id.localeCompare(b.id))
    .map((p) => ({
      id: p.id,
      activity: p.activity,
      starts_at: p.start,
      ends_at: p.end,
      note: p.note,
      created_at: p.start,
    })),
})

/**
 * Putting a file back, the way `chronicle_import` does it.
 *
 * ⚠️ WHAT THIS MIRRORS IS THE RULES, NOT THE TABLE. Add-only by id, the file's own `owner` ignored
 * because there isn't one, an activity reference that resolves to nothing dropped rather than
 * stored, activities inserted before anything that points at them, and a refusal for a file that
 * is not one of ours. What it CANNOT mirror is the check constraints — a goal's unit accompanying
 * its target, a category being one of three words — because those live in the table and copying
 * them here would be a second set of rules that drifts from it. The one exception is the pair the
 * room can produce by itself and would otherwise look broken about: a sitting that ends before it
 * starts, and a second sitting left running when the table allows exactly one.
 */
export const pvImport = (doc: unknown): Putback | { why: string } => {
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return { why: 'not a chronicle file' }
  const d = doc as Record<string, unknown>
  if (d.kind !== 'chronicle') return { why: 'not a chronicle file' }
  if (Number(d.version ?? 0) > 1) return { why: 'that file is from a newer version' }

  const list = (k: string): Array<Record<string, unknown>> =>
    Array.isArray(d[k]) ? (d[k] as Array<Record<string, unknown>>) : []
  const total = ['activities', 'entries', 'goals', 'routines', 'plans'].reduce(
    (n, k) => n + list(k).length,
    0,
  )
  if (total > 50_000) return { why: 'that file is too big to put back in one go' }

  const out: Putback = {
    activities: 0,
    entries: 0,
    goals: 0,
    routines: 0,
    plans: 0,
    skipped: 0,
  }
  const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null)
  const numOr = (v: unknown, fallback: number): number =>
    typeof v === 'number' ? v : typeof v === 'string' && v !== '' ? Number(v) : fallback

  /* activities first, so everything below can be checked against them */
  for (const a of list('activities')) {
    const id = str(a.id)
    if (!id || db().acts.some((x) => x.id === id)) {
      out.skipped++
      continue
    }
    db().acts.push({
      id,
      name: String(a.name ?? ''),
      cat: (a.cat === 'locked' || a.cat === 'life' ? a.cat : 'free') as Activity['cat'],
      colour: str(a.colour),
      archived: a.archived_at != null,
      auto: a.auto === true,
      metric: str(a.metric),
      session: a.session_mins == null ? null : numOr(a.session_mins, 0) || null,
    })
    out.activities++
  }

  for (const r of list('routines')) {
    const id = str(r.id)
    if (!id || db().routines.some((x) => x.id === id)) {
      out.skipped++
      continue
    }
    db().routines.push({
      id,
      name: String(r.name ?? ''),
      steps: Array.isArray(r.steps) ? (r.steps as Routine['steps']) : [],
    })
    out.routines++
  }

  const ours = (activity: unknown): string | null => {
    const id = str(activity)
    return id && db().acts.some((x) => x.id === id) ? id : null
  }

  for (const e of list('entries')) {
    const id = str(e.id)
    const act = ours(e.activity)
    const start = str(e.started_at)
    const end = str(e.ended_at)
    /* ⚠️ the two the table would refuse and the room can produce: a span that runs backwards, and
       a second sitting still running where exactly one is allowed */
    const backwards = start != null && end != null && Date.parse(end) <= Date.parse(start)
    const secondOpen = end == null && db().ents.some((x) => x.end == null)
    if (!id || !act || !start || backwards || secondOpen || db().ents.some((x) => x.id === id)) {
      out.skipped++
      continue
    }
    db().ents.push({
      id,
      activity: act,
      start,
      end,
      note: str(e.note),
      amount: e.amount == null ? null : numOr(e.amount, 0),
      quality: e.quality == null ? null : numOr(e.quality, 0),
    })
    out.entries++
  }

  for (const g of list('goals')) {
    const id = str(g.id)
    if (!id || db().goals.some((x) => x.id === id) || (g.activity != null && !ours(g.activity))) {
      out.skipped++
      continue
    }
    db().goals.push({
      id,
      title: String(g.title ?? ''),
      scope: String(g.scope ?? 'day') as Goal['scope'],
      anchor: str(g.anchor),
      every: g.repeat_every == null ? null : numOr(g.repeat_every, 0) || null,
      target: g.target == null ? null : numOr(g.target, 0),
      unit: str(g.unit),
      /* ⚠️ an imported goal is NOT shared, whatever the file says — chronicle_import does not
         carry the column, so a file from somebody else cannot put goals on your profile */
      shared: false,
      progress: numOr(g.progress, 0),
      done: g.done_at != null,
      note: str(g.note),
      sort: numOr(g.sort, 0),
      activity: ours(g.activity),
      cat: (g.cat === 'locked' || g.cat === 'free' || g.cat === 'life'
        ? g.cat
        : null) as Goal['cat'],
      counts: g.counts === 'amount' ? 'amount' : 'minutes',
      est: g.est_mins == null ? null : numOr(g.est_mins, 0) || null,
      priority: (numOr(g.priority, 0) || 0) as Goal['priority'],
    })
    out.goals++
  }

  for (const p of list('plans')) {
    const id = str(p.id)
    const act = ours(p.activity)
    const start = str(p.starts_at)
    if (!id || !act || !start || db().plans.some((x) => x.id === id)) {
      out.skipped++
      continue
    }
    db().plans.push({ id, activity: act, start, end: str(p.ends_at), note: str(p.note) })
    out.plans++
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

/**
 * The seed, shaped the way get_member_chronicle shapes it — so a chronicle block on a profile can
 * be LOOKED at in the workbench.
 *
 * ⚠️ WITHOUT THIS THE BLOCK RENDERS ITS EMPTY STATE AND AN AUDIT OF IT PASSES, which is the
 * trap CLAUDE.md names: previewMember makes no session, so the RPC answers nothing and a card
 * saying "Nothing recorded lately" looks exactly like a card that works. Every figure here comes
 * off the same store the room itself uses, so what the workbench draws is what the SQL would.
 */
export const pvMemberChronicle = (
  askedDays = 7,
  live = false,
  wantsGoals = false,
): {
  days: number
  time: Partial<Record<'locked' | 'free' | 'life', number>>
  top: Array<{ name: string; cat: string; colour: string | null; mins: number }>
  now: { name: string; cat: string; colour: string | null; mins: number } | null
  goals: Array<{ title: string; target: number | null; unit: string | null; done: boolean }>
  reached: number
  open: number
} => {
  /* clamped the same way the SQL clamps it, so the double cannot show a span the server would not */
  const days = Math.min(Math.max(Math.round(askedDays) || 7, 1), 90)
  const to = Date.now()
  const from = to - days * 86_400_000
  const catOf = new Map(db().acts.map((a) => [a.id, a]))
  const mins = new Map<string, number>()
  for (const e of db().ents) {
    const s0 = Date.parse(e.start)
    const e0 = e.end == null ? to : Date.parse(e.end)
    /* the same overlap the SQL takes: clamped to the window, never negative */
    const over = Math.max(0, Math.min(e0, to) - Math.max(s0, from)) / 60_000
    if (over <= 0) continue
    mins.set(e.activity, (mins.get(e.activity) ?? 0) + over)
  }
  const time: Partial<Record<'locked' | 'free' | 'life', number>> = {}
  for (const [id, m] of mins) {
    const a = catOf.get(id)
    if (!a) continue
    time[a.cat] = (time[a.cat] ?? 0) + m
  }
  for (const k of Object.keys(time) as Array<'locked' | 'free' | 'life'>) {
    const v = Math.round(time[k] ?? 0)
    if (v >= 1) time[k] = v
    else delete time[k]
  }
  const top = [...mins]
    .map(([id, m]) => {
      const a = catOf.get(id)
      return {
        name: a?.name ?? '?',
        cat: a?.cat ?? 'free',
        colour: a?.colour ?? null,
        mins: Math.round(m),
      }
    })
    .filter((t) => t.mins >= 1)
    .sort((x, y) => y.mins - x.mins || x.name.localeCompare(y.name))
    .slice(0, 5)
  /* ⚠️ the running sitting, and only when asked for — the double must refuse it the same way the
     SQL does, or the opt-in is untested where it is easiest to look at */
  const open = live ? db().ents.find((e) => e.end == null) : undefined
  const openAct = open ? catOf.get(open.activity) : undefined
  return {
    days,
    time,
    top,
    now:
      open && openAct
        ? {
            name: openAct.name,
            cat: openAct.cat,
            colour: openAct.colour ?? null,
            mins: Math.round((to - Date.parse(open.start)) / 60_000),
          }
        : null,
    /* ⚠️ BOTH switches, the way the SQL does it — the block must ask AND the goal must be
       shared. A double honouring only one makes the other untestable where it is easiest to look */
    goals: wantsGoals
      ? db()
          .goals.filter((g) => g.shared)
          .slice(0, 6)
          .map((g) => ({ title: g.title, target: g.target, unit: g.unit, done: g.done }))
      : [],
    reached: db().goals.filter((g) => g.done).length,
    open: db().goals.filter((g) => !g.done).length,
  }
}

/** the earliest sitting in the seed, so the Years view has a real span to draw */
export const pvSince = (): number | null => {
  const ts = db().ents.map((e) => Date.parse(e.start))
  return ts.length ? Math.min(...ts) : null
}

/**
 * ⚠️ THE SAME OVERLAP THE SQL TAKES, clamped to each window and never negative — a double that
 * attributed a sitting by where it STARTED would disagree with the server at exactly the boundary
 * the windows exist to get right.
 */
export const pvSpans = (
  asks: Array<{ key: string; from: string; to: string }>,
): Record<string, Partial<Record<'locked' | 'free' | 'life', number>>> => {
  const catOf = new Map(db().acts.map((a) => [a.id, a.cat]))
  const now = Date.now()
  const out: Record<string, Partial<Record<'locked' | 'free' | 'life', number>>> = {}
  for (const a of asks) {
    const f = Date.parse(a.from)
    const t = Date.parse(a.to)
    const mins: Partial<Record<'locked' | 'free' | 'life', number>> = {}
    for (const e of db().ents) {
      const cat = catOf.get(e.activity)
      if (!cat) continue
      const s0 = Date.parse(e.start)
      const e0 = e.end == null ? now : Date.parse(e.end)
      const over = Math.max(0, Math.min(e0, t) - Math.max(s0, f)) / 60_000
      if (over <= 0) continue
      mins[cat] = (mins[cat] ?? 0) + over
    }
    for (const k of Object.keys(mins) as Array<'locked' | 'free' | 'life'>) {
      const v = Math.round(mins[k] ?? 0)
      if (v >= 1) mins[k] = v
      else delete mins[k]
    }
    out[a.key] = mins
  }
  return out
}
