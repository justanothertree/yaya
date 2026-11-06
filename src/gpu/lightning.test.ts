import { describe, expect, it } from 'vitest'
import code from './lightning.wgsl?raw'
import {
  BOLT,
  KIND,
  RELAX,
  freshField,
  gridFor,
  hash,
  isCandidate,
  packBolt,
  raceTime,
  relax,
  touchesGround,
  winner,
} from './lightning'
import { wgslLayout } from './wgslLayout'

describe('the shader and this file describe one storm', () => {
  const wgsl = wgslLayout(code, 'Bolt')

  it('agrees about where every field of the uniform lives', () => {
    const { bytes, ...rest } = BOLT
    expect(wgsl.offsets).toEqual(rest)
    expect(wgsl.bytes).toBe(bytes)
  })

  it('writes every field where the shader will look for it', () => {
    const v = new DataView(
      packBolt({
        w: 640,
        h: 480,
        grid: [192, 144],
        eta: 2,
        step: 99,
        flash: 0.5,
        fade: 0.25,
        rods: 3,
      }),
    )
    const u = (k: string, i = 0) => v.getUint32(wgsl.offsets[k] + 4 * i, true)
    const f = (k: string) => v.getFloat32(wgsl.offsets[k], true)
    expect([u('size'), u('size', 1), u('grid'), u('grid', 1), u('step'), u('rods')]).toEqual([
      640, 480, 192, 144, 99, 3,
    ])
    expect([f('eta'), f('flash'), f('fade')]).toEqual([2, 0.5, 0.25])
  })

  it('races with the same time and the same dice', () => {
    expect(code).toContain('-log(max(u, 1e-12)) / w')
    expect(code).toContain('x = ((x >> ((x >> 28u) + 4u)) ^ x) * 277803737u;')
  })
})

describe('the field', () => {
  it('relaxes to Laplace’s answer: with nothing in the air, φ rises evenly from cloud to ground', () => {
    const f = freshField(20, 30)
    // start it wrong, everywhere at a half
    for (let i = 0; i < f.phi.length; i++) if (f.kind[i] === KIND.air) f.phi[i] = 0.5
    for (let k = 0; k < 4000; k++) relax(f)
    for (let y = 0; y < 30; y++) expect(f.phi[y * 20 + 7]).toBeCloseTo(y / 29, 3)
  })

  it('is pulled towards 1 round a lightning rod, which is why a bolt goes to it', () => {
    const rodded = freshField(40, 40, [[30, 30]])
    const plain = freshField(40, 40)
    for (let k = 0; k < 2000; k++) {
      relax(rodded)
      relax(plain)
    }
    expect(rodded.phi[25 * 40 + 30]).toBeGreaterThan(plain.phi[25 * 40 + 30] + 0.05)
  })
})

describe('the race', () => {
  it('picks each candidate in proportion to its weight, as a race of −ln(u)/w does', () => {
    const w = [1, 2, 3, 4]
    const wins = [0, 0, 0, 0]
    const n = 40000
    for (let k = 0; k < n; k++) {
      let best = 0
      let bestT = Infinity
      w.forEach((wi, i) => {
        const t = raceTime(wi, 1, hash(i, k))
        if (t < bestT) {
          bestT = t
          best = i
        }
      })
      wins[best]++
    }
    const sum = w.reduce((a, b) => a + b, 0)
    w.forEach((wi, i) => expect(wins[i] / n).toBeCloseTo(wi / sum, 1))
    // and the shape of the field matters through η: squared, the strongest wins far more often
    expect(raceTime(0.5, 3, 0.3)).toBeGreaterThan(raceTime(0.5, 1, 0.3))
  })

  it('never picks a cell with no field, or one that is not next to the channel', () => {
    expect(raceTime(0, 2, 0.5)).toBe(Infinity)
    const f = freshField(10, 10)
    expect(isCandidate(f, 4, 1)).toBe(true)
    expect(isCandidate(f, 4, 3)).toBe(false)
    expect(isCandidate(f, 4, 0)).toBe(false)
  })
})

describe('a whole bolt, on the CPU', () => {
  const strike = (eta: number, rods: [number, number][] = []) => {
    const f = freshField(48, 48, rods)
    for (let k = 0; k < 400; k++) relax(f)
    for (let step = 0; step < 4000; step++) {
      const i = winner(f, eta, step)
      f.kind[i] = KIND.channel
      f.phi[i] = 0
      if (touchesGround(f, i)) return { f, step, at: i }
      for (let k = 0; k < RELAX; k++) relax(f)
    }
    throw new Error('never arrived')
  }

  it('reaches the ground', () => {
    const { at, f } = strike(2)
    expect(Math.floor(at / f.w)).toBeGreaterThan(f.h - 4)
  })

  it('branches more, the smaller η is', () => {
    const cells = (f: ReturnType<typeof freshField>) =>
      f.kind.filter((k, i) => k === KIND.channel && i >= f.w).length
    const wild = strike(1)
    const straight = strike(3.5)
    expect(cells(wild.f)).toBeGreaterThan(cells(straight.f) * 1.5)
  }, 30000)

  it('goes to a lightning rod', () => {
    const { at, f } = strike(2, [[38, 30]])
    const x = at % f.w
    const y = Math.floor(at / f.w)
    expect(Math.hypot(x - 38, y - 30)).toBeLessThan(2)
  }, 30000)
})

describe('the grid', () => {
  it('puts LONG cells along the longer side of the canvas, and keeps its shape', () => {
    expect(gridFor(1600, 900)).toEqual([192, 108])
    expect(gridFor(390, 700)).toEqual([107, 192])
  })
})
