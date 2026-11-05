/**
 * The arithmetic of the Lab's jelly picture: grab it anywhere with any number of fingers and it
 * stretches and turns as if it were jelly, pinned where you have pinned it, and springs back with a
 * wobble when you let go.
 *
 * ⚠️ EVERY POINT OF THE PICTURE WORKS OUT ITS OWN BEST MOVE. This is moving-least-squares image
 * deformation (Schaefer, McPhail & Warren, 2006). The handles are pairs — where a point of the
 * picture was (p) and where it is being held (q). For each point v of the mesh, the handles are
 * weighted by how near they are to v (1/|p − v|²), and v takes the single transformation that best
 * carries the weighted p's onto their q's — a pure ROTATION in Rigid (so nothing shears; it bends
 * like rubber), or any linear map in Stretchy (so it smears like dough). Near a handle that
 * handle dominates and the point goes where it is held; between handles the picture bends smoothly.
 * mls.wgsl does this for every vertex in a compute pass; `deform` is the same sum, and
 * squish.test.ts holds it to the method's own promises.
 */

/** Hand-packed to match `struct Squish` — squish.test.ts lays the struct out from the shader. */
export const SQUISH = {
  size: 0,
  grid: 8,
  image: 16,
  handles: 24,
  mode: 28,
  pins: 32,
  bytes: 40,
} as const

/** the mesh's vertices across and down */
export const GRID = [97, 65] as const
export const MAX_HANDLES = 24
/** weights fall off as 1/d^(2·ALPHA); 1 is the paper's usual choice */
export const ALPHA = 1

export const MODES = { rigid: 'Rigid', stretchy: 'Stretchy' } as const
export type Mode = keyof typeof MODES
export const MODE_ID: Record<Mode, number> = { rigid: 0, stretchy: 1 }

type V2 = readonly [number, number]
export type Handle = { p: V2; q: V2 }

/**
 * Where point v goes, and the linear part of its move (a, b, c, d: x' = a·x + b·y, y' = c·x + d·y
 * about the centroid) — mirrored in squish.wgsl's `deform`.
 */
export function deform(
  v: V2,
  handles: readonly Handle[],
  mode: Mode,
): { at: [number, number]; m: [number, number, number, number] } {
  if (handles.length === 0) return { at: [v[0], v[1]], m: [1, 0, 0, 1] }
  let sw = 0
  let px = 0
  let py = 0
  let qx = 0
  let qy = 0
  const w: number[] = []
  for (const h of handles) {
    const d2 = (h.p[0] - v[0]) ** 2 + (h.p[1] - v[1]) ** 2
    /* a point exactly on a handle goes exactly where it is held */
    if (d2 < 1e-12) return { at: [h.q[0], h.q[1]], m: [1, 0, 0, 1] }
    const wi = 1 / d2 ** ALPHA
    w.push(wi)
    sw += wi
    px += wi * h.p[0]
    py += wi * h.p[1]
    qx += wi * h.q[0]
    qy += wi * h.q[1]
  }
  px /= sw
  py /= sw
  qx /= sw
  qy /= sw
  if (handles.length === 1) return { at: [v[0] + qx - px, v[1] + qy - py], m: [1, 0, 0, 1] }
  if (mode === 'stretchy') {
    // affine: M = (Σ w p̂ᵀp̂)⁻¹ Σ w p̂ᵀq̂, with p̂, q̂ the offsets from the centroids
    let a11 = 0
    let a12 = 0
    let a22 = 0
    let b11 = 0
    let b12 = 0
    let b21 = 0
    let b22 = 0
    handles.forEach((h, i) => {
      const ux = h.p[0] - px
      const uy = h.p[1] - py
      const sx = h.q[0] - qx
      const sy = h.q[1] - qy
      a11 += w[i] * ux * ux
      a12 += w[i] * ux * uy
      a22 += w[i] * uy * uy
      b11 += w[i] * ux * sx
      b12 += w[i] * ux * sy
      b21 += w[i] * uy * sx
      b22 += w[i] * uy * sy
    })
    const det = a11 * a22 - a12 * a12
    if (Math.abs(det) < 1e-9) return { at: [v[0] + qx - px, v[1] + qy - py], m: [1, 0, 0, 1] }
    // row-vector convention: [x' y'] = [x y]·M, so M = A⁻¹B
    const i11 = a22 / det
    const i12 = -a12 / det
    const i22 = a11 / det
    const m11 = i11 * b11 + i12 * b21
    const m12 = i11 * b12 + i12 * b22
    const m21 = i12 * b11 + i22 * b21
    const m22 = i12 * b12 + i22 * b22
    const dx = v[0] - px
    const dy = v[1] - py
    return { at: [dx * m11 + dy * m21 + qx, dx * m12 + dy * m22 + qy], m: [m11, m21, m12, m22] }
  }
  // rigid: the best rotation is the angle of Σ w (p̂·q̂, p̂×q̂)
  let dot = 0
  let crs = 0
  handles.forEach((h, i) => {
    const ux = h.p[0] - px
    const uy = h.p[1] - py
    const sx = h.q[0] - qx
    const sy = h.q[1] - qy
    dot += w[i] * (ux * sx + uy * sy)
    crs += w[i] * (ux * sy - uy * sx)
  })
  const l = Math.hypot(dot, crs)
  const c = l > 1e-12 ? dot / l : 1
  const s = l > 1e-12 ? crs / l : 0
  const dx = v[0] - px
  const dy = v[1] - py
  return { at: [c * dx - s * dy + qx, s * dx + c * dy + qy], m: [c, -s, s, c] }
}

/**
 * A let-go handle springs back to where it came from, overshooting and wobbling: a damped spring,
 * stepped exactly (not Euler — a jelly that gains energy on a slow frame wobbles for ever).
 */
export const SPRING = { omega: 14, zeta: 0.18 }

export function springStep(
  x: number,
  v: number,
  dt: number,
  { omega, zeta } = SPRING,
): [number, number] {
  // the exact solution of x'' + 2ζωx' + ω²x = 0 over dt, underdamped
  const wd = omega * Math.sqrt(1 - zeta * zeta)
  const e = Math.exp(-zeta * omega * dt)
  const c = Math.cos(wd * dt)
  const s = Math.sin(wd * dt)
  const a = x
  const b = (v + zeta * omega * x) / wd
  const nx = e * (a * c + b * s)
  const nv = e * (-zeta * omega * (a * c + b * s) + (-a * wd * s + b * wd * c))
  return [nx, nv]
}

/** the note a let-go wobble plays: a big stretch low, a little one high */
export function boingNote(stretch: number): number {
  const steps = [0, 3, 5, 7, 10, 12, 15]
  const k = Math.round(Math.max(0, Math.min(1, 1 - stretch / 0.5)) * (steps.length - 1))
  return 55 + steps[k]
}

export type SquishFrame = {
  w: number
  h: number
  image: readonly [number, number]
  handles: readonly Handle[]
  pins: number
  mode: Mode
}

export function packSquish(p: SquishFrame, into = new ArrayBuffer(SQUISH.bytes)) {
  const u = new Uint32Array(into)
  u[0] = p.w
  u[1] = p.h
  u[SQUISH.grid / 4] = GRID[0]
  u[SQUISH.grid / 4 + 1] = GRID[1]
  u[SQUISH.image / 4] = p.image[0]
  u[SQUISH.image / 4 + 1] = p.image[1]
  u[SQUISH.handles / 4] = Math.min(p.handles.length, MAX_HANDLES)
  u[SQUISH.mode / 4] = MODE_ID[p.mode]
  u[SQUISH.pins / 4] = p.pins
  return into
}

export function packHandles(handles: readonly Handle[]): Float32Array<ArrayBuffer> {
  const f = new Float32Array(MAX_HANDLES * 4)
  handles.slice(0, MAX_HANDLES).forEach((h, i) => f.set([h.p[0], h.p[1], h.q[0], h.q[1]], i * 4))
  return f
}

/**
 * The picture it starts with, painted in code: a round, cheerful jelly face on a checked
 * tablecloth — the checks show every bend, and a face is what everyone wants to squish.
 */
export function paintFace(w: number, h: number): OffscreenCanvas {
  const c = new OffscreenCanvas(w, h)
  const g = c.getContext('2d')
  if (!g) return c
  const cell = Math.round(Math.min(w, h) / 12)
  for (let y = 0; y < h; y += cell)
    for (let x = 0; x < w; x += cell) {
      g.fillStyle = ((x + y) / cell) % 2 === 0 ? '#f6d7e6' : '#fff4f8'
      g.fillRect(x, y, cell, cell)
    }
  const cx = w / 2
  const cy = h * 0.54
  const r = Math.min(w, h) * 0.36
  // the jelly: a glossy dome
  const body = g.createRadialGradient(cx - r * 0.3, cy - r * 0.4, r * 0.1, cx, cy, r)
  body.addColorStop(0, '#9ff2c9')
  body.addColorStop(0.6, '#3fcf8e')
  body.addColorStop(1, '#1e8f62')
  g.fillStyle = body
  g.beginPath()
  g.ellipse(cx, cy, r, r * 0.92, 0, 0, Math.PI * 2)
  g.fill()
  // eyes, with a shine
  for (const side of [-1, 1]) {
    const ex = cx + side * r * 0.36
    const ey = cy - r * 0.15
    g.fillStyle = '#ffffff'
    g.beginPath()
    g.ellipse(ex, ey, r * 0.2, r * 0.24, 0, 0, Math.PI * 2)
    g.fill()
    g.fillStyle = '#1c2033'
    g.beginPath()
    g.arc(ex + side * r * 0.03, ey + r * 0.04, r * 0.11, 0, Math.PI * 2)
    g.fill()
    g.fillStyle = '#ffffff'
    g.beginPath()
    g.arc(ex - r * 0.03, ey - r * 0.03, r * 0.035, 0, Math.PI * 2)
    g.fill()
    // a pink cheek
    g.fillStyle = 'rgba(255,120,150,0.55)'
    g.beginPath()
    g.ellipse(cx + side * r * 0.55, cy + r * 0.2, r * 0.13, r * 0.08, 0, 0, Math.PI * 2)
    g.fill()
  }
  // a smile
  g.strokeStyle = '#1c2033'
  g.lineWidth = r * 0.06
  g.lineCap = 'round'
  g.beginPath()
  g.arc(cx, cy + r * 0.12, r * 0.28, Math.PI * 0.15, Math.PI * 0.85)
  g.stroke()
  // the gloss
  g.fillStyle = 'rgba(255,255,255,0.45)'
  g.beginPath()
  g.ellipse(cx - r * 0.45, cy - r * 0.55, r * 0.18, r * 0.08, -0.6, 0, Math.PI * 2)
  g.fill()
  return c
}

/**
 * The point of the unbent picture that the bent one shows at `s`: the inverse of `deform`, by
 * Newton's method with the bend's own 2×2 Jacobian (taken by differences). Needed when a finger
 * lands on jelly that is already bent — it must take hold of what is under it, not of what would
 * be there at rest. ⚠️ First a plain fixed-point iteration, p += s − f(p): that only converges
 * while the bend is nearly a slide, and with a twist in it squish.test.ts found it 15 pixels out.
 */
export function restUnder(
  s: V2,
  handles: readonly Handle[],
  mode: Mode,
  steps = 8,
): [number, number] {
  let p: [number, number] = [s[0], s[1]]
  const f = (x: number, y: number) => deform([x, y], handles, mode).at
  for (let k = 0; k < steps; k++) {
    const at = f(p[0], p[1])
    const rx = s[0] - at[0]
    const ry = s[1] - at[1]
    if (Math.hypot(rx, ry) < 1e-4) break
    const e = 0.5
    const fx = f(p[0] + e, p[1])
    const fy = f(p[0], p[1] + e)
    const a = (fx[0] - at[0]) / e
    const b = (fy[0] - at[0]) / e
    const c = (fx[1] - at[1]) / e
    const d = (fy[1] - at[1]) / e
    const det = a * d - b * c
    if (Math.abs(det) < 1e-9) break
    p = [p[0] + (d * rx - b * ry) / det, p[1] + (-c * rx + a * ry) / det]
  }
  return p
}

/** how far into the picture a point of the canvas is, through the shader's fit (`to_clip`) */
export function canvasToImage(
  x: number,
  y: number,
  canvas: readonly [number, number],
  image: readonly [number, number],
): [number, number] {
  const scale = Math.min(canvas[0] / image[0], canvas[1] / image[1]) * FIT
  return [(x - canvas[0] / 2) / scale + image[0] / 2, (y - canvas[1] / 2) / scale + image[1] / 2]
}
/** how much of the canvas the picture fills at rest — mirrored in squish.wgsl */
export const FIT = 0.78
