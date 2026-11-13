/**
 * Type foundry: a font you make. Every letter is a few strokes between the dots of a small grid;
 * the style — weight, slant, width, ends, corners, outline, an inline stripe, a shadow, colours —
 * applies to all of them at once. Redraw any letter, type a message in your font, save it as a
 * picture, or send the font and the message as a link. Pure, so typeface.test.ts can check every
 * letter and round-trip a font without a page; TypeDemo draws it on a 2D canvas.
 *
 * Coordinates: a letter is drawn on dots x 0–4 by y 0–7, y down, the cap height at 0 and the
 * baseline at 6, with row 7 below it for a comma's tail. A narrow mark (. , ! ' :) sits on x = 1.
 */

export type Pt = [number, number]
export type Glyph = { w: number; strokes: Pt[][] }
export const GRID_W = 4
export const GRID_H = 7
export const BASELINE = 6

const O: Pt[] = [
  [1, 0],
  [3, 0],
  [4, 1],
  [4, 5],
  [3, 6],
  [1, 6],
  [0, 5],
  [0, 1],
  [1, 0],
]
const P_BOWL: Pt[] = [
  [0, 6],
  [0, 0],
  [3, 0],
  [4, 1],
  [4, 2],
  [3, 3],
  [0, 3],
]
const g = (...strokes: Pt[][]): Glyph => ({ w: 4, strokes })
const narrow = (...strokes: Pt[][]): Glyph => ({ w: 2, strokes })
/** a dot: a half-dot stroke, so short its ends make the mark. ⚠️ HALF-DOTS, NOT FINER: a link
 *  stores points in half-units, so anything finer would round when a letter is edited and sent. */
const dot = (x: number, y: number): Pt[] => [
  [x, y - 0.5],
  [x, y],
]

/** the font every font starts from */
export const BASE: Record<string, Glyph> = {
  A: g(
    [
      [0, 6],
      [0, 2],
      [2, 0],
      [4, 2],
      [4, 6],
    ],
    [
      [0, 4],
      [4, 4],
    ],
  ),
  B: g(
    [
      [0, 6],
      [0, 0],
      [3, 0],
      [4, 1],
      [4, 2],
      [3, 3],
      [0, 3],
    ],
    [
      [3, 3],
      [4, 4],
      [4, 5],
      [3, 6],
      [0, 6],
    ],
  ),
  C: g([
    [4, 1],
    [3, 0],
    [1, 0],
    [0, 1],
    [0, 5],
    [1, 6],
    [3, 6],
    [4, 5],
  ]),
  D: g([
    [0, 0],
    [0, 6],
    [3, 6],
    [4, 5],
    [4, 1],
    [3, 0],
    [0, 0],
  ]),
  E: g(
    [
      [4, 0],
      [0, 0],
      [0, 6],
      [4, 6],
    ],
    [
      [0, 3],
      [3, 3],
    ],
  ),
  F: g(
    [
      [4, 0],
      [0, 0],
      [0, 6],
    ],
    [
      [0, 3],
      [3, 3],
    ],
  ),
  G: g([
    [4, 1],
    [3, 0],
    [1, 0],
    [0, 1],
    [0, 5],
    [1, 6],
    [3, 6],
    [4, 5],
    [4, 3],
    [2, 3],
  ]),
  H: g(
    [
      [0, 0],
      [0, 6],
    ],
    [
      [4, 0],
      [4, 6],
    ],
    [
      [0, 3],
      [4, 3],
    ],
  ),
  I: g(
    [
      [1, 0],
      [3, 0],
    ],
    [
      [2, 0],
      [2, 6],
    ],
    [
      [1, 6],
      [3, 6],
    ],
  ),
  J: g(
    [
      [1, 0],
      [4, 0],
    ],
    [
      [3, 0],
      [3, 5],
      [2, 6],
      [1, 6],
      [0, 5],
    ],
  ),
  K: g(
    [
      [0, 0],
      [0, 6],
    ],
    [
      [4, 0],
      [0, 4],
    ],
    [
      [1, 3],
      [4, 6],
    ],
  ),
  L: g([
    [0, 0],
    [0, 6],
    [4, 6],
  ]),
  M: g([
    [0, 6],
    [0, 0],
    [2, 3],
    [4, 0],
    [4, 6],
  ]),
  N: g([
    [0, 6],
    [0, 0],
    [4, 6],
    [4, 0],
  ]),
  O: g(O),
  P: g(P_BOWL),
  Q: g(O, [
    [2, 4],
    [4, 6],
  ]),
  R: g(P_BOWL, [
    [2, 3],
    [4, 6],
  ]),
  S: g([
    [4, 1],
    [3, 0],
    [1, 0],
    [0, 1],
    [0, 2],
    [1, 3],
    [3, 3],
    [4, 4],
    [4, 5],
    [3, 6],
    [1, 6],
    [0, 5],
  ]),
  T: g(
    [
      [0, 0],
      [4, 0],
    ],
    [
      [2, 0],
      [2, 6],
    ],
  ),
  U: g([
    [0, 0],
    [0, 5],
    [1, 6],
    [3, 6],
    [4, 5],
    [4, 0],
  ]),
  V: g([
    [0, 0],
    [2, 6],
    [4, 0],
  ]),
  W: g([
    [0, 0],
    [1, 6],
    [2, 3],
    [3, 6],
    [4, 0],
  ]),
  X: g(
    [
      [0, 0],
      [4, 6],
    ],
    [
      [4, 0],
      [0, 6],
    ],
  ),
  Y: g(
    [
      [0, 0],
      [2, 3],
      [4, 0],
    ],
    [
      [2, 3],
      [2, 6],
    ],
  ),
  Z: g([
    [0, 0],
    [4, 0],
    [0, 6],
    [4, 6],
  ]),
  '0': g(O, [
    [3, 1],
    [1, 5],
  ]),
  '1': g(
    [
      [1, 1],
      [2, 0],
      [2, 6],
    ],
    [
      [1, 6],
      [3, 6],
    ],
  ),
  '2': g([
    [0, 1],
    [1, 0],
    [3, 0],
    [4, 1],
    [4, 2],
    [0, 6],
    [4, 6],
  ]),
  '3': g(
    [
      [0, 1],
      [1, 0],
      [3, 0],
      [4, 1],
      [4, 2],
      [3, 3],
      [1, 3],
    ],
    [
      [3, 3],
      [4, 4],
      [4, 5],
      [3, 6],
      [1, 6],
      [0, 5],
    ],
  ),
  '4': g([
    [3, 6],
    [3, 0],
    [0, 4],
    [4, 4],
  ]),
  '5': g([
    [4, 0],
    [0, 0],
    [0, 3],
    [3, 3],
    [4, 4],
    [4, 5],
    [3, 6],
    [1, 6],
    [0, 5],
  ]),
  '6': g([
    [3, 0],
    [1, 0],
    [0, 1],
    [0, 5],
    [1, 6],
    [3, 6],
    [4, 5],
    [4, 4],
    [3, 3],
    [0, 3],
  ]),
  '7': g([
    [0, 0],
    [4, 0],
    [1, 6],
  ]),
  '8': g(
    [
      [1, 3],
      [0, 2],
      [0, 1],
      [1, 0],
      [3, 0],
      [4, 1],
      [4, 2],
      [3, 3],
      [1, 3],
    ],
    [
      [1, 3],
      [0, 4],
      [0, 5],
      [1, 6],
      [3, 6],
      [4, 5],
      [4, 4],
      [3, 3],
    ],
  ),
  '9': g([
    [4, 3],
    [1, 3],
    [0, 2],
    [0, 1],
    [1, 0],
    [3, 0],
    [4, 1],
    [4, 5],
    [3, 6],
    [1, 6],
  ]),
  '.': narrow(dot(1, 6)),
  ',': narrow([
    [1, 5.5],
    [1, 6],
    [0.5, 7],
  ]),
  '!': narrow(
    [
      [1, 0],
      [1, 4],
    ],
    dot(1, 6),
  ),
  ':': narrow(dot(1, 2), dot(1, 6)),
  "'": narrow([
    [1, 0],
    [1, 1.5],
  ]),
  '?': g(
    [
      [0, 1],
      [1, 0],
      [3, 0],
      [4, 1],
      [4, 2],
      [2, 3.5],
      [2, 4],
    ],
    dot(2, 6),
  ),
  '-': g([
    [1, 3],
    [3, 3],
  ]),
  '+': g(
    [
      [2, 1.5],
      [2, 4.5],
    ],
    [
      [0.5, 3],
      [3.5, 3],
    ],
  ),
  '&': g([
    [4, 6],
    [1, 2],
    [1, 1],
    [2, 0],
    [3, 1],
    [3, 2],
    [0, 4],
    [0, 5],
    [1, 6],
    [2, 6],
    [4, 4],
  ]),
  '#': g(
    [
      [1, 1],
      [1, 5],
    ],
    [
      [3, 1],
      [3, 5],
    ],
    [
      [0, 2],
      [4, 2],
    ],
    [
      [0, 4],
      [4, 4],
    ],
  ),
  '/': g([
    [4, 0],
    [0, 6],
  ]),
}
/** the characters a font has a letter for: the rest of what is typed is shown as a gap */
export const CHARSET = Object.keys(BASE)
export const has = (c: string) => c.toUpperCase() in BASE

/* ---------------------------------------------------------------------------- style */

export type Style = {
  /** stroke width, in grid units */
  weight: number
  /** horizontal shear per grid unit of height (positive leans right) */
  slant: number
  /** horizontal stretch */
  width: number
  ends: 'round' | 'square'
  /** how much a corner is rounded off, 0 sharp to 1 as round as the strokes allow */
  corners: number
  outline: boolean
  inline: boolean
  shadow: boolean
  /** gaps between letters and lines, in grid units */
  tracking: number
  leading: number
  ink: number
  ink2: number
  paper: number
}
export const INKS = [
  '#111111',
  '#f5f5f0',
  '#e63946',
  '#ff8c42',
  '#ffd166',
  '#06d6a0',
  '#118ab2',
  '#3a0ca3',
  '#b5179e',
  '#ff70a6',
  '#2b9348',
  '#8d6e63',
] as const
export const DEFAULT_STYLE: Style = {
  weight: 0.7,
  slant: 0,
  width: 1,
  ends: 'round',
  corners: 0.4,
  outline: false,
  inline: false,
  shadow: false,
  tracking: 1.4,
  leading: 3,
  ink: 0,
  ink2: 4,
  paper: 1,
}
/** the ranges the style's sliders allow; anything read from a link is clamped into them */
export const RANGES = {
  weight: [0.2, 1.6],
  slant: [-0.3, 0.45],
  width: [0.6, 1.6],
  corners: [0, 1],
  tracking: [0.4, 4],
  leading: [1, 6],
} as const
export const PRESETS: { name: string; style: Partial<Style> }[] = [
  { name: 'Clean', style: {} },
  { name: 'Heavy', style: { weight: 1.4, corners: 0.8, tracking: 1.6, ink: 7, ink2: 4, paper: 1 } },
  {
    name: 'Glow',
    style: { weight: 0.5, outline: true, corners: 1, ink: 9, ink2: 5, paper: 0, shadow: true },
  },
  {
    name: 'Racing',
    style: {
      weight: 1.1,
      slant: 0.35,
      width: 1.3,
      ends: 'square',
      corners: 0,
      inline: true,
      ink: 2,
      ink2: 1,
      paper: 1,
    },
  },
  {
    name: 'Hand',
    style: { weight: 0.45, slant: 0.15, width: 0.85, corners: 1, tracking: 1, ink: 6, paper: 1 },
  },
  {
    name: 'Block',
    style: {
      weight: 1.5,
      ends: 'square',
      corners: 0,
      shadow: true,
      tracking: 1.2,
      ink: 4,
      ink2: 0,
      paper: 7,
    },
  },
]

const clamp = (v: number, [lo, hi]: readonly [number, number]) => Math.min(hi, Math.max(lo, v))

/* ---------------------------------------------------------------------------- the font */

export type Font = {
  name: string
  style: Style
  /** letters redrawn by hand, by character */ glyphs: Record<string, Glyph>
}
export const glyphOf = (font: Font, c: string): Glyph | null => {
  const k = c.toUpperCase()
  return font.glyphs[k] ?? BASE[k] ?? null
}

/** a grid point is a whole dot, or one of the base font's own off-grid points */
export const onGrid = ([x, y]: Pt) => x >= 0 && x <= GRID_W && y >= 0 && y <= GRID_H

/* ---------------------------------------------------------------------------- setting type */

export type Placed = { c: string; x: number; y: number }
/**
 * Where each letter of a message goes, in grid units, wrapping whole words onto a new line when
 * they would pass `maxWidth`. A space is a letter's width; a newline starts a new line; a
 * character the font has no letter for keeps its space, so nothing is silently dropped.
 */
export function layout(
  text: string,
  font: Font,
  maxWidth: number,
): { placed: Placed[]; width: number; height: number } {
  const { width: stretch, tracking, leading } = font.style
  const advance = (c: string) => {
    if (c === ' ') return 3 * stretch + tracking
    const gl = glyphOf(font, c)
    return (gl ? gl.w : 4) * stretch + tracking
  }
  const lines: string[][] = []
  for (const para of text.split('\n')) {
    const words = para.split(/( +)/).filter((w) => w.length)
    let line: string[] = []
    let w = 0
    for (const word of words) {
      const ww = [...word].reduce((t, c) => t + advance(c), 0)
      if (line.length && w + ww > maxWidth && word.trim()) {
        lines.push(line)
        line = []
        w = 0
      }
      if (!line.length && !word.trim()) continue
      line.push(...word)
      w += ww
    }
    lines.push(line)
  }
  const placed: Placed[] = []
  let width = 0
  lines.forEach((line, i) => {
    let x = 0
    for (const c of line) {
      if (c !== ' ') placed.push({ c, x, y: i * (GRID_H + leading) })
      x += advance(c)
    }
    width = Math.max(width, x - tracking)
  })
  return { placed, width: Math.max(0, width), height: lines.length * (GRID_H + leading) - leading }
}

/** a point of a letter, set at its place: stretched, slanted about the baseline */
export const setPoint = ([x, y]: Pt, at: Placed, style: Style): Pt => [
  at.x + x * style.width + (BASELINE - y) * style.slant,
  at.y + y,
]

/* ---------------------------------------------------------------------------- sharing */

const STYLE_KEYS = ['weight', 'slant', 'width', 'corners', 'tracking', 'leading'] as const
/**
 * A font and a message as a short string: a version; the six sliders, a byte each; the switches
 * and ends in one byte; the three colours, a byte each; the name; the message; then every redrawn
 * letter — its character, width and stroke count, and each stroke's points at one byte apiece
 * (x and y a nibble each, in half-units).
 */
export function encode(font: Font, message: string): string {
  const out: number[] = [1]
  for (const k of STYLE_KEYS) {
    const [lo, hi] = RANGES[k]
    out.push(Math.round(((clamp(font.style[k], RANGES[k]) - lo) / (hi - lo)) * 255))
  }
  const s = font.style
  out.push(
    (s.ends === 'square' ? 1 : 0) | (s.outline ? 2 : 0) | (s.inline ? 4 : 0) | (s.shadow ? 8 : 0),
  )
  out.push(s.ink, s.ink2, s.paper)
  const text = (str: string, max: number) => {
    const b = new TextEncoder().encode(str.slice(0, max))
    out.push(b.length, ...b)
  }
  text(font.name, 24)
  text(message, 120)
  const edits = Object.entries(font.glyphs).filter(([c]) => c in BASE)
  out.push(edits.length)
  for (const [c, gl] of edits) {
    out.push(CHARSET.indexOf(c), gl.w, gl.strokes.length)
    for (const st of gl.strokes) {
      out.push(st.length)
      for (const [x, y] of st) out.push((Math.round(x * 2) << 4) | Math.round(y * 2))
    }
  }
  let bin = ''
  for (const b of out) bin += String.fromCharCode(b & 255)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function decode(code: string): { font: Font; message: string } | null {
  if (!/^[A-Za-z0-9_-]{8,4000}$/.test(code)) return null
  let b: Uint8Array
  try {
    b = Uint8Array.from(atob(code.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))
  } catch {
    return null
  }
  let i = 0
  const next = () => {
    if (i >= b.length) throw new Error('short')
    return b[i++]
  }
  try {
    if (next() !== 1) return null
    const style = { ...DEFAULT_STYLE }
    for (const k of STYLE_KEYS) {
      const [lo, hi] = RANGES[k]
      style[k] = Math.round((lo + (next() / 255) * (hi - lo)) * 1000) / 1000
    }
    const flags = next()
    style.ends = flags & 1 ? 'square' : 'round'
    style.outline = !!(flags & 2)
    style.inline = !!(flags & 4)
    style.shadow = !!(flags & 8)
    for (const k of ['ink', 'ink2', 'paper'] as const) {
      const v = next()
      if (v >= INKS.length) return null
      style[k] = v
    }
    const text = () => {
      const n = next()
      const bytes = b.slice(i, i + n)
      if (bytes.length !== n) throw new Error('short')
      i += n
      return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
    }
    const name = text()
    const message = text()
    const glyphs: Record<string, Glyph> = {}
    const n = next()
    for (let k = 0; k < n; k++) {
      const c = CHARSET[next()]
      const w = next()
      const strokes: Pt[][] = []
      const ns = next()
      if (!c || w < 1 || w > 4 || ns > 24) return null
      for (let j = 0; j < ns; j++) {
        const np = next()
        if (np < 2 || np > 32) return null
        const st: Pt[] = []
        for (let q = 0; q < np; q++) {
          const v = next()
          const p: Pt = [(v >> 4) / 2, (v & 15) / 2]
          if (!onGrid(p)) return null
          st.push(p)
        }
        strokes.push(st)
      }
      glyphs[c] = { w, strokes }
    }
    if (i !== b.length) return null
    const clean = (s: string) =>
      [...s].filter((ch) => ch === '\n' || ch.charCodeAt(0) >= 32).join('')
    return {
      font: { name: clean(name).slice(0, 24), style, glyphs },
      message: clean(message).slice(0, 120),
    }
  } catch {
    return null
  }
}

/* ---------------------------------------------------------------------------- what is kept */

export const TYPE_KEY = 'lab_type_v1'
export const MAX_FONTS = 12
export type Saved = { current: string; fonts: string[] }
export const EMPTY: Saved = { current: '', fonts: [] }
export function readSaved(text: string | null): Saved {
  const out: Saved = { current: '', fonts: [] }
  let v: unknown
  try {
    v = JSON.parse(text ?? 'null')
  } catch {
    return out
  }
  if (typeof v !== 'object' || !v || Array.isArray(v)) return out
  const o = v as Record<string, unknown>
  if (typeof o.current === 'string' && decode(o.current)) out.current = o.current
  if (Array.isArray(o.fonts))
    out.fonts = o.fonts
      .filter((x): x is string => typeof x === 'string' && decode(x) !== null)
      .slice(0, MAX_FONTS)
  return out
}
export const STARTER: Font = { name: 'My font', style: DEFAULT_STYLE, glyphs: {} }
export const STARTER_MESSAGE = 'HELLO WORLD\nMADE BY HAND'
