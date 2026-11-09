import { describe, expect, it } from 'vitest'
import { addPatternLayer, loadSong, loopState, type Layer, type LoopEvent } from './looper'

/**
 * A swap in the backing panel — a new beat, a new progression, a new way of playing it — replaces
 * the row's notes and keeps everything that is a choice about the ROW.
 *
 * ⚠️ EVERY FIELD BELOW IS SOMETHING OTHER THAN ITS DEFAULT, and both mutes are asked: a test that
 * only swapped a muted layer would pass if a swap muted everything, and one that only swapped an
 * unmuted layer is the old behaviour passing.
 */

const fx = { echo: 0.4, echoTime: 0.31, space: 0.6, vibrato: 0.2, glide: 0.1, tone: 0.3 }
const hit = (t: number, midi = 36): LoopEvent[] => [
  { t, midi, on: true },
  { t: t + 0.1, midi, on: false },
]

const row = (id: string, over: Partial<Layer> = {}): Layer => ({
  id,
  instrument: 'organ',
  muted: true,
  gain: 0.3,
  len: 2,
  fx,
  plan: [0, null, 0, null],
  events: hit(0, 40),
  ...over,
})

describe('swapping a row of the backing', () => {
  it('keeps a muted row muted — a swap is not a reason to be heard', () => {
    loadSong(120, 4, [row('1700000000000-beat:rock')])
    const id = addPatternLayer(hit(0.5), 2.5, 'funk')
    const l = loopState().layers.find((x) => x.id === id)!
    expect(l.muted).toBe(true)
  })

  it('and an unmuted one unmuted', () => {
    loadSong(120, 4, [row('1700000000000-beat:rock', { muted: false })])
    const id = addPatternLayer(hit(0.5), 2.5, 'funk')
    expect(loopState().layers.find((x) => x.id === id)!.muted).toBe(false)
  })

  it('keeps the rest of the row as well, and takes the new notes', () => {
    loadSong(120, 4, [
      row('1700000000000-chords:four-stabs'),
      row('1700000000001-bass:four', { instrument: 'bass', muted: false, gain: 0.5 }),
    ])
    const id = addPatternLayer(hit(0.25, 60), 3, 'wistful-pulse', { mark: '-chords:' })
    const [chords, bass] = loopState().layers
    expect(chords.id).toBe(id)
    expect(chords).toMatchObject({
      muted: true,
      gain: 0.3,
      instrument: 'organ',
      fx,
      plan: [0, null, 0, null],
      len: 3,
      events: hit(0.25, 60),
    })
    /* the other row is not touched — the swap finds its own mark and no other */
    expect(bass.id).toBe('1700000000001-bass:four')
    expect(bass.muted).toBe(false)
  })

  it('and a row that is not there yet arrives unmuted', () => {
    loadSong(120, 4, [])
    const id = addPatternLayer(hit(0), 2, 'rock')
    expect(loopState().layers.find((x) => x.id === id)!.muted).toBe(false)
  })
})
