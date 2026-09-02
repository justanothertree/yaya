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

export type Tool =
  | 'brush'
  | 'eraser'
  | 'line'
  | 'rect'
  | 'ellipse'
  | 'fill'
  | 'spray'
  | 'marker'
  | 'nib'
  | 'pencil'
  | 'star'
  | 'arrow'
  | 'crayon'
  | 'neon'
  | 'triangle'

export const TOOLS: Array<[Tool, string, string]> = [
  ['brush', '🖌', 'Brush'],
  ['eraser', '🧽', 'Eraser'],
  ['line', '╱', 'Line'],
  ['rect', '▭', 'Box'],
  ['ellipse', '◯', 'Ellipse'],
  ['fill', '🪣', 'Fill'],
  ['spray', '💨', 'Spray'],
  ['marker', '🖍', 'Marker'],
  ['nib', '✒', 'Nib'],
  ['pencil', '✏', 'Pencil'],
  ['star', '⭐', 'Star'],
  ['arrow', '↗', 'Arrow'],
  ['crayon', '🖤', 'Crayon'],
  ['neon', '💡', 'Neon'],
  ['triangle', '△', 'Triangle'],
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

/**
 * A repeatable 0–1 from a number — the spray's stand-in for randomness.
 *
 * ⚠️ Deterministic on purpose: see the spray tool. Same input, same speckle, forever.
 */
const noise = (n: number) => {
  const x = Math.sin(n * 12.9898) * 43758.5453
  return x - Math.floor(x)
}

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
    /**
     * Spray — an airbrush: dots scattered around the path rather than a solid line.
     *
     * ⚠️ THE SCATTER IS DERIVED, NOT RANDOM. Math.random() here would be a different
     * picture every time the drawing was replayed — and drawings ARE replayed, on every resize,
     * every reload, and on someone else's profile. The whole promise of keeping strokes instead
     * of pixels is that redrawing gives you back the same picture, and one Math.random() in this
     * function would quietly break it. Hashing the point index gives the same speckle forever.
     */
    case 'spray': {
      const R = Math.max(1, s.w * short) * 1.7
      const dots = 5
      ctx.lineWidth = 1
      for (let i = 0; i + 1 < s.p.length; i += 2) {
        const cx = X(i)
        const cy = Y(i + 1)
        for (let k = 0; k < dots; k++) {
          const seed = i * 7.13 + k * 3.71
          const a = noise(seed) * Math.PI * 2
          const d = Math.sqrt(noise(seed + 1.7)) * R
          const r = 0.6 + noise(seed + 3.3) * (R * 0.16)
          if (rainbow) ctx.fillStyle = wheel(((i / 2) * 8) / TURN)
          ctx.beginPath()
          ctx.arc(cx + Math.cos(a) * d, cy + Math.sin(a) * d, r, 0, Math.PI * 2)
          ctx.fill()
        }
      }
      break
    }
    /**
     * Marker — broad, flat-ended and translucent, so crossing your own line shows.
     *
     * ⚠️ butt caps and a miter join, which is the whole difference from Brush. Round caps
     * make a pen; a chisel tip makes a marker, and the corners are where you see it.
     */
    case 'marker': {
      ctx.lineCap = 'butt'
      ctx.lineJoin = 'miter'
      ctx.lineWidth = Math.max(1, s.w * short) * 2.2
      ctx.globalAlpha = s.a * 0.55
      ctx.beginPath()
      ctx.moveTo(X(0), Y(1))
      if (s.p.length === 2) ctx.lineTo(X(0), Y(1) + 0.01)
      for (let i = 2; i + 1 < s.p.length; i += 2) ctx.lineTo(X(i), Y(i + 1))
      ctx.stroke()
      break
    }
    /**
     * Nib — a calligraphy pen: the line thickens and thins with the DIRECTION you draw.
     *
     * ⚠️ width comes from the angle between the stroke and a fixed nib, so the same gesture
     * drawn sideways is fat and drawn along the nib is hairline. That is what makes handwriting
     * with it look written rather than traced, and it is the only tool here whose thickness is not
     * a setting.
     */
    case 'nib': {
      const NIB = -Math.PI / 4
      const wide = Math.max(1, s.w * short) * 2.4
      ctx.lineCap = 'butt'
      for (let i = 0; i + 3 < s.p.length; i += 2) {
        const ax = X(i)
        const ay = Y(i + 1)
        const bx = X(i + 2)
        const by = Y(i + 3)
        const angle = Math.atan2(by - ay, bx - ax)
        ctx.lineWidth = Math.max(0.4, wide * (0.12 + 0.88 * Math.abs(Math.sin(angle - NIB))))
        if (rainbow) ctx.strokeStyle = wheel(((i / 2) * 6) / TURN)
        ctx.beginPath()
        ctx.moveTo(ax, ay)
        ctx.lineTo(bx, by)
        ctx.stroke()
      }
      break
    }
    /**
     * Pencil — thin, hard-edged, and very slightly unsteady.
     *
     * ⚠️ the wobble is DERIVED from the point index, like the spray's scatter, so the same
     * line redraws identically forever. It is tiny on purpose — a fraction of the line width —
     * because the point is to take the mechanical perfection off a stroke, not to make it look
     * drawn by someone unwell.
     */
    case 'pencil': {
      ctx.lineWidth = Math.max(0.4, s.w * short * 0.45)
      ctx.lineCap = 'round'
      ctx.beginPath()
      for (let i = 0; i + 1 < s.p.length; i += 2) {
        const j = noise(i * 2.17) - 0.5
        const k = noise(i * 3.91) - 0.5
        const x = X(i) + j * ctx.lineWidth * 1.6
        const y = Y(i + 1) + k * ctx.lineWidth * 1.6
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      if (s.p.length === 2) ctx.lineTo(X(0), Y(1) + 0.01)
      ctx.stroke()
      break
    }
    /**
     * Star — dragged from its centre outward, so the drag sets both size AND rotation.
     *
     * ⚠️ a shape tool, which means two points and not a path. Its second point is the tip of
     * one arm rather than an opposite corner, because a star has no meaningful bounding box to
     * drag — the gesture that makes sense for it is "how big, and which way up".
     */
    case 'star': {
      const cx = X(0)
      const cy = Y(1)
      const rx = X(2) - cx
      const ry = Y(3) - cy
      const R = Math.hypot(rx, ry)
      if (R < 0.5) break
      const rot = Math.atan2(ry, rx)
      const POINTS = 5
      ctx.beginPath()
      for (let i = 0; i < POINTS * 2; i++) {
        const r = i % 2 === 0 ? R : R * 0.42
        const a = rot + (i / (POINTS * 2)) * Math.PI * 2
        const x = cx + Math.cos(a) * r
        const y = cy + Math.sin(a) * r
        if (i === 0) ctx.moveTo(x, y)
        else ctx.lineTo(x, y)
      }
      ctx.closePath()
      ctx.stroke()
      break
    }
    /**
     * Arrow — drag from tail to head, and the head is drawn in proportion to the shaft.
     *
     * ⚠️ the head scales with the LENGTH, not with the brush size. A fixed head on a long
     * arrow looks like a pin, and on a short one it swallows the whole shape; tying it to the
     * distance dragged is what keeps a two-inch arrow and a two-pixel one recognisably the same
     * object.
     */
    case 'arrow': {
      const x0 = X(0)
      const y0 = Y(1)
      const x1 = X(2)
      const y1 = Y(3)
      const len = Math.hypot(x1 - x0, y1 - y0)
      if (len < 0.5) break
      const a = Math.atan2(y1 - y0, x1 - x0)
      const head = Math.min(len * 0.32, Math.max(6, s.w * short * 4))
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      ctx.beginPath()
      ctx.moveTo(x0, y0)
      ctx.lineTo(x1, y1)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(x1, y1)
      ctx.lineTo(x1 - Math.cos(a - 0.42) * head, y1 - Math.sin(a - 0.42) * head)
      ctx.moveTo(x1, y1)
      ctx.lineTo(x1 - Math.cos(a + 0.42) * head, y1 - Math.sin(a + 0.42) * head)
      ctx.stroke()
      break
    }
    /**
     * Crayon — waxy and broken up, laid down in several offset passes.
     *
     * ⚠️ the gaps are the point, and they are DERIVED, not random. A crayon skips where the
     * paper is high, so three passes at slightly different offsets with a few segments dropped
     * gives the same broken coverage — and deriving the pattern from the point index means the
     * same stroke breaks up in the same places every time it is redrawn.
     */
    case 'crayon': {
      const base = Math.max(1, s.w * short)
      ctx.lineCap = 'round'
      ctx.globalAlpha = s.a * 0.5
      for (let pass = 0; pass < 3; pass++) {
        ctx.lineWidth = base * (0.9 - pass * 0.22)
        const ox = (noise(pass * 9.1) - 0.5) * base * 0.7
        const oy = (noise(pass * 5.7) - 0.5) * base * 0.7
        let drawing = false
        ctx.beginPath()
        for (let i = 0; i + 1 < s.p.length; i += 2) {
          /* a skipped segment is where the wax did not take */
          if (noise(i * 1.7 + pass * 31) < 0.22) {
            drawing = false
            continue
          }
          const x = X(i) + ox
          const y = Y(i + 1) + oy
          if (!drawing) {
            ctx.moveTo(x, y)
            drawing = true
          } else ctx.lineTo(x, y)
        }
        if (s.p.length === 2) {
          ctx.moveTo(X(0) + ox, Y(1) + oy)
          ctx.lineTo(X(0) + ox, Y(1) + oy + 0.01)
        }
        ctx.stroke()
      }
      break
    }
    /**
     * Neon — a wide soft halo with a bright thin core down the middle.
     *
     * ⚠️ two passes of the SAME path, not a blur. Canvas shadow blur is expensive and gets
     * baked into the saved picture at whatever size it was drawn; stroking the path twice — fat
     * and faint, then thin and bright — costs two strokes and scales with the drawing, which is
     * the whole reason this format keeps strokes instead of pixels.
     */
    case 'neon': {
      const base = Math.max(1, s.w * short)
      ctx.lineCap = 'round'
      ctx.lineJoin = 'round'
      const path = () => {
        ctx.beginPath()
        ctx.moveTo(X(0), Y(1))
        if (s.p.length === 2) ctx.lineTo(X(0), Y(1) + 0.01)
        for (let i = 2; i + 1 < s.p.length; i += 2) ctx.lineTo(X(i), Y(i + 1))
      }
      ctx.globalAlpha = s.a * 0.22
      ctx.lineWidth = base * 3
      path()
      ctx.stroke()
      ctx.globalAlpha = s.a
      ctx.lineWidth = Math.max(0.6, base * 0.45)
      ctx.strokeStyle = rainbow ? wheel(0.5) : '#ffffff'
      path()
      ctx.stroke()
      break
    }
    /**
     * Triangle — drawn into the box you drag, like Box and Ellipse.
     *
     * ⚠️ it shares the two-corner gesture rather than Star's centre-and-tip one, because a
     * triangle HAS a sensible bounding box and a star does not. Matching the tool beside it is
     * worth more than being clever about it.
     */
    case 'triangle': {
      const x0 = X(0)
      const y0 = Y(1)
      const x1 = X(2)
      const y1 = Y(3)
      const l = Math.min(x0, x1)
      const r = Math.max(x0, x1)
      const t = Math.min(y0, y1)
      const b = Math.max(y0, y1)
      ctx.lineJoin = 'round'
      ctx.beginPath()
      ctx.moveTo((l + r) / 2, t)
      ctx.lineTo(r, b)
      ctx.lineTo(l, b)
      ctx.closePath()
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

/**
 * The tools you DRAG to draw a path, as opposed to those taking two corners or a single point.
 *
 * ⚠️ One definition, because the paint room asks this twice — once to decide what a new stroke
 * starts as, and again on every pointer move to decide whether to append a point or move a
 * corner. Those were two hand-written lists of the same two tools, and adding a third to one but
 * not the other gives you a brush that draws one straight line from where you pressed: it looks
 * like the tool is broken rather than like a list is out of date.
 */
export const isFreehand = (t: Tool) =>
  t === 'brush' ||
  t === 'eraser' ||
  t === 'spray' ||
  t === 'marker' ||
  t === 'nib' ||
  t === 'pencil' ||
  t === 'crayon' ||
  t === 'neon'

/**
 * ⚠️ APPEND ONLY, NEVER REORDER. A packed stroke stores its tool as an INDEX into this
 * list, so moving an entry silently repaints every drawing anyone has ever saved — a brush stroke
 * becomes an eraser, and the picture is gone with no error to explain it. New tools go on the end.
 */
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
