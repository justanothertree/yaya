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
  pvExport,
  pvFixRunning,
  pvImport,
  pvQuality,
  pvMoods,
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
  pvMemberChronicle,
  pvShareGoal,
  pvSince,
  pvSpans,
  pvVisit,
  pvFriendsLog,
  pvNoteRunning,
} from '../dev/chroniclePreview'
import { inBatches } from './goal'
import { SPANS_AT_ONCE } from './year'
import type { Goal, Scope } from './goal'
import type { Plan } from './plan'
import type { Activity, Entry, Moods } from './record'

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
  /* optional: a bundle talking to a server from before the column existed gets nothing here */
  shared?: boolean
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
  /* a row from before the column existed is not shared, which is the safe reading */
  shared: r.shared === true,
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
    /**
     * ⚠️ NULL, NOT ZERO, AND THE DIFFERENCE IS A DELETE. `NewGoal` has no sort and the goal form
     * never sets one, so this was `?? 0` on every save — and `chronicle_goal_save` said
     * `sort = coalesce(p_sort, 0)`, which cannot tell "put it at zero" from "I am not talking
     * about this". Both `chronicle_goals_mine` and `get_member_chronicle` order by sort, so an
     * edit moved the goal in the room and on the profile. The server leaves it alone on null now;
     * this is the half that has to stop saying something.
     */
    p_sort: g.sort ?? null,
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

/**
 * Put one goal on your profile, or take it off.
 *
 * ⚠️ ITS OWN FUNCTION RATHER THAN A FIFTEENTH PARAMETER ON saveGoal, which is both one concern
 * and no drop-and-recreate of the save path everything else goes through.
 */
export async function shareGoal(id: string, on: boolean): Promise<boolean> {
  if (previewMember) return pvShareGoal(id, on)
  const { error } = await getSupabaseClient().rpc('chronicle_goal_share', { p_id: id, p_on: on })
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
    /* a bundle talking to a server from before the column existed gets nothing here, and
       `false` is the right reading of that silence — see the goals' `shared` above */
    shared: !!a.shared,
    auto: !!a.auto,
    metric: a.metric ?? null,
    session: a.session == null ? null : num(a.session as number | string | null) || null,
  }))
}

export async function saveActivity(
  name: string,
  cat: Activity['cat'],
  colour: string | null,
  id?: string,
  metric?: string | null,
  session?: number | null,
  /**
   * ⚠️ UNDEFINED MEANS "I AM NOT TALKING ABOUT THIS", and it reaches the server as null, where
   * `shared = coalesce(p_shared, shared)` leaves the flag alone. The add form does not offer the
   * tick — a brand new activity is private and the row's default says so — so it must be able to
   * stay quiet without un-sharing anything. CLAUDE.md §8.
   */
  shared?: boolean,
): Promise<{ id: string } | { why: string }> {
  if (previewMember) return pvSaveActivity(name, cat, colour, id, metric, session, shared)
  const { data, error } = await getSupabaseClient().rpc('chronicle_activity_save', {
    p_id: id ?? null,
    p_name: name,
    p_cat: cat,
    p_colour: colour,
    p_metric: metric ?? null,
    p_session: session ?? null,
    p_shared: shared ?? null,
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
    quality: e.quality == null ? null : num(e.quality as number | string | null) || null,
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
 * caps the batch at `ASKS_AT_ONCE` — ⚠️ which this said was 200 and is 1,200; the number was
 * raised when the function was rewritten and the sentence beside it was not. It is a named
 * constant now rather than a figure typed in two places.
 *
 * ⚠️ AND MORE THAN ONE CALL WHEN THERE HAS TO BE. The streak fetch asks thirty-one windows per
 * repeating derived goal, so thirty-nine of them is 1,209 asks: over the cap, refused, turned
 * into `{}` here, and every streak on the site disappears with nothing saying why. Split into
 * batches the server will take. A batch that fails is skipped rather than losing the rest —
 * some streaks beat none.
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
  const out: Record<string, number> = {}
  for (const some of inBatches(asks)) {
    const { data, error } = await getSupabaseClient().rpc('chronicle_tally', { p_asks: some })
    if (error || !data || typeof data !== 'object') continue
    for (const [k, v] of Object.entries(data as Record<string, unknown>)) {
      /* ⚠️ numeric arrives as a string — see the note on num above */
      out[k] = num(v as number | string | null)
    }
  }
  return out
}

/** One row per activity: what a stretch of time actually held. */
export type Total = {
  activity: string
  name: string
  cat: Activity['cat']
  auto: boolean
  /** the activity's own colour, so a reader of totals can draw the same dot the day log does */
  colour: string | null
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
    colour: r.colour ?? null,
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
/**
 * Change a finished session: when it was, and what it was.
 *
 * ⚠️ `activity` NULL MEANS LEAVE IT ALONE, not "no activity" — an entry always has one, the
 * column is NOT NULL, and that reading is what let the server grow this parameter without
 * breaking the bundle somebody already had open. The server checks the activity belongs to the
 * caller; a uuid naming somebody else's is refused rather than quietly accepted by the foreign
 * key. See docs/2026-10-13-chronicle-entry-move.sql.
 */
export async function editEntry(
  id: string,
  fromISO: string,
  toISO: string,
  note: string | null,
  activity?: string | null,
): Promise<{ why: string } | null> {
  if (previewMember) return pvEditEntry(id, fromISO, toISO, note, activity ?? null)
  const { error } = await getSupabaseClient().rpc('chronicle_entry_edit', {
    p_id: id,
    p_from: fromISO,
    p_to: toISO,
    p_note: note,
    p_activity: activity ?? null,
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

/**
 * How a session went. Null clears it.
 *
 * ⚠️ ITS OWN CALL, like `setAmount` beside it and for the same reason: stop, add and edit would
 * each have needed a new signature, and how a session went is something you decide afterwards at
 * least as often as at the time.
 */
export async function setQuality(id: string, quality: number | null): Promise<boolean> {
  if (previewMember) return pvQuality(id, quality)
  const { error } = await getSupabaseClient().rpc('chronicle_entry_quality', {
    p_id: id,
    p_quality: quality,
  })
  return !error
}

/**
 * A window's minutes by rating — '1'…'5' and 'none'.
 *
 * ⚠️ SUMMED ON THE SERVER, like `totalsBetween`, because the windows this is wanted for are a
 * month and a year. And the numbers are RAW ratings rather than buckets: see `moodOf`, which owns
 * the rule about which of them count as good.
 */
export async function moodsBetween(fromISO: string, toISO: string): Promise<Moods> {
  if (previewMember) return pvMoods(fromISO, toISO)
  const { data, error } = await getSupabaseClient().rpc('chronicle_moods', {
    p_from: fromISO,
    p_to: toISO,
  })
  if (error || !data || typeof data !== 'object') return {}
  const out: Moods = {}
  for (const [k, v] of Object.entries(data as Record<string, unknown>))
    out[k] = num(v as number | string | null)
  return out
}

/**
 * Time on the site, recorded without being asked for — see chronicle/useVisits.ts.
 *
 * ⚠️ IT CAME THROUGH HERE LATE. useVisits called `getSupabaseClient().rpc` itself, which made it
 * the one chronicle call with no preview route: in the dev harness it reached for a Supabase
 * session that does not exist, failed, and swallowed the failure. So the one feature that writes
 * rows on its own, for every member, without anybody pressing anything, was also the only one that
 * could not be watched doing it. That is the shape of the blind spot §6g was about.
 *
 * ⚠️ AND THE SERVER CLAMPS TO BETWEEN THIRTY SECONDS AND TEN MINUTES, which is worth knowing
 * before trusting any arithmetic here: a single report can never claim more than ten minutes
 * however long the caller says it was.
 */
export async function recordVisit(room: string, secs: number): Promise<void> {
  if (previewMember) return pvVisit(room, secs)
  const { error } = await getSupabaseClient().rpc('chronicle_visit', {
    p_module: room,
    p_seconds: Math.round(secs),
  })
  /* ⚠️ a visit that does not land is not worth telling anybody about — see useVisits */
  void error
}

/**
 * Everything you have recorded, as one file.
 *
 * ⚠️ THE ONE STORE ON THIS SITE WITH NO LOCAL COPY. Songs, drawings, looks and minions are
 * localStorage with the account as a mirror, and the Account page offers all four as a file
 * because "a file is the copy that survives losing the account". Chronicle went the other way on
 * purpose — see the note at the top of this module — which is right for a record that has to be
 * the same on a phone and a laptop, and which left it the only thing here nobody could take out.
 *
 * ⚠️ IT IS ONE RPC RETURNING ONE DOCUMENT, not five calls returning five lists. A list comes back
 * through PostgREST, which can cap rows; a cap applied quietly would turn "everything you ever
 * recorded" into "some of it", with the download looking exactly as successful either way. One
 * row cannot be truncated by a row limit. See docs/2026-10-13-chronicle-export.sql.
 */
export async function exportMine(): Promise<Record<string, unknown> | null> {
  if (previewMember) return pvExport()
  const { data, error } = await getSupabaseClient().rpc('chronicle_export')
  if (error || !data || typeof data !== 'object') return null
  return data as Record<string, unknown>
}

/** What a put-back did: how many of each went in, and how many the account already had. */
export type Putback = {
  activities: number
  entries: number
  goals: number
  routines: number
  plans: number
  skipped: number
}

/**
 * Put a file back.
 *
 * ⚠️ IT ADDS, IT NEVER REPLACES, which is the same promise the Account page makes about the other
 * backup and the reason this is safe to press. A row whose id the account already has is skipped,
 * so restoring onto a machine that has been used since cannot overwrite the newer thing with the
 * older one — and `skipped` is counted rather than hidden, because "nothing happened" and
 * "everything in that file was already here" are different things to be told.
 *
 * ⚠️ AND IT IS WHY A TAMPERED FILE CANNOT REACH SOMEBODY ELSE'S ROW. The ids in a file are the
 * ids the rows had, and a file can be edited by anybody; `on conflict (id) do nothing` means an
 * id that exists is skipped rather than written to, whoever owns it. There is no update path in
 * chronicle_import at all. See docs/2026-10-13-chronicle-import.sql.
 */
export async function importMine(doc: unknown): Promise<Putback | { why: string }> {
  if (previewMember) return pvImport(doc)
  const { data, error } = await getSupabaseClient().rpc('chronicle_import', { p_doc: doc })
  if (error) return { why: error.message || 'that file could not be put back' }
  if (!data || typeof data !== 'object') return { why: 'that file could not be put back' }
  const r = data as Record<string, unknown>
  const n = (k: string) => (typeof r[k] === 'number' ? (r[k] as number) : 0)
  return {
    activities: n('activities'),
    entries: n('entries'),
    goals: n('goals'),
    routines: n('routines'),
    plans: n('plans'),
    skipped: n('skipped'),
  }
}

/**
 * Correct the session you are in the middle of — when it began, and what it is.
 *
 * ⚠️ THE TWO MISTAKES YOU NOTICE WHILE WORKING, which both used to have the same remedy: press
 * Stop. That ends the session at a moment you did not choose and leaves you starting a second one,
 * which is a worse record of the day than the one you were trying to fix. Pressing Start on the
 * wrong activity, and pressing it twenty minutes after you actually began, are the two.
 *
 * ⚠️ NULL LEAVES EACH ONE ALONE, and there is no way to set an end: the open entry is open because
 * it has no end, and typing one in is what Stop is for. See chronicle_running_fix.
 */
export async function fixRunning(
  fromISO: string | null,
  activity: string | null,
): Promise<{ why: string } | null> {
  if (previewMember) return pvFixRunning(fromISO, activity)
  const { error } = await getSupabaseClient().rpc('chronicle_running_fix', {
    p_from: fromISO,
    p_activity: activity,
  })
  return error ? { why: error.message || 'that did not save' } : null
}

/**
 * Say what the session you are IN is about, without ending it.
 *
 * ⚠️ IT OVERTURNS THE NOTE ABOVE, deliberately and on request. `fixRunning` says "there is no way
 * to set an end: the open entry is open because it has no end, and typing one in is what Stop is
 * for" — true of the END, and taken to cover the NOTE too, so a sitting could only be described
 * once it was over. The thing worth writing down is what you are doing WHILE you do it.
 *
 * ⚠️ ITS OWN FUNCTION rather than a third parameter on `fixRunning`, because `create or replace`
 * cannot add one without minting an overload — the same reason `setAmount` and `setQuality` sit
 * beside `editEntry` instead of inside it.
 *
 * ⚠️ AND '' CLEARS HERE, where null means "leave it alone" everywhere else in this room. It can
 * mean that there because those callers write other columns in the same breath; this writes one
 * column and nothing else, so calling it at all is the statement of intent.
 */
export async function noteRunning(note: string): Promise<{ why: string } | null> {
  if (previewMember) return pvNoteRunning(note)
  const { error } = await getSupabaseClient().rpc('chronicle_running_note', { p_note: note })
  return error ? { why: error.message || 'that did not save' } : null
}

/**
 * Somebody else's chronicle, as their profile block shows it.
 *
 * ⚠️ THE ONLY READ IN THIS FILE THAT IS NOT ABOUT YOU, which is why it is at the bottom with a
 * note on it. Every other function here is scoped to `auth.uid()` by the RPC behind it;
 * get_member_chronicle takes a username and answers about somebody else — but only when that
 * person has a chronicle block on their page AND the viewer may see that block. No block, no
 * answer. The gate is the block's own visibility and nothing else, and it lives in SQL where it is
 * enforceable rather than here. See docs/2026-10-14-chronicle-profile-block.sql.
 *
 * Null means all of "no such member", "no chronicle block" and "not for you" — deliberately the
 * same answer, so this cannot be used to find out who exists.
 */
export type MemberChronicle = {
  /** the window the figures cover, in days — the block's owner picks it */
  days: number
  time: Partial<Record<'locked' | 'free' | 'life', number>>
  top: Array<{ name: string; cat: string; colour: string | null; mins: number }>
  /**
   * The goals their owner ticked, at most six.
   *
   * ⚠️ TWO SWITCHES AND BOTH ARE REQUIRED — the block asks for goals, and each goal is shared one
   * at a time. Empty when either is off, which is also what it is for somebody who may not see.
   *
   * ⚠️ AND NO PROGRESS FIGURE. A goal's window comes from `goalWindow` here in the client, and
   * the server has no copy of those rules — which is exactly why `chronicle_tally` takes its
   * windows FROM the caller. A second copy of six scopes' worth of date arithmetic, living in SQL
   * and having to agree with this one forever, buys a progress bar and costs the thing this
   * repository has the most scar tissue about. What a shared goal says is what it IS.
   */
  goals: Array<{ title: string; target: number | null; unit: string | null; done: boolean }>
  /**
   * What they are doing at this moment, or null.
   *
   * ⚠️ ONLY WHEN A BLOCK THEY CAN SEE ASKED FOR IT, decided in SQL from the block's own config
   * and never from a parameter — unlike `days`. The window is not a privacy boundary: somebody who
   * opted into showing their hours did not make a different decision about 7 of them versus 90.
   * What they are doing right now, by name, IS a different decision, so there is deliberately no
   * way for a caller to ask for it.
   */
  now: { name: string; cat: string; colour: string | null; mins: number } | null
  reached: number
  open: number
}

/**
 * ⚠️ 'failed' IS NOT 'null', AND COLLAPSING THEM WOULD HAVE BEEN A LIE ON THE PAGE. This block
 * only renders at all when get_profile_blocks has already handed it over, which applies `can_see`
 * — so by the time anything calls this, the viewer is allowed. A null here therefore means the
 * record is genuinely empty; an ERROR means a parameter name drifted, or the session went, or the
 * grant was lost. Reported as the same `null` they would read identically on screen as "Nothing
 * recorded lately", which is the exact shape this repository keeps getting caught by: a call that
 * is not working and an account that is empty look the same, and the empty one passes every check.
 */
export type MemberChronicleResult = MemberChronicle | null | 'failed'

export async function memberChronicle(
  username: string,
  days: number,
  /** ⚠️ the DOUBLE needs telling; the real server reads it off the block and ignores callers */
  live = false,
  wantsGoals = false,
): Promise<MemberChronicleResult> {
  if (previewMember) return pvMemberChronicle(days, live, wantsGoals)
  const { data, error } = await getSupabaseClient().rpc('get_member_chronicle', {
    p_username: username,
    /* ⚠️ the server clamps this to 1–90 and does not trust it — it is which span to cover, not
       permission to cover it. The gate is the block's own visibility, checked there. */
    p_days: days,
  })
  if (error) return 'failed'
  return (data as MemberChronicle | null) ?? null
}

/**
 * How far back the record goes, as milliseconds, or null for somebody who has recorded nothing.
 *
 * ⚠️ NULL RATHER THAN TODAY for an empty record, because "you have been at this since today"
 * is a sentence about nothing, and the view it feeds needs to tell those two apart.
 */
export async function recordedSince(): Promise<number | null> {
  if (previewMember) return pvSince()
  const { data, error } = await getSupabaseClient().rpc('chronicle_since')
  if (error || data == null) return null
  const ms = Date.parse(String(data))
  return Number.isFinite(ms) ? ms : null
}

/**
 * Category totals for a batch of windows, keyed however the caller keyed them.
 *
 * ⚠️ THE WINDOWS COME FROM HERE, which is the point — see `yearsBetween` in year.ts. A year
 * begins at local midnight and the server does not know the zone; an offset would be an hour wrong
 * across a daylight-saving change. `chronicle_tally` is asked its questions the same way.
 */
export async function spanTotals(
  asks: Array<{ key: string; from: string; to: string }>,
): Promise<Record<string, Partial<Record<'locked' | 'free' | 'life', number>>>> {
  if (!asks.length) return {}
  /**
   * ⚠️ IN BATCHES, BECAUSE THE SERVER REFUSES MORE THAN `SPANS_AT_ONCE` — and this sent whatever
   * it was handed. `chronicle_tally` has been batched since the streaks made it necessary; its
   * sibling never was, and nothing noticed because the limit is 120 years. See SPANS_AT_ONCE for
   * how one mistyped date reaches it, and why the symptom is a silent blank rather than an error.
   *
   * ⚠️ A FAILED BATCH IS SKIPPED, NOT FATAL, which is what `tally` does: a year whose figures did
   * not arrive reads as a year with nothing in it, and that is better than the whole list going.
   */
  const out: Record<string, Partial<Record<'locked' | 'free' | 'life', number>>> = {}
  for (const some of inBatches(asks, SPANS_AT_ONCE)) {
    if (previewMember) {
      Object.assign(out, pvSpans(some))
      continue
    }
    const { data, error } = await getSupabaseClient().rpc('chronicle_spans', { p_asks: some })
    if (error || !data || typeof data !== 'object') continue
    Object.assign(out, data as Record<string, Partial<Record<'locked' | 'free' | 'life', number>>>)
  }
  return out
}

/**
 * One sitting of somebody else's, as it crosses to a friend.
 *
 * ⚠️ WHAT IS ABSENT IS THE PART WORTH READING. There is no `note` and no `quality`, and neither
 * is an oversight: the profile card draws a list of what it never shows, that list is built from
 * the same flags that draw the card so it cannot go stale, and "your notes" is in it. A timeline
 * carrying notes would make that card a liar. A rating is a feeling about a sitting rather than a
 * fact about it, so it goes with the note. What crosses is what, when, how long, and how much.
 */
export type FriendSitting = {
  /** their username, which is the handle a profile is reached by */
  who: string
  /** what to call them on screen — their first name if they gave one */
  name: string
  activity: string
  cat: 'locked' | 'free' | 'life'
  colour: string | null
  start: string
  end: string
  amount: number | null
  metric: string | null
}

/**
 * What your friends have been doing, newest first.
 *
 * ⚠️ THREE SWITCHES DECIDE THIS AND NONE OF THEM IS A PARAMETER. The owner needs a chronicle
 * block on their profile, that block must ask for a timeline, and the activity itself must be
 * ticked — all read in SQL. The window below is a convenience and never a boundary, which is the
 * same split `get_member_chronicle` makes between its `days` and its `live`.
 *
 * ⚠️ FRIENDS, FIXED, AND NOT THE BLOCK'S OWN TIER. A chronicle block may be set to 'members', and
 * that choice was made about hours and a top five. This is every sitting with its clock times,
 * which is strictly more, so the wider tier does not carry — CLAUDE.md §3. There is no argument
 * here that could widen it.
 *
 * ⚠️ AND CLOSED SITTINGS ONLY, which is correctness rather than caution: "what I'm doing right
 * now" is already its own opt-in, and a timeline including the open sitting would hand that over
 * through a switch that says nothing about it.
 */
export async function friendsLog(fromISO: string, toISO: string): Promise<FriendSitting[]> {
  if (previewMember) return pvFriendsLog(fromISO, toISO)
  const { data, error } = await getSupabaseClient().rpc('chronicle_friends_log', {
    p_from: fromISO,
    p_to: toISO,
  })
  if (error || !Array.isArray(data)) return []
  return (
    (data as Array<Record<string, unknown>>)
      .map((r) => ({
        who: String(r.who ?? ''),
        name: String(r.name ?? r.who ?? ''),
        activity: String(r.activity ?? ''),
        cat: (r.cat === 'locked' || r.cat === 'life' ? r.cat : 'free') as FriendSitting['cat'],
        colour: typeof r.colour === 'string' ? r.colour : null,
        start: String(r.started_at ?? ''),
        end: String(r.ended_at ?? ''),
        amount: r.amount == null ? null : Number(r.amount),
        metric: typeof r.metric === 'string' ? r.metric : null,
      }))
      /* ⚠️ a row with no end cannot be drawn on a timeline and should not exist — the function
       filters them — so this is a belt the server already wears, kept because the one thing it
       guards is the separate "right now" opt-in */
      .filter((r) => r.start !== '' && r.end !== '')
  )
}
