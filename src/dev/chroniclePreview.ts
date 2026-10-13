import type { Goal, Scope } from '../chronicle/goal'
import { today as todayISO } from '../chronicle/goal'
import { localMidnight, overlapMs, type Activity, type Entry } from '../chronicle/record'
import type { NewGoal, Routine, Total } from '../chronicle/cloud'

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

const span = (
  id: string,
  activity: string,
  daysAgo: number,
  h: number,
  mins: number,
  amount: number | null = null,
  note: string | null = null,
): Entry => {
  const a = at(daysAgo, h)
  return {
    id,
    activity,
    start: a.toISOString(),
    end: new Date(a.getTime() + mins * 60_000).toISOString(),
    note,
    amount,
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
  ...g,
})

type Store = { acts: Activity[]; ents: Entry[]; goals: Goal[]; routines: Routine[] }

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
    ...extra,
  })
  return {
    acts: [
      a('pv-draw', 'Drawing', 'locked'),
      a('pv-write', 'Writing', 'locked', { metric: 'pages' }),
      a('pv-gym', 'Gym', 'free', { metric: 'reps' }),
      a('pv-dish', 'Dishes', 'life'),
      a('pv-site', 'Chronicle (on the site)', 'free', { auto: true }),
      a('pv-old', 'Guitar', 'free', { archived: true }),
    ],
    ents: [
      span('pv-e1', 'pv-draw', 0, 10, 35),
      span('pv-e2', 'pv-draw', 1, 10, 42, null, 'the hands again'),
      span('pv-e3', 'pv-draw', 2, 9, 31),
      span('pv-e4', 'pv-draw', 3, 11, 50),
      /* no day 4 — see the note above */
      span('pv-e5', 'pv-draw', 5, 10, 38),
      span('pv-e6', 'pv-draw', 6, 10, 33),
      span('pv-e7', 'pv-write', 2, 14, 50, 4),
      span('pv-e8', 'pv-write', 5, 15, 40, 3),
      span('pv-e9', 'pv-gym', 0, 7, 45, 60),
      span('pv-e10', 'pv-gym', 3, 7, 40, 55),
      span('pv-e11', 'pv-dish', 0, 19, 12),
      /* ⚠️ a span that crosses midnight, because that is the one case where the two window rules
         disagree: the minutes split across both days and the amount does not. */
      span('pv-e12', 'pv-write', 4, 23, 90, 2),
      /* the running one — no end. The stopwatch has no other way to be seen in the pane. */
      {
        id: 'pv-run',
        activity: 'pv-site',
        start: new Date(Date.now() - 7 * 60_000).toISOString(),
        end: null,
        note: null,
        amount: null,
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
      goal({ id: 'pv-g2', title: 'Ring the dentist', scope: 'day', anchor: todayISO(), sort: 1 }),
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
      goal({
        id: 'pv-g5',
        title: 'Pack for the trip',
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
const blank = (): Store => ({ acts: [], ents: [], goals: [], routines: [] })

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

export const pvGoals = (): Goal[] => db().goals.map((g) => ({ ...g }))
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
    if (!g) continue
    out[ask.key ?? ask.id] = worth(g, ask.from, ask.to)
  }
  return out
}

export const pvTotals = (fromISO: string, toISO: string): Total[] => {
  const from = Date.parse(fromISO)
  const to = Date.parse(toISO)
  const now = Date.now()
  const out = new Map<string, Total>()
  for (const e of db().ents) {
    const ms = overlapMs(e, from, to, now)
    if (ms <= 0) continue
    const act = db().acts.find((x) => x.id === e.activity)
    if (!act) continue
    const row: Total = out.get(act.id) ?? {
      activity: act.id,
      name: act.name,
      cat: act.cat,
      auto: act.auto,
      mins: 0,
      metric: act.metric,
      amount: act.metric ? 0 : null,
    }
    row.mins += ms / 60_000
    const s = Date.parse(e.start)
    if (act.metric && e.amount != null && s >= from && s < to)
      row.amount = (row.amount ?? 0) + e.amount
    out.set(act.id, row)
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
): { id: string } => {
  const made = id ?? mint('pv-a')
  const found = db().acts.find((x) => x.id === made)
  if (found) Object.assign(found, { name, cat, colour, metric: metric || null })
  else
    db().acts.push({
      id: made,
      name,
      cat,
      colour,
      archived: false,
      auto: false,
      metric: metric || null,
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
  db().ents.push({ id: mint('pv-e'), activity, start: fromISO, end: toISO, note, amount: null })
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
