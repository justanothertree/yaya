import { BASS_STYLES, CHORD_PATTERNS } from '../audio/chordPatterns'
import { DRUM_PATTERNS } from '../audio/drumPatterns'
import {
  bassPatternOf,
  bassStyleTagOf,
  beatPatternOf,
  chordPatternOf,
  fillPatternOf,
  type Layer,
} from '../audio/looper'

/**
 * What a layer the backing laid IS — "Beat · Four on the floor", "Chords · Four chords",
 * "Bass · Walk", "Fill" — or null for a part somebody played, whose row keeps counting its notes.
 *
 * ⚠️ A BEAT BY ITS OWN NAME, NOT ITS GENRE AS WELL. "Beat · Pop four on the floor" measured 202px
 * at 375 and pushed the row's sound menu onto a line of its own; the genre is one row up, in the
 * Beat row's Genre menu, whenever it is wanted.
 *
 * ⚠️ READ FROM THE MARK IN THE ID, like every other "came from the picker" question (see
 * looper.ts), so a backing saved into a song and opened again is a part of yours and counts its
 * notes, exactly as the pickers stop claiming it. A beat or progression this bundle does not know
 * — a song from a newer one — also falls back to the count rather than naming something wrongly.
 */
export function layerTitle(l: Layer): string | null {
  const beat = beatPatternOf(l)
  if (beat !== null) {
    const d = DRUM_PATTERNS.find((p) => p.id === beat)
    return d ? `Beat · ${d.name}` : null
  }
  const chords = chordPatternOf(l)
  if (chords !== null) {
    const p = CHORD_PATTERNS.find((x) => x.id === chords)
    return p ? `Chords · ${p.name}` : null
  }
  const bass = bassPatternOf(l)
  if (bass !== null) {
    if (!CHORD_PATTERNS.some((x) => x.id === bass)) return null
    const style = BASS_STYLES.find((x) => x.id === (bassStyleTagOf(l) ?? 'rootfifth'))
    return style ? `Bass · ${style.name}` : null
  }
  if (fillPatternOf(l) !== null) return 'Fill'
  return null
}
