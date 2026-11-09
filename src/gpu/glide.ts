/**
 * The Lab's soaring game: a glider racing across country on a day of thermals, seen side-on. Pure,
 * so glide.test.ts can fly a whole task, and search for the best way to fly it, without a GPU.
 *
 * ⚠️ A TOY MODEL OF REAL GLIDING, LABELLED AS ONE. The glider's polar — how fast it sinks at each
 * airspeed — is a parabola through three points shaped like a two-seat trainer's (about 0.7 m/s
 * at 75 km/h, a glide of about 1 in 31 at 90). Thermals are columns of rising air under cumulus,
 * from the ground to cloudbase; between them the air sinks a little. Circling to climb is a
 * button rather than a turn, and time is sped up so a task takes minutes. What is real is the
 * decision gliding is about, and its textbook answer (MacCready, 1954): fly faster through sinking
 * air and slower in rising air, and only stop to climb in a thermal stronger than you expect the
 * next to be. The par for each task is that strategy, searched for.
 *
 * Units: metres, seconds, m/s. x along the course, h above the ground's datum.
 */

/** the polar: sink rate (m/s, positive down) at an airspeed (m/s), a parabola w = a·v² + b·v + c */
export type Polar = { a: number; b: number; c: number }

/** the parabola through three (airspeed, sink) points */
export function fitPolar(p: [number, number][]): Polar {
  const [[x1, y1], [x2, y2], [x3, y3]] = p
  const d = (x1 - x2) * (x1 - x3) * (x2 - x3)
  const a = (x3 * (y2 - y1) + x2 * (y1 - y3) + x1 * (y3 - y2)) / d
  const b = (x3 * x3 * (y1 - y2) + x2 * x2 * (y3 - y1) + x1 * x1 * (y2 - y3)) / d
  const c = (x2 * x3 * (x2 - x3) * y1 + x3 * x1 * (x3 - x1) * y2 + x1 * x2 * (x1 - x2) * y3) / d
  return { a, b, c }
}
const kmh = (k: number) => k / 3.6
/** a two-seat trainer's shape: 0.70 m/s at 75 km/h, 0.80 at 90, 1.60 at 140 */
export const TRAINER = fitPolar([
  [kmh(75), 0.7],
  [kmh(90), 0.8],
  [kmh(140), 1.6],
])
export const sink = (p: Polar, v: number) => p.a * v * v + p.b * v + p.c
/** the slowest and fastest it can be flown */
export const SPEED = { min: kmh(70), max: kmh(180) }

/** the speed of least sink: the bottom of the parabola */
export const minSinkSpeed = (p: Polar) => -p.b / (2 * p.a)

/**
 * MacCready's speed to fly for an expected climb `m` (m/s) in the next thermal, flying through air
 * rising at `air` (negative: sinking). The tangent to the polar, as sink in that air, from the point
 * (0, −m): a·v² = c + m − air for a parabola. With m = 0 in still air it is best glide; a stronger
 * expected climb, or sinking air, makes it faster.
 */
export function speedToFly(p: Polar, m: number, air = 0): number {
  const v = Math.sqrt(Math.max(0, (p.c + m - air) / p.a))
  return Math.max(SPEED.min, Math.min(SPEED.max, v))
}
/** distance gone per height lost in still air at an airspeed */
export const glideRatio = (p: Polar, v: number) => v / sink(p, v)

/* ------------------------------------------------------------------------------- the air */

export type Thermal = {
  /** centre along the course, m */
  x: number
  /** half-width of its core, m */
  r: number
  /** climb rate in its core, m/s */
  lift: number
}
export type Task = {
  id: string
  name: string
  hint: string
  /** the finish line, m */
  finish: number
  /** start height, m */
  start: number
  /** cloudbase: thermals stop here, m */
  base: number
  thermals: Thermal[]
  /** how fast the air sinks between thermals, m/s */
  sinkAir: number
  /** whether the thermals have clouds over them */
  clouds: boolean
}

/** vertical air speed at a point: a thermal's lift, falling off from its core, up to cloudbase */
export function air(t: Task, x: number, h: number): number {
  let up = -t.sinkAir
  if (h >= t.base) return up
  for (const th of t.thermals) {
    const d = Math.abs(x - th.x) / th.r
    if (d < 1.6) up = Math.max(up, th.lift * Math.exp(-d * d) - t.sinkAir * (1 - Math.exp(-d * d)))
  }
  return up
}

/** sink while circling: banked, a glider sinks more than in straight flight — about 1.3 times */
export const CIRCLING = 1.3
/** how fast circling works towards a thermal's core, m/s */
export const CENTRING = 4

/** the thermal whose lift reaches furthest over a point, if any does */
export function nearest(t: Task, x: number): Thermal | null {
  let best: Thermal | null = null
  for (const th of t.thermals)
    if (Math.abs(x - th.x) < th.r * 1.6 && (!best || Math.abs(x - th.x) < Math.abs(x - best.x)))
      best = th
  return best
}

/** what circling here would actually climb at: the air's lift less the circling glider's sink */
export const climbHere = (t: Task, x: number, h: number, p: Polar = TRAINER) =>
  air(t, x, h) - sink(p, minSinkSpeed(p)) * CIRCLING

/* --------------------------------------------------------------------------- the flight */

export type Glider = { x: number; h: number; t: number; v: number; circling: boolean }
export type End = 'flying' | 'finished' | 'landed'
/** time runs this many times faster than life */
export const PACE = 12
export const DT = 0.05

export const launch = (t: Task): Glider => ({ x: 0, h: t.start, t: 0, v: kmh(90), circling: false })

/** how fast the glider is climbing (negative: sinking) as it is flown now — what the instrument
 *  shows, and the very sum a step makes, so the two cannot disagree */
export function vario(t: Task, g: Glider, p: Polar = TRAINER): number {
  const v = g.circling ? minSinkSpeed(p) : g.v
  return air(t, g.x, g.h) - sink(p, v) * (g.circling ? CIRCLING : 1)
}

/**
 * One step of DT seconds of game time (which is PACE × DT of the flight's own seconds). While
 * circling the glider climbs or sinks on the spot; otherwise it goes forward at its airspeed (no
 * wind) and sinks by its polar, offset by the air.
 */
export function step(t: Task, g: Glider, p: Polar = TRAINER): End {
  const dt = DT * PACE
  const vs = vario(t, g, p)
  g.h = Math.min(t.base, g.h + vs * dt)
  if (!g.circling) g.x += g.v * dt
  // circling, a pilot works towards the core: the circle drifts to the thermal's centre
  else {
    const core = nearest(t, g.x)
    if (core) g.x += Math.max(-CENTRING * dt, Math.min(CENTRING * dt, core.x - g.x))
  }
  g.t += dt
  if (g.x >= t.finish) return 'finished'
  if (g.h <= 0) return 'landed'
  return 'flying'
}

/**
 * A pilot that flies by MacCready's rule with setting `m`: stop and circle in lift stronger than
 * m, until near cloudbase or the lift weakens; otherwise fly the speed to fly for m and the air.
 */
export function pilot(m: number, p: Polar = TRAINER) {
  return (t: Task, g: Glider) => {
    // decide on what circling would actually CLIMB at, not on the air alone: circling costs sink,
    // and a pilot who circles in any rising air circles at a thermal's edge all the way down
    const climb = climbHere(t, g.x, g.h, p)
    if (g.circling) g.circling = climb > Math.max(0.05, m * 0.6) && g.h < t.base - 30
    else g.circling = climb > Math.max(0.1, m) && g.h < t.base - 60
    g.v = speedToFly(p, m, air(t, g.x, g.h))
  }
}

export type Result = { end: End; time: number; x: number }
/** fly a task to the end with a pilot, from the start */
export function fly(t: Task, decide: (t: Task, g: Glider) => void, p: Polar = TRAINER): Result {
  const g = launch(t)
  for (let i = 0; i < 200_000; i++) {
    decide(t, g)
    const e = step(t, g, p)
    if (e !== 'flying') return { end: e, time: g.t, x: g.x }
  }
  return { end: 'landed', time: g.t, x: g.x }
}

/** the par: the fastest finish over MacCready settings 0 to 4 m/s, and the setting that made it */
export function par(t: Task): { time: number; m: number } | null {
  let best: { time: number; m: number } | null = null
  for (let m = 0; m <= 4.0001; m += 0.25) {
    const r = fly(t, pilot(m))
    if (r.end === 'finished' && (!best || r.time < best.time)) best = { time: r.time, m }
  }
  return best
}

/** stars for a finish against par: three within 10%, two within 30%, one for finishing */
export const stars = (time: number, parTime: number) =>
  time <= parTime * 1.1 ? 3 : time <= parTime * 1.3 ? 2 : 1

/* ---------------------------------------------------------------------------------- tasks */

const th = (x: number, r: number, lift: number): Thermal => ({ x, r, lift })
export const TASKS: Task[] = [
  {
    id: 'glide',
    name: 'Final glide',
    hint: 'No thermals: just reach the field. Fly at best glide — too slow or too fast and you land short.',
    finish: 19500,
    start: 650,
    base: 1500,
    thermals: [],
    sinkAir: 0,
    clouds: false,
  },
  {
    id: 'first',
    name: 'First thermal',
    hint: 'You cannot glide that far. Circle under the cloud to climb, then go.',
    finish: 26000,
    start: 500,
    base: 1400,
    thermals: [th(6000, 220, 2.2)],
    sinkAir: 0.3,
    clouds: true,
  },
  {
    id: 'street',
    name: 'Cloud street',
    hint: 'Many thermals. Take only the strong ones; fly faster in sink, slower in lift.',
    finish: 60000,
    start: 800,
    base: 1600,
    thermals: [
      th(7000, 200, 1.2),
      th(14000, 260, 3.0),
      th(21000, 180, 1.0),
      th(29000, 240, 2.6),
      th(37000, 200, 1.4),
      th(44000, 260, 3.2),
      th(52000, 200, 1.1),
    ],
    sinkAir: 0.5,
    clouds: true,
  },
  {
    id: 'weak',
    name: 'A weak day',
    hint: 'Thin lift and a low cloudbase. Do not race: every metre counts.',
    finish: 40000,
    start: 600,
    base: 1000,
    thermals: [
      th(5000, 200, 1.5),
      th(13000, 220, 1.8),
      th(20000, 180, 1.4),
      th(27000, 240, 1.7),
      th(34000, 200, 1.5),
    ],
    sinkAir: 0.35,
    clouds: true,
  },
  {
    id: 'blue',
    name: 'Blue day',
    hint: 'Good thermals, but no clouds to mark them. Watch the variometer.',
    finish: 50000,
    start: 900,
    base: 1800,
    thermals: [
      th(8000, 230, 2.4),
      th(17000, 200, 1.6),
      th(25000, 260, 3.0),
      th(34000, 200, 2.0),
      th(42000, 240, 2.8),
    ],
    sinkAir: 0.45,
    clouds: false,
  },
]

/* ---------------------------------------------------------------------------- what is kept */

export const GLIDE_KEY = 'lab_glide_v1'
/** best time per task, in game seconds */
export type Saved = Record<string, number>
export function readSaved(text: string | null): Saved {
  let v: unknown
  try {
    v = JSON.parse(text ?? 'null')
  } catch {
    return {}
  }
  if (typeof v !== 'object' || !v || Array.isArray(v)) return {}
  const out: Saved = {}
  for (const t of TASKS) {
    const x = (v as Record<string, unknown>)[t.id]
    if (typeof x === 'number' && Number.isFinite(x) && x > 0 && x < 1e6) out[t.id] = x
  }
  return out
}
