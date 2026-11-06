import { describe, expect, it } from 'vitest'
import code from './blackhole.wgsl?raw'
import {
  FOCAL,
  HOLE,
  MASS,
  R_IN,
  R_OUT,
  SHADOW,
  STEPS,
  distFor,
  flingFrom,
  glide,
  heatAt,
  packHole,
  shiftAt,
  stepAt,
  trace,
} from './blackhole'
import { wgslLayout } from './wgslLayout'

/**
 * The exact bending of light passing a black hole at impact parameter b (rs = 1), from the orbit
 * equation's first integral rather than from any stepping:
 *   α = 2 ∫₀^u₀ du / √(1/b² − u² + u³) − π,   u₀ the turning point.
 * The square root vanishes at u₀, so the integral is taken in t with u = u₀(1 − t²), where it is
 * smooth. Midpoint rule, fine enough to be exact for these purposes.
 */
function deflection(b: number): number {
  const f = (u: number) => 1 / (b * b) - u * u + u * u * u
  // the turning point: the first root of f, below the photon sphere's u = 2/3
  let lo = 0
  let hi = 2 / 3
  for (let i = 0; i < 200; i++) {
    const m = (lo + hi) / 2
    if (f(m) > 0) lo = m
    else hi = m
  }
  const u0 = lo
  const n = 200000
  let sum = 0
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n
    sum += (2 * u0 * t) / Math.sqrt(f(u0 * (1 - t * t)))
  }
  return 2 * (sum / n) - Math.PI
}

/**
 * A ray from far away along +z, aimed to pass at height b, and the angle it turns through towards
 * the hole (0..2π: it leaves along (0, −sin α, cos α), and a ray turned past half a turn is still
 * told apart from one turned less).
 */
function bent(b: number) {
  const r = trace([0, b, -2000], [0, 0, 1], 2000, 20000)
  const turn = Math.atan2(-r.dir[1], r.dir[2])
  return { ...r, angle: turn < 0 ? turn + 2 * Math.PI : turn }
}

describe('the shader and this file describe one black hole', () => {
  const wgsl = wgslLayout(code, 'Hole')

  it('agrees about where every field of the uniform lives', () => {
    const { bytes, ...rest } = HOLE
    expect(wgsl.offsets).toEqual(rest)
    expect(wgsl.bytes).toBe(bytes)
  })

  it('writes every field where the shader will look for it', () => {
    const v = new DataView(
      packHole({
        w: 640,
        h: 360,
        time: 2.5,
        at: [0.25, -0.5],
        mass: 1.5,
        tilt: 0.3,
        roll: -0.2,
        sky: 'nebula',
        disk: true,
      }),
    )
    const u = (k: string, i = 0) => v.getUint32(wgsl.offsets[k] + 4 * i, true)
    const f = (k: string, i = 0) => v.getFloat32(wgsl.offsets[k] + 4 * i, true)
    expect([u('size'), u('size', 1), u('sky'), u('disk'), u('steps')]).toEqual([
      640,
      360,
      2,
      1,
      STEPS,
    ])
    expect([f('time'), f('focal'), f('at'), f('at', 1), f('dist'), f('tilt'), f('roll')]).toEqual(
      [2.5, FOCAL, 0.25, -0.5, distFor(1.5), 0.3, -0.2].map(Math.fround),
    )
  })

  it('bends light with the same pull and the same steps', () => {
    const num = (name: string) => Number(new RegExp(`const ${name} = ([\\d.]+)`).exec(code)?.[1])
    expect([num('R_IN'), num('R_OUT')]).toEqual([R_IN, R_OUT])
    expect(code).toContain('return -1.5 * h2 * p / (r2 * r2 * sqrt(r2));')
    expect(code).toContain('clamp(0.06 * r * min(1.0, r / 4.0), 0.01, 2.0)')
    expect([stepAt(0.01), stepAt(2), stepAt(10), stepAt(100)]).toEqual([0.01, 0.06, 0.6, 2])
  })
})

describe('light bends as general relativity says it does', () => {
  it('turns a distant ray through 2 rs / b, as Einstein predicted for the Sun', () => {
    for (const b of [50, 100]) {
      // weak field, to third order in M/b (M = rs/2): α ≈ 4M/b + (15π/4)(M/b)² + (128/3)(M/b)³
      const m = 0.5 / b
      const weak = 4 * m + ((15 * Math.PI) / 4) * m * m + (128 / 3) * m ** 3
      expect(deflection(b) / weak).toBeCloseTo(1, 3)
      expect(bent(b).angle / deflection(b)).toBeCloseTo(1, 2)
    }
  })

  it('turns a close ray through what the exact integral says, to a tenth of a percent', () => {
    for (const b of [2.65, 3, 3.5, 5, 10, 20]) {
      const exact = deflection(b)
      const got = bent(b)
      expect(got.fate, `b = ${b}`).toBe('sky')
      expect(
        Math.abs(got.angle - exact) / exact,
        `b = ${b}: ${got.angle} vs ${exact}`,
      ).toBeLessThan(0.001)
    }
    // b = 3 turns the ray through more than a right angle; nothing in flat space does
    expect(deflection(3)).toBeGreaterThan(Math.PI / 2)
  })

  it('swallows every ray aimed inside the shadow, 3√3/2 rs, and lets every one outside go', () => {
    expect(SHADOW).toBeCloseTo(2.598, 3)
    for (const k of [0.5, 0.9, 0.99])
      expect(bent(SHADOW * k).fate, `${k} of the shadow`).toBe('hole')
    for (const k of [1.01, 1.1, 1.5])
      expect(bent(SHADOW * k).fate, `${k} of the shadow`).toBe('sky')
  })

  it('sends a ray grazing the shadow right round the hole before it lets it go', () => {
    // just outside the edge, light circles the photon sphere: turned through more than a full turn,
    // so compare where it ends up pointing — a ray along +z at height b, turned by α towards the
    // hole, leaves along (0, −sin α, cos α)
    const b = SHADOW * 1.001
    const alpha = deflection(b)
    expect(alpha).toBeGreaterThan(2 * Math.PI)
    const got = bent(b)
    expect(got.fate).toBe('sky')
    expect(got.dir[1]).toBeCloseTo(-Math.sin(alpha), 1)
    expect(got.dir[2]).toBeCloseTo(Math.cos(alpha), 1)
  })
})

describe('the disk', () => {
  it('is hottest just outside its inner edge and cools outwards', () => {
    const rs = Array.from({ length: 200 }, (_, i) => R_IN + ((R_OUT - R_IN) * (i + 0.5)) / 200)
    const hottest = rs.reduce((a, r) => (heatAt(r) > heatAt(a) ? r : a))
    expect(hottest / R_IN).toBeCloseTo(49 / 36, 1)
    expect(Math.max(...rs.map(heatAt))).toBeCloseTo(1, 3)
    const past = rs.filter((r) => r > hottest)
    for (let i = 1; i < past.length; i++) expect(heatAt(past[i])).toBeLessThan(heatAt(past[i - 1]))
    // and far out it falls as r^−¾, the thin disk's law
    expect(heatAt(400) / heatAt(200)).toBeCloseTo(2 ** -0.75, 1)
  })

  it('is bluer on the side coming towards you and redder going away, and redder near the hole', () => {
    // this disk turns from +x towards +z, so seen edge on by an eye down −z looking along +z, the
    // gas at x < 0 is coming at it and the gas at x > 0 going away
    const toward = shiftAt([-6, 0, 0], [0, 0, 1])
    const away = shiftAt([6, 0, 0], [0, 0, 1])
    expect(toward).toBeGreaterThan(1)
    expect(away).toBeLessThan(1)
    // straight on to the orbit, only the slow clock and gravity: √(1 − 1.5/r), always a redshift
    expect(shiftAt([0, 0, 6], [0, 0, 1])).toBeCloseTo(Math.sqrt(1 - 1.5 / 6), 9)
    expect(shiftAt([0, 0, R_IN], [0, 0, 1])).toBeLessThan(shiftAt([0, 0, R_OUT], [0, 0, 1]))
  })

  it('is seen twice over the top: a ray past the hole crosses the disk behind it', () => {
    // edge on, a ray aimed just over the hole bends down onto the far side of the disk — the
    // image of the back of the disk lifted over the top, which is what makes a black hole look so
    const r = trace([0, 0.5, -distFor(1)], [0, 4 / distFor(1), 1], 60)
    expect(r.crossings.length).toBeGreaterThan(0)
    expect(r.crossings[0][2]).toBeGreaterThan(0)
  })
})

describe('moving it', () => {
  it('makes a heavier hole look bigger from the same place, within the masses offered', () => {
    expect(distFor(MASS[1])).toBeLessThan(distFor(MASS[0]))
    // its shadow spans about SHADOW / dist radians; at the heaviest still on screen, at the lightest a dot
    const half = (m: number) => (SHADOW / distFor(m)) * FOCAL
    expect(half(MASS[1])).toBeLessThan(0.9)
    expect(half(MASS[0])).toBeGreaterThan(0.05)
  })

  it('is thrown as fast as the finger was going, and not at all by a finger that had stopped', () => {
    const moving = [0, 20, 40, 60, 80, 100, 120].map((t) => ({ x: t / 100, y: 0, t }))
    // a unit every 100ms is 10 a second, measured over the last 100ms
    expect(flingFrom(moving, 125)[0]).toBeCloseTo(10, 9)
    expect(flingFrom(moving, 125)[1]).toBe(0)
    // the same finger, held still for a moment before letting go
    expect(flingFrom(moving, 300)).toEqual([0, 0])
    // a tap: one sample, nothing to throw with
    expect(flingFrom([{ x: 1, y: 1, t: 0 }], 10)).toEqual([0, 0])
    expect(flingFrom([], 0)).toEqual([0, 0])
  })

  it('glides where it was thrown, slows, and comes back off an edge', () => {
    let s = { at: [0, 0] as [number, number], vel: [1, 0] as [number, number] }
    s = glide(s.at, s.vel, 0.1, 1.5)
    expect(s.at[0]).toBeCloseTo(0.1, 9)
    expect(s.vel[0]).toBeLessThan(1)
    for (let i = 0; i < 100; i++) s = glide(s.at, [4, 0], 0.1, 1.5)
    expect(s.at[0]).toBeCloseTo(1.5 * 0.95, 9)
    expect(s.vel[0]).toBeLessThan(0)
  })
})
