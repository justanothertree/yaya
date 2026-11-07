/**
 * The arithmetic of the Lab's print shop: a reduction linocut. Carve a lino block with a gouge, ink
 * it, and pull a print — then carve away more of the same block and print the next colour over the
 * first. Whatever is carved prints nothing from then on, so a reduction print is planned light to
 * dark: cut away what should stay the paper's colour, print the lightest ink, cut away what should
 * stay that colour, print the next. Strokes since the last print can be undone; strokes that have
 * been printed are in the block for good, as on a real one. And the print is the block's mirror.
 *
 * ⚠️ THE GPU CARVES AND PRINTS; THE RULES ARE HERE. `carveHeight` is what the `carve` pass does to a
 * texel of the block for one segment of a stroke, and `inkOn` what the `press` pass lays on a texel
 * of the paper — line for line, so printshop.test.ts and the GPU probe can hold the two to each other.
 */

export type V2 = [number, number]
/** the block and the paper, in texels (the print is the block's size, mirrored) */
export const BW = 480
export const BH = 360
/** a texel stands proud enough to take ink above this height (the uncarved surface is 1) */
export const SURFACE = 0.6

export type Gouge = 'v' | 'u' | 'scoop'
/** each gouge's half-width in texels, and the shape of its cut across: a V leaves sloped walls */
export const GOUGES: Record<Gouge, { r: number; label: string }> = {
  v: { r: 2.2, label: '✒️ V gouge' },
  u: { r: 5, label: '🥄 U gouge' },
  scoop: { r: 13, label: '🪣 Scoop' },
}
export const GOUGE_CODE: Record<Gouge, number> = { v: 0, u: 1, scoop: 2 }

/**
 * The block's height at a texel after one segment of a cut, from what it was: the cut's depth falls
 * off from the line across the gouge's width — straight walls of a V, a rounded U, a flat-bottomed
 * scoop — and a cut only ever lowers the block. The shader's `carve`, line for line.
 */
export function carveHeight(h: number, p: V2, a: V2, b: V2, gouge: Gouge) {
  const r = GOUGES[gouge].r
  const abx = b[0] - a[0]
  const aby = b[1] - a[1]
  const t = Math.max(
    0,
    Math.min(1, ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby) / (abx * abx + aby * aby || 1)),
  )
  const d = Math.hypot(p[0] - a[0] - abx * t, p[1] - a[1] - aby * t)
  if (d >= r) return h
  const x = d / r
  // how far up the cut's own wall is, at this distance from its line
  const wall =
    gouge === 'v'
      ? x
      : gouge === 'u'
        ? 1 - Math.sqrt(Math.max(0, 1 - x * x))
        : Math.max(0, (x - 0.8) / 0.2)
  return Math.min(h, wall)
}

/**
 * A whole cut at once: the lowest any of its segments takes the texel to. Carving is a minimum, so this
 * is the same as cutting segment by segment in any order — which is what lets the GPU carve a stroke in
 * one dispatch over its box. A single point is a dab. The shader's `carve` loop, line for line.
 */
export function carveStroke(h: number, p: V2, pts: readonly V2[], gouge: Gouge) {
  const n = Math.max(pts.length, 1)
  for (let k = 0; k < n; k++)
    h = Math.min(h, carveHeight(h, p, pts[k], pts[Math.min(k + 1, n - 1)], gouge))
  return h
}

/** the texels a cut can touch, as [x0, y0, x1, y1] inclusive and clipped to the block (or null) */
export function cutBox(pts: readonly V2[], gouge: Gouge): [number, number, number, number] | null {
  const r = GOUGES[gouge].r
  const xs = pts.map((p) => p[0])
  const ys = pts.map((p) => p[1])
  const x0 = Math.max(0, Math.floor(Math.min(...xs) - r))
  const y0 = Math.max(0, Math.floor(Math.min(...ys) - r))
  const x1 = Math.min(BW - 1, Math.ceil(Math.max(...xs) + r))
  const y1 = Math.min(BH - 1, Math.ceil(Math.max(...ys) + r))
  return pts.length && x0 <= x1 && y0 <= y1 ? [x0, y0, x1, y1] : null
}

/** a cheap repeatable noise in 0..1 for a texel and a seed: the paper's grain and the ink's roll */
export function grain(x: number, y: number, seed: number) {
  // an integer hash (as the shader's): the same bits on both sides of the bus
  let n =
    (Math.imul(x | 0, 374761393) +
      Math.imul(y | 0, 668265263) +
      Math.imul(seed | 0, 1442695041)) >>>
    0
  n = Math.imul(n ^ (n >>> 13), 1274126177) >>> 0
  n = (n ^ (n >>> 16)) >>> 0
  return n / 4294967296
}

/**
 * How much ink a texel of the paper takes from the block: the block's height at the mirrored texel
 * (a print is the block turned over), as ink takes on what stands proud, broken up a little by the
 * paper's grain — more so at light pressure. 0..1. The shader's `press`, line for line.
 */
export function inkOn(blockH: number, x: number, y: number, pressure: number, seed: number) {
  const stand = Math.max(0, Math.min(1, (blockH - SURFACE) / 0.15))
  // light pressure leaves the grain showing through: the paper's high spots only
  const g = grain(x, y, seed)
  const take = Math.max(0, Math.min(1, (pressure * 1.25 - g * 0.6) * 2))
  return stand * take
}

/** an ink laid over what is on the paper: inks are a little transparent, so the paper and the
 *  colours under them still tell (a multiply, toward the ink by how much took) */
export function layer(
  paper: [number, number, number],
  ink: [number, number, number],
  amount: number,
) {
  const a = amount * 0.92
  return paper.map((c, k) => c * (1 - a) + c * ink[k] * a) as [number, number, number]
}

/** the block texel a paper texel is printed from: the block turned over left to right */
export const mirrorX = (x: number) => BW - 1 - x

/** printing inks, light to dark as a reduction print usually goes */
export const INKS: { name: string; rgb: [number, number, number] }[] = [
  { name: 'Lemon', rgb: [0.98, 0.88, 0.35] },
  { name: 'Peach', rgb: [0.98, 0.7, 0.55] },
  { name: 'Sky', rgb: [0.55, 0.78, 0.95] },
  { name: 'Leaf', rgb: [0.45, 0.72, 0.4] },
  { name: 'Vermilion', rgb: [0.9, 0.3, 0.2] },
  { name: 'Ultramarine', rgb: [0.2, 0.3, 0.75] },
  { name: 'Plum', rgb: [0.42, 0.2, 0.42] },
  { name: 'Black', rgb: [0.12, 0.11, 0.11] },
]
export const PAPER: [number, number, number] = [0.97, 0.95, 0.9]

/* ---------------------------------------------------------------- the work, as a file ---------- */

/** a cut: which gouge, and where it went (in block texels) */
export type Cut = { g: Gouge; pts: V2[] }
/** a print pulled: which ink, how hard, and the seed of its grain */
export type Pull = { ink: number; pressure: number; seed: number }
/** the work so far, in order: cuts and pulls interleaved, which is all it takes to remake it */
export type Step = { cut: Cut } | { pull: Pull }

export const MAX_STEPS = 1000
export const MAX_POINTS = 96
export const PRINTSHOP_KEY = 'lab_printshop_v1'
/** the largest file a full block can make: 1000 cuts of 96 points at "[479.9,359.9]," is ~1.4MB */
export const FILE_LIMIT = 1_500_000

/** points of a drag closer than this on the block are one point */
export const GAP = 2

/**
 * A drag reaching `q`: if it has moved far enough, `q` joins the cut and the new piece to carve is
 * returned. Carving is a minimum, so a cut carved piece by piece as it is drawn is exactly the cut
 * replayed from its points — which is what makes a saved file print the block that was on screen.
 */
export function follow(pts: V2[], q: V2): [V2, V2] | null {
  const last = pts[pts.length - 1]
  if (Math.hypot(q[0] - last[0], q[1] - last[1]) < GAP) return null
  pts.push(q)
  return [last, q]
}

/** the steps that can still be undone: the cuts made since the last print */
export function undoable(steps: readonly Step[]) {
  let n = 0
  for (let k = steps.length - 1; k >= 0 && 'cut' in steps[k]; k--) n++
  return n
}

/** the work from a file, or why not: numbers and known names only, every count bounded */
export function readWork(text: unknown): Step[] | string {
  if (typeof text !== 'string' || text.length > FILE_LIMIT)
    return 'That file is too big to be a print.'
  let v: unknown
  try {
    v = JSON.parse(text)
  } catch {
    return 'That file is not a print (it is not JSON).'
  }
  const steps = (v as { steps?: unknown } | null)?.steps
  if (!Array.isArray(steps) || steps.length > MAX_STEPS)
    return `A print is up to ${MAX_STEPS} cuts and pulls.`
  const fin = (n: unknown, lo: number, hi: number) =>
    typeof n === 'number' && Number.isFinite(n) && n >= lo && n <= hi
  const out: Step[] = []
  for (const s of steps) {
    const o = (s ?? {}) as Record<string, unknown>
    if (o.cut && typeof o.cut === 'object') {
      const c = o.cut as Record<string, unknown>
      if (typeof c.g !== 'string' || !(c.g in GOUGES))
        return 'That file uses a gouge this shop does not have.'
      if (
        !Array.isArray(c.pts) ||
        c.pts.length < 1 ||
        c.pts.length > MAX_POINTS ||
        !c.pts.every(
          (p) =>
            Array.isArray(p) &&
            p.length === 2 &&
            fin(p[0], -20, BW + 20) &&
            fin(p[1], -20, BH + 20),
        )
      )
        return `A cut is 1 to ${MAX_POINTS} points on the block.`
      out.push({ cut: { g: c.g as Gouge, pts: (c.pts as V2[]).map((p) => [p[0], p[1]]) } })
    } else if (o.pull && typeof o.pull === 'object') {
      const p = o.pull as Record<string, unknown>
      if (
        !Number.isInteger(p.ink) ||
        !fin(p.ink, 0, INKS.length - 1) ||
        !fin(p.pressure, 0.3, 1) ||
        !Number.isInteger(p.seed) ||
        !fin(p.seed, 0, 2 ** 31)
      )
        return 'That file’s prints use an ink or a pressure this shop does not have.'
      out.push({
        pull: { ink: p.ink as number, pressure: p.pressure as number, seed: p.seed as number },
      })
    } else return 'That file holds something that is neither a cut nor a print.'
  }
  return out
}

/* ---------------------------------------------------------------- for the GPU ---------------- */

/** Hand-packed to match `struct Shop` — printshop.test.ts lays the struct out from the shader. */
export const SHOP = {
  size: 0,
  block: 8,
  seg: 16,
  gouge: 32,
  pressure: 36,
  seed: 40,
  points: 44,
  ink: 48,
  last: 64,
  bytes: 80,
} as const

export function packShop(
  p: {
    w: number
    h: number
    /** the texels the carve pass covers: `cutBox` */
    box: [number, number, number, number]
    /** how many points of the cut are in the points buffer */
    points: number
    gouge: Gouge
    pressure: number
    seed: number
    ink: [number, number, number]
    /** the last ink pulled, for the film of it left on the block's surface; alpha 0 for none */
    last: [number, number, number, number]
  },
  into = new ArrayBuffer(SHOP.bytes),
) {
  const u = new Uint32Array(into)
  const f = new Float32Array(into)
  u.set([p.w, p.h, BW, BH], 0)
  f.set(p.box, SHOP.seg / 4)
  u[SHOP.gouge / 4] = GOUGE_CODE[p.gouge]
  f[SHOP.pressure / 4] = p.pressure
  u[SHOP.seed / 4] = p.seed
  u[SHOP.points / 4] = p.points
  f.set([...p.ink, 1], SHOP.ink / 4)
  f.set(p.last, SHOP.last / 4)
  return into
}

/**
 * Where the block and the print sit on a stage: side by side on a wide one (block left), one above
 * the other on a tall one (block on top), each as big as fits with a margin. Returns each one's
 * top-left and its scale in pixels a texel. The shader's `layout`, line for line.
 */
export function layout(size: V2) {
  const [w, h] = size
  const tall = h > w * 1.05
  const cellW = tall ? w : w / 2
  const cellH = tall ? h / 2 : h
  const s = Math.min((cellW * 0.92) / BW, (cellH * 0.92) / BH)
  const place = (k: number): V2 => {
    const cx = tall ? w / 2 : cellW * (k + 0.5)
    const cy = tall ? cellH * (k + 0.5) : h / 2
    return [cx - (BW * s) / 2, cy - (BH * s) / 2]
  }
  return { tall, s, block: place(0), print: place(1) }
}

/** a point of the stage to a texel of the block, or null if it is not on the block */
export function blockAt(size: V2, p: V2): V2 | null {
  const { s, block } = layout(size)
  const x = (p[0] - block[0]) / s
  const y = (p[1] - block[1]) / s
  return x >= -4 && y >= -4 && x <= BW + 4 && y <= BH + 4 ? [x, y] : null
}
