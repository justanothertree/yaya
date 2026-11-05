/**
 * A chord arriving one note at a time, the way a hand does it.
 *
 * Nobody plays a chord as a block. A guitarist drags a pick across six strings over about 40
 * milliseconds; a harpist rolls one over a quarter of a second; a pianist with any feeling in
 * their hands spreads the bottom note a few milliseconds early. A synth that fires every note on
 * the same sample is the one thing in the room that gives away that it is a machine — and it is
 * the cheapest possible thing to fix, because the synth already takes a time.
 *
 * ⚠️ THIS IS DELAYS, NOT A SCHEDULER. Every note of the chord is started by the same `press`, in
 * the same breath, each with its own `when` handed to `noteOn` — so there is no timer running,
 * nothing to tear down, nothing that can still be firing after you let go, and the sounding book
 * is unchanged because all the voices really are open from the moment you press. A feature with
 * no process in it cannot leak one.
 *
 * ⚠️ AND THE CHORD ALWAYS STARTS NOW. Whichever note leads, its delay is zero — see
 * `strum.test.ts`, which states that as the property it is. A spread that delayed every note,
 * even by 20ms, would read as the keyboard being laggy rather than as a chord being rolled, and
 * latency is the one thing an instrument may never add.
 */

export type StrumId = 'off' | 'up' | 'down' | 'slow'

/** Seconds between one note and the next, per shape. */
const GAP: Record<StrumId, number> = {
  off: 0,
  /* ⚠️ 22ms. Under about 15 the ear fuses the notes into one chord again and the setting
     appears to do nothing; past about 35 a four-note chord starts to sound like four notes
     rather than one gesture. A real down-stroke across six strings is roughly 20-30ms a string. */
  up: 0.022,
  down: 0.022,
  /* a harp roll: a quarter of a second across four notes, deliberately heard as separate */
  slow: 0.075,
}

/**
 * The picker.
 *
 * ⚠️ IT ONLY APPEARS ONCE A CHORD IS CHOSEN, because a single note cannot be rolled — the room
 * hides it rather than offering a control that visibly does nothing, the same way the Key picker
 * stays away on Chromatic.
 *
 * ⚠️ THE LABELS ARE ABOUT PITCH, NOT ABOUT A HAND. "Down-strum" means the low string first to a
 * guitarist and the top note first to everybody else, so neither word is safe. "Lowest note
 * first" cannot be misread by either.
 */
export const STRUMS: Array<[StrumId, string, string]> = [
  ['off', 'Together', 'Every note at once'],
  ['up', 'Rolled up', 'Lowest note first, like a strummed guitar'],
  ['down', 'Rolled down', 'Highest note first'],
  ['slow', 'Spread', 'A slow roll, like a harp'],
]

/**
 * How long after the press each note of the chord should sound, in seconds.
 *
 * The notes are in the order `chordNotes` gives them — ascending, pressed note first — and the
 * answer is in that same order, so `delays[i]` belongs to `notes[i]`.
 */
export function strumDelays(id: StrumId, count: number): number[] {
  /**
   * ⚠️ THE THREE GUARDS THIS USED TO HAVE WERE ALL DEAD, and only one perturbation said so.
   *
   * It began as `if (count <= 0) return []`, `if (count === 1 || gap === 0) return zeros`, and
   * then this line. Deleting the single-note guard to watch a test go red left all eighteen
   * GREEN — because the formula already answers it: at `count` 1 the only index is 0, and 0
   * times any gap is 0. The same turned out to be true of the other two. `Array.from({length:
   * 0})` and `{length: -1}` are both `[]`, and an `off` gap of 0 multiplies every index to 0.
   *
   * So the special cases were three statements asserting what the arithmetic already did, and
   * they were the kind that reads as careful. The behaviour they described is real and still
   * guaranteed — `strum.test.ts` states each one as a property — it just does not need code.
   *
   * 'down' leads with the top note, so its delays run the other way, and the LAST of them is
   * zero. That is what keeps the chord starting on the press in both directions.
   */
  return Array.from(
    { length: count },
    (_, i) => (id === 'down' ? count - 1 - i : i) * (GAP[id] ?? 0),
  )
}

/** The whole gesture, for deciding whether a shape is worth offering at a given size. */
export const strumSpread = (id: StrumId, count: number): number => {
  const d = strumDelays(id, count)
  return d.length ? Math.max(...d) : 0
}
