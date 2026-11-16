import { LEVELS, N, PASS, choose, newGame, play, winner, type Game, type Level } from './goboard'
import type { Rules } from '../lab/social/room'

/**
 * Go 9×9 as a room game (src/lab/social/room.ts). Seat 0 plays black and moves first, seat 1
 * white with komi; together, the two seats play black between them and the computer plays white,
 * with goboard.ts's own `choose`.
 *
 * A move is a point, 0 to 80, or PASS. The game travels as its moves, replayed through
 * goboard.ts's own `play`, which refuses an occupied point, the ko and suicide, so none of those
 * can be sent. Two passes in a row end it, scored by area with komi, and there are no draws.
 *
 * ⚠️ A ROOM GAME ALSO ENDS AT MAX_MOVES, scored as it stands, which the toy against the computer
 * never needs: a game on the wire must be bounded, and two people can keep taking a ko-free pair
 * back and forth. No real 9×9 game comes near it.
 */
export type GoGame = { g: Game; list: number[] }

export const MAX_MOVES = 400

const fresh = (): GoGame => ({ g: newGame(), list: [] })
const over = (d: GoGame) => d.g.over || d.list.length >= MAX_MOVES

/** the game these moves make, or null at the first that is not a move where it stands */
export function replay(list: readonly unknown[]): GoGame | null {
  if (list.length > MAX_MOVES) return null
  let d = fresh()
  for (const at of list) {
    if (over(d) || !Number.isInteger(at) || (at as number) < PASS || (at as number) >= N * N)
      return null
    const g = play(d.g, at as number)
    if (!g) return null
    d = { g, list: [...d.list, at as number] }
  }
  return d
}

export const goRules: Rules<GoGame, number> = {
  fresh,
  turn: (d) => (over(d) ? null : d.g.turn === 1 ? 0 : 1),
  legal: (d, at, by) =>
    !over(d) &&
    (by === undefined || by === d.g.turn - 1) &&
    Number.isInteger(at) &&
    at >= PASS &&
    at < N * N &&
    play(d.g, at) !== null,
  apply: (d, at) => {
    const g = play(d.g, at)
    return g ? { g, list: [...d.list, at] } : d
  },
  encode: (d) => ({ moves: d.list }),
  decode: (x) => {
    const list = (x as { moves?: unknown } | null)?.moves
    return Array.isArray(list) ? replay(list) : null
  },
  readMove: (x) =>
    Number.isInteger(x) && (x as number) >= PASS && (x as number) < N * N ? (x as number) : null,
  modes: ['versus', 'together'],
  computer: { side: 1, levels: LEVELS, choose: (d, level) => choose(d.g, level as Level) },
  result: (d) => (!over(d) ? null : winner(d.g) === 1 ? 0 : 1),
  begun: (d) => d.list.length > 0,
}
