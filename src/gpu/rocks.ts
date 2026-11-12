/**
 * Rocks: a ship in a field of drifting rocks, everything wrapping round from one edge to the other.
 * Turn, thrust and fire; a big rock hit splits into two middling ones, a middling one into two small
 * ones, and a small one is gone. Clear the field and a bigger wave comes in. A rock that touches the
 * ship costs a life; a new ship waits for the middle to clear and is safe for a moment. A score to
 * beat, and an extra ship every ten thousand.
 *
 * Pure, so rocks.test.ts can fly thousands of frames without a page. Lengths are in field units:
 * the field is 16 across and 12 down; times in seconds.
 */

import { rngStep as roll } from './bricks'
import { whole } from './kept'

export const W = 16
export const H = 12
export const SHIP_R = 0.35
export const ROCK_R: Record<Size, number> = { 3: 1.1, 2: 0.62, 1: 0.32 }
export const POINTS: Record<Size, number> = { 3: 20, 2: 50, 1: 100 }
/** turning, in radians a second; thrust, in units a second a second; drag, the share of speed lost a second */
export const TURN = 4.2
export const THRUST = 9
export const DRAG = 0.55
export const MAX_SPEED = 9
export const BULLET_SPEED = 13
export const BULLET_LIFE = 0.85
export const MAX_BULLETS = 5
export const FIRE_GAP = 0.16
/** after losing a ship: how long before a new one, and how long it is safe once it comes */
export const RESPAWN = 1.4
export const SAFE = 2.5
export const EXTRA_LIFE = 10_000
export const PACES = ['calm', 'normal', 'wild'] as const
export type Pace = (typeof PACES)[number]
export const PACE_SPEED: Record<Pace, number> = { calm: 0.7, normal: 1, wild: 1.4 }

export type Size = 1 | 2 | 3
export type Rock = {
  x: number
  y: number
  vx: number
  vy: number
  size: Size
  spin: number
  turn: number
  shape: number
}
export type Bullet = { x: number; y: number; vx: number; vy: number; life: number }
export type Ship = { x: number; y: number; vx: number; vy: number; a: number; safe: number }
export type World = {
  /** null between losing a ship and the next one coming */
  ship: Ship | null
  rocks: Rock[]
  bullets: Bullet[]
  score: number
  lives: number
  wave: number
  pace: Pace
  /** seconds until a new ship may come, while there is none */
  wait: number
  /** seconds until the gun may fire again */
  cool: number
  over: boolean
  luck: number
}
export type Input = { left: boolean; right: boolean; thrust: boolean; fire: boolean }
export const NO_INPUT: Input = { left: false, right: false, thrust: false, fire: false }
/** what happened in a step, for drawing and sound */
export type Happened = {
  broke: { x: number; y: number; size: Size }[]
  lost: boolean
  fired: boolean
  extra: boolean
  wave: boolean
}

/* --------------------------------------------------------------------------- the field */

/** into [0, size): off one edge and back on at the other */
export const wrap = (v: number, size: number) => ((v % size) + size) % size
/** the shortest way between two points on a field that wraps */
export function gap(ax: number, ay: number, bx: number, by: number): number {
  let dx = Math.abs(ax - bx)
  let dy = Math.abs(ay - by)
  dx = Math.min(dx, W - dx)
  dy = Math.min(dy, H - dy)
  return Math.hypot(dx, dy)
}
/** a random number from the world's own generator, so a game is the same from the same seed */
function luck(w: World): number {
  const [s, v] = roll(w.luck)
  w.luck = s
  return v
}
/** how many big rocks a wave starts with */
export const waveRocks = (wave: number) => Math.min(10, 3 + wave)

function addWave(w: World) {
  const ship = w.ship ?? { x: W / 2, y: H / 2 }
  for (let k = 0; k < waveRocks(w.wave); k++) {
    // round the edges, never near the ship
    let x = 0
    let y = 0
    for (let t = 0; t < 20; t++) {
      x = luck(w) * W
      y = luck(w) * H
      if (gap(x, y, ship.x, ship.y) > 4.5) break
    }
    const a = luck(w) * Math.PI * 2
    const v = (0.9 + luck(w) * 0.9 + w.wave * 0.08) * PACE_SPEED[w.pace]
    w.rocks.push({
      x,
      y,
      vx: Math.cos(a) * v,
      vy: Math.sin(a) * v,
      size: 3,
      spin: luck(w) * Math.PI * 2,
      turn: (luck(w) - 0.5) * 1.5,
      shape: Math.floor(luck(w) * 1e6),
    })
  }
}
export const newShip = (): Ship => ({
  x: W / 2,
  y: H / 2,
  vx: 0,
  vy: 0,
  a: -Math.PI / 2,
  safe: SAFE,
})
export function newWorld(pace: Pace, seed: number): World {
  const w: World = {
    ship: newShip(),
    rocks: [],
    bullets: [],
    score: 0,
    lives: 3,
    wave: 1,
    pace,
    wait: 0,
    cool: 0,
    over: false,
    luck: seed >>> 0 || 1,
  }
  for (let i = 0; i < 6; i++) luck(w)
  addWave(w)
  return w
}

/* --------------------------------------------------------------------------- a step */

/** a copy of a world to change, so a step never touches the one it was given */
const copy = (w: World): World => ({
  ...w,
  ship: w.ship && { ...w.ship },
  rocks: w.rocks.map((r) => ({ ...r })),
  bullets: w.bullets.map((b) => ({ ...b })),
})

/** the most a bullet may move in one piece of a step: less than a small rock is across */
const PIECE = 0.2

/**
 * The world `dt` seconds on. `fire` is taken as "fire if the gun is ready", so a tap shorter than a
 * frame still fires once: the page keeps a press until a step has used it.
 *
 * A frame is cut into pieces short enough that no bullet moves more than PIECE in one, because a
 * bullet with the ship's speed behind it covers more than a small rock's width in a frame and would
 * otherwise pass clean through one between two looks.
 */
export function step(w0: World, input: Input, dt: number): { world: World; happened: Happened } {
  const happened: Happened = { broke: [], lost: false, fired: false, extra: false, wave: false }
  if (w0.over) return { world: w0, happened }
  const w = copy(w0)
  const pieces = Math.max(1, Math.ceil((dt * (BULLET_SPEED + MAX_SPEED)) / PIECE))
  for (let k = 0; k < pieces && !w.over; k++) once(w, input, dt / pieces, happened)
  return { world: w, happened }
}
function once(w: World, input: Input, dt: number, happened: Happened) {
  w.cool = Math.max(0, w.cool - dt)

  // the ship
  const s = w.ship
  if (s) {
    s.a += ((input.right ? 1 : 0) - (input.left ? 1 : 0)) * TURN * dt
    if (input.thrust) {
      s.vx += Math.cos(s.a) * THRUST * dt
      s.vy += Math.sin(s.a) * THRUST * dt
    }
    const drag = Math.exp(-DRAG * dt)
    s.vx *= drag
    s.vy *= drag
    const v = Math.hypot(s.vx, s.vy)
    if (v > MAX_SPEED) {
      s.vx *= MAX_SPEED / v
      s.vy *= MAX_SPEED / v
    }
    s.x = wrap(s.x + s.vx * dt, W)
    s.y = wrap(s.y + s.vy * dt, H)
    s.safe = Math.max(0, s.safe - dt)
    if (input.fire && w.cool === 0 && w.bullets.length < MAX_BULLETS) {
      w.bullets.push({
        x: wrap(s.x + Math.cos(s.a) * SHIP_R * 1.4, W),
        y: wrap(s.y + Math.sin(s.a) * SHIP_R * 1.4, H),
        vx: s.vx + Math.cos(s.a) * BULLET_SPEED,
        vy: s.vy + Math.sin(s.a) * BULLET_SPEED,
        life: BULLET_LIFE,
      })
      w.cool = FIRE_GAP
      happened.fired = true
    }
  } else if (w.lives > 0) {
    // a new ship once the wait is over and the middle is clear
    w.wait = Math.max(0, w.wait - dt)
    if (w.wait === 0 && w.rocks.every((r) => gap(r.x, r.y, W / 2, H / 2) > ROCK_R[r.size] + 2.5))
      w.ship = newShip()
  }

  // everything else moves
  for (const b of w.bullets) {
    b.x = wrap(b.x + b.vx * dt, W)
    b.y = wrap(b.y + b.vy * dt, H)
    b.life -= dt
  }
  w.bullets = w.bullets.filter((b) => b.life > 0)
  for (const r of w.rocks) {
    r.x = wrap(r.x + r.vx * dt, W)
    r.y = wrap(r.y + r.vy * dt, H)
    r.spin += r.turn * dt
  }

  // bullets against rocks
  const before = w.score
  const kept: Rock[] = []
  for (const r of w.rocks) {
    const hit = w.bullets.findIndex((b) => gap(b.x, b.y, r.x, r.y) < ROCK_R[r.size])
    if (hit < 0) {
      kept.push(r)
      continue
    }
    w.bullets.splice(hit, 1)
    w.score += POINTS[r.size]
    happened.broke.push({ x: r.x, y: r.y, size: r.size })
    if (r.size > 1) {
      // two smaller, flying off either side of the way the big one was going, a little faster
      const size = (r.size - 1) as Size
      const a = Math.atan2(r.vy, r.vx)
      const v = Math.hypot(r.vx, r.vy) * 1.3 + 0.3 * PACE_SPEED[w.pace]
      for (const side of [-1, 1]) {
        const d = a + side * (0.5 + luck(w) * 0.5)
        kept.push({
          x: r.x,
          y: r.y,
          vx: Math.cos(d) * v,
          vy: Math.sin(d) * v,
          size,
          spin: r.spin,
          turn: r.turn * 1.5,
          shape: Math.floor(luck(w) * 1e6),
        })
      }
    }
  }
  w.rocks = kept
  if (Math.floor(w.score / EXTRA_LIFE) > Math.floor(before / EXTRA_LIFE)) {
    w.lives++
    happened.extra = true
  }

  // rocks against the ship
  if (w.ship && w.ship.safe === 0) {
    const sh = w.ship
    const hit = w.rocks.find((r) => gap(r.x, r.y, sh.x, sh.y) < ROCK_R[r.size] + SHIP_R * 0.8)
    if (hit) {
      w.ship = null
      w.lives--
      w.wait = RESPAWN
      happened.lost = true
      if (w.lives === 0) w.over = true
    }
  }

  // the field clear: the next wave
  if (!w.rocks.length && !w.over) {
    w.wave++
    w.bullets = []
    addWave(w)
    happened.wave = true
  }
}

/* --------------------------------------------------------------------------- what is kept */

export const ROCKS_KEY = 'lab_rocks_v1'
export const LOOKS = ['vector', 'neon', 'paper'] as const
export type Saved = {
  pace: Pace
  look: (typeof LOOKS)[number]
  /** the best score for each pace */
  best: Record<Pace, number>
  games: number
}
export const EMPTY: Saved = {
  pace: 'normal',
  look: 'vector',
  best: { calm: 0, normal: 0, wild: 0 },
  games: 0,
}
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
  const b = (typeof o.best === 'object' && o.best ? o.best : {}) as Record<string, unknown>
  return {
    pace: pick(PACES, o.pace, EMPTY.pace),
    look: pick(LOOKS, o.look, EMPTY.look),
    best: { calm: whole(b.calm, 1e9), normal: whole(b.normal, 1e9), wild: whole(b.wild, 1e9) },
    games: whole(o.games, 1e9),
  }
}
