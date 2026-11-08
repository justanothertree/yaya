/**
 * The Lab's paint mixer: drops of five paints into a cup, to match a colour.
 *
 * ⚠️ PAINT IS NOT LIGHT, AND AVERAGING RGB MIXES LIGHT. Yellow paint and blue paint make green
 * because each ABSORBS what the other reflects — yellow swallows blue light, blue swallows red and
 * yellow, and the green both let through is what is left. Average their screen colours and you get
 * grey. So each paint here is a reflectance across sixteen wavelengths from 400 to 700 nm, turned
 * into how strongly it absorbs against how strongly it scatters (Kubelka–Munk K/S), and a mix is
 * the K/S of its parts in proportion. Only at the end is the mixture's reflectance lit by daylight
 * (D65), seen through the CIE 1931 observer and written as sRGB. Single-constant Kubelka–Munk is
 * a simplification — real paints scatter differently — but it gets the thing that matters right:
 * which way a mixture goes.
 *
 * Pure, so all of it can be asked a question without a browser.
 */

import { hex, oklab, toGamma, type Rgb } from './palette'

export const WAVES = Array.from({ length: 16 }, (_, i) => 400 + i * 20)

/** CIE 1931 2° observer, x̄ ȳ z̄ at 400, 420 … 700 nm */
const CMF: [number, number, number][] = [
  [0.01431, 0.000396, 0.06785],
  [0.13438, 0.004, 0.6456],
  [0.34828, 0.023, 1.74706],
  [0.2908, 0.06, 1.6692],
  [0.09564, 0.13902, 0.81295],
  [0.0049, 0.323, 0.272],
  [0.06327, 0.71, 0.07825],
  [0.2904, 0.954, 0.0203],
  [0.5945, 0.995, 0.0039],
  [0.9163, 0.87, 0.00165],
  [1.0622, 0.631, 0.0008],
  [0.85445, 0.381, 0.00019],
  [0.4479, 0.175, 0.00002],
  [0.1649, 0.061, 0],
  [0.04677, 0.017, 0],
  [0.01136, 0.0041, 0],
]
/** CIE D65 daylight, relative power at the same wavelengths */
const D65 = [
  82.75, 93.43, 104.86, 117.81, 115.92, 109.35, 104.79, 104.41, 100.0, 95.79, 90.01, 87.7, 83.7,
  80.21, 78.28, 71.61,
]

/** a smooth step from `lo` to `hi` reflectance, centred at `at` nm, `width` nm wide */
const ramp = (lo: number, hi: number, at: number, width: number) => (w: number) =>
  lo + (hi - lo) / (1 + Math.exp(-(w - at) / width))

export type Paint = { id: string; name: string; reflect: number[] }

/** the five paints: a reflectance at each wavelength, shaped like the real pigment's */
export const PAINTS: Paint[] = [
  { id: 'white', name: 'White', reflect: WAVES.map(() => 0.93) },
  { id: 'black', name: 'Black', reflect: WAVES.map(() => 0.012) },
  // a warm yellow: swallows violet and blue, gives back green, yellow and red
  { id: 'yellow', name: 'Yellow', reflect: WAVES.map(ramp(0.04, 0.88, 492, 11)) },
  // ultramarine-like: gives back violet and blue, swallows the rest, a little red again at the end
  {
    id: 'blue',
    name: 'Blue',
    reflect: WAVES.map((w) => ramp(0.5, 0.03, 528, 13)(w) + (w >= 680 ? 0.03 : 0)),
  },
  // a crimson: swallows green, gives back red and a little violet
  {
    id: 'red',
    name: 'Red',
    reflect: WAVES.map(
      (w) => ramp(0.03, 0.85, 588, 9)(w) + 0.32 * Math.exp(-(((w - 410) / 28) ** 2)),
    ),
  },
]
export const PAINT_IDS = PAINTS.map((p) => p.id)

const ks = (r: number) => ((1 - r) * (1 - r)) / (2 * r)
const fromKs = (k: number) => 1 + k - Math.sqrt(k * k + 2 * k)
const KS = PAINTS.map((p) => p.reflect.map(ks))

/** drops of each paint, in PAINTS order */
export type Drops = number[]
export const total = (d: Drops) => d.reduce((a, b) => a + b, 0)

/** the mixture's reflectance at each wavelength; an empty cup is white card */
export function reflectance(d: Drops): number[] {
  const n = total(d)
  if (!n) return WAVES.map(() => 0.9)
  return WAVES.map((_, i) => fromKs(d.reduce((sum, c, p) => sum + c * KS[p][i], 0) / n))
}

const WHITE = (() => {
  // what a perfect white reflector looks like through the same sums, so it lands on sRGB white
  const xyz = toXyz(WAVES.map(() => 1))
  return xyzToLinear(xyz)
})()

function toXyz(r: number[]): [number, number, number] {
  let x = 0
  let y = 0
  let z = 0
  let norm = 0
  r.forEach((v, i) => {
    x += D65[i] * v * CMF[i][0]
    y += D65[i] * v * CMF[i][1]
    z += D65[i] * v * CMF[i][2]
    norm += D65[i] * CMF[i][1]
  })
  return [x / norm, y / norm, z / norm]
}
function xyzToLinear([x, y, z]: [number, number, number]): [number, number, number] {
  return [
    3.2406 * x - 1.5372 * y - 0.4986 * z,
    -0.9689 * x + 1.8758 * y + 0.0415 * z,
    0.0557 * x - 0.204 * y + 1.057 * z,
  ]
}

/** a reflectance as it looks in daylight, in sRGB 0..1 */
export function seen(r: number[]): Rgb {
  const lin = xyzToLinear(toXyz(r))
  return lin.map((c, i) => Math.min(1, Math.max(0, toGamma(c / WHITE[i])))) as Rgb
}

export const colourOf = (d: Drops): Rgb => seen(reflectance(d))

/** how different two colours look: distance in OKLab, where 0.02 is about the least anyone notices */
export function difference(a: Rgb, b: Rgb): number {
  const p = oklab(a)
  const q = oklab(b)
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])
}

/** close enough to call it a match — a little over what most people can tell apart side by side */
export const MATCH = 0.03
export const MAX_DROPS = 24

/** every way to put up to `most` drops in the cup */
function* recipes(most: number, k = PAINTS.length): Generator<Drops> {
  if (k === 1) {
    for (let n = 0; n <= most; n++) yield [n]
    return
  }
  for (let n = 0; n <= most; n++) for (const rest of recipes(most - n, k - 1)) yield [n, ...rest]
}

/** the fewest drops that match a colour, and one recipe that does; null if none in `most` drops */
export function fewest(target: Rgb, most = 12): { drops: Drops; n: number } | null {
  let best: { drops: Drops; n: number } | null = null
  for (const d of recipes(most)) {
    const n = total(d)
    if (!n || (best && n >= best.n)) continue
    if (difference(colourOf(d), target) < MATCH) best = { drops: d, n }
  }
  return best
}

/**
 * The fewest drops to ADD to what is in the cup to reach a match — paint cannot be taken out, so
 * this is the only honest question a hint can answer. Null when no handful of drops will do it:
 * too much of something is in already, and the cup has to be emptied.
 *
 * ⚠️ NOT "the single drop that gets closest". That greedy hint was tried first and walked into
 * corners — it put white into Plum early because white was nearest the empty cup, and from there
 * no amount of anything reaches Plum. A plan looks ahead; a nearest step does not.
 */
export function plan(d: Drops, target: Rgb, most = 12): Drops | null {
  if (difference(colourOf(d), target) < MATCH && total(d)) return PAINTS.map(() => 0)
  let best: Drops | null = null
  let bestN = Infinity
  for (const add of recipes(most)) {
    const n = total(add)
    if (!n || n >= bestN || total(d) + n > MAX_DROPS) continue
    if (difference(colourOf(d.map((c, i) => c + add[i])), target) < MATCH) {
      best = add
      bestN = n
    }
  }
  return best
}

/** what a hint suggests: the paint the plan adds most of, and how many drops the plan needs */
export function hintFor(d: Drops, target: Rgb): { paint: number; left: number } | null {
  const p = plan(d, target)
  if (!p) return null
  const left = total(p)
  if (!left) return { paint: -1, left: 0 }
  return { paint: p.indexOf(Math.max(...p)), left }
}

/* ------------------------------------------------------------------- saying how they differ */

const lch = (c: Rgb) => {
  const [L, a, b] = oklab(c)
  return { L, C: Math.hypot(a, b), h: ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360 }
}
/** OKLCH hue angles: red sits near 30°, orange 60°, yellow 110°, green 145°, blue 260° */
const HUES: [number, string][] = [
  [15, 'pink'],
  [36, 'red'],
  [85, 'orange'],
  [125, 'yellow'],
  [172, 'green'],
  [215, 'teal'],
  [285, 'blue'],
  [335, 'purple'],
  [360, 'pink'],
]
export const hueName = (h: number) => HUES.find(([to]) => h < to)![1]

/** in words, how yours differs from the target: lighter or darker, duller or stronger, and which
 *  way its hue leans — the sentence a painter would say, so nobody has to read a number */
export function describe(yours: Rgb, target: Rgb): string {
  const y = lch(yours)
  const t = lch(target)
  const parts: string[] = []
  if (y.L - t.L > 0.025) parts.push('lighter')
  if (t.L - y.L > 0.025) parts.push('darker')
  if (t.C - y.C > 0.025) parts.push('duller')
  if (y.C - t.C > 0.025) parts.push('stronger')
  if (y.C > 0.03 && t.C > 0.03) {
    const turn = ((y.h - t.h + 540) % 360) - 180
    if (Math.abs(turn) > 12) parts.push(`more ${hueName(y.h)}`)
  }
  if (!parts.length) return difference(yours, target) < MATCH ? 'a match' : 'very nearly there'
  return parts.length === 1
    ? parts[0]
    : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

/* ---------------------------------------------------------------------------- the targets */

export type Target = { name: string; recipe: Drops }
/** each target is made from a recipe, so it can be reached; its par is found, not assumed */
export const TARGETS: Target[] = [
  { name: 'Orange', recipe: [0, 0, 3, 0, 1] },
  { name: 'Plum', recipe: [0, 0, 0, 1, 2] },
  { name: 'Tomato', recipe: [0, 0, 1, 0, 3] },
  { name: 'Leaf', recipe: [0, 0, 3, 1, 0] },
  { name: 'Sky', recipe: [4, 0, 0, 1, 0] },
  { name: 'Rose', recipe: [5, 0, 0, 0, 1] },
  { name: 'Teal', recipe: [2, 0, 1, 3, 0] },
  { name: 'Violet', recipe: [1, 0, 0, 2, 1] },
  { name: 'Chocolate', recipe: [0, 1, 2, 0, 3] },
  { name: 'Peach', recipe: [8, 0, 3, 0, 1] },
  { name: 'Mint', recipe: [5, 0, 2, 1, 0] },
  { name: 'Lavender', recipe: [5, 0, 0, 1, 2] },
]
export const targetColour = (t: Target) => colourOf(t.recipe)

/* ------------------------------------------------------------------------- what is kept */

export const MIX_KEY = 'lab_mix_v1'
export type Saved = { best: Record<string, number> }
export function readSaved(text: string | null): Saved {
  const out: Saved = { best: {} }
  try {
    const v: unknown = JSON.parse(text ?? 'null')
    if (typeof v !== 'object' || !v || Array.isArray(v)) return out
    const best = (v as { best?: unknown }).best
    if (typeof best !== 'object' || !best || Array.isArray(best)) return out
    for (const t of TARGETS) {
      const n = (best as Record<string, unknown>)[t.name]
      if (Number.isInteger(n) && (n as number) > 0 && (n as number) <= MAX_DROPS)
        out.best[t.name] = n as number
    }
  } catch {
    /* a damaged record is an empty one */
  }
  return out
}

export const stars = (par: number, drops: number) => (drops <= par ? 3 : drops <= par + 2 ? 2 : 1)
export { hex }
