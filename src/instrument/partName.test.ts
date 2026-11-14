import { describe, expect, it } from 'vitest'
import type { Layer, LoopEvent } from '../audio/looper'
import { partLines } from './partName'

/**
 * A part's row in the #311 layout carries its name, its bars, its mute and its ⋯ — so the name is
 * where the row says what the part is and what it plays on, which used to be the row's own
 * instrument dropdown. Ids are built the way the pickers build them (see layerTitle.test).
 */
const hit = (midi: number, t: number): LoopEvent[] => [
  { t, midi, on: true },
  { t: t + 0.1, midi, on: false },
]
const part = (id: string, instrument: Layer['instrument'], events: LoopEvent[]): Layer => ({
  id,
  instrument,
  muted: false,
  len: 4,
  events,
  fx: { echo: 0, echoTime: 0.26, space: 0, vibrato: 0, glide: 0, tone: 0.5 },
})

describe('a part says what it is, and what it plays on', () => {
  it('a laid beat: what it is on the first line, its style and its sound on the second', () => {
    const beat = part('1-beat:funk-syncopated', 'drums', [...hit(36, 0), ...hit(38, 1)])
    expect(partLines(beat, 0)).toEqual({ name: '1. Beat', detail: 'Funk · Drums' })
  })

  it('a laid bass names its line, and the position in the list is its own', () => {
    const bass = part('3-bass:four-walk', 'bass', hit(40, 0))
    expect(partLines(bass, 2)).toEqual({ name: '3. Bass', detail: 'Walk · Bass' })
  })

  it('a fill has no style to name, so the second line is only its sound', () => {
    const fill = part('4-fill:rock', 'drums', [...hit(36, 0), ...hit(38, 1)])
    const got = partLines(fill, 3)
    expect(got.name).toBe('4. Fill')
    expect(got.detail).toBe('Drums')
  })

  it('a part somebody played counts its notes — the count is the handle for showing them', () => {
    const played = part('9-take', 'rhodes', [...hit(60, 0), ...hit(64, 1), ...hit(67, 2)])
    expect(partLines(played, 1)).toEqual({ name: '2. 3 notes', detail: 'Rhodes' })
  })

  it('a split kit row says which drum first, since "3." and "4." are otherwise the same', () => {
    const snare = part('5-beat:funk-syncopated', 'drums', [...hit(38, 0), ...hit(38, 1)])
    expect(partLines(snare, 2).name).toBe('3. Snare Beat')
    const played = part('6-take', 'drums', [...hit(36, 0), ...hit(36, 1)])
    /* a played kit row holding one drum: the drum IS the name, and no note count beside it */
    expect(partLines(played, 3)).toEqual({ name: '4. Kick', detail: 'Drums' })
  })
})
