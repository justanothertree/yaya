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

const FLATS = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B']
const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B']
const LETTER_PC = [0, 2, 4, 5, 7, 9, 11]
/** the major keys written with flats: F, B♭, E♭, A♭, D♭ */
const FLAT_MAJORS = new Set([5, 10, 3, 8, 1])
const pcOf = (n: number) => ((n % 12) + 12) % 12

/**
 * How notes are spelled in a key — B♭ in D minor, where `pitchName` says A♯.
 *
 * ⚠️ ASKED FOR BY EVAN, 9 NOV 2026, after the backing's hint read "A♯ major underneath" in D minor.
 * The sound was right and the word was wrong: in D minor that chord is B♭, every songbook says so,
 * and a name exists here so that somebody can carry it to the next song and look it up.
 *
 * ⚠️ TWO RULES, THE ONES A MUSICIAN USES.
 * - The KEY SIGNATURE decides sharps or flats: a scale with a minor third and no major third is
 *   read from its relative major, and F, B♭, E♭, A♭ and D♭ major are the flat keys.
 * - On a seven-note scale EACH DEGREE GETS ITS OWN LETTER, which is what makes D harmonic minor
 *   read B♭ and C♯ in one key, and F♯ major's seventh read E♯ rather than a second F. A key whose
 *   spelling would need a double sharp or flat is spelled from the other name of its tonic.
 *
 * Anything outside the scale — a note somebody added by hand, or a scale of another size — takes
 * the key's plain spelling. Chromatic has no key, so it keeps the sharps it has always used.
 */
export function keySpeller(degrees: readonly number[], root: number): (pc: number) => string {
  if (degrees.length >= 12) return (pc) => NAMES[pcOf(pc)]
  const minorish = degrees.includes(3) && !degrees.includes(4)
  let plain = FLAT_MAJORS.has(pcOf(root + (minorish ? 3 : 0))) ? FLATS : NAMES
  let byPc = new Map<number, string>()
  if (degrees.length === 7) {
    let got = onLetters(degrees, root, plain)
    /* ⚠️ D♯ AND G♯ HARMONIC MINOR need a double sharp on their seventh; from E♭ and A♭ they need
       none. The only two of the 84 seven-note keys here that cannot be spelled as chosen. */
    if (!got.clean) {
      const other = plain === FLATS ? NAMES : FLATS
      const alt = onLetters(degrees, root, other)
      if (alt.clean) [got, plain] = [alt, other]
    }
    byPc = got.names
  }
  return (pc) => byPc.get(pcOf(pc)) ?? plain[pcOf(pc)]
}

/** a seven-note scale on seven letters from the tonic `names` gives it — clean if no degree needs a double accidental */
function onLetters(degrees: readonly number[], root: number, names: readonly string[]) {
  const first = LETTERS.indexOf(names[pcOf(root)][0])
  const out = new Map<number, string>()
  let clean = true
  degrees.forEach((d, i) => {
    const letter = (first + i) % 7
    const pc = pcOf(root + d)
    const off = ((pc - LETTER_PC[letter] + 18) % 12) - 6
    if (off === 0) out.set(pc, LETTERS[letter])
    else if (off === 1) out.set(pc, LETTERS[letter] + '♯')
    else if (off === -1) out.set(pc, LETTERS[letter] + '♭')
    else clean = false
  })
  return { names: out, clean }
}

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
export function nameChord(
  midis: number[],
  /* how to spell a pitch class — the room passes `keySpeller` for its key; sharps otherwise */
  spell: (pc: number) => string = pitchName,
): string | null {
  if (midis.length === 0) return null
  const bass = Math.min(...midis)
  /* pitch classes, deduped: a chord does not change its name when you double the root an octave
     up, which is exactly what the Octave strum shape does */
  const pcs = [...new Set(midis.map((m) => ((m % 12) + 12) % 12))].sort((a, b) => a - b)

  if (pcs.length === 1) return spell(pcOf(bass))

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
    const rootName = spell(root)
    /* a two-note shape reads as a phrase rather than a chord: "C and its fifth" */
    if (pcs.length === 2) return `${rootName} ${name}`
    /* an inversion says what is underneath, because your hand is on that note and being told
       "A minor" while looking at a C is the kind of correct that feels like a bug */
    const bassPc = ((bass % 12) + 12) % 12
    return bassPc === root ? `${rootName} ${name}` : `${rootName} ${name} / ${spell(bassPc)}`
  }
  return null
}
