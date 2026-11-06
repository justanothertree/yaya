import { describe, expect, it } from 'vitest'
import { clipScan, coverage, FULL_SCALE } from './clipScan'

/**
 * The one decision in the health meter, asked rather than described.
 *
 * ⚠️ THE EXPECTATIONS COME FROM THE CONVERTER, not from the old `>= 0.985`. A sample is clipped
 * when it cannot be represented — past full scale — and a sample at 0.99 is simply loud. The
 * previous test was a proxy forced by 8-bit data, and like every proxy it was wrong in both
 * directions at once.
 */

/** a window of a sine at a given amplitude, which is the honest shape of "loud but clean" */
const sine = (amp: number, n = 2048) =>
  Float32Array.from({ length: n }, (_, i) => amp * Math.sin((i / n) * Math.PI * 2 * 7))

describe('loud is not clipped', () => {
  it('counts nothing on a sine that just reaches full scale', () => {
    const s = clipScan(sine(1))
    expect(s.over).toBe(0)
    expect(s.peak).toBeLessThanOrEqual(FULL_SCALE)
  })

  /**
   * ⚠️ THE CASE THE OLD TEST GOT WRONG. `>= 0.985` on a 0.99 sine counts every sample near the
   * crest — a clean signal reported as clipping, which is how a meter teaches somebody to stop
   * reading it.
   */
  it('counts nothing at 0.99, where the byte test counted the whole crest', () => {
    const buf = sine(0.99)
    expect(clipScan(buf).over).toBe(0)
    /* and what the old rule would have said about the same window */
    const oldRule = [...buf].filter((v) => Math.abs(v) >= 0.985).length
    expect(oldRule).toBeGreaterThan(0)
  })
})

describe('clipped is clipped', () => {
  it('sees a peak above full scale, which bytes structurally cannot', () => {
    /* 1.100 is the figure measured on the instrument's own tap on 6 Nov 2026 with four backing
       layers at maximum; the byte path reported 0.898 across the same run */
    const s = clipScan(sine(1.1))
    expect(s.peak).toBeCloseTo(1.1, 5)
    expect(s.over).toBeGreaterThan(0)
    /**
     * The ceiling the byte mapping imposes: 128 + 128x clamped into 0..255. Nothing above full
     * scale survives it, whatever the sampling rate — which is why this was a ceiling rather
     * than a resolution problem.
     *
     * ⚠️ AND IT IS NOT EVEN SYMMETRIC, which this assertion found by failing. Byte 0 is exactly
     * -1.0 while byte 255 is +0.992, so the byte path's floor and ceiling differ by one step
     * and a positive peak reads 0.8% lower than the identical negative one.
     */
    const asBytes = [...sine(1.1)].map((v) => Math.min(255, Math.max(0, Math.round(128 + 128 * v))))
    const back = asBytes.map((b) => (b - 128) / 128)
    expect(Math.max(...back)).toBeCloseTo(0.992, 3)
    expect(Math.min(...back)).toBeCloseTo(-1, 6)
    expect(Math.max(...back.map(Math.abs))).toBeLessThanOrEqual(1)
  })

  it('counts both polarities', () => {
    expect(clipScan(new Float32Array([1.5, -1.5, 0.2])).over).toBe(2)
  })

  it('carries a running peak in so repeated windows keep the worst', () => {
    expect(clipScan(sine(0.3), 0.9).peak).toBeCloseTo(0.9, 6)
    expect(clipScan(sine(1.4), 0.9).peak).toBeCloseTo(1.4, 5)
  })

  it('does not accumulate the count — that lifetime belongs to the caller', () => {
    const hot = new Float32Array([2, 2, 2])
    expect(clipScan(hot).over).toBe(3)
    expect(clipScan(hot).over).toBe(3)
  })
})

describe('a window that is not audio', () => {
  /**
   * NaN on an AudioParam is silence at the output, and NaN fails every comparison — so it
   * neither raises the peak nor is counted. That is the right answer and worth pinning, because
   * a scan that reported NaN would poison peakMax for the rest of the session.
   */
  it('reports silence for NaN rather than poisoning the latched peak', () => {
    const s = clipScan(new Float32Array([NaN, NaN, 0.5]))
    expect(s.peak).toBe(0.5)
    expect(s.over).toBe(0)
    expect(Number.isFinite(s.peak)).toBe(true)
  })

  it('reports zero for an empty window', () => {
    expect(clipScan(new Float32Array(0))).toEqual({ peak: 0, over: 0 })
  })
})

describe('how much of the audio is actually looked at', () => {
  /**
   * ⚠️ THE FIGURE THE STRIP SHOWS, so it cannot drift from the cadence that produces it. The
   * old tooltip said 4.3% as a literal; the scan moved to 20Hz and that sentence would have
   * gone on saying 4.3 with nothing able to contradict it.
   */
  it('is 4.3% at one 2048-sample read a second, which is what the meter used to do', () => {
    expect(coverage(2048, 1000, 48000)).toBeCloseTo(0.0427, 4)
  })

  it('is about 85% at the 20Hz sampler it rides now', () => {
    expect(coverage(2048, 50, 48000)).toBeCloseTo(0.853, 3)
  })

  it('never claims more than all of it, however fast the sampler runs', () => {
    expect(coverage(2048, 1, 48000)).toBe(1)
    expect(coverage(2048, 50, 8000)).toBe(1)
  })

  it('answers zero rather than Infinity when asked something impossible', () => {
    for (const bad of [
      coverage(0, 50, 48000),
      coverage(2048, 0, 48000),
      coverage(2048, 50, 0),
      coverage(NaN, 50, 48000),
    ])
      expect(bad).toBe(0)
  })
})
