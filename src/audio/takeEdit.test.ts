import { describe, expect, it } from 'vitest'
import {
  atFraction,
  clampTrim,
  isWhole,
  MIN_TRIM,
  peaks,
  pickRange,
  trimFrames,
  trimLen,
  wholeTake,
} from './takeEdit'

/**
 * Looking at a take and choosing part of it.
 *
 * ⚠️ THE EXPECTATIONS COME FROM THE AUDIO, not from the arithmetic in takeEdit. "A click lasts
 * a handful of samples and must appear in exactly the column it happened in" is a fact about
 * drawing a waveform; `Math.floor((c * n) / cols)` is a copy of the implementation. The first
 * catches a stride that steps over transients, which is the bug this envelope exists to avoid.
 */

const sine = (n: number, cycles = 8, amp = 1) =>
  Float32Array.from({ length: n }, (_, i) => amp * Math.sin((i / n) * Math.PI * 2 * cycles))

describe('the picture shows what is in the audio', () => {
  it('draws silence as a flat line rather than as noise', () => {
    const p = peaks(new Float32Array(4800), 120)
    expect(p.length).toBe(240)
    expect([...p].every((v) => v === 0)).toBe(true)
  })

  it('reaches the full height of a full-scale signal', () => {
    const p = peaks(sine(48000), 200)
    expect(Math.min(...p)).toBeCloseTo(-1, 2)
    expect(Math.max(...p)).toBeCloseTo(1, 2)
  })

  it('never shows more than the audio contains', () => {
    const p = peaks(sine(48000, 8, 0.3), 200)
    expect(Math.max(...p)).toBeLessThanOrEqual(0.3 + 1e-6)
    expect(Math.min(...p)).toBeGreaterThanOrEqual(-0.3 - 1e-6)
  })

  /**
   * ⚠️ THE ONE THAT CATCHES A STRIDE. A single-sample click is what you are looking for when
   * you open a recording, and any sampling scheme that reads one sample in every n will step
   * straight over it — leaving a picture that says the take is clean while the ear says
   * otherwise. One column lights up, and it is the right one.
   */
  it('shows a one-sample click, in the column it happened in and no other', () => {
    const data = new Float32Array(48000)
    /**
     * ⚠️ 24037, NOT 24000, AND THE FIRST VERSION OF THIS TEST USED 24000. Column 50 begins at
     * sample 24000, so a click placed there is the one position a strided reader always hits —
     * the fixture was neutralising the single dimension under test. Perturbed to read one
     * sample in every 64 and it stayed green. An offset of 37 is coprime with any sane stride
     * and sits well inside the same column.
     */
    data[24037] = 0.9
    const cols = 100
    const p = peaks(data, cols)
    const lit = []
    for (let c = 0; c < cols; c++) if (p[c * 2 + 1] > 0.5) lit.push(c)
    expect(lit).toEqual([50])
  })

  it('keeps a DC offset rather than centring it away', () => {
    const p = peaks(new Float32Array(1000).fill(0.5), 10)
    expect(Math.min(...p)).toBeCloseTo(0.5, 6)
    expect(Math.max(...p)).toBeCloseTo(0.5, 6)
  })

  it('reaches the very end of the audio, not almost', () => {
    /* a step accumulated as a float leaves the last column short — this is that bug */
    const data = new Float32Array(10007)
    data[10006] = 1
    const p = peaks(data, 97)
    expect(p[96 * 2 + 1]).toBe(1)
  })

  it('gives a column per column even when there are more columns than samples', () => {
    const p = peaks(new Float32Array([1, -1, 1]), 50)
    expect(p.length).toBe(100)
    expect([...p].every(Number.isFinite)).toBe(true)
  })

  it('answers for an empty take instead of throwing', () => {
    expect([...peaks(new Float32Array(0), 8)].every((v) => v === 0)).toBe(true)
  })

  it('cannot be asked for a nonsensical number of columns', () => {
    for (const bad of [0, -5, NaN, Infinity])
      expect(peaks(sine(100), bad).length).toBeGreaterThan(0)
  })

  it('is not dragged to the edges by a corrupt sample', () => {
    const data = new Float32Array([0.2, NaN, -0.1])
    const p = peaks(data, 1)
    expect(Number.isFinite(p[0])).toBe(true)
    expect(Number.isFinite(p[1])).toBe(true)
    expect(p[1]).toBeCloseTo(0.2, 6)
  })
})

describe('a trim is two numbers and the audio is untouched', () => {
  it('starts as the whole take', () => {
    expect(wholeTake(12.5)).toEqual({ from: 0, to: 12.5 })
    expect(isWhole(null, 12.5)).toBe(true)
    expect(isWhole({ from: 0, to: 12.5 }, 12.5)).toBe(true)
    expect(isWhole({ from: 1, to: 12.5 }, 12.5)).toBe(false)
  })

  it('orders a pair that arrived backwards', () => {
    expect(clampTrim({ from: 9, to: 2 }, 12)).toEqual({ from: 2, to: 9 })
  })

  it('cannot select past either end of the take', () => {
    expect(clampTrim({ from: -5, to: 99 }, 12)).toEqual({ from: 0, to: 12 })
  })

  /**
   * ⚠️ A SPAN TOO SHORT TO HEAR IS A MIS-CLICK, and the alternative is worse than it looks.
   * Clamping it UP to the minimum keeps a span nobody chose and plays a click; handing back
   * the whole take is visible on screen and correctable.
   */
  it('treats a span shorter than one cycle of a voice as a mis-click', () => {
    expect(clampTrim({ from: 3, to: 3.001 }, 12)).toEqual({ from: 0, to: 12 })
    expect(clampTrim({ from: 3, to: 3 }, 12)).toEqual({ from: 0, to: 12 })
    expect(clampTrim({ from: 3, to: 3 + MIN_TRIM }, 12).from).toBe(3)
  })

  /**
   * ⚠️ IT IS PERSISTED, so it comes back out of a store that anything on this origin can
   * write — takes.ts validates its own rows on the way out for exactly this reason. None of
   * these is a reason to lose the recording.
   */
  it('survives anything a store could hand back', () => {
    for (const bad of [
      null,
      undefined,
      { from: NaN, to: 4 },
      { from: 1, to: NaN },
      { from: Infinity, to: -Infinity },
      {} as unknown as { from: number; to: number },
    ]) {
      const t = clampTrim(bad as never, 12)
      expect(Number.isFinite(t.from)).toBe(true)
      expect(Number.isFinite(t.to)).toBe(true)
      expect(t.to).toBeGreaterThanOrEqual(t.from)
      expect(t.to).toBeLessThanOrEqual(12)
    }
  })

  it('answers for a take with no length rather than producing a negative span', () => {
    expect(clampTrim({ from: 2, to: 5 }, 0)).toEqual({ from: 0, to: 0 })
    expect(trimLen({ from: 2, to: 5 }, 0)).toBe(0)
  })

  it('reports the length of what is kept', () => {
    expect(trimLen({ from: 2, to: 5 }, 12)).toBeCloseTo(3, 9)
    expect(trimLen(null, 12)).toBeCloseTo(12, 9)
  })
})

describe('the preview and the export agree', () => {
  /**
   * ⚠️ ONE ANSWER IN FRAMES, asked by both. The preview hands seconds to a buffer source and
   * the export copies samples out of an array; two separate conversions is how a saved file
   * ends up a frame different from what was auditioned, which nobody notices until the join
   * clicks.
   */
  it('turns a span into whole frames', () => {
    const f = trimFrames({ from: 1, to: 3 }, 10, 48000)
    expect(f.offset).toBe(48000)
    expect(f.frames).toBe(96000)
  })

  it('never runs past the end of the buffer', () => {
    const f = trimFrames({ from: 9.5, to: 10 }, 10, 48000)
    expect(f.offset + f.frames).toBeLessThanOrEqual(480000)
  })

  it('gives the whole take when nothing is trimmed', () => {
    expect(trimFrames(null, 2, 48000)).toEqual({ offset: 0, frames: 96000 })
  })

  it('asks for nothing when there is no sample rate to ask with', () => {
    for (const bad of [0, -1, NaN]) expect(trimFrames({ from: 0, to: 1 }, 2, bad).frames).toBe(0)
  })
})

describe('a drag across the picture', () => {
  it('maps the ends of the picture to the ends of the take', () => {
    expect(pickRange(0, 300, 300, 9)).toEqual({ from: 0, to: 9 })
  })

  it('works dragged backwards, which is how half of people do it', () => {
    expect(pickRange(240, 60, 300, 10)).toEqual(pickRange(60, 240, 300, 10))
    expect(pickRange(240, 60, 300, 10).from).toBeCloseTo(2, 9)
  })

  it('cannot select outside the picture, however far the pointer went', () => {
    const t = pickRange(-500, 9999, 300, 10)
    expect(t.from).toBe(0)
    expect(t.to).toBe(10)
  })

  it('answers rather than throwing for a box with no width', () => {
    /* ⚠️ reachable: the Browser pane collapses the viewport to 0x0 between calls, and a
       canvas measured then reports clientWidth 0 — CLAUDE.md records this */
    expect(pickRange(10, 20, 0, 10)).toEqual({ from: 0, to: 10 })
  })

  it('places a moment across the picture for the playhead', () => {
    expect(atFraction(0, 10)).toBe(0)
    expect(atFraction(5, 10)).toBeCloseTo(0.5, 9)
    expect(atFraction(50, 10)).toBe(1)
    expect(atFraction(-3, 10)).toBe(0)
    expect(atFraction(1, 0)).toBe(0)
  })
})
