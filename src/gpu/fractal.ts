/**
 * The arithmetic of the Lab's fractal: the view, the reference orbit, and the pinch.
 *
 * ⚠️ WHY A REFERENCE ORBIT. A GPU's f32 has 24 bits, so two neighbouring pixels stop being two
 * different numbers once the view is about 10⁻⁵ wide — the picture turns to blocks. PERTURBATION
 * gets round it: one point (the view's centre) is iterated here in f64, and each pixel iterates
 * only its small DIFFERENCE from that orbit on the GPU, δ ← 2Zδ + δ² + δc. The difference is tiny
 * but f32 keeps its exponent, so a tiny difference is still a precise one. The limit becomes the
 * centre's own precision, f64, about 10⁻¹³ — eight orders of magnitude deeper than f32.
 * When the reference orbit escapes or a pixel strays too close to zero relative to it, the pixel
 * REBASES (Zhuoran's method): it folds the reference into its own difference and starts again at
 * the reference's beginning, which is what keeps the picture free of the "glitches" older
 * perturbation renderers had to patch.
 */

/** Hand-packed to match `struct Fractal` — fractal.test.ts lays the struct out from the shader. */
export const FRACTAL = {
  size: 0,
  scale: 8,
  maxIter: 12,
  refLen: 16,
  julia: 20,
  time: 24,
  palette: 28,
  cycle: 32,
  block: 36,
  bytes: 40,
} as const

/** the shader's bailout, as |z|²: well past 4, so the smooth colouring has room */
export const BAILOUT = 256

/** What is on screen: the complex number at the canvas's centre, and how much one pixel spans. */
export type View = { cx: number; cy: number; scale: number }
/** what the Mandelbrot set looks like from far enough away to see all of it */
export const HOME = (w: number, h: number): View => ({
  cx: -0.6,
  cy: 0,
  scale: 3.2 / Math.min(w, h),
})
/** past this, the centre itself (an f64) cannot say where neighbouring pixels are */
export const DEEPEST = 1e-15

/** The complex number under a pixel; y grows downward on screen and upward in the plane. */
export function at(v: View, px: number, py: number, w: number, h: number): [number, number] {
  return [v.cx + (px - w / 2) * v.scale, v.cy - (py - h / 2) * v.scale]
}

const clampScale = (s: number) => Math.max(DEEPEST, Math.min(s, 0.05))

/** Zoom by `factor` (2 = in, twice as close) keeping the point under (px, py) where it is. */
export function zoomAt(
  v: View,
  px: number,
  py: number,
  factor: number,
  w: number,
  h: number,
): View {
  const [x, y] = at(v, px, py, w, h)
  const scale = clampScale(v.scale / factor)
  return { cx: x - (px - w / 2) * scale, cy: y + (py - h / 2) * scale, scale }
}

/** Drag the plane by (dx, dy) screen pixels: what was under the finger stays under it. */
export const pan = (v: View, dx: number, dy: number): View => ({
  cx: v.cx - dx * v.scale,
  cy: v.cy + dy * v.scale,
  scale: v.scale,
})

type P = readonly [number, number]

/**
 * Two fingers moved from a1, b1 to a2, b2. The plane stretches by how much further apart they are
 * and follows their midpoint — so the point under each finger stays under it, as a photo does.
 */
export function pinch(v: View, a1: P, b1: P, a2: P, b2: P, w: number, h: number): View {
  const d1 = Math.hypot(b1[0] - a1[0], b1[1] - a1[1])
  const d2 = Math.hypot(b2[0] - a2[0], b2[1] - a2[1])
  if (d1 < 1 || d2 < 1) return v
  const m1: P = [(a1[0] + b1[0]) / 2, (a1[1] + b1[1]) / 2]
  const m2: P = [(a2[0] + b2[0]) / 2, (a2[1] + b2[1]) / 2]
  const [x, y] = at(v, m1[0], m1[1], w, h)
  const scale = clampScale((v.scale * d1) / d2)
  return { cx: x - (m2[0] - w / 2) * scale, cy: y + (m2[1] - h / 2) * scale, scale }
}

/** the most iterations any view asks for; the orbit buffer is made this long once */
export const MAX_ITER = 4000
/** iterations enough for the detail at this depth: more the deeper you go */
export const itersFor = (v: View, w: number) =>
  Math.round(Math.min(MAX_ITER, 250 + 280 * Math.max(0, Math.log10(3 / (v.scale * w)))))

/**
 * The reference orbit, in f64, packed as f32 pairs for the GPU: Z₀ = 0 (Mandelbrot, c the centre)
 * or Z₀ the centre (Julia, c fixed). Stops where it escapes — a pixel that outlives it rebases.
 * The ORBIT's values never exceed 2 before it stops, so f32 holds them well; it is the CENTRE
 * that needs f64, and it is used here, never sent.
 */
export function referenceOrbit(v: View, maxIter: number, julia: P | null): Float32Array {
  const out = new Float32Array((maxIter + 1) * 2)
  let x = julia ? v.cx : 0
  let y = julia ? v.cy : 0
  const cx = julia ? julia[0] : v.cx
  const cy = julia ? julia[1] : v.cy
  let n = 0
  for (; n <= maxIter; n++) {
    out[n * 2] = x
    out[n * 2 + 1] = y
    if (x * x + y * y > 4) {
      n++
      break
    }
    const nx = x * x - y * y + cx
    y = 2 * x * y + cy
    x = nx
  }
  return out.subarray(0, Math.min(n, maxIter + 1) * 2)
}

/**
 * The truth, for testing: plain escape-time in f64 at one pixel, with the same bailout and the
 * same smooth count as the shader. -1 for a point that never escapes.
 */
export function escapeF64(
  v: View,
  px: number,
  py: number,
  w: number,
  h: number,
  maxIter: number,
  julia: P | null,
) {
  const [px0, py0] = at(v, px, py, w, h)
  let x = julia ? px0 : 0
  let y = julia ? py0 : 0
  const cx = julia ? julia[0] : px0
  const cy = julia ? julia[1] : py0
  for (let n = 0; n < maxIter; n++) {
    const r2 = x * x + y * y
    if (r2 > BAILOUT) return n + 1 - Math.log2(Math.log2(r2) / 2)
    const nx = x * x - y * y + cx
    y = 2 * x * y + cy
    x = nx
  }
  return -1
}

/**
 * Where a dive should head next: of a coarse grid over the middle of the view, the point that
 * escapes LATEST — the one nearest the set's edge, which is where the detail is. Points that never
 * escape are passed over (inside is a flat black), so a dive keeps to the boundary however deep it
 * goes, rather than needing coordinates somebody wrote down. Worked in f64, as the truth is.
 */
export function diveTarget(
  v: View,
  w: number,
  h: number,
  julia: readonly [number, number] | null,
  grid = 15,
): [number, number] {
  const iters = itersFor(v, w)
  let best = -1
  let at0: [number, number] = [v.cx, v.cy]
  for (let j = 0; j < grid; j++)
    for (let i = 0; i < grid; i++) {
      // the middle 60% of the view, so the next target is always somewhere already on screen
      const px = w * (0.2 + (0.6 * (i + 0.5)) / grid)
      const py = h * (0.2 + (0.6 * (j + 0.5)) / grid)
      const n = escapeF64(v, px, py, w, h, iters, julia)
      if (n > best) {
        best = n
        at0 = at(v, px, py, w, h)
      }
    }
  return at0
}

/** a dive's pace: twice as close every this many seconds */
export const DIVE_DOUBLING = 0.7
/** and where it turns round and comes back up */
export const DIVE_FLOOR = 1e-13

/** how deep, as a word a person reads: ×40, ×3,000, ×2 million, ×10¹² */
export function depthLabel(zoom: number) {
  if (zoom < 1e4) return `×${Math.round(zoom).toLocaleString('en-GB')}`
  if (zoom < 1e9) return `×${(zoom / 1e6).toPrecision(2)} million`
  const e = Math.floor(Math.log10(zoom))
  const sup = String(e).replace(/\d/g, (d) => '⁰¹²³⁴⁵⁶⁷⁸⁹'[Number(d)])
  return `×10${sup}`
}

/** colour schemes: the shader's cosine palettes, by index */
export const PALETTES = { ember: 'Ember', ocean: 'Ocean', candy: 'Candy', mono: 'Mono' } as const
export type FractalPalette = keyof typeof PALETTES
export const PALETTE_IDS = Object.keys(PALETTES) as FractalPalette[]

export type FractalFrame = {
  w: number
  h: number
  scale: number
  maxIter: number
  refLen: number
  julia: boolean
  time: number
  palette: FractalPalette
  cycle: number
  /** 2 while the view is moving: a quarter of the work, a little blurrier, never late */
  block: 1 | 2
}

export function packFractal(p: FractalFrame, into = new ArrayBuffer(FRACTAL.bytes)) {
  const f = new Float32Array(into)
  const u = new Uint32Array(into)
  u[FRACTAL.size / 4] = p.w
  u[FRACTAL.size / 4 + 1] = p.h
  f[FRACTAL.scale / 4] = p.scale
  u[FRACTAL.maxIter / 4] = p.maxIter
  u[FRACTAL.refLen / 4] = p.refLen
  u[FRACTAL.julia / 4] = p.julia ? 1 : 0
  f[FRACTAL.time / 4] = p.time
  u[FRACTAL.palette / 4] = PALETTE_IDS.indexOf(p.palette)
  f[FRACTAL.cycle / 4] = p.cycle
  u[FRACTAL.block / 4] = p.block
  return into
}
