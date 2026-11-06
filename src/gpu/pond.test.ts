import { describe, expect, it } from 'vitest'
import types from './pond-types.wgsl?raw'
import step from './pond-step.wgsl?raw'
import {
  DAMP,
  ETA,
  POND,
  PULL,
  dropShape,
  packDrops,
  packPond,
  refractDown,
  stepWaves,
} from './pond'
import { wgslLayout } from './wgslLayout'

describe('the shader and this file describe one pond', () => {
  const wgsl = wgslLayout(types, 'Pond')

  it('agrees about where every field of the uniform lives', () => {
    const { bytes, ...table } = POND
    expect(wgsl.offsets).toEqual(table)
    expect(wgsl.bytes).toBe(bytes)
  })

  it('writes every field where the shader will look for it', () => {
    const v = new DataView(
      packPond({ w: 100, h: 60, drops: 3, floor: 'sand', time: 2.5, depth: 14 }),
    )
    const u = (k: string, i = 0) => v.getUint32(wgsl.offsets[k] + 4 * i, true)
    const f = (k: string) => v.getFloat32(wgsl.offsets[k], true)
    expect([u('size'), u('size', 1), u('drops'), u('floor')]).toEqual([100, 60, 3, 2])
    expect([f('time'), f('depth'), f('pull'), f('damp')]).toEqual([
      2.5,
      14,
      Math.fround(PULL),
      Math.fround(DAMP),
    ])
    expect([...packDrops([{ x: 5, y: 6, r: 3, strength: 1.5 }]).subarray(0, 4)]).toEqual([
      5, 6, 3, 1.5,
    ])
  })

  it('bends light by the same ratio, and averages the same nine neighbours, as the shaders', () => {
    expect(types).toContain(`const ETA = ${ETA.toFixed(7)};`)
    expect(step).toContain('let avg = (edges * 4.0 + corners) / 20.0;')
  })
})

describe('the waves', () => {
  const w = 120
  const h = 120
  const dimple = () => {
    const hv = new Float32Array(w * h * 2)
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        hv[(y * w + x) * 2] = dropShape(Math.hypot(x + 0.5 - 60, y + 0.5 - 60), 5, 1)
    return hv
  }

  it('carries a drop away as a round ring: as far along a diagonal as along the grid', () => {
    // ⚠️ MEASURED ON THE RING'S SLOPE, from a SMALL drop, because that is what the eye sees and
    // where the grid shows: short ripples run faster along a 4-neighbour grid's diagonals. Measured
    // here: four neighbours put the leading ring 11.5% further out on the diagonal than on the
    // axis; nine put it within 1%. A large drop's height crest is round either way, and a test of
    // that passed with the bug in.
    let hv: Float32Array = new Float32Array(w * h * 2)
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        hv[(y * w + x) * 2] = dropShape(Math.hypot(x + 0.5 - 60, y + 0.5 - 60), 2.5, 1)
    for (let s = 0; s < 70; s++) hv = stepWaves(hv, w, h)
    const at = (x: number, y: number) => {
      const x0 = Math.floor(x)
      const y0 = Math.floor(y)
      const fx = x - x0
      const fy = y - y0
      const g = (a: number, b: number) => hv[(b * w + a) * 2]
      return (
        (g(x0, y0) * (1 - fx) + g(x0 + 1, y0) * fx) * (1 - fy) +
        (g(x0, y0 + 1) * (1 - fx) + g(x0 + 1, y0 + 1) * fx) * fy
      )
    }
    const slope = (x: number, y: number) =>
      Math.hypot(at(x + 1, y) - at(x - 1, y), at(x, y + 1) - at(x, y - 1))
    const ray = (a: number) =>
      Array.from({ length: 208 }, (_, k) => 3 + k * 0.25).map((r) => [
        r,
        slope(60 + r * Math.cos(a), 60 + r * Math.sin(a)),
      ])
    const angles = Array.from({ length: 16 }, (_, k) => (k / 16) * Math.PI * 2)
    const top = Math.max(...angles.flatMap((a) => ray(a).map(([, s]) => s)))
    const lead = (a: number) =>
      Math.max(
        ...ray(a)
          .filter(([, s]) => s > 0.3 * top)
          .map(([r]) => r),
      )
    const along = (lead(0) + lead(Math.PI / 2)) / 2
    const diagonal = (lead(Math.PI / 4) + lead((3 * Math.PI) / 4)) / 2
    expect(along).toBeGreaterThan(15)
    expect(Math.abs(diagonal / along - 1)).toBeLessThan(0.04)
  })

  it('fades away, and never grows', () => {
    let hv: Float32Array = dimple()
    const energy = (a: Float32Array) => a.reduce((s, v, i) => s + (i % 2 ? v * v : 0), 0)
    const e0 = energy(hv)
    let last = Infinity
    for (let s = 1; s <= 1200; s++) {
      hv = stepWaves(hv, w, h)
      if (s % 200 === 0) {
        const e = energy(hv)
        expect(e).toBeLessThan(last * 1.5) // speed energy sloshes; it does not run away
        last = e
      }
    }
    let peak = 0
    for (let i = 0; i < hv.length; i += 2) peak = Math.max(peak, Math.abs(hv[i]))
    expect(peak).toBeLessThan(0.02)
    expect(e0).toBe(0) // it starts still: all of a drop is in its shape, none in its speed
  })
})

describe('light at the surface', () => {
  it('goes straight down through flat water', () => {
    const r = refractDown([0, 0, 1])
    expect(r[0]).toBeCloseTo(0, 12)
    expect(r[1]).toBeCloseTo(0, 12)
    expect(r[2]).toBeCloseTo(-1, 12)
  })

  it('bends by Snell’s law, leaning away from the way the surface tips', () => {
    const tilt = 0.3
    const n: [number, number, number] = [Math.sin(tilt), 0, Math.cos(tilt)]
    const r = refractDown(n)
    // angle to the normal, in and out: sin(in) = 1.33 sin(out)
    const cosOut = -(r[0] * n[0] + r[2] * n[2])
    expect(Math.sin(tilt)).toBeCloseTo(1.33 * Math.sqrt(1 - cosOut * cosOut), 9)
    // a surface tipped towards +x sends the light under it off towards −x
    expect(r[0]).toBeLessThan(0)
  })
})

describe('a drop', () => {
  it('is deepest in the middle, smooth, and nothing at its edge', () => {
    expect(dropShape(0, 4, 1)).toBe(-1)
    expect(dropShape(4, 4, 1)).toBe(0)
    expect(dropShape(2, 4, 1)).toBeCloseTo(-0.5, 12)
  })
})
