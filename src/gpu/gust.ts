/**
 * The arithmetic of the Lab's gust: air hockey without mallets. Each player has a fan they move
 * about their half of the rink and a breath of wind that runs out; the wind blows through a real
 * fluid, and the fluid — not the player — pushes the puck. Blow from behind it to send it at the
 * other goal; blow from in front and it comes back at yours.
 *
 * ⚠️ THE AIR IS THE GPU'S AND THE RULES ARE HERE. A stable-fluids solver on the GPU carries the wind
 * round the rink, round the bumpers and round the puck itself, and steps the puck by the drag of the
 * air on it. What decides a MATCH stays on the CPU, pure, and gust.test.ts plays it: the puck's own
 * motion given an air speed (the shader's `puck` pass line for line), walls, bumpers and goals, the
 * breath, the kickoff, the score, and the computer opponent's idea of where to stand.
 */

export type V2 = [number, number]

/** the rink, in fluid cells */
export const W = 160
export const H = 90
/** the puck's radius and how hard the air drags it toward its own speed, per second */
export const PUCK_R = 4
export const DRAG = 3.2
/** walls give back this much of the speed into them */
export const BOUNCE = 0.82
/** each goal is an opening this many cells either side of the middle of an end wall */
export const GOAL = 14
/** bumpers: (x, y, r), round posts the air and the puck go round */
export const BUMPERS: [number, number, number][] = [
  [56, 28, 5],
  [56, 62, 5],
  [104, 28, 5],
  [104, 62, 5],
]
/**
 * a fan's wind is a jet toward the puck: FAN_R wide, fading over JET cells ahead of the fan, pushing
 * the air at up to FAN_PUSH cells a second² (the shader's `force`; only its constants are mirrored)
 */
export const FAN_R = 6
export const JET = 20
export const FAN_PUSH = 700
/** the last SLOPE cells before a goal line tip toward it, at TIP cells a second², so a slow puck that
 *  has reached the mouth drops in rather than sitting on the line */
export const SLOPE = 8
export const TIP = 40
/** breath: blowing uses it up in this many seconds, and it comes back in this many */
export const EMPTY = 2.2
export const REFILL = 3.5
export const FIRST_TO = 5
/** seconds of stillness before play starts again after a goal */
export const KICKOFF = 1.5

export type Puck = { x: number; y: number; vx: number; vy: number }
export type Fan = { x: number; y: number; blowing: boolean; breath: number }

/**
 * One step of the puck: the air's speed where it is pulls it along (drag), it moves, and it bounces
 * off the walls — except where a goal opens — and off the bumpers. Returns which goal it went into:
 * 0 is the left (player one's), 1 the right, −1 none.
 */
export function stepPuck(p: Puck, air: V2, dt: number): number {
  const k = 1 - Math.exp(-DRAG * dt)
  p.vx += (air[0] - p.vx) * k
  p.vy += (air[1] - p.vy) * k
  if (Math.abs(p.y - H / 2) < GOAL - PUCK_R * 0.5) {
    if (p.x < SLOPE) p.vx -= TIP * dt
    if (p.x > W - SLOPE) p.vx += TIP * dt
  }
  p.x += p.vx * dt
  p.y += p.vy * dt
  const inMouth = Math.abs(p.y - H / 2) < GOAL - PUCK_R * 0.5
  if (p.x < PUCK_R && !inMouth) {
    p.x = PUCK_R
    p.vx = Math.abs(p.vx) * BOUNCE
  }
  if (p.x > W - PUCK_R && !inMouth) {
    p.x = W - PUCK_R
    p.vx = -Math.abs(p.vx) * BOUNCE
  }
  if (p.y < PUCK_R) {
    p.y = PUCK_R
    p.vy = Math.abs(p.vy) * BOUNCE
  }
  if (p.y > H - PUCK_R) {
    p.y = H - PUCK_R
    p.vy = -Math.abs(p.vy) * BOUNCE
  }
  for (const [bx, by, br] of BUMPERS) {
    const dx = p.x - bx
    const dy = p.y - by
    const d = Math.hypot(dx, dy)
    const min = br + PUCK_R
    if (d < min && d > 1e-9) {
      const nx = dx / d
      const ny = dy / d
      p.x = bx + nx * min
      p.y = by + ny * min
      const vn = p.vx * nx + p.vy * ny
      if (vn < 0) {
        p.vx -= (1 + BOUNCE) * vn * nx
        p.vy -= (1 + BOUNCE) * vn * ny
      }
    }
  }
  if (p.x < -PUCK_R) return 0
  if (p.x > W + PUCK_R) return 1
  return -1
}

/** a fan's breath after dt: it empties while blowing and fills while not; with none left it cannot blow */
export function breathe(f: Fan, wants: boolean, dt: number) {
  f.blowing = wants && f.breath > 0
  f.breath = Math.max(0, Math.min(1, f.breath + (f.blowing ? -dt / EMPTY : dt / REFILL)))
}

/** which way a fan blows: straight at the puck, so where you stand is the whole of your aim */
export function aim(f: Fan, p: Puck): V2 {
  const dx = p.x - f.x
  const dy = p.y - f.y
  const d = Math.hypot(dx, dy) || 1
  return [dx / d, dy / d]
}

/** keep a fan in its own half: player 0 the left, player 1 the right, clear of the walls */
export function inHalf(side: number, at: V2): V2 {
  const lo = side === 0 ? 3 : W / 2 + 2
  const hi = side === 0 ? W / 2 - 2 : W - 3
  return [Math.max(lo, Math.min(hi, at[0])), Math.max(3, Math.min(H - 3, at[1]))]
}

/** how fast a fan crosses the ice, cells a second: quick, but not where-you-point-instantly */
export const FAN_SPEED = 70

/** a fan moved toward where its player wants it, at most FAN_SPEED·dt, and kept in its half */
export function steer(f: Fan, side: number, to: V2, dt: number, speed = FAN_SPEED) {
  const [tx, ty] = inHalf(side, to)
  const dx = tx - f.x
  const dy = ty - f.y
  const d = Math.hypot(dx, dy)
  const step = Math.min(d, speed * dt)
  if (d > 1e-9) {
    f.x += (dx / d) * step
    f.y += (dy / d) * step
  }
  ;[f.x, f.y] = inHalf(side, [f.x, f.y])
}

/**
 * Where the computer wants to stand (it plays the right, attacking the left goal): behind the puck as
 * seen from the goal it is shooting at, so its wind carries the puck that way — or as near that as its
 * own half allows, which is still a shot while the puck is within its jet's reach. A puck further off
 * than that is out of its reach, so it goes back to guard its goal, level with the puck. It blows only
 * once nearly at its spot, with breath to spare and the puck within reach.
 */
export function brain(p: Puck, me: Fan): { at: V2; blow: boolean } {
  const dx = p.x
  const dy = p.y - H / 2
  const d = Math.hypot(dx, dy) || 1
  const at = inHalf(1, [p.x + (dx / d) * 12, p.y + (dy / d) * 12])
  const reach = Math.hypot(at[0] - p.x, at[1] - p.y)
  if (reach > JET) return { at: inHalf(1, [W - 16, H / 2 + (p.y - H / 2) * 0.6]), blow: false }
  const there = Math.hypot(me.x - at[0], me.y - at[1]) < 5
  return { at, blow: there && me.breath > 0.15 }
}

export type Match = {
  score: [number, number]
  /** seconds until play starts again, after a goal or at the start */
  pause: number
  /** who scored last, for the kickoff: the puck goes toward them */
  last: number
  winner: number
}
export const newMatch = (): Match => ({ score: [0, 0], pause: KICKOFF, last: -1, winner: -1 })

/** a goal: the score, and the puck back on the spot for a kickoff, a little toward who just scored */
export function goal(m: Match, into: number, p: Puck) {
  const scorer = into === 0 ? 1 : 0
  m.score[scorer]++
  m.last = scorer
  m.pause = KICKOFF
  if (m.score[scorer] >= FIRST_TO) m.winner = scorer
  Object.assign(p, kickoff(scorer))
}
/** the puck on the spot, nudged toward the side that conceded so they get the first touch */
export const kickoff = (scorer: number): Puck => ({
  x: W / 2 + (scorer === 0 ? 6 : scorer === 1 ? -6 : 0),
  y: H / 2,
  vx: 0,
  vy: 0,
})

/**
 * Where a point of a stage `size` big is on the rink: the rink and a margin for the goals, as big as
 * fits, turned upright on a tall stage with Blue's goal at the bottom so two people holding a phone
 * each have an end. The shader's `to_rink`, line for line — a finger lands where the fan is drawn.
 */
export function rinkFit(size: V2, at: V2): V2 {
  const [sw, sh] = size
  if (sh > sw) {
    const s = Math.min(sw / (H + 6), sh / (W + 12))
    const o: V2 = [(sw - H * s) / 2, (sh - W * s) / 2]
    return [W - (at[1] - o[1]) / s, (at[0] - o[0]) / s]
  }
  const s = Math.min(sw / (W + 12), sh / (H + 6))
  return [(at[0] - (sw - W * s) / 2) / s, (at[1] - (sh - H * s) / 2) / s]
}

/* ---------------------------------------------------------------- for the GPU ---------------- */

/** Hand-packed to match `struct Rink` — gust.test.ts lays the struct out from the shader. */
export const RINK = {
  size: 0,
  grid: 8,
  fan0: 16,
  fan1: 32,
  dt: 48,
  time: 52,
  pause: 56,
  bytes: 64,
} as const

/** each fan as (x, y, blowing 0/1, breath), its aim worked out on the GPU from the puck */
export function packRink(
  p: { w: number; h: number; fans: [Fan, Fan]; dt: number; time: number; pause: boolean },
  into = new ArrayBuffer(RINK.bytes),
) {
  const u = new Uint32Array(into)
  const f = new Float32Array(into)
  u.set([p.w, p.h, W, H], 0)
  p.fans.forEach((fan, k) =>
    f.set([fan.x, fan.y, fan.blowing ? 1 : 0, fan.breath], (k ? RINK.fan1 : RINK.fan0) / 4),
  )
  f[RINK.dt / 4] = p.dt
  f[RINK.time / 4] = p.time
  u[RINK.pause / 4] = p.pause ? 1 : 0
  return into
}
