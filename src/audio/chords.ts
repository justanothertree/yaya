/**
 * One key, a chord — the next rung on the ladder scale lock already climbs.
 *
 * Scale lock exists because "handing every key the next note of the scale means there is no wrong
 * key left to press", as the instrument room's own comment puts it. This is the same idea one
 * level up: the notes a chord is built from are taken from the scale you already chose, so a
 * triad on the sixth degree of a major scale comes out MINOR without anybody being asked about
 * it. Somebody who cannot play gets harmony that belongs in the key; somebody who can gets the
 * diatonic chord they would have voiced by hand.
 *
 * ⚠️ THE STACK IS IN SCALE STEPS, NOT SEMITONES, and that distinction is the whole file.
 * `[0, 2, 4]` means "this degree, two degrees up, four degrees up" — which is a major triad on
 * C in C major, a minor triad on A in C major, and a diminished one on B, all from one list. The
 * semitone reading of the same numbers is a whole-tone cluster, and it is what you get if you
 * write what looks like the obvious loop.
 *
 * ⚠️ CHROMATIC HAS NO DEGREES, so it cannot answer the question at all — every semitone is in it,
 * and "two degrees up" is a whole tone. The room therefore resolves chords on Chromatic against
 * the MAJOR degrees with the pressed note as the root, which makes every chord major and
 * predictable: the thing a chord button on a cheap keyboard does, and the only honest answer when
 * there is no key to be in. That decision belongs to the caller, which has the real scale list —
 * a second copy of SCALES in here is a copy that goes stale the first time one is added.
 *
 * ⚠️ AND IT MULTIPLIES VOICES. MAX_VOICES is 16 and the synth cuts the oldest past it, so a
 * four-note Seventh is four keys before notes start disappearing and a Triad is five. That is
 * fine for an instrument you play chords on — a chord is one or two keys, not ten — but it is why
 * the shapes stop at four notes and why `off` stays the default.
 */

export type ChordId = 'off' | 'octave' | 'fifth' | 'triad' | 'seventh'

type Shape =
  /** fixed intervals from the pressed note, in semitones — the same everywhere, in or out of key */
  | { kind: 'semitones'; at: number[] }
  /** steps through the active scale, so the chord's quality comes from the degree it sits on */
  | { kind: 'degrees'; at: number[] }

const SHAPES: Record<ChordId, Shape> = {
  off: { kind: 'semitones', at: [0] },
  octave: { kind: 'semitones', at: [0, 12] },
  /* a power chord: no third, so it has no major or minor to be wrong about. The one shape that
     is safe to hold down on any degree of any scale. */
  fifth: { kind: 'semitones', at: [0, 7, 12] },
  triad: { kind: 'degrees', at: [0, 2, 4] },
  seventh: { kind: 'degrees', at: [0, 2, 4, 6] },
}

/**
 * The picker, in the order it reads on screen.
 *
 * ⚠️ FIVE, AND `off` FIRST. The room's tempo list says it at length: a list long enough to need
 * reading is the same blank page with more steps on it. One note is the honest default — this is
 * a keyboard, and somebody who wanted a chord organ would have said so.
 */
export const CHORDS: Array<[ChordId, string, string]> = [
  ['off', 'One note', 'Each key plays its own note'],
  ['octave', 'Octave', 'The note doubled, an octave up'],
  ['fifth', 'Fifth', 'A power chord — no major or minor about it'],
  ['triad', 'Triad', 'Three notes from the scale you chose'],
  ['seventh', 'Seventh', 'Four notes — warmer, and a little jazzy'],
]

/** The highest note the synth is asked for; above this a key would be inaudible anyway. */
const TOP = 127

/**
 * The notes one key plays.
 *
 * @param id which shape, `off` meaning the single note
 * @param midi the note the key would play on its own — always first in the result
 * @param degrees the active scale's degrees, which the caller owns. Chromatic has none that
 *   answer this, so the caller passes the major degrees and `rootPc` of the pressed note.
 * @param rootPc the pitch class the degrees are measured from (0 = C)
 */
export function chordNotes(
  id: ChordId,
  midi: number,
  degrees: readonly number[],
  rootPc: number,
): number[] {
  const shape = SHAPES[id] ?? SHAPES.off
  if (shape.kind === 'semitones') return shape.at.map((s) => midi + s).filter((m) => m <= TOP)

  /* a scale with no degrees cannot be stepped through; one note is the only honest answer */
  if (degrees.length === 0) return [midi]

  const pc = (((midi - rootPc) % 12) + 12) % 12
  /**
   * ⚠️ A NOTE OUTSIDE THE SCALE SNAPS TO THE ROOT RATHER THAN FALLING SILENT.
   *
   * The room cannot produce one — `noteAt` only ever returns scale notes — so this is the
   * defensive branch. It still matters which way it fails: returning `[midi]` would make a key
   * quietly stop being a chord, and a control that works on most keys and not others is worse
   * than one that is slightly wrong everywhere.
   */
  const from = Math.max(0, degrees.indexOf(pc))
  const L = degrees.length
  /** the nth degree above the root, carrying the octave when the pattern rolls over */
  const deg = (n: number) => degrees[((n % L) + L) % L] + 12 * Math.floor(n / L)

  return shape.at.map((s) => midi + deg(from + s) - degrees[from]).filter((m) => m <= TOP)
}
