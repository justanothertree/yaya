import { describe, expect, it } from 'vitest'
import code from './squish.wgsl?raw'
import {
  GRID,
  MAX_HANDLES,
  SPRING,
  SQUISH,
  FIT,
  boingNote,
  canvasToImage,
  deform,
  restUnder,
  packHandles,
  packSquish,
  springStep,
  type Handle,
  type Mode,
} from './squish'
import { wgslLayout } from './wgslLayout'

function lcg(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

const MODES_: Mode[] = ['rigid', 'stretchy']
const pts = (rand: () => number, n: number) =>
  Array.from({ length: n }, () => [rand() * 400, rand() * 300] as const)

describe('the shader and this file describe one jelly', () => {
  const wgsl = wgslLayout(code, 'Squish')

  it('agrees about where every field of the uniform lives', () => {
    const { bytes, ...rest } = SQUISH
    expect(wgsl.offsets).toEqual(rest)
    expect(wgsl.bytes).toBe(bytes)
  })

  it('writes every field where the shader will look for it', () => {
    const handles: Handle[] = [{ p: [1, 2], q: [3, 4] }]
    const v = new DataView(
      packSquish({ w: 640, h: 480, image: [800, 600], handles, pins: 3, mode: 'stretchy' }),
    )
    const u = (k: string, i = 0) => v.getUint32(wgsl.offsets[k] + 4 * i, true)
    expect([u('size'), u('size', 1), u('grid'), u('grid', 1), u('image'), u('image', 1)]).toEqual([
      640,
      480,
      GRID[0],
      GRID[1],
      800,
      600,
    ])
    expect([u('handles'), u('mode'), u('pins')]).toEqual([1, 1, 3])
    expect([...packHandles(handles).slice(0, 4)]).toEqual([1, 2, 3, 4])
    // never more handles than the buffer holds
    const many = Array.from({ length: 40 }, () => handles[0])
    expect(
      new DataView(
        packSquish({ w: 1, h: 1, image: [1, 1], handles: many, pins: 0, mode: 'rigid' }),
      ).getUint32(wgsl.offsets.handles, true),
    ).toBe(MAX_HANDLES)
  })
})

describe('moving least squares keeps its promises', () => {
  const rand = lcg(7)
  const ps = pts(rand, 5)
  const probes = pts(rand, 40)

  it('leaves the picture alone when nothing is moved', () => {
    const handles = ps.map((p) => ({ p, q: p }))
    for (const mode of MODES_)
      for (const v of probes) {
        const got = deform(v, handles, mode).at
        expect(got[0]).toBeCloseTo(v[0], 6)
        expect(got[1]).toBeCloseTo(v[1], 6)
      }
  })

  it('moves the whole picture rigidly when every handle is moved by one rigid motion', () => {
    const a = 0.7
    const t = [35, -20]
    const move = (p: readonly [number, number]) =>
      [
        Math.cos(a) * p[0] - Math.sin(a) * p[1] + t[0],
        Math.sin(a) * p[0] + Math.cos(a) * p[1] + t[1],
      ] as const
    const handles = ps.map((p) => ({ p, q: move(p) }))
    for (const mode of MODES_)
      for (const v of probes) {
        const got = deform(v, handles, mode).at
        const want = move(v)
        expect(got[0], mode).toBeCloseTo(want[0], 5)
        expect(got[1], mode).toBeCloseTo(want[1], 5)
      }
  })

  it('carries a point under a handle to exactly where it is held', () => {
    const handles = ps.map((p) => ({ p, q: [p[0] + rand() * 50, p[1] - rand() * 50] as const }))
    for (const mode of MODES_)
      for (const h of handles) expect(deform(h.p, handles, mode).at).toEqual([h.q[0], h.q[1]])
  })

  it('only ever turns the picture in Rigid, never shears or stretches it locally', () => {
    const handles = ps.map((p) => ({ p, q: [p[0] * 1.6 + p[1] * 0.4, p[1] * 0.7] as const }))
    for (const v of probes) {
      const [a, b, c, d] = deform(v, handles, 'rigid').m
      // a rotation: columns of unit length, at right angles, determinant 1
      expect(a * a + c * c).toBeCloseTo(1, 9)
      expect(a * b + c * d).toBeCloseTo(0, 9)
      expect(a * d - b * c).toBeCloseTo(1, 9)
    }
    // while Stretchy, given the same pull, does stretch
    const [a, b, c, d] = deform(probes[0], handles, 'stretchy').m
    expect(Math.abs(a * d - b * c - 1)).toBeGreaterThan(0.05)
  })

  it('follows one handle alone by sliding the whole picture with it', () => {
    const got = deform([10, 10], [{ p: [100, 100], q: [130, 80] }], 'rigid').at
    expect(got).toEqual([40, -10])
  })
})

describe('taking hold of bent jelly', () => {
  it('finds the point of the picture shown under a finger, however it is bent', () => {
    const rand = lcg(12)
    const handles: Handle[] = [
      { p: [100, 100], q: [100, 100] },
      { p: [300, 120], q: [360, 60] },
      { p: [200, 250], q: [170, 290] },
    ]
    for (const mode of MODES_)
      for (const s of pts(rand, 20)) {
        const back = deform(restUnder(s, handles, mode), handles, mode).at
        expect(Math.hypot(back[0] - s[0], back[1] - s[1]), mode).toBeLessThan(0.5)
      }
  })

  it('reads the canvas through the same fit the shader draws with', () => {
    expect(code).toContain(`* ${FIT};`)
    // the middle of the canvas is the middle of the picture, and the picture spans FIT of it
    expect(canvasToImage(400, 300, [800, 600], [400, 300])).toEqual([200, 150])
    const right = canvasToImage(400 + 800 * FIT * 0.5, 300, [800, 600], [400, 300])
    expect(right[0]).toBeCloseTo(400, 9)
  })
})

describe('letting go', () => {
  it('springs back, overshooting and wobbling, and settles', () => {
    let x = 1
    let v = 0
    let lowest = 1
    for (let k = 0; k < 600; k++) {
      ;[x, v] = springStep(x, v, 1 / 120)
      lowest = Math.min(lowest, x)
    }
    // a jelly overshoots (goes past its rest) and comes to rest
    expect(lowest).toBeLessThan(-0.3)
    expect(Math.abs(x)).toBeLessThan(0.01)
  })

  it('steps exactly, so a slow frame cannot pump energy into the wobble', () => {
    // one step of a tenth of a second is the same as twelve steps of a hundred-and-twentieth
    let a: [number, number] = [1, 0]
    for (let k = 0; k < 12; k++) a = springStep(a[0], a[1], 0.1 / 12)
    const b = springStep(1, 0, 0.1)
    expect(b[0]).toBeCloseTo(a[0], 9)
    expect(b[1]).toBeCloseTo(a[1], 9)
    // and its period is the damped one: back through rest about π/ω_d after release
    const wd = SPRING.omega * Math.sqrt(1 - SPRING.zeta ** 2)
    expect(springStep(1, 0, Math.PI / wd)[0]).toBeLessThan(0)
  })

  it('boings low for a big stretch and high for a little one', () => {
    expect(boingNote(0.5)).toBeLessThan(boingNote(0.05))
  })
})
