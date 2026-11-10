/**
 * Mines: a grid with mines hidden in it. Open a square and it shows how many of its eight
 * neighbours hold a mine; open a mine and the game is lost; open every safe square to win, as
 * quickly as you can. Pure, so mines.test.ts can lay and solve thousands of boards.
 *
 * ⚠️ EVERY BOARD HERE CAN BE CLEARED BY REASONING ALONE. A random board often comes down to a
 * coin toss — two squares, one mine, nothing to tell them apart — and losing a fast run to a coin
 * toss is not a test of anything. So a board is laid, then handed to `solve`, which plays it from
 * the first opening using only what the numbers say; a board it cannot finish is thrown away and
 * another laid. The time is then a measure of the player, and a board shared by everyone is fair.
 */
import { rng } from './bricks'

export type Size = { w: number; h: number; mines: number }
export const SIZES = {
  small: { w: 9, h: 9, mines: 10 },
  medium: { w: 16, h: 16, mines: 40 },
  large: { w: 16, h: 30, mines: 99 },
} as const satisfies Record<string, Size>
export type SizeName = keyof typeof SIZES

export function neighbours(s: Size, i: number): number[] {
  const x = i % s.w
  const y = Math.floor(i / s.w)
  const out: number[] = []
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue
      const nx = x + dx
      const ny = y + dy
      if (nx >= 0 && nx < s.w && ny >= 0 && ny < s.h) out.push(ny * s.w + nx)
    }
  return out
}

/** how many mines touch each square (a mine's own count is unused) */
export function counts(s: Size, mine: boolean[]): number[] {
  return mine.map((_, i) => neighbours(s, i).filter((j) => mine[j]).length)
}

/** every square that opens with `start`: a zero opens all of its neighbours, and so on outwards */
export function flood(s: Size, mine: boolean[], count: number[], open: boolean[], start: number) {
  const opened: number[] = []
  const todo = [start]
  while (todo.length) {
    const i = todo.pop()!
    if (open[i] || mine[i]) continue
    open[i] = true
    opened.push(i)
    if (count[i] === 0) for (const j of neighbours(s, i)) if (!open[j]) todo.push(j)
  }
  return opened
}

/**
 * Play a board from `start` using only the numbers, the way a careful person does, and say whether
 * that is enough to open every safe square. Two kinds of reasoning:
 * - one number on its own: if its mines are all accounted for, its other hidden neighbours are
 *   safe; if it has exactly as many hidden neighbours as mines left, they are all mines;
 * - two numbers together: when one's hidden neighbours all lie among the other's, the squares the
 *   other has besides hold exactly the difference in their mines.
 * Then, at the very end, the count of mines left can settle what nothing else did.
 */
export function solve(s: Size, mine: boolean[], start: number): boolean {
  const n = s.w * s.h
  const count = counts(s, mine)
  const open = Array<boolean>(n).fill(false)
  const known = Array<boolean>(n).fill(false) // known to be a mine
  if (mine[start]) return false
  flood(s, mine, count, open, start)
  const safeTotal = n - s.mines
  let opened = open.filter(Boolean).length
  const openSafe = (i: number) => {
    if (open[i] || known[i]) return false
    if (mine[i]) throw new Error('reasoned a mine safe')
    opened += flood(s, mine, count, open, i).length
    return true
  }
  for (let guard = 0; guard < n * 4 && opened < safeTotal; guard++) {
    let moved = false
    // the constraints: each open number's hidden neighbours, and how many mines are among them
    const rules: { cells: number[]; mines: number }[] = []
    for (let i = 0; i < n; i++) {
      if (!open[i] || count[i] === 0) continue
      const hidden = neighbours(s, i).filter((j) => !open[j] && !known[j])
      if (!hidden.length) continue
      const left = count[i] - neighbours(s, i).filter((j) => known[j]).length
      rules.push({ cells: hidden, mines: left })
    }
    for (const r of rules) {
      if (r.mines === 0) for (const j of r.cells) moved = openSafe(j) || moved
      else if (r.mines === r.cells.length)
        for (const j of r.cells)
          if (!known[j]) {
            known[j] = true
            moved = true
          }
    }
    if (moved) continue
    for (const a of rules)
      for (const b of rules) {
        if (a === b || a.cells.length >= b.cells.length) continue
        if (!a.cells.every((c) => b.cells.includes(c))) continue
        const rest = b.cells.filter((c) => !a.cells.includes(c))
        const m = b.mines - a.mines
        if (m === 0) for (const j of rest) moved = openSafe(j) || moved
        else if (m === rest.length)
          for (const j of rest)
            if (!known[j]) {
              known[j] = true
              moved = true
            }
      }
    if (moved) continue
    // the mine count: with all mines found, everything else hidden is safe; with as many hidden
    // squares as mines left, they are all mines
    const hidden = [...Array(n).keys()].filter((i) => !open[i] && !known[i])
    const minesLeft = s.mines - known.filter(Boolean).length
    if (minesLeft === 0) for (const j of hidden) moved = openSafe(j) || moved
    else if (minesLeft === hidden.length) for (const j of hidden) known[j] = true
    if (!moved) break
  }
  return opened === safeTotal
}

/**
 * Lay mines for a board that opens at `start`, keeping the start and its neighbours clear so the
 * first square always opens an area, and laying again until `solve` can finish it. Returns the
 * mines and how many boards were laid to find one.
 */
export function layBoard(s: Size, seed: number, start: number, tries = 4000) {
  const rand = rng(seed)
  const n = s.w * s.h
  const clear = new Set([start, ...neighbours(s, start)])
  const spots = [...Array(n).keys()].filter((i) => !clear.has(i))
  let mine: boolean[] = []
  for (let t = 1; t <= tries; t++) {
    for (let i = spots.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1))
      ;[spots[i], spots[j]] = [spots[j], spots[i]]
    }
    mine = Array<boolean>(n).fill(false)
    for (let k = 0; k < s.mines; k++) mine[spots[k]] = true
    if (solve(s, mine, start)) return { mine, laid: t, fair: true }
  }
  return { mine, laid: tries, fair: false }
}

/* ---------------------------------------------------------------------------- a game */

export type Game = {
  size: Size
  /** null until the first square is opened, when the board is laid around it */
  mine: boolean[] | null
  count: number[]
  open: boolean[]
  flag: boolean[]
  start: number
  /** the mine that ended it, or -1 */
  boom: number
  won: boolean
  seed: number
}
export function newGame(size: Size, seed: number): Game {
  const n = size.w * size.h
  return {
    size,
    mine: null,
    count: Array(n).fill(0),
    open: Array(n).fill(false),
    flag: Array(n).fill(false),
    start: -1,
    boom: -1,
    won: false,
    seed,
  }
}
export const over = (g: Game) => g.won || g.boom >= 0
const safeLeft = (g: Game) => g.size.w * g.size.h - g.size.mines - g.open.filter(Boolean).length

/** open a square: the first one lays the board; a mine ends it; the last safe one wins it */
export function reveal(g: Game, i: number): Game {
  if (over(g) || g.open[i] || g.flag[i]) return g
  let mine = g.mine
  let count = g.count
  if (!mine) {
    mine = layBoard(g.size, g.seed, i).mine
    count = counts(g.size, mine)
  }
  const open = g.open.slice()
  if (mine[i]) return { ...g, mine, count, open, boom: i, start: g.start < 0 ? i : g.start }
  flood(g.size, mine, count, open, i)
  // a flag on a square that a flood opened is taken up
  const flag = g.flag.map((f, k) => f && !open[k])
  const next = { ...g, mine, count, open, flag, start: g.start < 0 ? i : g.start }
  return { ...next, won: safeLeft(next) === 0 }
}
/** open every unflagged neighbour of an open number whose mines are all flagged */
export function chord(g: Game, i: number): Game {
  if (over(g) || !g.open[i] || !g.mine) return g
  const ns = neighbours(g.size, i)
  if (ns.filter((j) => g.flag[j]).length !== g.count[i]) return g
  let next = g
  for (const j of ns) if (!next.open[j] && !next.flag[j]) next = reveal(next, j)
  return next
}
export function toggleFlag(g: Game, i: number): Game {
  if (over(g) || g.open[i]) return g
  const flag = g.flag.slice()
  flag[i] = !flag[i]
  return { ...g, flag }
}

/* ---------------------------------------------------------------------------- what is kept */

export const MINES_KEY = 'lab_mines_v1'
export const THEMES = ['meadow', 'night', 'sand'] as const
export const MARKS = ['flag', 'flower', 'star'] as const
export type Saved = {
  size: SizeName
  theme: (typeof THEMES)[number]
  mark: (typeof MARKS)[number]
  /** best times in tenths of a second, per size */
  best: Partial<Record<SizeName, number>>
  won: number
  played: number
  today: { day: number; tenths: number } | null
}
export const EMPTY: Saved = {
  size: 'small',
  theme: 'meadow',
  mark: 'flag',
  best: {},
  won: 0,
  played: 0,
  today: null,
}
const whole = (v: unknown, max = 1e9) =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < max ? v : 0
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
  const best: Saved['best'] = {}
  const b = (typeof o.best === 'object' && o.best ? o.best : {}) as Record<string, unknown>
  for (const k of Object.keys(SIZES) as SizeName[]) if (whole(b[k])) best[k] = whole(b[k])
  const t = (typeof o.today === 'object' && o.today ? o.today : null) as Record<
    string,
    unknown
  > | null
  const played = whole(o.played)
  return {
    size: pick(Object.keys(SIZES) as SizeName[], o.size, EMPTY.size),
    theme: pick(THEMES, o.theme, EMPTY.theme),
    mark: pick(MARKS, o.mark, EMPTY.mark),
    best,
    won: Math.min(played, whole(o.won)),
    played,
    today:
      t && whole(t.day, 2 ** 32) && whole(t.tenths)
        ? { day: whole(t.day, 2 ** 32), tenths: whole(t.tenths) }
        : null,
  }
}
