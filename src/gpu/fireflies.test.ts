import { describe, expect, it } from 'vitest'
import types from './fireflies-types.wgsl?raw'
import step from './fireflies-step.wgsl?raw'
import draw from './fireflies-draw.wgsl?raw'
import {
  BEAT_RANGE,
  CELLS,
  COUNTS,
  FADE,
  FLIES,
  FOLLOW,
  KICK_PULL,
  MOODS,
  PACE_SPREAD,
  SCALE,
  beatFor,
  cellOf,
  glow,
  ordersOf,
  order,
  packFlies,
  seedFlies,
  stepKuramoto,
  tempoOf,
} from './fireflies'
import { wgslLayout } from './wgslLayout'

/** a small seeded generator, so a crowd is the same crowd every run */
function lcg(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

const TAU = Math.PI * 2

describe('the shaders and this file describe one meadow', () => {
  const wgsl = wgslLayout(types, 'Flies')

  it('agrees about where every field of the uniform lives', () => {
    const { bytes, ...rest } = FLIES
    expect(wgsl.offsets).toEqual(rest)
    expect(wgsl.bytes).toBe(bytes)
  })

  it('writes every field where the shader will look for it', () => {
    const v = new DataView(
      packFlies({
        w: 640,
        h: 400,
        count: 4096,
        dt: 0.016,
        time: 3.5,
        mood: 'crowd',
        kick: 0.75,
        tap: [0.25, 0.5, 0.125],
        beat: 5.5,
      }),
    )
    const u = (k: string, i = 0) => v.getUint32(wgsl.offsets[k] + 4 * i, true)
    const f = (k: string, i = 0) => v.getFloat32(wgsl.offsets[k] + 4 * i, true)
    expect([u('size'), u('size', 1), u('count'), u('cells')]).toEqual([
      640,
      400,
      4096,
      CELLS[0] * CELLS[1],
    ])
    expect([
      f('dt'),
      f('time'),
      f('pull'),
      f('kick'),
      f('tap'),
      f('tap', 1),
      f('tap', 2),
      f('beat'),
    ]).toEqual([0.016, 3.5, MOODS.crowd[1], 0.75, 0.25, 0.5, 0.125, 5.5].map(Math.fround))
  })

  it('cuts the meadow into the same patches, at the same fixed-point scale', () => {
    const num = (name: string) => Number(new RegExp(`const ${name} = ([\\d.]+)`).exec(types)?.[1])
    expect([num('CELLS_X'), num('CELLS_Y'), num('SCALE')]).toEqual([...CELLS, SCALE])
  })

  it('pulls on a beat as hard, as long and as far ahead as the tests below assume', () => {
    const num = (name: string) => Number(new RegExp(`const ${name} = ([\\d.]+)`).exec(step)?.[1])
    expect([num('KICK_PULL'), num('FADE'), num('FOLLOW')]).toEqual([KICK_PULL, FADE, FOLLOW])
    expect(step).toContain('sin(pace * FADE - f.z)')
  })

  it('flashes on the same curve the drawing does', () => {
    // the shader's own numbers, so neither side can retune the flash alone
    expect(draw).toContain('exp(-pow(t / 0.06, 2.0)) + 0.25 * exp(-pow((t - 0.06) / 0.08, 2.0))')
    expect(step).toContain('atomicAdd(&sums[i], i32(round(cos(t) * SCALE)))')
  })
})

describe('the sums are integers, so they are exact', () => {
  it('cannot overflow even with every firefly in one patch', () => {
    const most = Math.max(...COUNTS)
    expect(most * SCALE).toBeLessThan(2 ** 31)
  })

  it('reads the crowd as in step to within a step of the fixed point', () => {
    const rand = lcg(7)
    for (const spread of [0.3, 1.5, TAU]) {
      const phases = Array.from({ length: 2000 }, () => (rand() - 0.5) * spread)
      let c = 0
      let s = 0
      for (const p of phases) {
        c += Math.round(Math.cos(p) * SCALE)
        s += Math.round(Math.sin(p) * SCALE)
      }
      // each rounding is off by at most half a unit, so the average is off by at most that
      expect(Math.abs(Math.hypot(c, s) / (phases.length * SCALE) - order(phases))).toBeLessThan(
        0.5 / SCALE,
      )
    }
  })

  it('tells a wave from a scattered crowd: in step nearby, not across', () => {
    // two patches of ten, each perfectly in step, half a turn apart: a wave
    expect(ordersOf([SCALE * 10, 0, 10, -SCALE * 10, 0, 10])).toEqual({ near: 1, all: 0 })
    // an empty patch counts for nothing
    expect(ordersOf([SCALE * 5, 0, 5, 0, 0, 0]).near).toBe(1)
    expect(ordersOf([0, 0, 0])).toEqual({ near: 0, all: 0 })
  })

  it('reads a scattered meadow as scattered, even with only a few to a patch', () => {
    // patches of 25 and of 6 — 4096 and 1024 fireflies over 160 patches — at random phases
    const rand = lcg(19)
    for (const m of [25, 6]) {
      const sums: number[] = []
      for (let p = 0; p < 400; p++) {
        let c = 0
        let s = 0
        for (let k = 0; k < m; k++) {
          const t = rand() * TAU
          c += Math.round(Math.cos(t) * SCALE)
          s += Math.round(Math.sin(t) * SCALE)
        }
        sums.push(c, s, m)
      }
      expect(ordersOf(sums).near, `${m} to a patch`).toBeLessThan(0.12)
    }
  })

  it('adds up to the same total in any order, which floats do not', () => {
    const rand = lcg(11)
    const parts = Array.from({ length: 4096 }, () => Math.round(Math.cos(rand() * TAU) * SCALE))
    const shuffled = [...parts].sort(() => rand() - 0.5)
    const sum32 = (xs: number[]) => xs.reduce((a, b) => (a + b) | 0, 0)
    expect(sum32(shuffled)).toBe(sum32(parts))
  })
})

describe('the fireflies fall into step past the pull the theory predicts', () => {
  /** Kuramoto's threshold for paces spread evenly over ω₀ ± γ: K = 2 / (π·g(0)), g(0) = 1 / 2γ */
  const gamma = TAU * PACE_SPREAD
  const critical = (4 * gamma) / Math.PI

  const run = (k: number, seconds: number) => {
    const f = seedFlies(3000, lcg(3))
    const theta = new Float64Array(3000)
    const omega = new Float64Array(3000)
    for (let i = 0; i < 3000; i++) {
      theta[i] = f[i * 4 + 2]
      omega[i] = f[i * 4 + 3]
    }
    for (let t = 0; t < seconds; t += 1 / 60) stepKuramoto(theta, omega, k, 1 / 60)
    return order(theta)
  }

  it('starts them anyhow', () => {
    const f = seedFlies(3000, lcg(3))
    expect(order(Array.from({ length: 3000 }, (_, i) => f[i * 4 + 2]))).toBeLessThan(0.06)
  })

  it('gives them paces of about one flash a second, spread as the theory assumes', () => {
    const f = seedFlies(3000, lcg(5))
    const paces = Array.from({ length: 3000 }, (_, i) => f[i * 4 + 3] / TAU)
    expect(Math.min(...paces)).toBeGreaterThanOrEqual(1 - PACE_SPREAD)
    expect(Math.max(...paces)).toBeLessThanOrEqual(1 + PACE_SPREAD)
    expect(paces.reduce((a, b) => a + b, 0) / paces.length).toBeCloseTo(1, 2)
  })

  it('puts Shy below the threshold and Social and Crowd above it', () => {
    expect(critical).toBeCloseTo(0.8, 6)
    expect(MOODS.shy[1]).toBeLessThan(critical)
    expect(MOODS.social[1]).toBeGreaterThan(critical * 1.5)
  })

  it('leaves them a crowd with no pull, and a shy crowd nearly so', () => {
    expect(run(0, 20)).toBeLessThan(0.08)
    expect(run(MOODS.shy[1], 20)).toBeLessThan(0.15)
  })

  it('locks a Social meadow in step within half a minute, and a Crowd within ten seconds', () => {
    expect(run(MOODS.social[1], 30)).toBeGreaterThan(0.75)
    expect(run(MOODS.crowd[1], 10)).toBeGreaterThan(0.95)
  })
})

describe('a beat leads them, by setting their pace as well as pulling them', () => {
  /**
   * A Shy crowd (which would never find each other) driven by a beat at `bpm`: where the crowd's
   * clock stands each time a beat lands, over the last few seconds — R, and the mean phase as a
   * fraction of a turn from the top, which is where a flash is. `everyBeat` kicks on every beat
   * instead of only the ones the folding keeps, which is the version that cancelled itself.
   */
  const drive = (bpm: number, everyBeat = false) => {
    const n = 1500
    const f = seedFlies(n, lcg(3))
    const theta = new Float64Array(n)
    const omega = new Float64Array(n)
    for (let i = 0; i < n; i++) {
      theta[i] = f[i * 4 + 2]
      omega[i] = f[i * 4 + 3]
    }
    const { pace, every } = beatFor(bpm)
    const dt = 1 / 60
    let kick = 0
    let next = 0
    let count = 0
    const at: [number, number][] = []
    for (let t = 0; t < 14; t += dt) {
      if (t >= next) {
        if (everyBeat || count % every === 0) {
          kick = 1
          if (t > 10) {
            let c = 0
            let s = 0
            for (const x of theta) {
              c += Math.cos(x)
              s += Math.sin(x)
            }
            at.push([Math.hypot(c, s) / n, Math.atan2(s, c) / TAU])
          }
        }
        count++
        next += 60 / bpm
      }
      stepKuramoto(theta, omega, MOODS.shy[1], dt, { pace, kick })
      kick *= Math.exp(-dt / FADE)
    }
    return at
  }

  it('folds any tempo into a pace they can keep, flashing on whole beats', () => {
    for (const bpm of [40, 55, 70, 100, 120, 140, 175, 200]) {
      const { pace, every } = beatFor(bpm)
      const hz = pace / TAU
      expect(hz).toBeGreaterThanOrEqual(BEAT_RANGE[0])
      expect(hz).toBeLessThanOrEqual(BEAT_RANGE[1])
      // a flash every `every` beats, or a whole number of flashes to one slow beat
      const flashesPerBeat = (hz * 60) / bpm
      if (every > 1) expect(flashesPerBeat * every).toBeCloseTo(1, 9)
      else expect(Math.abs(flashesPerBeat - Math.round(flashesPerBeat))).toBeLessThan(1e-9)
    }
    expect(beatFor(120).every).toBe(2)
    expect(beatFor(70).every).toBe(1)
  })

  it('locks a shy crowd onto the beat, flashing within a twentieth of a turn of it', () => {
    for (const bpm of [55, 70, 100, 120, 140, 175]) {
      for (const [r, phase] of drive(bpm)) {
        expect(r, `${bpm}/min`).toBeGreaterThan(0.95)
        expect(Math.abs(phase), `${bpm}/min`).toBeLessThan(0.05)
      }
    }
  })

  it('needs the folding: kicked on every beat of 120/min, the off-beats undo the beats', () => {
    const at = drive(120, true)
    expect(at.filter(([r, phase]) => r > 0.5 && Math.abs(phase) < 0.05).length).toBeLessThan(
      at.length / 2,
    )
  })
})

describe('reading the meadow and the finger', () => {
  it('puts every point of the meadow in exactly one patch', () => {
    const seen = new Set<number>()
    for (let y = 0; y <= 1; y += 1 / 64) for (let x = 0; x <= 1; x += 1 / 64) seen.add(cellOf(x, y))
    expect(seen.size).toBe(CELLS[0] * CELLS[1])
    expect(Math.max(...seen)).toBe(CELLS[0] * CELLS[1] - 1)
    expect([cellOf(-1, -1), cellOf(2, 2)]).toEqual([0, CELLS[0] * CELLS[1] - 1])
  })

  it('flashes just past the top of the clock and stays dark through the rest', () => {
    expect(glow(0)).toBeGreaterThan(1)
    expect(glow(TAU)).toBeCloseTo(glow(0), 9)
    expect(glow(Math.PI)).toBeLessThan(1e-6)
    // dark for most of the cycle: under a tenth of full brightness from a quarter onwards
    for (let t = 0.25; t < 0.95; t += 0.05) expect(glow(t * TAU)).toBeLessThan(0.1)
  })

  it('hears a beat in three even taps, and not in two, or in uneven ones', () => {
    expect(tempoOf([0, 500])).toBeNull()
    expect(tempoOf([0, 500, 1000, 1500])).toBeCloseTo(120, 6)
    expect(tempoOf([0, 300, 1100])).toBeNull()
    expect(tempoOf([0, 1000, 2050])).toBeCloseTo(60000 / 1025, 6)
  })
})
