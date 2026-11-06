import { describe, expect, it } from 'vitest'
import types from './erosion-types.wgsl?raw'
import stepCode from './erosion-step.wgsl?raw'
import { wgslLayout } from './wgslLayout'
import {
  DEPTH_CAP,
  FRICTION,
  G,
  KC,
  KD,
  KE,
  KS,
  KT,
  LAND,
  MIN_TILT,
  N,
  RAIN,
  orbitCamera,
  packLand,
  project,
  rayAt,
  DT,
  TALUS,
  fieldsFor,
  landFor,
  step,
  stepErode,
  stepFlux,
  stepSettle,
  stepWater,
  type Fields,
} from './erosion'

const sum = (a: Float32Array) => a.reduce((s, x) => s + x, 0)

/** a small world: ground from `ground(x, y)`, water from `water(x, y)` */
function world(
  n: number,
  ground: (x: number, y: number) => number,
  water: (x: number, y: number) => number = () => 0,
) {
  const F = fieldsFor(n)
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      F.b[y * n + x] = ground(x, y)
      F.b0[y * n + x] = ground(x, y)
      F.d[y * n + x] = water(x, y)
    }
  return F
}

const flowOnly = (F: Fields, n: number, steps: number, open = false) => {
  for (let k = 0; k < steps; k++) {
    stepFlux(F, n, DT, open)
    stepWater(F, n, DT)
  }
}

describe('the shaders and this file describe one land', () => {
  const wgsl = wgslLayout(types, 'Land')

  it('agrees about where every field of the uniform lives', () => {
    const { bytes, rayO, rayD, ...rest } = LAND
    expect(wgsl.offsets).toEqual({ ...rest, ray_o: rayO, ray_d: rayD })
    expect(wgsl.bytes).toBe(bytes)
  })

  it('writes every field where the shader will look for it', () => {
    const cam = orbitCamera(0.3, 0.5, 300, 1.5)
    const v = new DataView(
      packLand({
        cam,
        ray: [0, -0.6, 0.8],
        tool: 'dig',
        rain: 0.5,
        step: 77,
        radius: 6,
        open: true,
      }),
    )
    const f = (k: string, i = 0) => v.getFloat32(wgsl.offsets[k] + 4 * i, true)
    const u = (k: string) => v.getUint32(wgsl.offsets[k], true)
    expect([0, 5, 15].map((i) => f('view', i))).toEqual([0, 5, 15].map((i) => cam.view[i]))
    expect([f('eye'), f('eye', 2), f('ray_o', 1), f('ray_d', 1), f('ray_d', 2)]).toEqual(
      [cam.eye[0], cam.eye[2], cam.eye[1], -0.6, 0.8].map(Math.fround),
    )
    expect([u('n'), u('tool'), u('step'), u('open')]).toEqual([N, 3, 77, 1])
    expect([f('dt'), f('rain'), f('radius')]).toEqual([DT, 0.5, 6].map(Math.fround))
    // no finger, no tool — whatever the tool buttons say
    const idle = new DataView(
      packLand({ cam, ray: null, tool: 'dig', rain: 0, step: 0, radius: 6, open: false }),
    )
    expect(idle.getUint32(wgsl.offsets.tool, true)).toBe(0)
  })

  it('erodes with the same constants', () => {
    const num = (name: string) =>
      Number(new RegExp(`const ${name} = ([\\d.e-]+)`).exec(stepCode)?.[1])
    const names = { G, KC, KS, KD, KE, MIN_TILT, DEPTH_CAP, TALUS, KT, FRICTION, RAIN }
    for (const [k, v] of Object.entries(names)) expect(num(k), k).toBe(v)
  })
})

describe('the camera', () => {
  it('puts a point on the ray through a screen position back at that position', () => {
    const cam = orbitCamera(0.8, 0.6, 320, 16 / 9)
    for (const [sx, sy] of [
      [0, 0],
      [0.5, -0.3],
      [-0.9, 0.8],
      [1, 1],
    ]) {
      const d = rayAt(cam, sx, sy)
      const p = project(cam, [
        cam.eye[0] + d[0] * 200,
        cam.eye[1] + d[1] * 200,
        cam.eye[2] + d[2] * 200,
      ])
      expect(p[0]).toBeCloseTo(sx, 4)
      expect(p[1]).toBeCloseTo(sy, 4)
      expect(p[2]).toBeGreaterThan(0)
      expect(p[2]).toBeLessThan(1)
    }
  })

  it('looks at the middle of the land from where it says, and keeps nearer things nearer', () => {
    const cam = orbitCamera(0, 0.5, 300, 1)
    expect(Math.hypot(cam.eye[0], cam.eye[1] - 12, cam.eye[2])).toBeCloseTo(300, 6)
    expect(
      project(cam, [0, 12, 0])
        .slice(0, 2)
        .map((x) => +x.toFixed(6)),
    ).toEqual([0, 0])
    const near = project(cam, [0, 12, 100])[2]
    const far = project(cam, [0, 12, -100])[2]
    expect(near).toBeLessThan(far)
  })
})

describe('water', () => {
  it('is conserved exactly in a closed basin: what one cell sends, its neighbour receives', () => {
    const n = 24
    const F = world(
      n,
      (x, y) => 3 * Math.sin(x / 4) + 2 * Math.cos(y / 3) + 8,
      (x, y) => (Math.hypot(x - 8, y - 12) < 4 ? 3 : 0.2),
    )
    const before = sum(F.d)
    flowOnly(F, n, 600)
    expect(Math.abs(sum(F.d) - before) / before).toBeLessThan(1e-5)
    // and none of it went below nothing
    expect(Math.min(...F.d)).toBeGreaterThanOrEqual(0)
  })

  it('spreads a heap of water flat on flat ground, and a still lake stays still', () => {
    const n = 20
    const F = world(
      n,
      () => 0,
      (x, y) => (Math.hypot(x - 10, y - 10) < 3 ? 5 : 0),
    )
    flowOnly(F, n, 1500)
    const mean = sum(F.d) / F.d.length
    expect(Math.max(...F.d) - Math.min(...F.d)).toBeLessThan(mean * 0.1)
    const still = world(
      n,
      () => 0,
      () => 1,
    )
    flowOnly(still, n, 200)
    expect(Math.max(...still.vx.map(Math.abs), ...still.vy.map(Math.abs))).toBe(0)
  })

  it('runs downhill, and off the low edge when the edges are open', () => {
    const n = 20
    // a slope falling towards x = 0
    const F = world(
      n,
      (x) => x * 0.5,
      (x) => (x > 14 ? 1 : 0),
    )
    const before = sum(F.d)
    flowOnly(F, n, 30, true)
    // while it runs, it runs downhill, towards −x
    let vx = 0
    for (let i = 0; i < F.vx.length; i++) vx += F.vx[i] * F.d[i]
    expect(vx).toBeLessThan(0)
    flowOnly(F, n, 200, true)
    // and then it leaves the map over the low edge
    expect(sum(F.d)).toBeLessThan(before * 0.5)
  })

  it('does not blow up in a long storm', () => {
    const n = 32
    const F = world(n, (x, y) => landFor('hills', n, 3)[y * n + x])
    for (let k = 0; k < 1500; k++) {
      for (let i = 0; i < n * n; i += 7) F.d[(i + k * 13) % (n * n)] += 0.05
      step(F, n)
    }
    for (const a of [F.b, F.d, F.s, F.vx, F.vy]) expect(a.every(Number.isFinite)).toBe(true)
    expect(Math.max(...F.d)).toBeLessThan(40)
  })
})

describe('the ground', () => {
  it('moves between the ground and the sediment, never out of the world, when it erodes', () => {
    const n = 24
    const F = world(
      n,
      (x) => x * 0.8,
      () => 0.8,
    )
    flowOnly(F, n, 20)
    const before = sum(F.b) + sum(F.s)
    for (let k = 0; k < 50; k++) stepErode(F, n, DT)
    expect(Math.abs(sum(F.b) + sum(F.s) - before) / before).toBeLessThan(1e-6)
    expect(sum(F.s)).toBeGreaterThan(0)
  })

  it('slumps a cliff steeper than TALUS without making or losing any ground', () => {
    const n = 16
    const F = world(n, (x) => (x < 8 ? 0 : 20))
    const before = sum(F.b)
    const steepest = () => {
      let m = 0
      for (let y = 0; y < n; y++)
        for (let x = 0; x < n - 1; x++)
          m = Math.max(m, Math.abs(F.b[y * n + x + 1] - F.b[y * n + x]))
      return m
    }
    expect(steepest()).toBe(20)
    for (let k = 0; k < 3000; k++) stepSettle(F, n, DT)
    expect(Math.abs(sum(F.b) - before) / before).toBeLessThan(1e-5)
    expect(steepest()).toBeLessThan(TALUS * 1.2)
  })

  it('carves a valley where rain runs off a slope, and leaves sediment where it slows', () => {
    // a ramp down to a flat floor, rain on the ramp's top half; the edges are walls
    const n = 32
    const F = world(n, (x, y) => (x > 12 ? (x - 12) * 0.9 : 0) + 0.3 * Math.sin(y * 0.9))
    for (let k = 0; k < 2500; k++) {
      for (let y = 0; y < n; y++) for (let x = 22; x < 30; x++) F.d[y * n + x] += 0.004
      step(F, n, DT, false)
    }
    let carved = 0
    let laid = 0
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const change = F.b[y * n + x] - F.b0[y * n + x]
        if (x > 14 && x < 30) carved = Math.min(carved, change)
        if (x < 12) laid = Math.max(laid, change)
      }
    expect(carved).toBeLessThan(-0.5)
    expect(laid).toBeGreaterThan(0.1)
  })
})

describe('the lands', () => {
  it('are the same land for the same seed, a different one for another, all above water', () => {
    for (const kind of ['hills', 'ridge', 'mesa'] as const) {
      const a = landFor(kind, 64, 1)
      expect(landFor(kind, 64, 1)).toEqual(a)
      expect(landFor(kind, 64, 2)).not.toEqual(a)
      expect(Math.min(...a)).toBeGreaterThanOrEqual(0)
      expect(Math.max(...a)).toBeGreaterThan(20)
      expect(Math.max(...a)).toBeLessThan(90)
    }
  })
})
