/**
 * The arithmetic of the Lab's reaction–diffusion, and a plain JavaScript copy of one step — kept
 * so the GPU's answer has something to be checked against that shares none of its code.
 */

/** Hand-packed to match `struct RD` — rd.test.ts lays the struct out from the shader. */
export const RD = {
  cols: 0,
  rows: 4,
  feed: 8,
  kill: 12,
  da: 16,
  db: 20,
  brushes: 24,
  map: 28,
  view: 32,
  palette: 40,
  light: 44,
  bytes: 48,
} as const

export type RDParams = {
  cols: number
  rows: number
  feed: number
  kill: number
  da: number
  db: number
  brushes: number
  map: boolean
  view: readonly [number, number]
  palette: number
  light: number
}

export function packRD(p: RDParams, into = new ArrayBuffer(RD.bytes)): ArrayBuffer {
  const f = new Float32Array(into)
  const u = new Uint32Array(into)
  u[RD.cols / 4] = p.cols
  u[RD.rows / 4] = p.rows
  f[RD.feed / 4] = p.feed
  f[RD.kill / 4] = p.kill
  f[RD.da / 4] = p.da
  f[RD.db / 4] = p.db
  u[RD.brushes / 4] = p.brushes
  u[RD.map / 4] = p.map ? 1 : 0
  f.set(p.view, RD.view / 4)
  u[RD.palette / 4] = p.palette
  f[RD.light / 4] = p.light
  return into
}

/** how fast each chemical spreads — Pearson's values, with a step of one */
export const DA = 1.0
export const DB = 0.5

/**
 * Feed and kill rates for each pattern, from Pearson's map of the Gray–Scott system. Each pair is
 * a famous one; rd.test.ts checks the ones that are supposed to grow do grow.
 */
export const PRESETS = {
  coral: { name: 'Coral', feed: 0.0545, kill: 0.062 },
  mitosis: { name: 'Mitosis', feed: 0.0367, kill: 0.0649 },
  worms: { name: 'Worms', feed: 0.078, kill: 0.061 },
  maze: { name: 'Maze', feed: 0.029, kill: 0.057 },
  spots: { name: 'Spots', feed: 0.035, kill: 0.065 },
} as const
export type Preset = keyof typeof PRESETS

/** at most this many brush dabs a frame; the storage buffer is this size */
export const MAX_BRUSHES = 16

/** One step on the CPU, by the same rule as `react` in rd-step.wgsl, wrapping at every edge. */
export function rdStep(
  grid: Float32Array,
  cols: number,
  rows: number,
  feed: number,
  kill: number,
): Float32Array {
  const next = new Float32Array(grid.length)
  const at = (x: number, y: number, k: number) =>
    grid[(((y + rows) % rows) * cols + ((x + cols) % cols)) * 2 + k]
  for (let y = 0; y < rows; y++)
    for (let x = 0; x < cols; x++) {
      const lap = (k: number) =>
        0.2 * (at(x - 1, y, k) + at(x + 1, y, k) + at(x, y - 1, k) + at(x, y + 1, k)) +
        0.05 *
          (at(x - 1, y - 1, k) + at(x + 1, y - 1, k) + at(x - 1, y + 1, k) + at(x + 1, y + 1, k)) -
        at(x, y, k)
      const a = at(x, y, 0)
      const b = at(x, y, 1)
      const abb = a * b * b
      const i = (y * cols + x) * 2
      next[i] = Math.min(1, Math.max(0, a + DA * lap(0) - abb + feed * (1 - a)))
      next[i + 1] = Math.min(1, Math.max(0, b + DB * lap(1) + abb - (feed + kill) * b))
    }
  return next
}

/** A bare grid — all A, no B — with a few seeds of B so there is something to grow from. */
export function seededGrid(
  cols: number,
  rows: number,
  seeds: readonly [number, number, number][],
): Float32Array {
  const g = new Float32Array(cols * rows * 2)
  for (let i = 0; i < cols * rows; i++) g[i * 2] = 1
  for (const [sx, sy, r] of seeds)
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < cols; x++)
        if ((x + 0.5 - sx) ** 2 + (y + 0.5 - sy) ** 2 <= r * r) {
          g[(y * cols + x) * 2] = 0.5
          g[(y * cols + x) * 2 + 1] = 0.5
        }
  return g
}

/**
 * The map's sweep, as rd-step.wgsl's `rates` draws it: feed from 0.01 at the left to 0.09 at the
 * right, kill from 0.045 at the top to 0.07 at the bottom. A tap on the map reads the rates under
 * the finger, so somebody can find a pattern and then grow it on its own.
 */
export const MAP = { feed: [0.01, 0.09], kill: [0.045, 0.07] } as const
export function ratesAt(u: number, v: number) {
  const lerp = ([a, b]: readonly [number, number], t: number) =>
    a + (b - a) * Math.min(1, Math.max(0, t))
  return { feed: lerp(MAP.feed, u), kill: lerp(MAP.kill, v) }
}
