/**
 * Air hockey against the computer: a puck on a frictionless-ish table, two round paddles, a goal
 * at each end. Pure — the table, the physics and the computer's play — so hockey.test.ts can run
 * whole matches between computers without a page; HockeyDemo draws it and reads your finger.
 *
 * The table is in table units: 1 across, 1.6 long, y growing down. The computer defends the top
 * goal (y = 0) and you the bottom (y = TABLE_H).
 *
 * ⚠️ THE PHYSICS RUNS IN FIXED SMALL STEPS, NEVER ONE STEP PER FRAME. A puck at full speed covers
 * 0.07 units in a 60 Hz frame — more than its own diameter — so a frame-sized step lets it pass
 * straight through a paddle it should have hit. `advance` slices whatever time it is given into
 * steps of STEP seconds, so the result is also the same on a 60 Hz phone and a 144 Hz monitor.
 */

export const TABLE_W = 1
export const TABLE_H = 1.6
export const PUCK_R = 0.032
export const PADDLE_R = 0.058
/** the goal mouth's width; it is centred on each end */
export const GOAL_W = 0.34
export const STEP = 1 / 480
/** how much speed a wall gives back, and a paddle */
const WALL_E = 0.9
const PADDLE_E = 0.92
export const MAX_SPEED = 4.2
/** the air under the puck: a slow fade, never a stop */
const DRAG = 0.18
/**
 * ⚠️ THE CORNERS ARE ROUNDED, AS A REAL TABLE'S ARE, AND IT IS NOT DECORATION. With square corners
 * a paddle pressing a puck into one wedges it there for good: the wall sends it back, the paddle
 * sends it in again, every step, at full speed and going nowhere — measured, a simulated match
 * between computers sat 0–0 for ten minutes with the puck in a corner at 4 units a second. An arc
 * turns that press into a glance that sends the puck along the wall and out.
 */
export const CORNER_R = 0.13

export type Vec = { x: number; y: number }
export type Body = Vec & { vx: number; vy: number }
export type Side = 0 | 1 // 0 is you, at the bottom; 1 the computer, at the top
export type Event =
  | { kind: 'paddle'; side: Side; speed: number }
  | { kind: 'wall'; speed: number }
  | { kind: 'goal'; scorer: Side }

export type Table = {
  puck: Body
  paddles: [Body, Body]
  score: [number, number]
  /** seconds until play resumes after a goal; the puck waits on the side that conceded */
  pause: number
}

export function newTable(server: Side = 0): Table {
  return {
    puck: { x: 0.5, y: server === 0 ? TABLE_H * 0.72 : TABLE_H * 0.28, vx: 0, vy: 0 },
    paddles: [
      { x: 0.5, y: TABLE_H - 0.16, vx: 0, vy: 0 },
      { x: 0.5, y: 0.16, vx: 0, vy: 0 },
    ],
    score: [0, 0],
    pause: 0,
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

/**
 * Keep a round body of radius `rad` on the table: inside the walls and inside the corner arcs.
 * Returns where it ends up and the inward normal of what stopped it, if anything did.
 */
export function contain(
  x: number,
  y: number,
  rad: number,
): { x: number; y: number; nx: number; ny: number } | null {
  let cx = clamp(x, rad, TABLE_W - rad)
  let cy = clamp(y, rad, TABLE_H - rad)
  let nx = cx > x ? 1 : cx < x ? -1 : 0
  let ny = cy > y ? 1 : cy < y ? -1 : 0
  const ax = cx < CORNER_R ? CORNER_R : cx > TABLE_W - CORNER_R ? TABLE_W - CORNER_R : null
  const ay = cy < CORNER_R ? CORNER_R : cy > TABLE_H - CORNER_R ? TABLE_H - CORNER_R : null
  if (ax !== null && ay !== null) {
    const dx = cx - ax
    const dy = cy - ay
    const d = Math.hypot(dx, dy)
    const max = CORNER_R - rad
    if (d > max) {
      cx = ax + (dx / d) * max
      cy = ay + (dy / d) * max
      nx = -dx / d
      ny = -dy / d
    }
  }
  if (cx === x && cy === y) return null
  const n = Math.hypot(nx, ny) || 1
  return { x: cx, y: cy, nx: nx / n, ny: ny / n }
}
/** the paddle's own half, kept off the walls by its radius; it may reach the centre line */
export function clampToHalf(side: Side, p: Vec): Vec {
  const x = clamp(p.x, PADDLE_R, TABLE_W - PADDLE_R)
  const y =
    side === 0 ? clamp(p.y, TABLE_H / 2, TABLE_H - PADDLE_R) : clamp(p.y, PADDLE_R, TABLE_H / 2)
  const c = contain(x, y, PADDLE_R)
  return c ? { x: c.x, y: c.y } : { x, y }
}

/** move a paddle toward where it is wanted, no faster than `speed` units a second */
function steer(p: Body, side: Side, want: Vec, speed: number, dt: number) {
  const t = clampToHalf(side, want)
  const dx = t.x - p.x
  const dy = t.y - p.y
  const d = Math.hypot(dx, dy)
  const step = Math.min(d, speed * dt)
  const nx = d ? (dx / d) * step : 0
  const ny = d ? (dy / d) * step : 0
  p.vx = nx / dt
  p.vy = ny / dt
  p.x += nx
  p.y += ny
}

/** the puck against one paddle: pushed clear, and its velocity reflected off the paddle's motion */
function strike(t: Table, side: Side, events: Event[]) {
  const pu = t.puck
  const pa = t.paddles[side]
  const dx = pu.x - pa.x
  const dy = pu.y - pa.y
  const d = Math.hypot(dx, dy)
  const reach = PUCK_R + PADDLE_R
  if (d >= reach || d === 0) return
  const nx = dx / d
  const ny = dy / d
  pu.x = pa.x + nx * reach
  pu.y = pa.y + ny * reach
  // pinned against a wall, the puck stays on the table and the paddle is the one that gives way
  const c = contain(pu.x, pu.y, PUCK_R)
  if (c) {
    pa.x -= pu.x - c.x
    pa.y -= pu.y - c.y
    pu.x = c.x
    pu.y = c.y
  }
  const rvx = pu.vx - pa.vx
  const rvy = pu.vy - pa.vy
  const vn = rvx * nx + rvy * ny
  if (vn >= 0) return
  pu.vx -= (1 + PADDLE_E) * vn * nx
  pu.vy -= (1 + PADDLE_E) * vn * ny
  const s = Math.hypot(pu.vx, pu.vy)
  if (s > MAX_SPEED) {
    pu.vx *= MAX_SPEED / s
    pu.vy *= MAX_SPEED / s
  }
  events.push({ kind: 'paddle', side, speed: Math.min(s, MAX_SPEED) })
}

export const inMouth = (x: number) => Math.abs(x - TABLE_W / 2) < GOAL_W / 2 - PUCK_R * 0.25

/**
 * Run the table forward by `dt` seconds with each paddle steered toward its target. Returns what
 * happened, for sounds and the scoreboard. Mutates and returns the table it is given.
 */
export function advance(
  t: Table,
  dt: number,
  wants: [Vec, Vec],
  speeds: [number, number],
): { table: Table; events: Event[] } {
  const events: Event[] = []
  let left = Math.min(dt, 0.1)
  while (left > 1e-9) {
    const h = Math.min(STEP, left)
    left -= h
    steer(t.paddles[0], 0, wants[0], speeds[0], h)
    steer(t.paddles[1], 1, wants[1], speeds[1], h)
    if (t.pause > 0) {
      t.pause = Math.max(0, t.pause - h)
      continue
    }
    const pu = t.puck
    pu.x += pu.vx * h
    pu.y += pu.vy * h
    const fade = 1 - DRAG * h
    pu.vx *= fade
    pu.vy *= fade
    // the ends first: through the mouth is a goal, anywhere else the end is a wall like the rest
    const end = pu.y < PUCK_R ? 1 : pu.y > TABLE_H - PUCK_R ? 0 : null
    if (end !== null && inMouth(pu.x)) {
      const scorer: Side = end === 1 ? 0 : 1
      t.score[scorer]++
      events.push({ kind: 'goal', scorer })
      const conceded: Side = scorer === 0 ? 1 : 0
      t.puck = { x: 0.5, y: conceded === 0 ? TABLE_H * 0.72 : TABLE_H * 0.28, vx: 0, vy: 0 }
      t.pause = 0.9
      continue
    }
    const wall = contain(pu.x, pu.y, PUCK_R)
    if (wall) {
      pu.x = wall.x
      pu.y = wall.y
      const vn = pu.vx * wall.nx + pu.vy * wall.ny
      if (vn < 0) {
        pu.vx -= (1 + WALL_E) * vn * wall.nx
        pu.vy -= (1 + WALL_E) * vn * wall.ny
        events.push({ kind: 'wall', speed: -vn })
      }
    }
    strike(t, 0, events)
    strike(t, 1, events)
  }
  return { table: t, events }
}

/* ---------------------------------------------------------------------------- the computer */

export const LEVELS = ['rookie', 'club', 'pro'] as const
export type Level = (typeof LEVELS)[number]
type Skill = { speed: number; think: number; aim: number; reach: number; shots: number }
/**
 * How each level plays: how fast its paddle moves (units a second), how often it looks again
 * (seconds), how far off its read of the puck is, how far ahead along the puck's path it reads,
 * and which shots it knows — 1 straight at the middle, 2 also for the corners of the mouth, 3 also
 * banked off a side wall.
 */
export const SKILL: Record<Level, Skill> = {
  rookie: { speed: 1.5, think: 0.22, aim: 0.09, reach: 0.25, shots: 1 },
  club: { speed: 2.3, think: 0.11, aim: 0.045, reach: 0.6, shots: 2 },
  pro: { speed: 3.3, think: 0.045, aim: 0.012, reach: 1.2, shots: 3 },
}

/**
 * Where a shot is aimed along the far end, for a plan in [0, 1): the middle of the mouth, one of
 * its corners, or a corner seen in a side wall — aiming at the reflection is how a bank shot is
 * lined up. ⚠️ Measured: when every shot went at the middle, two Pro players rallied for four
 * minutes without a goal; a defence that stands in the middle of the mouth was never beaten.
 */
export function shotAt(plan: number, shots: number): number {
  const kind = Math.min(shots, 1 + Math.floor(plan * 3))
  const corner = GOAL_W / 2 - 0.05
  const right = plan * 6 - Math.floor(plan * 6) < 0.5
  if (kind === 1) return TABLE_W / 2
  const x = TABLE_W / 2 + (right ? corner : -corner)
  if (kind === 2) return x
  return right ? 2 * (TABLE_W - PUCK_R) - x : 2 * PUCK_R - x
}
export const YOUR_SPEED = 7

/**
 * Where the puck will cross the line y = `line`, if it is heading there within `within` seconds:
 * run along its path a wall at a time, losing what each side wall takes off its sideways speed.
 * Drag slows both directions alike, so it changes when the puck arrives but not where.
 */
export function crossing(pu: Body, line: number, within: number): number | null {
  if (pu.vy === 0 || Math.sign(line - pu.y) !== Math.sign(pu.vy)) return null
  let { x, y, vx } = pu
  const vy = pu.vy
  let time = 0
  for (let k = 0; k < 24; k++) {
    const ty = (line - y) / vy
    const tx = vx > 0 ? (TABLE_W - PUCK_R - x) / vx : vx < 0 ? (PUCK_R - x) / vx : Infinity
    if (ty <= tx) return time + ty > within ? null : x + vx * ty
    time += tx
    if (time > within) return null
    x += vx * tx
    y += vy * tx
    vx = -vx * WALL_E
  }
  return null
}

/**
 * Where a computer paddle wants to be, as if it defends the top goal — the bottom side's view is
 * the same table turned round. Attack a puck that is in its half and coming slowly or going away;
 * otherwise stand on its defence line where the puck will cross it.
 */
export function aim(t: Table, side: Side, level: Level, rand: () => number, plan = 0): Vec {
  const flip = side === 0
  const f = (v: Vec): Vec => (flip ? { x: TABLE_W - v.x, y: TABLE_H - v.y } : v)
  const pu = flip
    ? { x: TABLE_W - t.puck.x, y: TABLE_H - t.puck.y, vx: -t.puck.vx, vy: -t.puck.vy }
    : t.puck
  const pa = f(t.paddles[side])
  const sk = SKILL[level]
  const noise = (rand() - 0.5) * 2 * sk.aim
  const home = { x: TABLE_W / 2, y: 0.14 }
  // a puck on the centre line is in reach of both, so neither side leaves it lying there
  const mine = pu.y < TABLE_H / 2 + PUCK_R
  if (mine && pu.vy < 1.1 && t.pause === 0) {
    // get behind the puck, then drive through it toward the far goal
    const goal = { x: shotAt(plan, sk.shots) + noise * 2, y: TABLE_H }
    const gx = goal.x - pu.x
    const gy = goal.y - pu.y
    const g = Math.hypot(gx, gy) || 1
    const behind = {
      x: pu.x - (gx / g) * (PADDLE_R + PUCK_R),
      y: pu.y - (gy / g) * (PADDLE_R + PUCK_R),
    }
    const lined = pa.y < pu.y - PUCK_R && Math.hypot(pa.x - behind.x, pa.y - behind.y) < 0.06
    // a puck in a corner or against its own end has no "behind" to reach: knock it out from
    // wherever the paddle is
    const reachable = behind.y > PADDLE_R && behind.x > PADDLE_R && behind.x < TABLE_W - PADDLE_R
    if (!reachable) {
      const kx = pu.x - pa.x
      const ky = pu.y - pa.y
      const k = Math.hypot(kx, ky) || 1
      return f({ x: pu.x + (kx / k) * 0.15, y: pu.y + (ky / k) * 0.15 })
    }
    return f(lined ? { x: pu.x + (gx / g) * 0.2, y: pu.y + (gy / g) * 0.2 } : behind)
  }
  const line = 0.16
  const x = pu.vy < 0 ? crossing(pu, line, sk.reach) : null
  // with no read on the puck, shadow it from in front of the goal
  const tx = x ?? TABLE_W / 2 + (pu.x - TABLE_W / 2) * 0.5
  return f({ x: tx + noise, y: x === null ? home.y : line })
}

/** a computer player that only looks again every so often, the way a person does */
export function brain(side: Side, level: Level, rand: () => number) {
  let since = Infinity
  let want: Vec = side === 0 ? { x: 0.5, y: TABLE_H - 0.14 } : { x: 0.5, y: 0.14 }
  // a shot is chosen as the puck comes into its half, and held while it lines up and strikes
  let plan = rand()
  let wasMine = false
  return (t: Table, dt: number): Vec => {
    since += dt
    if (since >= SKILL[level].think) {
      since = 0
      const mine = side === 0 ? t.puck.y > TABLE_H / 2 : t.puck.y < TABLE_H / 2
      if (mine && !wasMine) plan = rand()
      wasMine = mine
      want = aim(t, side, level, rand, plan)
    }
    return want
  }
}

/* ---------------------------------------------------------------------------- what is kept */

export const HOCKEY_KEY = 'lab_hockey_v1'
export const TABLES = ['arcade', 'classic', 'ice'] as const
export const PADDLE_COLOURS = [
  '#ff3d7f',
  '#21d4fd',
  '#ffd23f',
  '#3ddc97',
  '#9b5de5',
  '#ff8c42',
] as const
export const MATCH = [3, 5, 7] as const
/** `fastest` is the quickest match won, in whole seconds of play; 0 is none yet */
export type Tally = {
  won: number
  lost: number
  streak: number
  bestStreak: number
  best: number
  fastest: number
}
export type Saved = {
  level: Level
  table: (typeof TABLES)[number]
  colour: number
  to: (typeof MATCH)[number]
  trail: boolean
  sound: boolean
  record: Record<Level, Tally>
}
const NONE: Tally = { won: 0, lost: 0, streak: 0, bestStreak: 0, best: 0, fastest: 0 }
export const EMPTY: Saved = {
  level: 'club',
  table: 'arcade',
  colour: 0,
  to: 5,
  trail: true,
  sound: true,
  record: { rookie: NONE, club: NONE, pro: NONE },
}

/** a match is over: the record moves on */
export function recordMatch(r: Tally, you: number, them: number, seconds: number): Tally {
  const won = you > them
  const streak = won ? r.streak + 1 : 0
  const time = Math.max(1, Math.round(seconds))
  return {
    won: r.won + (won ? 1 : 0),
    lost: r.lost + (won ? 0 : 1),
    streak,
    bestStreak: Math.max(r.bestStreak, streak),
    best: won ? Math.max(r.best, you - them) : r.best,
    fastest: won ? (r.fastest ? Math.min(r.fastest, time) : time) : r.fastest,
  }
}

const count = (v: unknown) =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 1e6 ? v : 0
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
  const rec = (typeof o.record === 'object' && o.record ? o.record : {}) as Record<string, unknown>
  const record = {} as Record<Level, Tally>
  for (const l of LEVELS) {
    const x = (typeof rec[l] === 'object' && rec[l] ? rec[l] : {}) as Record<string, unknown>
    record[l] = {
      won: count(x.won),
      lost: count(x.lost),
      streak: count(x.streak),
      bestStreak: count(x.bestStreak),
      best: count(x.best),
      fastest: count(x.fastest),
    }
  }
  return {
    level: pick(LEVELS, o.level, EMPTY.level),
    table: pick(TABLES, o.table, EMPTY.table),
    colour:
      typeof o.colour === 'number' &&
      Number.isInteger(o.colour) &&
      o.colour >= 0 &&
      o.colour < PADDLE_COLOURS.length
        ? o.colour
        : EMPTY.colour,
    to: pick(MATCH, o.to, EMPTY.to),
    trail: typeof o.trail === 'boolean' ? o.trail : EMPTY.trail,
    sound: typeof o.sound === 'boolean' ? o.sound : EMPTY.sound,
    record,
  }
}
