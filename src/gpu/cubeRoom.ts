import { LEVELS, choose, newGame, place, type Game, type Level } from './cube'
import type { Rules } from '../lab/social/room'

/**
 * Noughts and crosses in a cube as a room game (src/lab/social/room.ts). Seat 0 plays crosses and
 * moves first, seat 1 noughts; together, the two seats play crosses between them and the computer
 * plays noughts, with cube.ts's own `choose`.
 *
 * A move is a cell, 0 to 63, sixteen to a layer. The game travels as its cells, replayed through
 * cube.ts's own `place`, so a cell already taken, a cell off the cube, or a mark after somebody
 * has four in a line cannot be sent at all.
 */
export const cubeRules: Rules<Game, number> = {
  fresh: () => newGame(1),
  turn: (g) => (g.over ? null : g.turn === 1 ? 0 : 1),
  legal: (g, i, by) =>
    !g.over &&
    (by === undefined || by === g.turn - 1) &&
    Number.isInteger(i) &&
    i >= 0 &&
    i < 64 &&
    !g.cells[i],
  apply: (g, i) => place(g, i),
  encode: (g) => ({ moves: g.moves }),
  decode: (x) => {
    const list = (x as { moves?: unknown } | null)?.moves
    if (!Array.isArray(list) || list.length > 64) return null
    let g = newGame(1)
    for (const i of list) {
      if (g.over || !Number.isInteger(i) || i < 0 || i >= 64 || g.cells[i]) return null
      g = place(g, i)
    }
    return g
  },
  readMove: (x) =>
    Number.isInteger(x) && (x as number) >= 0 && (x as number) < 64 ? (x as number) : null,
  modes: ['versus', 'together'],
  computer: { side: 1, levels: LEVELS, choose: (g, level) => choose(g, level as Level) },
  result: (g) => (!g.over ? null : g.winner === 0 ? 'draw' : g.winner === 1 ? 0 : 1),
  begun: (g) => g.moves.length > 0,
}
