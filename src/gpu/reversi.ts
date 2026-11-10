/**
 * Reversi: place a disc so it brackets a line of your opponent's between it and one of yours, and
 * every disc in that line turns over to your colour. If you cannot bracket anything you pass; when
 * neither side can, the game is over and the most discs wins. Pure, so reversi.test.ts can play
 * whole games between computers without a page; ReversiDemo draws the board.
 *
 * The board is a flat array, n × n, of 0 (empty), 1 (dark, who moves first) and 2 (light).
 */

export type Disc = 0 | 1 | 2
export type Who = 1 | 2
export type Board = { n: number; cells: Disc[] }
export const other = (w: Who): Who => (w === 1 ? 2 : 1)
export const SIZES = [6, 8, 10] as const

export function start(n: number): Board {
  const cells = Array<Disc>(n * n).fill(0)
  const m = n / 2
  cells[(m - 1) * n + m - 1] = 2
  cells[m * n + m] = 2
  cells[(m - 1) * n + m] = 1
  cells[m * n + m - 1] = 1
  return { n, cells }
}

const DIRS = [
  [-1, -1],
  [-1, 0],
  [-1, 1],
  [0, -1],
  [0, 1],
  [1, -1],
  [1, 0],
  [1, 1],
] as const

/** the discs a move at `i` would turn over; empty if it is not a move */
export function flips(b: Board, i: number, who: Who): number[] {
  if (b.cells[i] !== 0) return []
  const { n } = b
  const r0 = Math.floor(i / n)
  const c0 = i % n
  const them = other(who)
  const out: number[] = []
  for (const [dr, dc] of DIRS) {
    let r = r0 + dr
    let c = c0 + dc
    const run: number[] = []
    while (r >= 0 && r < n && c >= 0 && c < n && b.cells[r * n + c] === them) {
      run.push(r * n + c)
      r += dr
      c += dc
    }
    if (run.length && r >= 0 && r < n && c >= 0 && c < n && b.cells[r * n + c] === who)
      out.push(...run)
  }
  return out
}

export function moves(b: Board, who: Who): number[] {
  const out: number[] = []
  for (let i = 0; i < b.cells.length; i++)
    if (b.cells[i] === 0 && flips(b, i, who).length) out.push(i)
  return out
}

export function place(b: Board, i: number, who: Who): Board {
  const f = flips(b, i, who)
  if (!f.length) throw new Error(`${i} is not a move for ${who}`)
  const cells = b.cells.slice()
  cells[i] = who
  for (const k of f) cells[k] = who
  return { n: b.n, cells }
}

export const count = (b: Board): [number, number] => {
  let d = 0
  let l = 0
  for (const c of b.cells)
    if (c === 1) d++
    else if (c === 2) l++
  return [d, l]
}
/** who moves next after `who` has moved: the other side, or `who` again if they must pass, or nobody */
export function nextTurn(b: Board, who: Who): Who | null {
  if (moves(b, other(who)).length) return other(who)
  if (moves(b, who).length) return who
  return null
}

/* ---------------------------------------------------------------------------- the computer */

export const LEVELS = ['easy', 'fair', 'hard'] as const
export type Level = (typeof LEVELS)[number]

/**
 * What a square is worth to whoever holds it: corners most (they can never be turned), the
 * squares next to an empty corner least (they hand it over), the edges a little.
 */
export function weights(n: number): number[] {
  const w: number[] = []
  const last = n - 1
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++) {
      const edgeR = r === 0 || r === last
      const edgeC = c === 0 || c === last
      const nearR = r === 1 || r === last - 1
      const nearC = c === 1 || c === last - 1
      let v = 1
      if (edgeR && edgeC) v = 100
      else if ((nearR && nearC) || (edgeR && nearC) || (nearR && edgeC))
        v = edgeR || edgeC ? -20 : -40
      else if (edgeR || edgeC) v = 10
      w.push(v)
    }
  return w
}
/** the squares that are only bad while the corner beside them is empty */
function cornerOf(n: number, i: number): number | null {
  const r = Math.floor(i / n)
  const c = i % n
  const rr = r <= 1 ? 0 : r >= n - 2 ? n - 1 : -1
  const cc = c <= 1 ? 0 : c >= n - 2 ? n - 1 : -1
  return rr < 0 || cc < 0 ? null : rr * n + cc
}

function evaluate(b: Board, me: Who, w: number[]): number {
  const them = other(me)
  let pos = 0
  for (let i = 0; i < b.cells.length; i++) {
    const c = b.cells[i]
    if (c === 0) continue
    let v = w[i]
    if (v < 0) {
      // next to a corner already taken, that square is no longer a gift
      const k = cornerOf(b.n, i)
      if (k !== null && b.cells[k] !== 0) v = 5
    }
    pos += c === me ? v : -v
  }
  const mine = moves(b, me).length
  const theirs = moves(b, them).length
  const mobility = mine + theirs ? (100 * (mine - theirs)) / (mine + theirs) : 0
  return pos + mobility * 0.8
}

function search(
  b: Board,
  who: Who,
  me: Who,
  depth: number,
  alpha: number,
  beta: number,
  w: number[],
  exact: boolean,
): number {
  const list = moves(b, who)
  if (!list.length) {
    if (!moves(b, other(who)).length) {
      const [d, l] = count(b)
      const diff = me === 1 ? d - l : l - d
      return diff * 1000
    }
    return search(b, other(who), me, depth, alpha, beta, w, exact)
  }
  if (depth === 0 && !exact) return evaluate(b, me, w)
  // corners first, then the rest by their worth: the cut-offs come sooner
  list.sort((a, c) => w[c] - w[a])
  if (who === me) {
    let best = -Infinity
    for (const m of list) {
      best = Math.max(
        best,
        search(place(b, m, who), other(who), me, depth - 1, alpha, beta, w, exact),
      )
      alpha = Math.max(alpha, best)
      if (alpha >= beta) break
    }
    return best
  }
  let best = Infinity
  for (const m of list) {
    best = Math.min(
      best,
      search(place(b, m, who), other(who), me, depth - 1, alpha, beta, w, exact),
    )
    beta = Math.min(beta, best)
    if (alpha >= beta) break
  }
  return best
}

/**
 * The computer's move. Easy takes whatever turns the most discs over, and a random one a third of
 * the time. Fair looks two moves ahead weighing squares and room to move; Hard four (six on the
 * small board), and once the board is down to its last ten empty squares (fourteen on the small
 * board) it plays the rest out exactly.
 */
export function choose(b: Board, who: Who, level: Level, rand: () => number = Math.random): number {
  const list = moves(b, who)
  if (list.length <= 1) return list[0]
  if (level === 'easy') {
    if (rand() < 0.35) return list[Math.floor(rand() * list.length)]
    let best: number[] = []
    let bn = -1
    for (const m of list) {
      const k = flips(b, m, who).length
      if (k > bn) {
        bn = k
        best = [m]
      } else if (k === bn) best.push(m)
    }
    return best[Math.floor(rand() * best.length)]
  }
  const w = weights(b.n)
  const empty = b.cells.filter((c) => c === 0).length
  // a small board is cheap to search, so Hard looks further on it
  const exact = level === 'hard' && empty <= (b.n <= 6 ? 14 : 10)
  const depth = level === 'fair' ? 2 : b.n <= 6 ? 6 : 4
  let best: number[] = []
  let bv = -Infinity
  for (const m of list.sort((a, c) => w[c] - w[a])) {
    const v = search(place(b, m, who), other(who), who, depth - 1, -Infinity, Infinity, w, exact)
    if (v > bv) {
      bv = v
      best = [m]
    } else if (v === bv) best.push(m)
  }
  return best[Math.floor(rand() * best.length)]
}

/* ---------------------------------------------------------------------------- what is kept */

export const REVERSI_KEY = 'lab_reversi_v1'
export const BOARDS = ['felt', 'wood', 'slate'] as const
export const DISCS = ['classic', 'sunset', 'ocean', 'candy'] as const
export type Tally = { won: number; lost: number; drawn: number; best: number }
export type Saved = {
  level: Level
  size: (typeof SIZES)[number]
  board: (typeof BOARDS)[number]
  discs: (typeof DISCS)[number]
  /** you play dark (and move first) or light */
  side: Who
  hints: boolean
  record: Record<Level, Tally>
}
const NONE: Tally = { won: 0, lost: 0, drawn: 0, best: 0 }
export const EMPTY: Saved = {
  level: 'fair',
  size: 8,
  board: 'felt',
  discs: 'classic',
  side: 1,
  hints: true,
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
    record[l] = {
      won: tally(x.won),
      lost: tally(x.lost),
      drawn: tally(x.drawn),
      best: tally(x.best),
    }
  }
  return {
    level: pick(LEVELS, o.level, EMPTY.level),
    size: pick(SIZES, o.size, EMPTY.size),
    board: pick(BOARDS, o.board, EMPTY.board),
    discs: pick(DISCS, o.discs, EMPTY.discs),
    side: o.side === 2 ? 2 : 1,
    hints: typeof o.hints === 'boolean' ? o.hints : EMPTY.hints,
    record,
  }
}
