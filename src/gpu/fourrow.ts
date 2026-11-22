/**
 * Four in a row: drop discs into the columns of an upright grid; they fall to the lowest free
 * space. Line up `need` of yours across, down or diagonally to win; a full grid with no line is a
 * draw. Pure, so fourrow.test.ts can play whole games between computers without a page.
 *
 * ⚠️ THE GRID IS ROW 0 AT THE BOTTOM. `cells[r * cols + c]`, with r counting up from the floor, so
 * a column's height is also the row its next disc lands in — gravity is one array of heights.
 */

export type Disc = 0 | 1 | 2
export type Who = 1 | 2
export type Grid = { cols: number; rows: number; need: number; cells: Disc[]; heights: number[] }
export const SIZES = { small: [6, 5], classic: [7, 6], wide: [9, 7] } as const
export type Size = keyof typeof SIZES
export const other = (w: Who): Who => (w === 1 ? 2 : 1)

export function newGrid(size: Size, need = 4): Grid {
  const [cols, rows] = SIZES[size]
  return { cols, rows, need, cells: Array<Disc>(cols * rows).fill(0), heights: Array(cols).fill(0) }
}
export const open = (g: Grid) =>
  g.heights.map((h, c) => (h < g.rows ? c : -1)).filter((c) => c >= 0)
export const full = (g: Grid) => g.heights.every((h) => h >= g.rows)

export function drop(g: Grid, col: number, who: Who): Grid {
  if (col < 0 || col >= g.cols || g.heights[col] >= g.rows) throw new Error(`column ${col} is full`)
  const cells = g.cells.slice()
  const heights = g.heights.slice()
  cells[heights[col] * g.cols + col] = who
  heights[col]++
  return { ...g, cells, heights }
}

const DIRS = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1],
] as const
/** the winning line through the last disc in `col`, if dropping it made one */
export function lineAt(g: Grid, col: number): number[] | null {
  const r0 = g.heights[col] - 1
  if (r0 < 0) return null
  const who = g.cells[r0 * g.cols + col]
  for (const [dc, dr] of DIRS) {
    const line = [r0 * g.cols + col]
    for (const s of [1, -1]) {
      let c = col + dc * s
      let r = r0 + dr * s
      while (c >= 0 && c < g.cols && r >= 0 && r < g.rows && g.cells[r * g.cols + c] === who) {
        line.push(r * g.cols + c)
        c += dc * s
        r += dr * s
      }
    }
    if (line.length >= g.need) return line.sort((a, b) => a - b)
  }
  return null
}

/* ---------------------------------------------------------------------------- the computer */

export const LEVELS = ['easy', 'fair', 'hard'] as const
export type Level = (typeof LEVELS)[number]
export const DEPTH: Record<Level, number> = { easy: 1, fair: 3, hard: 6 }
/**
 * Hard's depth follows the board: a column more at every ply multiplies the work, so it looks
 * further on the small board (8) and less far on the wide one (5) than on the classic (6).
 * ⚠️ Measured, not guessed: at 6 on the small board Hard LOST to Fair 1–5 — the one board where
 * looking deeper costs nothing was the one it most needed it. At 8 it won 2, drew 10 and lost
 * none: good play draws often on so few squares.
 */
const depthFor = (g: Grid, level: Level) =>
  level !== 'hard' ? DEPTH[level] : g.cols <= 6 ? 8 : g.cols > 7 ? 5 : 6

/** every window of `need` cells a line could be made in, worked out once per shape */
const WINDOWS = new Map<string, number[][]>()
function windows(g: Grid): number[][] {
  const key = `${g.cols}x${g.rows}x${g.need}`
  let list = WINDOWS.get(key)
  if (list) return list
  list = []
  for (let r = 0; r < g.rows; r++)
    for (let c = 0; c < g.cols; c++)
      for (const [dc, dr] of DIRS) {
        const w: number[] = []
        for (let k = 0; k < g.need; k++) {
          const cc = c + dc * k
          const rr = r + dr * k
          if (cc < 0 || cc >= g.cols || rr < 0 || rr >= g.rows) break
          w.push(rr * g.cols + cc)
        }
        if (w.length === g.need) list.push(w)
      }
  WINDOWS.set(key, list)
  return list
}

/** how good the grid looks for `me`: open windows filling up with mine, less with theirs */
function score(g: Grid, me: Who): number {
  let s = 0
  const them = other(me)
  for (const w of windows(g)) {
    let a = 0
    let b = 0
    for (const i of w) {
      if (g.cells[i] === me) a++
      else if (g.cells[i] === them) b++
    }
    if (a && b) continue
    if (a) s += a === g.need - 1 ? 50 : a === g.need - 2 ? 6 : 1
    else if (b) s -= b === g.need - 1 ? 60 : b === g.need - 2 ? 6 : 1
  }
  // the middle column takes part in the most lines
  const mid = Math.floor(g.cols / 2)
  for (let r = 0; r < g.rows; r++) if (g.cells[r * g.cols + mid] === me) s += 3
  return s
}

/** columns from the middle outward, which is the order the best moves are usually in */
const centreFirst = (g: Grid) =>
  open(g).sort((a, b) => Math.abs(a - (g.cols - 1) / 2) - Math.abs(b - (g.cols - 1) / 2))

function search(g: Grid, who: Who, me: Who, depth: number, alpha: number, beta: number): number {
  const cols = centreFirst(g)
  if (!cols.length) return 0
  if (depth === 0) return score(g, me)
  let best = who === me ? -Infinity : Infinity
  for (const c of cols) {
    const next = drop(g, c, who)
    let v: number
    // a quicker win is worth more, and a later loss less, so it plays for the shortest win
    if (lineAt(next, c)) v = (who === me ? 1 : -1) * (100000 + depth)
    else v = search(next, other(who), me, depth - 1, alpha, beta)
    if (who === me) {
      best = Math.max(best, v)
      alpha = Math.max(alpha, v)
    } else {
      best = Math.min(best, v)
      beta = Math.min(beta, v)
    }
    if (alpha >= beta) break
  }
  return best
}

/**
 * The computer's column. Each level searches its depth ahead with alpha-beta, middle columns
 * first; Easy also plays a random column a third of the time, though never one that hands you a
 * win you could take at once.
 */
export function choose(g: Grid, who: Who, level: Level, rand: () => number = Math.random): number {
  const cols = centreFirst(g)
  for (const c of cols) if (lineAt(drop(g, c, who), c)) return c
  if (level === 'easy' && rand() < 0.35) {
    const safe = cols.filter((c) => {
      const after = drop(g, c, who)
      return !open(after).some((d) => lineAt(drop(after, d, other(who)), d))
    })
    const list = safe.length ? safe : cols
    return list[Math.floor(rand() * list.length)]
  }
  let best: number[] = []
  let bv = -Infinity
  for (const c of cols) {
    const v = search(drop(g, c, who), other(who), who, depthFor(g, level) - 1, -Infinity, Infinity)
    if (v > bv) {
      bv = v
      best = [c]
    } else if (v === bv) best.push(c)
  }
  return best[Math.floor(rand() * best.length)]
}

/* ---------------------------------------------------------------------------- what is kept */

export const FOUR_KEY = 'lab_fourrow_v1'
export const DISC_SETS = ['classic', 'sunset', 'ocean', 'candy'] as const
export const FRAMES = ['blue', 'wood', 'night'] as const
export type Tally = { won: number; lost: number; drawn: number; fastest: number }
export type Saved = {
  level: Level
  size: Size
  need: 4 | 5
  discs: (typeof DISC_SETS)[number]
  frame: (typeof FRAMES)[number]
  record: Record<Level, Tally>
}
const NONE: Tally = { won: 0, lost: 0, drawn: 0, fastest: 0 }
export const EMPTY: Saved = {
  level: 'fair',
  size: 'classic',
  need: 4,
  discs: 'classic',
  frame: 'blue',
  record: { easy: NONE, fair: NONE, hard: NONE },
}
/** a game is over; `moves` is how many discs you dropped, which only counts for a win */
export function recordGame(r: Tally, result: 'won' | 'lost' | 'drawn', moves: number): Tally {
  return {
    won: r.won + (result === 'won' ? 1 : 0),
    lost: r.lost + (result === 'lost' ? 1 : 0),
    drawn: r.drawn + (result === 'drawn' ? 1 : 0),
    fastest: result === 'won' ? (r.fastest ? Math.min(r.fastest, moves) : moves) : r.fastest,
  }
}
const count = (v: unknown) =>
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
    record[l] = {
      won: count(x.won),
      lost: count(x.lost),
      drawn: count(x.drawn),
      fastest: count(x.fastest),
    }
  }
  return {
    level: pick(LEVELS, o.level, EMPTY.level),
    size: pick(Object.keys(SIZES) as Size[], o.size, EMPTY.size),
    need: o.need === 5 ? 5 : 4,
    discs: pick(DISC_SETS, o.discs, EMPTY.discs),
    frame: pick(FRAMES, o.frame, EMPTY.frame),
    record,
  }
}
