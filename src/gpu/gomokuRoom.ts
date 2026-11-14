import { LEVELS, SIZES, choose, newGame, place, type Game, type Level } from './gomoku'
import type { Rules } from '../lab/social/room'

/**
 * Five in a row as a room game (src/lab/social/room.ts). Seat 0 plays black and moves first,
 * seat 1 white; together, the two seats play black between them and the computer plays white,
 * with gomoku.ts's own `choose`.
 *
 * The game travels as its moves and is replayed through gomoku.ts's own `place`, so a board
 * nobody could have reached — a stone on a stone, stones after a five, a size the toy does not
 * offer — cannot be sent at all.
 */
export function gomokuRules(size: number): Rules<Game, number> {
  return {
    fresh: () => newGame(size),
    turn: (g) => (g.over ? null : g.turn === 1 ? 0 : 1),
    legal: (g, i, by) =>
      !g.over &&
      (by === undefined || by === g.turn - 1) &&
      Number.isInteger(i) &&
      i >= 0 &&
      i < g.n * g.n &&
      !g.cells[i],
    apply: (g, i) => place(g, i),
    encode: (g) => ({ n: g.n, moves: g.moves }),
    decode: (x) => {
      const o = x as { n?: unknown; moves?: unknown } | null
      if (!o || !(SIZES as readonly unknown[]).includes(o.n)) return null
      const n = o.n as number
      if (!Array.isArray(o.moves) || o.moves.length > n * n) return null
      let g = newGame(n)
      for (const i of o.moves) {
        if (g.over || !Number.isInteger(i) || i < 0 || i >= n * n || g.cells[i]) return null
        g = place(g, i)
      }
      return g
    },
    readMove: (x) =>
      Number.isInteger(x) && (x as number) >= 0 && (x as number) < 169 ? (x as number) : null,
    modes: ['versus', 'together'],
    computer: { side: 1, levels: LEVELS, choose: (g, level) => choose(g, level as Level) },
    result: (g) => (!g.over ? null : g.winner ? (g.winner === 1 ? 0 : 1) : 'draw'),
    begun: (g) => g.moves.length > 0,
  }
}
