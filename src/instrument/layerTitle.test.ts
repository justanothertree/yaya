import { describe, expect, it } from 'vitest'
import type { Layer } from '../audio/looper'
import { layerTitle } from './layerTitle'

/**
 * Item 1 of docs/2026-11-11-instrument-flow-map.md: a Pop style laid three rows named
 * "1. 10 notes", "2. 48 notes" and "3. 8 notes", and which was the beat, which the chords and
 * which the bass was only in each row's sound menu. Ids are built the way the pickers build them.
 */
const layer = (id: string): Layer => ({
  id,
  instrument: 'keys',
  muted: false,
  len: 4,
  events: [],
  fx: { echo: 0, echoTime: 0.26, space: 0, vibrato: 0, glide: 0, tone: 0.5 },
})

describe('a layer says what it is', () => {
  it('a beat by its own name — the genre is in the Beat row, and would crowd a phone', () => {
    expect(layerTitle(layer('1-beat:rock-straight'))).toBe('Beat · Straight')
    expect(layerTitle(layer('1-beat:pop-four'))).toBe('Beat · Four on the floor')
    expect(layerTitle(layer('1-beat:funk-syncopated'))).toBe('Beat · Funk')
  })

  it('chords by their progression, a bass by its line, whatever style it was laid in', () => {
    expect(layerTitle(layer('2-chords:four'))).toBe('Chords · Four chords')
    expect(layerTitle(layer('2-chords:four-stabs'))).toBe('Chords · Four chords')
    expect(layerTitle(layer('3-bass:four'))).toBe('Bass · Root & fifth')
    expect(layerTitle(layer('3-bass:four-walk'))).toBe('Bass · Walk')
  })

  it('a fill is a fill', () => {
    expect(layerTitle(layer('4-fill:fill'))).toBe('Fill')
  })

  it('a part somebody played has no title — its row keeps counting its notes', () => {
    expect(layerTitle(layer('1731000000000-take'))).toBeNull()
  })

  it('and a beat or progression this bundle does not know falls back to the count too', () => {
    expect(layerTitle(layer('1-beat:polka-oompah'))).toBeNull()
    expect(layerTitle(layer('2-chords:nonesuch'))).toBeNull()
  })
})
