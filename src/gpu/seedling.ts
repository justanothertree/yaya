/**
 * The arithmetic of the Lab's seedling: Life as a puzzle. Each level is a small walled garden with
 * lamps in it and a patch where you may plant; you get a few seed cells, the rule runs for so many
 * generations, and every lamp has to be lit — a live cell on it — at least once before time runs out.
 * Stones never live, so they cut whatever grows into them. Some gardens run other rules than
 * Conway's; in Make you build gardens of your own, rule included, and keep them as files.
 *
 * ⚠️ THE GPU STEPS AND DRAWS; THE JUDGE IS HERE. `step` is the rule the shader's `grow` pass runs,
 * line for line, and seedling.test.ts plays every level twice: untouched it must fail, with its own
 * stored solution it must be solved. A level whose solution stopped working fails a test, not a player.
 */

export const COLS = 32
export const ROWS = 20
export const CELLS = COLS * ROWS

/** a rule as two masks over the neighbour count 0–8: bit n of `born` means n neighbours make a cell */
export type Rule = { born: number; stays: number }

export const RULES = {
  life: { name: 'Life', born: 1 << 3, stays: (1 << 2) | (1 << 3) },
  highlife: { name: 'HighLife', born: (1 << 3) | (1 << 6), stays: (1 << 2) | (1 << 3) },
  seeds: { name: 'Seeds', born: 1 << 2, stays: 0 },
  daynight: {
    name: 'Day & Night',
    born: (1 << 3) | (1 << 6) | (1 << 7) | (1 << 8),
    stays: (1 << 3) | (1 << 4) | (1 << 6) | (1 << 7) | (1 << 8),
  },
  maze: { name: 'Maze', born: 1 << 3, stays: 0b111110 },
} as const satisfies Record<string, Rule & { name: string }>

/** "B3/S23" for a rule; the notation its fans write it in */
export function ruleText(r: Rule) {
  const digits = (m: number) =>
    Array.from({ length: 9 }, (_, n) => n)
      .filter((n) => m & (1 << n))
      .join('')
  return `B${digits(r.born)}/S${digits(r.stays)}`
}
/** "B36/S23" back to a rule, or null; B0 is refused, since it would make the empty garden explode */
export function parseRule(t: string): Rule | null {
  const m = /^B([0-8]*)\/S([0-8]*)$/i.exec(t.trim())
  if (!m) return null
  const mask = (s: string) => [...s].reduce((a, c) => a | (1 << Number(c)), 0)
  const r = { born: mask(m[1]), stays: mask(m[2]) }
  return r.born & 1 ? null : r
}

export type V2 = [number, number]
/** a rectangle of cells: x, y, w, h */
export type Rect = [number, number, number, number]

export type Level = {
  name: string
  hint: string
  rule: Rule
  /** generations the garden runs for */
  gens: number
  /** seed cells you may plant */
  budget: number
  /** where you may plant */
  patch: Rect
  stones: Rect[]
  lamps: V2[]
}

export const at = (x: number, y: number) => y * COLS + x
export const inRect = ([rx, ry, rw, rh]: Rect, x: number, y: number) =>
  x >= rx && y >= ry && x < rx + rw && y < ry + rh

/** the stones of a level as a mask */
export function stonesOf(l: Level) {
  const s = new Uint8Array(CELLS)
  for (const r of l.stones)
    for (let y = r[1]; y < r[1] + r[3]; y++)
      for (let x = r[0]; x < r[0] + r[2]; x++)
        if (x >= 0 && y >= 0 && x < COLS && y < ROWS) s[at(x, y)] = 1
  return s
}

/**
 * One generation: each cell counts its eight neighbours (the garden's edge is dead ground, not a
 * wrap), is born or stays by the rule, and a stone is never alive. The shader's `grow`, line for line.
 */
export function step(
  cells: Uint8Array,
  stones: Uint8Array,
  rule: Rule,
  into: Uint8Array = new Uint8Array(CELLS),
) {
  for (let y = 0; y < ROWS; y++)
    for (let x = 0; x < COLS; x++) {
      let n = 0
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue
          const nx = x + dx
          const ny = y + dy
          if (nx >= 0 && ny >= 0 && nx < COLS && ny < ROWS) n += cells[at(nx, ny)]
        }
      const i = at(x, y)
      const mask = cells[i] ? rule.stays : rule.born
      into[i] = stones[i] ? 0 : (mask >> n) & 1
    }
  return into
}

/** the garden as planted: the seeds that are in the patch, not on a stone, and within budget */
export function plant(l: Level, seeds: readonly V2[]) {
  const cells = new Uint8Array(CELLS)
  const stones = stonesOf(l)
  let used = 0
  for (const [x, y] of seeds) {
    if (!inRect(l.patch, x, y) || x >= COLS || y >= ROWS || stones[at(x, y)] || cells[at(x, y)])
      continue
    if (used >= l.budget) break
    cells[at(x, y)] = 1
    used++
  }
  return { cells, stones, used }
}

export type Outcome = {
  /** the generation each lamp first lit, or −1 */
  lit: number[]
  /** the generation the last lamp lit, or −1 if any never did */
  solved: number
  /** how many cells were alive when it stopped */
  alive: number
}

/** run a planted level to its end (or until every lamp is lit and `stopWhenSolved`) */
export function grow(l: Level, seeds: readonly V2[], stopWhenSolved = true): Outcome {
  let { cells } = plant(l, seeds)
  const { stones } = plant(l, [])
  let next = new Uint8Array(CELLS)
  const lit: number[] = l.lamps.map(([x, y]) => (cells[at(x, y)] ? 0 : -1))
  let solved = lit.every((g) => g >= 0) ? 0 : -1
  for (let g = 1; g <= l.gens && !(stopWhenSolved && solved >= 0); g++) {
    step(cells, stones, l.rule, next)
    ;[cells, next] = [next, cells]
    l.lamps.forEach(([x, y], k) => {
      if (lit[k] < 0 && cells[at(x, y)]) lit[k] = g
    })
    if (solved < 0 && lit.every((v) => v >= 0)) solved = g
  }
  return { lit, solved, alive: cells.reduce((a, c) => a + c, 0) }
}

/** a glider, as offsets from its corner, heading down and right; turned for the other three ways */
export const GLIDER: V2[] = [
  [1, 0],
  [2, 1],
  [0, 2],
  [1, 2],
  [2, 2],
]
/** a shape turned a quarter clockwise `k` times within its 3×3 box */
export function turn(shape: readonly V2[], k: number): V2[] {
  let s = shape.map(([x, y]) => [x, y] as V2)
  for (let i = 0; i < ((k % 4) + 4) % 4; i++) s = s.map(([x, y]) => [2 - y, x] as V2)
  return s
}

/** the gardens, easiest first. Each was designed by search and has a stored solution the tests replay */
export const LEVELS: Level[] = [
  {
    name: 'First light',
    hint: 'A glider is five cells that walk one cell down and right every four generations. Stamp one with 🛩 Glider (↻ turns it) and send it to the lamp.',
    rule: RULES.life,
    gens: 60,
    budget: 5,
    patch: [2, 2, 5, 5],
    stones: [],
    lamps: [[17, 16]],
  },
  {
    name: 'Both ways',
    hint: 'Two lamps in opposite corners, and a glider only ever goes one way.',
    rule: RULES.life,
    gens: 80,
    budget: 10,
    patch: [12, 6, 8, 8],
    stones: [],
    lamps: [
      [2, 1],
      [29, 18],
    ],
  },
  {
    name: 'Through the gap',
    hint: 'Gliders only travel on the diagonal, and a stone kills whatever grows into it. Line one up with the gap.',
    rule: RULES.life,
    gens: 100,
    budget: 5,
    patch: [1, 1, 12, 6],
    stones: [
      [17, 0, 1, 7],
      [17, 12, 1, 8],
    ],
    lamps: [[25, 18]],
  },
  {
    name: 'Seeds',
    hint: 'A different rule: in Seeds (B2/S) every live cell dies at once, and a cell with exactly two live neighbours is born. Three seeds, four corners.',
    rule: RULES.seeds,
    gens: 40,
    budget: 3,
    patch: [14, 8, 4, 4],
    stones: [],
    lamps: [
      [1, 1],
      [30, 1],
      [1, 18],
      [30, 18],
    ],
  },
  {
    name: 'Wake the garden',
    hint: 'Six lamps all round. The right five cells keep growing for hundreds of generations; most five die out or settle.',
    rule: RULES.life,
    gens: 200,
    budget: 5,
    patch: [14, 8, 4, 4],
    stones: [],
    lamps: [
      [1, 9],
      [30, 7],
      [16, 18],
      [16, 0],
      [24, 15],
      [3, 12],
    ],
  },
  {
    name: 'Maze',
    hint: 'In Maze (B3/S12345) life grows corridors and they stay. Three seeds, two far lamps.',
    rule: RULES.maze,
    gens: 120,
    budget: 3,
    patch: [2, 8, 4, 4],
    stones: [],
    lamps: [
      [29, 2],
      [29, 17],
    ],
  },
]

const glider = (k: number, x: number, y: number) =>
  turn(GLIDER, k).map(([a, b]) => [a + x, b + y] as V2)
/** a solution to each garden, in the same order: for the tests, and for 💡 when somebody is stuck */
export const SOLUTIONS: V2[][] = [
  glider(0, 2, 2),
  [...glider(0, 16, 6), ...glider(2, 12, 11)],
  glider(0, 10, 1),
  [
    [14, 8],
    [15, 8],
    [14, 9],
  ],
  [
    [16, 9],
    [17, 9],
    [15, 10],
    [16, 10],
    [16, 11],
  ],
  [
    [4, 8],
    [4, 9],
    [5, 10],
  ],
]

/* ---------------------------------------------------------------- planting and making --------- */

export type Stamp = 'cell' | 'glider'
/** the cells a stamp covers when tapped at (x, y): one cell, or a glider centred there, turned k times */
export function stampAt(stamp: Stamp, k: number, x: number, y: number): V2[] {
  return stamp === 'cell' ? [[x, y]] : turn(GLIDER, k).map(([a, b]) => [a + x - 1, b + y - 1] as V2)
}

/**
 * Seeds after a tap: one cell already planted is taken back up; otherwise the stamp is planted whole
 * — every cell of it in the patch and off the stones, those already planted counted once — or, if it
 * does not fit or would pass the budget, not at all, with the reason. Half a glider is no glider.
 */
export function tapSeeds(
  l: Level,
  seeds: readonly V2[],
  cells: readonly V2[],
): { seeds: V2[]; why?: string } {
  const has = (x: number, y: number) => seeds.some(([a, b]) => a === x && b === y)
  if (cells.length === 1 && has(...cells[0]))
    return { seeds: seeds.filter(([a, b]) => a !== cells[0][0] || b !== cells[0][1]) }
  const stones = stonesOf(l)
  const fits = cells.every(
    ([x, y]) =>
      x >= 0 && y >= 0 && x < COLS && y < ROWS && inRect(l.patch, x, y) && !stones[at(x, y)],
  )
  if (!fits)
    return {
      seeds: [...seeds],
      why: cells.length > 1 ? 'That stamp does not fit in the patch there.' : undefined,
    }
  const fresh = cells.filter(
    ([x, y], i) => !has(x, y) && cells.findIndex(([a, b]) => a === x && b === y) === i,
  )
  if (seeds.length + fresh.length > l.budget)
    return {
      seeds: [...seeds],
      why: `This garden gives ${l.budget} seeds; that would need ${seeds.length + fresh.length}.`,
    }
  return { seeds: [...seeds, ...fresh] }
}

/** a mask as rectangles, a run of cells along each row at a time: what a garden file keeps */
export function runsOf(mask: Uint8Array): Rect[] {
  const out: Rect[] = []
  for (let y = 0; y < ROWS; y++)
    for (let x = 0; x < COLS; x++) {
      if (!mask[at(x, y)]) continue
      let w = 1
      while (x + w < COLS && mask[at(x + w, y)]) w++
      out.push([x, y, w, 1])
      x += w - 1
    }
  return out
}

const sameCell = (a: V2, b: V2) => a[0] === b[0] && a[1] === b[1]

/** a stone laid or lifted at (x, y); a lamp there goes, and nothing is laid in the patch */
export function paintStone(l: Level, x: number, y: number, on: boolean): Level {
  if (on && inRect(l.patch, x, y)) return l
  const m = stonesOf(l)
  if (m[at(x, y)] === (on ? 1 : 0)) return l
  m[at(x, y)] = on ? 1 : 0
  return { ...l, stones: runsOf(m), lamps: l.lamps.filter((p) => !sameCell(p, [x, y])) }
}

/** a lamp put at (x, y) or taken away; never on a stone or in the patch, and at most MAX_LAMPS */
export function toggleLamp(l: Level, x: number, y: number): Level {
  if (l.lamps.some((p) => sameCell(p, [x, y])))
    return { ...l, lamps: l.lamps.filter((p) => !sameCell(p, [x, y])) }
  if (inRect(l.patch, x, y) || stonesOf(l)[at(x, y)] || l.lamps.length >= MAX_LAMPS) return l
  return { ...l, lamps: [...l.lamps, [x, y]] }
}

/** the patch dragged from one corner to the other; stones and lamps inside it are cleared away */
export function setPatch(l: Level, a: V2, b: V2): Level {
  const clamp = (v: number, hi: number) => Math.max(0, Math.min(hi - 1, Math.round(v)))
  const x0 = clamp(Math.min(a[0], b[0]), COLS)
  const y0 = clamp(Math.min(a[1], b[1]), ROWS)
  const patch: Rect = [
    x0,
    y0,
    clamp(Math.max(a[0], b[0]), COLS) - x0 + 1,
    clamp(Math.max(a[1], b[1]), ROWS) - y0 + 1,
  ]
  const m = stonesOf(l)
  for (let y = patch[1]; y < patch[1] + patch[3]; y++)
    for (let x = patch[0]; x < patch[0] + patch[2]; x++) m[at(x, y)] = 0
  return {
    ...l,
    patch,
    stones: runsOf(m),
    lamps: l.lamps.filter(([x, y]) => !inRect(patch, x, y)),
  }
}

/** a fresh garden to make: an empty plot on the left, one lamp on the right, Conway's rule */
export const blankLevel = (): Level => ({
  name: 'My garden',
  hint: '',
  rule: { born: RULES.life.born, stays: RULES.life.stays },
  gens: 100,
  budget: 6,
  patch: [2, 7, 6, 6],
  stones: [],
  lamps: [[27, 10]],
})

/* ---------------------------------------------------------------- a garden as a file ---------- */

export const SEEDLING_KEY = 'lab_seedling_v1'
export const FILE_LIMIT = 50_000
export const MAX_STONES = CELLS
export const MAX_LAMPS = 40
export const MAX_GENS = 500
export const MAX_BUDGET = 40

const int = (v: unknown, lo: number, hi: number) =>
  typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi
const cell = (v: unknown): v is V2 =>
  Array.isArray(v) && v.length === 2 && int(v[0], 0, COLS - 1) && int(v[1], 0, ROWS - 1)
const rect = (v: unknown): v is Rect =>
  Array.isArray(v) &&
  v.length === 4 &&
  int(v[0], 0, COLS - 1) &&
  int(v[1], 0, ROWS - 1) &&
  int(v[2], 1, COLS - (v[0] as number)) &&
  int(v[3], 1, ROWS - (v[1] as number))

/**
 * A garden from a file, or why not. Data only, checked field by field and bounded everywhere: a
 * board-sized garden, at most MAX_LAMPS lamps and a stone a cell, a rule as two 9-bit masks with no
 * birth from nothing, every lamp outside the patch and off the stones (a lamp nobody could light, or
 * one lit by planting on it, is not a puzzle).
 */
export function readLevel(text: unknown): Level | string {
  if (typeof text !== 'string' || text.length > FILE_LIMIT)
    return 'That file is too big to be a garden.'
  let v: unknown
  try {
    v = JSON.parse(text)
  } catch {
    return 'That file is not a garden (it is not JSON).'
  }
  if (!v || typeof v !== 'object') return 'That file is not a garden.'
  const o = v as Record<string, unknown>
  const r = o.rule as Record<string, unknown> | undefined
  if (typeof o.name !== 'string' || o.name.length > 40)
    return 'A garden needs a name of up to 40 letters.'
  if (o.hint !== undefined && (typeof o.hint !== 'string' || o.hint.length > 240))
    return 'A garden’s hint is up to 240 letters.'
  if (!r || !int(r.born, 0, 511) || !int(r.stays, 0, 511) || (r.born as number) & 1)
    return 'That garden’s rule is not one this toy can run.'
  if (!int(o.gens, 1, MAX_GENS)) return `A garden runs for 1 to ${MAX_GENS} generations.`
  if (!int(o.budget, 1, MAX_BUDGET)) return `A garden gives 1 to ${MAX_BUDGET} seeds.`
  if (!rect(o.patch)) return 'That garden’s planting patch is off the board.'
  if (!Array.isArray(o.stones) || o.stones.length > MAX_STONES || !o.stones.every(rect))
    return 'That garden’s stones are off the board, or too many.'
  if (
    !Array.isArray(o.lamps) ||
    o.lamps.length < 1 ||
    o.lamps.length > MAX_LAMPS ||
    !o.lamps.every(cell)
  )
    return `A garden has 1 to ${MAX_LAMPS} lamps, all on the board.`
  const level: Level = {
    name: o.name,
    hint: typeof o.hint === 'string' ? o.hint : '',
    rule: { born: r.born as number, stays: r.stays as number },
    gens: o.gens as number,
    budget: o.budget as number,
    patch: [...(o.patch as Rect)],
    stones: (o.stones as Rect[]).map((s) => [...s] as Rect),
    lamps: (o.lamps as V2[]).map((l) => [...l] as V2),
  }
  const stones = stonesOf(level)
  if (level.lamps.some(([x, y]) => stones[at(x, y)] || inRect(level.patch, x, y)))
    return 'A lamp of that garden is on a stone or in the patch, where it could never be a puzzle.'
  return level
}

/* ---------------------------------------------------------------- for the GPU ---------------- */

/**
 * Where a point of a stage `size` big is in the garden, in cells: the garden and half a cell of hedge
 * round it, as big as fits, turned upright on a tall stage. The shader's `to_garden`, line for line.
 */
export function gardenFit(size: V2, p: V2): V2 {
  const [sw, sh] = size
  if (sh > sw) {
    const s = Math.min(sw / (ROWS + 1), sh / (COLS + 1))
    const o: V2 = [(sw - ROWS * s) / 2, (sh - COLS * s) / 2]
    return [COLS - (p[1] - o[1]) / s, (p[0] - o[0]) / s]
  }
  const s = Math.min(sw / (COLS + 1), sh / (ROWS + 1))
  return [(p[0] - (sw - COLS * s) / 2) / s, (p[1] - (sh - ROWS * s) / 2) / s]
}

/** Hand-packed to match `struct Garden` — seedling.test.ts lays the struct out from the shader. */
export const GARDEN = {
  size: 0,
  grid: 8,
  plot: 16,
  born: 32,
  stays: 36,
  time: 40,
  phase: 44,
  planting: 48,
  bytes: 64,
} as const

export function packGarden(
  p: {
    w: number
    h: number
    patch: Rect
    rule: Rule
    time: number
    phase: number
    planting: boolean
  },
  into = new ArrayBuffer(GARDEN.bytes),
) {
  const u = new Uint32Array(into)
  const f = new Float32Array(into)
  u.set([p.w, p.h, COLS, ROWS, ...p.patch, p.rule.born, p.rule.stays], 0)
  f[GARDEN.time / 4] = p.time
  f[GARDEN.phase / 4] = p.phase
  u[GARDEN.planting / 4] = p.planting ? 1 : 0
  return into
}

/** a level's stones and lamps as the shader's marks: 1 a stone, 2 a lamp (4, lit, is the GPU's) */
export function marksOf(l: Level) {
  const m = new Uint32Array(CELLS)
  stonesOf(l).forEach((s, i) => (m[i] = s))
  for (const [x, y] of l.lamps) m[at(x, y)] |= 2
  return m
}

/** fewest seeds (then generations) kept per garden, by name */
export type Best = Record<string, { seeds: number; gen: number }>
/** −1 is the garden you made */
export type Saved = { made: Level; best: Best; level: number }
/**
 * What Seedling keeps: the garden you made, the fewest seeds per garden, and which garden it was on.
 * Moved here unchanged from SeedlingDemo so the Lab's share card reads it the toy's own way.
 */
export function readSaved(raw: string | null): Saved {
  const fresh: Saved = { made: blankLevel(), best: {}, level: 0 }
  try {
    if (!raw || raw.length > FILE_LIMIT * 2) return fresh
    const v = JSON.parse(raw) as Partial<Saved>
    const made = readLevel(JSON.stringify(v.made))
    const best: Best = {}
    if (v.best && typeof v.best === 'object')
      for (const [k, b] of Object.entries(v.best).slice(0, 50))
        if (b && Number.isInteger(b.seeds) && Number.isInteger(b.gen))
          best[k.slice(0, 40)] = { seeds: b.seeds, gen: b.gen }
    const level =
      Number.isInteger(v.level) && (v.level as number) >= -1 && (v.level as number) < LEVELS.length
        ? (v.level as number)
        : 0
    return { made: typeof made === 'string' ? fresh.made : made, best, level }
  } catch {
    return fresh
  }
}
