import { describe, expect, it } from 'vitest'
import { ROLL_BAR_MAX, ROLL_CELL_MIN, gridStep, rollSize } from './noteEdit'

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
