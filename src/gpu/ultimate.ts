/**
 * Ultimate noughts and crosses: nine small boards in a big one. Win a small board with three in a
 * row and it is yours; win three small boards in a row and the game is yours. The catch: the
 * square you play in sends your opponent to the matching small board — play the top-right square
 * of any board and they must play next in the top-right board. Sent to a board that is already
 * won or full, they may play anywhere. Pure, so ultimate.test.ts can play whole games between
 * computers without a page; UltimateDemo draws the boards.
 *
 * The 81 squares are numbered board × 9 + square, both counted across then down.
 */

export type Mark = 0 | 1 | 2
export type Who = 1 | 2
export type Game = {
  cells: Mark[]
  /** who has won each small board: 0 nobody yet, 1 or 2, or 3 for a full board nobody won */
  boards: (0 | 1 | 2 | 3)[]
  /** the board the next move must be in, or -1 for any */
  next: number
  turn: Who
  winner: 0 | 1 | 2 | 3
  last: number
}
export const other = (w: Who): Who => (w === 1 ? 2 : 1)
export const LINES = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
] as const

export const newGame = (): Game => ({
  cells: Array<Mark>(81).fill(0),
  boards: Array(9).fill(0),
  next: -1,
  turn: 1,
  winner: 0,
  last: -1,
})

function lineOf(get: (i: number) => number, who: number) {
  return LINES.some(([a, b, c]) => get(a) === who && get(b) === who && get(c) === who)
}

export function moves(g: Game): number[] {
  if (g.winner) return []
  const out: number[] = []
  for (let b = 0; b < 9; b++) {
    if (g.boards[b] || (g.next >= 0 && g.next !== b)) continue
    for (let s = 0; s < 9; s++) if (!g.cells[b * 9 + s]) out.push(b * 9 + s)
  }
  return out
}

/** play a square; returns a new game */
export function play(g: Game, at: number): Game {
  const b = Math.floor(at / 9)
  const s = at % 9
  if (g.winner || g.cells[at] || g.boards[b] || (g.next >= 0 && g.next !== b))
    throw new Error(`${at} is not a move now`)
  const cells = g.cells.slice()
  cells[at] = g.turn
  const boards = g.boards.slice()
  if (lineOf((k) => cells[b * 9 + k], g.turn)) boards[b] = g.turn
  else if ([...Array(9).keys()].every((k) => cells[b * 9 + k])) boards[b] = 3
  let winner: Game['winner'] = 0
  if (lineOf((k) => boards[k], g.turn)) winner = g.turn
  else if (boards.every((x) => x)) winner = 3
  return { cells, boards, next: boards[s] ? -1 : s, turn: other(g.turn), winner, last: at }
}

/* ---------------------------------------------------------------------------- the computer */

export const LEVELS = ['easy', 'fair', 'hard'] as const
export type Level = (typeof LEVELS)[number]
/** measured over ten games from both seats: fair beat easy 10–0; hard at 12,000 beat fair 9–0 with
 * its slowest move at 593 ms, where 8,000 only managed 5–1 with four draws */
export const ITERATIONS: Record<Level, number> = { easy: 0, fair: 1500, hard: 12000 }

function randomFinish(g: Game, rand: () => number): Game['winner'] {
  let h = g
  while (!h.winner) {
    const list = moves(h)
    h = play(h, list[Math.floor(rand() * list.length)])
  }
  return h.winner
}

type Node = { move: number; who: Who; kids: Node[]; untried: number[]; n: number; w: number }

/**
 * Monte Carlo tree search: play thousands of random games from here, steering more and more of
 * them into the moves that keep winning. A draw counts half. Easy does no searching at all: it
 * takes a small board when it can, and otherwise plays anywhere.
 */
export function choose(g: Game, level: Level, rand: () => number = Math.random): number {
  const list = moves(g)
  if (list.length === 1) return list[0]
  // win the game, or a small board, when one move does it
  for (const m of list) if (play(g, m).winner === g.turn) return m
  if (level === 'easy') {
    const take = list.filter((m) => play(g, m).boards[Math.floor(m / 9)] === g.turn)
    const pool = take.length && rand() < 0.7 ? take : list
    return pool[Math.floor(rand() * pool.length)]
  }
  const root: Node = { move: -1, who: other(g.turn), kids: [], untried: list.slice(), n: 0, w: 0 }
  for (let it = 0; it < ITERATIONS[level]; it++) {
    let node = root
    let state = g
    const path = [root]
    while (!node.untried.length && node.kids.length) {
      const logN = Math.log(node.n)
      let best = node.kids[0]
      let bv = -Infinity
      for (const k of node.kids) {
        const v = k.w / k.n + 1.2 * Math.sqrt(logN / k.n)
        if (v > bv) {
          bv = v
          best = k
        }
      }
      node = best
      state = play(state, node.move)
      path.push(node)
    }
    if (node.untried.length) {
      const i = Math.floor(rand() * node.untried.length)
      const m = node.untried[i]
      node.untried[i] = node.untried[node.untried.length - 1]
      node.untried.pop()
      const who = state.turn
      state = play(state, m)
      const kid: Node = { move: m, who, kids: [], untried: moves(state), n: 0, w: 0 }
      node.kids.push(kid)
      node = kid
      path.push(node)
    }
    const result = state.winner || randomFinish(state, rand)
    for (const nd of path) {
      nd.n++
      nd.w += result === 3 ? 0.5 : result === nd.who ? 1 : 0
    }
  }
  let best = root.kids[0]
  for (const k of root.kids) if (k.n > best.n) best = k
  return best.move
}

/* ---------------------------------------------------------------------------- what is kept */

export const ULTIMATE_KEY = 'lab_ultimate_v1'
export const MARK_SETS = {
  classic: ['✕', '◯'],
  shapes: ['▲', '■'],
  animals: ['🐱', '🐶'],
  space: ['🚀', '🪐'],
} as const
export type MarkSet = keyof typeof MARK_SETS
export const THEMES = ['paper', 'chalk', 'neon'] as const
export type Tally = { won: number; lost: number; drawn: number }
export type Saved = {
  level: Level
  marks: MarkSet
  theme: (typeof THEMES)[number]
  /** light up the boards the next move may go in */
  guide: boolean
  record: Record<Level, Tally>
}
const NONE: Tally = { won: 0, lost: 0, drawn: 0 }
export const EMPTY: Saved = {
  level: 'fair',
  marks: 'classic',
  theme: 'paper',
  guide: true,
  record: { easy: NONE, fair: NONE, hard: NONE },
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
    record[l] = { won: count(x.won), lost: count(x.lost), drawn: count(x.drawn) }
  }
  return {
    level: pick(LEVELS, o.level, EMPTY.level),
    marks: pick(Object.keys(MARK_SETS) as MarkSet[], o.marks, EMPTY.marks),
    theme: pick(THEMES, o.theme, EMPTY.theme),
    guide: typeof o.guide === 'boolean' ? o.guide : EMPTY.guide,
    record,
  }
}
