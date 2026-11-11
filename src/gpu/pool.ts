/**
 * Eight-ball pool against the computer. Pure — the table, the balls rolling and colliding, the
 * pockets, the rules of a turn and the computer's choice of shot — so pool.test.ts can play racks
 * without a page; PoolDemo draws the table and takes the aim.
 *
 * The table is 2.24 × 1.12 (metres of playing surface), the origin at its top-left; ball 0 is the
 * cue ball, 1–7 the solids, 8 the black and 9–15 the stripes.
 */
import { rng } from './bricks'

export const TW = 2.24
export const TH = 1.12
export const R = 0.0286
/** a ball whose centre comes this close to a pocket's centre drops */
export const POCKET = 0.062
export const POCKETS = [
  { x: 0, y: 0 },
  { x: TW / 2, y: -0.012 },
  { x: TW, y: 0 },
  { x: 0, y: TH },
  { x: TW / 2, y: TH + 0.012 },
  { x: TW, y: TH },
]
/** the fastest a cue can send the ball, in metres a second */
export const MAX_SPEED = 5.2
const ROLL = 0.32 // rolling slows a ball this many metres a second, every second
const CUSHION = 0.78 // a cushion gives back this much of the speed into it
const BALL_E = 0.95 // and a collision between balls this much

export type Ball = { n: number; x: number; y: number; vx: number; vy: number; down: boolean }
export type Group = 'solids' | 'stripes'
export const groupOf = (n: number): Group | null =>
  n >= 1 && n <= 7 ? 'solids' : n >= 9 ? 'stripes' : null

export const HEAD_X = TW * 0.25
export const FOOT = { x: TW * 0.73, y: TH / 2 }
/** fifteen in a triangle, the black in the middle and a solid and a stripe in the back corners */
export function rack(seed: number): Ball[] {
  const rand = rng(seed)
  const rest = [1, 2, 3, 4, 5, 6, 7, 9, 10, 11, 12, 13, 14, 15]
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[rest[i], rest[j]] = [rest[j], rest[i]]
  }
  // the back corners: one of each kind
  const solid = rest.findIndex((n) => n < 8)
  const a = rest.splice(solid, 1)[0]
  const stripe = rest.findIndex((n) => n > 8)
  const b = rest.splice(stripe, 1)[0]
  const order: number[] = []
  let k = 0
  const balls: Ball[] = [{ n: 0, x: HEAD_X, y: TH / 2, vx: 0, vy: 0, down: false }]
  for (let row = 0; row < 5; row++)
    for (let i = 0; i <= row; i++) {
      let n: number
      if (row === 2 && i === 1) n = 8
      else if (row === 4 && i === 0) n = a
      else if (row === 4 && i === 4) n = b
      else n = rest[k++]
      order.push(n)
      const dx = row * R * Math.sqrt(3) * 1.002
      const dy = (i - row / 2) * R * 2.004
      balls.push({ n, x: FOOT.x + dx, y: FOOT.y + dy, vx: 0, vy: 0, down: false })
    }
  return balls.sort((p, q) => p.n - q.n)
}

/* ---------------------------------------------------------------------------- physics */

export type ShotLog = {
  /** the first ball the cue ball touched, or -1 */
  first: number
  /** balls that dropped, in order */
  down: number[]
  /** whether any ball reached a cushion after the first contact */
  rail: boolean
  /** seconds until everything stopped */
  time: number
  /** where every ball was, sixty times a second, for drawing the shot: x, y and 1 if down, per ball */
  frames: number[][]
}
const near = (b: Ball) => POCKETS.some((p) => Math.hypot(b.x - p.x, b.y - p.y) < POCKET + R * 0.6)

/**
 * Strike the cue ball at `angle` with `power` (0–1) and roll everything until it stops. Small
 * steps, so a ball never passes through another however hard the shot.
 */
export function strike(
  balls: Ball[],
  angle: number,
  power: number,
  record = false,
): { balls: Ball[]; log: ShotLog } {
  const bs = balls.map((b) => ({ ...b }))
  const cue = bs.find((b) => b.n === 0)!
  const sp = Math.max(0, Math.min(1, power)) * MAX_SPEED
  cue.vx = Math.cos(angle) * sp
  cue.vy = Math.sin(angle) * sp
  const log: ShotLog = { first: -1, down: [], rail: false, time: 0, frames: [] }
  const dt = 1 / 600
  let step = 0
  for (let t = 0; t < 30; t += dt) {
    if (record && step++ % 10 === 0) log.frames.push(bs.flatMap((b) => [b.x, b.y, b.down ? 1 : 0]))
    let moving = false
    for (const b of bs) {
      if (b.down) continue
      const v = Math.hypot(b.vx, b.vy)
      if (v === 0) continue
      moving = true
      const slow = Math.max(0, v - ROLL * dt) / v
      b.vx *= slow
      b.vy *= slow
      b.x += b.vx * dt
      b.y += b.vy * dt
      if (Math.hypot(b.vx, b.vy) < 0.004) b.vx = b.vy = 0
      // pockets first, then the cushions — a ball in a pocket's mouth is past the cushion
      const p = POCKETS.find((q) => Math.hypot(b.x - q.x, b.y - q.y) < POCKET)
      if (p) {
        b.down = true
        b.vx = b.vy = 0
        log.down.push(b.n)
        continue
      }
      if (!near(b)) {
        let hit = false
        if (b.x < R || b.x > TW - R) {
          b.x = b.x < R ? R : TW - R
          b.vx = (b.x === R ? 1 : -1) * Math.abs(b.vx) * CUSHION
          hit = true
        }
        if (b.y < R || b.y > TH - R) {
          b.y = b.y < R ? R : TH - R
          b.vy = (b.y === R ? 1 : -1) * Math.abs(b.vy) * CUSHION
          hit = true
        }
        if (hit && log.first >= 0) log.rail = true
      } else {
        // in a pocket's mouth the ball is held to the table, so it falls in rather than off
        b.x = Math.max(-R, Math.min(TW + R, b.x))
        b.y = Math.max(-R, Math.min(TH + R, b.y))
      }
    }
    // collisions: equal masses, so the push along the line between centres is shared
    for (let i = 0; i < bs.length; i++) {
      const a = bs[i]
      if (a.down) continue
      for (let j = i + 1; j < bs.length; j++) {
        const b = bs[j]
        if (b.down) continue
        const dx = b.x - a.x
        const dy = b.y - a.y
        const d2 = dx * dx + dy * dy
        if (d2 >= 4 * R * R || d2 === 0) continue
        const d = Math.sqrt(d2)
        const nx = dx / d
        const ny = dy / d
        const rel = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny
        // apart again by the overlap, shared
        const push = (2 * R - d) / 2
        a.x -= nx * push
        a.y -= ny * push
        b.x += nx * push
        b.y += ny * push
        if (rel <= 0) continue
        const jn = (rel * (1 + BALL_E)) / 2
        a.vx -= jn * nx
        a.vy -= jn * ny
        b.vx += jn * nx
        b.vy += jn * ny
        if (log.first < 0 && (a.n === 0 || b.n === 0)) log.first = a.n === 0 ? b.n : a.n
      }
    }
    log.time = t
    if (!moving) break
  }
  if (record) log.frames.push(bs.flatMap((b) => [b.x, b.y, b.down ? 1 : 0]))
  return { balls: bs, log }
}

/**
 * Where a shot at `angle` first touches something: the cue ball's centre at that moment, the ball
 * it meets (or -1 for a cushion) and the way that ball will set off — the aiming guide.
 */
export function aimLine(balls: Ball[], angle: number) {
  const cue = balls.find((b) => b.n === 0)!
  const dx = Math.cos(angle)
  const dy = Math.sin(angle)
  let t = Infinity
  let hit = -1
  for (const b of balls) {
    if (b.down || b.n === 0) continue
    // |cue + t·d − b| = 2R, the nearer root
    const ox = cue.x - b.x
    const oy = cue.y - b.y
    const bq = ox * dx + oy * dy
    const c = ox * ox + oy * oy - 4 * R * R
    const disc = bq * bq - c
    if (disc < 0) continue
    const tt = -bq - Math.sqrt(disc)
    if (tt > 0 && tt < t) {
      t = tt
      hit = b.n
    }
  }
  const wall = Math.min(
    dx > 0 ? (TW - R - cue.x) / dx : dx < 0 ? (R - cue.x) / dx : Infinity,
    dy > 0 ? (TH - R - cue.y) / dy : dy < 0 ? (R - cue.y) / dy : Infinity,
  )
  if (wall < t)
    return { x: cue.x + dx * wall, y: cue.y + dy * wall, hit: -1, sends: null as number | null }
  const x = cue.x + dx * t
  const y = cue.y + dy * t
  const o = balls.find((b) => b.n === hit)!
  return { x, y, hit, sends: Math.atan2(o.y - y, o.x - x) }
}

/* ---------------------------------------------------------------------------- the rules */

export type Who = 0 | 1
export type Game = {
  balls: Ball[]
  turn: Who
  /** each side's group once the table is decided */
  groups: [Group | null, Group | null]
  /** the cue ball may be placed anywhere before the next shot */
  inHand: boolean
  broken: boolean
  winner: Who | null
  /** what the last shot did, in words */
  said: string
}
export function newGame(seed: number, first: Who = 0): Game {
  return {
    balls: rack(seed),
    turn: first,
    groups: [null, null],
    inHand: false,
    broken: false,
    winner: null,
    said: '',
  }
}
const left = (g: Game, grp: Group) => g.balls.filter((b) => !b.down && groupOf(b.n) === grp).length
/** which balls a side may legally hit first */
export function targets(g: Game, w: Who = g.turn): number[] {
  const grp = g.groups[w]
  if (!grp)
    return g.balls.filter((b) => !b.down && b.n !== 0 && (b.n !== 8 || !g.broken)).map((b) => b.n)
  if (left(g, grp) === 0) return [8]
  return g.balls.filter((b) => !b.down && groupOf(b.n) === grp).map((b) => b.n)
}

/** put the cue ball down somewhere legal: inside the table and touching nothing */
export function canPlace(g: Game, x: number, y: number) {
  if (x < R || x > TW - R || y < R || y > TH - R) return false
  return g.balls.every((b) => b.down || b.n === 0 || Math.hypot(b.x - x, b.y - y) >= 2 * R + 0.002)
}
export function place(g: Game, x: number, y: number): Game {
  if (!g.inHand || !canPlace(g, x, y)) return g
  return place_(g, { x, y })
}

/** play a shot by the rules of eight-ball, and say whose turn it is after */
export function shoot(
  g: Game,
  angle: number,
  power: number,
  record = false,
): { game: Game; log: ShotLog } {
  const legal = targets(g)
  const { balls, log } = strike(g.balls, angle, power, record)
  const w = g.turn
  const them: Who = w === 0 ? 1 : 0
  const groups: Game['groups'] = [...g.groups]
  const scratch = log.down.includes(0)
  const potted = log.down.filter((n) => n !== 0)
  let foul: string | null = null
  if (scratch) foul = 'the cue ball went in'
  else if (log.first < 0) foul = 'nothing was hit'
  else if (!legal.includes(log.first))
    foul = `the first ball hit was the ${log.first === 8 ? 'black' : `${log.first}`}`
  else if (!potted.length && !log.rail) foul = 'nothing reached a cushion'

  // the black decides the game: legally last, it wins; any other way, it loses
  if (potted.includes(8)) {
    if (!g.broken) {
      // down on the break: back on its spot, and play on
      const spot = balls.find((b) => b.n === 8)!
      Object.assign(spot, { x: FOOT.x, y: FOOT.y, down: false, vx: 0, vy: 0 })
    } else {
      const earned =
        !foul && groups[w] !== null && left({ ...g, balls }, groups[w]!) === 0 && legal.includes(8)
      return {
        game: {
          ...g,
          balls,
          groups,
          broken: true,
          winner: earned ? w : them,
          inHand: false,
          said: earned
            ? 'The black goes down — game!'
            : `The black went down ${foul ? `on a foul (${foul})` : 'too early'} — that loses.`,
        },
        log,
      }
    }
  }
  // an open table is decided by the first group potted on a fair shot after the break
  if (!foul && g.broken && !groups[w]) {
    const first = potted.map(groupOf).find(Boolean)
    if (first) {
      groups[w] = first
      groups[them] = first === 'solids' ? 'stripes' : 'solids'
    }
  }
  if (scratch) {
    const cue = balls.find((b) => b.n === 0)!
    Object.assign(cue, { down: false, x: HEAD_X, y: TH / 2, vx: 0, vy: 0 })
  }
  const mine = groups[w]
  const keep = !foul && potted.some((n) => (mine ? groupOf(n) === mine : n !== 8))
  const game: Game = {
    balls,
    turn: keep ? w : them,
    groups,
    inHand: !!foul,
    broken: true,
    winner: null,
    said: foul
      ? `Foul — ${foul}. Ball in hand.`
      : keep
        ? `${potted.length === 1 ? 'Down' : `${potted.length} down`} — shoot again.`
        : potted.length
          ? 'Down, but not one of theirs to keep the turn.'
          : 'Nothing down.',
  }
  return { game, log }
}

/* ---------------------------------------------------------------------------- the computer */

export const LEVELS = ['easy', 'fair', 'hard'] as const
export type Level = (typeof LEVELS)[number]
/** how far off its aim each level's cue may wander, in radians, and how many shots it tries in full */
const SKILL: Record<Level, { wobble: number; tries: number }> = {
  easy: { wobble: 0.035, tries: 3 },
  fair: { wobble: 0.012, tries: 10 },
  hard: { wobble: 0.003, tries: 28 },
}
export type Plan = { angle: number; power: number; place?: { x: number; y: number } }

const place_ = (g: Game, at: { x: number; y: number }): Game => ({
  ...g,
  balls: g.balls.map((b) => (b.n === 0 ? { ...b, x: at.x, y: at.y, down: false } : b)),
})
/** whether a straight path from a to b at ball width is clear of every ball but those named */
function clear(balls: Ball[], ax: number, ay: number, bx: number, by: number, skip: number[]) {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy || 1
  return balls.every((o) => {
    if (o.down || skip.includes(o.n)) return true
    const u = Math.max(0, Math.min(1, ((o.x - ax) * dx + (o.y - ay) * dy) / len2))
    return Math.hypot(ax + dx * u - o.x, ay + dy * u - o.y) >= 2 * R
  })
}

/**
 * The computer's shot. Every legal ball into every pocket is aimed by the ghost ball — where the
 * cue ball must be at contact to send it straight to the pocket — and the open, gentle cuts are
 * then PLAYED, in full, by `shoot`, at a few strengths. The best that keeps the turn is taken,
 * with the level's wobble put on the aim afterwards: the plan is good, the cue is not always.
 */
export function plan(g: Game, level: Level, rand: () => number = Math.random): Plan {
  const skill = SKILL[level]
  let base = g
  let place: Plan['place']
  if (g.inHand) {
    // ball in hand: try a few spots behind easy shots, keep the first legal one
    const spot = [
      { x: HEAD_X, y: TH / 2 },
      { x: TW / 2, y: TH / 2 },
      { x: TW * 0.4, y: TH * 0.3 },
      { x: TW * 0.4, y: TH * 0.7 },
      { x: TW * 0.6, y: TH * 0.3 },
      { x: TW * 0.6, y: TH * 0.7 },
    ].filter((s) => canPlace(g, s.x, s.y))
    place = spot[Math.floor(rand() * spot.length)]
    if (place) base = place_(g, place)
  }
  const cue = base.balls.find((b) => b.n === 0)!
  const legal = targets(base)
  type Cand = { angle: number; score: number }
  const cands: Cand[] = []
  for (const n of legal) {
    const o = base.balls.find((b) => b.n === n)!
    for (const p of POCKETS) {
      const px = p.x - o.x
      const py = p.y - o.y
      const pd = Math.hypot(px, py)
      const gx = o.x - (px / pd) * 2 * R
      const gy = o.y - (py / pd) * 2 * R
      const cx = gx - cue.x
      const cy = gy - cue.y
      const cd = Math.hypot(cx, cy)
      const cut = Math.acos(Math.max(-1, Math.min(1, (cx * px + cy * py) / (cd * pd))))
      if (cut > 1.2) continue
      if (
        !clear(base.balls, cue.x, cue.y, gx, gy, [0, n]) ||
        !clear(base.balls, o.x, o.y, p.x, p.y, [n])
      )
        continue
      cands.push({ angle: Math.atan2(cy, cx), score: -cut * 2 - cd - pd * 0.6 })
    }
  }
  cands.sort((a, b) => b.score - a.score)
  let best: { angle: number; power: number; value: number } | null = null
  for (const c of cands.slice(0, skill.tries)) {
    for (const power of [0.35, 0.55, 0.8]) {
      const { game, log } = shoot(base, c.angle, power)
      const won = game.winner === base.turn
      const lost = game.winner !== null && !won
      const keep = game.turn === base.turn && !game.inHand
      const value = (won ? 100 : lost ? -100 : keep ? 10 : game.inHand ? -6 : 0) - log.time * 0.1
      if (!best || value > best.value) best = { angle: c.angle, power, value }
    }
    if (best && best.value >= 9) break
  }
  if (!best) {
    // nothing clean: aim straight at the nearest legal ball, firmly enough to reach a cushion
    const o = base.balls
      .filter((b) => legal.includes(b.n))
      .sort(
        (a, b) => Math.hypot(a.x - cue.x, a.y - cue.y) - Math.hypot(b.x - cue.x, b.y - cue.y),
      )[0]
    best = { angle: o ? Math.atan2(o.y - cue.y, o.x - cue.x) : 0, power: 0.6, value: 0 }
  }
  const wobble = (rand() * 2 - 1) * skill.wobble
  return { angle: best.angle + wobble, power: best.power, place }
}

/* ---------------------------------------------------------------------------- what is kept */

export const POOL_KEY = 'lab_pool_v1'
export const CLOTHS = ['green', 'blue', 'red'] as const
export type Tally = { won: number; lost: number }
export type Saved = {
  level: Level
  cloth: (typeof CLOTHS)[number]
  /** draw the line the cue ball will take, and where the ball it meets will go */
  guide: boolean
  record: Record<Level, Tally>
}
const NONE: Tally = { won: 0, lost: 0 }
export const EMPTY: Saved = {
  level: 'fair',
  cloth: 'green',
  guide: true,
  record: { easy: NONE, fair: NONE, hard: NONE },
}
const whole = (v: unknown) =>
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
    record[l] = { won: whole(x.won), lost: whole(x.lost) }
  }
  return {
    level: pick(LEVELS, o.level, EMPTY.level),
    cloth: pick(CLOTHS, o.cloth, EMPTY.cloth),
    guide: typeof o.guide === 'boolean' ? o.guide : EMPTY.guide,
    record,
  }
}
