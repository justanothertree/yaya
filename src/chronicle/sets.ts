import { localISO } from '../circuit/dates'
import { countText } from './record'

/**
 * A set: a quantity of one Circuit exercise on one day — recorded once, and canonical for both
 * rooms. Step 1 of docs/2026-11-07-chronicle-recorded-once.md §2f, whose table is
 * docs/2026-11-08-chronicle-sets.DRAFT.sql.
 *
 * ⚠️ THE TABLE IS A DRAFT, NOT APPLIED TO PRODUCTION, and nothing on screen counts sets yet: the
 * tally, the Circuit grid and the day's feed learn them in step 2. What the room does with them
 * now is the part §15c asks for before any of that — say, when a sitting is moved, that its sets
 * are not, and move their day with the sitting's start in the same call.
 */
export type ChronSet = {
  id: string
  /** the sitting it was counted during, or null for one typed into the Circuit's grid */
  entry: string | null
  /** whose grid the exercise is defined on; null once that person's row is gone */
  person: string | null
  /** the exercise's identity, an id in that person's list — never its name (§15b) */
  exercise: string
  /** what the exercise was called when this set was written */
  name: string
  /** what the same exercise id is called today, or null once it has been deleted */
  now: string | null
  /** the LOCAL day it counts for */
  on: string
  value: number
  /**
   * Whether this set is IN its sitting's amount — written through when it was counted, for an
   * exercise linked to that sitting's activity in a unit they share. A set that is not counted is
   * still a set: the Circuit sees it, the sitting's count does not.
   */
  counted: boolean
}

/** How much of a sitting's count its sets hold — the floor the server holds that count to. */
export const countedIn = (sets: readonly ChronSet[], entry: string): number =>
  sets.reduce((n, s) => (s.entry === entry && s.counted ? n + s.value : n), 0)

/**
 * What a set is called on screen: the exercise's name today, or the one it had when the set was
 * written if the exercise has gone.
 *
 * ⚠️ BY ID, NEVER BY NAME (§15b, answered: "Never reconnect exercises by matching names"). `now`
 * is looked up by the exercise's id on the server, so a deleted exercise re-made under the same
 * name is a different id and leaves this set reading its old name, unattached — not quietly
 * folded into the new one.
 */
export const setName = (s: ChronSet): string => s.now ?? s.name

/**
 * One sitting's sets, summed per exercise, in the order they were first counted.
 *
 * ⚠️ PER EXERCISE ID, so two exercises that happen to share a name — the deleted one and the one
 * re-made in its place — stay two lines rather than one sum.
 */
export function perExercise(
  sets: readonly ChronSet[],
  entry: string,
): Array<{ exercise: string; name: string; total: number }> {
  const out = new Map<string, { exercise: string; name: string; total: number }>()
  for (const s of sets) {
    if (s.entry !== entry) continue
    const had = out.get(s.exercise)
    if (had) had.total += s.value
    else out.set(s.exercise, { exercise: s.exercise, name: setName(s), total: s.value })
  }
  return [...out.values()]
}

/**
 * The line the sitting editor shows when the activity is changed on a sitting that has sets.
 *
 * ⚠️ §15c, ANSWERED: "Moving a sitting between activities does not change which exercises its
 * sets represent. Explain that consequence in the move UI." It is correct and it looks like a bug
 * — a goal's number moves and the Circuit's does not — so it is said at the moment it happens,
 * in the words the 16e recommendation used, rather than left to be found.
 */
export function moveNote(sets: readonly ChronSet[], entry: string): string | null {
  const ex = perExercise(sets, entry)
  if (!ex.length) return null
  const list = ex.map((x) => `${countText(x.total)} ${x.name}`)
  return ex.length === 1
    ? `The ${list[0]} stay with ${ex[0].name}. Only the time moves.`
    : `Its sets stay what they are: ${list.join(', ')}. Only the time moves.`
}

/**
 * The local day a sitting's sets count for, given its start — the day the editor sends when the
 * start is moved, so the sets move with it in the same call (§15c).
 *
 * ⚠️ LOCAL, AND SENT, because the server has no zone and the Circuit grid is social: a friend
 * looking at your column must see a set on the day YOU did it.
 */
export const dayOfStart = (startISO: string): string => localISO(new Date(startISO))
