import { getSupabaseClient } from '../finance/client'
import type { Goal, Scope } from './goal'

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
 * Everything here goes through the four SECURITY DEFINER functions in
 * docs/2026-10-12-chronicle-design.md. The table grants nothing to `anon` or `authenticated`, so
 * these calls are the only way in and `auth.uid()` is checked on the first line of each.
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
})

/** Every goal of mine. Empty rather than throwing, so a dead network is a quiet room. */
export async function myGoals(): Promise<Goal[]> {
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
  const { error } = await getSupabaseClient().rpc('chronicle_goal_progress', {
    p_id: id,
    p_progress: progress,
    p_done: done,
  })
  return !error
}

export async function dropGoal(id: string): Promise<boolean> {
  const { error } = await getSupabaseClient().rpc('chronicle_goal_drop', { p_id: id })
  return !error
}
