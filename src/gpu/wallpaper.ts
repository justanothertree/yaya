/**
 * The arithmetic of the Lab's wallpaper toy: the 17 ways a flat pattern can repeat, as the
 * International Tables write them — each group a short list of operations on fractional coordinates
 * — and the drawing that fills one cell of the lattice. Pure, so wallpaper.test.ts can check every
 * group without a GPU.
 *
 * ⚠️ THE PATTERN IS MADE BY ASKING, NOT BY COPYING. A pixel of the wall is inked if ANY of the
 * group's operations carries it onto ink in the cell. That one rule makes the whole wall symmetric
 * whatever was drawn — each operation just reorders the list being asked — and the test asks it
 * exactly that way: move a point by any operation of its group and the answer must not change.
 */

import { whole } from './kept'

export type V2 = [number, number]
/** x' = a·x + b·y + e, y' = c·x + d·y + f, on fractional coordinates of the lattice */
export type Op = [number, number, number, number, number, number]
export type Lattice = 'square' | 'hex'

const h = 0.5
const I: Op = [1, 0, 0, 1, 0, 0]

export type Group = {
  id: string
  /** the International notation, and what it means in words */
  name: string
  about: string
  lattice: Lattice
  ops: Op[]
  /** the highest order of rotation, whether it has mirrors, and whether it has glides */
  rotation: 1 | 2 | 3 | 4 | 6
  mirrors: boolean
  glides: boolean
}

/** a centred cell: every operation again, shifted half a cell both ways */
const centred = (ops: Op[]): Op[] => [
  ...ops,
  ...ops.map(([a, b, c, d, e, f]): Op => [a, b, c, d, e + h, f + h]),
]

export const GROUPS: Group[] = [
  {
    id: 'p1',
    name: 'p1',
    about: 'only repeats — no turns, no mirrors',
    lattice: 'square',
    ops: [I],
    rotation: 1,
    mirrors: false,
    glides: false,
  },
  {
    id: 'p2',
    name: 'p2',
    about: 'half turns',
    lattice: 'square',
    ops: [I, [-1, 0, 0, -1, 0, 0]],
    rotation: 2,
    mirrors: false,
    glides: false,
  },
  {
    id: 'pm',
    name: 'pm',
    about: 'parallel mirrors',
    lattice: 'square',
    ops: [I, [-1, 0, 0, 1, 0, 0]],
    rotation: 1,
    mirrors: true,
    glides: false,
  },
  {
    id: 'pg',
    name: 'pg',
    about: 'parallel glides — a mirror and a slide at once',
    lattice: 'square',
    ops: [I, [-1, 0, 0, 1, 0, h]],
    rotation: 1,
    mirrors: false,
    glides: true,
  },
  {
    id: 'cm',
    name: 'cm',
    about: 'mirrors with glides between them',
    lattice: 'square',
    ops: centred([I, [-1, 0, 0, 1, 0, 0]]),
    rotation: 1,
    mirrors: true,
    glides: true,
  },
  {
    id: 'pmm',
    name: 'pmm',
    about: 'mirrors both ways',
    lattice: 'square',
    ops: [I, [-1, 0, 0, -1, 0, 0], [-1, 0, 0, 1, 0, 0], [1, 0, 0, -1, 0, 0]],
    rotation: 2,
    mirrors: true,
    glides: false,
  },
  {
    id: 'pmg',
    name: 'pmg',
    about: 'mirrors one way, glides the other',
    lattice: 'square',
    ops: [I, [-1, 0, 0, -1, 0, 0], [-1, 0, 0, 1, h, 0], [1, 0, 0, -1, h, 0]],
    rotation: 2,
    mirrors: true,
    glides: true,
  },
  {
    id: 'pgg',
    name: 'pgg',
    about: 'glides both ways, no mirrors',
    lattice: 'square',
    ops: [I, [-1, 0, 0, -1, 0, 0], [-1, 0, 0, 1, h, h], [1, 0, 0, -1, h, h]],
    rotation: 2,
    mirrors: false,
    glides: true,
  },
  {
    id: 'cmm',
    name: 'cmm',
    about: 'mirrors both ways, centred',
    lattice: 'square',
    ops: centred([I, [-1, 0, 0, -1, 0, 0], [-1, 0, 0, 1, 0, 0], [1, 0, 0, -1, 0, 0]]),
    rotation: 2,
    mirrors: true,
    glides: true,
  },
  {
    id: 'p4',
    name: 'p4',
    about: 'quarter turns',
    lattice: 'square',
    ops: [I, [-1, 0, 0, -1, 0, 0], [0, -1, 1, 0, 0, 0], [0, 1, -1, 0, 0, 0]],
    rotation: 4,
    mirrors: false,
    glides: false,
  },
  {
    id: 'p4m',
    name: 'p4m',
    about: 'quarter turns and mirrors through their centres',
    lattice: 'square',
    ops: [
      I,
      [-1, 0, 0, -1, 0, 0],
      [0, -1, 1, 0, 0, 0],
      [0, 1, -1, 0, 0, 0],
      [-1, 0, 0, 1, 0, 0],
      [1, 0, 0, -1, 0, 0],
      [0, 1, 1, 0, 0, 0],
      [0, -1, -1, 0, 0, 0],
    ],
    rotation: 4,
    mirrors: true,
    glides: true,
  },
  {
    id: 'p4g',
    name: 'p4g',
    about: 'quarter turns, mirrors that miss their centres',
    lattice: 'square',
    ops: [
      I,
      [-1, 0, 0, -1, 0, 0],
      [0, -1, 1, 0, 0, 0],
      [0, 1, -1, 0, 0, 0],
      [-1, 0, 0, 1, h, h],
      [1, 0, 0, -1, h, h],
      [0, 1, 1, 0, h, h],
      [0, -1, -1, 0, h, h],
    ],
    rotation: 4,
    mirrors: true,
    glides: true,
  },
  {
    id: 'p3',
    name: 'p3',
    about: 'third turns',
    lattice: 'hex',
    ops: [I, [0, -1, 1, -1, 0, 0], [-1, 1, -1, 0, 0, 0]],
    rotation: 3,
    mirrors: false,
    glides: false,
  },
  {
    id: 'p3m1',
    name: 'p3m1',
    about: 'third turns, every centre on a mirror',
    lattice: 'hex',
    ops: [
      I,
      [0, -1, 1, -1, 0, 0],
      [-1, 1, -1, 0, 0, 0],
      [0, -1, -1, 0, 0, 0],
      [-1, 1, 0, 1, 0, 0],
      [1, 0, 1, -1, 0, 0],
    ],
    rotation: 3,
    mirrors: true,
    glides: true,
  },
  {
    id: 'p31m',
    name: 'p31m',
    about: 'third turns, some centres off the mirrors',
    lattice: 'hex',
    ops: [
      I,
      [0, -1, 1, -1, 0, 0],
      [-1, 1, -1, 0, 0, 0],
      [0, 1, 1, 0, 0, 0],
      [1, -1, 0, -1, 0, 0],
      [-1, 0, -1, 1, 0, 0],
    ],
    rotation: 3,
    mirrors: true,
    glides: true,
  },
  {
    id: 'p6',
    name: 'p6',
    about: 'sixth turns',
    lattice: 'hex',
    ops: [
      I,
      [0, -1, 1, -1, 0, 0],
      [-1, 1, -1, 0, 0, 0],
      [-1, 0, 0, -1, 0, 0],
      [0, 1, -1, 1, 0, 0],
      [1, -1, 1, 0, 0, 0],
    ],
    rotation: 6,
    mirrors: false,
    glides: false,
  },
  {
    id: 'p6m',
    name: 'p6m',
    about: 'sixth turns and every mirror there can be',
    lattice: 'hex',
    ops: [
      I,
      [0, -1, 1, -1, 0, 0],
      [-1, 1, -1, 0, 0, 0],
      [-1, 0, 0, -1, 0, 0],
      [0, 1, -1, 1, 0, 0],
      [1, -1, 1, 0, 0, 0],
      [0, -1, -1, 0, 0, 0],
      [-1, 1, 0, 1, 0, 0],
      [1, 0, 1, -1, 0, 0],
      [0, 1, 1, 0, 0, 0],
      [1, -1, 0, -1, 0, 0],
      [-1, 0, -1, 1, 0, 0],
    ],
    rotation: 6,
    mirrors: true,
    glides: true,
  },
]

/* ---------------------------------------------------------------- the lattice ----------------- */

/** the lattice's two basis vectors as columns: square, or the hexagonal setting with γ = 120° */
export function basis(l: Lattice): [V2, V2] {
  return l === 'square'
    ? [
        [1, 0],
        [0, 1],
      ]
    : [
        [1, 0],
        [-0.5, Math.sqrt(3) / 2],
      ]
}

/** a point of the plane to fractional coordinates of the lattice */
export function toFrac(l: Lattice, p: V2): V2 {
  const [a, b] = basis(l)
  const det = a[0] * b[1] - b[0] * a[1]
  return [(p[0] * b[1] - p[1] * b[0]) / det, (a[0] * p[1] - a[1] * p[0]) / det]
}

export function toPlane(l: Lattice, f: V2): V2 {
  const [a, b] = basis(l)
  return [a[0] * f[0] + b[0] * f[1], a[1] * f[0] + b[1] * f[1]]
}

export const apply = ([a, b, c, d, e, f]: Op, p: V2): V2 => [
  a * p[0] + b * p[1] + e,
  c * p[0] + d * p[1] + f,
]
export const wrap = (x: number) => x - Math.floor(x)

/**
 * Whether a point of the wall is inked: whether any operation of its group carries it onto ink in
 * the cell. `cell` is asked fractional coordinates in [0, 1).
 */
export function inked(g: Group, cell: (f: V2) => number, p: V2): number {
  const f = toFrac(g.lattice, p)
  let ink = 0
  for (const op of g.ops) {
    const q = apply(op, f)
    ink = Math.max(ink, cell([wrap(q[0]), wrap(q[1])]))
  }
  return ink
}

/* ---------------------------------------------------------------- drawings -------------------- */

export const SWATCHES = ['#1d3557', '#e63946', '#f4a261', '#2a9d8f', '#8338ec', '#f1faee'] as const
export const BACKGROUNDS = ['#f1e9da', '#0b1021', '#fefae0'] as const

export type Stroke = { colour: number; width: number; points: V2[] }
export type Drawing = { group: string; background: number; strokes: Stroke[] }

export const WALLPAPER_KEY = 'lab_wallpaper_v1'
export const MAX_KEPT = 12
export const MAX_STROKES = 200
export const MAX_POINTS = 600

/** a drawing read back: a known group, colours in range, points finite — anything else dropped */
export function readDrawing(v: unknown): Drawing | null {
  const d = v as Drawing
  if (!d || typeof d !== 'object' || !GROUPS.some((g) => g.id === d.group)) return null
  if (!Number.isInteger(d.background) || d.background < 0 || d.background >= BACKGROUNDS.length)
    return null
  if (!Array.isArray(d.strokes) || d.strokes.length > MAX_STROKES) return null
  const strokes: Stroke[] = []
  for (const s of d.strokes) {
    if (!s || !Number.isInteger(s.colour) || s.colour < 0 || s.colour >= SWATCHES.length)
      return null
    if (typeof s.width !== 'number' || !(s.width >= 0.002 && s.width <= 0.2)) return null
    if (!Array.isArray(s.points) || s.points.length < 1 || s.points.length > MAX_POINTS) return null
    const ok = s.points.every(
      (p) =>
        Array.isArray(p) &&
        p.length === 2 &&
        p.every((c) => typeof c === 'number' && Number.isFinite(c) && Math.abs(c) < 1e4),
    )
    if (!ok) return null
    strokes.push({
      colour: s.colour,
      width: s.width,
      points: s.points.map(([x, y]) => [x, y] as V2),
    })
  }
  return { group: d.group, background: d.background, strokes }
}

export function readKept(text: string | null): Drawing[] {
  try {
    const v = JSON.parse(text ?? '[]') as unknown
    if (!Array.isArray(v)) return []
    return v
      .map(readDrawing)
      .filter((d): d is Drawing => d !== null)
      .slice(0, MAX_KEPT)
  } catch {
    return []
  }
}

/** a drawing as it is kept: points rounded to a thousandth of a cell */
export const toKept = (d: Drawing): Drawing => ({
  ...d,
  strokes: d.strokes.map((s) => ({
    ...s,
    points: s.points.map(
      ([x, y]) => [Math.round(x * 1000) / 1000, Math.round(y * 1000) / 1000] as V2,
    ),
  })),
})

/* ---------------------------------------------------------------- which group is this? -------- */

/**
 * What the quiz keeps between visits, apart from the drawings: patterns named right of those asked,
 * and the longest run of right answers in a row. The run itself is this visit's.
 */
export const QUIZ_KEY = 'lab_wallpaper_quiz_v1'
export type Quiz = { right: number; asked: number; bestRun: number }
export const NO_QUIZ: Quiz = { right: 0, asked: 0, bestRun: 0 }
export function readQuiz(text: string | null): Quiz {
  let v: unknown
  try {
    v = JSON.parse(text ?? 'null')
  } catch {
    return NO_QUIZ
  }
  if (typeof v !== 'object' || !v || Array.isArray(v)) return NO_QUIZ
  const o = v as Record<string, unknown>
  const asked = whole(o.asked)
  const right = Math.min(asked, whole(o.right))
  return { right, asked, bestRun: Math.min(right, whole(o.bestRun)) }
}
/** the kept quiz after one answer, `run` being the run of right answers this answer ends on */
export const answered = (q: Quiz, right: boolean, run: number): Quiz => ({
  right: q.right + (right ? 1 : 0),
  asked: q.asked + 1,
  bestRun: Math.max(q.bestRun, run),
})

/** a seeded generator, so a quiz question can be asked again */
export function rng(seed: number) {
  let a = seed >>> 0 || 1
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * A quiz question: a random group, and a motif with no symmetry of its own — a few lopsided strokes
 * — so every symmetry in the picture is the group's and none is the motif's.
 */
export function question(seed: number): Drawing {
  const r = rng(seed)
  const g = GROUPS[Math.floor(r() * GROUPS.length)]
  const strokes: Stroke[] = []
  for (let s = 0; s < 3; s++) {
    const pts: V2[] = []
    let x = 0.15 + r() * 0.5
    let y = 0.15 + r() * 0.5
    for (let i = 0; i < 8; i++) {
      pts.push([x, y])
      x += (r() - 0.3) * 0.12
      y += (r() - 0.45) * 0.1
    }
    strokes.push({ colour: s % (SWATCHES.length - 1), width: 0.03 + r() * 0.03, points: pts })
  }
  return { group: g.id, background: 0, strokes }
}

/** what a wrong answer is missing or adding, in words — the feature that tells them apart */
export function difference(guess: Group, truth: Group): string {
  if (guess.lattice !== truth.lattice || guess.rotation !== truth.rotation)
    return `Count the turns: the pattern comes back after a ${['', 'full', 'half', 'third', 'quarter', '', 'sixth'][truth.rotation]} turn${truth.rotation === 1 ? ' only' : ''}.`
  if (guess.mirrors !== truth.mirrors)
    return truth.mirrors
      ? 'Look for a mirror line: it has one.'
      : 'There is no true mirror line here.'
  if (guess.glides !== truth.glides)
    return truth.glides ? 'Look for a glide: a mirror and a slide at once.' : 'There are no glides.'
  return 'Close — the same turns, mirrors and glides; it is where they sit relative to each other.'
}

/* ---------------------------------------------------------------- for the GPU ----------------- */

export const MAX_OPS = 12

/** the group's operations for the shader: each as (a, b, c, d) then (e, f, 0, 0) */
export function packOps(g: Group): Float32Array<ArrayBuffer> {
  const out = new Float32Array(MAX_OPS * 8)
  g.ops.forEach((op, i) => out.set([op[0], op[1], op[2], op[3], op[4], op[5], 0, 0], i * 8))
  return out
}

/* ---------------------------------------------------------------- painting the cell ----------- */

/** the hex colour as 0..1 rgb */
export const rgb = (hex: string): [number, number, number] => [
  parseInt(hex.slice(1, 3), 16) / 255,
  parseInt(hex.slice(3, 5), 16) / 255,
  parseInt(hex.slice(5, 7), 16) / 255,
]

type Ctx = Pick<
  OffscreenCanvasRenderingContext2D,
  'setTransform' | 'clearRect' | 'beginPath' | 'moveTo' | 'lineTo' | 'stroke' | 'arc' | 'fill'
> & {
  strokeStyle: unknown
  fillStyle: unknown
  lineWidth: number
  lineCap: CanvasLineCap
  lineJoin: CanvasLineJoin
}

/** plane → fractional coordinates as a canvas transform's linear part (x right, y down) */
const frame = (lattice: Lattice) =>
  lattice === 'hex' ? [1, 0, 1 / Math.sqrt(3), 2 / Math.sqrt(3)] : [1, 0, 0, 1]

/**
 * Paint strokes into one cell, `size` pixels square, in the cell's fractional coordinates —
 * through a transform that makes a round brush in the PLANE, so on the hexagonal lattice a dot is
 * round on the wall rather than round in the skewed cell. Each stroke is drawn at its own cell and
 * at all eight neighbours, so one crossing an edge comes in at the other side. `points` limits it to
 * the last few points of the last stroke: the segment just drawn, painted over what is there.
 */
export function paintCell(
  ctx: Ctx,
  size: number,
  lattice: Lattice,
  strokes: readonly Stroke[],
  only?: { from: number },
) {
  if (!only) {
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, size, size)
  }
  const [a, b, c, d] = frame(lattice)
  const list = only ? strokes.slice(-1) : strokes
  for (const s of list) {
    const pts = only ? s.points.slice(Math.max(0, only.from)) : s.points
    if (!pts.length) continue
    // bring the stroke near the base cell: its first point's cell, taken off
    const f0 = toFrac(lattice, s.points[0])
    const shift = [Math.floor(f0[0]), Math.floor(f0[1])]
    ctx.strokeStyle = SWATCHES[s.colour]
    ctx.fillStyle = SWATCHES[s.colour]
    ctx.lineWidth = s.width
    ctx.lineCap = 'round'
    ctx.lineJoin = 'round'
    for (let i = -1; i <= 1; i++)
      for (let j = -1; j <= 1; j++) {
        ctx.setTransform(
          a * size,
          b * size,
          c * size,
          d * size,
          (i - shift[0]) * size,
          (j - shift[1]) * size,
        )
        if (pts.length === 1) {
          ctx.beginPath()
          ctx.arc(pts[0][0], pts[0][1], s.width / 2, 0, Math.PI * 2)
          ctx.fill()
          continue
        }
        ctx.beginPath()
        ctx.moveTo(pts[0][0], pts[0][1])
        for (const p of pts.slice(1)) ctx.lineTo(p[0], p[1])
        ctx.stroke()
      }
  }
}

/**
 * The box of cell pixels a segment of a stroke touched, so only that much need go to the GPU —
 * or null when its copies at the cell's edges spread it over most of the cell anyway.
 */
export function touched(
  size: number,
  lattice: Lattice,
  s: Stroke,
  from: number,
): [number, number, number, number] | null {
  const pts = s.points.slice(Math.max(0, from))
  if (!pts.length) return null
  const f0 = toFrac(lattice, s.points[0])
  const shift = [Math.floor(f0[0]), Math.floor(f0[1])]
  // the brush is round in the plane; in the skewed cell it reaches at most this far
  const pad = Math.ceil(s.width * size * (lattice === 'hex' ? 2 / Math.sqrt(3) : 1)) + 2
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (let i = -1; i <= 1; i++)
    for (let j = -1; j <= 1; j++) {
      let bx0 = Infinity
      let by0 = Infinity
      let bx1 = -Infinity
      let by1 = -Infinity
      for (const p of pts) {
        const f = toFrac(lattice, p)
        const px = (f[0] + i - shift[0]) * size
        const py = (f[1] + j - shift[1]) * size
        bx0 = Math.min(bx0, px - pad)
        by0 = Math.min(by0, py - pad)
        bx1 = Math.max(bx1, px + pad)
        by1 = Math.max(by1, py + pad)
      }
      // clipped to the cell; a copy that misses it entirely adds nothing
      const cx0 = Math.max(0, Math.floor(bx0))
      const cy0 = Math.max(0, Math.floor(by0))
      const cx1 = Math.min(size, Math.ceil(bx1))
      const cy1 = Math.min(size, Math.ceil(by1))
      if (cx0 >= cx1 || cy0 >= cy1) continue
      x0 = Math.min(x0, cx0)
      y0 = Math.min(y0, cy0)
      x1 = Math.max(x1, cx1)
      y1 = Math.max(y1, cy1)
    }
  if (x0 === Infinity) return null
  if ((x1 - x0) * (y1 - y0) > (size * size) / 4) return null
  return [x0, y0, x1 - x0, y1 - y0]
}

/** how many cells fit across the stage's shorter side, and a stage point to the plane */
export const CELLS = 3
export function toPlaneFromStage(stage: [number, number], p: [number, number], cells = CELLS): V2 {
  const s = Math.min(stage[0], stage[1]) / cells
  return [(p[0] - stage[0] / 2) / s, (stage[1] / 2 - p[1]) / s]
}
