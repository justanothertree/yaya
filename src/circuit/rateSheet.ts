/**
 * When the rating sheet may save, and when its form has to be filled again.
 *
 * ⚠️ A FORM IS AS GOOD AS THE BOARD IT WAS FILLED FROM. The sheet fills its fields once, when it
 * opens, from the rating the board holds — and Save writes all of them back, or deletes the
 * rating when they look empty. Opened while the board's ratings had failed to load, the form is
 * blank for a reason that has nothing to do with the rating. Holding Save only while the board
 * stayed unloaded was not enough: a Retry inside the sheet loaded the board and turned Save back
 * on over that same blank form (found in review, 28 Nov 2026).
 *
 * So the form remembers what it was filled from. One filled from a board that had not loaded is
 * filled again, from the loaded board, the moment it loads — and cannot save until it has been.
 * One filled from a loaded board is never refilled, so nothing the person typed is replaced.
 */
export type RateSeed = {
  /** the form's fields came from a board that had loaded */
  fromLoadedBoard: boolean
}

/** Save is open for a form filled from a loaded board, while the board is loaded. */
export function mayRateSave(seed: RateSeed, unloadedNow: boolean): boolean {
  return seed.fromLoadedBoard && !unloadedNow
}

/** A form filled from an unloaded board is filled again once the board has loaded. */
export function mustReseed(seed: RateSeed, unloadedNow: boolean): boolean {
  return !seed.fromLoadedBoard && !unloadedNow
}
