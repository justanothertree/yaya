import { describe, expect, it } from 'vitest'
import { layerHeard, loadSong, loopState, setBars, type Layer } from './looper'

/**
 * Growing a song through the room's own `setBars`, with every kind of layer the bar strip draws
 * sitting in it at once — so the fill's move and the arrangement's repeat are asked of one call
 * and cannot be satisfied by two different ones.
 *
 * ⚠️ EVERY LAYER IS ONE PART PER BAR at 120bpm (a bar is two seconds), so a part index read back
 * is a bar of the take and nothing else. What is asserted is `layerHeard` — which bar of the take
 * sounds in each bar of the song, through the same `partAt` the scheduler acts on.
 */

const fx = { echo: 0, echoTime: 0.26, space: 0, vibrato: 0, glide: 0, tone: 0.5 }
const layer = (id: string, len: number, plan?: (number | null)[]): Layer => ({
  id,
  instrument: 'rhodes',
  muted: false,
  len,
  fx,
  plan,
  events: [
    { t: 0, midi: 60, on: true },
    { t: 0.5, midi: 60, on: false },
  ],
})
const heard = (id: string) => layerHeard(loopState().layers.find((l) => l.id === id)!)

describe('growing a song with arrangements in it', () => {
  const setUp = () =>
    loadSong(120, 2, [
      /* a two-bar take, its bars swapped */
      layer('arranged', 4, [1, 0]),
      /* a two-bar take nobody arranged */
      layer('plain', 4),
      /* "On the last bar" */
      layer('1700000000000-fill:roll', 2, [null, 0]),
    ])

  it('repeats an arrangement, moves a fill to the new last bar, and tiles a plain take', () => {
    setUp()
    setBars(4)
    expect(heard('arranged')).toEqual([1, 0, 1, 0])
    expect(heard('1700000000000-fill:roll')).toEqual([null, null, null, 0])
    expect(heard('plain')).toEqual([0, 1, 0, 1])
  })

  it('and a fill dragged off the last bar is an arrangement like any other', () => {
    loadSong(120, 3, [layer('1700000000000-fill:roll', 2, [0, null, null])])
    setBars(6)
    expect(heard('1700000000000-fill:roll')).toEqual([0, null, null, 0, null, null])
  })

  it('shrinking and growing back gives the same song', () => {
    loadSong(120, 4, [layer('arranged', 8, [3, 2, null, 0])])
    setBars(2)
    expect(heard('arranged')).toEqual([3, 2])
    setBars(4)
    expect(heard('arranged')).toEqual([3, 2, null, 0])
    setBars(8)
    expect(heard('arranged')).toEqual([3, 2, null, 0, 3, 2, null, 0])
  })
})
