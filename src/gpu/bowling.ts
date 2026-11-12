/**
 * Bowling: ten frames against a computer bowler, a lane of real size seen from behind the foul
 * line. Choose where to stand, where to aim, how much hook and how fast — then time the release.
 * The ball runs straight on the oil and hooks once it leaves it; it scatters the pins, and they
 * scatter each other.
 *
 * Pure, so bowling.test.ts can bowl a few thousand balls without a page. Metres and seconds; x
 * across the lane (right positive, as you face the pins), y down it from the foul line.
 */

import { whole } from './kept'

export const LANE_HALF = 0.527
export const HEAD_PIN = 18.29
/** where the oil ends and the ball starts to hook */
export const OIL = 12
export const PIT = HEAD_PIN + 1.2
export const BALL_R = 0.109
export const PIN_R = 0.06
/**
 * A pin going over sweeps a wider circle than a standing one, because a falling pin is long. How
 * much wider was measured, not guessed: at 0.12 m a ball straight at the head pin cleared all ten,
 * which never happens; at 0.105 or less it leaves the 4-6 split, as a head-on ball does. 0.07 puts
 * a steady bowler in the pocket near a strike in two, and a loose one near one in eight.
 */
export const FALLING_R = 0.07
const BALL_M = 7
const PIN_M = 1.5
const STEP = 1 / 500
/** how far apart the pins stand, centre to centre */
export const SPACING = 0.3048
/** the side walls of the pin deck, which pins bounce off */
export const KICKBACK = LANE_HALF + 0.24

export type Pin = {
  n: number
  x: number
  y: number
  vx: number
  vy: number
  down: boolean
  gone: boolean
}
/** the ten pins on their spots: 1 at the front, 7 to 10 across the back */
export function rack(standing: readonly number[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]): Pin[] {
  const row = SPACING * Math.sin(Math.PI / 3)
  const spots: Record<number, [number, number]> = {
    1: [0, 0],
    2: [-0.5, 1],
    3: [0.5, 1],
    4: [-1, 2],
    5: [0, 2],
    6: [1, 2],
    7: [-1.5, 3],
    8: [-0.5, 3],
    9: [0.5, 3],
    10: [1.5, 3],
  }
  return standing.map((n) => ({
    n,
    x: spots[n][0] * SPACING,
    y: HEAD_PIN + spots[n][1] * row,
    vx: 0,
    vy: 0,
    down: false,
    gone: false,
  }))
}

export type Shot = {
  /** where the ball is let go across the lane, metres from the middle */
  x: number
  /** the line it is sent along, in radians from straight down the lane (right positive) */
  angle: number
  /** metres a second at the release */
  speed: number
  /** hook: positive curls the ball to the LEFT once off the oil, as a right-hander's does */
  hook: number
}
export type Roll = {
  /** which pins this ball knocked down, by number */
  felled: number[]
  gutter: boolean
  /** the ball's path and every pin's, every 1/60 s, when asked for */
  frames: { ball: [number, number]; pins: [number, number, boolean][] }[]
}

/** bowl one ball at the pins still standing */
export function bowl(standing: readonly number[], shot: Shot, keep = false): Roll {
  const pins = rack(standing)
  let x = shot.x
  let y = 0.3
  let vx = Math.sin(shot.angle) * shot.speed
  let vy = Math.cos(shot.angle) * shot.speed
  let gutter = false
  const frames: Roll['frames'] = []
  for (let i = 0; i < 8 / STEP; i++) {
    // the ball: straight on the oil, hooking after it, slowing a little all the way
    if (!gutter) {
      if (y > OIL) vx -= shot.hook * 1.1 * STEP
      vy -= 0.25 * STEP
      x += vx * STEP
      y += vy * STEP
      // a gutter ball is one that drops off the lane before it reaches the pins; a ball knocked
      // sideways among the pins is not one, and must not stop knocking them
      if (Math.abs(x) > LANE_HALF - BALL_R * 0.4 && y < HEAD_PIN - 0.2) {
        gutter = true
        x = Math.sign(x) * (LANE_HALF + BALL_R)
        vx = 0
      }
    } else y += vy * STEP
    // the pins, once the ball is among them
    if (y > HEAD_PIN - 1) {
      for (const p of pins) {
        if (p.gone) continue
        const sp = Math.hypot(p.vx, p.vy)
        if (sp > 0) {
          const slow = Math.min(sp, 2.2 * STEP)
          p.vx -= (p.vx / sp) * slow
          p.vy -= (p.vy / sp) * slow
        }
        p.x += p.vx * STEP
        p.y += p.vy * STEP
        if (Math.abs(p.x) > KICKBACK) {
          p.x = Math.sign(p.x) * KICKBACK
          p.vx = -p.vx * 0.5
        }
        if (p.y > PIT || p.y < HEAD_PIN - 2) p.gone = true
      }
      if (!gutter)
        for (const p of pins) {
          if (p.gone) continue
          const push = hit(p, BALL_M, { x, y }, { vx, vy }, BALL_R + PIN_R)
          vx += push[0]
          vy += push[1]
        }
      for (let a = 0; a < pins.length; a++)
        for (let b = a + 1; b < pins.length; b++) {
          const p = pins[a]
          const q = pins[b]
          if (p.gone || q.gone) continue
          const reach = (p.down ? FALLING_R : PIN_R) + (q.down ? FALLING_R : PIN_R)
          pinPin(p, q, reach)
        }
      for (const p of pins) if (!p.down && Math.hypot(p.vx, p.vy) > 0.3) p.down = true
    }
    if (keep && i % Math.round(1 / 60 / STEP) === 0)
      frames.push({ ball: [x, y], pins: pins.map((p) => [p.x, p.y, p.down || p.gone]) })
    // done when the ball is in the pit and nothing is moving
    if (y > PIT + 0.5 && pins.every((p) => p.gone || Math.hypot(p.vx, p.vy) < 0.02)) break
  }
  return { felled: pins.filter((p) => p.down || p.gone).map((p) => p.n), gutter, frames }
}
/** the ball meeting a pin: an elastic knock along the line between them */
function hit(
  p: Pin,
  mass: number,
  at: { x: number; y: number },
  v: { vx: number; vy: number },
  reach: number,
): [number, number] {
  const dx = p.x - at.x
  const dy = p.y - at.y
  const d = Math.hypot(dx, dy)
  if (d >= reach || d === 0) return [0, 0]
  const nx = dx / d
  const ny = dy / d
  const rel = (v.vx - p.vx) * nx + (v.vy - p.vy) * ny
  if (rel <= 0) return [0, 0]
  const e = 0.8
  const j = ((1 + e) * rel) / (1 / mass + 1 / PIN_M)
  p.vx += (j / PIN_M) * nx
  p.vy += (j / PIN_M) * ny
  // and out of overlap, so they do not knock twice
  p.x = at.x + nx * reach
  p.y = at.y + ny * reach
  p.down = true
  return [(-j / mass) * nx, (-j / mass) * ny]
}
function pinPin(p: Pin, q: Pin, reach: number) {
  const dx = q.x - p.x
  const dy = q.y - p.y
  const d = Math.hypot(dx, dy)
  if (d >= reach || d === 0) return
  const nx = dx / d
  const ny = dy / d
  const rel = (p.vx - q.vx) * nx + (p.vy - q.vy) * ny
  if (rel <= 0) return
  const j = (1.6 * rel) / 2
  p.vx -= j * nx
  p.vy -= j * ny
  q.vx += j * nx
  q.vy += j * ny
  const over = (reach - d) / 2
  p.x -= nx * over
  p.y -= ny * over
  q.x += nx * over
  q.y += ny * over
  if (Math.hypot(p.vx, p.vy) > 0.3) p.down = true
  if (Math.hypot(q.vx, q.vy) > 0.3) q.down = true
}

/* --------------------------------------------------------------------------- scoring */

export type Frame = { rolls: number[]; total: number | null }
/**
 * The scorecard: ten frames, each one or two balls — three in the tenth after a strike or a
 * spare. A strike scores ten and the next two balls, a spare ten and the next one; a frame's total
 * stays open until those balls are bowled.
 */
export function card(rolls: readonly number[]): Frame[] {
  const frames: Frame[] = []
  let i = 0
  let running = 0
  for (let f = 0; f < 10; f++) {
    if (i >= rolls.length) {
      frames.push({ rolls: [], total: null })
      continue
    }
    const first = rolls[i]
    if (f === 9) {
      const mine = rolls.slice(i, i + 3)
      const extra = first === 10 || first + (rolls[i + 1] ?? 0) === 10
      const need = extra ? 3 : 2
      const done = mine.length >= need
      running += done ? mine.slice(0, need).reduce((s, x) => s + x, 0) : 0
      frames.push({ rolls: mine.slice(0, need), total: done ? running : null })
      break
    }
    if (first === 10) {
      const b = rolls.slice(i + 1, i + 3)
      running += b.length === 2 ? 10 + b[0] + b[1] : 0
      frames.push({ rolls: [10], total: b.length === 2 ? running : null })
      i += 1
      continue
    }
    const second = rolls[i + 1]
    if (second === undefined) {
      frames.push({ rolls: [first], total: null })
      i += 1
      continue
    }
    if (first + second === 10) {
      const b = rolls[i + 2]
      running += b === undefined ? 0 : 10 + b
      frames.push({ rolls: [first, second], total: b === undefined ? null : running })
    } else {
      running += first + second
      frames.push({ rolls: [first, second], total: running })
    }
    i += 2
  }
  return frames
}
export const score = (rolls: readonly number[]) => {
  const c = card(rolls)
  let last = 0
  for (const f of c) if (f.total !== null) last = f.total
  return last
}
/** whether a game is over, and which pins stand for the next ball */
export function next(rolls: readonly number[]): { over: boolean; fresh: boolean } {
  let i = 0
  for (let f = 0; f < 9; f++) {
    if (i >= rolls.length) return { over: false, fresh: true }
    if (rolls[i] === 10) {
      i += 1
      continue
    }
    if (i + 1 >= rolls.length) return { over: false, fresh: false }
    i += 2
  }
  const tenth = rolls.slice(i)
  if (tenth.length === 0) return { over: false, fresh: true }
  if (tenth.length === 1) return { over: false, fresh: tenth[0] === 10 }
  if (tenth.length === 2) {
    if (tenth[0] === 10) return { over: false, fresh: tenth[1] === 10 }
    if (tenth[0] + tenth[1] === 10) return { over: false, fresh: true }
    return { over: true, fresh: true }
  }
  return { over: true, fresh: true }
}

/* --------------------------------------------------------------------------- the computer */

export const LEVELS = ['easy', 'fair', 'hard'] as const
export type Level = (typeof LEVELS)[number]
/** each bowler's hand: how much its stance, line and speed wander from what it meant */
export const HANDS: Record<Level, { x: number; angle: number; speed: number; hook: number }> = {
  easy: { x: 0.09, angle: 0.013, speed: 0.6, hook: 0 },
  fair: { x: 0.045, angle: 0.006, speed: 0.35, hook: 0.5 },
  hard: { x: 0.018, angle: 0.0025, speed: 0.15, hook: 1 },
}
/**
 * The shot the computer means to bowl at the pins standing: it tries a fan of stances and lines,
 * keeps the best few, and takes the one that does best on average when its own hand wobbles — the
 * same lesson as Putt, where the single best line is a knife-edge. At a spare it also tries a
 * straight ball, as bowlers do — measured over ten leaves, that took Hard from 279 spares in 400 to
 * 362, and Fair from 259 to 293. A second, finer look round Hard's best line was tried too and
 * made no difference at all, so it is not here.
 */
export function plan(standing: readonly number[], level: Level, rand: () => number): Shot {
  const h = HANDS[level]
  const speed = 7.6
  const hooks = standing.length < 10 && h.hook > 0 ? [0, h.hook] : [h.hook]
  const tried: { s: Shot; v: number }[] = []
  const tryOne = (s: Shot) => tried.push({ s, v: bowl(standing, s).felled.length })
  for (const hook of hooks)
    for (let xi = -6; xi <= 6; xi++)
      for (let ai = -6; ai <= 6; ai++) tryOne({ x: xi * 0.06, angle: ai * 0.006, speed, hook })
  tried.sort((a, b) => b.v - a.v)
  let best = tried[0].s
  let bv = -Infinity
  for (const c of tried.slice(0, 6)) {
    let t = 0
    for (let k = 0; k < 6; k++) t += bowl(standing, wobble(c.s, level, rand)).felled.length
    if (t > bv) {
      bv = t
      best = c.s
    }
  }
  return best
}
const normal = (rand: () => number) => (rand() + rand() + rand() - 1.5) / 0.5
export function wobble(s: Shot, level: Level, rand: () => number): Shot {
  const h = HANDS[level]
  return {
    x: s.x + normal(rand) * h.x,
    angle: s.angle + normal(rand) * h.angle,
    speed: s.speed + normal(rand) * h.speed,
    hook: s.hook,
  }
}
/** a whole game for a level, for the tests: every roll */
export function playGame(level: Level, rand: () => number): number[] {
  const rolls: number[] = []
  let standing = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
  while (!next(rolls).over && rolls.length < 21) {
    const r = bowl(standing, wobble(plan(standing, level, rand), level, rand))
    rolls.push(r.felled.length)
    const n = next(rolls)
    standing = n.fresh
      ? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
      : standing.filter((p) => !r.felled.includes(p))
  }
  return rolls
}

/* --------------------------------------------------------------------------- your release */

/**
 * The release meter: a needle swings across a bar, and where it is when you let go is how far
 * your line strays — nothing in the middle, most at the ends.
 */
export const SWING = 1.4
export const needle = (t: number) => Math.sin((t / SWING) * Math.PI * 2)
export const strayFor = (needleAt: number) => needleAt * 0.012

/* --------------------------------------------------------------------------- what is kept */

export const BOWLING_KEY = 'lab_bowling_v1'
export const LANES = ['maple', 'neon', 'retro'] as const
export type Tally = { won: number; lost: number; best: number; strikes: number }
export type Saved = {
  level: Level
  lane: (typeof LANES)[number]
  left: boolean
  /** your last stance, line, hook and speed, so a good shot can be bowled again */
  stance: Shot
  record: Record<Level, Tally>
}
const NONE: Tally = { won: 0, lost: 0, best: 0, strikes: 0 }
export const DEFAULT_SHOT: Shot = { x: 0.18, angle: -0.008, speed: 7.6, hook: 0.5 }
export const EMPTY: Saved = {
  level: 'fair',
  lane: 'maple',
  left: false,
  stance: DEFAULT_SHOT,
  record: { easy: NONE, fair: NONE, hard: NONE },
}
const within = (v: unknown, lo: number, hi: number, d: number) =>
  typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? v : d
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
      won: whole(x.won),
      lost: whole(x.lost),
      best: Math.min(300, whole(x.best)),
      strikes: whole(x.strikes),
    }
  }
  const st = (typeof o.stance === 'object' && o.stance ? o.stance : {}) as Record<string, unknown>
  return {
    level: pick(LEVELS, o.level, EMPTY.level),
    lane: pick(LANES, o.lane, EMPTY.lane),
    left: typeof o.left === 'boolean' ? o.left : EMPTY.left,
    stance: {
      x: within(st.x, -0.45, 0.45, DEFAULT_SHOT.x),
      angle: within(st.angle, -0.05, 0.05, DEFAULT_SHOT.angle),
      speed: within(st.speed, 5, 10, DEFAULT_SHOT.speed),
      hook: within(st.hook, 0, 1, DEFAULT_SHOT.hook),
    },
    record,
  }
}
