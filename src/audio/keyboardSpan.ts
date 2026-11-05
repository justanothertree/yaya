/**
 * How many keys to draw, which on a phone is not the same question as on a desktop.
 *
 * ⚠️ THE BUG THIS EXISTS FOR, confirmed on Evan's own phone: the key row shows a scrollbar and a
 * finger cannot pan it. `.inst-keys` is `overflow-x: auto` with `touch-action: none` — the
 * `none` is deliberate and correct, because dragging across keys is how a glissando works, and
 * it is also what tells the browser not to treat that drag as a scroll. The cost was that at
 * 375px the row is 1021px wide inside a 325px window, so **sixteen of the twenty-five keys were
 * drawn and untouchable**.
 *
 * There are two halves to the fix and this file is the first: DRAW FEWER KEYS, so that on most
 * scales there is nothing to pan. The second half is in the stylesheet — `touch-action` moves
 * onto the keys themselves, so a gesture that starts on the board rather than on a key can pan
 * after all, which is what Chromatic still needs.
 *
 * ⚠️ ONE OCTAVE, AND THE "+ 1" IS THE WHOLE POINT. The octave buttons shift by twelve semitones,
 * so the keys on screen have to span at least that or there is a hole in the middle of the
 * instrument: nine chromatic keys would be C through G♯, and Octave up would jump to C5 leaving
 * A, A♯ and B unreachable at any setting. Degrees 0…L is exactly an octave, with the top key
 * being the root again — so the windows tile with one key of overlap and every note is
 * reachable. `keyboardSpan.test.ts` asserts that as a sweep over every scale rather than as
 * four examples.
 *
 * What this buys, measured at 375 where a key is 2.4rem: Major is eight keys and 307px, which
 * FITS the 325px window; Pentatonic is six and 230px. Chromatic is thirteen and 499px, which
 * does not — thirteen keys cannot be an octave and 24px at the same time — so Chromatic is the
 * case the pan half is for, and it is now a third of the panning it used to be.
 */

/** Two octaves, matching the four typing rows exactly, so every key on screen has a key to press. */
export const FULL_SPAN = 25

/**
 * The screens that get the short keyboard.
 *
 * ⚠️ IT MUST MATCH THE STYLESHEET, which is why it is a constant rather than a number typed in
 * twice. `src/index.css` moves the keyboard to the top of the room at exactly this breakpoint,
 * and a JS copy that drifted would give a phone the long keyboard with the phone layout — the
 * one combination neither half was designed for.
 *
 * NARROW **OR** SHORT, for the reason the CSS says at length: a phone held sideways is 844px
 * wide, so a width-only rule misses the orientation somebody rotated into in order to play.
 */
export const PHONE_KEYBOARD = '(max-width: 780px), (orientation: landscape) and (max-height: 560px)'

/**
 * How many keys to draw.
 *
 * @param degreeCount how many notes the active scale has — 12 for Chromatic, 5 for a pentatonic
 * @param narrow whether `PHONE_KEYBOARD` matches
 */
export function keysToShow(degreeCount: number, narrow: boolean): number {
  if (!narrow) return FULL_SPAN
  /* a scale with no degrees cannot be reasoned about; the long keyboard is the safe answer */
  if (!Number.isFinite(degreeCount) || degreeCount < 1) return FULL_SPAN
  /* ⚠️ never MORE than the desktop span: a scale with thirty degrees is not a thing today, and
     if one arrived the phone should not get a longer keyboard than the desktop */
  return Math.min(FULL_SPAN, Math.floor(degreeCount) + 1)
}

/**
 * How far the octave buttons can go.
 *
 * ⚠️ ONE PLACE, because there were three. The two buttons each carried their own
 * `Math.max(1, …)` / `Math.min(6, …)` and the number input carried the bounds again — fine
 * while nothing else moved the octave, and three things to keep in step the moment the computer
 * keyboard learned to. A range that disagrees with itself is a key that stops working one step
 * before the button does.
 */
export const OCTAVE_LOW = 1
export const OCTAVE_HIGH = 6

/** Move the octave by `by`, staying inside the range the room offers. */
export const shiftOctave = (from: number, by: number): number =>
  Math.max(OCTAVE_LOW, Math.min(OCTAVE_HIGH, Math.round(from) + by))
