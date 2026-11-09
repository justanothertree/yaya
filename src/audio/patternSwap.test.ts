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

describe('shortening the loop under a progression', () => {
  /**
   * ⚠️ NOT RE-LAID — Evan's call, 9 Nov 2026. A progression is laid for the loop's length when it
   * is picked; shortening the loop leaves the layer as it was and the scheduler stops reaching
   * its last bars, which the backing panel says ("cut short — pick it again to fit"). Growing it
   * back gives every bar back, which is the reason not to rewrite the notes on the way down.
   */
  it('leaves the notes and the length alone, so growing it back gives every bar back', async () => {
    const { setBars } = await import('./looper')
    const four = [0, 2, 4, 6].flatMap((t) => hit(t, 60 + t))
    loadSong(120, 4, [row('1700000000000-chords:four', { plan: undefined, events: four, len: 8 })])
    setBars(2)
    expect(loopState().layers[0]).toMatchObject({ events: four, len: 8 })
    setBars(4)
    expect(loopState().layers[0]).toMatchObject({ events: four, len: 8 })
  })
})
