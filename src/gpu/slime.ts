/**
 * The arithmetic of the Lab's slime mould, after Jeff Jones's physarum model (2010): agents that
 * smell the trail ahead, turn towards the strongest, step, and leave a little trail of their own.
 * Nobody draws the network that appears; it is what that loop settles into, and food pulls it into
 * the shortest ways between them — the reason a real slime mould can solve a maze.
 *
 * ⚠️ THE TRAIL IS WRITTEN WITH ATOMICS. Hundreds of thousands of agents land on a much smaller
 * grid, so many land on one cell in the same step; a plain read-add-write loses all but one of
 * them. Every agent adds 1 to its cell with atomicAdd, so a step's deposits always total exactly
 * the number of agents — which the probe checks, and which a plain write would fail.
 */

/** Hand-packed to match `struct Slime` — slime.test.ts lays the struct out from the shader. */
export const SLIME = {
  size: 0,
  agents: 8,
  step: 12,
  senseAngle: 16,
  senseDist: 20,
  turn: 24,
  speed: 28,
  decay: 32,
  deposit: 36,
  palette: 40,
  dabs: 44,
  time: 48,
  diffuse: 52,
  bytes: 56,
} as const

export const NOTHING = 0
export const FOOD = 1
export const WALL = 2
/** a dab of spores: not painted into the grid, but agents near it are thrown out of it */
export const SPORES = 3
export const MAX_DABS = 16
/** how strongly food smells, against the trail: enough that a network forms between food */
export const FOOD_SMELL = 4
/**
 * ⚠️ FOOD FEEDS THE TRAIL, as it does in Jones's model, and is not only smelled where it lies.
 * Smelled only on the spot, it pulled nothing from further than an agent's nose: the network
 * formed beautifully and passed the towns by. Feeding the trail, its scent spreads outward like
 * any other, so the mould finds it from afar and the network runs through it.
 */
export const FOOD_SOURCE = 40

/** the turning rule, as Jones wrote it: straight on, swing randomly, or towards the stronger side */
export function turnFor(
  front: number,
  left: number,
  right: number,
  roll: number,
  turn: number,
): number {
  if (front > left && front > right) return 0
  if (front < left && front < right) return roll < 0.5 ? -turn : turn
  if (left > right) return turn
  if (right > left) return -turn
  return 0
}

/** the three ways the mould can be tuned: each is a classic set of Jones's parameters */
export const HABITS = {
  veins: {
    name: 'Veins',
    senseAngle: 0.4,
    senseDist: 9,
    turn: 0.3,
    speed: 1,
    decay: 0.05,
    deposit: 5,
    diffuse: 0.35,
  },
  web: {
    name: 'Web',
    senseAngle: 0.6,
    senseDist: 18,
    turn: 0.45,
    speed: 1.4,
    decay: 0.1,
    deposit: 5,
    diffuse: 0.25,
  },
  coral: {
    name: 'Coral',
    senseAngle: 1.1,
    senseDist: 4,
    turn: 0.9,
    speed: 0.8,
    decay: 0.15,
    deposit: 6,
    diffuse: 0.5,
  },
} as const
export type Habit = keyof typeof HABITS
export const HABIT_IDS = Object.keys(HABITS) as Habit[]

export const PALETTES = { gold: 'Gold', neon: 'Neon', moss: 'Moss' } as const
export type SlimePalette = keyof typeof PALETTES
export const PALETTE_IDS = Object.keys(PALETTES) as SlimePalette[]

/**
 * Agents to start with: scattered anywhere, facing anywhere. x, y, heading, spare.
 *
 * ⚠️ NOT A RING FACING INWARD, the usual opening, and it was the first one tried: on a grid this
 * size every agent arrived at the middle together and the whole mould became one bright blob that
 * never broke out — no network at all, under every habit. Scattered, the network forms where it
 * will, and food then pulls it into place.
 */
export function seedAgents(
  n: number,
  w: number,
  h: number,
  rand: () => number,
): Float32Array<ArrayBuffer> {
  const out = new Float32Array(n * 4)
  for (let i = 0; i < n; i++) out.set([rand() * w, rand() * h, rand() * Math.PI * 2, 0], i * 4)
  return out
}

/**
 * The trail's step, on the CPU as the shader does it: each cell moves `diffuse` of the way to the
 * mean of its 3×3 (walls and the edge count as empty), loses `decay` of itself, and gains what
 * was deposited.
 *
 * ⚠️ `diffuse` IS WHAT MAKES VEINS RATHER THAN TUBES. With every cell replaced by the full mean
 * each step, the trail blurred faster than agents could sharpen it, and the network settled into
 * a few thick, smooth loops; only part of the way, it keeps fine branches.
 */
export function stepTrail(
  trail: Float32Array,
  deposits: Uint32Array,
  kinds: Uint32Array,
  w: number,
  h: number,
  decay: number,
  deposit: number,
  diffuse: number,
): Float32Array {
  const out = new Float32Array(trail.length)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (kinds[i] === WALL) continue
      let s = 0
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue
          s += trail[ny * w + nx]
        }
      const spread = trail[i] + (s / 9 - trail[i]) * diffuse
      out[i] = Math.fround(
        spread * (1 - decay) + deposits[i] * deposit + (kinds[i] === FOOD ? FOOD_SOURCE : 0),
      )
    }
  return out
}

export type Dab = { x: number; y: number; r: number; kind: number }

export function packDabs(dabs: readonly Dab[]): Float32Array<ArrayBuffer> {
  const f = new Float32Array(MAX_DABS * 4)
  dabs.slice(0, MAX_DABS).forEach((d, i) => f.set([d.x, d.y, d.r, d.kind], i * 4))
  return f
}

/** places to start from: food laid out on a w×h grid */
export function foodFor(id: Layout, w: number, h: number): Uint32Array<ArrayBuffer> {
  const k = new Uint32Array(w * h)
  const dot = (cx: number, cy: number, r: number, kind = FOOD) => {
    for (let y = Math.floor(cy - r); y <= cy + r; y++)
      for (let x = Math.floor(cx - r); x <= cx + r; x++)
        if (x >= 0 && y >= 0 && x < w && y < h && Math.hypot(x - cx, y - cy) <= r)
          k[y * w + x] = kind
  }
  const s = Math.min(w, h)
  if (id === 'cities') {
    // a scatter of towns, the way a map of them looks: the mould joins them up
    const towns = [
      [0.15, 0.25],
      [0.32, 0.7],
      [0.5, 0.35],
      [0.68, 0.75],
      [0.85, 0.3],
      [0.55, 0.88],
      [0.25, 0.45],
      [0.78, 0.55],
    ]
    for (const [x, y] of towns) dot(x * w, y * h, s * 0.025)
  } else if (id === 'maze') {
    // food at two corners and walls between: the mould finds its way through
    dot(w * 0.08, h * 0.15, s * 0.04)
    dot(w * 0.92, h * 0.85, s * 0.04)
    const bars = 5
    for (let b = 1; b <= bars; b++) {
      const x = Math.round((w * b) / (bars + 1))
      const gapTop = b % 2 === 1
      for (let y = 0; y < h; y++) {
        const inGap = gapTop ? y < h * 0.18 : y > h * 0.82
        if (!inGap)
          for (let t = -1; t <= 1; t++) if (x + t >= 0 && x + t < w) k[y * w + x + t] = WALL
      }
    }
  }
  return k
}
export const LAYOUTS = { cities: 'Cities', maze: 'Maze', wild: 'Wild' } as const
export type Layout = keyof typeof LAYOUTS

export type SlimeFrame = {
  w: number
  h: number
  agents: number
  step: number
  habit: Habit
  palette: SlimePalette
  dabs: number
  time: number
}

export function packSlime(p: SlimeFrame, into = new ArrayBuffer(SLIME.bytes)) {
  const u = new Uint32Array(into)
  const f = new Float32Array(into)
  const hb = HABITS[p.habit]
  u[0] = p.w
  u[1] = p.h
  u[SLIME.agents / 4] = p.agents
  u[SLIME.step / 4] = p.step
  f[SLIME.senseAngle / 4] = hb.senseAngle
  f[SLIME.senseDist / 4] = hb.senseDist
  f[SLIME.turn / 4] = hb.turn
  f[SLIME.speed / 4] = hb.speed
  f[SLIME.decay / 4] = hb.decay
  f[SLIME.deposit / 4] = hb.deposit
  u[SLIME.palette / 4] = PALETTE_IDS.indexOf(p.palette)
  u[SLIME.dabs / 4] = p.dabs
  f[SLIME.time / 4] = p.time
  f[SLIME.diffuse / 4] = hb.diffuse
  return into
}
