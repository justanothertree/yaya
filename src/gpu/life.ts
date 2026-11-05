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

/**
 * Patterns to stamp, in the plain-text form Life people write them in: `O` alive, `.` dead.
 * Each is a classic, and life.test.ts checks each one DOES what it is famous for — a typo in a
 * glider gun is a gun that never fires, and nothing on screen would say why.
 */
export const PATTERNS = {
  glider: { name: 'Glider', rows: ['.O.', '..O', 'OOO'] },
  spaceship: { name: 'Spaceship', rows: ['.O..O', 'O....', 'O...O', 'OOOO.'] },
  pulsar: {
    name: 'Pulsar',
    rows: [
      '..OOO...OOO..',
      '.............',
      'O....O.O....O',
      'O....O.O....O',
      'O....O.O....O',
      '..OOO...OOO..',
      '.............',
      '..OOO...OOO..',
      'O....O.O....O',
      'O....O.O....O',
      'O....O.O....O',
      '.............',
      '..OOO...OOO..',
    ],
  },
  gun: {
    name: 'Glider gun',
    rows: [
      '........................O...........',
      '......................O.O...........',
      '............OO......OO............OO',
      '...........O...O....OO............OO',
      'OO........O.....O...OO..............',
      'OO........O...O.OO....O.O...........',
      '..........O.....O.......O...........',
      '...........O...O....................',
      '............OO......................',
    ],
  },
  acorn: { name: 'Acorn', rows: ['.O.....', '...O...', 'OO..OOO'] },
} as const
export type PatternId = keyof typeof PATTERNS

/** A pattern as cells: ALIVE or 0, row by row. */
export function patternCells(id: PatternId) {
  const rows = PATTERNS[id].rows
  const w = rows[0].length
  const h = rows.length
  const cells = new Uint32Array(w * h)
  rows.forEach((r, y) => [...r].forEach((ch, x) => (cells[y * w + x] = ch === 'O' ? ALIVE : 0)))
  return { w, h, cells }
}

/**
 * Where a pattern centred on cell (cx, cy) lands in a board, as runs of consecutive cells — one
 * `queue.writeBuffer` each. ⚠️ THE BOARD WRAPS, so a pattern stamped at an edge comes in at the
 * other side, the same as anything that walks off it; a row that crosses the right edge is two
 * runs. A pattern bigger than the board is cropped rather than wrapped onto itself.
 */
export function stampRuns(
  p: { w: number; h: number; cells: Uint32Array },
  cols: number,
  rows: number,
  cx: number,
  cy: number,
): { at: number; cells: Uint32Array }[] {
  const w = Math.min(p.w, cols)
  const h = Math.min(p.h, rows)
  const x0 = (((Math.floor(cx) - Math.floor(w / 2)) % cols) + cols) % cols
  const y0 = (((Math.floor(cy) - Math.floor(h / 2)) % rows) + rows) % rows
  const runs: { at: number; cells: Uint32Array }[] = []
  for (let y = 0; y < h; y++) {
    const row = p.cells.subarray(y * p.w, y * p.w + w)
    const by = (y0 + y) % rows
    const first = Math.min(w, cols - x0)
    runs.push({ at: by * cols + x0, cells: row.slice(0, first) })
    if (first < w) runs.push({ at: by * cols, cells: row.slice(first) })
  }
  return runs
}
