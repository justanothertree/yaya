import { describe, expect, it } from 'vitest'
import code from './fold.wgsl?raw'
import {
  LAYER_VEC4S,
  MAX_LAYERS,
  PAPER,
  PUZZLES,
  SOLVED,
  apply,
  clip,
  compose,
  coverage,
  creaseOf,
  flatSheet,
  fold,
  inside,
  match,
  onPaper,
  packLayers,
  packPaper,
  readFolds,
  reflection,
  replay,
  signedArea,
  snap,
  toTable,
  type Sheet,
  type V2,
} from './fold'
import { wgslLayout } from './wgslLayout'

const area = (s: Sheet) => s.layers.reduce((a, l) => a + signedArea(l.poly), 0)
const sheet = (r: Sheet | string) => {
  if (typeof r === 'string') throw new Error(r)
  return r
}
/** where on the flat sheet the top layer at p comes from, and which side shows */
const topAt = (s: Sheet, p: V2) => {
  for (let k = s.layers.length - 1; k >= 0; k--)
    if (inside(s.layers[k].poly, p))
      return { paper: apply(s.layers[k].toPaper, p), up: s.layers[k].up }
  return null
}

describe('the geometry of a fold', () => {
  it('a reflection is its own inverse and keeps distances', () => {
    const r = reflection([0.3, 0.2], [Math.cos(0.7), Math.sin(0.7)])
    const p: V2 = [0.9, -0.4]
    const q = apply(r, apply(r, p))
    expect(q[0]).toBeCloseTo(p[0], 12)
    expect(q[1]).toBeCloseTo(p[1], 12)
    const a = apply(r, [0, 0])
    const b = apply(r, [1, 0])
    expect(Math.hypot(b[0] - a[0], b[1] - a[1])).toBeCloseTo(1, 12)
    compose(r, r).forEach((v, i) => expect(v).toBeCloseTo([1, 0, 0, 0, 1, 0][i], 12))
  })
  it('the crease is half way between the two points and square to the move', () => {
    const c = creaseOf([1, 1], [0, 0])!
    expect(c.at).toEqual([0.5, 0.5])
    expect(Math.abs(c.dir[0] * 1 + c.dir[1] * 1)).toBeLessThan(1e-12)
    expect(creaseOf([0.3, 0.3], [0.3, 0.3])).toBeNull()
  })
  it('cutting a polygon keeps its area between the two parts', () => {
    const sq: V2[] = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ]
    const { pos, neg } = clip(sq, [0.3, 0], [0.6, 0.8])
    expect(signedArea(pos) + signedArea(neg)).toBeCloseTo(1, 12)
  })
})

describe('folding the sheet', () => {
  it('lays the picked-up point on the target point, turned over', () => {
    const s = sheet(fold(flatSheet(), [1, 1], [0.2, 0.4]))
    // the paper at (0.2, 0.4) on top is now the corner (1, 1) of the flat sheet, back up
    const t = topAt(s, [0.2001, 0.4001])!
    expect(t.paper[0]).toBeCloseTo(1, 3)
    expect(t.paper[1]).toBeCloseTo(1, 3)
    expect(t.up).toBe(false)
  })
  it('never makes or loses paper, fold after fold, and keeps every layer counter-clockwise', () => {
    let s = flatSheet()
    const moves: [V2, V2][] = [
      [
        [1, 0.5],
        [0, 0.5],
      ],
      [
        [0.3, 1],
        [0.1, 0.2],
      ],
      [
        [0, 0],
        [0.4, 0.45],
      ],
      [
        [0.5, 0.9],
        [0.45, 0.1],
      ],
    ]
    for (const [a, b] of moves) {
      s = sheet(fold(s, a, b))
      expect(area(s)).toBeCloseTo(1, 9)
      for (const l of s.layers) expect(signedArea(l.poly)).toBeGreaterThan(0)
    }
  })
  it('puts the turned-over part on top, in reverse order, and records the crease on the flat sheet', () => {
    const half = sheet(fold(flatSheet(), [1, 0.5], [0, 0.5]))
    expect(half.layers.map((l) => l.up)).toEqual([true, false])
    expect(half.creases).toHaveLength(1)
    const [a, b] = half.creases[0]
    expect([a[0], b[0]].map((v) => +v.toFixed(9))).toEqual([0.5, 0.5])
    // fold the two-layer half again: the layers that move come over in reverse order
    const q = sheet(fold(half, [0.25, 1], [0.25, 0]))
    expect(q.layers.map((l) => l.up)).toEqual([true, false, true, false])
    // the top of the stack at the middle of the quarter is the bottom-front sheet's far corner region
    const t = topAt(q, [0.25, 0.25])!
    expect(t.up).toBe(false)
  })
  it('refuses what is not a fold, saying why', () => {
    expect(fold(flatSheet(), [0.5, 0.5], [0.5, 0.5])).toMatch(/somewhere else/)
    expect(fold(flatSheet(), [3, 3], [2, 2])).toMatch(/misses/)
    expect(fold(flatSheet(), [0.5, 0.5], [3.5, 0.5])).toMatch(/whole sheet/)
  })
  it('refuses to fold past MAX_LAYERS, as paper does', () => {
    let s = flatSheet()
    let why = ''
    for (let k = 0; k < 10 && !why; k++) {
      // halve the stack again and again, alternating directions
      const xs = s.layers.flatMap((l) => l.poly.map((p) => p[0]))
      const ys = s.layers.flatMap((l) => l.poly.map((p) => p[1]))
      const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
      const r =
        k % 2
          ? fold(s, [x1, (y0 + y1) / 2], [x0, (y0 + y1) / 2])
          : fold(s, [(x0 + x1) / 2, y1], [(x0 + x1) / 2, y0])
      if (typeof r === 'string') why = r
      else s = r
    }
    expect(s.layers.length).toBeLessThanOrEqual(MAX_LAYERS)
    expect(why).toMatch(/too thick/)
  })
})

describe('the puzzles', () => {
  const flat = coverage(flatSheet())
  it('each folds as its stored folds say, within its limit, and the flat sheet does not match it', () => {
    for (const p of PUZZLES) {
      const s = sheet(replay(p.folds))
      expect(p.folds.length, p.name).toBeLessThanOrEqual(p.limit)
      expect(match(flat, coverage(s)), p.name).toBeLessThan(SOLVED)
      expect(area(s), p.name).toBeCloseTo(1, 9)
    }
  })
  it('no two targets are near enough for one to pass as the other', () => {
    const c = PUZZLES.map((p) => coverage(sheet(replay(p.folds))))
    for (let i = 0; i < c.length; i++)
      for (let j = i + 1; j < c.length; j++)
        expect(match(c[i], c[j]), `${PUZZLES[i].name} vs ${PUZZLES[j].name}`).toBeLessThan(SOLVED)
  })
  it('a different way to the same shape counts: the half folded the other way round matches', () => {
    const target = coverage(sheet(replay(PUZZLES[0].folds)))
    // left edge laid on the right instead: the half lands on the right, which is not the target
    const other = coverage(sheet(replay([[0, 0.5, 1, 0.5]])))
    expect(match(target, other)).toBeLessThan(SOLVED)
    // but folding the top-right onto the bottom-left half way across is the same half, by area
    const same = coverage(sheet(replay([[1, 0.2, 0, 0.2]])))
    expect(match(target, same)).toBeGreaterThan(SOLVED)
  })
})

describe('picking up the paper', () => {
  it('on it, or a hair off its edge, but not out on the table', () => {
    expect(onPaper(flatSheet(), [0.5, 0.5])).toBe(true)
    expect(onPaper(flatSheet(), [1.0003, 0.5])).toBe(true)
    expect(onPaper(flatSheet(), [1.2, 0.5])).toBe(false)
  })
})

describe('snapping', () => {
  it('to a corner of the sheet as it lies, else to twelfths', () => {
    const s = sheet(fold(flatSheet(), [1, 1], [0, 0]))
    const c = snap(s, [0.98, 0.02])
    expect(c[0]).toBeCloseTo(1, 12)
    expect(c[1]).toBeCloseTo(0, 12)
    expect(snap(flatSheet(), [0.335, 0.7])).toEqual([1 / 3, 0.7])
    expect(snap(flatSheet(), [0.29, 0.62])).toEqual([0.29, 0.62])
  })
})

describe('folds as a file', () => {
  it('come back, and fold the same sheet', () => {
    const r = readFolds(JSON.stringify({ folds: PUZZLES[3].folds, colour: 5 }))
    expect(r).toEqual({ folds: PUZZLES[3].folds, colour: 5 })
  })
  it('refuse what is not folds, saying why', () => {
    expect(readFolds('x'.repeat(5000))).toMatch(/too big/)
    expect(readFolds('{')).toMatch(/not JSON/)
    expect(readFolds(JSON.stringify({ folds: [] }))).toMatch(/1 to 8/)
    expect(readFolds(JSON.stringify({ folds: Array(9).fill([1, 0.5, 0, 0.5]) }))).toMatch(/1 to 8/)
    expect(readFolds(JSON.stringify({ folds: [[1, 0.5, 0, '0.5']] }))).toMatch(/1 to 8/)
    expect(readFolds(JSON.stringify({ folds: [[1, 0.5, 0, 99]] }))).toMatch(/1 to 8/)
    expect(readFolds(JSON.stringify({ folds: [[3, 3, 2, 2]] }))).toMatch(/do not fold/)
  })
})

describe('for the GPU', () => {
  it('the uniform agrees with the shader about where every field lives, and is written where read', () => {
    const wgsl = wgslLayout(code, 'Paper')
    const { bytes, ...rest } = PAPER
    expect(wgsl.offsets).toEqual(rest)
    expect(wgsl.bytes).toBe(bytes)
    const v = new DataView(
      packPaper({
        w: 300,
        h: 500,
        layers: 4,
        creases: 3,
        ghost: 2,
        colour: 6,
        view: [0.5, 0.25],
        span: 2.5,
      }),
    )
    expect([0, 4, 8, 12, 16, 20].map((o) => v.getUint32(o, true))).toEqual([300, 500, 4, 3, 2, 6])
    expect([
      v.getFloat32(PAPER.view, true),
      v.getFloat32(PAPER.view + 4, true),
      v.getFloat32(PAPER.span, true),
    ]).toEqual([0.5, 0.25, 2.5])
  })
  it('packs each layer as its corners, then its map back to the sheet with the count and the side', () => {
    const s = sheet(fold(flatSheet(), [1, 1], [0, 0]))
    const f = packLayers(s)
    const top = s.layers[1]
    const o = LAYER_VEC4S * 4
    expect([f[o], f[o + 1]]).toEqual(top.poly[0].map(Math.fround))
    expect(Array.from(f.slice(o + 24, o + 32))).toEqual(
      [
        top.toPaper[0],
        top.toPaper[1],
        top.toPaper[2],
        top.poly.length,
        top.toPaper[3],
        top.toPaper[4],
        top.toPaper[5],
        0,
      ].map(Math.fround),
    )
  })
  it('puts the view’s centre in the middle of the stage, y up', () => {
    expect(toTable([400, 300], [0.5, 0.5], 2, [200, 150])).toEqual([0.5, 0.5])
    expect(toTable([400, 300], [0.5, 0.5], 2, [200, 0])[1]).toBeCloseTo(1.5, 9)
  })
})
