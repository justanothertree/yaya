import {
  BASS_STYLES,
  CHORD_STYLES,
  type BassStyle,
  type ChordStyle,
  type Voicing,
} from '../audio/chordPatterns'
import {
  bassPatternOf,
  bassStyleTagOf,
  beatPatternOf,
  chordPatternOf,
  chordStyleTagOf,
  fillPatternOf,
  type Layer,
} from '../audio/looper'
import { MAJOR_DEGREES, SCALES, degreesOf } from '../audio/scales'
import type { InstrumentId } from '../audio/synth'

/**
 * The backing's pure parts — what style a row was laid in, the key a backing is laid in, and
 * whether a song holds anything you played — moved out of InstrumentRoom.tsx unchanged on
 * 11 Nov 2026. The state and the calls that lay a backing are in useBacking.ts.
 */

/** remembered: whether a dropped progression ends on the chord that leans back to the top */
export const LEAD_KEY = 'instrument_leadback_v1'

/** The sound each chord style starts on — see layChords for when a change of style may change it. */
export const CHORD_SOUND: Record<ChordStyle, InstrumentId> = {
  pad: 'pad',
  stabs: 'keys',
  offbeat: 'keys',
  pulse: 'keys',
}
export const styleOfChord = (l: Layer): ChordStyle =>
  CHORD_STYLES.find((x) => x.id === chordStyleTagOf(l))?.id ?? 'pad'
export const styleOfBass = (l: Layer): BassStyle =>
  BASS_STYLES.find((x) => x.id === bassStyleTagOf(l))?.id ?? 'rootfifth'

/**
 * The key a backing is laid in for this room's Scale and Key — Chromatic has no degrees to build
 * chords on, so it borrows C major exactly as `layChords` always has.
 */
export const voicingOf = (scale: string, root: number): Voicing =>
  scale === 'chromatic' ? { degrees: MAJOR_DEGREES, root: 0 } : { degrees: degreesOf(scale), root }
/** every key a backing can be recognised in — see `revoice` */
export const VOICED_SCALES = SCALES.filter(([id]) => id !== 'chromatic').map(([, , d]) => d)

/**
 * Whether a song holds a part somebody played, rather than only what the backing laid — see
 * applyStarter in useBacking.ts, which may set the tempo only when it does not.
 */
export const ownParts = (layers: readonly Layer[]) =>
  layers.some(
    (l) =>
      beatPatternOf(l) === null &&
      chordPatternOf(l) === null &&
      bassPatternOf(l) === null &&
      fillPatternOf(l) === null,
  )
