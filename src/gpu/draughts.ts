/**
 * Draughts on an 8 × 8 board, the English rules: men move one square diagonally forward, take by
 * jumping, and must take when they can — and keep taking with the same piece while it can. A man
 * that reaches the far row is crowned and its move ends there; a king moves and takes both ways.
 * A side with no move has lost. Pure, so draughts.test.ts can play whole games without a page.
 *
 * Only the 32 dark squares are used, numbered 0–31 left to right from the top row. Side 1 starts
 * on the bottom three rows and moves up the board, and moves first.
 */

export type Who = 1 | 2
export const other = (w: Who): Who => (w === 1 ? 2 : 1)
/** 0 empty; 1 and 2 a man of that side; 3 and 4 a king of side 1 and 2 */
export type Piece = 0 | 1 | 2 | 3 | 4
export const owner = (p: Piece): Who | 0 => (p === 0 ? 0 : p === 1 || p === 3 ? 1 : 2)
export const isKing = (p: Piece) => p >= 3

export const rowOf = (i: number) => i >> 2
export const colOf = (i: number) => 2 * (i & 3) + (rowOf(i) % 2 === 0 ? 1 : 0)
/** the dark square at a row and column, or -1 off the board or on a light square */
export const at = (r: number, c: number) =>
  r < 0 || r > 7 || c < 0 || c > 7 || (r + c) % 2 === 0 ? -1 : r * 4 + (c >> 1)

export type Game = {
  board: Piece[]
  turn: Who
  /** moves since a man last moved or anything was taken, for the draw rule */
  quiet: number
  winner: 0 | Who | 3
}
export const DRAW_AFTER = 80
export function newGame(): Game {
  const board = Array<Piece>(32).fill(0)
  for (let i = 0; i < 12; i++) board[i] = 2
  for (let i = 20; i < 32; i++) board[i] = 1
  return { board, turn: 1, quiet: 0, winner: 0 }
}

/** a move is the squares the piece visits, and the squares of the pieces it takes on the way */
export type Move = { path: number[]; taken: number[] }

const forward = (w: Who) => (w === 1 ? -1 : 1)
const dirsOf = (p: Piece): [number, number][] => {
  const all: [number, number][] = [
    [-1, -1],
    [-1, 1],
    [1, -1],
    [1, 1],
  ]
  if (isKing(p)) return all
  const f = forward(owner(p) as Who)
  return all.filter(([dr]) => dr === f)
}
const crowns = (p: Piece, to: number) => !isKing(p) && rowOf(to) === (owner(p) === 1 ? 0 : 7)

function jumpsFrom(board: Piece[], from: number, piece: Piece): Move[] {
  const out: Move[] = []
  const me = owner(piece)
  const walk = (sq: number, path: number[], taken: number[]) => {
    let further = false
    for (const [dr, dc] of dirsOf(piece)) {
      const r = rowOf(sq)
      const c = colOf(sq)
      const over = at(r + dr, c + dc)
      const land = at(r + 2 * dr, c + 2 * dc)
      if (over < 0 || land < 0) continue
      const o = owner(board[over])
      if (!o || o === me || taken.includes(over)) continue
      // the moving piece has left its square, so it may land where it started
      if (board[land] && land !== from) continue
      further = true
      const p2 = [...path, land]
      const t2 = [...taken, over]
      // a man crowned by a jump stops there
      if (crowns(piece, land)) out.push({ path: p2, taken: t2 })
      else walk(land, p2, t2)
    }
    if (!further && taken.length) out.push({ path, taken })
  }
  walk(from, [from], [])
  return out
}

export function moves(g: Game): Move[] {
  if (g.winner) return []
  const jumps: Move[] = []
  const steps: Move[] = []
  for (let i = 0; i < 32; i++) {
    const p = g.board[i]
    if (owner(p) !== g.turn) continue
    jumps.push(...jumpsFrom(g.board, i, p))
    if (jumps.length) continue
    for (const [dr, dc] of dirsOf(p)) {
      const to = at(rowOf(i) + dr, colOf(i) + dc)
      if (to >= 0 && !g.board[to]) steps.push({ path: [i, to], taken: [] })
    }
  }
  return jumps.length ? jumps : steps
}

export function play(g: Game, m: Move): Game {
  const board = g.board.slice()
  const from = m.path[0]
  const to = m.path[m.path.length - 1]
  let piece = board[from]
  const wasMan = !isKing(piece)
  if (crowns(piece, to)) piece = (piece + 2) as Piece
  board[from] = 0
  for (const t of m.taken) board[t] = 0
  board[to] = piece
  const next: Game = {
    board,
    turn: other(g.turn),
    quiet: m.taken.length || wasMan ? 0 : g.quiet + 1,
    winner: 0,
  }
  if (!moves(next).length) next.winner = g.turn
  else if (next.quiet >= DRAW_AFTER) next.winner = 3
  return next
}

export const count = (g: Game, w: Who) => g.board.filter((p) => owner(p) === w).length

/* ---------------------------------------------------------------------------- the computer */

export const LEVELS = ['easy', 'fair', 'hard'] as const
export type Level = (typeof LEVELS)[number]
/**
 * Plies searched, with captures followed past the end until the board is quiet. Measured from both
 * seats over eight games: fair beat easy 8–0 and hard beat fair 8–0, hard's slowest move 157 ms.
 * At 7 it was no stronger (7–0, one draw) and its slowest move took 629 ms, which a phone would
 * make two seconds.
 */
export const DEPTH: Record<Level, number> = { easy: 2, fair: 4, hard: 6 }

function value(g: Game, me: Who): number {
  if (g.winner === me) return 100000
  if (g.winner === other(me)) return -100000
  if (g.winner === 3) return 0
  let v = 0
  let mine = 0
  let theirs = 0
  for (let i = 0; i < 32; i++) {
    const p = g.board[i]
    const o = owner(p)
    if (!o) continue
    const r = rowOf(i)
    const c = colOf(i)
    // a man is worth more the nearer it is to its crown; a king likes the middle of the board
    let x = isKing(p)
      ? 170 - (Math.abs(3.5 - r) + Math.abs(3.5 - c)) * 2
      : 100 + (o === 1 ? 7 - r : r) * 3
    // men left on the back row keep the other side's men from crowning
    if (!isKing(p) && r === (o === 1 ? 7 : 0)) x += 6
    if (o === me) {
      v += x
      mine++
    } else {
      v -= x
      theirs++
    }
  }
  // ahead in material, trade down: the same lead counts for more with fewer pieces on the board
  if (mine !== theirs) v += Math.sign(mine - theirs) * (24 - mine - theirs) * 4
  return v
}

function search(g: Game, me: Who, depth: number, alpha: number, beta: number): number {
  if (g.winner) return value(g, me) + depth * (g.winner === me ? 1 : g.winner === 3 ? 0 : -1)
  const list = moves(g)
  // a capture that must be answered is never the place to stop looking: the next move is forced
  if (depth <= 0 && (!list[0].taken.length || depth <= -6)) return value(g, me)
  if (g.turn === me) {
    let best = -Infinity
    for (const m of list) {
      best = Math.max(best, search(play(g, m), me, depth - 1, alpha, beta))
      alpha = Math.max(alpha, best)
      if (alpha >= beta) break
    }
    return best
  }
  let best = Infinity
  for (const m of list) {
    best = Math.min(best, search(play(g, m), me, depth - 1, alpha, beta))
    beta = Math.min(beta, best)
    if (alpha >= beta) break
  }
  return best
}

/** the computer's move: each level searches its depth ahead; Easy also strays now and then */
export function choose(g: Game, level: Level, rand: () => number = Math.random): Move {
  const list = moves(g)
  if (list.length === 1) return list[0]
  if (level === 'easy' && rand() < 0.25) return list[Math.floor(rand() * list.length)]
  const me = g.turn
  let best: Move[] = []
  let bv = -Infinity
  for (const m of list) {
    const v = search(play(g, m), me, DEPTH[level] - 1, -Infinity, Infinity)
    if (v > bv) {
      bv = v
      best = [m]
    } else if (v === bv) best.push(m)
  }
  return best[Math.floor(rand() * best.length)]
}

/* ---------------------------------------------------------------------------- what is kept */

export const DRAUGHTS_KEY = 'lab_draughts_v1'
export const BOARDS = ['classic', 'wood', 'ice'] as const
export const PIECES = ['red', 'wood', 'mint'] as const
export type Tally = { won: number; lost: number; drawn: number }
export type Saved = {
  level: Level
  board: (typeof BOARDS)[number]
  pieces: (typeof PIECES)[number]
  /** light up the pieces that can move, and where a picked one can go */
  hints: boolean
  record: Record<Level, Tally>
}
const NONE: Tally = { won: 0, lost: 0, drawn: 0 }
export const EMPTY: Saved = {
  level: 'fair',
  board: 'classic',
  pieces: 'red',
  hints: true,
  record: { easy: NONE, fair: NONE, hard: NONE },
}
const tally = (v: unknown) =>
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
    record[l] = { won: tally(x.won), lost: tally(x.lost), drawn: tally(x.drawn) }
  }
  return {
    level: pick(LEVELS, o.level, EMPTY.level),
    board: pick(BOARDS, o.board, EMPTY.board),
    pieces: pick(PIECES, o.pieces, EMPTY.pieces),
    hints: typeof o.hints === 'boolean' ? o.hints : EMPTY.hints,
    record,
  }
}
