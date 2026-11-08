import { goalWindow, repeats, windowKey, type Goal } from './goal'

/**
 * ⚠️ PROPOSAL — NOTHING IMPORTS THIS YET, AND THE TABLE IT READS DOES NOT EXIST.
 *
 * A repeating goal you move by hand — a tick-box like "Floss every day", or a count like "twenty
 * minutes of stretching" moved with − and + — remembers ONE `done_at` and ONE `progress` on the
 * goal row, and nothing resets either when the window turns over. So "Floss every day", ticked
 * once, is ticked on every day after it: measured in the preview double, which keeps the same one
 * flag the server does, a new daily tick-box ticked on Today showed as already ticked on Tomorrow.
 * It is the very first example in the brief this room was rebuilt from, and it works exactly once.
 *
 * Goals the RECORD answers for are unaffected, because the tally is asked per window. Only the
 * hand-moved half of a repeating goal has no window — which is what this module and
 * docs/2026-11-08-chronicle-repeat-marks.DRAFT.sql give it.
 */

/** What you said about one window of one repeating goal. */
export type WindowMark = { progress: number; done: boolean }

/** Marks for the windows asked about, keyed the way the tally is: `windowKey(goal, from)`. */
export type Marks = Record<string, WindowMark>

/**
 * A goal as it stands in the window that contains `on`.
 *
 * ⚠️ IT RETURNS A GOAL, SO NOTHING DOWNSTREAM HAS TO CHANGE. `finished`, `share` and `reached`
 * already read `done` and `progress` off the goal they are handed; giving them a goal whose two
 * hand-moved fields are THIS window's rather than the row's is the whole fix, with no second
 * version of any of them to drift from the first.
 *
 * ⚠️ A WINDOW WITH NO MARK IS UNTOUCHED, NOT UNKNOWN: progress 0, not done. That is what every new
 * day of a daily goal honestly is, and it is the reset the row could never perform.
 *
 * A one-off goal and a lifetime goal have exactly one window, which the row already IS, so they
 * come back as they went in.
 */
export function asOf(g: Goal, marks: Marks, on: string): Goal {
  if (!repeats(g)) return g
  const w = goalWindow(g, on)
  if (!w) return g
  const m = marks[windowKey(g.id, w.from)]
  return { ...g, progress: m?.progress ?? 0, done: m?.done ?? false }
}

/**
 * Which window a hand-moved change to a repeating goal belongs to, for the writer — or null for a
 * goal that is not repeating, which keeps using the row.
 *
 * ⚠️ THE WINDOW IS WORKED OUT HERE AND SENT, like the tally's. A local day begins at local
 * midnight and the server does not know where anybody is — the same reason `tallyAsks` exists.
 */
export function markWindow(g: Goal, on: string): string | null {
  if (!repeats(g)) return null
  return goalWindow(g, on)?.from ?? null
}
