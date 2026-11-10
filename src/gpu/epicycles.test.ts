import { describe, expect, it } from 'vitest'
import {
  MAX_KEPT,
  PRESETS,
  SAMPLES,
  chain,
  error,
  fewest,
  packArms,
  pen,
  readKept,
  resample,
  series,
  toKept,
  type V2,
} from './epicycles'

const circle = (n: number, r = 0.5, c: V2 = [0.1, -0.2], turns = 1): V2[] =>
  Array.from({ length: n }, (_, i) => {
    const a = (2 * Math.PI * turns * i) / n
    return [c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]
  })

describe('resampling', () => {
  it('spaces points evenly along the loop, the closing edge included', () => {
    const sq: V2[] = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ]
    const r = resample(sq, 8) // perimeter 4: a point every half unit
    for (let i = 0; i < 8; i++) {
      const a = r[i]
      const b = r[(i + 1) % 8]
      expect(Math.hypot(b[0] - a[0], b[1] - a[1])).toBeCloseTo(0.5, 9)
    }
    expect(r[7]).toEqual([0, 0.5]) // on the closing edge, back towards the start
    expect(resample([[0.3, 0.3]], 4)).toEqual(Array(4).fill([0.3, 0.3]))
    expect(resample([], 4)).toEqual([])
  })
})

describe('the series', () => {
  it('a circle traced once anticlockwise is its centre and exactly one arm, turning once', () => {
    const t = series(circle(64))
    expect(t[0].freq).toBe(0)
    expect(t[0].re).toBeCloseTo(0.1, 12)
    expect(t[0].im).toBeCloseTo(-0.2, 12)
    expect(t[1].freq).toBe(1)
    expect(t[1].amp).toBeCloseTo(0.5, 12)
    for (const other of t.slice(2)) expect(other.amp).toBeLessThan(1e-12)
    // clockwise is the same arm turning the other way
    const cw = series(circle(64).reverse())
    expect(Math.abs(cw[1].freq)).toBe(1)
    expect(cw[1].freq).toBe(-1)
  })

  it('with every arm, redraws the drawing exactly', () => {
    const pts = resample(PRESETS[0].points, 64)
    const t = series(pts)
    expect(t.length).toBe(64)
    expect(error(pts, t, t.length - 1)).toBeLessThan(1e-12)
  })

  it('the more arms, the closer — never further', () => {
    for (const p of PRESETS) {
      const pts = resample(p.points, SAMPLES)
      const t = series(pts)
      let last = Infinity
      for (const k of [1, 2, 4, 8, 16, 32, 64, 128]) {
        const e = error(pts, t, k)
        expect(e, `${p.name} with ${k}`).toBeLessThanOrEqual(last + 1e-12)
        last = e
      }
      expect(error(pts, t, 128), p.name).toBeLessThan(0.02)
    }
  })

  it('a chain is pinned at the centre, has a joint per arm, and ends at the pen', () => {
    const t = series(circle(32))
    const c = chain(t, 3, 0.25)
    expect(c.length).toBe(4)
    expect(c[0][0]).toBeCloseTo(0.1, 12)
    expect(c[0][1]).toBeCloseTo(-0.2, 12)
    // a quarter of the way round the circle: straight up from the centre
    expect(pen(t, 3, 0.25)[0]).toBeCloseTo(0.1, 9)
    expect(pen(t, 3, 0.25)[1]).toBeCloseTo(0.3, 9)
    const arms = packArms(c)
    expect(arms.length).toBe(3 * 4)
    expect(arms[2]).toBeCloseTo(0.5, 9) // the first arm is the circle's radius
    expect(arms[11]).toBe(1) // the last arm carries the pen
  })

  it('the fewest arms for a square is many, for a circle one', () => {
    const sq = resample(PRESETS.find((p) => p.id === 'square')!.points, SAMPLES)
    expect(fewest(circle(SAMPLES), series(circle(SAMPLES)))).toBe(1)
    expect(fewest(sq, series(sq))).toBeGreaterThan(8)
  })
})

describe('kept in this browser', () => {
  it('round-trips a drawing as 128 points, and drops what is not one', () => {
    const k = toKept('My heart '.repeat(10), PRESETS[0].points)
    expect(k.points.length).toBe(128)
    expect(k.name.length).toBe(40)
    const back = readKept(JSON.stringify([k]))
    expect(back).toEqual([k])
    const bad = [
      {
        name: 'two',
        points: [
          [0, 0],
          [1, 1],
        ],
      },
      {
        name: 'far',
        points: [
          [0, 0],
          [9, 0],
          [0, 1],
        ],
      },
      {
        name: 'nan',
        points: [
          [0, 0],
          [null, 0],
          [0, 1],
        ],
      },
      { name: 7, points: k.points },
      null,
    ]
    expect(readKept(JSON.stringify([...bad, k]))).toEqual([k])
    expect(readKept(JSON.stringify(Array(30).fill(k))).length).toBe(MAX_KEPT)
    expect(readKept('nope')).toEqual([])
  })
})
