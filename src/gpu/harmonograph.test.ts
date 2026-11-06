import { describe, expect, it } from 'vitest'
import code from './harmonograph.wgsl?raw'
import {
  DRAW,
  INK,
  MAX_STEPS,
  RATIOS,
  inkChannels,
  inkSegment,
  packDraw,
  pen,
  pendulumsFor,
  semitones,
  type Pendulums,
} from './harmonograph'
import { wgslLayout } from './wgslLayout'

describe('the shader and this file describe one machine', () => {
  const wgsl = wgslLayout(code, 'Draw')
  it('agrees about where every field of the uniform lives', () => {
    const { bytes, ...rest } = DRAW
    expect(wgsl.offsets).toEqual(rest)
    expect(wgsl.bytes).toBe(bytes)
  })
  it('writes every field where the shader will look for it', () => {
    const pendulums: Pendulums = {
      freq: [1, 2, 3, 4],
      phase: [5, 6, 7, 8],
      amp: [0.1, 0.2, 0.3, 0.4],
      decay: [0.5, 0.25, 0.125, 0.0625],
    }
    const v = new DataView(
      packDraw({
        w: 640,
        h: 480,
        paper: [600, 400],
        first: 12.5,
        dt: 0.01,
        segments: 9000,
        colour: 0x123456,
        pendulums,
      }),
    )
    const u = (k: string, i = 0) => v.getUint32(wgsl.offsets[k] + 4 * i, true)
    const f = (k: string, i = 0) => v.getFloat32(wgsl.offsets[k] + 4 * i, true)
    expect([
      u('size'),
      u('size', 1),
      u('paper'),
      u('paper', 1),
      u('segments'),
      u('colour'),
    ]).toEqual([640, 480, 600, 400, 9000, 0x123456])
    expect([f('first'), f('dt')]).toEqual([12.5, 0.01].map(Math.fround))
    for (const [k, vals] of [
      ['freq', pendulums.freq],
      ['phase', pendulums.phase],
      ['amp', pendulums.amp],
      ['decay', pendulums.decay],
    ] as const)
      expect([0, 1, 2, 3].map((i) => f(k, i))).toEqual(vals.map(Math.fround))
  })
  it('inks with the same amount a step, and steps no further', () => {
    const num = (name: string) => Number(new RegExp(`const ${name} = (\\d+)u?;`).exec(code)?.[1])
    expect([num('INK'), num('MAX_STEPS')]).toEqual([INK, MAX_STEPS])
  })
})

describe('the pen', () => {
  const still: Pendulums = {
    freq: [2, 3, 3, 2],
    phase: [0.3, 1, 0.5, 2],
    amp: [0.3, 0.2, 0.3, 0.2],
    decay: [0, 0, 0, 0],
  }

  it('closes its figure when the pendulums are in a whole ratio and do not slow', () => {
    // frequencies 2 and 3: everything repeats after 2π
    const a = pen(still, 1.234, 100)
    const b = pen(still, 1.234 + 2 * Math.PI, 100)
    expect(b[0]).toBeCloseTo(a[0], 9)
    expect(b[1]).toBeCloseTo(a[1], 9)
  })

  it('spirals inwards as the pendulums slow', () => {
    const slowing = { ...still, decay: [0.2, 0.2, 0.2, 0.2] as const }
    const reach = (t0: number) => {
      let m = 0
      for (let t = t0; t < t0 + 2 * Math.PI; t += 0.01)
        m = Math.max(m, Math.hypot(...pen(slowing, t, 100)))
      return m
    }
    expect(reach(10)).toBeLessThan(reach(0) * Math.exp(-0.2 * 10) * 1.05)
  })

  it('swings harder for a harder flick, and sounds each ratio as its interval', () => {
    expect(pendulumsFor('fifth', 0, 0.1, [1, 0]).amp[0]).toBeGreaterThan(
      pendulumsFor('fifth', 0, 0.1, [0.1, 0]).amp[0],
    )
    expect([
      semitones('unison'),
      semitones('octave'),
      semitones('fifth'),
      semitones('fourth'),
      semitones('sixth'),
    ]).toEqual([0, 12, 7, 5, 9])
    expect(Object.keys(RATIOS)).toHaveLength(5)
  })
})

describe('the ink', () => {
  it('splits into colour in whole units, the plain ink always the whole step', () => {
    expect(inkChannels(INK, 0xffffff)).toEqual([INK, INK, INK, INK])
    expect(inkChannels(INK, 0x000000)).toEqual([0, 0, 0, INK])
    const [r, g, b, k] = inkChannels(100, 0x80ff00)
    expect([r, g, b, k]).toEqual([Math.floor((100 * 128) / 255), 100, 0, 100])
  })

  it('lays exactly INK a step, never more or less, however the pen lands', () => {
    let total = 0
    let steps = 0
    for (const [a, b] of [
      [
        [10.3, 20.7],
        [30.1, 25.2],
      ],
      [
        [5.5, 5.5],
        [5.5, 5.5],
      ],
      [
        [0.01, 99.99],
        [3.33, 50.5],
      ],
    ] as const)
      steps += inkSegment(a, b, (_x, _y, ink) => {
        expect(ink).toBeGreaterThanOrEqual(0)
        total += ink
      })
    expect(total).toBe(steps * INK)
  })

  it('leaves no gap: every pixel the line passes through gets ink', () => {
    const inked = new Set<string>()
    inkSegment([2.5, 2.5], [40.5, 15.5], (x, y, ink) => ink > 0 && inked.add(`${x},${y}`))
    for (let x = 3; x <= 40; x++) {
      const y = Math.round(2.5 + ((x - 2.5) * 13) / 38 - 0.5)
      const near = [y - 1, y, y + 1].some((yy) => inked.has(`${x},${yy}`))
      expect(near, `x = ${x}`).toBe(true)
    }
  })

  it('does not ink a shared end twice: two halves of a line lay what the whole line lays', () => {
    const tally = (segs: [[number, number], [number, number]][]) => {
      const m = new Map<string, number>()
      for (const [a, b] of segs)
        inkSegment(a, b, (x, y, ink) => m.set(`${x},${y}`, (m.get(`${x},${y}`) ?? 0) + ink))
      return m
    }
    const whole = tally([
      [
        [0.5, 0.5],
        [20.5, 0.5],
      ],
    ])
    const halves = tally([
      [
        [0.5, 0.5],
        [10.5, 0.5],
      ],
      [
        [10.5, 0.5],
        [20.5, 0.5],
      ],
    ])
    expect([...halves.entries()].sort()).toEqual([...whole.entries()].sort())
  })
})
