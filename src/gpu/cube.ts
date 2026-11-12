/**
 * Noughts and crosses in a cube: four layers of four by four, sixty-four cells. Four in a line wins —
 * along a row, a column or a diagonal of one layer, straight down through the layers, or on any of
 * the diagonals that slant through them. There are seventy-six such lines.
 *
 * Pure, so cube.test.ts can play hundreds of games without a page. A cell is layer * 16 + row * 4 +
 * column; 1 is crosses, who move first, and 2 noughts.
 */

export type Side = 1 | 2
export const other = (s: Side): Side => (s === 1 ? 2 : 1)
const idx = (l: number, r: number, c: number) => l * 16 + r * 4 + c

/** every line of four, found as every start and direction that stays inside the cube for four steps */
export const LINES: number[][] = (() => {
  const out: number[][] = []
  const seen = new Set<string>()
  const ds = [-1, 0, 1]
  for (const dl of ds)
    for (const dr of ds)
      for (const dc of ds) {
        if (!dl && !dr && !dc) continue
        for (let l = 0; l < 4; l++)
          for (let r = 0; r < 4; r++)
            for (let c = 0; c < 4; c++) {
              const cells: number[] = []
              for (let k = 0; k < 4; k++) {
                const L = l + dl * k
                const R = r + dr * k
                const C = c + dc * k
                if (L < 0 || L > 3 || R < 0 || R > 3 || C < 0 || C > 3) break
                cells.push(idx(L, R, C))
              }
              if (cells.length < 4) continue
              const key = [...cells].sort((a, b) => a - b).join()
              if (!seen.has(key)) {
                seen.add(key)
                out.push(cells)
              }
            }
      }
  return out
})()
/** the lines through each cell */
export const THROUGH: number[][] = Array.from({ length: 64 }, (_, i) =>
  LINES.map((l, k) => (l.includes(i) ? k : -1)).filter((k) => k >= 0),
)

export type Game = {
  cells: Int8Array
  turn: Side
  winner: Side | 0
  line: number[]
  moves: number[]
  over: boolean
}
export const newGame = (first: Side = 1): Game => ({
  cells: new Int8Array(64),
  turn: first,
  winner: 0,
  line: [],
  moves: [],
  over: false,
})
export function place(g: Game, i: number): Game {
  if (g.over || g.cells[i]) return g
  const cells = g.cells.slice()
  cells[i] = g.turn
  const won = THROUGH[i].map((k) => LINES[k]).find((l) => l.every((j) => cells[j] === g.turn))
  const moves = [...g.moves, i]
  return {
    cells,
    turn: other(g.turn),
    winner: won ? g.turn : 0,
    line: won ?? [],
    moves,
    over: !!won || moves.length === 64,
  }
}
export function undo(g: Game, k = 1): Game {
  // whoever moved first: the side to move now, or the other, by how many moves have been made
  let out = newGame(g.moves.length % 2 === 0 ? g.turn : other(g.turn))
  for (const m of g.moves.slice(0, Math.max(0, g.moves.length - k))) out = place(out, m)
  return out
}

/* --------------------------------------------------------------------------- the computer */

export const LEVELS = ['easy', 'fair', 'hard'] as const
export type Level = (typeof LEVELS)[number]
/** what a line is worth, by how many of one side's marks it holds with none of the other's */
const WORTH = [0, 1, 8, 80, 1e6]
/** how the board stands for a side: its open lines against the other side's */
export function value(cells: Int8Array, side: Side): number {
  let v = 0
  for (const line of LINES) {
    let mine = 0
    let theirs = 0
    for (const j of line) {
      if (cells[j] === side) mine++
      else if (cells[j]) theirs++
    }
    if (mine && !theirs) v += WORTH[mine]
    else if (theirs && !mine) v -= WORTH[theirs] * 1.1
  }
  return v
}
/** cells where a side would complete four now */
export function winsAt(cells: Int8Array, side: Side): number[] {
  const out = new Set<number>()
  for (const line of LINES) {
    let mine = 0
    let gap = -1
    for (const j of line) {
      if (cells[j] === side) mine++
      else if (!cells[j]) gap = j
    }
    if (mine === 3 && gap >= 0 && line.filter((j) => !cells[j]).length === 1) out.add(gap)
  }
  return [...out]
}
const empties = (cells: Int8Array) => [...cells.keys()].filter((i) => !cells[i])

function search(
  cells: Int8Array,
  side: Side,
  me: Side,
  depth: number,
  alpha: number,
  beta: number,
): number {
  const opts = empties(cells)
  if (!opts.length) return 0
  if (depth === 0) return value(cells, me)
  // a win on the board ends the search; a threat of the other side's must be answered at once
  const win = winsAt(cells, side)
  if (win.length) return side === me ? 1e7 + depth : -1e7 - depth
  const block = winsAt(cells, other(side))
  const list = block.length ? block.slice(0, 1) : order(cells, opts, side).slice(0, 10)
  if (side === me) {
    let best = -Infinity
    for (const i of list) {
      cells[i] = side
      best = Math.max(best, search(cells, other(side), me, depth - 1, alpha, beta))
      cells[i] = 0
      alpha = Math.max(alpha, best)
      if (alpha >= beta) break
    }
    return best
  }
  let best = Infinity
  for (const i of list) {
    cells[i] = side
    best = Math.min(best, search(cells, other(side), me, depth - 1, alpha, beta))
    cells[i] = 0
    beta = Math.min(beta, best)
    if (alpha >= beta) break
  }
  return best
}
/**
 * Cells in the order most worth trying: the ones on the most lines still open to the side, its own
 * lines weighted by how full they are. Counting its own lines flat instead was tried: Fair became as
 * strong as Hard (22 games to 18 in 40) while Hard gained nothing, so the levels ran together
 */
function order(cells: Int8Array, opts: number[], side: Side): number[] {
  const score = (i: number) => {
    let s = 0
    for (const k of THROUGH[i]) {
      let mine = 0
      let theirs = 0
      for (const j of LINES[k]) {
        if (cells[j] === side) mine++
        else if (cells[j]) theirs++
      }
      if (!theirs) s += WORTH[mine] + 1
      if (!mine) s += WORTH[theirs]
    }
    return s
  }
  return opts
    .map((i) => ({ i, s: score(i) }))
    .sort((a, b) => b.s - a.s)
    .map((x) => x.i)
}

/**
 * A forced win for `side` by threats alone: a mark that makes three in an open line, so the other
 * side must fill the fourth cell, and again, until one mark makes two such threats at once — which
 * cannot both be blocked. Returns the first mark of such a sequence, or -1. A block that itself
 * makes a threat for the other side breaks the sequence, since it must then be answered.
 */
export function forcedWin(cells: Int8Array, side: Side, depth = 8, budget = 20_000): number {
  looked = 0
  limit = budget
  return forced(cells, side, depth)
}
/** positions the forcing search has looked at, and how many it may: its cost grows with every threat */
let looked = 0
let limit = 0
function forced(cells: Int8Array, side: Side, depth: number): number {
  if (depth <= 0 || ++looked > limit) return -1
  const foe = other(side)
  // only a cell on a line already holding two of the side's marks and none of the other's can make a
  // threat: trying every empty cell instead made a Hard move take over a second
  const can = new Set<number>()
  for (const line of LINES) {
    let mine = 0
    let theirs = 0
    for (const j of line) {
      if (cells[j] === side) mine++
      else if (cells[j]) theirs++
    }
    if (mine === 2 && !theirs) for (const j of line) if (!cells[j]) can.add(j)
  }
  for (const i of can) {
    // only marks that make a threat
    cells[i] = side
    const threats = winsAt(cells, side)
    if (!threats.length) {
      cells[i] = 0
      continue
    }
    if (threats.length >= 2 && !winsAt(cells, foe).length) {
      cells[i] = 0
      return i
    }
    const block = threats[0]
    cells[block] = foe
    const counter = winsAt(cells, foe).length > 0
    const on = counter ? -1 : forced(cells, side, depth - 1)
    cells[block] = 0
    cells[i] = 0
    if (on >= 0) return i
  }
  return -1
}

/** the plies each level looks ahead */
export const DEPTH: Record<Level, number> = { easy: 1, fair: 2, hard: 4 }
export function choose(g: Game, level: Level, rand: () => number = Math.random): number {
  const me = g.turn
  const cells = g.cells.slice()
  const win = winsAt(cells, me)
  if (win.length) return win[0]
  const block = winsAt(cells, other(me))
  if (block.length) return block[0]
  if (level === 'fair') {
    // a short sequence of threats that wins by force: without it Fair beat Easy 34 games in 60, with
    // it 48, and 55 in another 60
    const f = forcedWin(cells, me, 4, 3000)
    if (f >= 0) return f
  }
  if (level === 'hard') {
    // a sequence of threats that wins by force. Checking every move for one it would leave the other
    // side was tried too: Hard with it won 22 games in 40 against Hard without, inside the noise, at
    // six times the time a move took, so it is not here
    const force = forcedWin(cells, me)
    if (force >= 0) return force
  }
  const opts = order(cells, empties(cells), me)
  if (level === 'easy') {
    // the best few by eye, and any of them
    const top = opts.slice(0, 5)
    return top[Math.floor(rand() * top.length)]
  }
  let best: number[] = []
  let bv = -Infinity
  for (const i of opts.slice(0, 12)) {
    cells[i] = me
    const v = search(cells, other(me), me, DEPTH[level] - 1, -Infinity, Infinity)
    cells[i] = 0
    if (v > bv) {
      bv = v
      best = [i]
    } else if (v === bv) best.push(i)
  }
  return best[Math.floor(rand() * best.length)]
}
export function match(a: Level, b: Level, rand: () => number) {
  let g = newGame()
  const lv: Record<Side, Level> = { 1: a, 2: b }
  while (!g.over) g = place(g, choose(g, lv[g.turn], rand))
  return { winner: g.winner, moves: g.moves.length }
}

/* --------------------------------------------------------------------------- what is kept */

export const CUBE_KEY = 'lab_cube_v1'
export const LOOKS = ['glass', 'chalk', 'neon'] as const
export type Tally = { won: number; lost: number; drawn: number }
export type Saved = {
  level: Level
  look: (typeof LOOKS)[number]
  /** mark every cell where a side would complete four */
  hints: boolean
  record: Record<Level, Tally>
}
const NONE: Tally = { won: 0, lost: 0, drawn: 0 }
export const EMPTY: Saved = {
  level: 'fair',
  look: 'glass',
  hints: false,
  record: { easy: NONE, fair: NONE, hard: NONE },
}
const whole = (v: unknown) =>
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
    record[l] = { won: whole(x.won), lost: whole(x.lost), drawn: whole(x.drawn) }
  }
  return {
    level: pick(LEVELS, o.level, EMPTY.level),
    look: pick(LOOKS, o.look, EMPTY.look),
    hints: o.hints === true,
    record,
  }
}
