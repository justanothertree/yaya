/**
 * The arithmetic of the Lab's palette tool: colour spaces, finding a palette in a picture, how
 * readable two colours are together, and the palettes kept in this browser. Pure, so palette.test.ts
 * can ask it questions without a GPU.
 *
 * ⚠️ THE CLUSTERING IS IN OKLAB, NOT RGB. Averaging in sRGB pulls every palette towards muddy
 * mid-tones, because sRGB's numbers are not spaced the way eyes space colours: the mean of a red and
 * a green is a brown nobody saw. OKLab is built so that equal distances look about equally
 * different, which is the whole question a palette asks. The shader converts with the same matrices.
 */

import { rng } from './jigsaw'

export type Rgb = [number, number, number]
export type Lab = [number, number, number]

/* ---------------------------------------------------------------- colour spaces --------------- */

export const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
export const toGamma = (c: number) =>
  c <= 0.0031308 ? c * 12.92 : 1.055 * Math.max(0, c) ** (1 / 2.4) - 0.055

/** sRGB (0..1 each) to OKLab — Björn Ottosson's matrices, as published */
export function oklab([r, g, b]: Rgb): Lab {
  const R = toLinear(r)
  const G = toLinear(g)
  const B = toLinear(b)
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B)
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B)
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B)
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ]
}

/** OKLab back to sRGB, clipped into the cube */
export function srgb([L, a, b]: Lab): Rgb {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3
  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ]
  return lin.map((c) => Math.min(1, Math.max(0, toGamma(c)))) as Rgb
}

export const hex = (c: Rgb) =>
  '#' +
  c
    .map((v) =>
      Math.round(Math.min(1, Math.max(0, v)) * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')

/** '#a1b2c3' or 'a1b2c3' (or the three-digit kind) to sRGB, or null */
export function parseHex(s: string): Rgb | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(s.trim())
  if (!m) return null
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1]
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255) as Rgb
}

const dist2 = (a: Lab, b: Lab) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2

/* ---------------------------------------------------------------- readability ----------------- */

/** WCAG 2's relative luminance */
export const luminance = ([r, g, b]: Rgb) =>
  0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b)

/** WCAG 2's contrast ratio, 1 to 21 */
export function contrast(a: Rgb, b: Rgb): number {
  const x = luminance(a)
  const y = luminance(b)
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

/** what a pair is good for as text on a background, by WCAG 2's thresholds */
export function grade(ratio: number): 'AAA' | 'AA' | 'large' | 'no' {
  if (ratio >= 7) return 'AAA'
  if (ratio >= 4.5) return 'AA'
  if (ratio >= 3) return 'large'
  return 'no'
}

/* ---------------------------------------------------------------- finding a palette ----------- */

export const MIN_COLOURS = 2
export const MAX_COLOURS = 10

/** a picture's pixels as OKLab triples, `step` apart so a big picture costs no more than a small */
export function samples(rgba: Uint8ClampedArray | Uint8Array, step = 1): Float32Array {
  const n = Math.floor(rgba.length / 4 / step)
  const out = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    const o = i * step * 4
    out.set(oklab([rgba[o] / 255, rgba[o + 1] / 255, rgba[o + 2] / 255]), i * 3)
  }
  return out
}

const at = (s: Float32Array, i: number): Lab => [s[i * 3], s[i * 3 + 1], s[i * 3 + 2]]

/** the index of the centre nearest a colour */
export function nearest(centres: readonly Lab[], c: Lab): number {
  let best = 0
  let bd = Infinity
  centres.forEach((k, i) => {
    const d = dist2(k, c)
    if (d < bd) {
      bd = d
      best = i
    }
  })
  return best
}

export type Found = {
  /** the palette, darkest first */
  colours: Lab[]
  /** how much of the picture each one is nearest to, 0..1, in the same order */
  share: number[]
  /** which of `colours` were held still because they were locked */
  locked: boolean[]
}

/**
 * k colours that best stand for a picture: k-means in OKLab. Locked colours are centres that never
 * move — the rest settle round them, so "keep these two and find me three more" means what it says.
 * Seeded k-means++, so a seed is a palette and Re-roll is a new seed.
 */
export function findPalette(
  s: Float32Array,
  k: number,
  seed: number,
  locked: readonly Lab[] = [],
): Found {
  const n = s.length / 3
  const want = Math.min(MAX_COLOURS, Math.max(MIN_COLOURS, Math.round(k)))
  const fixed = locked.slice(0, want)
  const rand = rng(seed)
  const centres: Lab[] = fixed.map((c) => [...c] as Lab)
  if (n === 0) {
    while (centres.length < want) centres.push([0.5, 0, 0])
    return order(centres, new Array(want).fill(0), fixed.length)
  }
  // k-means++: each new centre is drawn with odds by its squared distance from those chosen
  const d = new Float64Array(n)
  const refresh = () => {
    let total = 0
    for (let i = 0; i < n; i++) {
      const p = at(s, i)
      d[i] = centres.length ? Math.min(...centres.map((c) => dist2(c, p))) : 1
      total += d[i]
    }
    return total
  }
  while (centres.length < want) {
    const total = refresh()
    let pick = Math.floor(rand() * n)
    if (total > 0) {
      let r = rand() * total
      for (let i = 0; i < n; i++) {
        r -= d[i]
        if (r <= 0) {
          pick = i
          break
        }
      }
    }
    centres.push(at(s, pick))
  }
  const counts = new Array(want).fill(0)
  const assign = new Int32Array(n)
  for (let round = 0; round < 24; round++) {
    const sums = centres.map(() => [0, 0, 0])
    counts.fill(0)
    for (let i = 0; i < n; i++) {
      const p = at(s, i)
      const j = nearest(centres, p)
      assign[i] = j
      counts[j]++
      sums[j][0] += p[0]
      sums[j][1] += p[1]
      sums[j][2] += p[2]
    }
    let moved = 0
    for (let j = fixed.length; j < want; j++) {
      if (counts[j] === 0) {
        // an empty centre goes to the point worst served by the others
        let far = 0
        let fd = -1
        for (let i = 0; i < n; i++) {
          const dd = dist2(centres[assign[i]], at(s, i))
          if (dd > fd) {
            fd = dd
            far = i
          }
        }
        centres[j] = at(s, far)
        moved += 1
        continue
      }
      const next: Lab = [sums[j][0] / counts[j], sums[j][1] / counts[j], sums[j][2] / counts[j]]
      moved += dist2(next, centres[j])
      centres[j] = next
    }
    if (moved < 1e-9) break
  }
  return order(
    centres,
    counts.map((c) => c / n),
    fixed.length,
  )
}

function order(centres: Lab[], share: number[], fixed: number): Found {
  const idx = centres.map((_, i) => i).sort((a, b) => centres[a][0] - centres[b][0] || a - b)
  return {
    colours: idx.map((i) => centres[i]),
    share: idx.map((i) => share[i]),
    locked: idx.map((i) => i < fixed),
  }
}

/** how well a palette stands for the picture: the mean OKLab distance to the nearest colour */
export function error(s: Float32Array, centres: readonly Lab[]): number {
  const n = s.length / 3
  if (!n) return 0
  let e = 0
  for (let i = 0; i < n; i++) {
    const p = at(s, i)
    e += Math.sqrt(dist2(centres[nearest(centres, p)], p))
  }
  return e / n
}

/* ---------------------------------------------------------------- what leaves the page -------- */

export const asHexList = (cs: readonly Rgb[]) => cs.map(hex).join(' ')
export const asCss = (cs: readonly Rgb[]) =>
  ':root {\n' + cs.map((c, i) => `  --palette-${i + 1}: ${hex(c)};`).join('\n') + '\n}\n'

/* ---------------------------------------------------------------- kept in this browser -------- */

export const PALETTES_KEY = 'lab_palettes_v1'
export const MAX_KEPT = 24

export type Kept = { colours: string[]; at: number }

/** the kept palettes, newest first — anything that is not one is dropped, not repaired */
export function readKept(text: string | null): Kept[] {
  try {
    const v = JSON.parse(text ?? '[]') as unknown
    if (!Array.isArray(v)) return []
    const out: Kept[] = []
    for (const p of v) {
      const colours = (p as Kept)?.colours
      const when = (p as Kept)?.at
      if (!Array.isArray(colours)) continue
      if (colours.length < MIN_COLOURS || colours.length > MAX_COLOURS) continue
      if (!colours.every((c) => typeof c === 'string' && parseHex(c) && c.startsWith('#'))) continue
      if (typeof when !== 'number' || !Number.isFinite(when)) continue
      out.push({ colours: colours.map((c) => c.toLowerCase()), at: when })
      if (out.length === MAX_KEPT) break
    }
    return out
  } catch {
    return []
  }
}

/** keep one more — refused (null) when the shelf is full, never by dropping the oldest */
export function keep(list: readonly Kept[], colours: readonly Rgb[], when: number): Kept[] | null {
  const hexes = colours.map(hex)
  // the same palette twice is kept once, brought to the front — which needs no room
  const rest = list.filter((p) => p.colours.join() !== hexes.join())
  if (rest.length >= MAX_KEPT) return null
  return [{ colours: hexes, at: when }, ...rest]
}

/* ---------------------------------------------------------------- for the GPU ----------------- */

/** each colour as (L, a, b, chosen?) then its sRGB (r, g, b, 1): what the view shader reads */
export function packPalette(colours: readonly Lab[], highlight: number): Float32Array<ArrayBuffer> {
  const out = new Float32Array(MAX_COLOURS * 8)
  colours.slice(0, MAX_COLOURS).forEach((c, i) => {
    out.set([c[0], c[1], c[2], i === highlight ? 1 : 0, ...srgb(c), 1], i * 8)
  })
  return out
}

/* ---------------------------------------------------------------- the view -------------------- */

/** a picture fitted whole into the stage: stage pixels per picture pixel, and its top-left */
export function fitImage(stage: [number, number], img: [number, number]) {
  const s = Math.min(stage[0] / Math.max(1, img[0]), stage[1] / Math.max(1, img[1]))
  return { s, ox: (stage[0] - img[0] * s) / 2, oy: (stage[1] - img[1] * s) / 2 }
}

/** a stage point to the picture pixel under it, or null off the picture */
export function toImage(
  f: ReturnType<typeof fitImage>,
  img: [number, number],
  p: [number, number],
): [number, number] | null {
  const x = Math.floor((p[0] - f.ox) / f.s)
  const y = Math.floor((p[1] - f.oy) / f.s)
  return x >= 0 && y >= 0 && x < img[0] && y < img[1] ? [x, y] : null
}
