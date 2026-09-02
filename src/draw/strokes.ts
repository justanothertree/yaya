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
  /**
   * What sits BEHIND the paint, or null for nothing.
   *
   * ⚠️ It is not a stroke, and that is the whole point. Erasing is destination-out, so a
   * background painted INTO the picture would be erased along with everything on top of it —
   * rub out a line over a black backdrop and you would punch a hole through to the page. Keeping
   * it behind the canvas means the eraser takes away paint and reveals the backdrop, which is
   * what erasing means everywhere else.
   */
  bg: string | null
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

/**
 * ⚠️ 'none' IS A COLOUR HERE, and that is the mental model rather than an implementation detail.
 *
 * Transparency was only reachable as a TOOL — the eraser — so you could erase a line but not
 * erase a region, because the fill bucket had no way to be given nothing. Making it a colour
 * means every tool gets it for free: a brush loaded with 'none' erases, a box outlines in
 * nothing, and a bucket of 'none' clears an area. Which is what you would expect if you think of
 * transparency as a paint rather than as a mode.
 */
export const NONE = 'none'

/**
 * Paint that keeps changing its mind.
 *
 * ⚠️ A COLOUR, not a tool or a mode — the same decision as NONE above, for the same reason. Every
 * tool gets it without knowing about it: a rainbow brush flows through the wheel as you draw, a
 * rainbow box is a gradient outline, a rainbow bucket picks its hue from where you clicked. A
 * "rainbow mode" flag would have to be understood separately by each of the six tools, and would
 * not survive being saved.
 *
 * ⚠️ It costs nothing in a saved file. The stroke still stores ONE short colour value, the
 * sentinel, and the actual hues are worked out at drawing time from the geometry that is already
 * there. Storing a colour per point would have been the obvious way and would have roughly
 * doubled the size of every rainbow stroke on a profile.
 */
export const RAINBOW = 'rainbow'

const colour = (v: unknown, fallback = '#000000') =>
  v === NONE || v === RAINBOW ? v : typeof v === 'string' && HEX.test(v) ? v : fallback

/** A hue on the wheel, as a css colour. `t` turns once per 1. */
const wheel = (t: number) => `hsl(${(((t * 360) % 360) + 360) % 360} 92% 58%)`

const num = (v: unknown, lo: number, hi: number, d: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d

/** Read a drawing from anywhere — a profile, storage, a peer. Null rather than throwing. */
export function readDrawing(v: unknown): Drawing | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  // ⚠️ both forms, forever — drawings kept before the compact one existed are in people's
  // galleries, and a reader that dropped them would quietly delete work
  if (o.v === 2 || Array.isArray(o.s)) return unpack(o)
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
    bg: typeof o.bg === 'string' && HEX.test(o.bg) ? o.bg : null,
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
/** A rainbow across a shape's bounding box, so a box or ellipse is not one flat hue. */
function boxWheel(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  turn: number,
): CanvasGradient {
  const g = ctx.createLinearGradient(x0, y0, x1, y1)
  const start = (x0 + y0) / turn
  for (let i = 0; i <= 6; i++) g.addColorStop(i / 6, wheel(start + i / 6))
  return g
}

export function paintStroke(ctx: CanvasRenderingContext2D, s: Stroke, w: number, h: number) {
  const short = Math.min(w, h)
  const X = (i: number) => s.p[i] * w
  const Y = (i: number) => s.p[i] * h

  /**
   * ⚠️ The eraser TOOL and the colour 'none' are the same thing, deliberately. The tool is a
   * shortcut for "brush loaded with nothing", so there is one code path for taking paint away
   * rather than two that can disagree about what erasing means.
   */
  const erasing = s.t === 'eraser' || s.c === NONE
  const rainbow = !erasing && s.c === RAINBOW
  ctx.save()
  ctx.globalAlpha = s.a
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.lineWidth = Math.max(0.5, s.w * short)
  /**
   * ⚠️ A rainbow's hue comes from DISTANCE TRAVELLED, not from how many points the stroke has.
   * Points arrive faster when you draw slowly, so counting them would make a careful line cycle
   * through the whole wheel while a quick flick of the same length barely changed colour — the
   * speed of your hand would decide the colours. One turn per 1.2 short-sides of travel means a
   * stroke looks the same however it was drawn.
   */
  const paint = rainbow ? wheel(0) : erasing ? '#000000' : s.c
  ctx.strokeStyle = paint
  ctx.fillStyle = paint
  if (erasing) ctx.globalCompositeOperation = 'destination-out'
  const TURN = short * 1.2

  switch (s.t) {
    case 'fill':
      floodFill(ctx, X(0), Y(1), erasing ? null : rainbow ? wheel((X(0) + Y(1)) / TURN) : s.c, s.a)
      break
    case 'rect': {
      const x0 = X(0)
      const y0 = Y(1)
      const x1 = X(2)
      const y1 = Y(3)
      if (rainbow) ctx.strokeStyle = boxWheel(ctx, x0, y0, x1, y1, TURN)
      ctx.strokeRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0))
      break
    }
    case 'ellipse': {
      const x0 = X(0)
      const y0 = Y(1)
      const x1 = X(2)
      const y1 = Y(3)
      if (rainbow) ctx.strokeStyle = boxWheel(ctx, x0, y0, x1, y1, TURN)
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
      if (rainbow) {
        /* segment by segment, because one path can only carry one colour — and the joins do not
           show, since round caps at this width overlap by more than a segment's length */
        let travelled = 0
        for (let i = 0; i + 3 < s.p.length; i += 2) {
          const ax = X(i)
          const ay = Y(i + 1)
          const bx = X(i + 2)
          const by = Y(i + 3)
          ctx.strokeStyle = wheel(travelled / TURN)
          ctx.beginPath()
          ctx.moveTo(ax, ay)
          ctx.lineTo(bx, by)
          ctx.stroke()
          travelled += Math.hypot(bx - ax, by - ay)
        }
        if (s.p.length === 2) {
          ctx.beginPath()
          ctx.moveTo(X(0), Y(1))
          ctx.lineTo(X(0), Y(1) + 0.01)
          ctx.stroke()
        }
        break
      }
      ctx.beginPath()
      ctx.moveTo(X(0), Y(1))
      if (s.p.length === 2) ctx.lineTo(X(0), Y(1) + 0.01) // a single tap should leave a dot
      for (let i = 2; i + 1 < s.p.length; i += 2) ctx.lineTo(X(i), Y(i + 1))
      ctx.stroke()
    }
  }
  ctx.restore()
}

/**
 * The same drawing, small enough to live in a profile block.
 *
 * ⚠️ Points become INTEGER THOUSANDTHS. A brush stroke is a list of fractions, and JSON writes
 * 0.4833333333333333 as eighteen characters of precision nobody can see — the canvas is at most a
 * couple of thousand pixels across, so a thousandth is already finer than a pixel. Measured on a
 * real doodle it is roughly a five-fold saving, which is the difference between a drawing fitting
 * on a profile and not.
 *
 * The tool becomes its index and the colour loses its hash, for the same reason: this is the same
 * picture written down more tersely, not a second format with its own meaning. It goes back out
 * through readDrawing, so a packed drawing gets exactly the same validation as any other.
 */
export type PackedDrawing = {
  v: 2
  n: string
  r: number
  /** background, hash-less hex, or 0 for none */
  b: string | 0
  /** [toolIndex, colour, alpha%, width‰, ...points‰] per stroke — 0 is none, 1 is rainbow */
  s: Array<[number, string | 0 | 1, number, number, ...number[]]>
}

const TOOL_ORDER = TOOLS.map(([t]) => t)

export function packDrawing(d: Drawing): PackedDrawing {
  return {
    v: 2,
    n: d.name,
    r: Math.round(d.ratio * 100) / 100,
    b: d.bg ? d.bg.slice(1) : 0,
    s: d.strokes.map((k) => [
      Math.max(0, TOOL_ORDER.indexOf(k.t)),
      k.c === NONE ? 0 : k.c === RAINBOW ? 1 : k.c.slice(1),
      Math.round(k.a * 100),
      Math.round(k.w * 1000),
      ...k.p.map((n) => Math.round(n * 1000)),
    ]) as PackedDrawing['s'],
  }
}

function unpack(v: Record<string, unknown>): Drawing | null {
  if (!Array.isArray(v.s)) return null
  const strokes: unknown[] = []
  for (const row of v.s.slice(0, MAX_STROKES)) {
    if (!Array.isArray(row) || row.length < 5) continue
    const [ti, c, a, w, ...pts] = row as [number, string | 0 | 1, number, number, ...number[]]
    strokes.push({
      t: TOOL_ORDER[typeof ti === 'number' ? ti : 0] ?? 'brush',
      c: c === 0 ? NONE : c === 1 ? RAINBOW : typeof c === 'string' ? `#${c}` : '#000000',
      a: typeof a === 'number' ? a / 100 : 1,
      w: typeof w === 'number' ? w / 1000 : 0.01,
      p: pts.filter((n) => typeof n === 'number').map((n) => n / 1000),
    })
  }
  return readDrawing({
    name: v.n,
    ratio: v.r,
    bg: typeof v.b === 'string' ? `#${v.b}` : null,
    strokes,
  })
}

/** Replay a whole drawing onto a blank context. */
/**
 * Replay a whole drawing onto a blank context.
 *
 * ⚠️ The BACKGROUND IS NOT PAINTED HERE. It belongs behind the canvas, or the eraser would
 * cut through it — see Drawing.bg. Anything showing a drawing puts `d.bg` behind the surface and
 * calls this on top.
 */
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
  cssX: number,
  cssY: number,
  hex: string | null,
  alpha: number,
) {
  /**
   * ⚠️ DEVICE PIXELS, NOT CSS PIXELS — and getting this wrong is why only the top-left of the
   * picture could be filled.
   *
   * The context carries a dpr transform so drawing can be written in CSS units, but getImageData
   * and putImageData ignore transforms entirely: they always address the backing store. Passing
   * the CSS width meant reading a rectangle of (1/dpr) of the canvas, so on a normal 2x screen
   * the fill only ever saw the top-left QUARTER — drawable everywhere, fillable in one corner.
   *
   * So the whole flood works in device pixels and the seed point is converted on the way in.
   */
  const W = ctx.canvas.width
  const H = ctx.canvas.height
  const t = ctx.getTransform()
  const sx = Math.round(cssX * t.a + t.e)
  const sy = Math.round(cssY * t.d + t.f)
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

  // a null colour is the bucket loaded with nothing: it clears the region instead of filling it
  const r = hex ? parseInt(hex.slice(1, 3), 16) : 0
  const g = hex ? parseInt(hex.slice(3, 5), 16) : 0
  const b = hex ? parseInt(hex.slice(5, 7), 16) : 0
  const a = hex ? Math.round(alpha * 255) : 0
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
