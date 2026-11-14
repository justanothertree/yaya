import { LEVELS, choose, moves, newGame, play, type Game, type Level, type Move } from './draughts'
import type { Rules } from '../lab/social/room'

/**
 * Draughts as a room game (src/lab/social/room.ts). Seat 0 plays from the bottom and moves first,
 * seat 1 from the top; together, the two seats play the bottom side between them and the computer
 * plays the top, with draughts.ts's own `choose`.
 *
 * A move is the squares its piece visits — one step, or every landing of a multi-jump — and the
 * game travels as those paths, replayed through draughts.ts's own `moves` and `play`. So the
 * rules that make draughts what it is travel with it: a take that is there must be taken, a jump
 * goes on while it can, and a path that is not one of the moves where it stands refuses the lot.
 */
export type DraughtsGame = { g: Game; list: number[][]; last: Move | null }

/** the most moves a game may carry: the draw rule ends any real game long before */
export const MAX_MOVES = 500

const same = (a: number[], b: number[]) => a.length === b.length && a.every((x, i) => x === b[i])
const fresh = (): DraughtsGame => ({ g: newGame(), list: [], last: null })

/** the game these paths make, or null at the first that is not a move where it stands */
export function replay(list: readonly number[][]): DraughtsGame | null {
  let d = fresh()
  for (const path of list) {
    const m = moves(d.g).find((x) => same(x.path, path))
    if (!m) return null
    d = { g: play(d.g, m), list: [...d.list, m.path], last: m }
  }
  return d
}

const isPath = (x: unknown): x is number[] =>
  Array.isArray(x) &&
  x.length >= 2 &&
  x.length <= 10 &&
  x.every((i) => Number.isInteger(i) && i >= 0 && i < 32)

export const draughtsRules: Rules<DraughtsGame, number[]> = {
  fresh,
  turn: (d) => (d.g.winner ? null : d.g.turn === 1 ? 0 : 1),
  legal: (d, path, by) =>
    !d.g.winner &&
    (by === undefined || by === d.g.turn - 1) &&
    d.list.length < MAX_MOVES &&
    moves(d.g).some((m) => same(m.path, path)),
  apply: (d, path) => {
    const m = moves(d.g).find((x) => same(x.path, path))
    return m ? { g: play(d.g, m), list: [...d.list, m.path], last: m } : d
  },
  encode: (d) => ({ moves: d.list }),
  decode: (x) => {
    const list = (x as { moves?: unknown } | null)?.moves
    if (!Array.isArray(list) || list.length > MAX_MOVES || !list.every(isPath)) return null
    return replay(list)
  },
  readMove: (x) => (isPath(x) ? [...x] : null),
  modes: ['versus', 'together'],
  computer: { side: 1, levels: LEVELS, choose: (d, level) => choose(d.g, level as Level).path },
  result: (d) => (!d.g.winner ? null : d.g.winner === 3 ? 'draw' : d.g.winner === 1 ? 0 : 1),
  begun: (d) => d.list.length > 0,
}
