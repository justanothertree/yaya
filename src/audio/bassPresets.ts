import type { BassStyle } from './chordPatterns'
import type { InstrumentId } from './synth'

/**
 * A bass part in one press: the line and the voice that play it together.
 *
 * ⚠️ WHY (Evan, 10 Nov 2026: "bass presets"). The Bass row offers seven lines and ten voices,
 * which is seventy combinations and no hint which of them belong together. A walking line on an
 * 808 is a choice nobody makes on purpose. A preset is a pairing somebody would actually play,
 * and it sets the same two controls the row already has, so whatever it picks stays editable
 * right there.
 *
 * ⚠️ PURE, LIKE starters.ts. Which preset a loaded bass "is" is a question about two values, and
 * answering it is `presetOf`'s job, so the Preset menu always shows what is loaded rather than
 * what was last pressed.
 */
export type BassPreset = {
  id: string
  name: string
  style: BassStyle
  voice: InstrumentId
  hint: string
}

export const BASS_PRESETS: readonly BassPreset[] = [
  {
    id: 'motown',
    name: 'Motown',
    style: 'rootfifth',
    voice: 'finger',
    hint: 'Finger bass, root and fifth',
  },
  { id: 'rock', name: 'Rock', style: 'pulse', voice: 'pick', hint: 'Pick bass, driving eighths' },
  { id: 'funk', name: 'Funk', style: 'funk', voice: 'slap', hint: 'Slap bass, syncopated' },
  { id: 'walking', name: 'Walking', style: 'walk', voice: 'upright', hint: 'Upright, every beat' },
  { id: 'bossa', name: 'Bossa', style: 'bossa', voice: 'upright', hint: 'Upright, bossa rhythm' },
  { id: 'dub', name: 'Dub', style: 'dub', voice: 'sub', hint: 'Deep sub, reggae line' },
  { id: 'smooth', name: 'Smooth', style: 'roots', voice: 'fretless', hint: 'Fretless, long notes' },
  { id: 'trap', name: 'Trap', style: 'roots', voice: '808', hint: '808, one long note a chord' },
  {
    id: 'house',
    name: 'House',
    style: 'offbeat',
    voice: 'synthbass',
    hint: 'Synth bass, between the kicks',
  },
  { id: 'disco', name: 'Disco', style: 'octaves', voice: 'finger', hint: 'Finger bass, octaves' },
  { id: 'acid', name: 'Acid house', style: 'funk', voice: 'acid', hint: 'Acid bass, sixteenths' },
]

/** The preset a bass on this line and voice matches, or null for a pairing of your own. */
export function presetOf(style: BassStyle | null, voice: InstrumentId | null): BassPreset | null {
  return BASS_PRESETS.find((p) => p.style === style && p.voice === voice) ?? null
}
