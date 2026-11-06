/**
 * The arithmetic of the Lab's pond: the wave equation it steps, a drop's shape, the light's bend
 * at the surface, and a CPU copy of the step for the probe to hold the GPU to.
 *
 * The water is a height field: every cell has a height and a vertical speed, and each step a cell
 * is pulled towards the average of its four neighbours — the discrete wave equation — and loses a
 * little of its speed, so ripples spread, cross, reflect off the edges and fade.
 */

/** Hand-packed to match `struct Pond` — pond.test.ts lays the struct out from the shader. */
export const POND = {
  size: 0,
  drops: 8,
  floor: 12,
  time: 16,
  depth: 20,
  pull: 24,
  damp: 28,
  bytes: 32,
} as const

export const MAX_DROPS = 16
/** how hard a cell is pulled towards its neighbours: under 0.5 or the step blows up */
export const PULL = 0.45
/** how much of its speed a cell keeps each step: ripples fade over a few seconds */
export const DAMP = 0.993
/** the water's index of refraction, from air */
export const ETA = 1 / 1.33

/**
 * One step of the waves, on the CPU, as the shader does it: `hv` holds height and speed per cell;
 * the edge reflects (a missing neighbour counts as the cell itself). Returns the next state.
 *
 * ⚠️ NINE NEIGHBOURS, NOT FOUR. Averaging only the four beside a cell carries SHORT ripples faster
 * along the diagonals than along the grid — a small drop's leading ring reached 11.5% further on
 * the diagonal, and every ring looked a rounded square. Weighting the four edges 4 and the four
 * corners 1 (over 20) is the isotropic stencil: within 1%. pond.test.ts measures it on the
 * ring's slope, which is what the eye sees; a big drop's height is round either way, and a test
 * of that passed with the four-neighbour grid in place.
 */
export function stepWaves(
  hv: Float32Array,
  w: number,
  h: number,
  pull = PULL,
  damp = DAMP,
): Float32Array {
  const out = new Float32Array(hv.length)
  const H = (x: number, y: number, fx: number, fy: number) =>
    x < 0 || y < 0 || x >= w || y >= h ? hv[(fy * w + fx) * 2] : hv[(y * w + x) * 2]
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 2
      const edges = H(x - 1, y, x, y) + H(x + 1, y, x, y) + H(x, y - 1, x, y) + H(x, y + 1, x, y)
      const corners =
        H(x - 1, y - 1, x, y) +
        H(x + 1, y - 1, x, y) +
        H(x - 1, y + 1, x, y) +
        H(x + 1, y + 1, x, y)
      const avg = (edges * 4 + corners) / 20
      const v = Math.fround((hv[i + 1] + (avg - hv[i]) * pull) * damp)
      out[i] = Math.fround(hv[i] + v)
      out[i + 1] = v
    }
  return out
}

/** a drop pushes the surface down in a smooth dimple: depth at distance d from its middle, radius r */
export const dropShape = (d: number, r: number, strength: number) =>
  d >= r ? 0 : -strength * 0.5 * (1 + Math.cos((Math.PI * d) / r))

export type Drop = { x: number; y: number; r: number; strength: number }

export function packDrops(drops: readonly Drop[]): Float32Array<ArrayBuffer> {
  const f = new Float32Array(MAX_DROPS * 4)
  drops.slice(0, MAX_DROPS).forEach((d, i) => f.set([d.x, d.y, d.r, d.strength], i * 4))
  return f
}

/**
 * Light coming straight down, bent at a surface with normal n (pointing up, out of the water):
 * Snell's law, as WGSL's refract() does it. Returns the direction in the water.
 */
export function refractDown(n: readonly [number, number, number]): [number, number, number] {
  const I = [0, 0, -1]
  const c = -(n[0] * I[0] + n[1] * I[1] + n[2] * I[2])
  const k = 1 - ETA * ETA * (1 - c * c)
  return [0, 1, 2].map((j) => ETA * I[j] + (ETA * c - Math.sqrt(k)) * n[j]) as [
    number,
    number,
    number,
  ]
}

export const FLOORS = { tiles: 'Pool', pebbles: 'Pebbles', sand: 'Sand' } as const
export type Floor = keyof typeof FLOORS
export const FLOOR_IDS = Object.keys(FLOORS) as Floor[]

export type PondFrame = {
  w: number
  h: number
  drops: number
  floor: Floor
  time: number
  depth: number
}

export function packPond(p: PondFrame, into = new ArrayBuffer(POND.bytes)) {
  const u = new Uint32Array(into)
  const f = new Float32Array(into)
  u[0] = p.w
  u[1] = p.h
  u[POND.drops / 4] = p.drops
  u[POND.floor / 4] = FLOOR_IDS.indexOf(p.floor)
  f[POND.time / 4] = p.time
  f[POND.depth / 4] = p.depth
  f[POND.pull / 4] = PULL
  f[POND.damp / 4] = DAMP
  return into
}

/** a raindrop somewhere on the pond: where, and how big, from a seeded roll */
export function raindrop(w: number, h: number, roll: () => number): Drop {
  return { x: roll() * w, y: roll() * h, r: 1.5 + roll() * 2, strength: 0.6 + roll() * 0.8 }
}
