import { describe, expect, it } from 'vitest'
import types from './mirror-types.wgsl?raw'
import brushCode from './mirror-brush.wgsl?raw'
import {
  BRUSH_RATE,
  FRAMES,
  MIRROR,
  brush,
  delayMap,
  historyFor,
  layersFor,
  packDabs,
  packMirror,
} from './mirror'
import { wgslLayout } from './wgslLayout'

describe('the shader and this file describe one mirror', () => {
  const wgsl = wgslLayout(types, 'Mirror')

  it('agrees about where every field of the uniform lives', () => {
    const { bytes, ...table } = MIRROR
    expect(wgsl.offsets).toEqual(table)
    expect(wgsl.bytes).toBe(bytes)
  })

  it('writes every field where the shader will look for it, and brushes at the same rate', () => {
    const v = new DataView(packMirror({ w: 222, h: 221, head: 17, dabs: 2, tint: true }))
    const u = (k: string, i = 0) => v.getUint32(wgsl.offsets[k] + 4 * i, true)
    expect([u('size'), u('size', 1), u('head'), u('frames'), u('dabs'), u('tint')]).toEqual([
      222,
      221,
      17,
      FRAMES,
      2,
      1,
    ])
    expect([...packDabs([{ x: 5, y: 6, r: 7, brush: 'slow' }]).subarray(0, 4)]).toEqual([
      5, 6, 7, 1,
    ])
    expect(brushCode).toContain(`const BRUSH_RATE = ${BRUSH_RATE};`)
  })
})

describe('the ring of past frames', () => {
  it('shows the newest frame for no delay, and the oldest kept for all of it', () => {
    expect(layersFor(10, 0)).toEqual([10, 9, 0])
    expect(layersFor(10, 1)[0]).toBe((10 - (FRAMES - 1) + FRAMES) % FRAMES)
    expect(layersFor(10, 1)[2]).toBe(0)
  })

  it('blends between the two frames either side of a delay, going back round the ring', () => {
    const [a, b, t] = layersFor(3, 0.5)
    expect(t).toBeCloseTo(0.5, 12)
    expect(a).toBe((3 - 31 + FRAMES) % FRAMES)
    expect(b).toBe((a - 1 + FRAMES) % FRAMES)
  })

  it('keeps a picture the canvas’s shape, at about the same cost whatever the shape', () => {
    for (const aspect of [0.6, 1, 1.78, 2.4]) {
      const [w, h] = historyFor(aspect)
      expect(Math.abs(w * h - 49152) / 49152).toBeLessThan(0.01)
      expect(Math.abs(w / h / aspect - 1)).toBeLessThan(0.02)
    }
  })
})

describe('delay maps', () => {
  const w = 40
  const h = 30
  it('pours the past down the picture, rings it out from the middle, or splits it', () => {
    const fall = delayMap('falling', w, h)
    for (let y = 1; y < h; y++) expect(fall[y * w + 5]).toBeGreaterThan(fall[(y - 1) * w + 5])
    const ring = delayMap('ripple', w, h)
    expect(ring[15 * w + 20]).toBeLessThan(0.1)
    expect(ring[0]).toBeGreaterThan(0.9)
    const split = delayMap('split', w, h)
    expect(split[15 * w + 2]).toBeLessThan(0.01)
    expect(split[15 * w + 37]).toBeGreaterThan(0.99)
    expect(delayMap('now', w, h).every((v) => v === 0)).toBe(true)
  })
})

describe('the time brush', () => {
  const w = 40
  const h = 30
  it('drags what it touches towards the past, and leaves the rest alone', () => {
    const m = new Float32Array(w * h)
    for (let k = 0; k < 40; k++) brush(m, w, h, [{ x: 20, y: 15, r: 8, brush: 'slow' }])
    // each frame closes the same share of what is left: after n, (1 − k)ⁿ of the way remains
    const k = BRUSH_RATE * (1 - Math.hypot(0.5, 0.5) / 8)
    expect(m[15 * w + 20]).toBeCloseTo(1 - (1 - k) ** 40, 5)
    expect(m[15 * w + 20]).toBeLessThanOrEqual(1)
    expect(m[15 * w + 30]).toBe(0)
    // softest at its edge
    expect(m[15 * w + 26]).toBeLessThan(m[15 * w + 21])
  })

  it('brings it back to now', () => {
    const m = new Float32Array(w * h).fill(1)
    for (let k = 0; k < 40; k++) brush(m, w, h, [{ x: 20, y: 15, r: 8, brush: 'now' }])
    const k = BRUSH_RATE * (1 - Math.hypot(0.5, 0.5) / 8)
    expect(m[15 * w + 20]).toBeCloseTo((1 - k) ** 40, 5)
    expect(m[15 * w + 20]).toBeGreaterThanOrEqual(0)
  })
})
