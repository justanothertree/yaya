/**
 * Undo and redo for a thing made of several parts.
 *
 * ⚠️ THE MAP EDITOR HAD UNDO FOR THE GROUND AND NOTHING ELSE, which is worse than having none:
 * a button labelled Undo teaches you that mistakes are cheap, and then four of the five things
 * you can do to a map could not be taken back. Reported after a real session — "there wasn't the
 * undo's that I wanted when trying to edit things or draw the no walk zone". Stamping, the
 * no-walk zone, the spawn and the doors were all one-way.
 *
 * ⚠️ SO A STEP IS A SLICE, NOT A WHOLE DOCUMENT. A map holds up to 2000 pieces, a ground
 * drawing and a 23,040-cell zone; snapshotting all of it per action would copy the zone every
 * time somebody laid a tree. Each step carries only the part that is about to change, so the
 * cost of remembering is the cost of the thing you did.
 *
 * ⚠️ AND IT IS PURE SO IT CAN BE ASKED THE QUESTION THAT MATTERS. The paint room's undo shipped
 * a bug where one press pushed the same stroke twice — React double-invokes a state updater in
 * StrictMode, and the stack was being built inside one. "Draw one line, undo, redo" gave two
 * lines. A stack you can step through directly is a stack that can be made to prove it does not
 * do that.
 */

export type History<S> = { past: S[]; future: S[] }

export const emptyHistory = <S>(): History<S> => ({ past: [], future: [] })

/**
 * ⚠️ FORTY, AND THE LIMIT IS MEMORY RATHER THAN TASTE. A zone step copies 23KB, so an
 * unbounded stack is a megabyte for every forty-odd strokes of no-walk paint — on a page that
 * also holds the map, the palette and every stamp rasterised. Forty steps back is further than
 * anybody reaches for and costs under a megabyte at the worst kind of step.
 */
export const CAP = 40

/**
 * Remember what something looked like before you changed it.
 *
 * ⚠️ A NEW EDIT ENDS THE BRANCH YOU COULD HAVE REDONE INTO, which is the rule every editor
 * follows and the one thing that makes redo safe: a future that survives an edit is a future
 * that puts back something you have since changed your mind about.
 */
export function noteEdit<S>(h: History<S>, before: S): History<S> {
  const past = [...h.past, before]
  return { past: past.length > CAP ? past.slice(past.length - CAP) : past, future: [] }
}

/**
 * Step back. Returns the state to restore and the history after doing so, or null when there is
 * nothing to undo.
 *
 * ⚠️ IT TAKES WHAT THINGS LOOK LIKE NOW, because that is what redo has to put back. An undo
 * that only pops is an undo you cannot take back — "a delete with a friendly name", as the
 * ground's own note put it.
 */
export function stepBack<S>(h: History<S>, now: S): { h: History<S>; to: S } | null {
  const to = h.past[h.past.length - 1]
  if (to === undefined) return null
  return { h: { past: h.past.slice(0, -1), future: [...h.future, now] }, to }
}

/** Step forward again, same bargain in the other direction. */
export function stepOn<S>(h: History<S>, now: S): { h: History<S>; to: S } | null {
  const to = h.future[h.future.length - 1]
  if (to === undefined) return null
  return { h: { past: [...h.past, now], future: h.future.slice(0, -1) }, to }
}
