/**
 * The arithmetic of the Lab's fold: a square of paper, folded flat. Pick up a point of the paper and
 * lay it down somewhere else: the crease is the line half way between, square to the move, and
 * everything on the picked-up side turns over onto the top. The paper is two-coloured, so what was
 * underneath shows. Puzzles ask for a silhouette within so many folds; free folding is for making
 * shapes, kept as a picture or as the folds that made them.
 *
 * ⚠️ THE GPU DRAWS THE LAYERS; THE PAPER IS HERE. A folded sheet is a stack of flat layers, each a
 * convex polygon where it lies now, the map back to where that part was on the flat sheet, and which
 * side is up. `fold` clips every layer by the crease, turns the moving parts over (reflecting them,
 * reversing their order, putting them on top) and adds the creases to the sheet. The shader finds
 * the top layer at each pixel and colours it from the flat sheet; fold.test.ts holds the geometry.
 */

export type V2 = [number, number]
/** an affine map: [a, b, c, d, e, f] takes (x, y) to (a·x + b·y + c, d·x + e·y + f) */
export type Affine = [number, number, number, number, number, number]
export const IDENTITY: Affine = [1, 0, 0, 0, 1, 0]

export type Layer = {
  /** where it lies now: a convex polygon, counter-clockwise */
  poly: V2[]
  /** from where it lies now back to the flat sheet */
  toPaper: Affine
  /** the front of the paper faces up */
  up: boolean
}

/** a sheet: its layers bottom to top, and the creases on the flat sheet */
export type Sheet = { layers: Layer[]; creases: [V2, V2][] }

/** the most layers a sheet may have: past this, paper will not fold (and nor will the shader) */
export const MAX_LAYERS = 64
export const MAX_VERTS = 12
export const MAX_CREASES = 128

export const flatSheet = (): Sheet => ({
  layers: [
    {
      poly: [
        [0, 0],
        [1, 0],
        [1, 1],
        [0, 1],
      ],
      toPaper: IDENTITY,
      up: true,
    },
  ],
  creases: [],
})

export const apply = (m: Affine, [x, y]: V2): V2 => [
  m[0] * x + m[1] * y + m[2],
  m[3] * x + m[4] * y + m[5],
]
/** m ∘ n: first n, then m */
export const compose = (m: Affine, n: Affine): Affine => [
  m[0] * n[0] + m[1] * n[3],
  m[0] * n[1] + m[1] * n[4],
  m[0] * n[2] + m[1] * n[5] + m[2],
  m[3] * n[0] + m[4] * n[3],
  m[3] * n[1] + m[4] * n[4],
  m[3] * n[2] + m[4] * n[5] + m[5],
]

/** the crease for moving `from` onto `to`: a point on it and its direction (the perpendicular bisector) */
export function creaseOf(from: V2, to: V2): { at: V2; dir: V2 } | null {
  const dx = to[0] - from[0]
  const dy = to[1] - from[1]
  const l = Math.hypot(dx, dy)
  if (l < 1e-6) return null
  return { at: [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2], dir: [-dy / l, dx / l] }
}

/** the reflection across a line, as an affine map */
export function reflection(at: V2, dir: V2): Affine {
  const [ux, uy] = dir
  // reflect = 2·(u uᵀ) − I about the line through `at`
  const a = 2 * ux * ux - 1
  const b = 2 * ux * uy
  const d = 2 * ux * uy
  const e = 2 * uy * uy - 1
  return [a, b, at[0] - a * at[0] - b * at[1], d, e, at[1] - d * at[0] - e * at[1]]
}

/** which side of the line a point is on: positive on the side the move came from */
const sideOf = (at: V2, dir: V2, p: V2) => (p[0] - at[0]) * dir[1] - (p[1] - at[1]) * dir[0]

/** a convex polygon cut by a line: the part on each side (either may be empty) */
export function clip(poly: V2[], at: V2, dir: V2): { pos: V2[]; neg: V2[] } {
  const pos: V2[] = []
  const neg: V2[] = []
  const eps = 1e-9
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    const sa = sideOf(at, dir, a)
    const sb = sideOf(at, dir, b)
    if (sa >= -eps) pos.push(a)
    if (sa <= eps) neg.push(a)
    if ((sa > eps && sb < -eps) || (sa < -eps && sb > eps)) {
      const t = sa / (sa - sb)
      const c: V2 = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]
      pos.push(c)
      neg.push(c)
    }
  }
  const area = (p: V2[]) => Math.abs(signedArea(p))
  return { pos: area(pos) > 1e-9 ? pos : [], neg: area(neg) > 1e-9 ? neg : [] }
}

export function signedArea(p: readonly V2[]) {
  let s = 0
  for (let i = 0; i < p.length; i++) {
    const a = p[i]
    const b = p[(i + 1) % p.length]
    s += a[0] * b[1] - b[0] * a[1]
  }
  return s / 2
}

/**
 * Fold: the point `from` (where the paper was picked up) is laid on `to`. Every layer is cut by the
 * crease; the parts on the picked-up side turn over — reflected, their side flipped, their order
 * reversed, laid on top of everything — and the rest stays. Returns the new sheet, or why not.
 */
export function fold(s: Sheet, from: V2, to: V2): Sheet | string {
  const c = creaseOf(from, to)
  if (!c) return 'Lay the point somewhere else to make a fold.'
  // the picked-up side is the one `from` is on
  const sign = Math.sign(sideOf(c.at, c.dir, from)) || 1
  const r = reflection(c.at, c.dir)
  const stay: Layer[] = []
  const move: Layer[] = []
  const creases = s.creases.slice()
  for (const l of s.layers) {
    const { pos, neg } = clip(l.poly, c.at, c.dir)
    const mine = sign > 0 ? pos : neg
    const rest = sign > 0 ? neg : pos
    if (rest.length) stay.push({ ...l, poly: rest })
    if (mine.length) {
      // the moving part, turned over: reflected where it lies, and the map back to the sheet
      // reflected with it (reflection is its own inverse); a reflection reverses winding, so the
      // polygon is reversed to stay counter-clockwise
      move.push({
        poly: mine.map((p) => apply(r, p)).reverse(),
        toPaper: compose(l.toPaper, r),
        up: !l.up,
      })
      // where this layer was cut, the crease on the flat sheet
      if (rest.length) {
        const on = mine.filter((p) => Math.abs(sideOf(c.at, c.dir, p)) < 1e-7)
        if (on.length >= 2)
          creases.push([apply(l.toPaper, on[0]), apply(l.toPaper, on[on.length - 1])])
      }
    }
  }
  if (!move.length) return 'That fold misses the paper.'
  if (!stay.length) return 'That would turn the whole sheet over, not fold it.'
  const layers = [...stay, ...move.reverse()]
  if (layers.length > MAX_LAYERS)
    return `The paper is ${s.layers.length} layers thick — too thick to fold again.`
  if (layers.some((l) => l.poly.length > MAX_VERTS))
    return 'That fold would cut the paper too finely.'
  return { layers, creases: creases.slice(0, MAX_CREASES) }
}

/** whether a point is inside a convex counter-clockwise polygon */
export function inside(poly: readonly V2[], p: V2) {
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]
    const b = poly[(i + 1) % poly.length]
    if ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) < -1e-12) return false
  }
  return true
}

/** whether a press at p picks up the paper: on any layer, or within `reach` of one's edge — paper is
 *  picked up by its edge as often as not, and a press exactly on the edge lands either side of it */
export function onPaper(s: Sheet, p: V2, reach = 0.04) {
  return s.layers.some((l) => {
    if (inside(l.poly, p)) return true
    for (let i = 0; i < l.poly.length; i++) {
      const a = l.poly[i]
      const b = l.poly[(i + 1) % l.poly.length]
      const dx = b[0] - a[0]
      const dy = b[1] - a[1]
      const t = Math.max(
        0,
        Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)),
      )
      if (Math.hypot(p[0] - a[0] - dx * t, p[1] - a[1] - dy * t) < reach) return true
    }
    return false
  })
}

/** the area the sheet covers, measured on a grid over the part of the table paper can reach */
export const AREA = { lo: -1, hi: 2, n: 240 }
export function coverage(s: Sheet): Uint8Array {
  const { lo, hi, n } = AREA
  const g = new Uint8Array(n * n)
  const step = (hi - lo) / n
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const p: V2 = [lo + (i + 0.5) * step, lo + (j + 0.5) * step]
      if (s.layers.some((l) => inside(l.poly, p))) g[j * n + i] = 1
    }
  return g
}
/** how well a sheet's silhouette matches a target's: shared area over the area of either */
export function match(a: Uint8Array, b: Uint8Array) {
  let both = 0
  let either = 0
  for (let i = 0; i < a.length; i++) {
    both += a[i] & b[i]
    either += a[i] | b[i]
  }
  return either ? both / either : 1
}
export const SOLVED = 0.97

/** a sequence of folds from the flat sheet: [fromX, fromY, toX, toY] each */
export type Folds = [number, number, number, number][]
export function replay(folds: Folds): Sheet | string {
  let s: Sheet = flatSheet()
  for (const [a, b, c, d] of folds) {
    const n = fold(s, [a, b], [c, d])
    if (typeof n === 'string') return n
    s = n
  }
  return s
}

/** the puzzles: each target is the silhouette of a known way of folding it */
export const PUZZLES: { name: string; hint: string; limit: number; folds: Folds }[] = [
  {
    name: 'Half',
    hint: 'Pick up the paper by an edge and lay it on the other edge.',
    limit: 1,
    folds: [[1, 0.5, 0, 0.5]],
  },
  {
    name: 'Triangle',
    hint: 'A corner laid on the opposite corner.',
    limit: 1,
    folds: [[1, 1, 0, 0]],
  },
  {
    name: 'Little square',
    hint: 'A quarter of the sheet, in two folds.',
    limit: 2,
    folds: [
      [1, 0.5, 0, 0.5],
      [0.25, 1, 0.25, 0],
    ],
  },
  {
    name: 'House',
    hint: 'Two top corners down to the middle.',
    limit: 2,
    folds: [
      [0, 1, 0.5, 0.5],
      [1, 1, 0.5, 0.5],
    ],
  },
  {
    name: 'Thirds',
    hint: 'A strip a third as wide — the second fold lays an edge on the first fold’s edge.',
    limit: 2,
    folds: [
      [1, 0.5, 1 / 3, 0.5],
      [0, 0.5, 2 / 3, 0.5],
    ],
  },
  {
    name: 'Envelope',
    hint: 'All four corners to the middle.',
    limit: 4,
    folds: [
      [0, 0, 0.5, 0.5],
      [1, 0, 0.5, 0.5],
      [1, 1, 0.5, 0.5],
      [0, 1, 0.5, 0.5],
    ],
  },
  {
    name: 'Arrow',
    hint: 'A house, then fold it in half down the middle.',
    limit: 3,
    folds: [
      [0, 1, 0.5, 0.5],
      [1, 1, 0.5, 0.5],
      [1, 0.25, 0, 0.25],
    ],
  },
]

/** where a point snaps: to a corner of the sheet as it lies, else (more gently) to a grid of twelfths */
export function snap(s: Sheet, p: V2, reach = 0.04): V2 {
  let best: V2 | null = null
  let d = reach
  for (const l of s.layers)
    for (const q of l.poly) {
      const e = Math.hypot(q[0] - p[0], q[1] - p[1])
      if (e < d) {
        d = e
        best = q
      }
    }
  if (best) return [best[0], best[1]]
  // the grid's pull is gentler than a corner's: twelfths are only 0.083 apart, and a pull of half
  // that would leave nowhere in between to put a point
  const g = (v: number) => {
    const k = Math.round(v * 12) / 12
    return Math.abs(k - v) < reach * 0.4 ? k : v
  }
  return [g(p[0]), g(p[1])]
}

/* ---------------------------------------------------------------- folds as a file ------------- */

export const FOLD_KEY = 'lab_fold_v1'
export const FILE_LIMIT = 4_000
export const MAX_FOLDS = 8

/** folds from a file, or why not: numbers only, bounded, and they must fold */
export function readFolds(text: unknown): { folds: Folds; colour: number } | string {
  if (typeof text !== 'string' || text.length > FILE_LIMIT)
    return 'That file is too big to be folds.'
  let v: unknown
  try {
    v = JSON.parse(text)
  } catch {
    return 'That file is not folds (it is not JSON).'
  }
  const o = (v ?? {}) as Record<string, unknown>
  const f = o.folds
  const num = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n >= -2 && n <= 3
  if (
    !Array.isArray(f) ||
    f.length < 1 ||
    f.length > MAX_FOLDS ||
    !f.every((x) => Array.isArray(x) && x.length === 4 && x.every(num))
  )
    return `Folds are 1 to ${MAX_FOLDS} moves of four numbers each.`
  const colour =
    typeof o.colour === 'number' && Number.isInteger(o.colour) && o.colour >= 0 && o.colour < 8
      ? o.colour
      : 0
  const folds = (f as Folds).map((x) => [...x] as Folds[number])
  const s = replay(folds)
  if (typeof s === 'string') return `Those folds do not fold: ${s}`
  return { folds, colour }
}

/* ---------------------------------------------------------------- for the GPU ---------------- */

/** each layer packed as 8 × vec4: six for up to 12 corners, then the map back to the sheet with the
 *  corner count and the side that is up */
export const LAYER_VEC4S = 8

export function packLayers(s: Sheet, into = new Float32Array(MAX_LAYERS * LAYER_VEC4S * 4)) {
  into.fill(0)
  s.layers.slice(0, MAX_LAYERS).forEach((l, k) => {
    const o = k * LAYER_VEC4S * 4
    l.poly.slice(0, MAX_VERTS).forEach((p, i) => {
      into[o + i * 2] = p[0]
      into[o + i * 2 + 1] = p[1]
    })
    const m = l.toPaper
    into.set([m[0], m[1], m[2], l.poly.length, m[3], m[4], m[5], l.up ? 1 : 0], o + 24)
  })
  return into
}

/** Hand-packed to match `struct Paper` — fold.test.ts lays the struct out from the shader. */
export const PAPER = {
  size: 0,
  layers: 8,
  creases: 12,
  ghost: 16,
  colour: 20,
  view: 24,
  span: 32,
  bytes: 40,
} as const

/** the colours of the paper's front, the back always being cream */
export const COLOURS = [
  'coral',
  'indigo',
  'jade',
  'saffron',
  'plum',
  'teal',
  'tomato',
  'slate',
] as const

export function packPaper(
  p: {
    w: number
    h: number
    layers: number
    creases: number
    ghost: number
    colour: number
    view: [number, number]
    span: number
  },
  into = new ArrayBuffer(PAPER.bytes),
) {
  const u = new Uint32Array(into)
  const f = new Float32Array(into)
  u.set([p.w, p.h, p.layers, p.creases, p.ghost, p.colour], 0)
  f.set(p.view, PAPER.view / 4)
  f[PAPER.span / 4] = p.span
  return into
}

/** a point of the stage to the table the paper lies on: centred on `view`, `span` units across the
 *  shorter side, y up — the shader's `to_table` */
export function toTable(size: [number, number], view: [number, number], span: number, p: V2): V2 {
  const k = span / Math.min(size[0], size[1])
  return [view[0] + (p[0] - size[0] / 2) * k, view[1] - (p[1] - size[1] / 2) * k]
}
