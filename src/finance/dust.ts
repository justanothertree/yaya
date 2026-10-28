/**
 * What counts as a crumb.
 *
 * ⚠️ ONE CONSTANT, BECAUSE THE SAME QUESTION IS ASKED IN FOUR PLACES AND THEY HAVE TO AGREE. The
 * overview folds small holdings into one row, reconcile and the integrity checks decide what is
 * worth reporting, and a sell's residue decides whether a position is closed. Four thresholds
 * typed in four files drift, and the symptom is a holding that is "dust" on one screen and a
 * line item on another.
 *
 * ⚠️ WHY A WHOLE DOLLAR AND NOT A CENT. At 33 accounts, any buy under $33 is under $1 a head on
 * the day it settles — that is arithmetic, not a bug, and it is where most of these come from.
 * Measured on the live fund: 37 of 76 holdings per account are worth under $1, costing $33.86 and
 * now worth $15.69. A list that shows all 76 to a child is mostly noise, and a cent threshold
 * would fold almost none of it.
 *
 * ⚠️ AND THE UNITS THRESHOLD IS A DIFFERENT QUESTION. `DUST_UNITS` is about whether a POSITION is
 * closed — the residue left by a broker rounding quantities to four decimals. `DUST_USD` is about
 * whether a holding is worth DRAWING. They are not interchangeable: a position can be worth
 * nothing and still be open, and a holding of many units can be worth pennies.
 */

/** under this, a holding folds into the small-pieces row rather than taking a line of its own */
export const DUST_USD = 1

/** under this many units, a position is closed rather than held — broker rounding residue */
export const DUST_UNITS = 0.0001

/**
 * Is this worth a row of its own?
 *
 * ⚠️ AN UNPRICED HOLDING IS NOT DUST. A null price means nobody knows what it is worth, which is
 * the opposite of knowing it is worth very little — folding it away would hide a holding that
 * might be the largest one there. It gets a row and an em dash.
 */
export function isDust(value: number | null | undefined): boolean {
  if (value == null || !Number.isFinite(value)) return false
  return value >= 0 && value < DUST_USD
}
