import type { BassStyle, ChordStyle } from './chordPatterns'
import type { InstrumentId } from './synth'

/**
 * One press, a whole backing: a beat, chords played in a style, a bassline under them, and a
 * tempo that suits them.
 *
 * ⚠️ EVAN'S ASK, 10 NOV 2026 — "one-press genre starters … for me to judge by ear". The backing
 * panel already had every part; choosing them was five decisions in four rows, each needing you
 * to know what the others should be. A starter is those five choices made together by somebody
 * who has, so the blank page becomes "Reggae" rather than "a one-drop, then Simple, then Offbeat,
 * then Roots, at 76".
 *
 * ⚠️ NOTHING NEW UNDER IT. Each entry names a drum pattern, a progression, a chord style and a
 * bass style that the panel already offers, and the room lays them with the same calls its own
 * buttons make — so a starter lands as ordinary layers, every row of the panel then shows what it
 * picked, and changing any one of them afterwards is the panel working as it always has.
 *
 * ⚠️ IN THE ROOM'S KEY, NEVER ITS OWN. The progressions are scale degrees, so Reggae in C major
 * and Reggae in A minor are both right; a starter that changed the key would rewrite the
 * keyboard under somebody's hands.
 *
 * ⚠️ NONE OF THESE HAS BEEN HEARD. They are written from what each style is known for — the
 * reggae skank on the offbeat, the walking bass under jazz, country's boom-chick — and they are a
 * draft for a person with ears to judge.
 */
export type Starter = {
  id: string
  name: string
  /** what it is, for the button's title */
  hint: string
  bpm: number
  /** a DRUM_PATTERNS id */
  beat: string
  /** a CHORD_PATTERNS id */
  chords: string
  chordStyle: ChordStyle
  bass: BassStyle
  /**
   * The bass VOICE, only where one clearly belongs to the style — Evan, 10 Nov 2026: "an 808 for
   * Hip hop makes sense, so let styles pick a bass voice where it clearly fits". Absent means the
   * plain Bass. Four styles have one, because those four are what each voice is FOR: the 808 is
   * hip hop's bass, slap is funk's, a walking line is an upright's, and house is synth bass.
   */
  bassVoice?: InstrumentId
}

export const STARTERS: Starter[] = [
  {
    id: 'pop',
    name: 'Pop',
    hint: 'Four chords pushed along, on a pop beat',
    bpm: 110,
    beat: 'pop-four',
    chords: 'four',
    chordStyle: 'pulse',
    bass: 'rootfifth',
  },
  {
    id: 'ballad',
    name: 'Ballad',
    hint: 'Slow, held chords over a half-time beat',
    bpm: 72,
    beat: 'rock-half',
    chords: 'canon',
    chordStyle: 'pad',
    bass: 'roots',
  },
  {
    id: 'rock',
    name: 'Rock',
    hint: 'Three chords, struck on every beat, driving',
    bpm: 124,
    beat: 'rock-driving',
    chords: 'simple',
    chordStyle: 'stabs',
    bass: 'pulse',
  },
  {
    id: 'hiphop',
    name: 'Hip hop',
    hint: 'A boom-bap beat under a slow, sad loop',
    bpm: 88,
    beat: 'hiphop-boombap',
    chords: 'sad',
    chordStyle: 'pad',
    bass: 'roots',
    bassVoice: '808',
  },
  {
    id: 'house',
    name: 'House',
    hint: 'Four on the floor, two chords stabbed on the beat',
    bpm: 124,
    beat: 'house-classic',
    chords: 'vamp',
    chordStyle: 'stabs',
    bass: 'pulse',
    bassVoice: 'synthbass',
  },
  {
    id: 'funk',
    name: 'Funk',
    hint: 'A syncopated groove and a two-chord vamp',
    bpm: 104,
    beat: 'funk-syncopated',
    chords: 'vamp',
    chordStyle: 'offbeat',
    bass: 'funk',
    bassVoice: 'slap',
  },
  {
    id: 'reggae',
    name: 'Reggae',
    hint: 'One-drop drums, the chord on the offbeat',
    bpm: 76,
    beat: 'reggae-onedrop',
    chords: 'simple',
    chordStyle: 'offbeat',
    bass: 'dub',
  },
  {
    id: 'jazz',
    name: 'Jazz',
    hint: 'Ride cymbal, the circle of fifths, a walking bass',
    bpm: 120,
    beat: 'jazz-ride',
    chords: 'circle',
    chordStyle: 'pad',
    bass: 'walk',
    bassVoice: 'upright',
  },
  {
    id: 'bossa',
    name: 'Bossa',
    hint: 'Bossa nova: root and fifth under a gentle pulse',
    bpm: 128,
    beat: 'latin-bossa',
    chords: 'turnaround',
    chordStyle: 'pulse',
    bass: 'bossa',
  },
  {
    id: 'country',
    name: 'Country',
    hint: 'Train beat and boom-chick: bass on the beat, chord off it',
    bpm: 110,
    beat: 'country-train',
    chords: 'fifties',
    chordStyle: 'offbeat',
    bass: 'rootfifth',
  },
]

/** The starter the backing currently IS, part for part — or null when any part differs. */
export function starterNow(parts: {
  beat: string | null
  chords: string | null
  chordStyle: ChordStyle | null
  bass: BassStyle | null
}): Starter | null {
  return (
    STARTERS.find(
      (s) =>
        s.beat === parts.beat &&
        s.chords === parts.chords &&
        s.chordStyle === parts.chordStyle &&
        s.bass === parts.bass,
    ) ?? null
  )
}

/**
 * The bass voice a style should leave the bass on — or null to leave it alone.
 *
 * ⚠️ A STYLE NEVER OVERRULES A VOICE YOU CHOSE, the rule `layChords` already keeps for the chords'
 * sound. So the voice changes only when the bass is on what the room or the last style put there:
 * there was no bass yet, or it is still on that style's voice (plain Bass when it had none). Pick
 * Finger bass yourself, then press Hip hop, and you keep Finger bass.
 *
 * @param was the bass layer's voice before the press, or null when there was no bass
 * @param prev the style the backing was before the press, or null when it was not one
 */
export function styleBassVoice(
  was: InstrumentId | null,
  prev: Starter | null,
  next: Starter,
): InstrumentId | null {
  if (was !== null && was !== (prev?.bassVoice ?? 'bass')) return null
  return next.bassVoice ?? 'bass'
}
