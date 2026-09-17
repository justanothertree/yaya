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
  | 'ember'
  | 'vine'
  | 'comet'
  | 'text'

/**
 * Tools that are no longer OFFERED, but are still drawn.
 *
 * ⚠️ THEY CANNOT BE DELETED, and the reason is two lines up from TOOL_ORDER: a packed stroke
 * stores its tool as an INDEX into TOOLS. Removing an entry shifts every tool after it, so every
 * drawing anybody has ever saved would silently repaint with the wrong tools — a brush stroke
 * becoming an eraser, and the picture gone with no error to explain it. The same rule that says
 * new tools go on the end says old ones stay where they are.
 *
 * So retiring is a PALETTE decision, not a format one: gone from the picker, still rendered
 * perfectly wherever one was already drawn, and still readable from a file. Putting one back is
 * deleting a line here.
 */
export const RETIRED_TOOLS = new Set<Tool>(['ember', 'vine'])

export const TOOLS: Array<[Tool, string, string]> = [
  ['brush', '🖌', 'Brush'],
  ['eraser', '🧽', 'Eraser'],
  ['line', '╱', 'Line'],
  ['rect', '▭', 'Box'],
  ['ellipse', '◯', 'Ellipse'],
  ['fill', '🪣', 'Fill'],
  ['spray', '💨', 'Spray'],
  ['ember', '🔥', 'Ember'],
  ['vine', '🌿', 'Vine'],
  ['comet', '☄', 'Comet'],
  ['marker', '🖍', 'Marker'],
  ['nib', '✒', 'Nib'],
  ['pencil', '✏', 'Pencil'],
  ['star', '⭐', 'Star'],
  ['arrow', '↗', 'Arrow'],
  ['crayon', '🖤', 'Crayon'],
  ['neon', '💡', 'Neon'],
  ['triangle', '△', 'Triangle'],
  /* ⚠️ ON THE END, like everything after it will be — see TOOL_ORDER. */
  ['text', 'T', 'Text'],
]

/** How many mirrored copies a stroke is drawn as. 0 or 1 is "just the one". */
export const SYMMETRIES = [0, 2, 4, 6, 8, 12] as const
/** Fading copies trailing a stroke. 0 is just the one. */
export const ECHOES = [0, 1, 2, 3, 5] as const

export type Stroke = {
  t: Tool
  /**
   * Kaleidoscope segments for THIS stroke.
   *
   * ⚠️ Per stroke, not per drawing, because symmetry is something you switch on and off while
   * working — half a picture mirrored and half of it freehand is the normal way to use it, and a
   * single setting for the whole file could not express that.
   *
   * ⚠️ Stored as ONE NUMBER, not as copies of the stroke. Saving the mirrored copies would
   * multiply the file by up to twelve and freeze the symmetry into the geometry, so it could
   * never be changed or turned off afterwards. The copies are made at drawing time, which is the
   * same reason this format keeps strokes instead of pixels.
   */
  k?: number
  /**
   * How many fading copies trail behind the stroke, along the direction it was drawn.
   *
   * ⚠️ the offset comes from the stroke's OWN direction, first point to last, not from a
   * fixed diagonal. A fixed offset is a drop shadow and looks pasted on; following the gesture
   * makes it read as motion, which is the thing worth having.
   */
  e?: number
  /** css colour; ignored by the eraser */
  c: string
  /** 0–1 */
  a: number
  /** brush width as a fraction of the canvas's short side, so it scales with the picture */
  w: number
  /**
   * Which layer this stroke sits on, low to high. Absent means the bottom one.
   *
   * ⚠️ LAYERS AND FRAMES ARE THE SAME MECHANISM, which is why they are two plain numbers on
   * a stroke rather than nested arrays of strokes. Nesting would have meant a second shape for
   * every reader, packer, validator and the multiplayer path to learn, and cut/copy/paste would
   * have had to move strokes between containers. As numbers, a layer is "sort by this" and a
   * frame is "filter by that", the file stays one flat list, and every existing reader keeps
   * working because both fields are optional.
   */
  l?: number
  /**
   * Which animation frame this stroke belongs to, or ABSENT for every frame.
   *
   * ⚠️ "ON NO FRAME" IS THE USEFUL CASE, not an edge case. A stroke with no frame shows on
   * all of them, so the background you draw once and animate a character over is simply a stroke
   * that never picked a frame. That falls out of making the field optional, and it is exactly
   * what a static layer is for — so animating gets a background for free rather than by copying
   * it into all twenty frames, which is also what keeps the file small enough to publish.
   */
  f?: number
  /**
   * A name for this stroke while the program is running. NEVER SAVED.
   *
   * ⚠️ It exists so drawing together can say "take back the one I called this". Only finished
   * strokes were ever sent, so an undo was private: your copy lost the line, everybody else kept
   * it, and the two pictures disagreed from then on with nothing on screen to say so.
   *
   * ⚠️ It does not reach a file, and that is by construction rather than by remembering to strip
   * it: packDrawing lists the fields it writes, and readStroke lists the fields it reads, so a
   * property neither mentions cannot travel to disk or arrive from one.
   */
  id?: string
  /**
   * The words, for the text tool. Absent on every other stroke.
   *
   * ⚠️ THE ONLY THING IN THIS FORMAT THAT IS NOT A NUMBER, and it is worth saying why it is
   * allowed to be. Everything else about a stroke is geometry, which is what lets a drawing be
   * scaled, rotated, mirrored and echoed by arithmetic on `p` alone. Words cannot be reached that
   * way: a letter shape belongs to a font on the reader's machine, and the alternative — turning
   * typed words into outlines at placement time — would make them uneditable, enormous, and
   * different on every device that has a different font.
   *
   * ⚠️ SO THE GEOMETRY STAYS IN `p` AND ONLY THE CONTENT IS HERE. A text stroke is two points,
   * the baseline its words sit along, and the words are scaled to span it. That means the
   * selection tool's scale and rotate already work on text with no special case: they transform
   * two points, and the words follow. Nothing else in this file had to learn about text.
   */
  x?: string
  /** flat [x, y, x, y, …] in 0–1 space — two points for line/rect/ellipse/text, one for fill */
  p: number[]
}

export type Drawing = {
  v: 1
  name: string
  /** the shape of the page it was made on, so a replay knows its proportions */
  /**
   * The paper's shape as WIDTH OVER HEIGHT — 1.5 is a landscape 3:2, 0.75 is a portrait 3:4.
   *
   * ⚠️ Say it here because it was not said anywhere, and two readers had guessed the other way
   * round. PaintRoom writes w/h (see drawingRef), every drawing ever saved holds w/h, and the
   * profile block and the sprite baker were both computing height as width TIMES this — which
   * turns a wide picture into a tall thin one and a tall one into a wide one. Reported as art
   * coming out taller and skinnier than it was drawn.
   *
   * Height from a width is therefore `w / ratio`, never `w * ratio`.
   */
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
  /** layer names, bottom first. Absent or short means the rest are unnamed. */
  layers?: string[]
  /** frames a second when this is played back */
  fps?: number
  strokes: Stroke[]
}

const MAX_STROKES = 4000
const MAX_POINTS = 2000
const MAX_NAME = 60
/**
 * How many layers a drawing may have.
 *
 * ⚠️ IT WAS TWELVE AND THE ROOM SUGGESTED THIRTEEN PARTS. PART_WORDS lists thirteen words worth
 * typing and a creature wants a body layer besides, so the paint room was recommending more parts
 * than a drawing could physically hold — and the "+ layer" button went dead partway through
 * following its own instructions. Reported as hitting a limit while adding things to a minion,
 * which is exactly what it was.
 *
 * ⚠️ AN OLDER READER DEGRADES RATHER THAN BREAKS. `slot` clamps an index to max-1, so a build
 * that still believes in twelve draws every stroke of a twenty-four layer creature and merges the
 * top ones together. The picture survives; only the rig reads fewer parts.
 */
export const MAX_LAYERS = 24
const MAX_FRAMES = 60

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
    layers: Array.isArray(o.layers)
      ? o.layers.slice(0, MAX_LAYERS).map((n) => (typeof n === 'string' ? n.slice(0, 24) : ''))
      : undefined,
    fps: typeof o.fps === 'number' && o.fps >= 1 && o.fps <= 24 ? Math.round(o.fps) : undefined,
    strokes,
  }
}

/** Only the offered segment counts, so a hand-edited file cannot ask for 4000 copies. */
const segments = (v: unknown): number =>
  typeof v === 'number' && (SYMMETRIES as readonly number[]).includes(v) ? v : 0

const echoes = (v: unknown): number =>
  typeof v === 'number' && (ECHOES as readonly number[]).includes(v) ? v : 0

/**
 * A layer or frame index, or undefined.
 *
 * ⚠️ Clamped to a small whole number, and undefined stays undefined. These indices are used to
 * SIZE things — how many layer rows to render, how many frames to step through — so a file
 * claiming frame 900000 would otherwise ask the editor to build ninety thousand controls. The
 * distinction between 0 and absent is load-bearing for frames (absent means every frame), so
 * this cannot simply default to 0.
 */
const slot = (v: unknown, max: number): number | undefined =>
  // ⚠️ >= 0, not > 0. Frame 0 is a real frame — the FIRST one — and rejecting it here quietly
  // turned "the opening frame" into "every frame", which is the one case that must survive.
  typeof v === 'number' && Number.isFinite(v) && v >= 0
    ? Math.min(max - 1, Math.floor(v))
    : undefined

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
  /* ⚠️ Capped and stripped of control characters, because this travels: a drawing goes onto a
     profile and is drawn in a stranger's browser. Canvas text is not an injection surface the way
     innerHTML is, but an unbounded string is still a payload, and a newline in fillText is drawn
     as a space by some engines and a box by others. */
  /**
   * ⚠️ NEWLINES ARE KEPT NOW, and only because paintOne splits on them before anything reaches
   * fillText — which draws a newline as a space on one engine and a box on another. Every other
   * control character still becomes a space. The cap went from 120 to 240 when this became a text
   * box rather than a line of words; a block of text is still a few hundred bytes.
   */
  let words = ''
  if (typeof o.x === 'string')
    for (const ch of o.x.slice(0, 240)) {
      const n = ch.codePointAt(0) ?? 0
      words += n === 10 ? '\n' : n < 32 || n === 127 ? ' ' : ch
    }
  words = words
    .split('\n')
    .slice(0, 12)
    .map((l) => l.trimEnd())
    .join('\n')
    .trim()

  return {
    t: o.t as Tool,
    c: colour(o.c),
    ...(words ? { x: words } : {}),
    a: num(o.a, 0.02, 1, 1),
    w: num(o.w, 0.0015, 0.25, 0.01),
    k: segments(o.k),
    e: echoes(o.e),
    l: slot(o.l, MAX_LAYERS),
    f: slot(o.f, MAX_FRAMES),
    p,
  }
}

/**
 * Roughly where a stroke actually LANDS, in 0–1 space — as opposed to where its points are.
 *
 * ⚠️ POINTS ARE NOT EXTENT, and for several tools they are not even in the right PLACE. This is
 * why selecting was reported as "weirdly difficult because its stroke box is oddly shaped/placed
 * and not the exact stroke", and the answer is four separate ways a stroke escapes its points:
 *
 *   · a STAR is drawn from its centre outward, so its two points are the centre and one tip —
 *     the whole left side of a star dragged rightwards has no point anywhere near it
 *   · a KALEIDOSCOPE stroke is drawn k times around the middle of the paper, so the copy you are
 *     looking at can be on the opposite side of the picture from every point it has
 *   · an ECHO trails copies along the gesture, past the end of it
 *   · and every stroke is as wide as the brush, which on a fat one is most of its size
 *
 * ⚠️ IT IS DELIBERATELY GENEROUS RATHER THAN EXACT. A true bound would mean rasterising, or a
 * geometry routine per tool that has to be kept in step with how each one paints. A box that is
 * slightly too big makes a stroke easier to catch and its handles sit slightly outside the ink,
 * which is what a selection box looks like everywhere else anyway.
 */
export function strokeBox(s: Stroke, w: number, h: number) {
  const short = Math.min(w, h)
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  const add = (x: number, y: number) => {
    if (x < x0) x0 = x
    if (x > x1) x1 = x
    if (y < y0) y0 = y
    if (y > y1) y1 = y
  }

  /**
   * ⚠️ TEXT HAS A BLOCK, NOT A LINE. Its points are the baseline, which has no height at all —
   * so the selection box round a piece of text was a flat sliver, and round a multi-line one it
   * missed every line but the first. The height is worked out from the letters rather than
   * measured, because strokeBox has no canvas to measure with: a line of n characters is roughly
   * n × 0.52 of the font size wide, which inverts to a font size, which gives a block height.
   */
  if (s.t === 'text' && s.x && s.p.length > 3) {
    const ax = s.p[0] * w
    const ay = s.p[1] * h
    const bx = s.p[2] * w
    const by = s.p[3] * h
    const len = Math.hypot(bx - ax, by - ay)
    const lines = s.x.split('\n')
    const m = textMeter()
    let wide = 1
    if (m) for (const ln of lines) wide = Math.max(wide, m.measureText(ln).width || 1)
    else for (const ln of lines) wide = Math.max(wide, ln.length * 52)
    /* the same scale paintOne uses — see textScale */
    const k = textScale(len)
    const up = TEXT_ASCENT * k
    const down = ((lines.length - 1) * TEXT_STEP + TEXT_DESCENT) * k
    const a = Math.atan2(by - ay, bx - ax)
    const nx = -Math.sin(a)
    const ny = Math.cos(a)
    /**
     * ⚠️ THE FAR END IS WHERE THE WORDS END, not where the line ended. Now the size comes from
     * the line instead of being squeezed to fit it, so the text is free to run past the end of the
     * drag — and a box drawn to the drag would leave the tail of a long piece of text outside its
     * own selection: unhittable, and unmoved by its own handles.
     */
    const runX = ax + Math.cos(a) * wide * k
    const runY = ay + Math.sin(a) * wide * k
    for (const [ex, ey] of [
      [ax, ay],
      [runX, runY],
    ] as Array<[number, number]>) {
      add(ex - nx * up, ey - ny * up)
      add(ex + nx * down, ey + ny * down)
    }
  } else if (s.t === 'star' && s.p.length > 3) {
    /* centre and radius, not corner to corner — see the star case in paintOne */
    const cx = s.p[0] * w
    const cy = s.p[1] * h
    const r = Math.hypot(s.p[2] * w - cx, s.p[3] * h - cy)
    add(cx - r, cy - r)
    add(cx + r, cy + r)
  } else {
    for (let i = 0; i + 1 < s.p.length; i += 2) add(s.p[i] * w, s.p[i + 1] * h)
  }
  if (x0 === Infinity) return { x0: 0, y0: 0, x1: 0, y1: 0 }

  const pad = Math.max(0.5, s.w * short) / 2 + 1
  x0 -= pad
  y0 -= pad
  x1 += pad
  y1 += pad

  const copies = s.t === 'fill' ? 0 : (s.e ?? 0)
  if (copies > 0) {
    const [dx, dy] = gestureDirection(s, w, h)
    add(x0 + Math.min(0, dx * copies), y0 + Math.min(0, dy * copies))
    add(x1 + Math.max(0, dx * copies), y1 + Math.max(0, dy * copies))
  }

  /* the mirrored copies, put through the same transform paintMirrored uses on the strokes */
  const k = s.k ?? 0
  if (k >= 2 && s.t !== 'fill') {
    const cx = w / 2
    const cy = h / 2
    const corners: Array<[number, number]> = [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ]
    for (let seg = 1; seg < k; seg++) {
      const a = (seg / k) * Math.PI * 2
      const cos = Math.cos(a)
      const sin = Math.sin(a)
      const flip = seg % 2 ? -1 : 1
      for (const [px, py] of corners) {
        const ox = px - cx
        const oy = (py - cy) * flip
        add(cx + ox * cos - oy * sin, cy + ox * sin + oy * cos)
      }
    }
  }

  return { x0: x0 / w, y0: y0 / h, x1: x1 / w, y1: y1 / h }
}

/**
 * Paint one stroke onto a context sized w×h.
 *
 * ⚠️ The eraser is `destination-out`, not white. A drawing has no background of its own — it is
 * transparent, which is what lets it sit on any profile and pick up the page behind it — so
 * painting white would erase to a colour that only looks right on one theme. Alpha is the goal
 * feature and this is where it lives.
 */
/**
 * What words are drawn in.
 *
 * ⚠️ A STACK AND NOT A WEBFONT. A drawing travels — onto a profile, into somebody else's
 * browser — and fetching a face to render it would mean a network request to draw a picture,
 * which is the one thing every other part of this format avoids. These are faces people already
 * have; the last entry is the one nobody can fail to have.
 */
const TEXT_FACE =
  '"Avenir Next", "Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif'

/** the three numbers the layout is built from, at the nominal 100px the text is measured at */
const TEXT_STEP = 115
const TEXT_ASCENT = 78
const TEXT_DESCENT = 24

/**
 * One offscreen context, for asking how wide a line of text is without drawing it.
 *
 * ⚠️ MEASURED, NOT GUESSED. strokeBox worked the block's height out from a characters-per-width
 * fudge, which put the selection box round a one-line text at more than twice the height of the
 * letters. measureText is exact, and one 8×8 canvas reused for every call costs nothing — the
 * same reasoning as the scratch canvas the onion skin uses.
 */
let meter: CanvasRenderingContext2D | null = null
/**
 * How big the letters are, worked out from the line you dragged.
 *
 * ⚠️ THE LINE SETS THE SIZE. IT USED TO SET THE WIDTH, which is not the same thing and is the
 * difference between a control and a surprise. Dividing the line by the width of whatever you had
 * typed so far made the letters a function of HOW MUCH you typed: measured on one identical 400px
 * line, "A" came out 250px tall and "Hello" 126px. You dragged a line to say how big, and every
 * further character made it smaller. Reported as the text ignoring the sizing of the line, which
 * is what it was doing — obeying the line's LENGTH and overruling what that length was for.
 *
 * ⚠️ A FIXED REFERENCE, so the answer cannot depend on the words. Six characters' worth,
 * chosen so a short word still very nearly spans the line you drew — the old behaviour for the
 * common case, which is what makes this a correction rather than a different feature. Type more
 * and it runs on past the end of the line at the same size; type less and it stops short.
 *
 * ⚠️ MEASURED ONCE AND KEPT: the same string in the same face at the same size every time,
 * and this is asked per text stroke per frame.
 */
const TEXT_REF = 'Hello '
let refWide = 0
function textScale(len: number): number {
  if (!refWide) {
    const m = textMeter()
    /* the same rough 0.52-of-the-size-per-character fallback strokeBox already used */
    refWide = (m && m.measureText(TEXT_REF).width) || TEXT_REF.length * 52
  }
  return len / refWide
}

function textMeter(): CanvasRenderingContext2D | null {
  if (!meter && typeof document !== 'undefined') {
    const c = document.createElement('canvas')
    c.width = 8
    c.height = 8
    meter = c.getContext('2d')
    if (meter) meter.font = `600 100px ${TEXT_FACE}`
  }
  return meter
}

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

/**
 * Draw a stroke, mirrored into however many segments it asks for.
 *
 * ⚠️ Around the CENTRE of the picture, not around where the stroke started. A kaleidoscope has one
 * axis and everything folds about it; folding each stroke about its own middle would give a row of
 * small independent snowflakes rather than one figure.
 *
 * ⚠️ Alternate segments are FLIPPED. Rotation alone repeats a shape around a circle, which reads
 * as a wheel; reflecting every other copy is what makes the seams meet and turns it into a
 * kaleidoscope.
 *
 * ⚠️ Never for the fill bucket. Flood fill reads the canvas back, so mirroring it would mean up to
 * twelve full-canvas reads for a tool whose result is already whatever region it landed in.
 */
export function paintStroke(ctx: CanvasRenderingContext2D, s: Stroke, w: number, h: number) {
  const copies = s.t === 'fill' ? 0 : (s.e ?? 0)
  if (copies < 1) {
    paintMirrored(ctx, s, w, h)
    return
  }
  /**
   * ⚠️ Drawn FURTHEST FIRST, so the freshest copy lands on top. Painting them in the other order
   * puts the faintest ghost over the sharp stroke, which reads as the drawing being smudged
   * rather than as something having moved.
   */
  const [dx, dy] = gestureDirection(s, w, h)
  for (let i = copies; i >= 1; i--) {
    ctx.save()
    ctx.globalAlpha = 1 - i / (copies + 1)
    ctx.translate(dx * i, dy * i)
    paintMirrored(ctx, s, w, h)
    ctx.restore()
  }
  paintMirrored(ctx, s, w, h)
}

/**
 * Which way the gesture went, as the offset one echo step should take.
 *
 * ⚠️ Scaled to the SHORT side, so an echo is the same visual distance on any canvas — a fraction
 * of the stroke's own length would make a long sweep echo across the whole picture and a dot echo
 * not at all.
 */
function gestureDirection(s: Stroke, w: number, h: number): [number, number] {
  const n = s.p.length
  if (n < 4) return [Math.min(w, h) * 0.02, Math.min(w, h) * 0.02]
  const dx = (s.p[n - 2] - s.p[0]) * w
  const dy = (s.p[n - 1] - s.p[1]) * h
  const len = Math.hypot(dx, dy) || 1
  const step = Math.min(w, h) * 0.022
  return [(-dx / len) * step, (-dy / len) * step]
}

function paintMirrored(ctx: CanvasRenderingContext2D, s: Stroke, w: number, h: number) {
  const k = s.k ?? 0
  if (k < 2 || s.t === 'fill') {
    paintOne(ctx, s, w, h)
    return
  }
  for (let seg = 0; seg < k; seg++) {
    ctx.save()
    ctx.translate(w / 2, h / 2)
    ctx.rotate((seg / k) * Math.PI * 2)
    if (seg % 2) ctx.scale(1, -1)
    ctx.translate(-w / 2, -h / 2)
    paintOne(ctx, s, w, h)
    ctx.restore()
  }
}

function paintOne(ctx: CanvasRenderingContext2D, s: Stroke, w: number, h: number) {
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
  const TURN = short * 1.2
  const paint = rainbow ? wheel(0) : erasing ? '#000000' : s.c
  /**
   * A rainbow across whatever this stroke covers — for the tools that are not drawn segment by
   * segment.
   *
   * ⚠️ FIVE TOOLS WERE PAINTING FLAT RED ON RAINBOW, and the cause was the same in each: the
   * colour is chosen once at the top as `wheel(0)`, and only the freehand default case ever
   * replaces it per segment. Pencil, crayon, arrow and triangle never looked at `rainbow` at all,
   * and a line technically did — but a line is two points, so "one hue per segment" is one hue.
   *
   * ⚠️ A GRADIENT, not per-segment, because that is what rect and ellipse already do (see
   * boxWheel) and because several of these draw their path in batched passes that cannot carry a
   * colour each. Same look, one helper, and nothing new to learn about which tools rainbow
   * differently from which.
   */
  const spanWheel = () => {
    let x0 = Infinity
    let y0 = Infinity
    let x1 = -Infinity
    let y1 = -Infinity
    for (let i = 0; i + 1 < s.p.length; i += 2) {
      const x = X(i)
      const y = Y(i + 1)
      if (x < x0) x0 = x
      if (y < y0) y0 = y
      if (x > x1) x1 = x
      if (y > y1) y1 = y
    }
    // a dot has no span to run a gradient along, and a zero-length one throws
    if (!(x1 > x0 || y1 > y0)) return wheel(0)
    return boxWheel(ctx, x0, y0, x1, y1, TURN)
  }
  ctx.strokeStyle = paint
  ctx.fillStyle = paint
  if (erasing) ctx.globalCompositeOperation = 'destination-out'

  switch (s.t) {
    /**
     * Words along the line you dragged.
     *
     * ⚠️ SCALED TO SPAN THE BASELINE, which is what makes the drag mean something: a long drag
     * is big words and a short one is small, and there is no second control to find. It also
     * makes the selection tool's scale and rotate work on text for nothing — they move two
     * points, and the words are measured against wherever those two points now are.
     *
     * ⚠️ A FONT STACK, never one face. This is drawn in whoever's browser opened the drawing,
     * so the named face is a hope and the stack is the promise.
     *
     * ⚠️ WITH NO WORDS IT IS A GUIDE LINE, not nothing. That is the state while you are still
     * dragging one out, and a tool that draws nothing while you use it reads as broken.
     */
    case 'text': {
      const ax = X(0)
      const ay = Y(1)
      const bx = s.p.length > 3 ? X(2) : ax
      const by = s.p.length > 3 ? Y(3) : ay
      const len = Math.hypot(bx - ax, by - ay)
      if (!s.x) {
        if (len < 1) break
        ctx.globalAlpha = s.a * 0.5
        ctx.lineWidth = Math.max(0.5, short * 0.002)
        ctx.strokeStyle = paint
        ctx.beginPath()
        ctx.moveTo(ax, ay)
        ctx.lineTo(bx, by)
        ctx.stroke()
        break
      }
      if (len < 1) break
      ctx.save()
      ctx.translate(ax, ay)
      ctx.rotate(Math.atan2(by - ay, bx - ax))
      ctx.font = `600 100px ${TEXT_FACE}`
      ctx.textBaseline = 'alphabetic'
      /**
       * ⚠️ THE WIDEST LINE SPANS THE BASELINE, and the rest sit under it at that same scale.
       * Scaling each line to the line you dragged would give every line a different letter size,
       * which is a ransom note rather than a paragraph.
       *
       * ⚠️ The first line sits ON the baseline, so a one-line text is exactly what it always
       * was and nothing anybody has already drawn moves.
       */
      const lines = s.x.split('\n')
      let wide = 1
      for (const ln of lines) wide = Math.max(wide, ctx.measureText(ln).width || 1)
      /* ⚠️ from the line, not from the words — see textScale. `wide` stays the real width of
         the longest line, because the rainbow needs to know how far the colours must reach. */
      const k = textScale(len)
      ctx.scale(k, k)
      ctx.fillStyle = rainbow
        ? boxWheel(ctx, 0, -100, wide, (lines.length - 1) * TEXT_STEP, TURN / k)
        : paint
      for (let i = 0; i < lines.length; i++) ctx.fillText(lines[i], 0, i * TEXT_STEP)
      ctx.restore()
      break
    }
    case 'fill':
      /* ⚠️ points 2–5, when it has them, are the region this fill covered when it was made —
         see floodFill. They are POINTS rather than a separate field so a transform moves them
         with the seed for free, and so the selection can see a fill as an area. */
      floodFill(
        ctx,
        X(0),
        Y(1),
        erasing ? null : rainbow ? wheel((X(0) + Y(1)) / TURN) : s.c,
        s.a,
        s.p.length >= 6
          ? {
              x0: Math.min(s.p[2], s.p[4]),
              y0: Math.min(s.p[3], s.p[5]),
              x1: Math.max(s.p[2], s.p[4]),
              y1: Math.max(s.p[3], s.p[5]),
            }
          : null,
      )
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
     * Ember — sparks thrown off the line, each one flown forward under gravity and drag.
     *
     * ⚠️ SIMULATED, BUT NOT LIVE, and that distinction is the whole reason this fits here. Every
     * spark's whole flight is integrated at DRAW time from its own index — launch angle, speed
     * and lifetime all come out of noise(seed), and the loop below is the physics. So the result
     * is a pure function of the points already in the stroke, which is what lets it survive
     * everything the format promises: it saves as the same ~80 bytes, replays identically on a
     * peer's screen, and comes back the same after undo.
     *
     * A brush that kept live particle state would break all three at once — there would be
     * nothing to write to a file, nothing to send, and no way to redraw it.
     */
    case 'ember': {
      const R = Math.max(1, s.w * short)
      // a hair thinner than the brush, so a spark looks thrown off it rather than drawn beside it
      ctx.lineWidth = Math.max(1, R * 0.35)
      for (let i = 0; i + 1 < s.p.length; i += 2) {
        const cx = X(i)
        const cy = Y(i + 1)
        // direction of travel, so sparks come off the line rather than out of a point
        const dx = i + 3 < s.p.length ? X(i + 2) - cx : 0
        const dy = i + 3 < s.p.length ? Y(i + 3) - cy : 0
        const head = Math.atan2(dy, dx)
        for (let k = 0; k < 3; k++) {
          const seed = i * 5.17 + k * 2.39
          const a = head + (noise(seed) - 0.5) * 2.2
          /* ⚠️ 16R, not the 2.6R this shipped with first. Drag compounds over the eight steps
             and the displacement is divided by them, so a spark launched at 2.6R travelled 2.5px
             from a 3px brush — the whole effect rendered as a dotted line. Measured: 16R lands
             each spark about five brush-widths out, which is what reads as a spark. */
          const speed = (0.4 + noise(seed + 1.3)) * R * 16
          const life = 0.35 + noise(seed + 2.9) * 0.65
          let px = cx
          let py = cy
          let vx = Math.cos(a) * speed
          let vy = Math.sin(a) * speed
          /* ⚠️ eight steps, not eighty. This runs for every spark of every point of every
             stroke on every repaint, and the difference between eight and eighty is invisible
             on a 20px arc and very visible in a frame budget. */
          const STEPS = 8
          ctx.beginPath()
          ctx.moveTo(px, py)
          for (let n = 0; n < STEPS; n++) {
            vy += R * 0.09 // gravity
            vx *= 0.86 // drag
            vy *= 0.86
            px += (vx * life) / STEPS
            py += (vy * life) / STEPS
            ctx.lineTo(px, py)
          }
          if (rainbow) ctx.strokeStyle = wheel(((i / 2) * 8) / TURN)
          ctx.globalAlpha = s.a * (0.25 + noise(seed + 4.1) * 0.5)
          ctx.stroke()
        }
      }
      ctx.globalAlpha = s.a
      break
    }
    /**
     * Vine — tendrils growing sideways off the line and curling as they go.
     *
     * ⚠️ Grown PERPENDICULAR to the direction of travel, which is what makes it follow the shape
     * of what you drew rather than sprouting in a fixed direction. A tendril that always went
     * "up" would look pasted on the moment you drew a vertical line.
     *
     * ⚠️ The curl accumulates along the tendril rather than being a fixed arc, so no two are the
     * same shape and none of them read as a stamp — which is the failure mode of every decorative
     * brush that repeats a motif.
     */
    case 'vine': {
      const R = Math.max(1, s.w * short)
      ctx.lineCap = 'round'
      /**
       * ⚠️ THE STEM FIRST, and it was missing. Drawing only the tendrils left a row of detached
       * curls with nothing joining them — it read as scattered squiggles rather than as a vine,
       * because a vine is a line that things grow OFF. Found by looking at it; the pixel counts
       * were perfectly healthy.
       */
      ctx.lineWidth = Math.max(1, R * 0.6)
      ctx.beginPath()
      ctx.moveTo(X(0), Y(1))
      for (let i = 2; i + 1 < s.p.length; i += 2) ctx.lineTo(X(i), Y(i + 1))
      ctx.stroke()
      ctx.lineWidth = Math.max(1, R * 0.5)
      for (let i = 0; i + 1 < s.p.length; i += 4) {
        const cx = X(i)
        const cy = Y(i + 1)
        const dx = i + 5 < s.p.length ? X(i + 4) - cx : 1
        const dy = i + 5 < s.p.length ? Y(i + 5) - cy : 0
        const head = Math.atan2(dy, dx)
        for (const side of [-1, 1]) {
          const seed = i * 3.91 + (side + 1) * 6.13
          if (noise(seed) < 0.35) continue // not every point sprouts, or it reads as a comb
          const len = (0.6 + noise(seed + 1.1) * 1.4) * R * 3.2
          const curl = (noise(seed + 2.2) - 0.5) * 0.9
          let a = head + side * (Math.PI / 2)
          let px = cx
          let py = cy
          const SEGS = 6
          ctx.beginPath()
          ctx.moveTo(px, py)
          for (let n = 0; n < SEGS; n++) {
            a += curl
            px += (Math.cos(a) * len) / SEGS
            py += (Math.sin(a) * len) / SEGS
            ctx.lineTo(px, py)
          }
          if (rainbow) ctx.strokeStyle = wheel(((i / 2) * 8) / TURN)
          ctx.stroke()
          // a leaf at the tip, so the tendril ends in something rather than stopping
          ctx.beginPath()
          ctx.ellipse(px, py, R * 0.55, R * 0.3, a, 0, Math.PI * 2)
          ctx.fill()
        }
      }
      break
    }
    /**
     * Comet — a head, and a tail that lags behind where the line has been.
     *
     * ⚠️ The tail is drawn from EARLIER POINTS of the same stroke, not from a copy of it. That
     * makes the trail follow the real path — it bends through the corners you actually drew,
     * where an offset copy would cut them. It is also free: the points are already there.
     *
     * ⚠️ Widths taper along the tail rather than fading with s.a alone, because a trail that
     * only fades reads as a blur and one that also narrows reads as motion.
     */
    case 'comet': {
      const R = Math.max(1, s.w * short)
      const TAIL = 10
      ctx.lineCap = 'round'
      for (let i = 0; i + 1 < s.p.length; i += 2) {
        const cx = X(i)
        const cy = Y(i + 1)
        for (let n = 1; n <= TAIL; n++) {
          const j = i - n * 2
          if (j < 0) break
          const t = 1 - n / TAIL
          ctx.beginPath()
          ctx.moveTo(X(j), Y(j + 1))
          ctx.lineTo(cx, cy)
          ctx.lineWidth = Math.max(0.4, R * t * 0.9)
          if (rainbow) ctx.strokeStyle = wheel(((i / 2) * 8) / TURN)
          ctx.globalAlpha = s.a * t * 0.22
          ctx.stroke()
        }
        ctx.globalAlpha = s.a
        ctx.beginPath()
        ctx.arc(cx, cy, R * 0.5, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.globalAlpha = s.a
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
      /* found by checking every case rather than by waiting to be told about this one too */
      if (rainbow) ctx.strokeStyle = spanWheel()
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
      if (rainbow) ctx.strokeStyle = spanWheel()
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
      /* ⚠️ the last tool that was still painting flat red on rainbow. A star is drawn from its
         CENTRE outward, so its bounding box is the circle it fits in rather than the drag. */
      if (rainbow) ctx.strokeStyle = boxWheel(ctx, cx - R, cy - R, cx + R, cy + R, TURN)
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
      if (rainbow) ctx.strokeStyle = boxWheel(ctx, x0, y0, x1, y1, TURN)
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
      if (rainbow) ctx.strokeStyle = spanWheel()
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
      if (rainbow) ctx.strokeStyle = boxWheel(ctx, l, t, r, b, TURN)
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
        /* ⚠️ A LINE IS TWO POINTS, so "one hue per segment" is one hue for the whole thing —
           which is why a rainbow line came out flat red while a rainbow brush stroke did not. Two
           points get the gradient the shape tools use; anything longer keeps the per-segment walk,
           which follows the path rather than its bounding box. */
        if (s.p.length === 4) {
          ctx.strokeStyle = boxWheel(ctx, X(0), Y(1), X(2), Y(3), TURN)
          ctx.beginPath()
          ctx.moveTo(X(0), Y(1))
          ctx.lineTo(X(2), Y(3))
          ctx.stroke()
          break
        }
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
  /**
   * ⚠️ EVERY FIXED FIELD ADDED HERE GOES IN THE MIDDLE OF THE ROW, which is why the version has to
   * move each time. A row is positional — the points run to the end — so a reader that met a
   * newer row would take a modifier as its first x coordinate and draw nonsense. Older versions
   * are all still read, so nobody's saved work moves.
   *
   * v2 [tool, colour, alpha, width, ...points]
   * v3 + symmetry
   * v4 + echo
   */
  /** 4 for a flat drawing, 5 once layers or frames are in use — see packDrawing */
  v: 4 | 5
  n: string
  r: number
  /** background, hash-less hex, or 0 for none */
  b: string | 0
  /** layer names, v5 only */
  l?: string[]
  /** frames a second, v5 only */
  fp?: number
  /**
   * [tool, colour, alpha%, width‰, segments, echoes, ...points‰] — colour 0 none, 1 rainbow.
   * v5 inserts [layer, frame] after echoes, frame -1 meaning every frame.
   */
  s: Array<[number, string | 0 | 1, number, number, number, number, ...number[]]>
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
/**
 * A stroke under a matrix — its points AND its thickness.
 *
 * ⚠️ THE WIDTH IS THE HALF THAT WAS MISSING, and leaving it out is what opens gaps in a
 * drawing you stretch: geometry is two-dimensional and lives in `p`, but thickness is one scalar
 * in `w`, so scaling a selection spread the points apart and left every line exactly as thin as
 * it was. Two strokes drawn overlapping came apart. Reported as gaps "in the lines that use to
 * overlap".
 *
 * ⚠️ THE FACTOR IS THE SQUARE ROOT OF THE DETERMINANT, which is the one number that answers
 * this for every matrix the room can build. A rotation's determinant is exactly 1, so turning
 * something never thickens it and no special case is needed. A uniform scale's is s², so the
 * factor is s. A stretch's is sx·sy, so the factor is the geometric mean — the honest scalar
 * answer to a question that has none, because one number cannot be wide across and narrow down.
 *
 * ⚠️ Clamped to the range readStroke allows, so a transform cannot produce a stroke the
 * reader would later reject or clamp differently on the way back in.
 */
export function xformStroke(
  s: Stroke,
  m: [number, number, number, number, number, number],
): Stroke {
  const [a, b, c, d, e, f] = m
  const p = s.p.slice()
  for (let i = 0; i + 1 < p.length; i += 2) {
    const x = p[i]
    const y = p[i + 1]
    /* ⚠️ clamped to the same range readStroke allows, because a transform is the one edit
       that can push a point arbitrarily far and these become canvas coordinates */
    p[i] = Math.max(-0.5, Math.min(1.5, a * x + c * y + e))
    p[i + 1] = Math.max(-0.5, Math.min(1.5, b * x + d * y + f))
  }
  const k = Math.sqrt(Math.abs(a * d - b * c)) || 1
  return { ...s, p, w: Math.max(0.0015, Math.min(0.25, s.w * k)) }
}

/**
 * The same drawing with the points nobody can see taken out.
 *
 * ⚠️ FOR CARRYING, NOT FOR KEEPING. A profile block holds the whole drawing inside a capped
 * config (CONFIG_LIMIT), and a pet is a whole drawing, so a detailed one can outgrow it — measured,
 * a pet of sixty smooth hand-drawn strokes wanted four times the room a block had. This is what makes it fit
 * without asking anybody to draw less: the room records a point every 0.002 of the canvas WHILE
 * DRAWING AT FULL SIZE, and the same pet on a profile is about 180 pixels across, where 0.002 is a
 * third of a pixel. Most of what is stored was never going to be visible there.
 *
 * The gallery and the Pets room keep the full-detail original either way. Only the copy that
 * travels into a block is thinned, because that copy has a size limit and a known display size.
 *
 * ⚠️ FREEHAND ONLY. A shape tool's points are not a path — two corners, a centre and a
 * radius, a baseline — and a fill's are a seed point followed by the region it was allowed to
 * cover. Running a path simplifier over either would not thin them, it would move them.
 *
 * ⚠️ Ramer–Douglas–Peucker, with an explicit stack rather than recursion: the depth is
 * data-dependent and a long smooth stroke is exactly the shape that makes it deep.
 */
export function simplifyDrawing(d: Drawing, tol: number): Drawing {
  return {
    ...d,
    strokes: d.strokes.map((s) =>
      isFreehand(s.t) && s.p.length > 6 ? { ...s, p: thin(s.p, tol) } : s,
    ),
  }
}

function thin(p: number[], tol: number): number[] {
  const n = p.length / 2
  if (n < 3) return p
  const keep = new Uint8Array(n)
  keep[0] = 1
  keep[n - 1] = 1
  const stack: Array<[number, number]> = [[0, n - 1]]
  while (stack.length) {
    const [a, b] = stack.pop()!
    if (b - a < 2) continue
    const ax = p[a * 2]
    const ay = p[a * 2 + 1]
    const bx = p[b * 2]
    const by = p[b * 2 + 1]
    const dx = bx - ax
    const dy = by - ay
    const len = Math.hypot(dx, dy)
    let far = -1
    let best = tol
    for (let i = a + 1; i < b; i++) {
      const x = p[i * 2]
      const y = p[i * 2 + 1]
      /* distance to the segment, or to the point itself when the segment has no length */
      const gap = len
        ? Math.abs(dy * x - dx * y + bx * ay - by * ax) / len
        : Math.hypot(x - ax, y - ay)
      if (gap > best) {
        best = gap
        far = i
      }
    }
    if (far < 0) continue
    keep[far] = 1
    stack.push([a, far], [far, b])
  }
  const out: number[] = []
  for (let i = 0; i < n; i++)
    if (keep[i]) {
      out.push(p[i * 2], p[i * 2 + 1])
    }
  return out
}

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
  /**
   * ⚠️ WRITTEN AS VERSION 4 UNLESS LAYERS OR FRAMES ARE ACTUALLY USED.
   *
   * Every fixed field costs two more numbers on EVERY stroke, and a block on a profile gets
   * a capped budget for everything it holds — so making all existing drawings pay for an animation
   * feature they do not use would take room away from the picture itself and, worse, would grow
   * files that are already saved the moment they were next opened. A flat drawing still writes
   * the format it wrote before, byte for byte, and only an animation pays for being one.
   */
  /**
   * ⚠️ NAMED LAYERS COUNT, EVEN WHEN THERE IS ONLY ONE. This asked whether any stroke carried
   * a truthy `l` or a frame — and layer ZERO is not truthy, so a drawing whose only layer was
   * named came out as a flat version-4 file with the `l` list dropped on the floor. Measured: a
   * one-layer drawing called `body` packed and unpacked to a drawing with no names at all, which
   * in the minions module is the difference between a creature that breathes and a creature the
   * rig cannot read. Three named layers with everything drawn on the first behaved the same way.
   */
  const layered = d.strokes.some((k) => k.l || k.f !== undefined) || !!d.layers?.length
  const fixed = (k: Stroke) =>
    layered
      ? [
          Math.max(0, TOOL_ORDER.indexOf(k.t)),
          k.c === NONE ? 0 : k.c === RAINBOW ? 1 : k.c.slice(1),
          Math.round(k.a * 100),
          Math.round(k.w * 1000),
          k.k ?? 0,
          k.e ?? 0,
          k.l ?? 0,
          // ⚠️ -1, not 0: "on every frame" has to survive the round trip, and 0 is a real frame
          k.f ?? -1,
        ]
      : [
          Math.max(0, TOOL_ORDER.indexOf(k.t)),
          k.c === NONE ? 0 : k.c === RAINBOW ? 1 : k.c.slice(1),
          Math.round(k.a * 100),
          Math.round(k.w * 1000),
          k.k ?? 0,
          k.e ?? 0,
        ]
  return {
    v: layered ? 5 : 4,
    n: d.name,
    r: Math.round(d.ratio * 100) / 100,
    b: d.bg ? d.bg.slice(1) : 0,
    ...(layered && d.layers?.length ? { l: d.layers } : {}),
    ...(layered && d.fps ? { fp: d.fps } : {}),
    /* ⚠️ The words go on the END of the row, after the points. A reader that does not know
       about text does `row.slice(fixed)` and then keeps only the numbers — so an older build
       drops the string and still draws the baseline, rather than choking on it. */
    s: d.strokes.map((k) => [
      ...fixed(k),
      ...k.p.map((n) => Math.round(n * 1000)),
      ...(k.x ? [k.x] : []),
    ]) as PackedDrawing['s'],
  }
}

function unpack(v: Record<string, unknown>): Drawing | null {
  if (!Array.isArray(v.s)) return null
  /**
   * ⚠️ ONE TABLE, not a chain of version checks. Each version added a fixed field in front of the
   * points, so the only thing a reader needs to know is HOW MANY there are — and the next
   * modifier is then a single line here rather than another branch through the loop. Anything
   * unrecognised, including a document with no version at all, is read as the original four.
   */
  const FIXED: Record<number, number> = { 2: 4, 3: 5, 4: 6, 5: 8 }
  const fixed = FIXED[typeof v.v === 'number' ? v.v : 2] ?? 4
  const strokes: unknown[] = []
  for (const row of v.s.slice(0, MAX_STROKES)) {
    if (!Array.isArray(row) || row.length < 5) continue
    const [ti, c, a, w] = row as [number, string | 0 | 1, number, number]
    const k = fixed > 4 ? (row[4] as number) : 0
    const e = fixed > 5 ? (row[5] as number) : 0
    const l = fixed > 6 ? (row[6] as number) : 0
    const fr = fixed > 7 ? (row[7] as number) : -1
    /* the words, if this row has any — the colour is a string too, but it is never last */
    const tail = row[row.length - 1]
    const words = typeof tail === 'string' && row.length > fixed + 2 ? tail : undefined
    const pts = row.slice(fixed) as number[]
    strokes.push({
      t: TOOL_ORDER[typeof ti === 'number' ? ti : 0] ?? 'brush',
      c: c === 0 ? NONE : c === 1 ? RAINBOW : typeof c === 'string' ? `#${c}` : '#000000',
      a: typeof a === 'number' ? a / 100 : 1,
      w: typeof w === 'number' ? w / 1000 : 0.01,
      k,
      e,
      l,
      // ⚠️ anything below zero means the stroke never chose a frame, so it shows on all of them
      f: typeof fr === 'number' && fr >= 0 ? fr : undefined,
      x: words,
      p: pts.filter((n) => typeof n === 'number').map((n) => n / 1000),
    })
  }
  return readDrawing({
    name: v.n,
    ratio: v.r,
    bg: typeof v.b === 'string' ? `#${v.b}` : null,
    layers: Array.isArray(v.l) ? v.l : undefined,
    fps: typeof v.fp === 'number' ? v.fp : undefined,
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
export type DrawView = {
  /** which frame to show. Undefined shows frame 0 of an animation, or everything if it is flat. */
  frame?: number
  /** layer indices to leave out */
  hidden?: number[]
  /** how many earlier frames to ghost in behind the current one */
  onion?: number
}

/** The highest frame any stroke claims, or -1 for a drawing that is not an animation. */
export const frameCount = (d: Drawing): number =>
  d.strokes.reduce((n, s) => (s.f === undefined ? n : Math.max(n, s.f + 1)), 0)

/** The highest layer any stroke sits on, at least one. */
export const layerCount = (d: Drawing): number =>
  Math.max(
    d.layers?.length ?? 0,
    d.strokes.reduce((n, s) => Math.max(n, (s.l ?? 0) + 1), 1),
  )

/**
 * ⚠️ ONE SCRATCH CANVAS, kept between calls. Ghost frames are composited through it, and
 * allocating one per repaint would mean a new canvas for every stroke you draw.
 */
let scratch: HTMLCanvasElement | null = null

/**
 * A run of strokes onto a context, with each layer erasing only itself.
 *
 * ⚠️ AN ERASER BELONGS TO ITS LAYER, and until this it belonged to the whole picture. Rubbing
 * out part of a middle layer took the layers behind it away as well, because the eraser is
 * destination-out and destination is whatever is already on the canvas — reported as "tough to
 * work with", which is generous.
 *
 * It is the argument the onion skin below already makes about frames, and it is the same
 * argument: compositing a FINISHED image means the thing can only ever erase itself, which is
 * what a layer is. The fix was to notice that layers deserved the answer frames already had.
 *
 * ⚠️ AND IT COSTS NOTHING WHEN IT CHANGES NOTHING, which is the whole reason it is shaped like
 * this. Per-layer compositing is only ever VISIBLE when an eraser is in play: with no eraser the
 * layers land on the same pixels in the same order either way. So one layer, or no eraser, takes
 * the loop it always took — that is every drawing made before today and most made after, and it
 * means the common case pays nothing for a correctness fix it never needed.
 *
 * ⚠️ ITS OWN SURFACE, not the onion's. The ghost loop is holding `scratch` while it calls
 * this, and handing both the same canvas would have each wipe the other's work mid-frame.
 */
let deck: HTMLCanvasElement | null = null
function paintBand(ctx: CanvasRenderingContext2D, list: Stroke[], w: number, h: number) {
  let erases = false
  let spread = false
  let first = -1
  for (const s of list) {
    if (s.t === 'eraser') erases = true
    const l = s.l ?? 0
    if (first < 0) first = l
    else if (l !== first) spread = true
  }
  if (!erases || !spread) {
    for (const s of list) paintStroke(ctx, s, w, h)
    return
  }
  if (!deck) deck = document.createElement('canvas')
  if (deck.width !== w || deck.height !== h) {
    deck.width = w
    deck.height = h
  }
  const dc = deck.getContext('2d')
  if (!dc) {
    for (const s of list) paintStroke(ctx, s, w, h)
    return
  }
  /* ⚠️ the list arrives sorted by layer and the sort is stable, so a layer is a RUN in it —
     walking to the next boundary beats grouping into a map that is thrown away every frame */
  for (let i = 0; i < list.length; ) {
    const layer = list[i].l ?? 0
    let j = i
    while (j < list.length && (list[j].l ?? 0) === layer) j++
    dc.setTransform(1, 0, 0, 1, 0, 0)
    dc.clearRect(0, 0, w, h)
    for (let n = i; n < j; n++) paintStroke(dc, list[n], w, h)
    ctx.drawImage(deck, 0, 0)
    i = j
  }
}

export function paintDrawing(
  ctx: CanvasRenderingContext2D,
  d: Drawing,
  w: number,
  h: number,
  view?: DrawView,
) {
  ctx.clearRect(0, 0, w, h)
  const hidden = view?.hidden
  const visible = (s: Stroke) => !hidden?.length || !hidden.includes(s.l ?? 0)
  /**
   * ⚠️ Sorted by layer, and sort is stable, so strokes on the same layer keep the order they
   * were drawn in. Order is the ONLY thing a layer means to the renderer.
   */
  const ordered = (list: Stroke[]) => list.sort((a, b) => (a.l ?? 0) - (b.l ?? 0))
  const frames = frameCount(d)

  // a flat drawing, or an explicit request for everything at once
  if (!frames) {
    paintBand(ctx, ordered(d.strokes.filter(visible)), w, h)
    return
  }
  const now = Math.max(0, Math.min(frames - 1, view?.frame ?? 0))

  /**
   * ⚠️ EACH GHOST IS DRAWN ON ITS OWN SURFACE, then faded in as a picture.
   *
   * Fading with globalAlpha and drawing straight onto the canvas would be cheaper and wrong: the
   * eraser is destination-out, so an erased area in a ghost frame would cut a hole through the
   * ghosts underneath it and through anything already on the canvas. Compositing a finished
   * image means a frame can only ever erase itself, which is what a frame is.
   */
  const back = Math.max(0, Math.min(4, view?.onion ?? 0))
  if (back > 0) {
    if (!scratch) scratch = document.createElement('canvas')
    if (scratch.width !== w || scratch.height !== h) {
      scratch.width = w
      scratch.height = h
    }
    const sc = scratch.getContext('2d')
    for (let i = back; i >= 1; i--) {
      const f = now - i
      if (f < 0) continue
      const list = ordered(d.strokes.filter((s) => s.f === f && visible(s)))
      if (!list.length || !sc) continue
      sc.setTransform(1, 0, 0, 1, 0, 0)
      sc.clearRect(0, 0, w, h)
      /* a ghost is a picture of a frame, so its layers erase each other the same way */
      paintBand(sc, list, w, h)
      ctx.save()
      // the further back, the fainter — 0.30, 0.18, 0.11 …
      ctx.globalAlpha = 0.3 * Math.pow(0.6, i - 1)
      ctx.drawImage(scratch, 0, 0)
      ctx.restore()
    }
  }

  // ⚠️ a stroke with no frame belongs to every frame, so it is drawn HERE and never as a ghost —
  // ghosting it too would darken the background once per onion step
  paintBand(
    ctx,
    ordered(d.strokes.filter((s) => (s.f === undefined || s.f === now) && visible(s))),
    w,
    h,
  )
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
/**
 * @param limit the region the flood may touch, in 0–1 space, or null for the whole canvas
 * @param measure true to work out where it WOULD go without changing a pixel
 * @returns where it went, in 0–1 space, or null if it went nowhere
 *
 * ⚠️ THE LIMIT IS WHY A FILL SURVIVES ITS SHAPE MOVING. A fill is an operation replayed over
 * whatever is underneath it, so moving the strokes that bounded it changes what it finds — and an
 * opened boundary means it stops being a shape and becomes the whole page. Measured: move a filled
 * box out from under its own seed and the fill goes from 11% of the picture to 87% of it. Carrying
 * the region it covered the first time means the worst a moved boundary can now do is leave the
 * colour where it was, instead of swallowing the drawing.
 */
export function floodFill(
  ctx: CanvasRenderingContext2D,
  cssX: number,
  cssY: number,
  hex: string | null,
  alpha: number,
  limit?: { x0: number; y0: number; x1: number; y1: number } | null,
  measure = false,
): { x0: number; y0: number; x1: number; y1: number } | null {
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
  if (sx < 0 || sy < 0 || sx >= W || sy >= H) return null
  /* the limit in device pixels, with a little slack for the soft edge a brush leaves */
  const lim = limit
    ? {
        x0: Math.max(0, Math.floor(limit.x0 * W) - 6),
        y0: Math.max(0, Math.floor(limit.y0 * H) - 6),
        x1: Math.min(W - 1, Math.ceil(limit.x1 * W) + 6),
        y1: Math.min(H - 1, Math.ceil(limit.y1 * H) + 6),
      }
    : null
  if (lim && (sx < lim.x0 || sx > lim.x1 || sy < lim.y0 || sy > lim.y1)) return null
  let img: ImageData
  try {
    img = ctx.getImageData(0, 0, W, H)
  } catch {
    return null // a tainted canvas; nothing should taint it, but a fill is not worth throwing over
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
  if (!measure && t0 === r && t1 === g && t2 === b && t3 === a) return null // already this colour

  const TOL = 32
  const match = (i: number) =>
    Math.abs(d[i] - t0) <= TOL &&
    Math.abs(d[i + 1] - t1) <= TOL &&
    Math.abs(d[i + 2] - t2) <= TOL &&
    Math.abs(d[i + 3] - t3) <= TOL

  /**
   * ⚠️ ONE SEED PER RUN, AND NO ALLOCATION PER PIXEL. Measured before this: forty brush
   * strokes redraw in 0.2ms, and the same picture with ONE fill in it took 438ms — two thousand
   * times slower, paid again on every repaint, because paintDrawing replays every stroke and a
   * fill is a stroke.
   *
   * The algorithm was already scanline; the cost was the bookkeeping around it. Every pixel of
   * every run pushed a fresh `[x, y]` array onto the stack AND built a throwaway `[py-1, py+1]`
   * array to loop over — on a 2400x1600 canvas that is millions of short-lived allocations, which
   * is most of the time and all of the garbage. Worse, pushing a seed for every pixel of a run
   * means a stack that grows with the AREA rather than with the number of runs.
   *
   * So: a flat Int32Array stack of packed indices, and a neighbouring row scanned for CONTIGUOUS
   * runs with one seed each. Same tolerance, same result, same pixels.
   *
   * ⚠️ Not `willReadFrequently` — measured, and it changed nothing (268ms against 347ms, which
   * is noise). The readback was never the problem, so the hint that makes readbacks cheap was
   * never the fix.
   */
  const seen = new Uint8Array(W * H)
  /* what the flood actually touched, so the write-back is the changed region rather than the
     whole canvas — filling a shape costs the shape, not the page */
  let loX = W
  let loY = H
  let hiX = -1
  let hiY = -1
  let stack = new Int32Array(1024)
  let top = 0
  const push = (x: number, y: number) => {
    if (top === stack.length) {
      const bigger = new Int32Array(stack.length * 2)
      bigger.set(stack)
      stack = bigger
    }
    stack[top++] = y * W + x
  }
  push(sx, sy)
  while (top > 0) {
    const cell = stack[--top]
    const py = (cell / W) | 0
    const px = cell - py * W
    if (seen[cell] || !match(at(px, py))) continue
    if (lim && (py < lim.y0 || py > lim.y1)) continue
    const edgeL = lim ? lim.x0 : 0
    const edgeR = lim ? lim.x1 : W - 1
    if (px < edgeL || px > edgeR) continue
    let x0 = px
    while (x0 > edgeL && !seen[py * W + (x0 - 1)] && match(at(x0 - 1, py))) x0--
    let x1 = px
    while (x1 < edgeR && !seen[py * W + (x1 + 1)] && match(at(x1 + 1, py))) x1++
    for (let x = x0; x <= x1; x++) {
      const i = at(x, py)
      d[i] = r
      d[i + 1] = g
      d[i + 2] = b
      d[i + 3] = a
      seen[py * W + x] = 1
    }
    if (x0 < loX) loX = x0
    if (x1 > hiX) hiX = x1
    if (py < loY) loY = py
    if (py > hiY) hiY = py
    /* the rows above and below, one seed per unbroken run rather than one per pixel */
    for (let ny = py - 1; ny <= py + 1; ny += 2) {
      if (ny < 0 || ny >= H) continue
      let running = false
      for (let x = x0; x <= x1; x++) {
        const ok = !seen[ny * W + x] && match(at(x, ny))
        if (ok && !running) push(x, ny)
        running = ok
      }
    }
  }
  if (hiX < loX) return null // nothing matched; the seed itself was already the target colour
  /* ⚠️ measuring leaves the canvas alone: `img` is a copy out of getImageData, so skipping the
     write-back means nothing was changed — which is what lets the room ask "where would this go"
     before committing the stroke that will do it. */
  if (!measure) ctx.putImageData(img, 0, 0, loX, loY, hiX - loX + 1, hiY - loY + 1)
  return { x0: loX / W, y0: loY / H, x1: hiX / W, y1: hiY / H }
}
