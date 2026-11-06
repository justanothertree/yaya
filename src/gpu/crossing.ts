/**
 * The arithmetic of the Lab's night crossing: a boat crossing a rocky channel at night, played by two
 * people with different jobs. The PILOT steers and sets the speed; the KEEPER aims the boat's
 * searchlight and chooses between a narrow beam that reaches far and a wide one that does not. Only
 * what the beam lights can be seen — rocks throw shadows behind them — and a rock once lit stays
 * faintly remembered for a few seconds. One person can do both, with a key hand and a mouse hand.
 *
 * ⚠️ THE GPU LIGHTS AND REMEMBERS; THE RULES ARE HERE. The shader's `remember` pass keeps a map of the
 * channel, each texel the brightest it has been lit lately; whether a point is lit is `lightAt` here,
 * line for line (in range, inside the beam, no rock in the way). The course, the boat, the rocks it
 * hits and the buoys it rings are CPU and deterministic, and crossing.test.ts plays them.
 */

export type V2 = [number, number]
/** the channel: its width, and the far end where the harbour is */
export const WIDE = 12
export const BOAT_R = 0.35
/** the corridor every course keeps clear of rock, either side of its line */
export const CLEAR = 1.3
/** the pilot's boat: cruising and full speed, how fast it turns, how quickly it comes up to speed */
export const BOAT = { slow: 1.2, cruise: 2.4, fast: 4.2, turn: 1.9, ease: 1.6 }
/** the beam: range for a narrow and a wide beam, their half-angles, and how many hits the hull takes */
export const BEAM = { narrowRange: 13, wideRange: 5.5, narrow: 0.16, wide: 0.75 }
export const HULL = 3
/** how fast the memory of a lit rock fades, a second (seen *= FADE^dt) */
export const FADE = 0.55

export type Rock = [number, number, number]

export type Course = {
  name: string
  length: number
  /** the corridor's line: x at each whole unit of y */
  line: number[]
  rocks: Rock[]
  buoys: V2[]
}

/** a small seeded random number generator, so a crossing is the same every time */
export function lcg(seed: number) {
  let s = seed >>> 0 || 1
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

/** the corridor's x at y, between its whole-unit samples */
export function lineAt(c: Course, y: number) {
  const k = Math.max(0, Math.min(c.line.length - 2, Math.floor(y)))
  const t = Math.max(0, Math.min(1, y - k))
  return c.line[k] * (1 - t) + c.line[k + 1] * t
}

/**
 * A crossing from a seed: a corridor that wanders across the channel, rocks scattered everywhere it
 * is not (none within CLEAR of the corridor's line), and a buoy every so often along the corridor.
 */
export function makeCourse(name: string, seed: number, length: number, rocks: number): Course {
  const r = lcg(seed)
  const line: number[] = []
  let x = WIDE / 2
  let drift = 0
  for (let y = 0; y <= length + 1; y++) {
    drift = drift * 0.9 + (r() - 0.5) * 0.5
    x = Math.max(2.2, Math.min(WIDE - 2.2, x + drift))
    line.push(+x.toFixed(3))
  }
  const c: Course = { name, length, line, rocks: [], buoys: [] }
  let tries = 0
  while (c.rocks.length < rocks && tries++ < rocks * 40) {
    const y = 6 + r() * (length - 10)
    const rad = 0.35 + r() * 0.75
    const rx = 0.3 + r() * (WIDE - 0.6)
    // clear of the corridor: measured against the line over the rock's whole height
    let ok = true
    for (let dy = -rad - CLEAR; dy <= rad + CLEAR; dy += 0.25) {
      const lx = lineAt(c, y + dy)
      if (Math.hypot(rx - lx, dy) < rad + CLEAR) ok = false
    }
    if (ok) c.rocks.push([+rx.toFixed(3), +y.toFixed(3), +rad.toFixed(3)])
  }
  for (let y = 12; y < length - 4; y += 14)
    c.buoys.push([+(lineAt(c, y) + (r() - 0.5) * 1.2).toFixed(3), y])
  return c
}

export const COURSES: Course[] = [
  makeCourse('Calm harbour', 7, 60, 40),
  makeCourse('The reef', 21, 90, 90),
  makeCourse('Long night', 33, 130, 150),
]

/* ---------------------------------------------------------------- the light ------------------- */

export type Beam = {
  /** where the lamp is, which way it points (radians, 0 along +x, y up the channel) */
  at: V2
  angle: number
  /** 0 a narrow beam that reaches far, 1 a wide one that does not */
  width: number
}

/** a beam's half-angle and reach, from narrow to wide */
export function beamShape(width: number) {
  const w = Math.max(0, Math.min(1, width))
  return {
    half: BEAM.narrow + (BEAM.wide - BEAM.narrow) * w,
    range: BEAM.narrowRange + (BEAM.wideRange - BEAM.narrowRange) * w,
  }
}

/** whether the segment a→b passes through a rock (its circle shrunk a hair, so a rock lights itself) */
export function blocked(a: V2, b: V2, rocks: readonly Rock[]) {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const len2 = dx * dx + dy * dy || 1e-9
  for (const [rx, ry, rr] of rocks) {
    const t = Math.max(0, Math.min(1, ((rx - a[0]) * dx + (ry - a[1]) * dy) / len2))
    const cx = a[0] + dx * t - rx
    const cy = a[1] + dy * t - ry
    // the far end inside the rock is the rock's own lit face, not a shadow
    const end = Math.hypot(b[0] - rx, b[1] - ry) < rr
    if (!end && cx * cx + cy * cy < (rr * 0.98) ** 2) return true
  }
  return false
}

/**
 * How brightly the beam lights p, 0..1: zero out of range, outside the beam or in a rock's shadow;
 * otherwise brightest on the beam's axis and near the lamp. The shader's `light`, line for line.
 */
export function lightAt(b: Beam, p: V2, rocks: readonly Rock[]) {
  const { half, range } = beamShape(b.width)
  const dx = p[0] - b.at[0]
  const dy = p[1] - b.at[1]
  const d = Math.hypot(dx, dy)
  if (d > range || d < 1e-6) return d < 1e-6 ? 1 : 0
  let off = Math.atan2(dy, dx) - b.angle
  off = Math.atan2(Math.sin(off), Math.cos(off))
  if (Math.abs(off) > half) return 0
  if (blocked(b.at, p, rocks)) return 0
  const axis = 1 - (Math.abs(off) / half) ** 2
  const fall = 1 - (d / range) ** 2
  return Math.max(0, axis * fall)
}

/* ---------------------------------------------------------------- the boat -------------------- */

export type Boat = { x: number; y: number; heading: number; speed: number }
export type Helm = { left: boolean; right: boolean; faster: boolean; slower: boolean }
export type Voyage = {
  boat: Boat
  hull: number
  time: number
  rung: boolean[]
  /** seconds the boat is still shaken from its last hit: it cannot be hit again until it is clear */
  shaken: number
  done: boolean
  wrecked: boolean
  events: ('hit' | 'bell' | 'home' | 'wreck')[]
}

export const setOff = (c: Course): Voyage => ({
  boat: { x: lineAt(c, 1), y: 1, heading: Math.PI / 2, speed: BOAT.cruise },
  hull: HULL,
  time: 0,
  rung: c.buoys.map(() => false),
  shaken: 0,
  done: false,
  wrecked: false,
  events: [],
})

/**
 * One step of the crossing: the helm turns the boat and sets its speed (it cruises when left alone),
 * it moves, the channel's banks turn it back, a rock it strikes costs a hull point and throws it
 * off, a buoy it passes close to rings, and the far end is the harbour.
 */
export function sail(v: Voyage, c: Course, h: Helm, dt: number) {
  v.events = []
  if (v.done || v.wrecked) return
  const b = v.boat
  v.time += dt
  v.shaken = Math.max(0, v.shaken - dt)
  b.heading += ((h.left ? 1 : 0) - (h.right ? 1 : 0)) * BOAT.turn * dt
  const want = h.faster ? BOAT.fast : h.slower ? BOAT.slow : BOAT.cruise
  b.speed += (want - b.speed) * (1 - Math.exp(-BOAT.ease * dt))
  b.x += Math.cos(b.heading) * b.speed * dt
  b.y += Math.sin(b.heading) * b.speed * dt
  // the banks: no going ashore, and no going back out of the harbour mouth behind you
  if (b.x < BOAT_R || b.x > WIDE - BOAT_R) {
    b.x = Math.max(BOAT_R, Math.min(WIDE - BOAT_R, b.x))
    b.heading = Math.PI - b.heading
  }
  if (b.y < 0.5) {
    b.y = 0.5
    b.heading = -b.heading
  }
  for (const [rx, ry, rr] of c.rocks) {
    const dx = b.x - rx
    const dy = b.y - ry
    const d = Math.hypot(dx, dy)
    const lo = rr + BOAT_R
    if (d < lo && d > 1e-9) {
      b.x = rx + (dx / d) * lo
      b.y = ry + (dy / d) * lo
      // glance off: the boat turns to run along the rock's face, and loses way
      const nx = dx / d
      const ny = dy / d
      const vx = Math.cos(b.heading)
      const vy = Math.sin(b.heading)
      const vn = vx * nx + vy * ny
      if (vn < 0) b.heading = Math.atan2(vy - 2 * vn * ny, vx - 2 * vn * nx)
      b.speed *= 0.4
      if (v.shaken <= 0) {
        v.hull--
        v.shaken = 1
        v.events.push('hit')
        if (v.hull <= 0) {
          v.wrecked = true
          v.events.push('wreck')
          return
        }
      }
    }
  }
  c.buoys.forEach((p, k) => {
    if (!v.rung[k] && Math.hypot(b.x - p[0], b.y - p[1]) < 1.6) {
      v.rung[k] = true
      v.events.push('bell')
    }
  })
  if (b.y >= c.length) {
    v.done = true
    v.events.push('home')
  }
}

/** where the lamp is: at the bow */
export const lampOf = (b: Boat): V2 => [
  b.x + Math.cos(b.heading) * 0.3,
  b.y + Math.sin(b.heading) * 0.3,
]

/* ---------------------------------------------------------------- for the GPU ---------------- */

/** the memory map's texels a unit, and its size for a course */
export const PER = 6
export const mapSize = (c: Course): [number, number] => [
  WIDE * PER,
  Math.ceil((c.length + 2) * PER),
]
export const MAX_ROCKS = 96
export const MAX_BUOYS = 16

/** Hand-packed to match `struct Night` — crossing.test.ts lays the struct out from the shader. */
export const NIGHT = {
  size: 0,
  map: 8,
  cam: 16,
  lamp: 32,
  boat: 48,
  rows: 64,
  rocks: 72,
  buoys: 76,
  time: 80,
  length: 84,
  fade: 88,
  bytes: 96,
} as const

export type NightFrame = {
  w: number
  h: number
  map: [number, number]
  /** the camera's centre and how many units the stage's height shows */
  cam: V2
  span: number
  beam: Beam
  boat: Boat
  shaken: number
  rows: [number, number]
  rocks: number
  buoys: number
  time: number
  length: number
  dt: number
}

export function packNight(f: NightFrame, into = new ArrayBuffer(NIGHT.bytes)) {
  const u = new Uint32Array(into)
  const fl = new Float32Array(into)
  u.set([f.w, f.h, ...f.map], 0)
  fl.set([...f.cam, f.span, 0], NIGHT.cam / 4)
  fl.set([...f.beam.at, f.beam.angle, f.beam.width], NIGHT.lamp / 4)
  fl.set([f.boat.x, f.boat.y, f.boat.heading, f.shaken], NIGHT.boat / 4)
  u.set([...f.rows, Math.min(f.rocks, MAX_ROCKS), Math.min(f.buoys, MAX_BUOYS)], NIGHT.rows / 4)
  fl[NIGHT.time / 4] = f.time
  fl[NIGHT.length / 4] = f.length
  fl[NIGHT.fade / 4] = FADE ** f.dt
  return into
}

/** the rocks near y, at most MAX_ROCKS, nearest first: all the shader needs to light and draw */
export function rocksNear(c: Course, y: number, reach = 22): Rock[] {
  return c.rocks
    .filter((r) => Math.abs(r[1] - y) < reach + r[2])
    .sort((a, b) => Math.abs(a[1] - y) - Math.abs(b[1] - y))
    .slice(0, MAX_ROCKS)
}

/** the map rows the beam can reach, and the camera can see, from a lamp at y: [first, count] */
export function rowsFor(c: Course, y: number, reach = 22): [number, number] {
  const [, rows] = mapSize(c)
  const first = Math.max(0, Math.floor((y - reach) * PER))
  const last = Math.min(rows, Math.ceil((y + reach) * PER))
  return [first, Math.max(0, last - first)]
}

/** a point of the stage to the channel: the camera at `cam`, the height showing `span` units, y up.
 *  The shader's `to_world`, line for line. */
export function toWorld(size: V2, cam: V2, span: number, p: V2): V2 {
  const k = span / size[1]
  return [cam[0] + (p[0] - size[0] / 2) * k, cam[1] - (p[1] - size[1] / 2) * k]
}

export const CROSSING_KEY = 'lab_crossing_v1'
