import { describe, expect, it } from 'vitest'
import {
  ROLL_BAR_MAX,
  ROLL_CELL_MIN,
  gridStep,
  rollSize,
  soundingAt,
  toEvents,
  toNotes,
  type Note,
} from './noteEdit'

/**
 * The piano roll's geometry, asked without a browser.
 *
 * ⚠️ EVERY EXPECTATION HERE IS WRITTEN FROM THE TAKE, never from the formula. "A four-bar take
 * is four bars wide whatever the snap is" is a claim about music; `cols * cellW` is the sum the
 * code already makes, and asserting against it would agree with the bug.
 */

const SNAPS = [1, 2, 4, 8, 16]

describe('rollSize', () => {
  it('draws a take at the same width whatever the snap is', () => {
    // four bars at 120bpm is eight seconds, in a panel wide enough to hold them
    const take = { len: 8, bpm: 120, avail: 1024 }
    const widths = SNAPS.map((quantize) => rollSize({ ...take, quantize }).width)
    // ⚠️ the claim: changing how finely notes land does not redraw the music at another size
    expect(new Set(widths).size).toBe(1)
  })

  it('still divides that width into one cell per snap step', () => {
    const take = { len: 8, bpm: 120, avail: 1024 }
    for (const quantize of SNAPS) {
      const r = rollSize({ ...take, quantize })
      // a step of the grid is a step of the music: 4/quantize of a beat
      expect(r.cols).toBe(Math.round(take.len / gridStep(take.bpm, quantize)))
      // and the cells fill the roll rather than leaving it part-drawn
      expect(r.cellW * r.cols).toBe(r.width)
    }
  })

  it('never narrows as the snap gets finer — the floor may only widen it', () => {
    /* eight bars at 1/16 is 128 steps; at any sane panel width that hits the grabbable floor and
       the roll scrolls. That is the one case where width legitimately moves, and the direction
       is the whole point: a finer grid may need MORE room, never less. */
    const take = { len: 16, bpm: 120, avail: 700 }
    let last = 0
    for (const quantize of SNAPS) {
      const w = rollSize({ ...take, quantize }).width
      expect(w).toBeGreaterThanOrEqual(last)
      last = w
    }
  })

  it('keeps every cell big enough to grab', () => {
    for (const quantize of SNAPS) {
      for (const len of [2, 8, 16, 30]) {
        const r = rollSize({ len, bpm: 120, quantize, avail: 380 })
        expect(r.cellW).toBeGreaterThanOrEqual(ROLL_CELL_MIN)
      }
    }
  })

  it('does not stretch a short take across a wide screen', () => {
    // two bars at 120bpm, on a very wide panel: it stays two bars wide, not 3000px wide
    const r = rollSize({ len: 4, bpm: 120, quantize: 8, avail: 3000 })
    expect(r.bars).toBe(2)
    expect(r.width).toBeLessThanOrEqual(r.bars * ROLL_BAR_MAX)
  })

  it('fills a panel it fits in', () => {
    // ⚠️ measured against the PANEL, which shares no arithmetic with cols or cellW
    const avail = 1024
    const r = rollSize({ len: 8, bpm: 120, quantize: 8, avail })
    expect(r.width).toBeGreaterThan(avail * 0.9)
    expect(r.width).toBeLessThanOrEqual(avail)
  })

  it('reports bars that match the take, so the ruler counts real bars', () => {
    for (const [bpm, len, bars] of [
      [120, 8, 4],
      [120, 4, 2],
      [60, 8, 2],
      [240, 8, 8],
    ] as const) {
      expect(rollSize({ len, bpm, quantize: 8, avail: 900 }).bars).toBe(bars)
      // and a bar is the width of the take divided by how many there are
      const r = rollSize({ len, bpm, quantize: 8, avail: 900 })
      expect(r.barW * r.bars).toBeCloseTo(r.width, 6)
    }
  })
})

describe('what a take is holding at a moment', () => {
  /* a four-chord progression's shape: three notes a slot, each ending just before the next */
  const prog: Note[] = [
    { midi: 60, t: 0, dur: 0.96 },
    { midi: 64, t: 0, dur: 0.96 },
    { midi: 67, t: 0, dur: 0.96 },
    { midi: 67, t: 1, dur: 0.96 },
    { midi: 71, t: 1, dur: 0.96 },
    { midi: 74, t: 1, dur: 0.96 },
  ]

  it('is the chord whose slot the moment falls in', () => {
    expect(soundingAt(prog, 0)).toEqual([60, 64, 67])
    expect(soundingAt(prog, 0.5)).toEqual([60, 64, 67])
    expect(soundingAt(prog, 1.2)).toEqual([67, 71, 74])
  })

  it('is nothing in the gap a take leaves between them', () => {
    /* 0.96 of a 1.0 slot, so 0.98 is the sliver of silence that makes a repeat re-articulate */
    expect(soundingAt(prog, 0.98)).toEqual([])
  })

  it('hands over on the boundary rather than sounding both', () => {
    /* half-open: a note starting exactly where another ends does not overlap it */
    const touching: Note[] = [
      { midi: 60, t: 0, dur: 1 },
      { midi: 62, t: 1, dur: 1 },
    ]
    expect(soundingAt(touching, 1), 'the instant of handover belongs to the new one').toEqual([62])
    expect(soundingAt(touching, 0.999)).toEqual([60])
  })

  it('is nothing before the take starts or after it ends', () => {
    expect(soundingAt(prog, -1)).toEqual([])
    expect(soundingAt(prog, 99)).toEqual([])
  })

  it('answers nothing rather than throwing on a moment that is not a number', () => {
    /* `at` comes from a clock and a division — both can produce this */
    expect(soundingAt(prog, Number.NaN)).toEqual([])
    expect(soundingAt([], 0.5)).toEqual([])
  })

  it('and goes through the same converter a real take does', () => {
    /* built from EVENTS, the way a layer actually stores them, so the round trip is exercised
       rather than a hand-written note list that cannot be wrong */
    const events = toEvents(prog, 2)
    const back = toNotes(events, 2)
    expect(soundingAt(back, 0.5)).toEqual([60, 64, 67])
    expect(soundingAt(back, 1.2)).toEqual([67, 71, 74])
  })
})
