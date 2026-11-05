/**
 * What you are holding, in words.
 *
 * The room can now hand you a four-note chord from one key, roll it, and arpeggiate it — and
 * never once says what it is. That is a gap for exactly the person the chord picker was built
 * for: somebody who cannot play, pressing a key, hearing something good, with no way to find out
 * what it was. A name is the cheapest teaching there is.
 *
 * ⚠️ WORDS, NOT NOTATION. "Cmaj7" is correct and means nothing to most of the people who use
 * this site; "C major 7" is the same information and can be read aloud. The site's copy is short
 * and factual, not clever, and a chord symbol is jargon wearing a disguise.
 *
 * ⚠️ AND IT FINDS THE ROOT RATHER THAN ASSUMING THE BOTTOM NOTE IS IT. C-E-A is not a C chord
 * with an odd note in it, it is A minor with C at the bottom — and that case is not exotic here:
 * a Triad on the pentatonic scale produces exactly those intervals, so the room makes one on an
 * ordinary keypress. Naming it from the lowest note would be wrong roughly a third of the time
 * and confidently so.
 */

const NAMES = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B']

/**
 * Semitones above the root → what that shape is called.
 *
 * ⚠️ THE ORDER IS COSMETIC, AND A COMMENT HERE ONCE CLAIMED OTHERWISE. It said the table was
 * "longest first so a four-note chord is never named as the triad hiding inside it" — which is
 * a true worry and the wrong mechanism. `BY_SHAPE` is keyed by the EXACT interval set, so a
 * four-note chord can only ever match a four-entry shape; three of these could not be reached
 * by it however they were sorted. Caught by shuffling the table to watch a test go red and
 * getting thirty green instead.
 *
 * ⚠️ EACH CHORD APPEARS ONCE, IN ROOT POSITION. Two entries that were inversions of shapes
 * already here are gone — see the note below them — because the search tries every note as the
 * root and an inversion listed explicitly short-circuits it from the bass.
 */
const SHAPES: Array<[number[], string]> = [
  [[0, 4, 7, 11], 'major 7'],
  [[0, 3, 7, 10], 'minor 7'],
  [[0, 4, 7, 10], 'seventh'],
  [[0, 3, 6, 10], 'half-diminished'],
  [[0, 3, 6, 9], 'diminished 7'],
  /* ⚠️ BOTH OF THESE ARE HARMONIC MINOR'S, and the first is its TONIC seventh — the chord you
     get pressing the very first key with Seventh chosen on that scale. Leaving it blank was a
     gap in exactly the place somebody would look. They are the only two chords the room can
     make that this table had no word for; derived rather than guessed, by stacking the scale's
     own degrees. The names are a mouthful and they are still the names: "minor major 7" is
     plain words, where "Cm(maj7)" would be notation in disguise. */
  [[0, 3, 7, 11], 'minor major 7'],
  [[0, 4, 8, 11], 'augmented major 7'],
  [[0, 4, 7, 9], 'sixth'],
  [[0, 3, 7, 9], 'minor sixth'],
  [[0, 2, 4, 7], 'added ninth'],
  [[0, 4, 7], 'major'],
  [[0, 3, 7], 'minor'],
  [[0, 3, 6], 'diminished'],
  [[0, 4, 8], 'augmented'],
  [[0, 5, 7], 'suspended fourth'],
  [[0, 2, 7], 'suspended second'],
  /**
   * ⚠️ TWO ENTRIES WERE HERE AND BOTH WERE WRONG — removed after they failed three tests.
   *
   * `[0, 3, 8]` was labelled 'minor'. Root it at 8 instead and it is `[0, 4, 7]`: a MAJOR triad
   * in second inversion. So E-G-C, which is C major over E, was being announced as E minor —
   * the wrong quality and the wrong root, from a line that looked like a reasonable addition.
   *
   * `[0, 4, 9]` was labelled 'sixth'. A sixth chord has a fifth in it; without one, C-E-A is
   * A minor with C underneath, which is what everybody plays it as — and is exactly what a
   * Triad on the pentatonic scale produces, so the room makes it on an ordinary keypress.
   *
   * Both were shapes that ALREADY had a correct name through the inversion search, and adding
   * them short-circuited it: the bass is tried first, so a wrong entry matching from the bass
   * beat the right answer sitting one root along. The lesson is that this table should hold
   * each chord ONCE, in root position, and let the search do the rest.
   */
  [[0, 7], 'and its fifth'],
  [[0, 5], 'and its fourth'],
  [[0, 4], 'and its third'],
  [[0, 3], 'and its minor third'],
]

/** The note name of a MIDI number, without the octave. */
export const pitchName = (midi: number) => NAMES[((((midi % 12) + 12) % 12) + 12) % 12]

const key = (xs: number[]) => xs.join(',')
const BY_SHAPE = new Map(SHAPES.map(([ivs, name]) => [key(ivs), name]))

/**
 * Name the notes sounding, or null if they are not a shape worth naming.
 *
 * @param midis every note sounding, in any order. Octaves and repeats do not matter.
 *
 * ⚠️ NULL IS A REAL ANSWER AND MOST OF THE WORK. Four adjacent semitones have a name only a
 * theorist wants; a readout that invented one for every handful of keys would be noise, and
 * worse, it would be wrong in a way nobody could check. Silence beats a guess here — the same
 * call `needsAName` makes in the mobile audit about crying wolf.
 */
export function nameChord(midis: number[]): string | null {
  if (midis.length === 0) return null
  const bass = Math.min(...midis)
  /* pitch classes, deduped: a chord does not change its name when you double the root an octave
     up, which is exactly what the Octave strum shape does */
  const pcs = [...new Set(midis.map((m) => ((m % 12) + 12) % 12))].sort((a, b) => a - b)

  if (pcs.length === 1) return pitchName(bass)

  /**
   * ⚠️ EVERY NOTE IS TRIED AS THE ROOT, LOWEST FIRST. The lowest is tried first so that a shape
   * which works from the bass wins — C-E-G is "C major" and not "E minor with a flat six" — and
   * the rest are tried because an inversion's root is somewhere in the middle. First match wins.
   * A four-note chord cannot be mistaken for the triad inside it because the lookup is on the
   * whole interval set rather than a prefix of it — not, as this once said, because of the
   * order of the table.
   */
  const order = [bass % 12, ...pcs].filter((v, i, a) => a.indexOf(v) === i)
  for (const root of order) {
    const ivs = pcs.map((p) => (p - root + 12) % 12).sort((a, b) => a - b)
    const name = BY_SHAPE.get(key(ivs))
    if (!name) continue
    const rootName = pitchName(root)
    /* a two-note shape reads as a phrase rather than a chord: "C and its fifth" */
    if (pcs.length === 2) return `${rootName} ${name}`
    /* an inversion says what is underneath, because your hand is on that note and being told
       "A minor" while looking at a C is the kind of correct that feels like a bug */
    const bassPc = ((bass % 12) + 12) % 12
    return bassPc === root ? `${rootName} ${name}` : `${rootName} ${name} / ${pitchName(bass)}`
  }
  return null
}
