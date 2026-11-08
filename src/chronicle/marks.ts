import { localISO } from '../circuit/dates'
import { goalWindow, repeats, windowKey, type Goal, type Window } from './goal'
import { localMidnight } from './record'

/**
 * A repeating goal you move by hand, window by window.
 *
 * A tick-box like "Floss every day", or a count like "twenty minutes of stretching" moved with −
 * and +, used to remember ONE `done_at` and ONE `progress` on the goal row, and nothing reset
 * either when the window turned over. So "Floss every day", ticked once, was ticked on every day
 * after it: measured in the preview double, which kept the same one flag the server does, a new
 * daily tick-box ticked on Today showed as already ticked on Tomorrow. It is the very first
 * example in the brief this room was rebuilt from, and it worked exactly once.
 *
 * Goals the RECORD answers for were never affected, because the tally is asked per window. Only
 * the hand-moved half of a repeating goal had no window — which is what this module and
 * docs/2026-11-08-chronicle-repeat-marks.DRAFT.sql give it.
 *
 * ⚠️ THE TABLE BEHIND IT IS A DRAFT, NOT APPLIED TO PRODUCTION. This module is wired into the room
 * on the `chronicle/marks-wired` branch, and the room must not ship before the migration does —
 * see the release order in the draft.
 */

/** What you said about one window of one repeating goal. */
export type WindowMark = { progress: number; done: boolean }

/** Marks for the windows asked about, keyed the way the tally is: `windowKey(goal, from)`. */
export type Marks = Record<string, WindowMark>

/**
 * A repeating goal's tick from before marks existed: the moment the ROW says it was done, by goal.
 *
 * ⚠️ IT IS EVIDENCE, SO IT IS KEPT — AND IT IS ONE MOMENT, SO IT LIGHTS ONE WINDOW. The row's
 * `done_at` is a true fact: it was done then. Copying it into a mark would need the window that
 * contains it, which is a LOCAL question the server cannot answer — an evening tick in California
 * is tomorrow in UTC — so it is read here, where local midnight is known, and never written
 * anywhere. The row's `progress` is NOT read, because nothing records which window a hand-moved
 * count belonged to, and placing it in one would invent a day nobody can check.
 */
export type Legacy = Record<string, number>

/** What the room holds about marks: the windows asked about, and the ticks from before them. */
export type Marked = { marks: Marks; legacy: Legacy }

export const NO_MARKS: Marked = { marks: {}, legacy: {} }

/** Whether a moment falls inside a window of local days — `from` inclusive, `to` exclusive. */
const within = (ms: number, w: Window): boolean => {
  if (!Number.isFinite(ms)) return false
  const day = localISO(new Date(ms))
  return day >= w.from && day < w.to
}

/**
 * A goal as it stands in the window that contains `on`.
 *
 * ⚠️ IT RETURNS A GOAL, SO NOTHING DOWNSTREAM HAS TO CHANGE. `finished`, `share` and `reached`
 * already read `done` and `progress` off the goal they are handed; giving them a goal whose two
 * hand-moved fields are THIS window's rather than the row's is the whole fix, with no second
 * version of any of them to drift from the first.
 *
 * ⚠️ A WINDOW WITH NO MARK IS UNTOUCHED, NOT UNKNOWN: progress 0, not done. That is what every new
 * day of a daily goal honestly is, and it is the reset the row could never perform. The one
 * exception is the window holding a tick from before marks existed — see `Legacy` — and a mark,
 * once there is one, always wins over it, so unticking that day sticks.
 *
 * A one-off goal and a lifetime goal have exactly one window, which the row already IS, so they
 * come back as they went in.
 */
export function asOf(g: Goal, marks: Marks, on: string, legacy: Legacy = {}): Goal {
  if (!repeats(g)) return g
  const w = goalWindow(g, on)
  if (!w) return g
  const m = marks[windowKey(g.id, w.from)]
  if (m) return { ...g, progress: m.progress, done: m.done }
  const was = legacy[g.id]
  return { ...g, progress: 0, done: was != null && within(was, w) }
}

/**
 * Which window a hand-moved change to a repeating goal belongs to, for the writer — or null for a
 * goal that is not repeating, which keeps using the row.
 *
 * ⚠️ THE WINDOW IS WORKED OUT HERE AND SENT, like the tally's. A local day begins at local
 * midnight and the server does not know where anybody is — the same reason `tallyAsks` exists.
 * The two instants go with the date so the server can tell which mark is CURRENT without knowing
 * the member's zone, which is what a friend's view of their profile needs, and can refuse a
 * window that has not begun.
 */
export type MarkAt = { from: string; starts: string; ends: string }

export function markWindow(g: Goal, on: string): MarkAt | null {
  if (!repeats(g)) return null
  const w = goalWindow(g, on)
  if (!w) return null
  return {
    from: w.from,
    starts: localMidnight(w.from).toISOString(),
    ends: localMidnight(w.to).toISOString(),
  }
}

/**
 * Whether a repeating goal's window for `on` has begun yet — false means a tick there would be a
 * claim about a day nobody has had, which the writer refuses. One-offs are always open: finishing
 * tomorrow's errand today is finishing it.
 */
export function markOpen(g: Goal, on: string, today: string): boolean {
  if (!repeats(g)) return true
  const w = goalWindow(g, on)
  return !w || w.from <= today
}

/** What to ask for: the window containing each day, for every repeating goal. Deduped on key. */
export function markAsks(
  goals: readonly Goal[],
  days: readonly string[],
): Array<{ key: string; id: string; from: string }> {
  const out = new Map<string, { key: string; id: string; from: string }>()
  for (const g of goals) {
    if (!repeats(g)) continue
    for (const d of days) {
      const w = goalWindow(g, d)
      if (!w) continue
      const key = windowKey(g.id, w.from)
      if (!out.has(key)) out.set(key, { key, id: g.id, from: w.from })
    }
  }
  return [...out.values()]
}
