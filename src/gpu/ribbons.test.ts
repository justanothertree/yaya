import { describe, expect, it } from 'vitest'
import types from './ribbons-types.wgsl?raw'
import move from './ribbons-move.wgsl?raw'
import {
  DANCE_IDS,
  GOLDEN,
  LENGTH,
  RIBBONS,
  danceAt,
  headAt,
  leadAt,
  leadOffset,
  orbit,
  packRibbons,
  project,
  slotOf,
} from './ribbons'
import { wgslLayout } from './wgslLayout'

const constant = (name: string) => {
  const m = move.match(new RegExp(`const ${name} = ([0-9.]+);`))
  if (!m) throw new Error(`no ${name} in ribbons-move.wgsl`)
  return Number(m[1])
}

describe('the shader and this file describe the same ribbons', () => {
  const wgsl = wgslLayout(types, 'Ribbons')

  it('agrees about where every field of the uniform lives', () => {
    const { bytes, ...table } = RIBBONS
    expect(wgsl.offsets).toEqual(table)
    expect(wgsl.bytes).toBe(bytes)
  })

  it('agrees about the golden angle that spaces the ribbons', () => {
    expect(GOLDEN).toBe(constant('GOLDEN'))
  })

  it('writes every field where the shader will look for it', () => {
    const cam = {
      eye: [1, 2, 3],
      right: [1, 0, 0],
      up: [0, 1, 0],
      fwd: [0, 0, -1],
      focal: 1.5,
    } as const
    const b = packRibbons({
      cam,
      aspect: 0.75,
      time: 9.5,
      lead: [0.5, -0.25, 0.125, 0.5],
      count: 24,
      head: 77,
      dance: 'wander',
      pulse: 0.25,
      kick: 0.75,
      dt: 0.0625,
      width: 0.0625,
    })
    const v = new DataView(b)
    const f = (k: string, i = 0) => v.getFloat32(wgsl.offsets[k] + 4 * i, true)
    const u = (k: string) => v.getUint32(wgsl.offsets[k], true)
    expect([f('right', 3), f('up', 3), f('fwd', 3), f('fwd', 2)]).toEqual([0.75, 9.5, 1.5, -1])
    expect([0, 1, 2].map((i) => f('eye', i))).toEqual([1, 2, 3])
    expect([0, 1, 2, 3].map((i) => f('lead', i))).toEqual([0.5, -0.25, 0.125, 0.5])
    expect([u('count'), u('length'), u('head'), u('dance')]).toEqual([24, LENGTH, 77, 2])
    expect([f('pulse'), f('kick'), f('dt'), f('width')]).toEqual([0.25, 0.75, 0.0625, 0.0625])
  })
})

describe('the dances', () => {
  it('stay inside what the camera frames, every ribbon, for a long time', () => {
    for (const d of DANCE_IDS)
      for (let r = 0; r < 24; r++)
        for (let t = 0; t < 600; t += 0.37) expect(Math.hypot(...danceAt(r, t, d))).toBeLessThan(2)
  })

  it('never start two ribbons in the same place', () => {
    for (const d of DANCE_IDS) {
      const starts = Array.from({ length: 24 }, (_, r) => danceAt(r, 0, d))
      for (let a = 0; a < 24; a++)
        for (let b = a + 1; b < 24; b++)
          expect(Math.hypot(...starts[a].map((v, i) => v - starts[b][i]))).toBeGreaterThan(0.01)
    }
  })

  const place = (r: number, t: number, f: readonly number[]) => {
    const o = leadOffset(r, t)
    return [f[0] + o[0], f[1] + o[1], f[2] + o[2]]
  }
  const gap = (a: readonly number[], b: readonly number[]) =>
    Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])

  it('draws its own figure exactly when nobody leads, and circles the finger exactly when one does', () => {
    const finger = [1.2, -0.8, 0.3] as const
    for (const d of DANCE_IDS)
      for (let r = 0; r < 24; r += 5)
        for (let t = 0; t < 60; t += 0.7) {
          expect(gap(headAt(r, t, d, [...finger, 0]), danceAt(r, t, d))).toBeLessThan(1e-12)
          expect(gap(headAt(r, t, d, [...finger, 1]), place(r, t, finger))).toBeLessThan(1e-12)
        }
  })

  it('swoops between the two without a jump, as the lead eases in', () => {
    const finger = [1.2, -0.8, 0.3] as const
    let was = headAt(3, 0, 'rose', [...finger, 0])
    for (let i = 1; i <= 60; i++) {
      const now = headAt(3, i / 60, 'rose', [...finger, i / 60])
      expect(gap(now, was)).toBeLessThan(0.1)
      was = now
    }
  })
})

describe('the trail', () => {
  it('finds the newest point at the head and every older one once, going back round the ring', () => {
    for (const head of [0, 1, 79, LENGTH - 1]) {
      const slots = Array.from({ length: LENGTH }, (_, age) => slotOf(head, age))
      expect(slots[0]).toBe(head)
      expect(new Set(slots).size).toBe(LENGTH)
      // one frame older is one slot back
      expect(slots[1]).toBe((head + LENGTH - 1) % LENGTH)
    }
  })
})

describe('the camera', () => {
  it('puts a point under the finger exactly where the finger is', () => {
    for (const [t, w, h] of [
      [0, 800, 500],
      [37, 390, 470],
    ] as const) {
      const c = orbit(t, w / h)
      for (const [px, py] of [
        [10, 20],
        [w / 2, h / 2],
        [w - 5, h - 40],
      ]) {
        const back = project(c, leadAt(c, px, py, w, h), w, h)!
        expect(back[0]).toBeCloseTo(px, 6)
        expect(back[1]).toBeCloseTo(py, 6)
      }
    }
  })

  it('frames the dance across the shorter side, upright or wide — only a rare swoop past the edge', () => {
    for (const [w, h] of [
      [390, 600],
      [1200, 500],
    ]) {
      let inside = 0
      let all = 0
      for (let t = 0; t < 200; t += 0.5) {
        const c = orbit(t, w / h)
        for (const d of DANCE_IDS)
          for (let r = 0; r < 24; r++) {
            const at = project(c, danceAt(r, t, d), w, h)
            all++
            if (at && at[0] > 0 && at[0] < w && at[1] > 0 && at[1] < h) inside++
          }
      }
      expect(inside / all).toBeGreaterThan(0.99)
    }
  })
})
