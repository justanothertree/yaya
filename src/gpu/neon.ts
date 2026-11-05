/**
 * The arithmetic of the Lab's neon sign: the jump flood's steps, the exact distance transform it
 * approximates (for testing), and how each letter flickers.
 *
 * ⚠️ WHY JUMP FLOODING. A glow needs every pixel's distance to the nearest lit stroke. Exactly,
 * that is every pixel asking every seed — millions times thousands. The jump flood (Rong & Tan)
 * gets it in log₂(size) passes: every pixel looks at nine pixels `step` away, keeps whichever
 * nearest seed they know of, and the step halves each pass. A seed's news reaches the whole
 * canvas in eleven passes for a 2048-wide one. It is not exact — a pixel can be told about a seed
 * that is nearly but not quite its nearest — so one extra pass at step 1 cleans most of that up.
 * Measured on scattered seeds: 34 pixels in 122,880 off (worst 0.92px) without it, 2 (worst
 * 0.36px) with it. And on the GPU the flood matches this file's `jumpFlood` on every pixel.
 */

/** Hand-packed to match `struct Neon` — neon.test.ts lays the struct out from the shader. */
export const NEON = {
  size: 0,
  step: 8,
  style: 12,
  time: 16,
  scale: 20,
  palette: 24,
  letters: 28,
  bytes: 32,
} as const

export const MAX_LETTERS = 16
/** letter i is drawn in red (i + 1) × LETTER_STEP — see neon-flood.wgsl for why not 1 apart */
export const LETTER_STEP = 15
export const letterRed = (i: number) => (i + 1) * LETTER_STEP

/** the steps of a jump flood over a field this big: half the larger side, halving to 1, then 1 again */
export function jfaSteps(w: number, h: number): number[] {
  const out: number[] = []
  let s = 1
  while (s * 2 < Math.max(w, h)) s *= 2
  for (; s >= 1; s = s / 2) out.push(s)
  out.push(1)
  return out
}

/**
 * The jump flood on the CPU, step for step as the shader does it: `seeds` holds, per pixel, the
 * index of a seed pixel or -1. Returns each pixel's nearest seed index as the flood found it.
 */
export function jumpFlood(seeds: Int32Array, w: number, h: number): Int32Array {
  let cur = Int32Array.from(seeds)
  for (const step of jfaSteps(w, h)) {
    const next = new Int32Array(cur.length)
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        let best = cur[y * w + x]
        let bd = best < 0 ? Infinity : dist2(best, x, y, w)
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx * step
            const ny = y + dy * step
            if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
            const s = cur[ny * w + nx]
            if (s < 0) continue
            const d = dist2(s, x, y, w)
            if (d < bd) {
              bd = d
              best = s
            }
          }
        next[y * w + x] = best
      }
    cur = next
  }
  return cur
}
const dist2 = (s: number, x: number, y: number, w: number) => {
  const dx = (s % w) - x
  const dy = Math.floor(s / w) - y
  return dx * dx + dy * dy
}

/** the truth, for testing: every pixel's distance to its nearest seed, by asking every seed */
export function exactDistance(seeds: Int32Array, w: number, h: number): Float64Array {
  const list: number[] = []
  seeds.forEach((s, i) => s >= 0 && list.push(i))
  const out = new Float64Array(w * h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      let best = Infinity
      for (const s of list) best = Math.min(best, dist2(s, x, y, w))
      out[y * w + x] = Math.sqrt(best)
    }
  return out
}

/**
 * Which pixels are seeds: a TUBE is a sign bent from tubing along the letters' outlines, so its
 * seeds are the mask's edge (in, with a neighbour out); a SOLID sign glows from the whole glyph.
 */
export function seedsOf(mask: Uint8Array, w: number, h: number, style: Style): Int32Array {
  const out = new Int32Array(w * h).fill(-1)
  const on = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x] > 127
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!on(x, y)) continue
      const edge = !on(x - 1, y) || !on(x + 1, y) || !on(x, y - 1) || !on(x, y + 1)
      if (style === 'solid' || edge) out[y * w + x] = y * w + x
    }
  return out
}

export const STYLES = { tube: 'Tube', solid: 'Solid' } as const
export type Style = keyof typeof STYLES
export const COLOURS = { pink: 'Pink', cyan: 'Ice', gold: 'Gold', mixed: 'Mixed' } as const
export type NeonColour = keyof typeof COLOURS
export const COLOUR_IDS = Object.keys(COLOURS) as NeonColour[]

const hash = (n: number) => {
  let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b)
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35)
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296
}

/**
 * How bright letter `i` is at time t (seconds), 0..1. A neon letter does not fade in: it stutters
 * on, a few blinks over its first ~0.6 s, then holds. One letter in the sign is FAULTY and buzzes
 * off in short bursts every few seconds — what makes a sign look like a real one rather than a
 * font. A knock makes every letter stutter for a moment.
 */
export function brightness(
  i: number,
  t: number,
  litAt: number,
  knockedAt: number,
  faulty: number,
): number {
  const since = t - litAt
  if (since < 0) return 0
  // warming up: on/off in 50ms slots, more often on as it goes
  if (since < 0.6) return hash(i * 977 + Math.floor(since * 20)) < since / 0.6 ? 1 : 0.08
  const knock = t - knockedAt
  if (knock >= 0 && knock < 1)
    return hash(i * 131 + Math.floor(knock * 25)) < 0.35 + knock * 0.65 ? 1 : 0.1
  if (i === faulty) {
    // a burst of buzzing for 0.4 s in every 3.7 s
    const phase = t % 3.7
    if (phase < 0.4) return hash(i * 7 + Math.floor(t * 30)) < 0.45 ? 0.15 : 1
  }
  return 1
}

/** the faulty letter of a word: the same one each time it is typed, never a space */
export function faultyLetter(word: string): number {
  const lit = [...word].map((c, i) => (c.trim() ? i : -1)).filter((i) => i >= 0)
  if (!lit.length) return -1
  let h = 0
  for (const c of word) h = Math.imul(h ^ c.charCodeAt(0), 16777619)
  return lit[(h >>> 0) % lit.length]
}

export type NeonFrame = {
  w: number
  h: number
  step: number
  style: Style
  time: number
  /** canvas pixels per field pixel: the glow's widths are written in canvas pixels */
  scale: number
  palette: NeonColour
  letters: number
}

export function packNeon(p: NeonFrame, into = new ArrayBuffer(NEON.bytes)) {
  const f = new Float32Array(into)
  const u = new Uint32Array(into)
  u[0] = p.w
  u[1] = p.h
  u[NEON.step / 4] = p.step
  u[NEON.style / 4] = p.style === 'tube' ? 0 : 1
  f[NEON.time / 4] = p.time
  f[NEON.scale / 4] = p.scale
  u[NEON.palette / 4] = COLOUR_IDS.indexOf(p.palette)
  u[NEON.letters / 4] = p.letters
  return into
}
