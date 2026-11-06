/**
 * The arithmetic of the Lab's aquarium: the uniform, a fresh tank of fish, and the food — which
 * lives on the CPU, because there are only ever a few pellets and they only sink and fade.
 *
 * World: x across ±aspect, y from -1 at the TOP to 1 at the bottom, as tank-types.wgsl says.
 */

/** Hand-packed to match `struct Tank` — tank.test.ts lays the struct out from the shader. */
export const TANK = {
  aspect: 0,
  dt: 4,
  time: 8,
  count: 12,
  shark: 16,
  hunting: 24,
  food: 28,
  size: 32,
  bytes: 40,
} as const

export type TankParams = {
  aspect: number
  dt: number
  time: number
  count: number
  shark: readonly [number, number]
  hunting: boolean
  food: number
  size: number
}

export function packTank(p: TankParams, into = new ArrayBuffer(TANK.bytes)): ArrayBuffer {
  const f = new Float32Array(into)
  const u = new Uint32Array(into)
  f[TANK.aspect / 4] = p.aspect
  f[TANK.dt / 4] = p.dt
  f[TANK.time / 4] = p.time
  u[TANK.count / 4] = p.count
  f.set(p.shark, TANK.shark / 4)
  f[TANK.hunting / 4] = p.hunting ? 1 : 0
  u[TANK.food / 4] = p.food
  f[TANK.size / 4] = p.size
  return into
}

/** schools on offer; a touch-only device stops at the middle one */
export const FISH_COUNTS = [512, 1536, 4096] as const
export const FISH_TOUCH_CEILING = 1536

/** A point on the canvas in tank units: x across ±aspect, y from -1 at the top to 1. */
export function toTank(px: number, py: number, w: number, h: number): readonly [number, number] {
  const aspect = w / h
  return [((px / w) * 2 - 1) * aspect, (py / h) * 2 - 1]
}

/** A fresh tank: fish anywhere, each already swimming a random way at a cruising speed. */
export function seedFish(count: number, aspect: number, rand = Math.random): Float32Array {
  const f = new Float32Array(count * 4)
  for (let i = 0; i < count; i++) {
    const a = rand() * Math.PI * 2
    const s = 0.25 + rand() * 0.15
    f.set(
      [(rand() * 2 - 1) * aspect * 0.85, (rand() * 2 - 1) * 0.85, Math.cos(a) * s, Math.sin(a) * s],
      i * 4,
    )
  }
  return f
}

export type Pellet = { x: number; y: number; left: number }
/** pellets in the water at once; the shader's storage buffer is this size */
export const MAX_PELLETS = 8
/** how long a pellet lasts, in seconds, and how fast it sinks */
export const PELLET_LIFE = 7
const SINK = 0.06

/** Pellets sink a little and are eaten away; one that is gone, or has reached the floor, goes. */
export function stepPellets(pellets: Pellet[], dt: number): Pellet[] {
  return pellets
    .map((p) => ({ x: p.x, y: Math.min(0.95, p.y + SINK * dt), left: p.left - dt / PELLET_LIFE }))
    .filter((p) => p.left > 0)
}

export function packPellets(pellets: readonly Pellet[], into = new Float32Array(MAX_PELLETS * 4)) {
  into.fill(0)
  pellets.slice(0, MAX_PELLETS).forEach((p, i) => into.set([p.x, p.y, p.left, 0], i * 4))
  return into
}

/**
 * How well a school agrees on which way to swim: the length of its fish's average heading, from
 * 0 (every fish its own way) to 1 (all one way). The number a flock is for — tank.test.ts and the
 * Lab's GPU probe both ask it.
 */
export function order(fish: Float32Array, pick: (i: number) => boolean = () => true): number {
  let x = 0
  let y = 0
  let n = 0
  for (let i = 0; i < fish.length / 4; i++) {
    if (!pick(i)) continue
    const vx = fish[i * 4 + 2]
    const vy = fish[i * 4 + 3]
    const s = Math.hypot(vx, vy) || 1
    x += vx / s
    y += vy / s
    n++
  }
  return n ? Math.hypot(x, y) / n : 0
}
