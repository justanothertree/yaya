/**
 * Keepy-up: tap a ball as it comes down to kick it back up, and never let one touch the ground.
 * Where you tap steers it — tap its left side and it goes right — and a ball can only be kicked
 * on its way down, so it is timing, not tapping as fast as you can. Every kick scores; a kick
 * high up the field scores double. A second ball joins at 15 kicks and a third at 40.
 *
 * Pure, so keepy.test.ts can keep a few thousand balls up without a page. The field is 1 wide and
 * 1.4 tall, heights measured up from the ground; time in seconds.
 */

export const W = 1
export const H = 1.4
export const R = 0.055
/** how far from a ball's middle a tap still reaches it: a finger is wider than a ball */
export const REACH = R * 2.2
/** the line above which a kick scores double */
export const HIGH = 0.95
/** the keyboard's kick zone: Space kicks the lowest ball that is falling below this line */
export const ZONE = 0.5
/** how soon one ball can be kicked again */
export const COOLDOWN = 0.25
/** kicks at which another ball joins */
export const JOINS = [15, 40] as const

export const BALLS = ['balloon', 'beach', 'football'] as const
export type BallKind = (typeof BALLS)[number]
/** each ball's weight: how hard the ground pulls it, and so how quickly you must be there */
export const GRAVITY: Record<BallKind, number> = { balloon: 0.85, beach: 1.45, football: 2.2 }
/** every kick sends a ball up to about this height above where it was kicked */
export const RISE = 0.85

export type Ball = { x: number; y: number; vx: number; vy: number; wait: number; spin: number }
export type World = {
  kind: BallKind
  balls: Ball[]
  score: number
  kicks: number
  t: number
  over: boolean
  /** a sideways breeze that wanders, or none */
  breeze: boolean
  seed: number
}

export function newWorld(kind: BallKind, breeze = false, seed = 1): World {
  return {
    kind,
    balls: [{ x: 0.5, y: H * 0.8, vx: 0, vy: 0, wait: 0, spin: 0 }],
    score: 0,
    kicks: 0,
    t: 0,
    over: false,
    breeze,
    seed,
  }
}

/** the breeze at a moment: slow, wandering, the same for the same seed */
export function breezeAt(w: World, t: number): number {
  if (!w.breeze) return 0
  const a = ((w.seed % 997) / 997) * Math.PI * 2
  return 0.22 * Math.sin(t * 0.37 + a) + 0.1 * Math.sin(t * 0.91 + a * 2.3)
}

/** advance the world by `dt`: falling, the breeze, the walls, balls knocking each other, the ground */
export function step(w: World, dt: number): World {
  if (w.over) return w
  const g = GRAVITY[w.kind]
  const wind = breezeAt(w, w.t)
  // a light ball feels the breeze more
  const push = wind * (w.kind === 'balloon' ? 1.6 : w.kind === 'beach' ? 1 : 0.45)
  const balls = w.balls.map((b) => {
    let { x, y, vx, vy } = b
    vy -= g * dt
    vx += push * dt
    x += vx * dt
    y += vy * dt
    if (x < R) {
      x = R
      vx = Math.abs(vx) * 0.8
    } else if (x > W - R) {
      x = W - R
      vx = -Math.abs(vx) * 0.8
    }
    if (y > H - R) {
      y = H - R
      vy = -Math.abs(vy) * 0.6
    }
    return { x, y, vx, vy, wait: Math.max(0, b.wait - dt), spin: b.spin + vx * dt * 30 }
  })
  for (let i = 0; i < balls.length; i++)
    for (let j = i + 1; j < balls.length; j++) knock(balls[i], balls[j])
  const over = balls.some((b) => b.y <= R)
  return { ...w, balls, t: w.t + dt, over }
}
function knock(p: Ball, q: Ball) {
  const dx = q.x - p.x
  const dy = q.y - p.y
  const d = Math.hypot(dx, dy)
  if (d >= R * 2 || d === 0) return
  const nx = dx / d
  const ny = dy / d
  const over = (R * 2 - d) / 2
  p.x -= nx * over
  p.y -= ny * over
  q.x += nx * over
  q.y += ny * over
  const rel = (p.vx - q.vx) * nx + (p.vy - q.vy) * ny
  if (rel <= 0) return
  const j = rel * 0.9
  p.vx -= j * nx
  p.vy -= j * ny
  q.vx += j * nx
  q.vy += j * ny
}

/** a kick's upward speed, so the ball rises RISE above where it was kicked */
export const kickSpeed = (kind: BallKind) => Math.sqrt(2 * GRAVITY[kind] * RISE)
export type Kick = { world: World; ball: number; points: number } | null
/**
 * A tap at a point: the falling ball it reaches, if any, is kicked up — sideways away from the
 * side it was tapped on. Returns null when the tap kicks nothing.
 */
export function tap(w: World, at: { x: number; y: number }): Kick {
  if (w.over) return null
  let best = -1
  let bd = Infinity
  w.balls.forEach((b, i) => {
    const d = Math.hypot(b.x - at.x, b.y - at.y)
    if (d <= REACH && b.vy < 0 && b.wait <= 0 && d < bd) {
      bd = d
      best = i
    }
  })
  if (best < 0) return null
  const b = w.balls[best]
  return kickBall(w, best, Math.max(-1, Math.min(1, (b.x - at.x) / REACH)))
}
/**
 * The keyboard's kick: the lowest falling ball inside the kick zone, steered by `lean` from -1
 * (left) to 1 (right).
 */
export function kickLowest(w: World, lean: number): Kick {
  if (w.over) return null
  let best = -1
  w.balls.forEach((b, i) => {
    if (b.vy < 0 && b.wait <= 0 && b.y < ZONE && (best < 0 || b.y < w.balls[best].y)) best = i
  })
  return best < 0 ? null : kickBall(w, best, lean)
}
function kickBall(w: World, i: number, lean: number): Kick {
  const b = w.balls[i]
  const points = b.y > HIGH ? 2 : 1
  const kicked: Ball = {
    ...b,
    vx: b.vx * 0.3 + lean * 0.55,
    vy: kickSpeed(w.kind),
    wait: COOLDOWN,
  }
  const kicks = w.kicks + 1
  const balls = w.balls.map((x, j) => (j === i ? kicked : x))
  // another ball joins at each mark, dropped in from the top away from the busiest side
  if ((JOINS as readonly number[]).includes(kicks)) {
    const left = balls.filter((x) => x.x < W / 2).length
    balls.push({
      x: left > balls.length / 2 ? 0.75 : 0.25,
      y: H - R,
      vx: 0,
      vy: 0,
      wait: 0,
      spin: 0,
    })
  }
  return { world: { ...w, balls, kicks, score: w.score + points }, ball: i, points }
}

/**
 * A steady player, for the tests: it kicks each ball as it comes down past a set height, steering
 * it back towards the middle. If this cannot keep the balls up, nobody can.
 */
export function autoplay(w0: World, seconds: number, at = 0.3, rand?: () => number): World {
  let w = w0
  const dt = 1 / 120
  for (let t = 0; t < seconds && !w.over; t += dt) {
    w = step(w, dt)
    for (let i = 0; i < w.balls.length; i++) {
      const b = w.balls[i]
      if (b.vy < 0 && b.y < at && b.wait <= 0) {
        // tap on the side away from the middle, a little off where a person would, too
        const wobble = rand ? (rand() - 0.5) * R : 0
        const k = tap(w, { x: b.x - (0.5 - b.x) * REACH * 0.8 + wobble, y: b.y })
        if (k) w = k.world
      }
    }
  }
  return w
}

/* --------------------------------------------------------------------------- what is kept */

export const KEEPY_KEY = 'lab_keepy_v1'
export const FIELDS = ['park', 'beach', 'night'] as const
export type Saved = {
  ball: BallKind
  field: (typeof FIELDS)[number]
  breeze: boolean
  /** the best score with each ball, calm and breezy kept apart */
  best: Record<BallKind, { calm: number; breezy: number }>
  played: number
}
const ZERO = { calm: 0, breezy: 0 }
export const EMPTY: Saved = {
  ball: 'beach',
  field: 'park',
  breeze: false,
  best: { balloon: ZERO, beach: ZERO, football: ZERO },
  played: 0,
}
const whole = (v: unknown) =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 1e7 ? v : 0
export function readSaved(text: string | null): Saved {
  let v: unknown
  try {
    v = JSON.parse(text ?? 'null')
  } catch {
    return EMPTY
  }
  if (typeof v !== 'object' || !v || Array.isArray(v)) return EMPTY
  const o = v as Record<string, unknown>
  const pick = <T>(list: readonly T[], x: unknown, d: T): T =>
    list.includes(x as T) ? (x as T) : d
  const raw = (typeof o.best === 'object' && o.best ? o.best : {}) as Record<string, unknown>
  const best = {} as Saved['best']
  for (const k of BALLS) {
    const x = (typeof raw[k] === 'object' && raw[k] ? raw[k] : {}) as Record<string, unknown>
    best[k] = { calm: whole(x.calm), breezy: whole(x.breezy) }
  }
  return {
    ball: pick(BALLS, o.ball, EMPTY.ball),
    field: pick(FIELDS, o.field, EMPTY.field),
    breeze: typeof o.breeze === 'boolean' ? o.breeze : EMPTY.breeze,
    best,
    played: whole(o.played),
  }
}
