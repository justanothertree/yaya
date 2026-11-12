/**
 * Artillery: two guns on rolling hills, taking turns. Set the barrel's angle and the charge, fire,
 * and watch the shell arc over — gravity pulls it down and the wind, which changes every turn,
 * pushes it sideways. Where it lands it digs a crater, and a gun whose ground is dug away drops
 * into the hole. Three good hits win.
 *
 * Pure, so artillery.test.ts can fire a few hundred thousand shells without a page. The field is
 * 1.6 wide and heights are measured up from the bottom; time in seconds.
 */
import { rng } from './bricks'

export const FIELD_W = 1.6
export const COLS = 320
export const DX = FIELD_W / COLS
export const G = 1
export const MAX_SPEED = 1.75
export const CRATER = 0.06
/** how close a shell's burst must be to hurt, and a gun's own size */
export const BLAST = 0.11
export const GUN_R = 0.022
export const LIFE = 100
const STEP = 1 / 240

export type Who = 0 | 1
export type Gun = { x: number; life: number }
export type Field = {
  ground: number[]
  guns: [Gun, Gun]
  /** sideways push on a shell, field widths a second squared; positive blows right */
  wind: number
  turn: Who
  winner: Who | null
  seed: number
}

/** rolling hills from a seed, with a little flat ground where each gun stands */
export function newField(seed: number, first: Who = 0): Field {
  const r = rng(seed)
  const ground = new Array<number>(COLS + 1).fill(0)
  for (const [waves, size] of [
    [1, 0.12],
    [2.5, 0.09],
    [5, 0.045],
    [11, 0.015],
  ] as const) {
    const ph = r() * Math.PI * 2
    for (let i = 0; i <= COLS; i++)
      ground[i] += size * Math.sin((i / COLS) * Math.PI * 2 * waves + ph)
  }
  for (let i = 0; i <= COLS; i++) ground[i] = Math.max(0.06, Math.min(0.62, 0.3 + ground[i]))
  const guns: [Gun, Gun] = [
    { x: 0.14 + r() * 0.12, life: LIFE },
    { x: FIELD_W - 0.14 - r() * 0.12, life: LIFE },
  ]
  // a little level ground under each gun
  for (const g of guns) {
    const c = Math.round(g.x / DX)
    const h = ground[c]
    for (let i = c - 4; i <= c + 4; i++) if (i >= 0 && i <= COLS) ground[i] = h
  }
  return {
    ground,
    guns,
    wind: windFrom(r),
    turn: first,
    winner: null,
    seed: Math.floor(r() * 2 ** 31),
  }
}
const windFrom = (r: () => number) => Math.round((r() * 2 - 1) * 0.35 * 100) / 100

/** the ground's height at a point, between columns */
export function groundAt(f: Field, x: number): number {
  if (x <= 0) return f.ground[0]
  if (x >= FIELD_W) return f.ground[COLS]
  const u = x / DX
  const i = Math.floor(u)
  const t = u - i
  return f.ground[i] * (1 - t) + f.ground[Math.min(COLS, i + 1)] * t
}
/** where a gun's barrel is: on the ground at its spot */
export const gunAt = (f: Field, w: Who) => ({ x: f.guns[w].x, y: groundAt(f, f.guns[w].x) + GUN_R })

export type Flight = {
  /** where it burst, or null when it flew off the side of the field */
  burst: { x: number; y: number } | null
  /** which gun it struck square, if either */
  struck: Who | null
  path: number[]
}
/**
 * Fire from a gun: an angle in degrees above the horizontal, measured towards the other gun (so a
 * left gun firing at 45 sends the shell up and to the right), and a charge from 0 to 1.
 */
export function fly(f: Field, from: Who, angle: number, charge: number, keep = false): Flight {
  const start = gunAt(f, from)
  const dir = from === 0 ? 1 : -1
  const a = (angle * Math.PI) / 180
  const speed = Math.max(0, Math.min(1, charge)) * MAX_SPEED
  let x = start.x + dir * Math.cos(a) * GUN_R * 1.5
  let y = start.y + Math.sin(a) * GUN_R * 1.5
  let vx = dir * Math.cos(a) * speed
  let vy = Math.sin(a) * speed
  const path: number[] = keep ? [x, y] : []
  for (let i = 0; i < 20 / STEP; i++) {
    vx += f.wind * STEP
    vy -= G * STEP
    x += vx * STEP
    y += vy * STEP
    if (keep && i % 4 === 0) path.push(x, y)
    if (x < -0.05 || x > FIELD_W + 0.05) return { burst: null, struck: null, path }
    for (const w of [0, 1] as Who[]) {
      const g = gunAt(f, w)
      if (Math.hypot(x - g.x, y - g.y) < GUN_R * 1.2 && (w !== from || i > 20)) {
        if (keep) path.push(x, y)
        return { burst: { x, y }, struck: w, path }
      }
    }
    if (y <= groundAt(f, x)) {
      if (keep) path.push(x, y)
      return { burst: { x, y: groundAt(f, x) }, struck: null, path }
    }
  }
  return { burst: null, struck: null, path }
}

/** what a burst does to a gun: full on a square hit, falling off to nothing at the blast's edge */
export function harm(f: Field, burst: { x: number; y: number }, w: Who, struck: boolean): number {
  if (struck) return 45
  const g = gunAt(f, w)
  const d = Math.hypot(burst.x - g.x, burst.y - g.y)
  return d >= BLAST ? 0 : Math.round(38 * (1 - d / BLAST))
}

/** fire, and settle everything: the crater, the harm, the guns dropping, the wind, the turn */
export function shoot(
  f: Field,
  angle: number,
  charge: number,
): { field: Field; flight: Flight; hurt: [number, number] } {
  if (f.winner !== null)
    return { field: f, flight: { burst: null, struck: null, path: [] }, hurt: [0, 0] }
  const flight = fly(f, f.turn, angle, charge, true)
  const hurt: [number, number] = [0, 0]
  let ground = f.ground
  if (flight.burst) {
    const b = flight.burst
    for (const w of [0, 1] as Who[]) hurt[w] = harm(f, b, w, flight.struck === w)
    // the crater: a bowl scooped out of the ground under the burst
    ground = f.ground.map((h, i) => {
      const dx = i * DX - b.x
      if (Math.abs(dx) >= CRATER) return h
      const bottom = b.y - Math.sqrt(CRATER * CRATER - dx * dx)
      return Math.max(0.02, Math.min(h, bottom))
    })
  }
  const guns = f.guns.map((g, w) => ({
    ...g,
    life: Math.max(0, g.life - hurt[w]),
  })) as Field['guns']
  const dead = guns.findIndex((g) => g.life <= 0)
  const winner: Who | null =
    dead < 0 ? null : guns[0].life <= 0 && guns[1].life <= 0 ? f.turn : dead === 0 ? 1 : 0
  const r = rng(f.seed)
  // the wind drifts from turn to turn rather than jumping about
  const wind = Math.max(
    -0.35,
    Math.min(0.35, Math.round((f.wind + (r() * 2 - 1) * 0.12) * 100) / 100),
  )
  return {
    field: {
      ...f,
      ground,
      guns,
      wind,
      turn: f.turn === 0 ? 1 : 0,
      winner,
      seed: Math.floor(r() * 2 ** 31),
    },
    flight,
    hurt,
  }
}

/* --------------------------------------------------------------------------- the computer */

export const LEVELS = ['easy', 'fair', 'hard'] as const
export type Level = (typeof LEVELS)[number]
/**
 * Each gunner's hand: how far its angle and charge stray from what it means. Every level works
 * out the shot that lands on you exactly — the wind is on the screen for everyone — so the levels
 * differ only in the hand, and in whether it learns from a miss.
 */
export const HANDS: Record<Level, { angle: number; charge: number }> = {
  easy: { angle: 5, charge: 0.06 },
  fair: { angle: 2.2, charge: 0.028 },
  hard: { angle: 0.9, charge: 0.012 },
}
/** the shot that lands closest to the other gun: a sweep of angles and charges, then a closer look */
export function aim(f: Field, from: Who): { angle: number; charge: number } {
  const target = gunAt(f, from === 0 ? 1 : 0)
  let best = { angle: 45, charge: 0.7 }
  let bd = Infinity
  const tryOne = (angle: number, charge: number) => {
    const fl = fly(f, from, angle, charge)
    if (!fl.burst) return
    const d =
      fl.struck === (from === 0 ? 1 : 0)
        ? 0
        : Math.hypot(fl.burst.x - target.x, fl.burst.y - target.y)
    if (d < bd) {
      bd = d
      best = { angle, charge }
    }
  }
  for (let a = 20; a <= 80; a += 3) for (let c = 0.3; c <= 1.0001; c += 0.04) tryOne(a, c)
  // and a closer look round the best: measured, it takes square hits from 77 fields in 80 to 79
  const { angle, charge } = best
  for (let da = -3; da <= 3; da += 0.75)
    for (let dc = -0.04; dc <= 0.0401; dc += 0.008) tryOne(angle + da, charge + dc)
  return best
}
const normal = (rand: () => number) => (rand() + rand() + rand() + rand() - 2) / 0.577
/** the computer's shot: its aim, with its own hand's stray */
export function gunner(f: Field, level: Level, rand: () => number = Math.random) {
  const a = aim(f, f.turn)
  const h = HANDS[level]
  return {
    angle: Math.max(5, Math.min(85, a.angle + normal(rand) * h.angle)),
    charge: Math.max(0.1, Math.min(1, a.charge + normal(rand) * h.charge)),
  }
}
/** a whole duel between levels, for the tests: the winner, and shots fired */
export function duel(a: Level, b: Level, seed: number) {
  const rand = rng(seed ^ 0x5bd1e995)
  let f = newField(seed, (seed & 1) as Who)
  const lv: [Level, Level] = [a, b]
  let shots = 0
  while (f.winner === null && shots < 120) {
    const s = gunner(f, lv[f.turn], rand)
    f = shoot(f, s.angle, s.charge).field
    shots++
  }
  return { winner: f.winner, shots }
}

/* --------------------------------------------------------------------------- what is kept */

export const ARTILLERY_KEY = 'lab_artillery_v1'
export const SKIES = ['dusk', 'day', 'night'] as const
export type Tally = { won: number; lost: number; fewest: number }
export type Saved = {
  level: Level
  sky: (typeof SKIES)[number]
  /** show your last shell's path while you aim the next */
  trail: boolean
  record: Record<Level, Tally>
}
const NONE: Tally = { won: 0, lost: 0, fewest: 0 }
export const EMPTY: Saved = {
  level: 'fair',
  sky: 'dusk',
  trail: true,
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
    record[l] = { won: whole(x.won), lost: whole(x.lost), fewest: whole(x.fewest) }
  }
  return {
    level: pick(LEVELS, o.level, EMPTY.level),
    sky: pick(SKIES, o.sky, EMPTY.sky),
    trail: typeof o.trail === 'boolean' ? o.trail : EMPTY.trail,
    record,
  }
}
