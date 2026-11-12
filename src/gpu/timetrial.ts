/**
 * Time trial: one car, one track, the clock. Drive laps as fast as you can, race the ghost of your
 * best one, and chase the medal times a computer driver sets. Pure — the tracks, the car, the lap
 * rules, the driver and the ghost format — so timetrial.test.ts can drive thousands of laps
 * without a page; TimeTrialDemo draws it and reads the keys.
 *
 * Distances are metres and times seconds. A track is a closed centreline sampled into points and
 * a width; the car is a point with a heading and a velocity.
 */
import { rng } from './bricks'

export type Vec = { x: number; y: number }
export type Track = {
  id: string
  name: string
  pts: Vec[]
  /** distance along the centreline to each point, and the whole length */
  along: number[]
  length: number
  width: number
}

/** a smooth closed curve through control points, sampled into `n` points (centripetal-ish Catmull-Rom) */
function smooth(ctrl: Vec[], n: number): Vec[] {
  const out: Vec[] = []
  const m = ctrl.length
  for (let k = 0; k < n; k++) {
    const t = (k / n) * m
    const i = Math.floor(t)
    const u = t - i
    const p0 = ctrl[(i - 1 + m) % m]
    const p1 = ctrl[i % m]
    const p2 = ctrl[(i + 1) % m]
    const p3 = ctrl[(i + 2) % m]
    const f = (a: number, b: number, c: number, d: number) =>
      0.5 *
      (2 * b +
        (-a + c) * u +
        (2 * a - 5 * b + 4 * c - d) * u * u +
        (-a + 3 * b - 3 * c + d) * u * u * u)
    out.push({ x: f(p0.x, p1.x, p2.x, p3.x), y: f(p0.y, p1.y, p2.y, p3.y) })
  }
  return out
}
function makeTrack(id: string, name: string, ctrl: Vec[], width: number): Track {
  const pts = smooth(ctrl, 480)
  const along = [0]
  for (let i = 1; i < pts.length; i++)
    along.push(along[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y))
  const last = pts[pts.length - 1]
  const length = along[along.length - 1] + Math.hypot(pts[0].x - last.x, pts[0].y - last.y)
  return { id, name, pts, along, length, width }
}

export const TRACKS: Track[] = [
  makeTrack(
    'ring',
    'The ring',
    Array.from({ length: 8 }, (_, k) => {
      const a = (k / 8) * Math.PI * 2
      return { x: Math.cos(a) * 150, y: Math.sin(a) * 95 }
    }),
    16,
  ),
  makeTrack(
    'harbour',
    'Harbour',
    [
      { x: -160, y: -60 },
      { x: -40, y: -110 },
      { x: 90, y: -100 },
      { x: 170, y: -20 },
      { x: 120, y: 60 },
      { x: 30, y: 20 },
      { x: -30, y: 90 },
      { x: -140, y: 70 },
    ],
    15,
  ),
  makeTrack(
    'hairpins',
    'Hairpins',
    [
      { x: -170, y: -80 },
      { x: 160, y: -90 },
      { x: 175, y: -40 },
      { x: -60, y: -20 },
      { x: -70, y: 20 },
      { x: 160, y: 40 },
      { x: 170, y: 95 },
      { x: -170, y: 90 },
    ],
    14,
  ),
]

/** the nearest point on the track to `p`: which sample, how far along, and how far off the centre */
export function locate(t: Track, p: Vec, hint = -1): { i: number; s: number; off: number } {
  const n = t.pts.length
  let best = 0
  let bd = Infinity
  // near the last answer first: a car never jumps far in one step
  const from = hint >= 0 ? hint - 40 : 0
  const to = hint >= 0 ? hint + 40 : n
  for (let k = from; k < to; k++) {
    const i = ((k % n) + n) % n
    const d = (t.pts[i].x - p.x) ** 2 + (t.pts[i].y - p.y) ** 2
    if (d < bd) {
      bd = d
      best = i
    }
  }
  // refine onto the segment either side of the nearest sample
  let s = t.along[best]
  let off = Math.sqrt(bd)
  for (const j of [best, (best - 1 + n) % n]) {
    const a = t.pts[j]
    const b = t.pts[(j + 1) % n]
    const dx = b.x - a.x
    const dy = b.y - a.y
    const len2 = dx * dx + dy * dy || 1
    const u = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2))
    const d = Math.hypot(a.x + dx * u - p.x, a.y + dy * u - p.y)
    if (d < off) {
      off = d
      s = (t.along[j] + u * Math.sqrt(len2)) % t.length
    }
  }
  return { i: best, s, off }
}

/** whether two parts of a track come too close: a track that touches itself is not a track */
export function selfClear(t: Track): boolean {
  const n = t.pts.length
  for (let i = 0; i < n; i += 2)
    for (let j = i + 2; j < n; j += 2) {
      const gap = Math.abs(t.along[i] - t.along[j])
      const arc = Math.min(gap, t.length - gap)
      if (arc < t.width * 4) continue
      if (Math.hypot(t.pts[i].x - t.pts[j].x, t.pts[i].y - t.pts[j].y) < t.width * 1.9) return false
    }
  return true
}

/** a track for a day: a ring of control points pushed in and out, laid again until it is clean */
export function dailyTrack(seed: number): Track {
  const rand = rng(seed)
  for (let tries = 0; ; tries++) {
    const m = 9 + Math.floor(rand() * 4)
    const ctrl = Array.from({ length: m }, (_, k) => {
      const a = ((k + rand() * 0.5) / m) * Math.PI * 2
      const r = 70 + rand() * 100
      return { x: Math.cos(a) * r * 1.35, y: Math.sin(a) * r }
    })
    const t = makeTrack(`day-${seed}`, "Today's track", ctrl, 15)
    if ((selfClear(t) && sharpest(t) > 16) || tries > 200) return t
  }
}

/** the tightest bend's radius in metres, measured over a few metres so noise does not count */
export function sharpest(t: Track): number {
  const n = t.pts.length
  let min = Infinity
  for (let i = 0; i < n; i++) {
    const a = t.pts[(i - 4 + n) % n]
    const b = t.pts[i]
    const c = t.pts[(i + 4) % n]
    const ab = Math.hypot(b.x - a.x, b.y - a.y)
    const bc = Math.hypot(c.x - b.x, c.y - b.y)
    const ca = Math.hypot(a.x - c.x, a.y - c.y)
    const cross = Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x))
    if (cross < 1e-9) continue
    min = Math.min(min, (ab * bc * ca) / (2 * cross))
  }
  return min
}

/* ---------------------------------------------------------------------------- the car */

export const TOP_SPEED = 46
export const GRASS_SPEED = 14
const ACCEL = 17
const BRAKE = 32
/** the quickest the car can turn, in radians a second, once it is rolling */
export const TURN = 1.8
export type Car = {
  x: number
  y: number
  heading: number
  vx: number
  vy: number
  i: number
  off: number
}
export type Input = { gas: number; brake: number; steer: number }

/** a car just behind the start line, pointing along the track, so its first crossing starts the clock */
export function startCar(t: Track): Car {
  const n = t.pts.length
  const i = n - 6
  const a = t.pts[i]
  const b = t.pts[i + 1]
  return { x: a.x, y: a.y, heading: Math.atan2(b.y - a.y, b.x - a.x), vx: 0, vy: 0, i, off: 0 }
}
export const speedOf = (c: Car) => Math.hypot(c.vx, c.vy)
export const onTrack = (t: Track, c: Car) => c.off <= t.width / 2

/** move the car on by `dt` seconds: throttle and brake along its heading, grip across it */
export function drive(t: Track, c: Car, input: Input, dt: number): Car {
  const grass = c.off > t.width / 2
  const fx = Math.cos(c.heading)
  const fy = Math.sin(c.heading)
  let fwd = c.vx * fx + c.vy * fy
  let side = -c.vx * fy + c.vy * fx
  const top = grass ? GRASS_SPEED : TOP_SPEED
  // throttle fades toward the top speed; the brake stops, and does not reverse
  fwd += input.gas * ACCEL * Math.max(0, 1 - fwd / top) * dt
  if (input.brake) fwd = Math.max(0, fwd - input.brake * BRAKE * dt)
  // rolling resistance, and much more of it on the grass
  fwd -= fwd * (grass ? 1.6 : 0.05) * dt
  // grip: the sideways slide dies away, slower on the grass
  side *= Math.exp(-(grass ? 3 : 9) * dt)
  const roll = Math.min(1, Math.abs(fwd) / 6)
  const heading = c.heading + input.steer * TURN * roll * dt
  const vx = fwd * fx - side * fy
  const vy = fwd * fy + side * fx
  const x = c.x + vx * dt
  const y = c.y + vy * dt
  const at = locate(t, { x, y }, c.i)
  return { x, y, heading, vx, vy, i: at.i, off: at.off }
}

/* ---------------------------------------------------------------------------- laps */

export const GATES = 8
/** where a lap stands: which gates have been passed in order since the line, and when it began */
export type Lap = { next: number; started: number | null }
export const newLap = (): Lap => ({ next: 0, started: null })
/**
 * Note the car's progress, and say when a lap is done. The track is cut into GATES equal parts;
 * each must be entered in turn, and only then does crossing the line count, so a lap cut short
 * across the grass is a lap that never finishes.
 */
export function progress(
  t: Track,
  lap: Lap,
  before: Car,
  after: Car,
  time: number,
): { lap: Lap; done: number | null } {
  const part = (c: Car) => Math.floor((t.along[c.i] / t.length) * GATES) % GATES
  const a = part(before)
  const b = part(after)
  let next = lap
  // crossing the line: from the last part into the first
  if (a === GATES - 1 && b === 0) {
    const done = lap.started !== null && lap.next === GATES ? time - lap.started : null
    return { lap: { next: 1, started: time }, done }
  }
  if (lap.started !== null && b === lap.next && b !== a) next = { ...lap, next: lap.next + 1 }
  return { lap: next, done: null }
}

/* ---------------------------------------------------------------------------- the driver */

/** the computer's driving: aim a little way down the road, and brake for what is coming */
export function pilot(t: Track, c: Car, skill = 1): Input {
  const n = t.pts.length
  const v = speedOf(c)
  const ahead = Math.round((8 + v * 0.45) / (t.length / n))
  const target = t.pts[(c.i + ahead) % n]
  let want = Math.atan2(target.y - c.y, target.x - c.x) - c.heading
  want = Math.atan2(Math.sin(want), Math.cos(want))
  const steer = Math.max(-1, Math.min(1, want * 3))
  // the tightest bend within braking distance sets the speed to be at now
  let limit = TOP_SPEED
  const look = Math.round((v * v) / (2 * BRAKE) / (t.length / n)) + 8
  for (let k = 4; k < look + 4; k += 4) {
    const a = t.pts[(c.i + k - 4) % n]
    const b = t.pts[(c.i + k) % n]
    const d = t.pts[(c.i + k + 4) % n]
    const ab = Math.hypot(b.x - a.x, b.y - a.y)
    const bd = Math.hypot(d.x - b.x, d.y - b.y)
    const ad = Math.hypot(a.x - d.x, a.y - d.y)
    const cross = Math.abs((b.x - a.x) * (d.y - a.y) - (b.y - a.y) * (d.x - a.x))
    if (cross < 1e-9) continue
    const r = (ab * bd * ad) / (2 * cross)
    // the speed this bend allows, then how fast you may go now and still brake down to it
    const bend = TURN * r * 0.92 * skill
    const dist = (k * t.length) / n
    limit = Math.min(limit, Math.sqrt(bend * bend + 2 * BRAKE * 0.8 * dist))
  }
  return v > limit ? { gas: 0, brake: 1, steer } : { gas: 1, brake: 0, steer }
}

/**
 * The computer's lap of a track: a FLYING lap, the second one, so it starts over the line at
 * speed. The first lap begins almost from a standstill, and measuring that made gold a time any
 * flat-out second lap beat — a medal nobody had to work for.
 */
export function paceLap(t: Track, skill = 1, dt = 1 / 60): number {
  let c = startCar(t)
  let lap = newLap()
  let time = 0
  let laps = 0
  for (let k = 0; k < 60 * 600; k++) {
    const next = drive(t, c, pilot(t, c, skill), dt)
    time += dt
    const p = progress(t, lap, c, next, time)
    lap = p.lap
    c = next
    if (p.done !== null && ++laps === 2) return p.done
  }
  return Infinity
}
/**
 * Gold: the computer's quickest flying lap over a few ways of driving it. One setting is not
 * always best — on Hairpins the driver at 0.85 lapped in 44.05 s and at full stretch in 45.75,
 * going wide — so the medal is the best of them, and nobody gets gold for beating a mistake.
 */
export const goldLap = (t: Track) => Math.min(...[0.8, 0.9, 1, 1.1].map((k) => paceLap(t, k)))
/** medal times from the computer's lap: gold is a match for it, silver and bronze a little slower */
export const medals = (pace: number) => ({ gold: pace, silver: pace * 1.06, bronze: pace * 1.15 })

/* ---------------------------------------------------------------------------- ghosts */

/** a lap as a string of positions, twenty a second: x and y to a decimetre, heading to a hundredth */
export const GHOST_HZ = 20
export function packGhost(samples: { x: number; y: number; heading: number }[]): string {
  return samples
    .map((s) => `${Math.round(s.x * 10)},${Math.round(s.y * 10)},${Math.round(s.heading * 100)}`)
    .join(';')
}
export function unpackGhost(
  text: string | null | undefined,
): { x: number; y: number; heading: number }[] {
  if (!text || text.length > 400_000 || !/^[-\d,;]+$/.test(text)) return []
  const out: { x: number; y: number; heading: number }[] = []
  for (const part of text.split(';')) {
    const [x, y, h] = part.split(',').map(Number)
    if (![x, y, h].every(Number.isFinite)) return []
    out.push({ x: x / 10, y: y / 10, heading: h / 100 })
  }
  return out
}

/* ---------------------------------------------------------------------------- what is kept */

export const TIMETRIAL_KEY = 'lab_timetrial_v1'
export const COLOURS = ['#ff4f5e', '#2f9bff', '#ffd34d', '#41c97a', '#b07bff'] as const
export type Best = { lap: number; ghost: string }
export type Saved = {
  track: string
  colour: number
  ghost: boolean
  /** throttle held down for you, for a phone with no keys */
  autoGas: boolean
  /** best laps in seconds, with the ghost of each, per track id; today's track keyed by its day */
  best: Record<string, Best>
}
export const EMPTY: Saved = { track: 'ring', colour: 0, ghost: true, autoGas: false, best: {} }
export function readSaved(text: string | null): Saved {
  let v: unknown
  try {
    v = JSON.parse(text ?? 'null')
  } catch {
    return EMPTY
  }
  if (typeof v !== 'object' || !v || Array.isArray(v)) return EMPTY
  const o = v as Record<string, unknown>
  const best: Record<string, Best> = {}
  const b = (
    typeof o.best === 'object' && o.best && !Array.isArray(o.best) ? o.best : {}
  ) as Record<string, unknown>
  for (const [k, x] of Object.entries(b)) {
    if (!/^(ring|harbour|hairpins|day-\d{1,10})$/.test(k) || typeof x !== 'object' || !x) continue
    const r = x as Record<string, unknown>
    if (typeof r.lap !== 'number' || !(r.lap > 1 && r.lap < 3600)) continue
    best[k] = {
      lap: r.lap,
      ghost: typeof r.ghost === 'string' && unpackGhost(r.ghost).length ? r.ghost : '',
    }
  }
  return {
    track:
      typeof o.track === 'string' && /^(ring|harbour|hairpins|today)$/.test(o.track)
        ? o.track
        : EMPTY.track,
    colour:
      typeof o.colour === 'number' &&
      Number.isInteger(o.colour) &&
      o.colour >= 0 &&
      o.colour < COLOURS.length
        ? o.colour
        : 0,
    ghost: typeof o.ghost === 'boolean' ? o.ghost : EMPTY.ghost,
    autoGas: typeof o.autoGas === 'boolean' ? o.autoGas : EMPTY.autoGas,
    best,
  }
}
