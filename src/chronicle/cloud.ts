import { getSupabaseClient } from '../finance/client'
import { previewMember } from '../dev/previewMember'
import {
  pvActivities,
  pvAddEntry,
  pvAmount,
  pvArchive,
  pvDropEntry,
  pvDropGoal,
  pvDropRoutine,
  pvEditEntry,
  pvEntries,
  pvPlanDid,
  pvPlanDrop,
  pvPlanSave,
  pvPlans,
  pvGoals,
  pvProgress,
  pvRoutines,
  pvSaveActivity,
  pvSaveGoal,
  pvSaveRoutine,
  pvStart,
  pvStop,
  pvTally,
  pvTotals,
} from '../dev/chroniclePreview'
import type { Goal, Scope } from './goal'
import type { Plan } from './plan'
import type { Activity, Entry } from './record'

/**
 * Goals, in the account rather than in this browser.
 *
 * ⚠️ NO LOCAL COPY, AND THAT IS A DEPARTURE FROM THE REST OF THE SITE. Songs, drawings, minions
 * and looks all live in localStorage with the account as a mirror, because they were local first
 * and because losing one costs you a drawing. A plan is the opposite on both counts: it is
 * worthless in one browser — the whole point is that tomorrow's list is there on the phone — and
 * a cache that can disagree about whether a thing is done is a planner that lies. So the account
 * is the only copy, and signed out there is nothing to show rather than a sandbox.
 *
 * ⚠️ WHICH MEANS EVERY WRITE IS A ROUND TRIP, deliberately. Ticking a box waits for the server to
 * agree. That is slower than the optimistic update the Circuit does, and the right trade while
 * this is one person's private list: the Circuit is optimistic because several people write to one
 * board and somebody has to win, which is a problem a planner for one does not have.
 *
 * Everything here goes through the SECURITY DEFINER functions in
 * docs/2026-10-12-chronicle-design.md. The tables grant nothing to `anon` or `authenticated`, so
 * these calls are the only way in and `auth.uid()` is checked on the first line of each.
 *
 * ⚠️ AND EVERY ONE OF THEM HAS A `previewMember` GUARD, which is a thing a production module would
 * rather not know about and has to. The no-local-copy rule above means that signed out there is
 * nothing to show — and the dev member preview is signed out, since it flips UI gates and never
 * makes a session. So without these the harness renders the empty room and nothing else, which it
 * did: a tick of 375px audits passed against a room holding a paragraph and two buttons.
 *
 * The guard is `import.meta.env.DEV &&` at its source, so in a production build `previewMember`
 * is statically false and each branch is dead code. Seven other members-only modules take the
 * same import for the same reason — see dev/previewMember.ts and dev/chroniclePreview.ts, which
 * is careful about what it does and does not prove.
 */

/** What the server hands back for one goal — see chronicle_goals_mine. */
type Row = {
  id: string
  title: string
  scope: Scope
  anchor: string | null
  every: number | null
  target: number | null
  unit: string | null
  progress: number | string | null
  done: boolean
  note: string | null
  sort: number | null
  activity: string | null
  cat: Goal['cat']
  counts: Goal['counts']
  est: number | string | null
  priority: number | string | null
}

/**
 * ⚠️ `numeric` ARRIVES AS A STRING, which is postgres being careful rather than a bug: a numeric
 * can hold more precision than a double, so the driver will not silently narrow it. Read as-is it
 * makes `progress / target` a string division that happens to work and `progress + 1` the string
 * "631" — so it is coerced here, at the one door the data comes through, rather than at each of
 * the places that do arithmetic on it.
 */
const num = (v: number | string | null | undefined, d = 0): number => {
  const n = typeof v === 'string' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? n : d
}

const read = (r: Row): Goal => ({
  id: String(r.id),
  title: String(r.title ?? ''),
  scope: r.scope,
  anchor: r.anchor ?? null,
  every: r.every == null ? null : num(r.every, 1),
  target: r.target == null ? null : num(r.target),
  unit: r.unit ?? null,
  progress: num(r.progress),
  done: !!r.done,
  note: r.note ?? null,
  sort: num(r.sort),
  activity: r.activity ?? null,
  cat: r.cat ?? null,
  /* ⚠️ anything but 'amount' is minutes, so a row from before this column existed reads as the
     thing it has always been rather than as undefined */
  counts: r.counts === 'amount' ? 'amount' : 'minutes',
  /* ⚠️ a row from before these columns existed reads as the thing it has always been — no guess
     and no flag — rather than as undefined */
  est: r.est == null ? null : num(r.est) || null,
  priority: (Math.min(Math.max(num(r.priority), 0), 2) || 0) as Goal['priority'],
})

/** Every goal of mine. Empty rather than throwing, so a dead network is a quiet room. */
export async function myGoals(): Promise<Goal[]> {
  if (previewMember) return pvGoals()
  const { data, error } = await getSupabaseClient().rpc('chronicle_goals_mine')
  if (error || !Array.isArray(data)) return []
  return (data as Row[]).map(read)
}

export type NewGoal = {
  id?: string
  title: string
  scope: Scope
  anchor: string | null
  every: number | null
  target: number | null
  unit: string | null
  note?: string | null
  sort?: number
  /** one of these at most — see Goal.activity, and the check constraint behind it */
  activity?: string | null
  cat?: Goal['cat']
  counts?: Goal['counts']
  est?: number | null
  priority?: Goal['priority']
}

/**
 * Save one, new or edited. Returns its id, or null if the server refused.
 *
 * ⚠️ THE REFUSAL IS RETURNED RATHER THAN THROWN, and the message matters: the ceiling of 500 goals
 * per person is enforced in the function, so "that is 500 goals" is a sentence somebody needs to
 * read. A thrown error here would be swallowed by the handler and the save would look like a
 * no-op, which is the failure mode library/cloud.ts has a long note about.
 */
export async function saveGoal(g: NewGoal): Promise<{ id: string } | { why: string }> {
  if (previewMember) return pvSaveGoal(g)
  const { data, error } = await getSupabaseClient().rpc('chronicle_goal_save', {
    p_id: g.id ?? null,
    p_title: g.title,
    p_scope: g.scope,
    p_anchor: g.anchor,
    p_repeat: g.every,
    p_target: g.target,
    p_unit: g.unit,
    p_note: g.note ?? null,
    p_sort: g.sort ?? 0,
    p_activity: g.activity ?? null,
    p_cat: g.cat ?? null,
    p_counts: g.counts ?? 'minutes',
    p_est: g.est ?? null,
    p_priority: g.priority ?? 0,
  })
  if (error) return { why: error.message || 'that did not save' }
  /**
   * ⚠️ NO ID IS A REFUSAL, NOT A SUCCESS. This read `String(data)` and returned it, which turns a
   * null into the id "null" — and the caller, seeing no `why`, clears the form and reloads. The
   * list comes back without the goal and the whole thing reads as a save that silently did
   * nothing, which is the exact failure this function's own note is about. The function always
   * returns an id when it succeeds and raises when it does not, so an empty answer with no error
   * is a case nobody has a story for and must not be dressed up as one.
   */
  const id = data == null ? '' : String(data)
  return id ? { id } : { why: 'that did not save — nothing came back' }
}

/** Move a goal along, or tick it. `done` false un-ticks. */
export async function setProgress(id: string, progress: number, done: boolean): Promise<boolean> {
  if (previewMember) return pvProgress(id, progress, done)
  const { error } = await getSupabaseClient().rpc('chronicle_goal_progress', {
    p_id: id,
    p_progress: progress,
    p_done: done,
  })
  return !error
}

export async function dropGoal(id: string): Promise<boolean> {
  if (previewMember) return pvDropGoal(id)
  const { error } = await getSupabaseClient().rpc('chronicle_goal_drop', { p_id: id })
  return !error
}

/* ── the record ─────────────────────────────────────────────────────────────── */

/**
 * ⚠️ THE SAME NO-LOCAL-COPY RULE AS THE GOALS ABOVE, and it matters more here. The running timer
 * IS the open entry in the database — that is what lets it survive a closed tab and show up on a
 * phone — so a local mirror would be a second opinion about what you are doing right now. The
 * table has a partial unique index making two open entries impossible, which is the same decision
 * enforced one layer down.
 */
export async function myActivities(): Promise<Activity[]> {
  if (previewMember) return pvActivities()
  const { data, error } = await getSupabaseClient().rpc('chronicle_activities_mine')
  if (error || !Array.isArray(data)) return []
  return (data as Activity[]).map((a) => ({
    id: String(a.id),
    name: String(a.name ?? ''),
    cat: a.cat,
    colour: a.colour ?? null,
    archived: !!a.archived,
    auto: !!a.auto,
    metric: a.metric ?? null,
  }))
}

export async function saveActivity(
  name: string,
  cat: Activity['cat'],
  colour: string | null,
  id?: string,
  metric?: string | null,
): Promise<{ id: string } | { why: string }> {
  if (previewMember) return pvSaveActivity(name, cat, colour, id, metric)
  const { data, error } = await getSupabaseClient().rpc('chronicle_activity_save', {
    p_id: id ?? null,
    p_name: name,
    p_cat: cat,
    p_colour: colour,
    p_metric: metric ?? null,
  })
  if (error) return { why: error.message || 'that did not save' }
  const made = data == null ? '' : String(data)
  return made ? { id: made } : { why: 'that did not save — nothing came back' }
}

export async function archiveActivity(id: string, archived: boolean): Promise<boolean> {
  if (previewMember) return pvArchive(id, archived)
  const { error } = await getSupabaseClient().rpc('chronicle_activity_archive', {
    p_id: id,
    p_archived: archived,
  })
  return !error
}

/** Start a timer. Whatever was running stops; a run under a second leaves no trace. */
export async function startTimer(activity: string): Promise<{ why: string } | null> {
  if (previewMember) return pvStart(activity)
  const { error } = await getSupabaseClient().rpc('chronicle_start', { p_activity: activity })
  return error ? { why: error.message || 'that did not start' } : null
}

/** Stop whatever is running. Stopping nothing is not an error — see the function's own note. */
export async function stopTimer(note: string | null): Promise<{ why: string } | null> {
  if (previewMember) return pvStop(note)
  const { error } = await getSupabaseClient().rpc('chronicle_stop', { p_note: note })
  return error ? { why: error.message || 'that did not stop' } : null
}

/**
 * The log over a range.
 *
 * ⚠️ A RANGE RATHER THAN EVERYTHING, because after a year this is thousands of rows and every view
 * of it is a day or a week. The server refuses a range over 400 days and one that ends before it
 * starts, so a bad call is a message rather than a download.
 */
export async function entriesBetween(fromISO: string, toISO: string): Promise<Entry[]> {
  if (previewMember) return pvEntries(fromISO, toISO)
  const { data, error } = await getSupabaseClient().rpc('chronicle_entries_between', {
    p_from: fromISO,
    p_to: toISO,
  })
  if (error || !Array.isArray(data)) return []
  return (data as Entry[]).map((e) => ({
    id: String(e.id),
    activity: String(e.activity),
    start: String(e.start),
    end: e.end ? String(e.end) : null,
    note: e.note ?? null,
    amount: e.amount == null ? null : num(e.amount as number | string | null),
  }))
}

/** A span you forgot to time, which is the commonest hole in any log. */
export async function addEntry(
  activity: string,
  fromISO: string,
  toISO: string,
  note: string | null,
): Promise<{ why: string } | null> {
  if (previewMember) return pvAddEntry(activity, fromISO, toISO, note)
  const { error } = await getSupabaseClient().rpc('chronicle_entry_add', {
    p_activity: activity,
    p_from: fromISO,
    p_to: toISO,
    p_note: note,
  })
  return error ? { why: error.message || 'that did not save' } : null
}

export async function dropEntry(id: string): Promise<boolean> {
  if (previewMember) return pvDropEntry(id)
  const { error } = await getSupabaseClient().rpc('chronicle_entry_drop', { p_id: id })
  return !error
}

/**
 * How much the record says has been done, for the derived goals on screen.
 *
 * ⚠️ ONE CALL FOR ALL OF THEM, because a window's worth of goals is a handful and a round trip
 * each would make the room's load time a function of how much somebody is aiming at. The server
 * caps the batch at 200.
 *
 * ⚠️ AND THE ASKS CARRY WINDOWS, NOT SOURCES. What to count comes off the goal's own row inside
 * the function — see its note. A caller that could name an activity could name somebody else's.
 *
 * ⚠️ AND EACH ASK MAY CARRY ITS OWN KEY, which is what lets one goal be asked about thirty
 * windows at once. Without it the result was keyed by goal id and postgres silently kept the last
 * of a duplicate — so a streak was unaskable. Omitting the key still answers by goal id.
 */
export async function tally(
  asks: Array<{ id: string; from: string; to: string; key?: string }>,
): Promise<Record<string, number>> {
  if (!asks.length) return {}
  if (previewMember) return pvTally(asks)
  const { data, error } = await getSupabaseClient().rpc('chronicle_tally', { p_asks: asks })
  if (error || !data || typeof data !== 'object') return {}
  const out: Record<string, number> = {}
  for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
    /* ⚠️ numeric arrives as a string — see the note on num above */
    out[k] = num(v as number | string | null)
  }
  return out
}

/** One row per activity: what a stretch of time actually held. */
export type Total = {
  activity: string
  name: string
  cat: Activity['cat']
  auto: boolean
  mins: number
  metric: string | null
  /** the metric's total for the window, or null when the activity has no metric */
  amount: number | null
}

/**
 * What a window actually held, summed on the server.
 *
 * ⚠️ SUMMED THERE RATHER THAN HERE, because the point of it is the long views: a month is a few
 * hundred entries and a year a few thousand, so adding them up in the browser would make "what did
 * I do this year" the most expensive thing in the room. One row per activity comes back instead —
 * and it shares `chronicle_minutes` with the goal tally, so a total and a goal cannot disagree
 * about the same stretch of time.
 */
export async function totalsBetween(fromISO: string, toISO: string): Promise<Total[]> {
  if (previewMember) return pvTotals(fromISO, toISO)
  const { data, error } = await getSupabaseClient().rpc('chronicle_totals', {
    p_from: fromISO,
    p_to: toISO,
  })
  if (error || !Array.isArray(data)) return []
  return (data as Total[]).map((r) => ({
    activity: String(r.activity),
    name: String(r.name ?? ''),
    cat: r.cat,
    auto: !!r.auto,
    /* numeric arrives as a string — see the note on num above */
    mins: num(r.mins as number | string | null),
    metric: r.metric ?? null,
    amount: r.amount == null ? null : num(r.amount as number | string | null),
  }))
}

/**
 * Move the ends of a logged span, or close a running one.
 *
 * ⚠️ IT CANNOT RE-OPEN A TIMER, deliberately: the end is required, because a null end would make a
 * second entry with no end possible and `chronicle_one_running` exists to keep that at exactly one.
 * Starting is `startTimer` and nothing else.
 */
export async function editEntry(
  id: string,
  fromISO: string,
  toISO: string,
  note: string | null,
): Promise<{ why: string } | null> {
  if (previewMember) return pvEditEntry(id, fromISO, toISO, note)
  const { error } = await getSupabaseClient().rpc('chronicle_entry_edit', {
    p_id: id,
    p_from: fromISO,
    p_to: toISO,
    p_note: note,
  })
  return error ? { why: error.message || 'that did not save' } : null
}

/* ── routines ───────────────────────────────────────────────────────────────── */

/** An ordered list of things you do together. `mins` is a suggestion, not a limit. */
export type Routine = {
  id: string
  name: string
  steps: Array<{ activity: string; mins: number | null }>
}

export async function myRoutines(): Promise<Routine[]> {
  if (previewMember) return pvRoutines()
  const { data, error } = await getSupabaseClient().rpc('chronicle_routines_mine')
  if (error || !Array.isArray(data)) return []
  return (data as Routine[]).map((r) => ({
    id: String(r.id),
    name: String(r.name ?? ''),
    steps: Array.isArray(r.steps)
      ? r.steps.map((s) => ({
          activity: String(s.activity),
          mins: s.mins == null ? null : num(s.mins as number | string | null, 0) || null,
        }))
      : [],
  }))
}

/**
 * Save a routine, new or edited.
 *
 * ⚠️ THE WHOLE LIST EVERY TIME, which is what makes reordering and removing a step one write
 * rather than three. The server rebuilds `steps` from what it is given, dropping any step naming
 * an activity that is not yours — see chronicle_routine_save.
 */
export async function saveRoutine(
  name: string,
  steps: Array<{ activity: string; mins: number | null }>,
  id?: string,
): Promise<{ id: string } | { why: string }> {
  if (previewMember) return pvSaveRoutine(name, steps, id)
  const { data, error } = await getSupabaseClient().rpc('chronicle_routine_save', {
    p_id: id ?? null,
    p_name: name,
    p_steps: steps.map((s) => ({
      activity: s.activity,
      mins: s.mins == null ? null : String(s.mins),
    })),
  })
  if (error) return { why: error.message || 'that did not save' }
  const made = data == null ? '' : String(data)
  return made ? { id: made } : { why: 'that did not save — nothing came back' }
}

export async function dropRoutine(id: string): Promise<boolean> {
  if (previewMember) return pvDropRoutine(id)
  const { error } = await getSupabaseClient().rpc('chronicle_routine_drop', { p_id: id })
  return !error
}

/**
 * How much of its metric a session produced. Null clears it.
 *
 * ⚠️ ITS OWN CALL RATHER THAN A PARAMETER ON stop, add AND edit — those three would each have
 * needed a new signature, and the amount is something you remember afterwards at least as often
 * as at the time. One door, usable whenever.
 */
export async function setAmount(id: string, amount: number | null): Promise<boolean> {
  if (previewMember) return pvAmount(id, amount)
  const { error } = await getSupabaseClient().rpc('chronicle_entry_amount', {
    p_id: id,
    p_amount: amount,
  })
  return !error
}

/* ── plans ──────────────────────────────────────────────────────────────────── */

/**
 * The spans you intend to spend, over a range.
 *
 * ⚠️ ASCENDING, unlike `entriesBetween`, which is newest-first. A log is read backwards and a plan
 * is read forwards: "what is next" is the question a list of intentions answers.
 */
export async function plansBetween(fromISO: string, toISO: string): Promise<Plan[]> {
  if (previewMember) return pvPlans(fromISO, toISO)
  const { data, error } = await getSupabaseClient().rpc('chronicle_plans_between', {
    p_from: fromISO,
    p_to: toISO,
  })
  if (error || !Array.isArray(data)) return []
  return (data as Plan[]).map((p) => ({
    id: String(p.id),
    activity: String(p.activity),
    start: String(p.start),
    end: p.end ? String(p.end) : null,
    note: p.note ?? null,
  }))
}

export async function savePlan(
  activity: string,
  fromISO: string,
  toISO: string,
  note: string | null,
  id?: string,
): Promise<{ id: string } | { why: string }> {
  if (previewMember) return pvPlanSave(activity, fromISO, toISO, note, id)
  const { data, error } = await getSupabaseClient().rpc('chronicle_plan_save', {
    p_id: id ?? null,
    p_activity: activity,
    p_from: fromISO,
    p_to: toISO,
    p_note: note,
  })
  if (error) return { why: error.message || 'that did not save' }
  const made = data == null ? '' : String(data)
  return made ? { id: made } : { why: 'that did not save — nothing came back' }
}

export async function dropPlan(id: string): Promise<boolean> {
  if (previewMember) return pvPlanDrop(id)
  const { error } = await getSupabaseClient().rpc('chronicle_plan_drop', { p_id: id })
  return !error
}

/**
 * Turn an intention into the record: one tap that logs the plan's span as time spent.
 *
 * ⚠️ THE PLAN SURVIVES IT, deliberately. Deleting it on the way past would make the comparison the
 * whole feature exists for read "planned nothing, did an hour" the moment you agreed with
 * yourself. The plan is what you meant; the entry is what happened; the point is seeing both.
 */
export async function planDid(id: string): Promise<{ why: string } | null> {
  if (previewMember) return pvPlanDid(id)
  const { error } = await getSupabaseClient().rpc('chronicle_plan_did', { p_id: id })
  return error ? { why: error.message || 'that did not save' } : null
}
