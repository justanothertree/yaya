/**
 * Dots and boxes: take turns drawing a line between two neighbouring dots; close the fourth side
 * of a box and it is yours, and you draw again. Pure, so dots.test.ts can play whole games between
 * computers without a page; DotsDemo draws the board and reads your taps and keys.
 *
 * ⚠️ EVERY LINE IS ONE NUMBER. For a board of rows × cols boxes, the horizontal lines come first,
 * row by row ((rows + 1) × cols of them), then the vertical ones (rows × (cols + 1)). Each line
 * knows the one or two boxes it borders and each box its four lines, worked out once in `board()`,
 * so a move is "mark it drawn and look at two boxes" and a whole game is a few thousand of those.
 */

export type Board = {
  rows: number
  cols: number
  /** for each line, the boxes on either side of it (one at the edge) */
  boxesOf: number[][]
  /** for each box, its four lines: top, bottom, left, right */
  linesOf: number[][]
}

export function board(rows: number, cols: number): Board {
  const H = (rows + 1) * cols
  const L = H + rows * (cols + 1)
  const boxesOf: number[][] = Array.from({ length: L }, () => [])
  const linesOf: number[][] = []
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const b = r * cols + c
      const lines = [
        r * cols + c,
        (r + 1) * cols + c,
        H + r * (cols + 1) + c,
        H + r * (cols + 1) + c + 1,
      ]
      linesOf.push(lines)
      for (const l of lines) boxesOf[l].push(b)
    }
  return { rows, cols, boxesOf, linesOf }
}

/** where a line runs, in dot coordinates: from (r0, c0) to (r1, c1) */
export function ends(b: Board, l: number): [number, number, number, number] {
  const H = (b.rows + 1) * b.cols
  if (l < H) {
    const r = Math.floor(l / b.cols)
    const c = l % b.cols
    return [r, c, r, c + 1]
  }
  const k = l - H
  const r = Math.floor(k / (b.cols + 1))
  const c = k % (b.cols + 1)
  return [r, c, r + 1, c]
}
export const lineCount = (b: Board) => b.boxesOf.length
export const isHorizontal = (b: Board, l: number) => l < (b.rows + 1) * b.cols

export type Player = 0 | 1
export type Game = {
  b: Board
  drawn: Uint8Array
  /** who drew each line, for colouring it; -1 not drawn */
  by: Int8Array
  /** who owns each box; -1 nobody yet */
  owner: Int8Array
  score: [number, number]
  turn: Player
  moves: number
}

export function newGame(rows: number, cols: number, first: Player = 0): Game {
  const b = board(rows, cols)
  return {
    b,
    drawn: new Uint8Array(lineCount(b)),
    by: new Int8Array(lineCount(b)).fill(-1),
    owner: new Int8Array(rows * cols).fill(-1),
    score: [0, 0],
    turn: first,
    moves: 0,
  }
}
export const copy = (g: Game): Game => ({
  ...g,
  drawn: g.drawn.slice(),
  by: g.by.slice(),
  owner: g.owner.slice(),
  score: [g.score[0], g.score[1]],
})

export const sides = (g: Game, box: number) => {
  let n = 0
  for (const l of g.b.linesOf[box]) n += g.drawn[l]
  return n
}
export const over = (g: Game) => g.score[0] + g.score[1] === g.owner.length
export const open = (g: Game) => {
  const out: number[] = []
  for (let l = 0; l < g.drawn.length; l++) if (!g.drawn[l]) out.push(l)
  return out
}

/** draw a line: returns the boxes it closed (and the same player goes again if there were any) */
export function play(g: Game, l: number): number[] {
  if (g.drawn[l]) throw new Error(`line ${l} is already drawn`)
  g.drawn[l] = 1
  g.by[l] = g.turn
  g.moves++
  const closed: number[] = []
  for (const box of g.b.boxesOf[l])
    if (sides(g, box) === 4) {
      g.owner[box] = g.turn
      g.score[g.turn]++
      closed.push(box)
    }
  if (!closed.length) g.turn = g.turn === 0 ? 1 : 0
  return closed
}

/** a line that closes a box now */
export const takes = (g: Game, l: number) =>
  !g.drawn[l] && g.b.boxesOf[l].some((box) => sides(g, box) === 3)
/** a line that gives nothing away: no box it borders gets its third side */
export const safe = (g: Game, l: number) =>
  !g.drawn[l] && g.b.boxesOf[l].every((box) => sides(g, box) < 2)

/** how many boxes the other player could take straight after `l`, taking greedily */
export function gives(g: Game, l: number): number {
  const h = copy(g)
  play(h, l)
  if (h.turn === g.turn) return 0
  let n = 0
  for (;;) {
    let found = -1
    for (let k = 0; k < h.drawn.length && found < 0; k++) if (takes(h, k)) found = k
    if (found < 0) return n
    n += play(h, found).length
  }
}

/* ---------------------------------------------------------------------------- the computer */

export const LEVELS = ['easy', 'fair', 'hard'] as const
export type Level = (typeof LEVELS)[number]

const pickOf = <T>(list: T[], rand: () => number) => list[Math.floor(rand() * list.length)]

/**
 * Fair play: take any box that is there to take; otherwise draw a line that gives nothing away;
 * and when every line gives something, give the fewest boxes.
 */
function fair(g: Game, rand: () => number): number {
  const all = open(g)
  const take = all.filter((l) => takes(g, l))
  if (take.length) return pickOf(take, rand)
  const ok = all.filter((l) => safe(g, l))
  if (ok.length) return pickOf(ok, rand)
  let best: number[] = []
  let bn = Infinity
  for (const l of all) {
    const n = gives(g, l)
    if (n < bn) {
      bn = n
      best = [l]
    } else if (n === bn) best.push(l)
  }
  return pickOf(best, rand)
}

/** play a game out with fair play on both sides, and say how it ends for `me` */
function rollout(g: Game, me: Player, rand: () => number): number {
  const h = copy(g)
  while (!over(h)) play(h, fair(h, rand))
  return h.score[me] - h.score[me === 0 ? 1 : 0]
}

/**
 * The computer's line. Easy takes boxes most of the time and otherwise draws anywhere. Fair plays
 * as above. Hard plays fair until the board is nearly out of safe lines, then tries every line it
 * could draw and plays each game out to the end — which is how it finds the endgame's real trick,
 * leaving the last two boxes of a chain to keep control of the long chains still to come.
 */
export function choose(g: Game, level: Level, rand: () => number = Math.random): number {
  const all = open(g)
  if (level === 'easy') {
    const take = all.filter((l) => takes(g, l))
    if (take.length && rand() < 0.75) return pickOf(take, rand)
    const ok = all.filter((l) => safe(g, l))
    return ok.length && rand() < 0.6 ? pickOf(ok, rand) : pickOf(all, rand)
  }
  if (level === 'fair') return fair(g, rand)
  const safeLeft = all.filter((l) => safe(g, l)).length
  if (safeLeft > 4 || all.length > 40) return fair(g, rand)
  const me = g.turn
  let best: number[] = []
  let bv = -Infinity
  for (const l of all) {
    const h = copy(g)
    play(h, l)
    const v = over(h) ? h.score[me] - h.score[me === 0 ? 1 : 0] : rollout(h, me, rand)
    if (v > bv) {
      bv = v
      best = [l]
    } else if (v === bv) best.push(l)
  }
  // among equals, a box in the hand beats one in the bush
  const take = best.filter((l) => takes(g, l))
  return pickOf(take.length ? take : best, rand)
}

/* ---------------------------------------------------------------------------- what is kept */

export const DOTS_KEY = 'lab_dots_v1'
export const SIZES = [3, 4, 5, 6] as const
export const COLOURS = ['#e63946', '#1d7bd8', '#2a9d58', '#f4a261', '#8d5cf6', '#e76fac'] as const
export const FILLS = ['solid', 'initial', 'stripes'] as const
export type Tally = { won: number; lost: number; drawn: number; best: number }
export type Saved = {
  level: Level
  size: (typeof SIZES)[number]
  mine: number
  theirs: number
  fill: (typeof FILLS)[number]
  /** the letter (or emoji) in your boxes, and in a friend's when two play */
  initial: string
  initial2: string
  record: Record<Level, Tally>
}
const NONE: Tally = { won: 0, lost: 0, drawn: 0, best: 0 }
export const EMPTY: Saved = {
  level: 'fair',
  size: 4,
  mine: 1,
  theirs: 0,
  fill: 'initial',
  initial: 'Y',
  initial2: 'F',
  record: { easy: NONE, fair: NONE, hard: NONE },
}

export function recordGame(r: Tally, you: number, them: number): Tally {
  return {
    won: r.won + (you > them ? 1 : 0),
    lost: r.lost + (you < them ? 1 : 0),
    drawn: r.drawn + (you === them ? 1 : 0),
    best: you > them ? Math.max(r.best, you - them) : r.best,
  }
}

const count = (v: unknown) =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 1e6 ? v : 0
const colour = (v: unknown, d: number) =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < COLOURS.length ? v : d
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
      best: count(x.best),
    }
  }
  let mine = colour(o.mine, EMPTY.mine)
  let theirs = colour(o.theirs, EMPTY.theirs)
  if (mine === theirs) {
    mine = EMPTY.mine
    theirs = EMPTY.theirs
  }
  const letter = (x: unknown, d: string) =>
    typeof x === 'string' && [...x].length === 1 && /\S/u.test(x) ? x : d
  return {
    level: pick(LEVELS, o.level, EMPTY.level),
    size: pick(SIZES, o.size, EMPTY.size),
    mine,
    theirs,
    fill: pick(FILLS, o.fill, EMPTY.fill),
    initial: letter(o.initial, EMPTY.initial),
    initial2: letter(o.initial2, EMPTY.initial2),
    record,
  }
}
