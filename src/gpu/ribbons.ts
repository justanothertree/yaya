/**
 * The arithmetic of the Lab's ribbons: where each one dances, where a finger draws it, the ring
 * buffer its trail lives in, and the camera. ribbons-move.wgsl places the heads with the same sums;
 * the Lab's GPU probe runs both and compares.
 */

/** Hand-packed to match `struct Ribbons` — ribbons.test.ts lays the struct out from the shader. */
export const RIBBONS = {
  right: 0,
  up: 16,
  fwd: 32,
  eye: 48,
  lead: 64,
  count: 80,
  length: 84,
  head: 88,
  dance: 92,
  pulse: 96,
  kick: 100,
  dt: 104,
  width: 108,
  bytes: 112,
} as const

type V3 = readonly [number, number, number]

/** points in each trail: at 60fps, a little under three seconds of where it has been */
export const LENGTH = 160
export const COUNTS = [6, 12, 24] as const
export const DANCES = { loops: 'Loops', rose: 'Rose', wander: 'Wander' } as const
export type Dance = keyof typeof DANCES
export const DANCE_IDS = Object.keys(DANCES) as Dance[]

/** ⚠️ MIRRORED IN ribbons-move.wgsl; ribbons.test.ts reads them back out of it. */
export const GOLDEN = 2.399963

const fract = (x: number) => x - Math.floor(x)

/**
 * Where ribbon r is dancing towards at time t. Each ribbon has its own phase (a golden angle on
 * from the last, so no two start together) and its own pace, so the same figure is danced by
 * everyone out of step — which is what makes it read as a dance rather than a screensaver.
 */
export function danceAt(r: number, t: number, dance: Dance): [number, number, number] {
  const ph = r * GOLDEN
  const s = 0.8 + 0.4 * fract(r * 0.618034)
  if (dance === 'loops')
    return [
      1.1 * Math.sin(t * s + ph),
      1.1 * Math.sin(1.5 * t * s + ph * 1.3),
      1.1 * Math.sin(0.5 * t * s + ph * 0.7),
    ]
  if (dance === 'rose') {
    const th = t * 0.6 * s + ph
    const rho = Math.cos(3 * th)
    return [1.2 * rho * Math.cos(th), 1.2 * rho * Math.sin(th), 0.4 * Math.sin(2 * th + ph)]
  }
  return [
    0.7 * Math.sin(0.71 * t + ph) + 0.4 * Math.sin(1.93 * t * s + 2 * ph),
    0.7 * Math.sin(0.53 * t + 1.7 * ph) + 0.4 * Math.sin(1.37 * t * s + ph),
    0.7 * Math.sin(0.61 * t + 2.3 * ph) + 0.4 * Math.sin(1.71 * t * s),
  ]
}

/** a ribbon's own place round a leading finger, so a dozen led ribbons swirl rather than pile up */
export function leadOffset(r: number, t: number): [number, number, number] {
  const a = r * GOLDEN + t * 2
  return [0.25 * Math.cos(a), 0.25 * Math.sin(a), 0.15 * Math.sin(a * 0.5 + r)]
}

/**
 * Where ribbon r's head is: its dance, drawn towards its own place round a leading finger by how
 * strongly the finger leads (0..1, eased by the page as a finger lands and lifts).
 *
 * ⚠️ NO SPRING, AND TWO WERE TRIED. A head chasing its dance with a spring trailed it by up to
 * 1.38 — more than the figure is wide (1.2), so Rose never drew a petal — and stiffening it five
 * times over still left 0.53. A sprung DISPLACEMENT towards the finger lagged the same way, since
 * the dance it is measured from keeps moving. Any follower lags a moving target; a blend of two
 * places that are each exact does not, so an unled ribbon draws its figure exactly and a led one
 * circles the finger exactly, and the easing of the strength is the swoop between them.
 */
export function headAt(
  r: number,
  t: number,
  dance: Dance,
  lead: readonly [number, number, number, number],
): [number, number, number] {
  const g = danceAt(r, t, dance)
  const o = leadOffset(r, t)
  const k = smooth(lead[3])
  return [0, 1, 2].map((i) => g[i] + (lead[i] + o[i] - g[i]) * k) as [number, number, number]
}
/** WGSL's smoothstep(0, 1, x) */
export const smooth = (x: number) => {
  const c = Math.max(0, Math.min(1, x))
  return c * c * (3 - 2 * c)
}

/** which slot of the ring holds the point `age` frames old, when the newest is at `head` */
export const slotOf = (head: number, age: number, length = LENGTH) =>
  (head + length - (age % length)) % length

export type Camera = { eye: V3; right: V3; up: V3; fwd: V3; focal: number }

const norm = (a: V3): V3 => {
  const l = Math.hypot(...a) || 1
  return [a[0] / l, a[1] / l, a[2] / l]
}
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

/**
 * A camera drifting slowly round the middle, a little above and below, always looking at it —
 * framed so the dances (which reach about 1.9 from the middle) fit across the SHORTER side, so a
 * phone held upright sees the whole figure rather than its middle.
 */
export function orbit(t: number, aspect: number): Camera {
  const a = t * 0.12
  const D = 3.6
  const eye: V3 = [D * Math.sin(a), 0.9 * Math.sin(t * 0.07), D * Math.cos(a)]
  const fwd = norm([-eye[0], -eye[1], -eye[2]])
  const right = norm(cross(fwd, [0, 1, 0]))
  const up = cross(right, fwd)
  return { eye, right, up, fwd, focal: 2 * Math.min(1, aspect) }
}

/** where a point lands on the canvas, in pixels — or null behind the camera */
export function project(c: Camera, p: V3, w: number, h: number): [number, number] | null {
  const rel: V3 = [p[0] - c.eye[0], p[1] - c.eye[1], p[2] - c.eye[2]]
  const z = dot(rel, c.fwd)
  if (z <= 0) return null
  const aspect = w / h
  const x = (dot(rel, c.right) * c.focal) / aspect / z
  const y = (dot(rel, c.up) * c.focal) / z
  return [((x + 1) / 2) * w, ((1 - y) / 2) * h]
}

/**
 * The point under a finger, on the plane through the middle that faces the camera — so a
 * finger leads the ribbons to where it appears to be, whichever way the camera has drifted.
 */
export function leadAt(c: Camera, px: number, py: number, w: number, h: number): V3 {
  const aspect = w / h
  const x = ((px / w) * 2 - 1) * aspect
  const y = 1 - (py / h) * 2
  const d = norm(
    [0, 1, 2].map((i) => c.fwd[i] * c.focal + c.right[i] * x + c.up[i] * y) as unknown as V3,
  )
  const t = -dot(c.eye, c.fwd) / dot(d, c.fwd)
  return [c.eye[0] + d[0] * t, c.eye[1] + d[1] * t, c.eye[2] + d[2] * t]
}

export type RibbonFrame = {
  cam: Camera
  aspect: number
  time: number
  lead: readonly [number, number, number, number]
  count: number
  head: number
  dance: Dance
  pulse: number
  kick: number
  dt: number
  width: number
}

export function packRibbons(p: RibbonFrame, into = new ArrayBuffer(RIBBONS.bytes)) {
  const f = new Float32Array(into)
  const u = new Uint32Array(into)
  f.set([...p.cam.right, p.aspect], RIBBONS.right / 4)
  f.set([...p.cam.up, p.time], RIBBONS.up / 4)
  f.set([...p.cam.fwd, p.cam.focal], RIBBONS.fwd / 4)
  f.set([...p.cam.eye, 0], RIBBONS.eye / 4)
  f.set(p.lead, RIBBONS.lead / 4)
  u[RIBBONS.count / 4] = p.count
  u[RIBBONS.length / 4] = LENGTH
  u[RIBBONS.head / 4] = p.head
  u[RIBBONS.dance / 4] = DANCE_IDS.indexOf(p.dance)
  f[RIBBONS.pulse / 4] = p.pulse
  f[RIBBONS.kick / 4] = p.kick
  f[RIBBONS.dt / 4] = p.dt
  f[RIBBONS.width / 4] = p.width
  return into
}
