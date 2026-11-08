/**
 * The count on the sitting you are in — reps, laps, pages — and the way back from a mis-tap.
 *
 * ⚠️ IT IS PURE SO IT CAN BE ASKED A QUESTION, and the question it exists for is the one the room
 * got wrong. The `+5` button computed its next value from the number the render had drawn, so
 * three presses landing before React committed the first all wrote 5 — a tap counted and thrown
 * away on the one control whose whole job is counting taps. That was fixed with the updater form;
 * this module is what the updater calls, so the arithmetic can be pinned without a browser.
 *
 * ⚠️ AND THE UNDO LIVES IN THE SAME VALUE AS THE COUNT, never beside it. The obvious shape — a
 * ref holding the history, pushed to from inside the state updater — is wrong twice over: an
 * updater with a side effect runs TWICE under React's StrictMode, which this app is mounted in,
 * so every tap would record two steps of history in development and one in production. Two
 * pieces of state that must move together are one piece of state.
 */

/** the count, and every value it had before each change, oldest first */
export type Tally = { n: number | null; was: readonly (number | null)[] }

/**
 * How far back Undo reaches.
 *
 * ⚠️ A NUMBER OF TAPS, NOT A TIME. Twenty is two full sets of `+1` laps or a whole session of
 * `+5`s; past that, a correction is a different act — the sitting's own editor, where the total
 * is a field — and an Undo that could walk a forty-minute workout back to zero one tap at a time
 * would be a second, slower way to do it.
 */
export const UNDO_DEPTH = 20

/** A count with no history — what the sitting holds when you arrive at it. */
export const fresh = (n: number | null): Tally => ({ n, was: [] })

/**
 * Move the count by `by`, remembering where it was.
 *
 * ⚠️ A CHANGE THAT CHANGES NOTHING IS NOT REMEMBERED. `−1` at zero clamps to zero, and recording
 * that as a step would make the next Undo do nothing visible — a button that has to be pressed
 * twice to work, which reads as broken.
 */
export function bump(t: Tally, by: number): Tally {
  const next = Math.max(0, Math.round((t.n ?? 0) + by))
  /* `null` reads as 0 here, so −1 on a sitting that has counted nothing is a no-op too — and it
     stays null rather than becoming a 0 the server would store as a claim */
  if (next === (t.n ?? 0)) return t
  return { n: next, was: [...t.was, t.n].slice(-UNDO_DEPTH) }
}

/**
 * Put back the value before the last change.
 *
 * ⚠️ EXACTLY THE VALUE, NULL INCLUDED. A sitting nobody has counted anything on holds `null`,
 * which the server reads as "no amount" and the screen draws as 0. Undoing the first tap must
 * return `null`, not `0` — a round trip that does not close would leave a sitting saying it
 * counted zero reps, which is a claim, where before it made none.
 */
export function undo(t: Tally): Tally {
  if (!t.was.length) return t
  return { n: t.was[t.was.length - 1], was: t.was.slice(0, -1) }
}

/** What Undo would put back, for its label — or null when there is nothing to undo. */
export const undoTo = (t: Tally): number | null | undefined =>
  t.was.length ? t.was[t.was.length - 1] : undefined
