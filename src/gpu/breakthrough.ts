/**
 * Breakthrough: two armies of pawns on a square board, each starting on its own two back rows. A
 * pawn steps one square forward, straight or diagonally, into an empty square, and takes only on
 * the diagonal. Get one pawn to the far row, or take every pawn the other side has, and you win.
 * No draws: somebody always gets through. And nobody is ever left without a move — a pawn is only
 * stopped by what stands straight ahead, and the furthest-up pawn a side has always has a diagonal
 * that is empty or holds a pawn it can take.
 *
 * Pure, so breakthrough.test.ts can play a few hundred games without a page. Squares are numbered
 * row by row from the top-left; side 1 starts at the bottom and moves up, side 2 the other way.
 */

export type Side = 1 | 2
export type Board = { n: number; cells: Int8Array }
export type Move = { from: number; to: number; take: boolean }
export type Game = {
  board: Board
  turn: Side
  winner: Side | 0
  /** moves made so far, both sides */
  plies: number
}
export const SIZES = [6, 8] as const
export type Size = (typeof SIZES)[number]
export const other = (s: Side): Side => (s === 1 ? 2 : 1)
const forward = (s: Side) => (s === 1 ? -1 : 1)
/** how far a square is up the board for a side: 0 on its own back row, n - 1 on the far one */
export const advance = (n: number, i: number, s: Side) => {
  const r = Math.floor(i / n)
  return s === 1 ? n - 1 - r : r
}

export function newGame(n: number = 8, first: Side = 1): Game {
  const cells = new Int8Array(n * n)
  for (let i = 0; i < 2 * n; i++) {
    cells[i] = 2
    cells[n * n - 1 - i] = 1
  }
  return { board: { n, cells }, turn: first, winner: 0, plies: 0 }
}

/** every move for a side: forward into an empty square, or diagonally to an empty one or a take */
export function movesOf(b: Board, s: Side): Move[] {
  const { n, cells } = b
  const out: Move[] = []
  const f = forward(s)
  const them = other(s)
  for (let i = 0; i < n * n; i++) {
    if (cells[i] !== s) continue
    const r = Math.floor(i / n) + f
    if (r < 0 || r >= n) continue
    const c = i % n
    for (const dc of [-1, 0, 1]) {
      const cc = c + dc
      if (cc < 0 || cc >= n) continue
      const to = r * n + cc
      const there = cells[to]
      if (there === 0) out.push({ from: i, to, take: false })
      else if (dc !== 0 && there === them) out.push({ from: i, to, take: true })
    }
  }
  return out
}
export const moves = (g: Game) => (g.winner ? [] : movesOf(g.board, g.turn))
export const count = (b: Board, s: Side) => b.cells.reduce((t, x) => t + (x === s ? 1 : 0), 0)

export function play(g: Game, m: Move): Game {
  const cells = g.board.cells.slice()
  const s = g.turn
  cells[m.to] = s
  cells[m.from] = 0
  const board = { n: g.board.n, cells }
  const them = other(s)
  const through = advance(board.n, m.to, s) === board.n - 1
  // through to the far row, or nothing left to stop you
  const winner: Side | 0 = through || count(board, them) === 0 ? s : 0
  return { board, turn: them, winner, plies: g.plies + 1 }
}

/* --------------------------------------------------------------------------- the computer */

export const LEVELS = ['easy', 'fair', 'hard'] as const
export type Level = (typeof LEVELS)[number]
const WIN = 1_000_000

/**
 * Whether a pawn of side `s` stands diagonally behind square `i`, from `s`'s end of the board — so
 * that it could step onto `i`. For a pawn of `s` on `i` that is a guard; for one of the other side's,
 * a threat.
 */
export function covers(b: Board, i: number, s: Side): boolean {
  const { n, cells } = b
  const r = Math.floor(i / n) - forward(s)
  if (r < 0 || r >= n) return false
  const c = i % n
  return (c > 0 && cells[r * n + c - 1] === s) || (c < n - 1 && cells[r * n + c + 1] === s)
}

/**
 * How the board stands for the side to move, in hundredths of a pawn. A pawn is worth more the
 * further up it is, and more again with a friend guarding it; a pawn that can be taken for nothing
 * is worth less. A pawn one step from the far row with the move is a win, and one that the side to
 * move cannot take is very nearly a loss.
 */
export function value(b: Board, s: Side): number {
  const { n, cells } = b
  const them = other(s)
  let v = 0
  let threat = 0
  for (let i = 0; i < n * n; i++) {
    const p = cells[i]
    if (!p) continue
    const side = p as Side
    const a = advance(n, i, side)
    if (side === s && a === n - 2) return WIN / 2
    let x = 100 + a * a * 3
    const safe = covers(b, i, side)
    if (safe) x += 10
    // a pawn the other side can take, with nothing to take back, is half lost already
    if (covers(b, i, side === s ? them : s) && !safe) x -= side === s ? 20 : 45
    if (a === 0) x += 6
    if (side === them && a === n - 2) threat++
    v += side === s ? x : -x
  }
  if (threat) {
    // their pawn one step from home: it must be taken this move, every one of them
    let stopped = 0
    for (let i = 0; i < n * n; i++)
      if (cells[i] === them && advance(n, i, them) === n - 2 && covers(b, i, s)) stopped++
    if (stopped < threat || threat > 1) return -WIN / 2
  }
  return v
}

/**
 * The plies each level looks ahead; Easy also misjudges, by a little noise on every look. Measured
 * from both seats on games none of this was tuned on: Fair beats Easy 56 in 60 and Hard beats Fair
 * 40 in 40, Hard's slowest move 467 ms. Easy at two plies with three times the noise lost to Fair
 * only 39 in 60, too close to tell the two apart.
 */
export const DEPTH: Record<Level, number> = { easy: 1, fair: 3, hard: 4 }
/** how many positions Hard's five-ply look may take before it settles for four */
export const HARD_BUDGET = 200_000
const CALLED_OFF = new Error('called off')
let budget = Infinity
const EASY_NOISE = 60

/** takes first, then the pawns furthest up: the moves most likely to settle things */
function order(list: Move[], b: Board, s: Side): Move[] {
  const n = b.n
  const key = (m: Move) => (m.take ? 1000 : 0) + advance(n, m.to, s)
  return list.sort((x, y) => key(y) - key(x))
}

/** positions looked at in the current choice, so a deep look can be called off */
export let nodes = 0
/** negamax with alpha-beta: the board's worth for the side to move, `depth` plies on */
function search(
  b: Board,
  s: Side,
  depth: number,
  alpha: number,
  beta: number,
  ply: number,
): number {
  if (++nodes > budget) throw CALLED_OFF
  if (depth <= 0) return value(b, s)
  const list = movesOf(b, s)
  if (!list.length) return -WIN + ply
  const n = b.n
  const them = other(s)
  const cells = b.cells
  let best = -Infinity
  for (const m of order(list, b, s)) {
    if (advance(n, m.to, s) === n - 1) return WIN - ply
    const was = cells[m.to]
    cells[m.to] = s
    cells[m.from] = 0
    const gone = was === them && count(b, them) === 0
    const v = gone ? WIN - ply : -search(b, them, depth - 1, -beta, -alpha, ply + 1)
    cells[m.from] = s
    cells[m.to] = was
    if (v > best) best = v
    if (best > alpha) alpha = best
    if (alpha >= beta) break
  }
  return best
}

/**
 * Every move's worth `depth` plies on, or null when the look was called off for passing `limit`
 * positions.
 */
function rootValues(g: Game, depth: number, limit: number): { m: Move; v: number }[] | null {
  const b: Board = { n: g.board.n, cells: g.board.cells.slice() }
  const s = g.turn
  const them = other(s)
  nodes = 0
  budget = limit
  const out: { m: Move; v: number }[] = []
  try {
    for (const m of order(moves(g), b, s)) {
      let v: number
      if (advance(b.n, m.to, s) === b.n - 1) v = WIN
      else {
        const was = b.cells[m.to]
        b.cells[m.to] = s
        b.cells[m.from] = 0
        v =
          was === them && count(b, them) === 0
            ? WIN
            : -search(b, them, depth - 1, -Infinity, Infinity, 1)
        b.cells[m.from] = s
        b.cells[m.to] = was
      }
      out.push({ m, v })
    }
  } catch (e) {
    if (e === CALLED_OFF) return null
    throw e
  } finally {
    budget = Infinity
  }
  return out
}

/**
 * The computer's move: the best it can see at its level, ties broken by chance. Hard looks five
 * plies on when the board allows it and four when it does not: a crowded middle game can take
 * 770,000 positions at five, most of a second here and several on a phone, so a look past
 * HARD_BUDGET positions is called off and the four-ply answer, always finished first, stands.
 */
export function choose(g: Game, level: Level, rand: () => number = Math.random): Move {
  const list = moves(g)
  if (list.length === 1) return list[0]
  let scored = rootValues(g, DEPTH[level], Infinity)!
  if (level === 'hard') scored = rootValues(g, 5, HARD_BUDGET) ?? scored
  let best: Move[] = []
  let bv = -Infinity
  for (const { m, v: raw } of scored) {
    const v =
      level === 'easy' && Math.abs(raw) < WIN / 4 ? raw + (rand() * 2 - 1) * EASY_NOISE : raw
    if (v > bv) {
      bv = v
      best = [m]
    } else if (v === bv) best.push(m)
  }
  return best[Math.floor(rand() * best.length)]
}

/** a whole game between two levels, for the tests */
export function match(a: Level, b: Level, n: number, rand: () => number) {
  let g = newGame(n)
  const lv: Record<Side, Level> = { 1: a, 2: b }
  while (!g.winner && g.plies < 400) g = play(g, choose(g, lv[g.turn], rand))
  return { winner: g.winner, plies: g.plies }
}

/* --------------------------------------------------------------------------- what is kept */

export const BREAKTHROUGH_KEY = 'lab_breakthrough_v1'
export const LOOKS = ['stone', 'garden', 'neon'] as const
export type Tally = { won: number; lost: number; fastest: number }
export type Saved = {
  level: Level
  size: Size
  look: (typeof LOOKS)[number]
  /** mark the squares a picked pawn can move to */
  hints: boolean
  record: Record<Level, Tally>
}
const NONE: Tally = { won: 0, lost: 0, fastest: 0 }
export const EMPTY: Saved = {
  level: 'fair',
  size: 8,
  look: 'stone',
  hints: true,
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
    record[l] = { won: whole(x.won), lost: whole(x.lost), fastest: whole(x.fastest) }
  }
  return {
    level: pick(LEVELS, o.level, EMPTY.level),
    size: pick(SIZES, o.size, EMPTY.size),
    look: pick(LOOKS, o.look, EMPTY.look),
    hints: typeof o.hints === 'boolean' ? o.hints : EMPTY.hints,
    record,
  }
}
