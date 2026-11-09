import { describe, expect, it } from 'vitest'
import {
  EMPTY,
  FULL,
  LMS_FROM_RGB,
  RGB_FROM_LMS,
  apartness,
  contrast,
  deltaE,
  det,
  hex,
  mmul,
  mul,
  parseHex,
  readSaved,
  seen,
  simulation,
  toLinear,
  toSrgb,
  type M3,
  type V3,
} from './vision'

const close = (a: readonly number[], b: readonly number[], eps = 1e-9) =>
  a.every((v, i) => Math.abs(v - b[i]) < eps)

describe('the simulation is what the method says it is (Viénot, Brettel & Mollon 1999)', () => {
  it('each full deficiency is a projection: seen twice is seen once, and one dimension is gone', () => {
    for (const m of Object.values(FULL)) {
      expect(close(mmul(m, m), m)).toBe(true)
      expect(Math.abs(det(m))).toBeLessThan(1e-9)
    }
  })
  it('a change only the missing cone could see is invisible: colours on a confusion line meet', () => {
    // the direction in linear RGB that moves ONE cone and leaves the other two alone
    const coneOnly = (i: number): V3 =>
      mul(RGB_FROM_LMS, [0, 1, 2].map((j) => (j === i ? 1 : 0)) as V3)
    const kinds: [keyof typeof FULL, number][] = [
      ['protan', 0],
      ['deutan', 1],
      ['tritan', 2],
    ]
    for (const [k, cone] of kinds) {
      expect(close(mul(FULL[k], coneOnly(cone)), [0, 0, 0]), k).toBe(true)
      // and the other two cones' directions are not lost
      for (const other of [0, 1, 2].filter((j) => j !== cone))
        expect(
          Math.hypot(...mul(FULL[k], coneOnly(other))),
          `${k} keeps cone ${other}`,
        ).toBeGreaterThan(0.1)
    }
  })
  it('the colours the two viewers agree on are left exactly alone', () => {
    const W: V3 = [1, 1, 1]
    for (const k of ['protan', 'deutan'] as const)
      for (const c of [W, [0, 0, 1], [1, 1, 0]] as V3[])
        expect(close(mul(FULL[k], c), c), `${k} ${c}`).toBe(true)
    for (const c of [W, [1, 0, 0], [0, 1, 1]] as V3[])
      expect(close(mul(FULL.tritan, c), c), `tritan ${c}`).toBe(true)
  })
  it('a cone matrix and its inverse agree, so the derivation starts from a consistent pair', () => {
    expect(close(mmul(LMS_FROM_RGB, RGB_FROM_LMS), [1, 0, 0, 0, 1, 0, 0, 0, 1])).toBe(true)
  })
})

describe('against an independent model — Machado, Oliveira & Fernandes (2009)', () => {
  // their published full-severity matrices, on linear RGB. Every row sums to 1 (white kept), which
  // is the check that these were copied right
  const MACHADO: Record<keyof typeof FULL, M3> = {
    protan: [
      0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882, -0.048116, 1.051998,
    ],
    deutan: [
      0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.01182, 0.04294, 0.968881,
    ],
    tritan: [
      1.255528, -0.076749, -0.178779, -0.078411, 0.930809, 0.147602, 0.004733, 0.691367, 0.3039,
    ],
  }
  it('was copied right: every row sums to one', () => {
    for (const m of Object.values(MACHADO))
      for (const r of [0, 3, 6]) expect(m[r] + m[r + 1] + m[r + 2]).toBeCloseTo(1, 5)
  })
  it('collapses the same pairs of colours: its ranking of differences matches ours', () => {
    // ⚠️ RANK, NOT SHADE. The two models are built differently and paint a given colour about 10
    // ΔE apart (median, measured), so a tolerance on the shade would be a number picked to pass.
    // What the tool claims is which colours become hard to tell apart — a ranking — and two
    // independent models agreeing on that ranking, far more than either agrees with typical
    // vision, is the test of it. Measured: 0.978, 0.995, 0.978 against 0.83, 0.72, 0.51.
    const grid: V3[] = []
    for (let r = 0; r < 5; r++)
      for (let g = 0; g < 5; g++) for (let b = 0; b < 5; b++) grid.push([r / 4, g / 4, b / 4])
    let s = 3
    const rand = () => ((s = (s * 1103515245 + 12345) >>> 0), s / 2 ** 32)
    const pairs = Array.from({ length: 2000 }, () => [
      grid[Math.floor(rand() * grid.length)],
      grid[Math.floor(rand() * grid.length)],
    ])
    const rank = (a: number[]) => {
      const r = new Array<number>(a.length)
      a.map((v, i) => [v, i])
        .sort((x, y) => x[0] - y[0])
        .forEach(([, i], j) => (r[i] = j))
      return r
    }
    const spearman = (a: number[], b: number[]) => {
      const [ra, rb] = [rank(a), rank(b)]
      const n = a.length
      return 1 - (6 * ra.reduce((t, v, i) => t + (v - rb[i]) ** 2, 0)) / (n * (n * n - 1))
    }
    const theirs = (c: V3, k: keyof typeof FULL) =>
      mul(MACHADO[k], c.map(toLinear) as V3).map(toSrgb) as V3
    for (const k of ['protan', 'deutan', 'tritan'] as const) {
      const ours = pairs.map(([x, y]) => deltaE(seen(x, k), seen(y, k)))
      const them = pairs.map(([x, y]) => deltaE(theirs(x, k), theirs(y, k)))
      const typical = pairs.map(([x, y]) => deltaE(x, y))
      const agree = spearman(ours, them)
      expect(agree, k).toBeGreaterThan(0.95)
      expect(agree - spearman(ours, typical), k).toBeGreaterThan(0.1)
    }
  })
})

describe('what people with each kind report', () => {
  const red: V3 = [1, 0, 0]
  const green: V3 = [0, 1, 0]
  const blue: V3 = [0, 0, 1]
  it('red and green move together for protan and deutan, while red and blue stay apart', () => {
    for (const k of ['protan', 'deutan'] as const) {
      expect(deltaE(seen(red, k), seen(green, k))).toBeLessThan(deltaE(red, green) / 2.5)
      expect(deltaE(seen(red, k), seen(blue, k))).toBeGreaterThan(100)
    }
  })
  it('red looks darker to a protan, and not to a deutan', () => {
    const Y = (c: V3) =>
      mul([0.2126729, 0.7151522, 0.072175, 0, 0, 0, 0, 0, 0], c.map(toLinear) as V3)[0]
    expect(Y(seen(red, 'protan'))).toBeLessThan(Y(red) * 0.85)
    expect(Y(seen(red, 'deutan'))).toBeGreaterThan(Y(red))
  })
  it('blue and green move together for a tritan, while red is untouched', () => {
    expect(deltaE(seen(blue, 'tritan'), seen(green, 'tritan'))).toBeLessThan(
      deltaE(blue, green) / 3,
    )
    expect(close(seen(red, 'tritan'), red, 1e-6)).toBe(true)
  })
  it('with no colour, only lightness is left', () => {
    for (const c of [red, green, blue, [0.3, 0.6, 0.2] as V3]) {
      const s = seen(c, 'achromat')
      expect(Math.max(...s) - Math.min(...s)).toBeLessThan(1e-9)
    }
  })
  it('severity runs from typical at 0 to the full deficiency at 1', () => {
    expect(close(simulation('deutan', 0), [1, 0, 0, 0, 1, 0, 0, 0, 1])).toBe(true)
    expect(close(simulation('deutan', 1), FULL.deutan)).toBe(true)
    const half = deltaE(seen(red, 'deutan', 0.5), seen(green, 'deutan', 0.5))
    expect(half).toBeLessThan(deltaE(red, green))
    expect(half).toBeGreaterThan(deltaE(seen(red, 'deutan'), seen(green, 'deutan')))
  })
})

describe('contrast and colour arithmetic', () => {
  it('gives the WCAG ratios everybody quotes', () => {
    const white: V3 = [1, 1, 1]
    expect(contrast([0, 0, 0], white)).toBeCloseTo(21, 6)
    expect(contrast(parseHex('#767676')!, white)).toBeCloseTo(4.54, 2) // the lightest grey passing AA
    expect(contrast(parseHex('#777777')!, white)).toBeCloseTo(4.48, 2) // one step lighter fails it
    expect(contrast(parseHex('#595959')!, white)).toBeCloseTo(7.0, 2) // AAA
  })
  it('reads and writes hex, and refuses what is not a colour', () => {
    expect(hex(parseHex('#1A2b3C')!)).toBe('#1a2b3c')
    expect(parseHex('red')).toBeNull()
    expect(parseHex('#12345')).toBeNull()
    for (let i = 0; i <= 255; i++) expect(Math.round(toSrgb(toLinear(i / 255)) * 255)).toBe(i)
  })
  it('names a difference by how far apart it is', () => {
    expect(apartness(1)).toBe('the same colour')
    expect(apartness(5)).toBe('hard to tell apart')
    expect(apartness(15)).toBe('apart, but close')
    expect(apartness(60)).toBe('clearly apart')
  })
})

describe('what is kept', () => {
  it('round-trips every field away from its default, and drops what makes no sense', () => {
    const s = { kind: 'tritan', severity: 0.4, a: '#123456', b: '#abcdef' }
    expect(readSaved(JSON.stringify(s))).toEqual(s)
    expect(readSaved(JSON.stringify({ kind: 'x', severity: 3, a: 'nope', b: 7 }))).toEqual(EMPTY)
    expect(readSaved('{')).toEqual(EMPTY)
  })
})
