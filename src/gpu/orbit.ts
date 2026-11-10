/**
 * The physics and rules of the Lab's orbit game: a probe round a planet, burns that speed it up or
 * slow it down along its path, the orbit those burns leave it on, and what each level asks. Pure, so
 * orbit.test.ts can fly it without a GPU.
 *
 * Units are chosen so the arithmetic is the textbook's: the planet's GM is 1 and its radius 1, so a
 * circular orbit at radius r has speed √(1/r) and period 2π r^1.5. A burn is an acceleration along
 * (or against) the velocity; its cost is the Δv it spends — the rocket's own currency — and every
 * level knows the least any flight could spend, from the formula, to say how close you came.
 */

export type V2 = [number, number]
export const MU = 1
export const PLANET = 1
/** the engine: how fast a burn changes the speed, per unit of time */
export const THRUST = 0.12
/** the fixed step the flight is worked out in — small enough that 50 orbits lose nothing visible */
export const DT = 0.004

export type Ship = { p: V2; v: V2; fuel: number; spent: number }

export const circular = (r: number, angle = 0): Ship => {
  const s = Math.sqrt(MU / r)
  return {
    p: [r * Math.cos(angle), r * Math.sin(angle)],
    v: [-s * Math.sin(angle), s * Math.cos(angle)],
    fuel: 0,
    spent: 0,
  }
}

const accel = (p: V2): V2 => {
  const r2 = p[0] * p[0] + p[1] * p[1]
  const k = -MU / (r2 * Math.sqrt(r2))
  return [p[0] * k, p[1] * k]
}

/**
 * Advance by one step: velocity Verlet (leapfrog) under gravity — symplectic, so an orbit's energy
 * wanders but never drifts, which is why a circle stays a circle for as long as anyone watches — and
 * a burn along the velocity if `burn` is +1 (faster) or −1 (slower), while fuel lasts.
 */
export function advance(s: Ship, burn: -1 | 0 | 1, dt = DT) {
  if (burn && s.fuel > 0) {
    const sp = Math.hypot(s.v[0], s.v[1]) || 1
    const dv = Math.min(THRUST * dt, s.fuel)
    s.v = [s.v[0] + (s.v[0] / sp) * dv * burn, s.v[1] + (s.v[1] / sp) * dv * burn]
    s.fuel -= dv
    s.spent += dv
  }
  const a0 = accel(s.p)
  const half: V2 = [s.v[0] + a0[0] * dt * 0.5, s.v[1] + a0[1] * dt * 0.5]
  s.p = [s.p[0] + half[0] * dt, s.p[1] + half[1] * dt]
  const a1 = accel(s.p)
  s.v = [half[0] + a1[0] * dt * 0.5, half[1] + a1[1] * dt * 0.5]
}

export type Elements = {
  /** closest and furthest from the planet's centre; apoapsis is Infinity when it is escaping */
  peri: number
  apo: number
  e: number
  energy: number
}

/** the orbit a ship is on right now, if nothing else happened: its periapsis and apoapsis */
export function elements(s: Ship): Elements {
  const r = Math.hypot(s.p[0], s.p[1])
  const v2 = s.v[0] ** 2 + s.v[1] ** 2
  const energy = v2 / 2 - MU / r
  const h = s.p[0] * s.v[1] - s.p[1] * s.v[0]
  const e = Math.sqrt(Math.max(0, 1 + (2 * energy * h * h) / (MU * MU)))
  const p = (h * h) / MU
  const peri = p / (1 + e)
  const apo = e < 1 ? p / (1 - e) : Infinity
  return { peri, apo, e, energy }
}

/** the path ahead, as points, for `time` — what the dotted line draws */
export function predict(s: Ship, time: number, points = 240): V2[] {
  const c: Ship = { p: [...s.p], v: [...s.v], fuel: 0, spent: 0 }
  const out: V2[] = [[...c.p]]
  const per = Math.max(1, Math.round(time / DT / points))
  for (let i = 0; i < points; i++) {
    for (let k = 0; k < per; k++) {
      advance(c, 0)
      if (Math.hypot(c.p[0], c.p[1]) < PLANET) return [...out, [...c.p]]
    }
    out.push([...c.p])
  }
  return out
}

/** the Δv a Hohmann transfer between two circular orbits costs: the least two burns can do it in */
export function hohmann(r1: number, r2: number): number {
  const a = (r1 + r2) / 2
  const v1 = Math.sqrt(MU / r1)
  const v2 = Math.sqrt(MU / r2)
  const t1 = Math.sqrt(MU * (2 / r1 - 1 / a))
  const t2 = Math.sqrt(MU * (2 / r2 - 1 / a))
  return Math.abs(t1 - v1) + Math.abs(v2 - t2)
}

/* ---------------------------------------------------------------- levels ---------------------- */

export type Goal =
  | { kind: 'ring'; r: number; tol: number }
  | { kind: 'ellipse'; peri: number; apo: number; tol: number }
  | { kind: 'escape' }

export type Level = {
  name: string
  hint: string
  start: number
  fuel: number
  goal: Goal
  /** the least Δv any flight could spend — the formula's, not a flight's */
  least: number
}

const ring = (r: number, tol: number): Goal => ({ kind: 'ring', r, tol })

export const LEVELS: Level[] = [
  {
    name: 'Higher',
    hint: 'Speed up, and the far side of your orbit rises. Coast there, then speed up again to round it off.',
    start: 2,
    fuel: 0.45,
    goal: ring(3.5, 0.12),
    least: hohmann(2, 3.5),
  },
  {
    name: 'Lower',
    hint: 'Slowing down drops the far side. Two short burns, half an orbit apart.',
    start: 3,
    fuel: 0.45,
    goal: ring(1.6, 0.12),
    least: hohmann(3, 1.6),
  },
  {
    name: 'Stretched',
    hint: 'One burn makes an ellipse: the point where you burn stays where it is.',
    start: 2,
    fuel: 0.4,
    goal: { kind: 'ellipse', peri: 2, apo: 5, tol: 0.15 },
    // a single prograde burn at r = 2 to an ellipse reaching 5
    least: Math.sqrt(MU * (2 / 2 - 1 / 3.5)) - Math.sqrt(MU / 2),
  },
  {
    name: 'Far out',
    hint: 'A long way up. The second burn is smaller than the first.',
    start: 1.5,
    fuel: 0.6,
    goal: ring(5, 0.2),
    least: hohmann(1.5, 5),
  },
  {
    name: 'Away',
    hint: 'Fast enough and the orbit never comes back. Burn where you are deepest in the well.',
    start: 1.5,
    fuel: 0.5,
    goal: { kind: 'escape' },
    // from a circle at r, escape speed is √2 times circular speed
    least: (Math.SQRT2 - 1) * Math.sqrt(MU / 1.5),
  },
]

/** whether the ship's present orbit is what the level asks */
export function met(l: Level, s: Ship): boolean {
  const el = elements(s)
  const g = l.goal
  if (g.kind === 'ring') return Math.abs(el.peri - g.r) <= g.tol && Math.abs(el.apo - g.r) <= g.tol
  if (g.kind === 'ellipse')
    return Math.abs(el.peri - g.peri) <= g.tol && Math.abs(el.apo - g.apo) <= g.tol
  return el.energy >= 0
}

export type Flight = {
  level: Level
  ship: Ship
  t: number
  /** the trail behind, newest last */
  trail: V2[]
  outcome: 'flying' | 'done' | 'crashed' | 'adrift'
}

export function launch(l: Level): Flight {
  const ship = circular(l.start, -Math.PI / 2)
  ship.fuel = l.fuel
  return { level: l, ship, t: 0, trail: [[...ship.p]], outcome: 'flying' }
}

/** fly for `time`, burning as asked; a level is done once its orbit is met with the engine off */
export function fly(f: Flight, burn: -1 | 0 | 1, time: number) {
  if (f.outcome !== 'flying') return
  const steps = Math.max(1, Math.round(time / DT))
  for (let i = 0; i < steps; i++) {
    advance(f.ship, burn)
    f.t += DT
    if (Math.hypot(f.ship.p[0], f.ship.p[1]) < PLANET) {
      f.outcome = 'crashed'
      return
    }
  }
  const last = f.trail[f.trail.length - 1]
  if (Math.hypot(f.ship.p[0] - last[0], f.ship.p[1] - last[1]) > 0.05) {
    f.trail.push([...f.ship.p])
    if (f.trail.length > 600) f.trail.shift()
  }
  if (!burn && met(f.level, f.ship)) f.outcome = 'done'
  else if (f.ship.fuel <= 1e-9 && !met(f.level, f.ship)) {
    // out of fuel and not there: the orbit can no longer change, so the level cannot be met
    f.outcome = 'adrift'
  }
}

/** how the flight did against the least the formula says: 3 stars within 10%, 2 within 30%, else 1 */
export function stars(l: Level, spent: number) {
  const over = spent / l.least
  return over <= 1.1 ? 3 : over <= 1.3 ? 2 : 1
}

/* ---------------------------------------------------------------- an autopilot for the tests ---- */

/**
 * Flies a level the textbook way: a first burn until the far side of the orbit reaches the goal,
 * coast to there, and a second burn until the orbit is round (or, for one-burn goals, stop after
 * the first). It proves every level can be done within its fuel, and how near the formula a
 * careful pilot comes.
 */
export function autopilot(l: Level): Flight {
  const f = launch(l)
  const g = l.goal
  const target = g.kind === 'ring' ? g.r : g.kind === 'ellipse' ? g.apo : Infinity
  const up = target > l.start
  const dir: -1 | 1 = up ? 1 : -1
  // first burn: until the opposite side of the orbit reaches the target
  while (f.outcome === 'flying') {
    const el = elements(f.ship)
    const far = up ? el.apo : el.peri
    if (g.kind === 'escape' ? el.energy >= 0 : up ? far >= target : far <= target) break
    fly(f, dir, DT)
  }
  if (g.kind !== 'ring') {
    fly(f, 0, DT)
    return f
  }
  // coast to the far side: where the distance stops growing (or shrinking)
  let prev = Math.hypot(...f.ship.p)
  for (let i = 0; i < 1e6 && f.outcome === 'flying'; i++) {
    fly(f, 0, DT)
    const r = Math.hypot(...f.ship.p)
    if (up ? r < prev : r > prev) break
    prev = r
  }
  // second burn: for as long as it brings the orbit nearer the ring
  let best = Infinity
  while (f.outcome === 'flying') {
    const el = elements(f.ship)
    const off = Math.abs(el.peri - target) + Math.abs(el.apo - target)
    if (off > best) break
    best = off
    fly(f, dir, DT)
  }
  fly(f, 0, DT)
  return f
}

/* ---------------------------------------------------------------- kept in this browser -------- */

export const ORBIT_KEY = 'lab_orbit_v1'

/** the best (least) Δv each level was done in, by name */
export function readBests(text: string | null): Record<string, number> {
  try {
    const v = JSON.parse(text ?? '{}') as Record<string, unknown>
    const out: Record<string, number> = {}
    for (const l of LEVELS) {
      const n = v?.[l.name]
      if (typeof n === 'number' && Number.isFinite(n) && n >= l.least * 0.95 && n <= l.fuel)
        out[l.name] = n
    }
    return out
  } catch {
    return {}
  }
}

/* ---------------------------------------------------------------- the view -------------------- */

/** world units to the stage: the planet in the middle, the furthest goal and a margin in view */
export function fitOrbit(l: Level, stage: [number, number]) {
  const g = l.goal
  const reach = g.kind === 'ring' ? g.r : g.kind === 'ellipse' ? g.apo : 6
  const span = Math.max(reach, l.start) * 1.15 + 0.3
  const s = Math.min(stage[0], stage[1]) / (2 * span)
  return { s, ox: stage[0] / 2, oy: stage[1] / 2 }
}

/** what the GPU is sent each frame: the trail fading behind, the path ahead dotted, the probe, and
 *  its flame when the engine is on — each as (x0, y0, x1, y1, r, g, b, half-width px) */
export function scene(
  f: Flight,
  ahead: readonly V2[],
  burn: -1 | 0 | 1,
): Float32Array<ArrayBuffer> {
  const out: number[] = []
  const tr = f.trail
  for (let i = 1; i < tr.length; i++) {
    const k = i / tr.length
    out.push(tr[i - 1][0], tr[i - 1][1], tr[i][0], tr[i][1], 0.25 * k, 0.5 * k, 0.9 * k, 1.2)
  }
  // dotted: every other piece of the prediction
  for (let i = 1; i < ahead.length; i += 2)
    out.push(ahead[i - 1][0], ahead[i - 1][1], ahead[i][0], ahead[i][1], 0.9, 0.85, 0.5, 1)
  const [x, y] = f.ship.p
  const sp = Math.hypot(...f.ship.v) || 1
  const [vx, vy] = [f.ship.v[0] / sp, f.ship.v[1] / sp]
  out.push(x - vx * 0.04, y - vy * 0.04, x + vx * 0.04, y + vy * 0.04, 1, 1, 1, 3.5)
  if (burn && f.ship.fuel > 0) {
    // the flame points away from the way the probe is pushed
    const d = -burn * 0.18
    out.push(x, y, x + vx * d, y + vy * d, 1, 0.55, 0.15, 2.5)
  }
  return new Float32Array(out)
}
