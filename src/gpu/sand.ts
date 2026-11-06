/**
 * The arithmetic of the Lab's sandbox: cells, the block rule, gravity's four directions, and a
 * CPU copy of the whole step, which the GPU must match cell for cell.
 *
 * ⚠️ A MARGOLUS NEIGHBOURHOOD, which is the whole trick. Each step the grid is cut into 2×2
 * blocks — on alternate steps shifted one cell down and across — and each block is rearranged by
 * one thread, which reads its four cells and writes the same four. No two threads ever touch one
 * cell, so there is nothing to race; and since a block's cells are only ever SWAPPED, a grain
 * can never be lost or doubled. The usual way of writing falling sand ("each grain looks below
 * itself and moves") is a race on a GPU: two grains see the same empty cell and both move in.
 *
 * Cells: the low two bits are what it is — empty, sand, water, wall — and the rest a shade, so
 * each grain keeps its own colour wherever it goes.
 */

/** Hand-packed to match `struct Sand` — sand.test.ts lays the struct out from the shader. */
export const SAND = {
  size: 0,
  step: 8,
  gravity: 12,
  dabs: 16,
  time: 20,
  bytes: 24,
} as const

export const EMPTY = 0
export const GRAIN = 1
export const WATER = 2
export const WALL = 3
export const kind = (c: number) => c & 3
export const MAX_DABS = 16

/** u32 hash (PCG-ish), mirrored in sand.wgsl: the same block on the same step rolls the same dice */
export function hash(x: number, y: number, step: number): number {
  let h =
    (Math.imul(x >>> 0, 1597334677) ^
      Math.imul(y >>> 0, 3812015801) ^
      Math.imul(step >>> 0, 2798796415)) >>>
    0
  h = Math.imul(h ^ (h >>> 16), 2246822519) >>> 0
  h = Math.imul(h ^ (h >>> 13), 3266489917) >>> 0
  return (h ^ (h >>> 16)) >>> 0
}

const movable = (c: number) => kind(c) === GRAIN || kind(c) === WATER

/**
 * ⚠️ WATER REMEMBERS WHICH WAY IT IS GOING, in the lowest bit of its shade. Without it, a drop
 * stepped left or right at random, which is a random walk: water spread as the square root of
 * time, and a block of it left for 1,500 steps still sloped from 29 cells deep to 1. With it, a
 * drop keeps going until something stops it and then turns round, so it spreads in a straight
 * line — and since the block grid shifts by one every step, a drop on the move moves one cell a
 * step. Turning round changes only the drop's own bits, so nothing is made or lost.
 */
export const FLOWS_RIGHT = 4
const right = (c: number) => (c & FLOWS_RIGHT) !== 0

/** two cells side by side in a block: a drop moves the way it faces into space, or turns round */
function spread(L: number, R: number): [number, number] {
  if (kind(L) === WATER && right(L)) return kind(R) === EMPTY ? [R, L] : [L ^ FLOWS_RIGHT, R]
  if (kind(R) === WATER && !right(R)) return kind(L) === EMPTY ? [R, L] : [L, R ^ FLOWS_RIGHT]
  return [L, R]
}
/** whether `top` would sink into `below`: anything movable into empty, sand into water */
const sinks = (top: number, below: number) =>
  (movable(top) && kind(below) === EMPTY) || (kind(top) === GRAIN && kind(below) === WATER)

/**
 * One block, with gravity pointing from the top row (a b) to the bottom (c d). Returns the four
 * cells after, which are always the four before, rearranged. Mirrored in sand.wgsl, line for line.
 */
export function rule(
  a: number,
  b: number,
  c: number,
  d: number,
  r: number,
): [number, number, number, number] {
  let A = a
  let B = b
  let C = c
  let D = d
  // fall straight down — nearly always, so a stream of sand looks like grains rather than a bar
  let fellLeft = false
  let fellRight = false
  if (sinks(A, C) && (r & 15) !== 0) {
    ;[A, C] = [C, A]
    fellLeft = true
  }
  if (sinks(B, D) && ((r >>> 4) & 15) !== 0) {
    ;[B, D] = [D, B]
    fellRight = true
  }
  // topple down a slope: blocked below, open diagonally. The SLOPE a pile stands at (about 45°)
  // comes from the geometry — a grain only ever slides one cell across for one down — and not
  // from this; sand toppling only three times in four is what gives the face its grainy,
  // uneven look rather than a perfect ruled triangle (forced to always, the pile test still
  // passes: it is a look, not a shape). Water always topples.
  const topple = (top: number, r2: number) => kind(top) === WATER || (r2 & 3) !== 0
  if (!fellLeft && !fellRight) {
    const leftFirst = ((r >>> 8) & 1) === 0
    for (const side of leftFirst ? [0, 1] : [1, 0]) {
      if (side === 0 && movable(A) && !sinks(A, C) && sinks(A, D) && topple(A, r >>> 9)) {
        ;[A, D] = [D, A]
        break
      }
      if (side === 1 && movable(B) && !sinks(B, D) && sinks(B, C) && topple(B, r >>> 11)) {
        ;[B, C] = [C, B]
        break
      }
    }
  }
  // water spreads sideways along whatever holds it up — each drop going the way it was going,
  // turning round when it meets something: see FLOWS_RIGHT
  if (((r >>> 13) & 7) !== 0) {
    ;[C, D] = spread(C, D)
    if (kind(C) !== EMPTY && kind(D) !== EMPTY) [A, B] = spread(A, B)
  }
  return [A, B, C, D]
}

/**
 * Where a block's top-left, top-right, bottom-left and bottom-right are on screen when gravity
 * points down (0), left (1), up (2) or right (3): offsets within the 2×2 block, in screen order.
 * Mirrored in sand.wgsl.
 */
export function blockCells(dir: number): [number, number][] {
  const G = [
    [0, 1],
    [-1, 0],
    [0, -1],
    [1, 0],
  ][dir & 3]
  // "across" is gravity turned a quarter turn the other way, so with gravity down a block reads
  // left to right as a page does
  const U = [G[1], -G[0]]
  const fix = (v: number, u: number, g: number) => v + (u < 0 ? 1 : 0) + (g < 0 ? 1 : 0)
  return [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ].map(([cu, cv]) => [
    fix(cu * U[0] + cv * G[0], U[0], G[0]),
    fix(cu * U[1] + cv * G[1], U[1], G[1]),
  ])
}

/**
 * One step on the CPU, as the GPU does it: blocks on the even or odd grid by step parity; a block
 * hanging off the edge is left as it is (the edge acts as a wall). Mutates `cells`.
 */
export function stepSand(cells: Uint32Array, w: number, h: number, step: number, dir: number) {
  const o = step & 1
  const map = blockCells(dir)
  for (let by = o; by + 1 < h; by += 2)
    for (let bx = o; bx + 1 < w; bx += 2) {
      const idx = map.map(([dx, dy]) => (by + dy) * w + bx + dx)
      const out = rule(
        cells[idx[0]],
        cells[idx[1]],
        cells[idx[2]],
        cells[idx[3]],
        hash(bx, by, step),
      )
      idx.forEach((i, k) => (cells[i] = out[k]))
    }
}

/** what a brush puts down */
export const TOOLS = { sand: 'Sand', water: 'Water', wall: 'Wall', erase: 'Erase' } as const
export type Tool = keyof typeof TOOLS
export const TOOL_KIND: Record<Tool, number> = {
  sand: GRAIN,
  water: WATER,
  wall: WALL,
  erase: EMPTY,
}

export type Dab = { x: number; y: number; r: number; tool: Tool }

/** dabs packed for the brush pass: x, y, radius, kind */
export function packDabs(dabs: readonly Dab[]): Float32Array<ArrayBuffer> {
  const f = new Float32Array(MAX_DABS * 4)
  dabs.slice(0, MAX_DABS).forEach((d, i) => f.set([d.x, d.y, d.r, TOOL_KIND[d.tool]], i * 4))
  return f
}

/**
 * Which way gravity points, from how the phone is held: `beta` front-to-back, `gamma` side to
 * side, turned by the screen's own angle in landscape. Held nearly flat there is no clear "down",
 * and gravity stays where it was (-1).
 */
export function gravityFromTilt(beta: number, gamma: number, screenAngle: number): number {
  const rad = Math.PI / 180
  // gravity in the device's own screen axes: x right, y down
  const gx = Math.sin(gamma * rad) * Math.cos(beta * rad)
  const gy = Math.sin(beta * rad)
  const a = -screenAngle * rad
  const x = gx * Math.cos(a) - gy * Math.sin(a)
  const y = gx * Math.sin(a) + gy * Math.cos(a)
  if (Math.hypot(x, y) < 0.35) return -1
  if (Math.abs(y) >= Math.abs(x)) return y > 0 ? 0 : 2
  return x > 0 ? 3 : 1
}

/** rooms to start from, as walls and starting sand on a w×h grid */
export function preset(id: Preset, w: number, h: number, seed = 1): Uint32Array {
  const cells = new Uint32Array(w * h)
  const shade = (i: number) => (hash(i, 7, seed) & 63) << 2
  const set = (x: number, y: number, k: number) => {
    if (x >= 0 && y >= 0 && x < w && y < h)
      cells[y * w + x] = k | (k === GRAIN || k === WATER ? shade(y * w + x) : 0)
  }
  // a frame round the box: everything is in a container
  for (let x = 0; x < w; x++) {
    set(x, 0, WALL)
    set(x, h - 1, WALL)
  }
  for (let y = 0; y < h; y++) {
    set(0, y, WALL)
    set(w - 1, y, WALL)
  }
  if (id === 'hourglass') {
    const cx = w / 2
    const neck = Math.max(2, Math.round(w * 0.03))
    for (let y = 1; y < h - 1; y++) {
      // the glass narrows to the neck halfway down and widens again
      const t = Math.abs(y - h / 2) / (h / 2)
      const half = neck + (Math.min(w, h * 0.9) * 0.45 - neck) * t
      for (let x = 1; x < w - 1; x++) if (Math.abs(x - cx) > half) set(x, y, WALL)
      if (y < h * 0.4)
        for (let x = 1; x < w - 1; x++)
          if (Math.abs(x - cx) <= half - 1 && y > h * 0.06) set(x, y, GRAIN)
    }
  } else if (id === 'shelves') {
    for (let k = 0; k < 4; k++) {
      const y = Math.round(h * (0.25 + k * 0.17))
      const left = k % 2 === 0
      for (let x = 0; x < w * 0.62; x++) set(left ? x : w - 1 - x, y, WALL)
    }
    for (let y = 2; y < h * 0.15; y++)
      for (let x = Math.round(w * 0.1); x < w * 0.3; x++) set(x, y, GRAIN)
    for (let y = 2; y < h * 0.15; y++)
      for (let x = Math.round(w * 0.7); x < w * 0.9; x++) set(x, y, WATER)
  }
  return cells
}
export const PRESETS = { hourglass: 'Hourglass', shelves: 'Shelves', empty: 'Empty box' } as const
export type Preset = keyof typeof PRESETS

export type SandFrame = {
  w: number
  h: number
  step: number
  gravity: number
  dabs: number
  time: number
}

export function packSand(p: SandFrame, into = new ArrayBuffer(SAND.bytes)) {
  const u = new Uint32Array(into)
  const f = new Float32Array(into)
  u[0] = p.w
  u[1] = p.h
  u[SAND.step / 4] = p.step
  u[SAND.gravity / 4] = p.gravity
  u[SAND.dabs / 4] = p.dabs
  f[SAND.time / 4] = p.time
  return into
}
