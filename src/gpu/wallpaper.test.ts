import { describe, expect, it } from 'vitest'
import {
  GROUPS,
  MAX_OPS,
  apply,
  basis,
  difference,
  inked,
  packOps,
  question,
  readDrawing,
  readKept,
  rng,
  toFrac,
  toKept,
  toPlane,
  type Group,
  type Op,
  type V2,
} from './wallpaper'

// how many operations each group has in its cell, from the International Tables
const ORDER: Record<string, number> = {
  p1: 1,
  p2: 2,
  pm: 2,
  pg: 2,
  cm: 4,
  pmm: 4,
  pmg: 4,
  pgg: 4,
  cmm: 8,
  p4: 4,
  p4m: 8,
  p4g: 8,
  p3: 3,
  p3m1: 6,
  p31m: 6,
  p6: 6,
  p6m: 12,
}
const compose = (x: Op, y: Op): Op => {
  // x after y
  const [a, b, c, d, e, f] = x
  const [p, q, r, s, t, u] = y
  return [
    a * p + b * r,
    a * q + b * s,
    c * p + d * r,
    c * q + d * s,
    a * t + b * u + e,
    c * t + d * u + f,
  ]
}
const sameModLattice = (x: Op, y: Op) =>
  x.slice(0, 4).every((v, i) => Math.abs(v - y[i]) < 1e-9) &&
  [4, 5].every((i) => {
    const d = x[i] - y[i]
    return Math.abs(d - Math.round(d)) < 1e-9
  })
/** a cell with no symmetry of its own: a lopsided blob, so any symmetry in the wall is the group's */
const lopsided = (f: V2) =>
  Math.hypot(f[0] - 0.3, (f[1] - 0.2) * 1.7) < 0.12 ||
  (f[0] > 0.55 && f[0] < 0.6 && f[1] > 0.1 && f[1] < 0.5)
    ? 1
    : 0

describe('the seventeen groups', () => {
  it('are all there, each with as many operations as the tables give', () => {
    expect(GROUPS.map((g) => g.id).sort()).toEqual(Object.keys(ORDER).sort())
    for (const g of GROUPS) {
      expect(g.ops.length, g.id).toBe(ORDER[g.id])
      expect(g.ops.length).toBeLessThanOrEqual(MAX_OPS)
    }
  })

  it('are groups: any two operations together are a third, up to a whole-cell shift', () => {
    for (const g of GROUPS)
      for (const x of g.ops)
        for (const y of g.ops) {
          const xy = compose(x, y)
          expect(
            g.ops.some((z) => sameModLattice(z, xy)),
            `${g.id}`,
          ).toBe(true)
        }
  })

  it('move the plane rigidly: every operation keeps distances, so it is a real symmetry', () => {
    for (const g of GROUPS) {
      const [A, B] = basis(g.lattice)
      for (const op of g.ops)
        for (const v of [
          [1, 0],
          [0, 1],
          [0.3, -0.7],
        ] as V2[]) {
          // the operation's linear part, taken into the plane and back
          const f = toFrac(g.lattice, v)
          const m: V2 = [op[0] * f[0] + op[1] * f[1], op[2] * f[0] + op[3] * f[1]]
          const w: V2 = [A[0] * m[0] + B[0] * m[1], A[1] * m[0] + B[1] * m[1]]
          expect(Math.hypot(...w), g.id).toBeCloseTo(Math.hypot(...v), 9)
        }
    }
  })

  it('make a wall that every operation of the group leaves exactly as it was', () => {
    const r = rng(7)
    for (const g of GROUPS) {
      for (let i = 0; i < 200; i++) {
        const p: V2 = [r() * 4 - 2, r() * 4 - 2]
        const here = inked(g, lopsided, p)
        for (const op of g.ops) {
          const moved = toPlane(g.lattice, apply(op, toFrac(g.lattice, p)))
          expect(inked(g, lopsided, moved), `${g.id}`).toBe(here)
        }
      }
    }
  })

  it('and no more symmetry than the group has: p4 has no mirror, p1 no half turn', () => {
    const find = (id: string) => GROUPS.find((g) => g.id === id) as Group
    const breaks = (g: Group, op: Op) => {
      const r = rng(11)
      for (let i = 0; i < 400; i++) {
        const p: V2 = [r() * 3, r() * 3]
        const q = toPlane(g.lattice, apply(op, toFrac(g.lattice, p)))
        if (inked(g, lopsided, p) !== inked(g, lopsided, q)) return true
      }
      return false
    }
    expect(breaks(find('p4'), [-1, 0, 0, 1, 0, 0])).toBe(true)
    expect(breaks(find('p1'), [-1, 0, 0, -1, 0, 0])).toBe(true)
    expect(breaks(find('p3'), [-1, 0, 0, -1, 0, 0])).toBe(true) // a half turn is p6's, not p3's
  })
})

describe('quiz and keeping', () => {
  it('a question is the same for the same seed, and says what a wrong guess missed', () => {
    expect(question(42)).toEqual(question(42))
    const find = (id: string) => GROUPS.find((g) => g.id === id) as Group
    expect(difference(find('p2'), find('p4'))).toMatch(/quarter/)
    expect(difference(find('p4'), find('p4m'))).toMatch(/mirror/)
    expect(difference(find('pm'), find('pg'))).toMatch(/no true mirror/)
  })

  it('round-trips a drawing, and refuses one that is not', () => {
    const d = {
      group: 'p4g',
      background: 2,
      strokes: [
        {
          colour: 3,
          width: 0.05,
          points: [
            [0.12345, 0.5],
            [0.7, 0.81],
          ] as V2[],
        },
      ],
    }
    const kept = toKept(d)
    expect(kept.strokes[0].points[0]).toEqual([0.123, 0.5])
    expect(readKept(JSON.stringify([kept]))).toEqual([kept])
    for (const bad of [
      { ...d, group: 'p5' },
      { ...d, background: 9 },
      { ...d, strokes: [{ ...d.strokes[0], colour: 99 }] },
      { ...d, strokes: [{ ...d.strokes[0], width: 3 }] },
      { ...d, strokes: [{ ...d.strokes[0], points: [[0, NaN]] }] },
    ])
      expect(readDrawing(bad)).toBeNull()
    expect(readKept('nope')).toEqual([])
  })

  it('packs a group’s operations two vec4s each', () => {
    const g = GROUPS.find((x) => x.id === 'p4g') as Group
    const p = packOps(g)
    expect(p.length).toBe(MAX_OPS * 8)
    expect([...p.slice(32, 38)]).toEqual([-1, 0, 0, 1, 0.5, 0.5])
  })
})
