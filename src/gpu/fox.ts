/**
 * Fox and geese: the old hunt game on a cross of thirty-three points. Thirteen geese against one
 * fox. A goose steps to a neighbouring point — sideways or forward, never back. The fox steps any
 * way, or jumps a goose to the empty point straight beyond it and takes it, and may go on jumping
 * while there are geese to jump. The geese win by hemming the fox in so it cannot move; the fox wins
 * by taking enough geese that they can no longer hope to, or if the geese have no move left.
 *
 * Lines run across and down between all neighbouring points, and diagonally through every other
 * point — those whose row and column add up to an even number — as the board is usually drawn.
 *
 * Pure, so fox.test.ts can play hundreds of games without a page. A point is row * 7 + column.
 */

export type Side = 'geese' | 'fox'
export const N = 7
export const onBoard = (r: number, c: number) =>
  r >= 0 && c >= 0 && r < N && c < N && ((r >= 2 && r <= 4) || (c >= 2 && c <= 4))
export const POINTS: number[] = []
for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (onBoard(r, c)) POINTS.push(r * N + c)

/** the directions a line runs from a point: four always, four more on the even points */
export function dirsAt(i: number): [number, number][] {
  const r = Math.floor(i / N)
  const c = i % N
  const out: [number, number][] = [
    [0, 1],
    [0, -1],
    [1, 0],
    [-1, 0],
  ]
  if ((r + c) % 2 === 0) out.push([1, 1], [1, -1], [-1, 1], [-1, -1])
  return out.filter(([dr, dc]) => onBoard(r + dr, c + dc))
}
const step = (i: number, dr: number, dc: number) => i + dr * N + dc

/**
 * The geese's starting points: the top arm, the row across above the centre, and the two ends of
 * each side of the centre row — seventeen, the version of the game where the geese can win
 */
export const START_GEESE = POINTS.filter(
  (i) => Math.floor(i / N) <= 2 || (Math.floor(i / N) === 3 && (i % N <= 1 || i % N >= 5)),
)
export const START_FOX = 3 * N + 3
/**
 * Geese the fox must take to win. Measured with both sides on Fair (before the geese had a clock),
 * five, six and seven made next to no difference — the geese won seven games in twenty each time —
 * so the middle one: a fox that has taken six has broken any line that could hold it
 */
export const TAKE_TO_WIN = 6
/**
 * Goose moves in a row without one stepping forward before the fox is called the winner: without a
 * limit the geese can hold a line and shuffle along it for ever. Measured with both sides on Fair,
 * eleven games in twenty went to a 240-move draw that way
 */
export const IDLE_LIMIT = 16
/** half-moves before a game is called drawn, as a backstop */
export const MAX_PLIES = 400

export type Game = {
  geese: Set<number>
  fox: number
  turn: Side
  taken: number
  plies: number
  /** goose moves since one last stepped forward */
  idle: number
  winner: Side | null
  /** a draw: the half-move limit reached with neither side through */
  drawn: boolean
  /** the last move, for drawing it: the points passed through */
  last: number[]
}
export const newGame = (): Game => ({
  geese: new Set(START_GEESE),
  fox: START_FOX,
  turn: 'geese',
  taken: 0,
  plies: 0,
  idle: 0,
  winner: null,
  drawn: false,
  last: [],
})
export const over = (g: Game) => g.winner !== null || g.drawn

/** a move: the points a piece passes through, first to last, and any geese it takes */
export type Move = { path: number[]; takes: number[] }

export function gooseMoves(g: Pick<Game, 'geese' | 'fox'>): Move[] {
  const out: Move[] = []
  for (const i of g.geese)
    for (const [dr, dc] of dirsAt(i)) {
      // never back towards the top
      if (dr < 0) continue
      const j = step(i, dr, dc)
      if (!g.geese.has(j) && j !== g.fox) out.push({ path: [i, j], takes: [] })
    }
  return out
}
/**
 * The fox's moves: a step to any empty neighbour, or a run of jumps — over a goose to the empty
 * point straight beyond it along a line, then on from there — stopping after any jump it likes.
 */
export function foxMoves(g: Pick<Game, 'geese' | 'fox'>): Move[] {
  const out: Move[] = []
  for (const [dr, dc] of dirsAt(g.fox)) {
    const j = step(g.fox, dr, dc)
    if (!g.geese.has(j)) out.push({ path: [g.fox, j], takes: [] })
  }
  const jump = (at: number, path: number[], takes: number[]) => {
    for (const [dr, dc] of dirsAt(at)) {
      const over = step(at, dr, dc)
      if (!g.geese.has(over) || takes.includes(over)) continue
      // the far point must lie along the same line from the goose
      if (!dirsAt(over).some(([a, b]) => a === dr && b === dc)) continue
      const land = step(over, dr, dc)
      // geese taken in a run stay on the board until it ends, as in draughts: nothing lands on one
      if (g.geese.has(land)) continue
      const next = { path: [...path, land], takes: [...takes, over] }
      out.push(next)
      jump(land, next.path, next.takes)
    }
  }
  jump(g.fox, [g.fox], [])
  return out
}
export const movesFor = (g: Game) => (g.turn === 'fox' ? foxMoves(g) : gooseMoves(g))

/** make a move, and settle who has won */
export function play(g: Game, m: Move): Game {
  if (over(g)) return g
  const geese = new Set(g.geese)
  let fox = g.fox
  let taken = g.taken
  let idle = g.idle
  if (g.turn === 'geese') {
    geese.delete(m.path[0])
    geese.add(m.path[m.path.length - 1])
    idle = m.path[1] - m.path[0] >= N - 1 ? 0 : idle + 1
  } else {
    fox = m.path[m.path.length - 1]
    for (const t of m.takes) geese.delete(t)
    taken += m.takes.length
  }
  const next: Game = {
    geese,
    fox,
    turn: g.turn === 'fox' ? 'geese' : 'fox',
    taken,
    plies: g.plies + 1,
    idle,
    winner: null,
    drawn: false,
    last: m.path,
  }
  if (taken >= TAKE_TO_WIN || idle >= IDLE_LIMIT) next.winner = 'fox'
  else if (next.turn === 'fox' && !foxMoves(next).length) next.winner = 'geese'
  else if (next.turn === 'geese' && !gooseMoves(next).length) next.winner = 'fox'
  else if (next.plies >= MAX_PLIES) next.drawn = true
  return next
}

/* --------------------------------------------------------------------------- the computer */

export const LEVELS = ['easy', 'fair', 'hard'] as const
export type Level = (typeof LEVELS)[number]
export const DEPTH: Record<Level, number> = { easy: 1, fair: 3, hard: 4 }

/**
 * How the board stands for the geese: each goose still on it, the fox hemmed in, geese the fox could
 * take next turn held against them, and the flock pushed down the board.
 */
export function value(g: Game): number {
  if (g.winner === 'geese') return 1e6
  if (g.winner === 'fox') return -1e6
  if (g.drawn) return 0
  const reach = foxMoves(g)
  const threatened = new Set(reach.flatMap((m) => m.takes)).size
  let down = 0
  for (const i of g.geese) down += Math.floor(i / N)
  return (
    100 * g.geese.size -
    4 * room(g) -
    9 * reach.length -
    25 * threatened +
    2 * down -
    // the clock on the geese, harder the closer it runs
    (g.idle * g.idle * 300) / (IDLE_LIMIT * IDLE_LIMIT)
  )
}

/** the empty points the fox could walk to, jumping nothing: the room the geese are closing */
export function room(g: Pick<Game, 'geese' | 'fox'>): number {
  const seen = new Set([g.fox])
  const todo = [g.fox]
  while (todo.length) {
    const i = todo.pop()!
    for (const [dr, dc] of dirsAt(i)) {
      const j = step(i, dr, dc)
      if (!g.geese.has(j) && !seen.has(j)) {
        seen.add(j)
        todo.push(j)
      }
    }
  }
  return seen.size - 1
}

let looked = 0
const BUDGET = 60_000
function search(g: Game, depth: number, alpha: number, beta: number): number {
  looked++
  if (depth === 0 || over(g) || looked > BUDGET) return value(g)
  const moves = movesFor(g)
  if (g.turn === 'geese') {
    let best = -Infinity
    for (const m of moves) {
      best = Math.max(best, search(play(g, m), depth - 1, alpha, beta))
      alpha = Math.max(alpha, best)
      if (alpha >= beta) break
    }
    return best
  }
  // the fox tries its biggest runs of jumps first: they settle the search soonest
  let best = Infinity
  for (const m of [...moves].sort((a, b) => b.takes.length - a.takes.length)) {
    best = Math.min(best, search(play(g, m), depth - 1, alpha, beta))
    beta = Math.min(beta, best)
    if (alpha >= beta) break
  }
  return best
}

/** the computer's move for the side to play */
export function choose(g: Game, level: Level, rand: () => number = Math.random): Move {
  const moves = movesFor(g)
  const geese = g.turn === 'geese'
  // a move that wins on the spot, at every level: Easy's now-and-then is no reason to miss it
  const win = moves.find((m) => play(g, m).winner === g.turn)
  if (win) return win
  looked = 0
  const scored = moves.map((m) => ({
    m,
    v: (geese ? 1 : -1) * search(play(g, m), DEPTH[level] - 1, -Infinity, Infinity),
  }))
  scored.sort((a, b) => b.v - a.v)
  if (level === 'easy') {
    // one of its few best by a look one move deep, and now and then not the best of them
    const top = scored.slice(0, 3)
    return top[Math.floor(rand() * top.length)].m
  }
  const best = scored.filter((x) => x.v === scored[0].v)
  return best[Math.floor(rand() * best.length)].m
}
export function match(geese: Level, fox: Level, rand: () => number) {
  let g = newGame()
  while (!over(g)) g = play(g, choose(g, g.turn === 'geese' ? geese : fox, rand))
  return g
}

/* --------------------------------------------------------------------------- what is kept */

export const FOX_KEY = 'lab_fox_v1'
export const LOOKS = ['meadow', 'snow', 'dusk'] as const
export type Tally = { won: number; lost: number; drawn: number }
export type Saved = {
  level: Level
  /** which side you play against the computer */
  side: Side
  look: (typeof LOOKS)[number]
  /** show where the selected piece can go */
  guides: boolean
  record: Record<Side, Tally>
}
const NONE: Tally = { won: 0, lost: 0, drawn: 0 }
export const EMPTY: Saved = {
  level: 'fair',
  side: 'geese',
  look: 'meadow',
  guides: true,
  record: { geese: NONE, fox: NONE },
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
  const tally = (x: unknown): Tally => {
    const t = (typeof x === 'object' && x ? x : {}) as Record<string, unknown>
    return { won: whole(t.won), lost: whole(t.lost), drawn: whole(t.drawn) }
  }
  return {
    level: pick(LEVELS, o.level, EMPTY.level),
    side: pick(['geese', 'fox'] as const, o.side, EMPTY.side),
    look: pick(LOOKS, o.look, EMPTY.look),
    guides: typeof o.guides === 'boolean' ? o.guides : EMPTY.guides,
    record: { geese: tally(rec.geese), fox: tally(rec.fox) },
  }
}
