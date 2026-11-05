/**
 * The arithmetic of the Lab's black hole: how light bends past it, what its disk looks like, and
 * how it moves when you throw it.
 *
 * ⚠️ EVERY PIXEL FOLLOWS ITS OWN RAY OF LIGHT THROUGH CURVED SPACE. Nothing is drawn and then
 * warped: blackhole.wgsl starts a ray at the eye for each pixel and steps it forward, bending it by
 * the black hole's gravity, until it falls in (black), escapes to the sky (whatever the sky is in
 * the direction it finally points) or crosses the disk (its glow). The bending is Schwarzschild's,
 * written the way ray tracers do it: in ordinary x, y, z, a ray accelerates towards the hole by
 *   a = −(3/2) · rs · h² · p / |p|⁵,   h = |p × v|, which the ray keeps all the way,
 * which reproduces the orbit equation of light, u″ + u = (3/2) · rs · u². Lengths are in
 * Schwarzschild radii, rs = 1. `trace` is the same stepping, so blackhole.test.ts can hold it to
 * the exact deflection integral and to the size of the shadow — numbers that share no arithmetic
 * with the stepping.
 */

/** Hand-packed to match `struct Hole` — blackhole.test.ts lays the struct out from the shader. */
export const HOLE = {
  size: 0,
  time: 8,
  focal: 12,
  at: 16,
  dist: 24,
  tilt: 28,
  roll: 32,
  sky: 36,
  disk: 40,
  steps: 44,
  bytes: 48,
} as const

/** the disk's inner edge — the innermost stable orbit, 3 rs — and its outer edge */
export const R_IN = 3
export const R_OUT = 12
/** how wide the view is: the screen's half-height spans 1 / FOCAL radians, near enough */
export const FOCAL = 1.8
/**
 * The shadow's radius as seen from far away, in rs: light passing closer than b = 3√3/2 · rs
 * spirals in. Not the horizon (1 rs) and not the photon sphere (1.5 rs) — bigger than both, because
 * the hole bends towards itself light that was aimed to miss it.
 */
export const SHADOW = (3 * Math.sqrt(3)) / 2
/** at most this many steps a ray: one that has not escaped by then is circling the hole, and dark */
export const STEPS = 300

export const SKIES = { stars: 'Stars', grid: 'Grid', nebula: 'Nebula' } as const
export type Sky = keyof typeof SKIES
export const SKY_IDS = Object.keys(SKIES) as Sky[]
/** not offered: the sky as the direction each ray escaped in, for the probe */
export const DEBUG_SKY = 3

type V3 = [number, number, number]
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]

/** the pull on light at p, for a ray whose h² (|p × v|²) is h2 — mirrored in blackhole.wgsl */
export function accel(p: V3, h2: number): V3 {
  const r2 = dot(p, p)
  const k = (-1.5 * h2) / (r2 * r2 * Math.sqrt(r2))
  return [p[0] * k, p[1] * k, p[2] * k]
}

/**
 * How far a ray steps at distance r: in proportion to r far out, and shrinking as r² inside r = 4,
 * where light can circle — mirrored in the shader. ⚠️ First written as 0.06·r all the way in, which
 * is a third of a percent out for most rays and drifts badly for the ones grazing the shadow: 0.12
 * of a radian at 1% outside its edge and 0.89 at 0.1%, against the exact integral. With the r² inside
 * it is 0.001 and 0.03, for about a dozen more steps on a ray that comes close.
 */
export const stepAt = (r: number) => Math.min(2, Math.max(0.01, 0.06 * r * Math.min(1, r / 4)))

export type Traced = {
  fate: 'hole' | 'sky' | 'lost'
  /** where it was going when it escaped */
  dir: V3
  steps: number
  /** where it crossed the disk's plane (y = 0) inside the disk, in order */
  crossings: V3[]
}

/**
 * One ray from `o` along `d` (any length), stepped as blackhole.wgsl steps it — velocity Verlet,
 * `stepAt` long — until it falls in, gets further than `far` going outwards, or runs out of steps.
 */
export function trace(o: V3, d: V3, far: number, steps = STEPS): Traced {
  let p: V3 = [...o]
  const l = Math.hypot(...d)
  let v: V3 = [d[0] / l, d[1] / l, d[2] / l]
  const h = cross(p, v)
  const h2 = dot(h, h)
  const crossings: V3[] = []
  for (let i = 0; i < steps; i++) {
    const r = Math.hypot(...p)
    if (r < 1) return { fate: 'hole', dir: v, steps: i, crossings }
    if (r > far && dot(p, v) > 0) {
      const lv = Math.hypot(...v)
      return { fate: 'sky', dir: [v[0] / lv, v[1] / lv, v[2] / lv], steps: i, crossings }
    }
    const dt = stepAt(r)
    const a = accel(p, h2)
    const pn: V3 = [0, 1, 2].map((k) => p[k] + v[k] * dt + 0.5 * a[k] * dt * dt) as V3
    const an = accel(pn, h2)
    const vn: V3 = [0, 1, 2].map((k) => v[k] + 0.5 * (a[k] + an[k]) * dt) as V3
    if (Math.sign(pn[1]) !== Math.sign(p[1])) {
      const f = p[1] / (p[1] - pn[1])
      const q: V3 = [p[0] + (pn[0] - p[0]) * f, 0, p[2] + (pn[2] - p[2]) * f]
      const rq = Math.hypot(q[0], q[2])
      if (rq > R_IN && rq < R_OUT) crossings.push(q)
    }
    p = pn
    v = vn
  }
  return { fate: 'lost', dir: v, steps, crossings }
}

/**
 * How much the disk's light is shifted where a ray crosses it at q, arriving at the eye along
 * −`v`: the gas orbits (Kepler, turning from +x towards +z), so the side coming towards you is
 * bluer and brighter and the side going away redder and dimmer; and climbing out of the hole's
 * gravity reddens all of it, more near the inside. > 1 is bluer. √(1 − 3M/r) is exact for light
 * leaving an orbit sideways — it is the gravity and the orbit's own slow clock together, so there
 * is no separate γ (blackhole.test.ts caught it counted twice) — and the Doppler beside it is the
 * first-order one. Mirrored in blackhole.wgsl.
 */
export function shiftAt(q: V3, v: V3): number {
  const r = Math.hypot(q[0], q[2])
  const beta = Math.sqrt(0.5 / r)
  const orbit: V3 = [(-q[2] / r) * beta, 0, (q[0] / r) * beta]
  const lv = Math.hypot(...v)
  const toEye: V3 = [-v[0] / lv, -v[1] / lv, -v[2] / lv]
  return Math.sqrt(1 - 1.5 / r) / (1 - dot(orbit, toEye))
}

/** how hot the disk is at radius r, 1 at its hottest: a thin disk's T ∝ r^−¾ (1 − √(r_in/r))^¼ */
export function heatAt(r: number): number {
  const t = (x: number) => x ** -0.75 * (1 - Math.sqrt(R_IN / x)) ** 0.25
  return t(r) / t((R_IN * 49) / 36)
}

/** how far away the eye is, in rs, for a mass: heavier means a bigger hole from the same place */
export const distFor = (mass: number) => 18 / mass
export const MASS = [0.4, 2.5] as const

/**
 * The hole thrown: it glides with the velocity it was let go with, slows, and comes softly back
 * off the edges. Positions are screen units (y −1..1, x −aspect..aspect), velocities per second.
 */
export function glide(
  at: readonly [number, number],
  vel: readonly [number, number],
  dt: number,
  aspect: number,
): { at: [number, number]; vel: [number, number] } {
  const slow = Math.exp(-1.2 * dt)
  let [x, y] = [at[0] + vel[0] * dt, at[1] + vel[1] * dt]
  let [vx, vy] = [vel[0] * slow, vel[1] * slow]
  const edge = [aspect * 0.95, 0.95]
  if (Math.abs(x) > edge[0]) {
    x = Math.sign(x) * edge[0]
    vx = -vx * 0.5
  }
  if (Math.abs(y) > edge[1]) {
    y = Math.sign(y) * edge[1]
    vy = -vy * 0.5
  }
  return { at: [x, y], vel: [vx, vy] }
}

export type HoleFrame = {
  w: number
  h: number
  time: number
  at: readonly [number, number]
  mass: number
  /** how far above the disk the eye is, radians: 0 edge on, π/2 straight down on it */
  tilt: number
  roll: number
  sky: Sky | typeof DEBUG_SKY
  disk: boolean
}

export function packHole(p: HoleFrame, into = new ArrayBuffer(HOLE.bytes)) {
  const u = new Uint32Array(into)
  const f = new Float32Array(into)
  u[0] = p.w
  u[1] = p.h
  f[HOLE.time / 4] = p.time
  f[HOLE.focal / 4] = FOCAL
  f.set(p.at, HOLE.at / 4)
  f[HOLE.dist / 4] = distFor(p.mass)
  f[HOLE.tilt / 4] = p.tilt
  f[HOLE.roll / 4] = p.roll
  u[HOLE.sky / 4] = p.sky === DEBUG_SKY ? DEBUG_SKY : SKY_IDS.indexOf(p.sky)
  u[HOLE.disk / 4] = p.disk ? 1 : 0
  u[HOLE.steps / 4] = STEPS
  return into
}

/**
 * How fast a finger was moving when it let go, screen units a second, from its recent positions
 * (`t` in ms): over the last 100ms of them, and nothing at all if it had stopped for 80ms first.
 * ⚠️ From the FINGER, not from the hole: the hole eases after the finger, and the first version
 * took its speed from that easing — so a hole still catching up with a finger that had already
 * stopped was flung on release, and lifting one finger of a pinch threw it at the other.
 */
export function flingFrom(
  trail: readonly { x: number; y: number; t: number }[],
  now: number,
): [number, number] {
  const last = trail.at(-1)
  if (!last || now - last.t > 80) return [0, 0]
  const recent = trail.filter((s) => last.t - s.t <= 100)
  const first = recent[0]
  const dt = (last.t - first.t) / 1000
  if (dt < 0.01) return [0, 0]
  return [(last.x - first.x) / dt, (last.y - first.y) / dt]
}
