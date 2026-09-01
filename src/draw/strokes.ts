/**
 * A drawing, as the things you did rather than the pixels they left.
 *
 * ⚠️ STROKES, NOT A BITMAP — the same decision that made the instrument work, for the same
 * reasons. A song there is notes rather than audio; a picture here is a list of operations rather
 * than an image, and every property that made songs cheap falls out again:
 *
 *   · A drawing is a few kilobytes, so it fits in a profile block with no image hosting, no
 *     upload, no storage bill and no CDN.
 *   · Multiplayer is broadcasting the operation you just did — about eighty bytes — instead of
 *     syncing a canvas. The party channel already carries notes; strokes are the same shape.
 *   · It redraws at any size, so a thumbnail and a full-screen view come from one source.
 *   · Undo is `pop()`.
 *   · Alpha is just a number on a stroke, rather than a second image to composite.
 *
 * The honest cost is that this is not a pixel editor: there is no per-pixel eraser, no colour
 * picker sampling the canvas, no filters. FILL is the interesting exception and the reason this
 * can still feel like Paint — a fill is recorded as an OPERATION (a point and a colour) and
 * flood-filled at replay time. Replayed in order over the same starting canvas it is
 * deterministic, so it behaves like a stored pixel edit while staying a few bytes.
 *
 * ⚠️ Coordinates are 0–1, not pixels. A drawing made in a small window and shown full width has
 * to be the same drawing; storing pixels would make the canvas size part of the artwork and every
 * replay a guess about what it was drawn at.
 */

export type Tool = 'brush' | 'eraser' | 'line' | 'rect' | 'ellipse' | 'fill'

export const TOOLS: Array<[Tool, string, string]> = [
  ['brush', '🖌', 'Brush'],
  ['eraser', '🧽', 'Eraser'],
  ['line', '╱', 'Line'],
  ['rect', '▭', 'Box'],
  ['ellipse', '◯', 'Ellipse'],
  ['fill', '🪣', 'Fill'],
]

export type Stroke = {
  t: Tool
  /** css colour; ignored by the eraser */
  c: string
  /** 0–1 */
  a: number
  /** brush width as a fraction of the canvas's short side, so it scales with the picture */
  w: number
  /** flat [x, y, x, y, …] in 0–1 space — two points for line/rect/ellipse, one for fill */
  p: number[]
}

export type Drawing = {
  v: 1
  name: string
  /** the shape of the page it was made on, so a replay knows its proportions */
  ratio: number
  strokes: Stroke[]
}

const MAX_STROKES = 4000
const MAX_POINTS = 2000
const MAX_NAME = 60

const TOOL_IDS = new Set<string>(TOOLS.map(([t]) => t))

/**
 * ⚠️ Colours are matched against a strict pattern, never passed through.
 *
 * This string is written into a canvas fillStyle, and a drawing travels: it is stored on a
 * profile and replayed on a stranger's machine. Canvas is not a CSS injection surface the way
 * innerHTML is, but "we pass an arbitrary string from one person's data into another person's
 * rendering call" is a sentence worth never being true. Hex only, so the set of things it can be
 * is finite and obvious.
 */
const HEX = /^#[0-9a-f]{6}$/i
const colour = (v: unknown, fallback = '#000000') =>
  typeof v === 'string' && HEX.test(v) ? v : fallback

const num = (v: unknown, lo: number, hi: number, d: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d

/** Read a drawing from anywhere — a profile, storage, a peer. Null rather than throwing. */
export function readDrawing(v: unknown): Drawing | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  if (!Array.isArray(o.strokes)) return null
  const strokes: Stroke[] = []
  for (const raw of o.strokes.slice(0, MAX_STROKES)) {
    const s = readStroke(raw)
    if (s) strokes.push(s)
  }
  return {
    v: 1,
    name: typeof o.name === 'string' ? o.name.slice(0, MAX_NAME).trim() || 'Untitled' : 'Untitled',
    ratio: num(o.ratio, 0.2, 5, 1.5),
    strokes,
  }
}

export function readStroke(raw: unknown): Stroke | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (typeof o.t !== 'string' || !TOOL_IDS.has(o.t)) return null
  if (!Array.isArray(o.p) || o.p.length < 2) return null
  const p: number[] = []
  for (const n of o.p.slice(0, MAX_POINTS * 2)) {
    if (typeof n !== 'number' || !Number.isFinite(n)) return null
    // clamped rather than rejected: a point slightly off-canvas is a normal thing to draw
    p.push(Math.max(-0.5, Math.min(1.5, n)))
  }
  if (p.length % 2) p.pop()
  if (p.length < 2) return null
  return {
    t: o.t as Tool,
    c: colour(o.c),
    a: num(o.a, 0.02, 1, 1),
    w: num(o.w, 0.0015, 0.25, 0.01),
    p,
  }
}

/**
 * Paint one stroke onto a context sized w×h.
 *
 * ⚠️ The eraser is `destination-out`, not white. A drawing has no background of its own — it is
 * transparent, which is what lets it sit on any profile and pick up the page behind it — so
 * painting white would erase to a colour that only looks right on one theme. Alpha is the goal
 * feature and this is where it lives.
 */
export function paintStroke(ctx: CanvasRenderingContext2D, s: Stroke, w: number, h: number) {
  const short = Math.min(w, h)
  const X = (i: number) => s.p[i] * w
  const Y = (i: number) => s.p[i] * h

  ctx.save()
  ctx.globalAlpha = s.a
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.lineWidth = Math.max(0.5, s.w * short)
  ctx.strokeStyle = s.c
  ctx.fillStyle = s.c
  if (s.t === 'eraser') ctx.globalCompositeOperation = 'destination-out'

  switch (s.t) {
    case 'fill':
      floodFill(ctx, Math.round(X(0)), Math.round(Y(1)), s.c, s.a, w, h)
      break
    case 'rect': {
      const x0 = X(0)
      const y0 = Y(1)
      const x1 = X(2)
      const y1 = Y(3)
      ctx.strokeRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0))
      break
    }
    case 'ellipse': {
      const x0 = X(0)
      const y0 = Y(1)
      const x1 = X(2)
      const y1 = Y(3)
      ctx.beginPath()
      ctx.ellipse(
        (x0 + x1) / 2,
        (y0 + y1) / 2,
        Math.abs(x1 - x0) / 2,
        Math.abs(y1 - y0) / 2,
        0,
        0,
        Math.PI * 2,
      )
      ctx.stroke()
      break
    }
    default: {
      // brush, eraser and line are all a polyline; a line just happens to have two points
      ctx.beginPath()
      ctx.moveTo(X(0), Y(1))
      if (s.p.length === 2) ctx.lineTo(X(0), Y(1) + 0.01) // a single tap should leave a dot
      for (let i = 2; i + 1 < s.p.length; i += 2) ctx.lineTo(X(i), Y(i + 1))
      ctx.stroke()
    }
  }
  ctx.restore()
}

/** Replay a whole drawing onto a blank context. */
export function paintDrawing(ctx: CanvasRenderingContext2D, d: Drawing, w: number, h: number) {
  ctx.clearRect(0, 0, w, h)
  for (const s of d.strokes) paintStroke(ctx, s, w, h)
}

/**
 * The one genuinely raster operation, kept because a paint program without a fill bucket is not
 * a paint program.
 *
 * ⚠️ Scanline flood, not the four-way recursion everyone writes first. Recursing per pixel
 * overflows the stack on any real area — a 900×600 region is half a million frames deep — and the
 * naive queue-of-pixels version allocates one entry per pixel. Filling whole horizontal runs and
 * queueing only the rows above and below keeps the queue proportional to the SHAPE rather than
 * its area.
 *
 * The tolerance exists because anti-aliased edges are not exactly the colour they look; without
 * it a fill stops dead at the soft edge of a brush stroke and leaves a halo.
 */
function floodFill(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  hex: string,
  alpha: number,
  w: number,
  h: number,
) {
  const W = Math.round(w)
  const H = Math.round(h)
  if (sx < 0 || sy < 0 || sx >= W || sy >= H) return
  let img: ImageData
  try {
    img = ctx.getImageData(0, 0, W, H)
  } catch {
    return // a tainted canvas; nothing here should taint it, but a fill is not worth throwing over
  }
  const d = img.data
  const at = (x: number, y: number) => (y * W + x) * 4
  const start = at(sx, sy)
  const t0 = d[start]
  const t1 = d[start + 1]
  const t2 = d[start + 2]
  const t3 = d[start + 3]

  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  const a = Math.round(alpha * 255)
  if (t0 === r && t1 === g && t2 === b && t3 === a) return // already this colour

  const TOL = 32
  const match = (i: number) =>
    Math.abs(d[i] - t0) <= TOL &&
    Math.abs(d[i + 1] - t1) <= TOL &&
    Math.abs(d[i + 2] - t2) <= TOL &&
    Math.abs(d[i + 3] - t3) <= TOL

  const stack: Array<[number, number]> = [[sx, sy]]
  const seen = new Uint8Array(W * H)
  while (stack.length) {
    const [px, py] = stack.pop()!
    if (py < 0 || py >= H) continue
    let x0 = px
    while (x0 > 0 && !seen[py * W + (x0 - 1)] && match(at(x0 - 1, py))) x0--
    let x1 = px
    while (x1 < W - 1 && !seen[py * W + (x1 + 1)] && match(at(x1 + 1, py))) x1++
    for (let x = x0; x <= x1; x++) {
      const i = at(x, py)
      d[i] = r
      d[i + 1] = g
      d[i + 2] = b
      d[i + 3] = a
      seen[py * W + x] = 1
      for (const ny of [py - 1, py + 1]) {
        if (ny < 0 || ny >= H) continue
        if (!seen[ny * W + x] && match(at(x, ny))) stack.push([x, ny])
      }
    }
  }
  ctx.putImageData(img, 0, 0)
}
