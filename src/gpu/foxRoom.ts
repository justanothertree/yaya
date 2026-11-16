import {
  LEVELS,
  MAX_PLIES,
  N,
  choose,
  movesFor,
  newGame,
  over,
  play,
  type Game,
  type Level,
  type Move,
} from './fox'
import type { Rules } from '../lab/social/room'

/**
 * Fox and geese as a room game (src/lab/social/room.ts). The game is lopsided, so the seats are
 * the sides: seat 0 is the geese, who move first, and seat 1 the fox. Choosing a seat is choosing
 * a side, which is what the plan asks for. Together, the two seats herd the geese between them and
 * the computer is the fox, with fox.ts's own `choose`.
 *
 * A move is the points a piece passes through, first to last: one step, or the fox's run of jumps.
 * Which geese it takes is the board's business: the room looks the path up among fox.ts's own
 * moves and plays the toy's version, so a goose stepping backwards, a fox jumping off a line, or a
 * take that is not there cannot be sent. The game travels as those paths, replayed through
 * fox.ts's own `play`, which already ends a game at MAX_PLIES.
 */
export type FoxGame = { g: Game; list: number[][] }

const fresh = (): FoxGame => ({ g: newGame(), list: [] })
const same = (a: readonly number[], b: readonly unknown[]) =>
  a.length === b.length && a.every((x, i) => x === b[i])
const find = (g: Game, path: readonly unknown[]) =>
  over(g) ? null : (movesFor(g).find((m) => same(m.path, path)) ?? null)
const seatOf = (g: Game) => (g.turn === 'geese' ? 0 : 1)

/** the game these paths make, or null at the first that is not a move where it stands */
export function replay(list: readonly unknown[]): FoxGame | null {
  if (list.length > MAX_PLIES) return null
  let d = fresh()
  for (const path of list) {
    const m = Array.isArray(path) ? find(d.g, path) : null
    if (!m) return null
    d = { g: play(d.g, m), list: [...d.list, m.path] }
  }
  return d
}

/** a move from the wire or the room: a path of points, as a list or as a move */
function readMove(x: unknown): Move | null {
  const path = Array.isArray(x) ? x : (x as Partial<Move> | null)?.path
  if (!Array.isArray(path) || path.length < 2 || path.length > 12) return null
  if (!path.every((i) => Number.isInteger(i) && i >= 0 && i < N * N)) return null
  return { path: path as number[], takes: [] }
}

export const foxRules: Rules<FoxGame, Move> = {
  fresh,
  turn: (d) => (over(d.g) ? null : seatOf(d.g)),
  legal: (d, m, by) => (by === undefined || by === seatOf(d.g)) && find(d.g, m.path) !== null,
  apply: (d, m) => {
    const real = find(d.g, m.path)
    return real ? { g: play(d.g, real), list: [...d.list, real.path] } : d
  },
  encode: (d) => ({ moves: d.list }),
  decode: (x) => {
    const list = (x as { moves?: unknown } | null)?.moves
    return Array.isArray(list) ? replay(list) : null
  },
  readMove,
  modes: ['versus', 'together'],
  computer: { side: 1, levels: LEVELS, choose: (d, level) => choose(d.g, level as Level) },
  result: (d) => (!over(d.g) ? null : d.g.drawn ? 'draw' : d.g.winner === 'geese' ? 0 : 1),
  begun: (d) => d.list.length > 0,
}
