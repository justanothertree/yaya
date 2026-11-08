/**
 * The Lab's colour-vision tool: what a picture, or a pair of colours, looks like to someone with a
 * colour-vision deficiency — and whether two colours that differ for you still differ for them.
 * Pure, so vision.test.ts can ask it about any colour without a GPU; the shader applies the same
 * 3×3 matrices this module makes.
 *
 * ⚠️ A SIMULATION, AND THE PAGE SAYS SO. The red-green kinds follow Viénot, Brettel & Mollon (1999):
 * in cone space, the missing cone's response is replaced by the mix of the other two that leaves
 * white and the screen's blue and yellow unchanged — a projection onto the plane of colours a
 * dichromat and a typical viewer agree on. Blue-yellow (tritan) uses the same one-plane method
 * through white and red, which is rougher than Brettel's two half-planes, and is labelled rougher.
 * A partial deficiency is a straight mix between typical and full — a common approximation, not a
 * model of anomalous trichromacy. Nobody's vision is a formula; this shows the kind of collapse,
 * not what any one person sees.
 *
 * The matrices are DERIVED here from two standard ones rather than copied as constants: sRGB to
 * CIE XYZ under D65 (IEC 61966-2-1) and XYZ to cone responses (Hunt–Pointer–Estévez). That makes
 * the method's own definition something a test can ask about.
 */

export type M3 = [number, number, number, number, number, number, number, number, number]
export type V3 = [number, number, number]

export const mul = (m: M3, v: V3): V3 => [
  m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
  m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
  m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
]
export const mmul = (a: M3, b: M3): M3 => {
  const o = new Array(9).fill(0) as M3
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++)
      for (let k = 0; k < 3; k++) o[r * 3 + c] += a[r * 3 + k] * b[k * 3 + c]
  return o
}
export const det = (m: M3) =>
  m[0] * (m[4] * m[8] - m[5] * m[7]) -
  m[1] * (m[3] * m[8] - m[5] * m[6]) +
  m[2] * (m[3] * m[7] - m[4] * m[6])
export function inv(m: M3): M3 {
  const d = det(m)
  return [
    (m[4] * m[8] - m[5] * m[7]) / d,
    (m[2] * m[7] - m[1] * m[8]) / d,
    (m[1] * m[5] - m[2] * m[4]) / d,
    (m[5] * m[6] - m[3] * m[8]) / d,
    (m[0] * m[8] - m[2] * m[6]) / d,
    (m[2] * m[3] - m[0] * m[5]) / d,
    (m[3] * m[7] - m[4] * m[6]) / d,
    (m[1] * m[6] - m[0] * m[7]) / d,
    (m[0] * m[4] - m[1] * m[3]) / d,
  ]
}
export const IDENTITY: M3 = [1, 0, 0, 0, 1, 0, 0, 0, 1]

/** linear sRGB to CIE XYZ, D65 white (IEC 61966-2-1) */
export const XYZ_FROM_RGB: M3 = [
  0.4124564, 0.3575761, 0.1804375, 0.2126729, 0.7151522, 0.072175, 0.0193339, 0.119192, 0.9503041,
]
/** XYZ to long, medium and short cone responses (Hunt–Pointer–Estévez) */
export const LMS_FROM_XYZ: M3 = [0.38971, 0.68898, -0.07868, -0.22981, 1.1834, 0.04641, 0, 0, 1]
export const LMS_FROM_RGB = mmul(LMS_FROM_XYZ, XYZ_FROM_RGB)
export const RGB_FROM_LMS = inv(LMS_FROM_RGB)

export type Kind = 'typical' | 'protan' | 'deutan' | 'tritan' | 'achromat'
export const KINDS: { id: Kind; name: string; cone: string; rough?: true }[] = [
  { id: 'typical', name: 'Typical colour vision', cone: '' },
  { id: 'protan', name: 'Protan — red-weak or red-blind', cone: 'long' },
  { id: 'deutan', name: 'Deutan — green-weak or green-blind', cone: 'medium' },
  { id: 'tritan', name: 'Tritan — blue-weak or blue-blind', cone: 'short', rough: true },
  { id: 'achromat', name: 'No colour — achromatopsia', cone: '' },
]

/**
 * The full dichromat simulation as one matrix on linear sRGB. `missing` is the cone (0 L, 1 M,
 * 2 S); its response becomes a·(one other) + b·(the third), solved so the two anchors keep exactly
 * the response they had — so they, and every mix of them, look the same to both viewers.
 */
export function dichromat(missing: 0 | 1 | 2, anchorA: V3, anchorB: V3): M3 {
  const [p, q] = [0, 1, 2].filter((i) => i !== missing) as [number, number]
  const A = mul(LMS_FROM_RGB, anchorA)
  const B = mul(LMS_FROM_RGB, anchorB)
  // solve A[missing] = a·A[p] + b·A[q], B[missing] = a·B[p] + b·B[q]
  const d = A[p] * B[q] - A[q] * B[p]
  const a = (A[missing] * B[q] - A[q] * B[missing]) / d
  const b = (A[p] * B[missing] - A[missing] * B[p]) / d
  const P = [...IDENTITY] as M3
  P[missing * 3 + missing] = 0
  P[missing * 3 + p] = a
  P[missing * 3 + q] = b
  return mmul(RGB_FROM_LMS, mmul(P, LMS_FROM_RGB))
}

const WHITE: V3 = [1, 1, 1]
export const FULL: Record<Exclude<Kind, 'typical' | 'achromat'>, M3> = {
  // Viénot 1999: the plane through white and the screen's blue (yellow = white − blue comes with it)
  protan: dichromat(0, WHITE, [0, 0, 1]),
  deutan: dichromat(1, WHITE, [0, 0, 1]),
  // the rougher one: one plane through white and red (cyan = white − red comes with it)
  tritan: dichromat(2, WHITE, [1, 0, 0]),
}
/** relative luminance weights of linear sRGB (the Y row of XYZ_FROM_RGB) */
export const LUMA: V3 = [0.2126729, 0.7151522, 0.072175]
const ACHROMAT: M3 = [...LUMA, ...LUMA, ...LUMA] as M3

/** the matrix for a kind at a severity (0 typical, 1 full), on linear sRGB */
export function simulation(kind: Kind, severity = 1): M3 {
  if (kind === 'typical') return [...IDENTITY] as M3
  const full = kind === 'achromat' ? ACHROMAT : FULL[kind]
  const s = Math.max(0, Math.min(1, severity))
  return full.map((v, i) => IDENTITY[i] * (1 - s) + v * s) as M3
}

/* --------------------------------------------------------------------------- colour maths */

/** sRGB (0..1) to linear light — IEC 61966-2-1 */
export const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)
export const toSrgb = (l: number) => {
  const c = Math.max(0, Math.min(1, l))
  return c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055
}

export function parseHex(h: string): V3 | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(h.trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]
}
export const hex = (c: V3) =>
  '#' +
  c
    .map((v) =>
      Math.round(Math.max(0, Math.min(1, v)) * 255)
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')

/** an sRGB colour as a viewer of `kind` would see it, back in sRGB (0..1) */
export function seen(c: V3, kind: Kind, severity = 1): V3 {
  const lin = mul(simulation(kind, severity), c.map(toLinear) as V3)
  return lin.map(toSrgb) as V3
}

/** WCAG 2 relative luminance of an sRGB colour — its own transfer threshold, 0.03928 */
export function luminance(c: V3): number {
  const l = c.map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2]
}
/** WCAG 2 contrast ratio, 1 to 21 */
export function contrast(a: V3, b: V3): number {
  const [x, y] = [luminance(a), luminance(b)]
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}

/** CIELAB under D65, from sRGB */
export function lab(c: V3): V3 {
  const [X, Y, Z] = mul(XYZ_FROM_RGB, c.map(toLinear) as V3)
  const n = [0.95047, 1, 1.08883]
  const f = (t: number) => (t > (6 / 29) ** 3 ? Math.cbrt(t) : t / (3 * (6 / 29) ** 2) + 4 / 29)
  const [fx, fy, fz] = [f(X / n[0]), f(Y / n[1]), f(Z / n[2])]
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)]
}
/** the CIE 1976 colour difference: about 2.3 is just noticeable side by side */
export const deltaE = (a: V3, b: V3) => {
  const [p, q] = [lab(a), lab(b)]
  return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2])
}

/** a pair of colours in words, by their difference as this viewer sees them */
export function apartness(d: number): string {
  if (d < 2.3) return 'the same colour'
  if (d < 10) return 'hard to tell apart'
  if (d < 25) return 'apart, but close'
  return 'clearly apart'
}

/* ---------------------------------------------------------------------------- what is kept */

export const VISION_KEY = 'lab_vision_v1'
export type Saved = { kind: Kind; severity: number; a: string; b: string }
export const EMPTY: Saved = { kind: 'deutan', severity: 1, a: '#d62728', b: '#2ca02c' }
export function readSaved(text: string | null): Saved {
  const out = { ...EMPTY }
  let v: unknown
  try {
    v = JSON.parse(text ?? 'null')
  } catch {
    return out
  }
  if (typeof v !== 'object' || !v || Array.isArray(v)) return out
  const o = v as Record<string, unknown>
  if (KINDS.some((k) => k.id === o.kind)) out.kind = o.kind as Kind
  if (typeof o.severity === 'number' && o.severity >= 0 && o.severity <= 1)
    out.severity = o.severity
  if (typeof o.a === 'string' && parseHex(o.a)) out.a = hex(parseHex(o.a)!)
  if (typeof o.b === 'string' && parseHex(o.b)) out.b = hex(parseHex(o.b)!)
  return out
}
