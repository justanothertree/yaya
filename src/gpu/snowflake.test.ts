import { describe, expect, it } from 'vitest'
import code from './snowflake.wgsl?raw'
import {
  EDGE,
  FINGER_BREATH,
  FLAKE,
  NEIGHBOURS,
  SPEEDS,
  W,
  WEATHERS,
  breathFrom,
  cellToPlane,
  stepsFor,
  freshLattice,
  hexDistance,
  packFlake,
  planeToCell,
  rotate,
  stepFlake,
} from './snowflake'
import { wgslLayout } from './wgslLayout'

describe('the shader and this file describe one snowflake', () => {
  const wgsl = wgslLayout(code, 'Flake')

  it('agrees about where every field of the uniform lives', () => {
    const { bytes, ...rest } = FLAKE
    expect(wgsl.offsets).toEqual(rest)
    expect(wgsl.bytes).toBe(bytes)
  })

  it('writes every field where the shader will look for it', () => {
    const weather = WEATHERS.fern
    const v = new DataView(
      packFlake({ w: 640, h: 480, weather, breath: 0.25, finger: [12, -7], sym: true }),
    )
    const u = (k: string, i = 0) => v.getUint32(wgsl.offsets[k] + 4 * i, true)
    const f = (k: string, i = 0) => v.getFloat32(wgsl.offsets[k] + 4 * i, true)
    expect([u('size'), u('size', 1), u('w'), u('sym')]).toEqual([640, 480, W, 1])
    expect([
      f('radius'),
      f('alpha'),
      f('beta'),
      f('gamma'),
      f('breath'),
      f('finger'),
      f('finger', 1),
      f('reach'),
    ]).toEqual(
      [EDGE, weather.alpha, weather.beta, weather.gamma, 0.25, 12, -7, FINGER_BREATH].map(
        Math.fround,
      ),
    )
    // no finger, no breath from one
    const idle = new DataView(
      packFlake({ w: 1, h: 1, weather, breath: 0, finger: null, sym: false }),
    )
    expect(idle.getFloat32(wgsl.offsets.reach, true)).toBe(0)
  })

  it('steps to the same six neighbours', () => {
    const nb = /const NB = array<vec2i, 6>\((.*)\);/.exec(code)?.[1]
    const pairs = [...(nb ?? '').matchAll(/vec2i\((-?\d+), (-?\d+)\)/g)].map((m) => [
      Number(m[1]),
      Number(m[2]),
    ])
    expect(pairs).toEqual(NEIGHBOURS.map((p) => [...p]))
  })
})

describe('the hexagonal lattice', () => {
  it('has six neighbours each one step away, at the corners of a regular hexagon', () => {
    for (const [dq, dr] of NEIGHBOURS) {
      expect(hexDistance(dq, dr)).toBe(1)
      // on the plane, every neighbour is exactly one cell's width from the middle
      expect(Math.hypot(...cellToPlane(dq, dr))).toBeCloseTo(1, 12)
    }
    const angles = NEIGHBOURS.map(([dq, dr]) =>
      Math.atan2(cellToPlane(dq, dr)[1], cellToPlane(dq, dr)[0]),
    )
      .map((a) => Math.round(((a * 180) / Math.PI + 360) % 360))
      .sort((a, b) => a - b)
    expect(angles).toEqual([0, 60, 120, 180, 240, 300])
  })

  it('turns a sixth of a turn, and back to the start after six', () => {
    for (const [q, r] of [
      [3, 1],
      [-4, 7],
      [0, 5],
    ]) {
      let p: [number, number] = [q, r]
      const [x0, y0] = cellToPlane(q, r)
      p = rotate(...p)
      const [x1, y1] = cellToPlane(...p)
      // 60° on the plane, distance kept
      expect(Math.atan2(x0 * y1 - y0 * x1, x0 * x1 + y0 * y1)).toBeCloseTo(Math.PI / 3, 12)
      expect(hexDistance(...p)).toBe(hexDistance(q, r))
      for (let k = 0; k < 5; k++) p = rotate(...p)
      expect(p).toEqual([q, r])
    }
  })

  it('goes from cells to the plane and back', () => {
    for (const [q, r] of [
      [0, 0],
      [5, -3],
      [-12, 40],
    ]) {
      const back = planeToCell(...cellToPlane(q, r))
      expect(back[0]).toBeCloseTo(q, 12)
      expect(back[1]).toBeCloseTo(r, 12)
    }
  })
})

describe('the crystal grows as Reiter says, and as ice does', () => {
  const w = 61
  const edge = 28
  const c = (w - 1) / 2
  const grow = (beta: number, gamma: number, steps: number, alpha = 1) => {
    let s = freshLattice(w, beta)
    for (let k = 0; k < steps; k++) s = stepFlake(s, w, edge, alpha, beta, gamma)
    return s
  }

  it('leaves still air still', () => {
    const s = new Float32Array(w * w).fill(0.4)
    expect(stepFlake(s, w, edge, 1, 0.4, 0.001)).toEqual(s)
  })

  it('moves vapour about without making or losing any, away from the ice and the edge', () => {
    const s = new Float32Array(w * w).fill(0.4)
    s[c * w + c] = 0.9
    let t = s
    for (let k = 0; k < 20; k++) t = stepFlake(t, w, edge, 1, 0.4, 0)
    const extra = (a: Float32Array) => a.reduce((sum, x) => sum + x - 0.4, 0)
    expect(extra(t)).toBeCloseTo(extra(s), 5)
    expect(Math.max(...t)).toBeLessThan(0.9)
  })

  it('never melts: ice stays ice, and grows', () => {
    let s = freshLattice(w, 0.6)
    let ice = 1
    for (let k = 0; k < 40; k++) {
      const next = stepFlake(s, w, edge, 1, 0.6, 0.01)
      for (let i = 0; i < s.length; i++) if (s[i] >= 1) expect(next[i]).toBeGreaterThanOrEqual(s[i])
      s = next
      const now = s.filter((x) => x >= 1).length
      expect(now).toBeGreaterThanOrEqual(ice)
      ice = now
    }
    expect(ice).toBeGreaterThan(7)
  })

  it('grows the same on all six sides, nobody having told it to', () => {
    const s = grow(0.6, 0.01, 300)
    let worst = 0
    for (let r = 0; r < w; r++)
      for (let q = 0; q < w; q++) {
        const [rq, rr] = rotate(q - c, r - c)
        if (Math.abs(rq) > c || Math.abs(rr) > c) continue
        worst = Math.max(worst, Math.abs(s[r * w + q] - s[(rr + c) * w + rq + c]))
      }
    expect(worst).toBeLessThan(1e-5)
    expect(s.filter((x) => x >= 1).length).toBeGreaterThan(30)
  })

  it('grows faster in damper air', () => {
    const iceIn = (beta: number) => grow(beta, 0.002, 400).filter((x) => x >= 1).length
    expect(iceIn(0.7)).toBeGreaterThan(iceIn(0.45))
  })

  it('takes a finger’s breath six ways round when asked, at the six turned places', () => {
    const s = new Float32Array(w * w).fill(0.4)
    const at: [number, number] = [6, -2]
    const breath = (q: number, r: number) => {
      // what the shader's `breathed` does: a little vapour round the finger and its five turns
      let sum = 0
      let p = at
      for (let k = 0; k < 6; k++) {
        const [x, y] = cellToPlane(q - p[0], r - p[1])
        sum += Math.exp(-(x * x + y * y) / 81)
        p = rotate(...p)
      }
      return FINGER_BREATH * sum
    }
    const t = stepFlake(s, w, edge, 0, 0.4, 0, breath)
    let p = at
    for (let k = 0; k < 6; k++) {
      expect(t[(p[1] + c) * w + p[0] + c]).toBeCloseTo(t[(at[1] + c) * w + at[0] + c], 9)
      p = rotate(...p)
    }
    expect(t[(at[1] + c) * w + at[0] + c]).toBeGreaterThan(0.4)
  })
})

describe('the shapes it grows', () => {
  const w = 81
  const edge = 38
  const c = 40
  /** grown until its furthest ice is `reach` steps out: the ice, and how many steps it took */
  const growTo = (beta: number, gamma: number, reach: number) => {
    let s = freshLattice(w, beta)
    let steps = 0
    const furthest = () => {
      let m = 0
      for (let r = 0; r < w; r++)
        for (let q = 0; q < w; q++)
          if (s[r * w + q] >= 1) m = Math.max(m, hexDistance(q - c, r - c))
      return m
    }
    while (furthest() < reach && steps < 20000) {
      for (let k = 0; k < 20; k++) s = stepFlake(s, w, edge, 1, beta, gamma)
      steps += 20
    }
    return { s, steps }
  }
  /** how much of the hexagon its tips span is ice: 1 for a plate, less the more it branches */
  const fill = (s: Float32Array, reach: number) =>
    s.filter((x) => x >= 1).length / (3 * reach * (reach + 1) + 1)
  /** how far out the ice goes along a corner (towards a neighbour) and across a face (between two) */
  const along = (s: Float32Array, dq: number, dr: number) => {
    let k = 0
    while (s[(c + (k + 1) * dr) * w + c + (k + 1) * dq] >= 1) k++
    return Math.hypot(...cellToPlane(k * dq, k * dr))
  }

  it('then grows arms: its tips reach further into the damp air than its faces do', () => {
    for (const id of ['fern', 'star', 'sector'] as const) {
      const { s } = growTo(WEATHERS[id].beta, WEATHERS[id].gamma, 30)
      expect(fill(s, 30), id).toBeLessThan(0.6)
      // corners point at a neighbour (1, 0); faces sit halfway between two, along (1, 1) on the
      // plane — cells (1, 1) apart are √3 away, so compare distances, not steps
      expect(along(s, 1, 0), id).toBeGreaterThan(along(s, 1, 1) * 1.5)
    }
  }, 60000)
})

describe('breathing on the microphone', () => {
  it('rises quickly with a breath and falls away slowly after it, and ignores the room', () => {
    let b = 0
    for (let k = 0; k < 6; k++) b = breathFrom(b, 0.5, 1 / 60)
    expect(b).toBeGreaterThan(0.5)
    const peak = b
    for (let k = 0; k < 6; k++) b = breathFrom(b, 0, 1 / 60)
    // slower down than up: after the same tenth of a second, still most of the way up
    expect(b).toBeGreaterThan(peak * 0.75)
    let quiet = 0
    for (let k = 0; k < 120; k++) quiet = breathFrom(quiet, 0.04, 1 / 60)
    expect(quiet).toBe(0)
  })
})

describe('the weathers', () => {
  it('are each a weather the model is stable in, with somewhere to grow', () => {
    for (const w of Object.values(WEATHERS)) {
      expect(w.alpha).toBeGreaterThan(0)
      expect(w.alpha).toBeLessThanOrEqual(1)
      expect(w.beta).toBeGreaterThan(0)
      expect(w.beta).toBeLessThan(1)
    }
    expect(Object.values(SPEEDS).every(([, n]) => n > 0)).toBe(true)
  })

  it('runs the steps a pace asks for, carrying the fraction from frame to frame', () => {
    // 25 steps a second at 60 frames a second is 0.416… a frame: 25 in 60 frames, none lost
    let carry = 0
    let total = 0
    for (let k = 0; k < 60; k++) {
      const [n, left] = stepsFor(25, 1, 1 / 60, carry)
      total += n
      carry = left
    }
    expect(total).toBe(25)
    expect(stepsFor(100, 3, 0.1, 0)).toEqual([30, 0])
    expect(stepsFor(100, 1, 0, 0.5)).toEqual([0, 0.5])
  })
})
