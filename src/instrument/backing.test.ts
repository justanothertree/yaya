import { describe, expect, it } from 'vitest'
import type { Layer } from '../audio/looper'
import { ownParts, styleOfBass, styleOfChord, voicingOf } from './backing'

/**
 * Pinned before the backing logic moved out of InstrumentRoom.tsx. A layer the backing laid is
 * known by the mark in its id (see looper.ts), so these build ids the way the pickers do.
 */
const layer = (id: string): Layer => ({
  id,
  instrument: 'keys',
  muted: false,
  len: 4,
  events: [],
  fx: { echo: 0, echoTime: 0.26, space: 0, vibrato: 0, glide: 0, tone: 0.5 },
})

describe('what the backing laid, and what you played', () => {
  const beat = layer('1-beat:rock-straight')
  const chords = layer('2-chords:four-stabs')
  const bass = layer('3-bass:four-walk')
  const fill = layer('4-fill:toms')

  it('a song of nothing but backing has no parts of your own, so a style may set its tempo', () => {
    expect(ownParts([beat, chords, bass, fill])).toBe(false)
    expect(ownParts([])).toBe(false)
  })

  it('one part you played is enough to keep the tempo you have', () => {
    expect(ownParts([beat, chords, layer('1731000000000-take')])).toBe(true)
  })

  it('reads the style a chord or bass row was laid in, and the original one when untagged', () => {
    expect(styleOfChord(chords)).toBe('stabs')
    expect(styleOfChord(layer('2-chords:four'))).toBe('pad')
    expect(styleOfBass(bass)).toBe('walk')
    expect(styleOfBass(layer('3-bass:four'))).toBe('rootfifth')
  })

  it('lays a Chromatic backing in C major, and any other scale in its own key', () => {
    expect(voicingOf('chromatic', 7)).toEqual({ degrees: [0, 2, 4, 5, 7, 9, 11], root: 0 })
    expect(voicingOf('minor', 9).root).toBe(9)
    expect(voicingOf('minor', 9).degrees).toEqual([0, 2, 3, 5, 7, 8, 10])
  })
})
