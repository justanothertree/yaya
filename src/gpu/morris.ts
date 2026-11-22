/**
 * Nine men's morris: three nested squares joined at their middles, 24 points. Each side places nine
 * men, then moves them along the lines; three of yours in a row on a line (a mill) lets you take
 * one of theirs. Down to three men, you may fly to any empty point. Fewer than three, or no move
 * at all, and you have lost. Pure, so morris.test.ts can play whole games without a page.
 *
 * Points are numbered 0–23: the outer square 0–7, the middle 8–15, the inner 16–23, each going
 * round clockwise from its top-left corner, so point k of one square sits beside point k of the
 * next whenever k is odd (the middles of the sides).
 */

export type Man = 0 | 1 | 2
export type Who = 1 | 2
export const other = (w: Who): Who => (w === 1 ? 2 : 1)
export const MEN = 9

/** each square's eight points, corners and middles, as they run round */
const ring = (s: number) => Array.from({ length: 8 }, (_, k) => s * 8 + k)
export const NEIGHBOURS: number[][] = Array.from({ length: 24 }, () => [])
const join = (a: number, b: number) => {
  NEIGHBOURS[a].push(b)
  NEIGHBOURS[b].push(a)
}
for (let s = 0; s < 3; s++) {
  const r = ring(s)
  for (let k = 0; k < 8; k++) join(r[k], r[(k + 1) % 8])
}
for (let k = 1; k < 8; k += 2) {
  join(k, 8 + k)
  join(8 + k, 16 + k)
}
export const MILLS: number[][] = []
for (let s = 0; s < 3; s++)
  for (let k = 0; k < 8; k += 2) MILLS.push([s * 8 + k, s * 8 + k + 1, s * 8 + ((k + 2) % 8)])
for (let k = 1; k < 8; k += 2) MILLS.push([k, 8 + k, 16 + k])

export type Game = {
  board: Man[]
  /** men not yet placed, per side (index 1 and 2; 0 unused) */
  hand: [number, number, number]
  turn: Who
  /** moves since a man was last taken, for the draw rule */
  quiet: number
  winner: 0 | Who | 3
}
export const newGame = (): Game => ({
  board: Array<Man>(24).fill(0),
  hand: [0, MEN, MEN],
  turn: 1,
  quiet: 0,
  winner: 0,
})
export const DRAW_AFTER = 50

export const count = (g: Game, w: Who) => g.board.filter((m) => m === w).length + g.hand[w]
export const inMill = (board: Man[], p: number) =>
  board[p] !== 0 && MILLS.some((m) => m.includes(p) && m.every((q) => board[q] === board[p]))
const makesMill = (board: Man[], p: number, w: Who) =>
  MILLS.some((m) => m.includes(p) && m.every((q) => q === p || board[q] === w))

/** a move: put a man down (from -1) or move one, and take one of theirs if it closes a mill */
export type Move = { from: number; to: number; take: number }

/** the men a mill may take: any not in a mill, or any at all when every one of theirs is in one */
export function takeable(board: Man[], them: Who): number[] {
  const theirs = board.map((m, i) => (m === them ? i : -1)).filter((i) => i >= 0)
  const loose = theirs.filter((i) => !inMill(board, i))
  return loose.length ? loose : theirs
}

export function moves(g: Game): Move[] {
  if (g.winner) return []
  const w = g.turn
  const out: Move[] = []
  const steps: [number, number][] = []
  if (g.hand[w] > 0) for (let p = 0; p < 24; p++) if (!g.board[p]) steps.push([-1, p])
  if (g.hand[w] === 0) {
    const flying = count(g, w) === 3
    for (let p = 0; p < 24; p++) {
      if (g.board[p] !== w) continue
      for (const q of flying ? [...Array(24).keys()] : NEIGHBOURS[p])
        if (!g.board[q]) steps.push([p, q])
    }
  }
  for (const [from, to] of steps) {
    const b = g.board.slice()
    if (from >= 0) b[from] = 0
    if (makesMill(b, to, w)) {
      b[to] = w
      for (const t of takeable(b, other(w))) out.push({ from, to, take: t })
    } else out.push({ from, to, take: -1 })
  }
  return out
}

export function play(g: Game, m: Move): Game {
  const w = g.turn
  const board = g.board.slice()
  const hand: Game['hand'] = [0, g.hand[1], g.hand[2]]
  if (m.from < 0) hand[w]--
  else board[m.from] = 0
  board[m.to] = w
  if (m.take >= 0) board[m.take] = 0
  const next: Game = {
    board,
    hand,
    turn: other(w),
    quiet: m.take >= 0 ? 0 : g.quiet + 1,
    winner: 0,
  }
  const them = other(w)
  if (count(next, them) < 3) next.winner = w
  else if (!moves(next).length) next.winner = w
  else if (hand[1] === 0 && hand[2] === 0 && next.quiet >= DRAW_AFTER) next.winner = 3
  return next
}

/* ---------------------------------------------------------------------------- the computer */

export const LEVELS = ['easy', 'fair', 'hard'] as const
export type Level = (typeof LEVELS)[number]
/**
 * Measured from both seats over eight games: fair beat easy 8–0 and hard beat fair 8–0, with hard's
 * slowest move at 305 ms. ⚠️ At 3 and 5 the same was true and hard took 5.2 s over one move: once a
 * side is down to three men it may fly anywhere, every flight that closes a mill can take any of
 * several men, and the tree is suddenly wide.
 */
export const DEPTH: Record<Level, number> = { easy: 1, fair: 2, hard: 4 }

function value(g: Game, me: Who): number {
  if (g.winner === me) return 100000
  if (g.winner === other(me)) return -100000
  if (g.winner === 3) return 0
  const them = other(me)
  let v = (count(g, me) - count(g, them)) * 100
  // two of a mill with the third point empty is a threat; a man that cannot move is a weakness
  for (const m of MILLS) {
    const mine = m.filter((p) => g.board[p] === me).length
    const theirs = m.filter((p) => g.board[p] === them).length
    const empty = 3 - mine - theirs
    if (mine === 2 && empty === 1) v += 12
    if (theirs === 2 && empty === 1) v -= 12
    if (mine === 3) v += 6
    if (theirs === 3) v -= 6
  }
  for (let p = 0; p < 24; p++) {
    if (!g.board[p]) continue
    const free = NEIGHBOURS[p].filter((q) => !g.board[q]).length
    v += (g.board[p] === me ? 1 : -1) * free * 2
  }
  return v
}

function search(g: Game, me: Who, depth: number, alpha: number, beta: number): number {
  if (depth === 0 || g.winner)
    return value(g, me) + (g.winner ? depth : 0) * (g.winner === me ? 1 : -1)
  const list = moves(g)
  // takings first: they are usually the best and worst moves both
  list.sort((a, b) => Number(b.take >= 0) - Number(a.take >= 0))
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

/** the computer's move: each level searches its depth ahead with alpha-beta; Easy also strays */
export function choose(g: Game, level: Level, rand: () => number = Math.random): Move {
  const list = moves(g)
  if (list.length === 1) return list[0]
  if (level === 'easy' && rand() < 0.3) return list[Math.floor(rand() * list.length)]
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

export const MORRIS_KEY = 'lab_morris_v1'
export const BOARDS = ['wood', 'slate', 'garden'] as const
export const PIECES = ['stones', 'coins', 'gems'] as const
export type Tally = { won: number; lost: number; drawn: number }
export type Saved = {
  level: Level
  board: (typeof BOARDS)[number]
  pieces: (typeof PIECES)[number]
  /** light up the points a picked man may go to */
  hints: boolean
  record: Record<Level, Tally>
}
const NONE: Tally = { won: 0, lost: 0, drawn: 0 }
export const EMPTY: Saved = {
  level: 'fair',
  board: 'wood',
  pieces: 'stones',
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
