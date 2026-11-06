import { describe, expect, it } from 'vitest'
import types from './fractal-types.wgsl?raw'
import iterate from './fractal-iterate.wgsl?raw'
import {
  BAILOUT,
  DEEPEST,
  FRACTAL,
  HOME,
  MAX_ITER,
  at,
  depthLabel,
  diveTarget,
  escapeF64,
  itersFor,
  packFractal,
  pan,
  pinch,
  referenceOrbit,
  zoomAt,
  type View,
} from './fractal'
import { wgslLayout } from './wgslLayout'

describe('the shader and this file describe one fractal', () => {
  const wgsl = wgslLayout(types, 'Fractal')

  it('agrees about where every field of the uniform lives', () => {
    const { bytes, maxIter, refLen, ...rest } = FRACTAL
    expect(wgsl.offsets).toEqual({ ...rest, max_iter: maxIter, ref_len: refLen })
    expect(wgsl.bytes).toBe(bytes)
  })

  it('agrees about the bailout', () => {
    expect(iterate).toContain(`const BAILOUT = ${BAILOUT.toFixed(1)};`)
  })

  it('writes every field where the shader will look for it', () => {
    const b = packFractal({
      w: 640,
      h: 480,
      scale: 0.0625,
      maxIter: 1234,
      refLen: 777,
      julia: true,
      time: 2.5,
      palette: 'candy',
      cycle: 0.375,
      block: 2,
    })
    const v = new DataView(b)
    const u = (k: string, i = 0) => v.getUint32(wgsl.offsets[k] + 4 * i, true)
    const f = (k: string) => v.getFloat32(wgsl.offsets[k], true)
    expect([
      u('size'),
      u('size', 1),
      u('max_iter'),
      u('ref_len'),
      u('julia'),
      u('palette'),
    ]).toEqual([640, 480, 1234, 777, 1, 2])
    expect([f('scale'), f('time'), f('cycle')]).toEqual([0.0625, 2.5, 0.375])
    expect(u('block')).toBe(2)
  })
})

describe('moving round the plane', () => {
  const w = 800
  const h = 500
  const v: View = { cx: -0.75, cy: 0.1, scale: 0.002 }
  const near = (a: readonly number[], b: readonly number[]) => {
    expect(a[0]).toBeCloseTo(b[0], 12)
    expect(a[1]).toBeCloseTo(b[1], 12)
  }

  it('keeps the point under the pointer where it is, zooming in or out', () => {
    for (const factor of [2, 0.5, 1.37])
      near(at(zoomAt(v, 123, 456, factor, w, h), 123, 456, w, h), at(v, 123, 456, w, h))
  })

  it('keeps what was under a dragging finger under it', () => {
    near(at(pan(v, 40, -25), 140, 75, w, h), at(v, 100, 100, w, h))
  })

  it('keeps the point under each pinching finger under it', () => {
    // fingers spreading apart and drifting together: a stretch and a move, as a pinch is
    const a1 = [300, 200] as const
    const b1 = [400, 260] as const
    const a2 = [280, 190] as const
    const b2 = [460, 298] as const
    const after = pinch(v, a1, b1, a2, b2, w, h)
    near(at(after, ...a2, w, h), at(v, ...a1, w, h))
    near(at(after, ...b2, w, h), at(v, ...b1, w, h))
  })

  it('stops at the depth past which the centre itself cannot say where pixels are', () => {
    const deep = zoomAt({ ...v, scale: DEEPEST }, 400, 250, 100, w, h)
    expect(deep.scale).toBe(DEEPEST)
    // and an f64 still tells neighbouring pixels apart there
    const [x0] = at(deep, 400, 250, w, h)
    const [x1] = at(deep, 401, 250, w, h)
    expect(x1).not.toBe(x0)
  })
})

describe('the reference orbit', () => {
  it('is the orbit of the centre, and stops where it escapes', () => {
    const v: View = { cx: 0.5, cy: 0.5, scale: 0.001 }
    const ref = referenceOrbit(v, 1000, null)
    expect([ref[0], ref[1]]).toEqual([0, 0])
    expect(ref[2]).toBeCloseTo(0.5, 6)
    expect(ref[3]).toBeCloseTo(0.5, 6)
    const n = ref.length / 2
    expect(n).toBeLessThan(1000)
    expect(Math.hypot(ref[(n - 1) * 2], ref[(n - 1) * 2 + 1])).toBeGreaterThan(2)
    // a centre inside the set runs to the end
    expect(referenceOrbit({ cx: -0.1, cy: 0, scale: 0.001 }, 500, null).length / 2).toBe(501)
  })

  it('starts a Julia orbit at the centre, not at zero', () => {
    const ref = referenceOrbit({ cx: 0.25, cy: -0.5, scale: 0.01 }, 50, [-0.8, 0.156])
    expect([ref[0], ref[1]]).toEqual([0.25, -0.5])
  })
})

describe('diving', () => {
  it('finds detail all the way down from the whole set, and never lands somewhere flat', () => {
    const w = 160
    const h = 100
    let v = HOME(w, h)
    for (let step = 0; step < 30; step++) {
      const [x, y] = diveTarget(v, w, h, null, 9)
      v = { cx: x, cy: y, scale: v.scale / 2.2 }
    }
    expect(v.scale * w).toBeLessThan(1e-8)
    const iters = itersFor(v, w)
    const counts: number[] = []
    for (let j = 0; j < 8; j++)
      for (let i = 0; i < 8; i++)
        counts.push(escapeF64(v, (i + 0.5) * 20, (j + 0.5) * 12.5, w, h, iters, null))
    const out = counts.filter((c) => c >= 0)
    const mean = out.reduce((a, b) => a + b, 0) / out.length
    const spread = Math.sqrt(out.reduce((a, b) => a + (b - mean) ** 2, 0) / out.length)
    // not mostly inside (flat black) — a mini-brot's body may fill some of it — and the rest varies
    // (so not a flat colour either)
    expect(out.length).toBeGreaterThan(16)
    expect(spread).toBeGreaterThan(20)
  })

  it('asks for more iterations the deeper it goes, and never more than the buffer holds', () => {
    const w = 400
    const depths = [1, 1e-3, 1e-6, 1e-9, 1e-14].map((width) =>
      itersFor({ cx: 0, cy: 0, scale: width / w }, w),
    )
    for (let i = 1; i < depths.length; i++) expect(depths[i]).toBeGreaterThan(depths[i - 1])
    expect(Math.max(...depths)).toBeLessThanOrEqual(MAX_ITER)
  })
})

describe('the depth, in words', () => {
  it('reads as a number, then millions, then a power of ten', () => {
    expect(depthLabel(40)).toBe('×40')
    expect(depthLabel(3000)).toBe('×3,000')
    expect(depthLabel(2.4e6)).toBe('×2.4 million')
    expect(depthLabel(3e12)).toBe('×10¹²')
  })
})
