/**
 * The arithmetic of the Lab's tunnel: where the tunnel goes, where its orbs hang, how you fly
 * through it, and the camera. Pure, so all of it can be asked a question without a browser —
 * tunnel.wgsl draws the same tunnel from the same numbers, and the Lab's GPU probe checks that an
 * orb the shader draws is where this file says it is.
 *
 * World units: the tunnel is RADIUS across from its centreline, z runs forward, y is up.
 */

/** Hand-packed to match `struct Tunnel` — tunnel.test.ts lays the struct out from the shader. */
export const TUNNEL = {
  eye: 0,
  fwd: 16,
  right: 32,
  up: 48,
  first: 64,
  ahead: 68,
  prevTaken: 72,
  palette: 76,
  bytes: 80,
} as const

type V2 = readonly [number, number]
type V3 = readonly [number, number, number]

/** ⚠️ THESE ARE MIRRORED IN tunnel.wgsl, and tunnel.test.ts reads them back out of it. */
export const LAP = 240
export const RADIUS = 1.6
export const GAP = 6
/** orb k hangs at z = FIRST_Z + k · GAP */
export const FIRST_Z = 3
/** how far out from the middle an orb may hang, as a share of the radius */
export const REACH = 0.6
export const ORB = 0.16

/** how near an orb has to be when you reach it to count as caught */
export const CATCH = 0.42
/** an orb is reached — caught or missed — when it is this close ahead, just before it would hit you */
export const REACHED = 0.3
/** how far from the middle you can steer: short of the wall, past the furthest orb */
export const ROOM = RADIUS * 0.72
/** orbs the shader is told about at once */
export const WINDOW = 32

/**
 * The tunnel's centreline. Every frequency is a whole number of turns per LAP, so the path repeats
 * exactly every LAP — which is what lets the camera's z be wrapped, keeping the shader's sines on
 * small numbers however far you fly. f32 `sin(z)` at z = 50,000 is already wrong in the third
 * place; wrapped, it never sees more than 240.
 */
export function path(z: number): [number, number] {
  const w = (2 * Math.PI * z) / LAP
  return [
    2.2 * Math.sin(3 * w) + 1.0 * Math.sin(7 * w),
    1.6 * Math.cos(2 * w) + 0.7 * Math.sin(5 * w),
  ]
}

/** PCG's integer hash, in u32 arithmetic as the shader does it — so both agree on every orb. */
export function hash(k: number): number {
  let x = (Math.imul(k >>> 0, 747796405) + 2891336453) >>> 0
  x = Math.imul(((x >>> ((x >>> 28) + 4)) ^ x) >>> 0, 277803737) >>> 0
  x = ((x >>> 22) ^ x) >>> 0
  return x / 4294967295
}

/** where orb k hangs, off the centreline */
export function orbOffset(k: number): [number, number] {
  const a = hash(2 * k) * 2 * Math.PI
  const r = RADIUS * REACH * (0.25 + 0.75 * hash(2 * k + 1))
  return [Math.cos(a) * r, Math.sin(a) * r]
}

export const orbZ = (k: number) => FIRST_Z + k * GAP

export type Flight = {
  /** how far down the tunnel, unwrapped */
  s: number
  /** where you are across it, off the centreline */
  off: V2
  /** the next orb not yet reached */
  first: number
  /** whether the last one reached was caught — it is still just ahead, and must not be drawn */
  prevTaken: boolean
  caught: number
  missed: number
  streak: number
  best: number
}

export const takeOff = (): Flight => ({
  s: 0,
  off: [0, 0],
  first: 0,
  prevTaken: false,
  caught: 0,
  missed: 0,
  streak: 0,
  best: 0,
})

/** how fast you move across the tunnel at full stick: quicker the faster you fly, or warp is hopeless */
export const steerRate = (speed: number) => 1.2 + 0.12 * speed

/**
 * Fly for `dt` seconds at `speed`, steering by `stick` (each axis -1..1). Returns the new flight
 * and how many orbs were caught on the way, so the page can flash.
 */
export function fly(
  f: Flight,
  dt: number,
  stick: V2,
  speed: number,
): { f: Flight; caught: number } {
  const rate = steerRate(speed)
  let x = f.off[0] + stick[0] * rate * dt
  let y = f.off[1] + stick[1] * rate * dt
  const r = Math.hypot(x, y)
  if (r > ROOM) {
    x *= ROOM / r
    y *= ROOM / r
  }
  const s = f.s + speed * dt
  let { first, prevTaken, caught, missed, streak, best } = f
  let now = 0
  while (orbZ(first) - s <= REACHED) {
    const o = orbOffset(first)
    prevTaken = Math.hypot(o[0] - x, o[1] - y) < CATCH
    if (prevTaken) {
      caught++
      now++
      streak++
      best = Math.max(best, streak)
    } else {
      missed++
      streak = 0
    }
    first++
  }
  return { f: { s, off: [x, y], first, prevTaken, caught, missed, streak, best }, caught: now }
}

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const cross = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]
const norm = (a: V3): V3 => {
  const l = Math.hypot(...a) || 1
  return [a[0] / l, a[1] / l, a[2] / l]
}

export type Camera = { eye: V3; fwd: V3; right: V3; up: V3 }

/**
 * Where you are and which way you look. You look down the tunnel from wherever you are in it, a
 * little towards where you are steering, and bank into the turn — `lean` is the stick, smoothed.
 * The eye's z is WRAPPED to one lap; see `path`.
 */
export function camera(f: Flight, lean: V2): Camera {
  const z = ((f.s % LAP) + LAP) % LAP
  const c = path(z)
  const eye: V3 = [c[0] + f.off[0], c[1] + f.off[1], z]
  const ahead = path(z + 4)
  const target: V3 = [
    ahead[0] + f.off[0] + lean[0] * 0.8,
    ahead[1] + f.off[1] + lean[1] * 0.8,
    z + 4,
  ]
  const fwd = norm(sub(target, eye))
  /* bank INTO the turn: steering right tips the sky's up towards the right */
  const roll = lean[0] * 0.35
  const sky: V3 = [Math.sin(roll), Math.cos(roll), 0]
  const right = norm(cross(sky, fwd))
  const up = cross(fwd, right)
  return { eye, fwd, right, up }
}

/** the tunnel's colours: walls, rings, orbs, fog — mirrored by index in tunnel.wgsl */
export const THEMES = { neon: 'Neon', ember: 'Ember', ice: 'Ice', jungle: 'Jungle' } as const
export type Theme = keyof typeof THEMES
export const THEME_IDS = Object.keys(THEMES) as Theme[]

export type Frame = {
  cam: Camera
  time: number
  aspect: number
  speed: number
  /** 1 the moment an orb is caught, falling away */
  flash: number
  f: Pick<Flight, 'first' | 's' | 'prevTaken'>
  theme: Theme
}

export function packTunnel(p: Frame, into = new ArrayBuffer(TUNNEL.bytes)) {
  const v = new Float32Array(into)
  const u = new Uint32Array(into)
  v.set([...p.cam.eye, p.time], TUNNEL.eye / 4)
  v.set([...p.cam.fwd, p.aspect], TUNNEL.fwd / 4)
  v.set([...p.cam.right, p.speed], TUNNEL.right / 4)
  v.set([...p.cam.up, p.flash], TUNNEL.up / 4)
  u[TUNNEL.first / 4] = p.f.first
  v[TUNNEL.ahead / 4] = orbZ(p.f.first) - p.f.s
  u[TUNNEL.prevTaken / 4] = p.f.prevTaken ? 1 : 0
  u[TUNNEL.palette / 4] = THEME_IDS.indexOf(p.theme)
  return into
}

/**
 * Steering by tilting the phone: how far it leans from where it was when tilt was turned on.
 * `beta` is front-to-back (top towards you is positive), `gamma` side to side (right edge down is
 * positive). In landscape the screen's axes are the device's turned by the screen's angle.
 * FULL_TILT degrees is a full stick.
 */
export const FULL_TILT = 22
export function tiltStick(
  beta: number,
  gamma: number,
  rest: { beta: number; gamma: number },
  screenAngle: number,
): [number, number] {
  const dx = gamma - rest.gamma
  const dy = beta - rest.beta
  const a = (-screenAngle * Math.PI) / 180
  const x = dx * Math.cos(a) - dy * Math.sin(a)
  const y = dx * Math.sin(a) + dy * Math.cos(a)
  const c = (v: number) => Math.max(-1, Math.min(1, v / FULL_TILT))
  return [c(x), c(y)]
}
