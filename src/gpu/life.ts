/**
 * The arithmetic of the Lab's Game of Life, and a plain JavaScript copy of the rule — kept so the
 * GPU's answer has something to be checked against that shares none of its code.
 */

/** Mirrors the constants at the bottom of life-types.wgsl; life.test.ts reads them back out. */
export const ALIVE = 255
export const TRAIL = 160
export const DECAY = 16

/** must equal `@workgroup_size(8, 8)` on every compute entry point */
export const TILE = 8

/** Hand-packed to match `struct Life` — see the note in life-types.wgsl. */
export const LIFE = {
  cols: 0,
  rows: 4,
  brush: 8,
  view: 16,
  radius: 24,
  paint: 28,
  seed: 32,
  bytes: 40,
} as const

export type LifeParams = {
  cols: number
  rows: number
  brush: readonly [number, number]
  view: readonly [number, number]
  radius: number
  /** 0 nothing, 1 bring to life, 2 wipe */
  paint: 0 | 1 | 2
  seed: number
}

export function packLife(p: LifeParams, into = new ArrayBuffer(LIFE.bytes)): ArrayBuffer {
  const f = new Float32Array(into)
  const u = new Uint32Array(into)
  u[LIFE.cols / 4] = p.cols
  u[LIFE.rows / 4] = p.rows
  f[LIFE.brush / 4] = p.brush[0]
  f[LIFE.brush / 4 + 1] = p.brush[1]
  f[LIFE.view / 4] = p.view[0]
  f[LIFE.view / 4 + 1] = p.view[1]
  f[LIFE.radius / 4] = p.radius
  u[LIFE.paint / 4] = p.paint
  u[LIFE.seed / 4] = p.seed
  return into
}

/** CSS pixels per cell, for each size on offer */
export const CELL_SIZES = { small: 3, medium: 5, large: 9 } as const
export type CellSize = keyof typeof CELL_SIZES

/** a million cells is 4 MB a board and two boards; plenty, and nowhere near any device's limit */
export const MAX_CELLS = 1 << 20

/**
 * The board for a canvas `cssW` × `cssH` CSS pixels at `cellPx` a cell: whole cells only, never
 * fewer than 16 a side, and shrunk evenly if it would pass MAX_CELLS.
 */
export function gridFor(cssW: number, cssH: number, cellPx: number) {
  let cols = Math.max(16, Math.floor(cssW / cellPx))
  let rows = Math.max(16, Math.floor(cssH / cellPx))
  if (cols * rows > MAX_CELLS) {
    const k = Math.sqrt(MAX_CELLS / (cols * rows))
    cols = Math.floor(cols * k)
    rows = Math.floor(rows * k)
  }
  return { cols, rows }
}

/** A point on the canvas, in cells: x across from the left, y down from the top. */
export function toCell(
  px: number,
  py: number,
  width: number,
  height: number,
  cols: number,
  rows: number,
): readonly [number, number] {
  return [(px / width) * cols, (py / height) * rows]
}

/**
 * Generations to run this frame, and what is left over: `speed` a second, and never more than
 * `cap` in one frame — a slow frame should make the board slower, not make it jump.
 */
export function generationsDue(carry: number, dt: number, speed: number, cap = 4) {
  const due = carry + dt * speed
  const run = Math.min(Math.floor(due), cap)
  return { run, carry: run === cap ? 0 : due - run }
}

/** One generation on the CPU, by the same rule and encoding as `generation` in life-step.wgsl. */
export function lifeStep(cells: Uint32Array, cols: number, rows: number): Uint32Array {
  const next = new Uint32Array(cells.length)
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      let n = 0
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue
          const xx = (x + dx + cols) % cols
          const yy = (y + dy + rows) % rows
          if (cells[yy * cols + xx] === ALIVE) n++
        }
      const v = cells[y * cols + x]
      next[y * cols + x] =
        (v === ALIVE && (n === 2 || n === 3)) || (v !== ALIVE && n === 3)
          ? ALIVE
          : v === ALIVE
            ? TRAIL
            : v > DECAY
              ? v - DECAY
              : 0
    }
  }
  return next
}
