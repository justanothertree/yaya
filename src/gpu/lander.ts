/**
 * Lander: bring a craft down onto a landing pad, gently and upright, with what fuel you can save.
 * Three pads to a terrain — the narrower, the more it multiplies your score — and an autopilot
 * flying the same terrain beside you as a ghost: its score is the one to beat.
 *
 * Pure, so lander.test.ts can fly a few thousand landings without a page. The world is one unit
 * wide and wraps at the sides; heights are measured up from the bottom; time is in seconds.
 */
import { rng } from './bricks'
import { whole } from './kept'

export const WORLD_H = 0.75
export const G = 0.035
export const THRUST = 0.09
export const TURN = 2.6
export const BURN = 0.085
export const STEP = 1 / 60
/** a craft's feet are this far below its middle and this far either side of it */
export const FOOT_Y = 0.013
export const FOOT_X = 0.011
/** a landing: no faster down or across than these, and no more tilted, with both feet on one pad */
export const SAFE_VY = 0.06
export const SAFE_VX = 0.035
export const SAFE_TILT = 0.22
const SEGMENTS = 64

export type Pad = { from: number; to: number; y: number; times: number }
export type World = { seed: number; heights: number[]; pads: Pad[] }
export type Craft = {
  x: number
  y: number
  vx: number
  vy: number
  /** tilt from upright, radians: positive leans right, and so thrusts to the right */
  a: number
  fuel: number
  t: number
  thrusting: boolean
  done: null | { landed: boolean; pad: number | null; score: number; why: string }
}
export type Input = { left: boolean; right: boolean; thrust: boolean }
export const IDLE: Input = { left: false, right: false, thrust: false }

/* --------------------------------------------------------------------------- the terrain */

/** pads, by how many segments wide and what they multiply: narrow pays most */
const PAD_KINDS = [
  { wide: 2, times: 5 },
  { wide: 3, times: 3 },
  { wide: 5, times: 2 },
]
/** a terrain from a seed: rolling ground with three flat pads cut into it, none touching */
export function makeWorld(seed: number): World {
  const rand = rng(seed)
  const h = new Array<number>(SEGMENTS + 1).fill(0)
  // a few octaves of smooth noise, wrapped so the two edges meet
  for (const [waves, size] of [
    [2, 0.14],
    [5, 0.07],
    [11, 0.035],
    [23, 0.015],
  ] as const) {
    const phase = rand() * Math.PI * 2
    const phase2 = rand() * Math.PI * 2
    for (let i = 0; i <= SEGMENTS; i++) {
      const u = (i / SEGMENTS) * Math.PI * 2
      h[i] += size * (Math.sin(u * waves + phase) * 0.7 + Math.sin(u * (waves + 1) + phase2) * 0.3)
    }
  }
  for (let i = 0; i <= SEGMENTS; i++) h[i] = 0.24 + h[i]
  const pads: Pad[] = []
  const used = new Uint8Array(SEGMENTS)
  for (const k of PAD_KINDS) {
    for (let tries = 0; tries < 200; tries++) {
      const at = Math.floor(rand() * SEGMENTS)
      let free = true
      for (let j = -2; j <= k.wide + 1; j++) if (used[(at + j + SEGMENTS) % SEGMENTS]) free = false
      // keep pads off the seam, so a pad is one stretch of segments
      if (!free || at + k.wide >= SEGMENTS) continue
      for (let j = -2; j <= k.wide + 1; j++) used[(at + j + SEGMENTS) % SEGMENTS] = 1
      let y = 0
      for (let j = 0; j <= k.wide; j++) y += h[at + j]
      y = Math.max(0.06, Math.min(0.42, y / (k.wide + 1)))
      for (let j = 0; j <= k.wide; j++) h[at + j] = y
      pads.push({ from: at / SEGMENTS, to: (at + k.wide) / SEGMENTS, y, times: k.times })
      break
    }
  }
  for (let i = 0; i <= SEGMENTS; i++) h[i] = Math.max(0.03, Math.min(0.5, h[i]))
  h[SEGMENTS] = h[0]
  return { seed, heights: h, pads }
}
const wrap = (x: number) => ((x % 1) + 1) % 1
/** the ground's height under a point, between the terrain's corners */
export function ground(w: World, x: number): number {
  const u = wrap(x) * SEGMENTS
  const i = Math.floor(u)
  const f = u - i
  return w.heights[i] * (1 - f) + w.heights[i + 1] * f
}
/** the pad under a point, if any */
export const padAt = (w: World, x: number) => {
  const u = wrap(x)
  return w.pads.findIndex((p) => u >= p.from && u <= p.to)
}

/* --------------------------------------------------------------------------- flying */

export function launch(w: World): Craft {
  // over the middle, drifting a little one way, as if arriving from orbit
  const r = rng(w.seed ^ 0x5eed)
  return {
    x: 0.5,
    y: 0.68,
    vx: (r() < 0.5 ? -1 : 1) * (0.02 + r() * 0.02),
    vy: 0,
    a: 0,
    fuel: 1,
    t: 0,
    thrusting: false,
    done: null,
  }
}
export const scoreFor = (fuel: number, times: number) => Math.round((50 + fuel * 100) * times)

/** one step of flight: turn, thrust, fall, and see whether the feet have met the ground */
export function step(w: World, c: Craft, input: Input): Craft {
  if (c.done) return c
  let a = c.a + ((input.right ? 1 : 0) - (input.left ? 1 : 0)) * TURN * STEP
  a = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, a))
  const thrusting = input.thrust && c.fuel > 0
  const fuel = thrusting ? Math.max(0, c.fuel - BURN * STEP) : c.fuel
  const ax = thrusting ? Math.sin(a) * THRUST : 0
  const ay = (thrusting ? Math.cos(a) * THRUST : 0) - G
  const vx = c.vx + ax * STEP
  const vy = c.vy + ay * STEP
  let x = wrap(c.x + vx * STEP)
  let y = c.y + vy * STEP
  if (y > WORLD_H) y = WORLD_H
  const next: Craft = {
    ...c,
    x,
    y,
    vx,
    vy: y >= WORLD_H ? Math.min(0, vy) : vy,
    a,
    fuel,
    t: c.t + STEP,
    thrusting,
  }
  // the feet, swung with the tilt, and the ground under each
  const feet = [-1, 1].map((s) => ({
    x: x + s * FOOT_X * Math.cos(a) + FOOT_Y * Math.sin(a),
    y: y - FOOT_Y * Math.cos(a) + s * FOOT_X * Math.sin(a),
  }))
  const touching = feet.some((f) => f.y <= ground(w, f.x)) || y - FOOT_Y * 0.4 <= ground(w, x)
  if (!touching) return next
  const pads = feet.map((f) => padAt(w, f.x))
  const pad = pads[0] === pads[1] ? pads[0] : -1
  const tooFast = -vy > SAFE_VY
  const sliding = Math.abs(vx) > SAFE_VX
  const tilted = Math.abs(a) > SAFE_TILT
  if (pad >= 0 && !tooFast && !sliding && !tilted) {
    const p = w.pads[pad]
    // settle onto the pad's surface
    y = p.y + FOOT_Y
    x = next.x
    return {
      ...next,
      x,
      y,
      vx: 0,
      vy: 0,
      a: 0,
      thrusting: false,
      done: { landed: true, pad, score: scoreFor(fuel, p.times), why: `on the ×${p.times} pad` },
    }
  }
  const why =
    pad < 0
      ? pads.some((q) => q >= 0)
        ? 'with a foot off the pad'
        : 'on rough ground'
      : tooFast
        ? 'coming down too fast'
        : sliding
          ? 'sliding sideways'
          : 'leaning over'
  return { ...next, thrusting: false, done: { landed: false, pad: null, score: 0, why } }
}

/* --------------------------------------------------------------------------- the autopilot */

export const LEVELS = ['easy', 'fair', 'hard'] as const
export type Level = (typeof LEVELS)[number]
/**
 * How each autopilot flies: which pad it aims for (by multiplier), how often it looks at its
 * instruments (in steps), how fast it is willing to come down at the end, and how much it holds
 * back for safety. Easy takes the wide ×2 pad and reacts slowly; Hard takes the narrow ×5 pad and
 * flies a tighter descent, saving fuel.
 */
const PILOTS: Record<Level, { times: number; every: number; touch: number; cruise: number }> = {
  easy: { times: 2, every: 6, touch: 0.028, cruise: 0.05 },
  fair: { times: 3, every: 3, touch: 0.035, cruise: 0.065 },
  hard: { times: 5, every: 1, touch: 0.045, cruise: 0.08 },
}
/** the signed shortest way across the wrapping world from a to b */
const across = (a: number, b: number) => {
  const d = wrap(b - a)
  return d > 0.5 ? d - 1 : d
}
/** the highest ground between two points, going the short way round */
function highest(w: World, from: number, d: number) {
  let top = 0
  const n = Math.ceil(Math.abs(d) * SEGMENTS * 2) + 1
  for (let i = 0; i <= n; i++) top = Math.max(top, ground(w, from + (d * i) / n))
  return top
}

export type Pilot = { level: Level; target: number; held: Input; wait: number }
export function pilot(w: World, level: Level): Pilot {
  const want = PILOTS[level].times
  const target = Math.max(
    0,
    w.pads.findIndex((p) => p.times === want),
  )
  return { level, target, held: IDLE, wait: 0 }
}
/**
 * The autopilot's controls for this step. It works out the velocity it wants — across towards
 * the middle of its pad, staying clear of the highest ground on the way, then straight down,
 * slowing to its touchdown speed — and the push needed to get there; it leans the craft towards
 * that push and fires the engine when the push is worth firing for.
 */
export function fly(w: World, c: Craft, p: Pilot): { input: Input; pilot: Pilot } {
  if (c.done) return { input: IDLE, pilot: p }
  if (p.wait > 0) return { input: p.held, pilot: { ...p, wait: p.wait - 1 } }
  const cfg = PILOTS[p.level]
  const pad = w.pads[p.target]
  const mid = (pad.from + pad.to) / 2
  const dx = across(c.x, mid)
  const half = (pad.to - pad.from) / 2
  const above = c.y - FOOT_Y - pad.y
  const over = Math.abs(dx) < half * 0.45
  // across: towards the pad, easing off as it gets near
  const wantVx = Math.max(-cfg.cruise, Math.min(cfg.cruise, dx * 1.2))
  let wantVy: number
  if (!over) {
    // hold height clear of everything between here and the pad
    const clear = highest(w, c.x, dx) + 0.07
    wantVy = Math.max(-0.04, Math.min(0.04, (clear - (c.y - FOOT_Y)) * 1.5))
  } else {
    wantVy = -Math.max(cfg.touch * 0.6, Math.min(0.09, above * 0.55))
    if (above < 0.03) wantVy = -cfg.touch * 0.7
  }
  const ax = (wantVx - c.vx) * 2.2
  const ay = (wantVy - c.vy) * 2.6 + G
  const tilt = Math.max(-0.7, Math.min(0.7, Math.atan2(ax, Math.max(0.01, ay))))
  // upright for the touchdown itself
  const aim = above < 0.035 && over ? 0 : tilt
  const turn = aim - c.a
  const input: Input = {
    left: turn < -0.03,
    right: turn > 0.03,
    thrust: Math.hypot(ax, Math.max(0, ay)) > THRUST * 0.45 && Math.abs(turn) < 0.6,
  }
  return { input, pilot: { ...p, held: input, wait: cfg.every - 1 } }
}
/** a whole autopilot flight, for the tests and for the score to beat */
export function autoland(w: World, level: Level, limit = 90) {
  let c = launch(w)
  let p = pilot(w, level)
  while (!c.done && c.t < limit) {
    const f = fly(w, c, p)
    p = f.pilot
    c = step(w, c, f.input)
  }
  return c
}

/* --------------------------------------------------------------------------- what is kept */

export const LANDER_KEY = 'lab_lander_v1'
export const LOOKS = ['moon', 'mars', 'ice'] as const
export const CRAFTS = ['silver', 'gold', 'teal'] as const
export type Tally = { landed: number; crashed: number; beat: number; best: number }
export type Saved = {
  level: Level
  look: (typeof LOOKS)[number]
  craft: (typeof CRAFTS)[number]
  /** show the autopilot's ghost while you fly */
  ghost: boolean
  record: Record<Level, Tally>
}
const NONE: Tally = { landed: 0, crashed: 0, beat: 0, best: 0 }
export const EMPTY: Saved = {
  level: 'fair',
  look: 'moon',
  craft: 'silver',
  ghost: true,
  record: { easy: NONE, fair: NONE, hard: NONE },
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
  const rec = (typeof o.record === 'object' && o.record ? o.record : {}) as Record<string, unknown>
  const record = {} as Record<Level, Tally>
  for (const l of LEVELS) {
    const x = (typeof rec[l] === 'object' && rec[l] ? rec[l] : {}) as Record<string, unknown>
    record[l] = {
      landed: whole(x.landed),
      crashed: whole(x.crashed),
      beat: whole(x.beat),
      best: whole(x.best),
    }
  }
  return {
    level: pick(LEVELS, o.level, EMPTY.level),
    look: pick(LOOKS, o.look, EMPTY.look),
    craft: pick(CRAFTS, o.craft, EMPTY.craft),
    ghost: typeof o.ghost === 'boolean' ? o.ghost : EMPTY.ghost,
    record,
  }
}
