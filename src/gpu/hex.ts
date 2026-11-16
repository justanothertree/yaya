/**
 * Hex: two players take turns putting a stone on an empty cell of a rhombus of hexagons. Red wants
 * a chain of red stones from the top edge to the bottom; blue one from the left edge to the right.
 * The board can never fill without one of them making it, so there are no draws. Pure, so
 * hex.test.ts can play whole games between computers without a page; HexDemo draws it.
 *
 * ⚠️ THE COMPUTER JUDGES A CELL BY HOW OFTEN THE GAMES THAT HAD IT WERE WON. It fills the rest of the
 * board at random again and again, sees who has connected, and credits the winner with every cell
 * they held ("all moves as first"). That works in Hex as in few other games because a finished
 * board alone decides the winner — the order the stones went down in does not matter — so one
 * random fill answers a question about every empty cell at once.
 */

export type Stone = 0 | 1 | 2 // empty, red (top–bottom, moves first), blue (left–right)
export type Player = 1 | 2
export type Board = { n: number; cells: Stone[] }
export const SIZES = [7, 9, 11] as const
export const other = (p: Player): Player => (p === 1 ? 2 : 1)

export const empty = (n: number): Board => ({ n, cells: Array<Stone>(n * n).fill(0) })

/** the six cells that touch cell i */
export function around(n: number, i: number): number[] {
  const r = Math.floor(i / n)
  const c = i % n
  const out: number[] = []
  for (const [dr, dc] of [
    [-1, 0],
    [-1, 1],
    [0, -1],
    [0, 1],
    [1, -1],
    [1, 0],
  ]) {
    const rr = r + dr
    const cc = c + dc
    if (rr >= 0 && rr < n && cc >= 0 && cc < n) out.push(rr * n + cc)
  }
  return out
}
const NEIGHBOURS = new Map<number, number[][]>()
function neighbours(n: number): number[][] {
  let list = NEIGHBOURS.get(n)
  if (!list) {
    list = Array.from({ length: n * n }, (_, i) => around(n, i))
    NEIGHBOURS.set(n, list)
  }
  return list
}

/**
 * The chain that wins for `p`, edge to edge, if there is one; null otherwise. A breadth-first walk
 * from p's first edge, so the chain it returns is a shortest one, for drawing.
 */
export function chain(cells: ArrayLike<number>, n: number, p: Player): number[] | null {
  const near = neighbours(n)
  const from = new Int32Array(n * n).fill(-2)
  const queue: number[] = []
  for (let k = 0; k < n; k++) {
    const i = p === 1 ? k : k * n
    if (cells[i] === p) {
      from[i] = -1
      queue.push(i)
    }
  }
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q]
    const atEnd = p === 1 ? Math.floor(i / n) === n - 1 : i % n === n - 1
    if (atEnd) {
      const path: number[] = []
      for (let k = i; k !== -1; k = from[k]) path.push(k)
      return path.reverse()
    }
    for (const j of near[i])
      if (cells[j] === p && from[j] === -2) {
        from[j] = i
        queue.push(j)
      }
  }
  return null
}
export const winner = (b: Board): Player | null =>
  chain(b.cells, b.n, 1) ? 1 : chain(b.cells, b.n, 2) ? 2 : null

export function place(b: Board, i: number, p: Player): Board {
  if (b.cells[i] !== 0) throw new Error(`cell ${i} is taken`)
  const cells = b.cells.slice()
  cells[i] = p
  return { n: b.n, cells }
}
/** the swap rule: the second player takes the first stone as their own, mirrored to their side */
export function swap(b: Board): Board {
  const at = b.cells.findIndex((c) => c !== 0)
  if (at < 0 || b.cells.filter((c) => c !== 0).length !== 1)
    throw new Error('swap only after one stone')
  const r = Math.floor(at / b.n)
  const c = at % b.n
  const cells = Array<Stone>(b.n * b.n).fill(0)
  cells[c * b.n + r] = 2
  return { n: b.n, cells }
}

/* ---------------------------------------------------------------------------- the computer */

export const LEVELS = ['easy', 'fair', 'hard'] as const
export type Level = (typeof LEVELS)[number]
/**
 * How hard each level thinks: random fills for Easy and Fair, tree-search iterations for Hard.
 * Measured on 9×9 from both seats: fair beat easy 16 of 16 and hard beat fair 13 of 16, with
 * Hard's slowest move at 245 ms. (Hard as more fills alone, 12,000 of them, only broke even with
 * Fair: the fills judge every cell at once but cannot read a fight, which is what the tree is for.)
 */
export const PLAYOUTS: Record<Level, number> = { easy: 60, fair: 300, hard: 20000 }

/** the move that wins at once, if there is one */
function winningMove(b: Board, p: Player): number | null {
  const cells = b.cells.slice()
  for (let i = 0; i < cells.length; i++) {
    if (cells[i]) continue
    cells[i] = p
    const won = chain(cells, b.n, p)
    cells[i] = 0
    if (won) return i
  }
  return null
}

/**
 * A bridge is two of your stones that are not touching but share two empty neighbours: whichever
 * of the two the other side takes, you take the other and stay joined. When one of those two has
 * just been taken, the other is the move — the first thing a good player learns.
 */
export function bridgeSaves(b: Board, p: Player): number[] {
  const near = neighbours(b.n)
  const out = new Set<number>()
  for (let i = 0; i < b.cells.length; i++) {
    if (b.cells[i] !== p) continue
    for (const a of near[i])
      for (const j of near[a]) {
        if (j <= i || b.cells[j] !== p || near[i].includes(j)) continue
        const common = near[i].filter((k) => near[j].includes(k))
        if (common.length !== 2) continue
        const [x, y] = common
        if (b.cells[x] === other(p) && b.cells[y] === 0) out.add(y)
        if (b.cells[y] === other(p) && b.cells[x] === 0) out.add(x)
      }
  }
  return [...out]
}

type Node = {
  move: number
  /** who put the stone of `move` down */
  by: Player
  children: Node[]
  untried: number[]
  n: number
  w: number
  /** "all moves as first" counts for this move, gathered in sibling simulations */
  an: number
  aw: number
}
const node = (move: number, by: Player, untried: number[]): Node => ({
  move,
  by,
  children: [],
  untried,
  n: 0,
  w: 0,
  an: 0,
  aw: 0,
})

/**
 * Monte Carlo tree search with RAVE: grow a tree of moves, steering into the moves that have won
 * most, and let every random game also count for each move it happened to contain until a move
 * has been tried often enough to speak for itself. The fills are what Easy and Fair use alone;
 * the tree is what lets Hard read a fight several moves deep.
 */
function search(b: Board, p: Player, iterations: number, rand: () => number): number {
  const free: number[] = []
  b.cells.forEach((c, i) => {
    if (!c) free.push(i)
  })
  const root = node(-1, other(p), free.slice())
  const cells = new Uint8Array(b.cells.length)
  const K = 600
  for (let it = 0; it < iterations; it++) {
    for (let i = 0; i < cells.length; i++) cells[i] = b.cells[i]
    let at = root
    let toMove = p
    const path = [root]
    while (!at.untried.length && at.children.length) {
      let best = at.children[0]
      let bv = -Infinity
      const logN = Math.log(at.n + 1)
      for (const c of at.children) {
        const q = c.n ? c.w / c.n : 0.5
        const amaf = c.an ? c.aw / c.an : 0.5
        const beta = Math.sqrt(K / (3 * c.n + K))
        const v = beta * amaf + (1 - beta) * q + 0.25 * Math.sqrt(logN / (c.n + 1))
        if (v > bv) {
          bv = v
          best = c
        }
      }
      at = best
      cells[at.move] = at.by
      toMove = other(toMove)
      path.push(at)
    }
    if (at.untried.length) {
      const k = Math.floor(rand() * at.untried.length)
      const move = at.untried[k]
      at.untried[k] = at.untried[at.untried.length - 1]
      at.untried.pop()
      const fresh = node(
        move,
        toMove,
        free.filter((i) => cells[i] === 0 && i !== move),
      )
      at.children.push(fresh)
      at = fresh
      cells[move] = toMove
      toMove = other(toMove)
      path.push(at)
    }
    // the rest of the board, dealt out at random in turn
    const left: number[] = []
    for (let i = 0; i < cells.length; i++) if (!cells[i]) left.push(i)
    for (let i = left.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1))
      const t = left[i]
      left[i] = left[j]
      left[j] = t
    }
    for (let i = 0; i < left.length; i++) cells[left[i]] = i % 2 === 0 ? toMove : other(toMove)
    const redWon = chain(cells, b.n, 1) !== null
    for (const nd of path) {
      nd.n++
      if ((nd.by === 1) === redWon) nd.w++
      for (const c of nd.children)
        if (cells[c.move] === c.by) {
          c.an++
          if ((c.by === 1) === redWon) c.aw++
        }
    }
  }
  let best = root.children[0]
  for (const c of root.children) if (c.n > best.n) best = c
  return best.move
}

export function choose(
  b: Board,
  p: Player,
  level: Level,
  rand: () => number = Math.random,
): number {
  const free: number[] = []
  b.cells.forEach((c, i) => {
    if (!c) free.push(i)
  })
  if (free.length === 1) return free[0]
  const now = winningMove(b, p)
  if (now !== null) return now
  // stop the other side winning next move, when it can be stopped in one
  const threat = winningMove(b, other(p))
  if (threat !== null && level !== 'easy') return threat

  if (level === 'hard') {
    const saves = bridgeSaves(b, p)
    if (saves.length === 1) return saves[0]
    return search(b, p, PLAYOUTS.hard, rand)
  }
  const wins = new Float64Array(b.cells.length)
  const plays = new Float64Array(b.cells.length)
  const cells = new Uint8Array(b.cells.length)
  const order = free.slice()
  const mine = Math.ceil(free.length / 2)
  for (let k = 0; k < PLAYOUTS[level]; k++) {
    for (let i = 0; i < cells.length; i++) cells[i] = b.cells[i]
    // shuffle the empty cells and deal the first half (rounded up, since p moves next) to p
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1))
      const t = order[i]
      order[i] = order[j]
      order[j] = t
    }
    for (let i = 0; i < order.length; i++) cells[order[i]] = i < mine ? p : other(p)
    const won = chain(cells, b.n, p) !== null
    for (let i = 0; i < mine; i++) {
      plays[order[i]]++
      if (won) wins[order[i]]++
    }
  }
  let best = free[0]
  let bv = -1
  for (const i of free) {
    const v = plays[i] ? wins[i] / plays[i] : 0
    if (v > bv) {
      bv = v
      best = i
    }
  }
  return best
}

/* ---------------------------------------------------------------------------- what is kept */

export const HEX_KEY = 'lab_hex_v1'
export const THEMES = ['classic', 'night', 'paper'] as const
export type Tally = { won: number; lost: number; streak: number; best: number }
export type Saved = {
  level: Level
  size: (typeof SIZES)[number]
  /** you play red (first, top to bottom) or blue */
  side: Player
  swap: boolean
  theme: (typeof THEMES)[number]
  record: Record<Level, Tally>
}
const NONE: Tally = { won: 0, lost: 0, streak: 0, best: 0 }
export const EMPTY: Saved = {
  level: 'fair',
  size: 9,
  side: 1,
  swap: false,
  theme: 'classic',
  record: { easy: NONE, fair: NONE, hard: NONE },
}
export function recordGame(r: Tally, won: boolean): Tally {
  const streak = won ? r.streak + 1 : 0
  return {
    won: r.won + (won ? 1 : 0),
    lost: r.lost + (won ? 0 : 1),
    streak,
    best: Math.max(r.best, streak),
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
      streak: count(x.streak),
      best: count(x.best),
    }
  }
  return {
    level: pick(LEVELS, o.level, EMPTY.level),
    size: pick(SIZES, o.size, EMPTY.size),
    side: o.side === 2 ? 2 : 1,
    swap: typeof o.swap === 'boolean' ? o.swap : EMPTY.swap,
    theme: pick(THEMES, o.theme, EMPTY.theme),
    record,
  }
}
