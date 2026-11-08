/**
 * The arithmetic of the Lab's epicycles: a closed drawing as a sum of rotating arms — its discrete
 * Fourier series — and how well the biggest few of them redraw it. Pure, so epicycles.test.ts can
 * ask it questions without a GPU.
 *
 * A drawing is a loop of complex numbers z(t), t from 0 to 1. Each Fourier term is an arm of fixed
 * length turning at a whole number of turns per loop (positive one way, negative the other); laid
 * end to end, the arms' tip traces the drawing. Keep only the longest k and the tip traces the best
 * k-arm approximation there is — that is what the slider is.
 */

export type V2 = [number, number]
export type Term = {
  /** turns per loop: positive is anticlockwise (with y up), negative clockwise */
  freq: number
  re: number
  im: number
  amp: number
  phase: number
}

/** the drawing resampled to n points evenly spaced along its length, the loop closed */
export function resample(points: readonly V2[], n: number): V2[] {
  if (points.length === 0) return []
  if (points.length === 1) return Array.from({ length: n }, () => [...points[0]] as V2)
  const loop = [...points, points[0]]
  const lens = [0]
  for (let i = 1; i < loop.length; i++)
    lens.push(lens[i - 1] + Math.hypot(loop[i][0] - loop[i - 1][0], loop[i][1] - loop[i - 1][1]))
  const total = lens[lens.length - 1]
  if (total === 0) return Array.from({ length: n }, () => [...points[0]] as V2)
  const out: V2[] = []
  let j = 1
  for (let i = 0; i < n; i++) {
    const at = (i / n) * total
    while (j < lens.length - 1 && lens[j] < at) j++
    const seg = lens[j] - lens[j - 1] || 1
    const f = (at - lens[j - 1]) / seg
    out.push([
      loop[j - 1][0] + (loop[j][0] - loop[j - 1][0]) * f,
      loop[j - 1][1] + (loop[j][1] - loop[j - 1][1]) * f,
    ])
  }
  return out
}

/**
 * Every term of the series, longest first — except the centre (freq 0), which is always first,
 * because it is where the chain of arms is pinned rather than an arm of its own.
 */
export function series(points: readonly V2[]): Term[] {
  const n = points.length
  const terms: Term[] = []
  // frequencies centred on 0, so the series of n points is the n nearest whole numbers to it
  const lo = -Math.floor((n - 1) / 2)
  for (let k = lo; k < lo + n; k++) {
    let re = 0
    let im = 0
    for (let j = 0; j < n; j++) {
      const a = (-2 * Math.PI * k * j) / n
      re += points[j][0] * Math.cos(a) - points[j][1] * Math.sin(a)
      im += points[j][0] * Math.sin(a) + points[j][1] * Math.cos(a)
    }
    re /= n
    im /= n
    terms.push({ freq: k, re, im, amp: Math.hypot(re, im), phase: Math.atan2(im, re) })
  }
  const centre = terms.find((t) => t.freq === 0)!
  return [
    centre,
    ...terms.filter((t) => t.freq !== 0).sort((a, b) => b.amp - a.amp || a.freq - b.freq),
  ]
}

/** where the chain is pinned (the centre) and every joint after it, at time t (0..1), using the k
 *  longest arms: k + 1 points, the last of them the pen */
export function chain(terms: readonly Term[], k: number, t: number): V2[] {
  const out: V2[] = []
  let x = 0
  let y = 0
  const use = terms.slice(0, Math.min(terms.length, k + 1))
  for (const term of use) {
    const a = 2 * Math.PI * term.freq * t
    x += term.re * Math.cos(a) - term.im * Math.sin(a)
    y += term.re * Math.sin(a) + term.im * Math.cos(a)
    out.push([x, y])
  }
  return out
}

export const pen = (terms: readonly Term[], k: number, t: number): V2 => {
  const c = chain(terms, k, t)
  return c[c.length - 1]
}

/** how far the k-arm drawing strays from the drawing, as a share of the drawing's size */
export function error(points: readonly V2[], terms: readonly Term[], k: number): number {
  const n = points.length
  if (!n) return 0
  let e = 0
  for (let j = 0; j < n; j++) {
    const p = pen(terms, k, j / n)
    e += Math.hypot(p[0] - points[j][0], p[1] - points[j][1])
  }
  return e / n / Math.max(1e-9, size(points))
}

/** the furthest the k-arm drawing strays from the drawing anywhere, as a share of its size — the
 *  measure for "does it look right", because a mean hides a rounded-off corner: a square redrawn
 *  with three arms is within 1% on average and nowhere near square */
export function worst(points: readonly V2[], terms: readonly Term[], k: number): number {
  let e = 0
  points.forEach((q, j) => {
    const p = pen(terms, k, j / points.length)
    e = Math.max(e, Math.hypot(p[0] - q[0], p[1] - q[1]))
  })
  return e / Math.max(1e-9, size(points))
}

/** the drawing's size: the diagonal of its box */
export function size(points: readonly V2[]) {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const [x, y] of points) {
    x0 = Math.min(x0, x)
    y0 = Math.min(y0, y)
    x1 = Math.max(x1, x)
    y1 = Math.max(y1, y)
  }
  return Math.hypot(x1 - x0, y1 - y0)
}

/** the fewest arms that redraw it nowhere further than `within` of its size from the drawing */
export function fewest(points: readonly V2[], terms: readonly Term[], within = 0.01): number {
  for (let k = 1; k < terms.length; k++) if (worst(points, terms, k) <= within) return k
  return terms.length - 1
}

/* ---------------------------------------------------------------- drawings to start from ------ */

export const SAMPLES = 256

const loop = (f: (t: number) => V2, n = 400): V2[] => Array.from({ length: n }, (_, i) => f(i / n))

export const PRESETS: { id: string; name: string; points: V2[] }[] = [
  {
    id: 'heart',
    name: 'Heart',
    points: loop((t) => {
      const a = 2 * Math.PI * t
      return [
        (16 * Math.sin(a) ** 3) / 18,
        (13 * Math.cos(a) - 5 * Math.cos(2 * a) - 2 * Math.cos(3 * a) - Math.cos(4 * a)) / 18,
      ]
    }),
  },
  {
    id: 'star',
    name: 'Star',
    points: Array.from({ length: 10 }, (_, i): V2 => {
      const a = Math.PI / 2 + (i * Math.PI) / 5
      const r = i % 2 ? 0.38 : 0.9
      return [r * Math.cos(a), r * Math.sin(a)]
    }),
  },
  {
    id: 'square',
    name: 'Square',
    points: [
      [-0.7, -0.7],
      [0.7, -0.7],
      [0.7, 0.7],
      [-0.7, 0.7],
    ],
  },
  {
    id: 'key',
    name: 'Key',
    points: [
      ...loop((t) => {
        // the bow: a ring, opened at its right side where the shaft joins
        const a = Math.PI * 0.15 + t * Math.PI * 1.7
        return [-0.45 + 0.35 * Math.cos(a), 0.35 * Math.sin(a)]
      }, 60),
      [-0.12, -0.08],
      [0.55, -0.08],
      [0.55, -0.3],
      [0.65, -0.3],
      [0.65, -0.08],
      [0.75, -0.08],
      [0.75, -0.24],
      [0.85, -0.24],
      [0.85, 0.08],
      [-0.12, 0.08],
    ],
  },
  {
    id: 'lissajous',
    name: 'Knot',
    points: loop((t) => {
      const a = 2 * Math.PI * t
      return [0.8 * Math.sin(3 * a), 0.8 * Math.sin(2 * a + 0.4)]
    }),
  },
]

/* ---------------------------------------------------------------- kept in this browser -------- */

export const EPICYCLES_KEY = 'lab_epicycles_v1'
export const MAX_KEPT = 16

export type Kept = { name: string; points: V2[] }

/** drawings kept here: names cut to a length, points finite and within the board, 3 to 512 of them */
export function readKept(text: string | null): Kept[] {
  try {
    const v = JSON.parse(text ?? '[]') as unknown
    if (!Array.isArray(v)) return []
    const out: Kept[] = []
    for (const d of v) {
      const name = (d as Kept)?.name
      const pts = (d as Kept)?.points
      if (typeof name !== 'string' || !Array.isArray(pts)) continue
      if (pts.length < 3 || pts.length > 512) continue
      const ok = pts.every(
        (p) =>
          Array.isArray(p) &&
          p.length === 2 &&
          p.every((c) => typeof c === 'number' && Number.isFinite(c) && Math.abs(c) <= 1.5),
      )
      if (!ok) continue
      out.push({ name: name.slice(0, 40), points: pts.map(([x, y]) => [x, y] as V2) })
      if (out.length === MAX_KEPT) break
    }
    return out
  } catch {
    return []
  }
}

/** a drawing as it is kept: 128 points, three decimals — a few kilobytes */
export const toKept = (name: string, points: readonly V2[]): Kept => ({
  name: name.slice(0, 40),
  points: resample(points, 128).map(([x, y]) => [
    Math.round(x * 1000) / 1000,
    Math.round(y * 1000) / 1000,
  ]),
})

/* ---------------------------------------------------------------- for the GPU ----------------- */

export const MAX_ARMS = 128
export const TRAIL = 512

/** the arms as circles: centre (x, y), radius, and whether it is the pen's own */
export function packArms(joints: readonly V2[]): Float32Array<ArrayBuffer> {
  const arms = Math.min(joints.length - 1, MAX_ARMS)
  const out = new Float32Array(arms * 4)
  for (let i = 0; i < arms; i++) {
    const [ax, ay] = joints[i]
    const [bx, by] = joints[i + 1]
    out.set([ax, ay, Math.hypot(bx - ax, by - ay), i === arms - 1 ? 1 : 0], i * 4)
  }
  return out
}

/** the drawing fills the shorter side of the stage with a margin: a stage point to drawing units */
export function toDrawing(stage: [number, number], p: [number, number]): V2 {
  const s = Math.min(stage[0], stage[1]) / 2.3
  return [(p[0] - stage[0] / 2) / s, (stage[1] / 2 - p[1]) / s]
}

export type Rgb = [number, number, number]

/** a polyline, closed or not, as lines for the GPU: (x0, y0, x1, y1, r, g, b, half-width) each */
export function lines(
  points: readonly V2[],
  colour: Rgb,
  width: number,
  closed: boolean,
): number[] {
  const out: number[] = []
  const n = points.length
  for (let i = 0; i + (closed ? 0 : 1) < n; i++) {
    const a = points[i]
    const b = points[(i + 1) % n]
    out.push(a[0], a[1], b[0], b[1], colour[0], colour[1], colour[2], width)
  }
  return out
}
