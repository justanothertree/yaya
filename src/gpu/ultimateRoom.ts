import { LEVELS, choose, moves, newGame, play, type Game, type Level } from './ultimate'
import type { Rules } from '../lab/social/room'

/**
 * Ultimate noughts as a room game (src/lab/social/room.ts). Seat 0 plays the first mark and moves
 * first, seat 1 the second; together, the two seats play the first mark between them and the
 * computer plays the second, with ultimate.ts's own `choose`.
 *
 * A move is a square, 0 to 80, nine to a small board. The game travels as its squares, replayed
 * through ultimate.ts's own `moves` and `play`, so the rule that makes the game — your square sends
 * the other player to the matching small board — travels with it, and a square that is not a move
 * where it stands refuses the lot.
 */
export type UltimateGame = { g: Game; list: number[] }

const fresh = (): UltimateGame => ({ g: newGame(), list: [] })

/** the game these squares make, or null at the first that is not a move where it stands */
export function replay(list: readonly unknown[]): UltimateGame | null {
  if (list.length > 81) return null
  let d = fresh()
  for (const at of list) {
    if (!Number.isInteger(at) || !moves(d.g).includes(at as number)) return null
    d = { g: play(d.g, at as number), list: [...d.list, at as number] }
  }
  return d
}

export const ultimateRules: Rules<UltimateGame, number> = {
  fresh,
  turn: (d) => (d.g.winner ? null : d.g.turn === 1 ? 0 : 1),
  legal: (d, at, by) =>
    !d.g.winner &&
    (by === undefined || by === d.g.turn - 1) &&
    Number.isInteger(at) &&
    moves(d.g).includes(at),
  apply: (d, at) => ({ g: play(d.g, at), list: [...d.list, at] }),
  encode: (d) => ({ moves: d.list }),
  decode: (x) => {
    const list = (x as { moves?: unknown } | null)?.moves
    return Array.isArray(list) ? replay(list) : null
  },
  readMove: (x) =>
    Number.isInteger(x) && (x as number) >= 0 && (x as number) < 81 ? (x as number) : null,
  modes: ['versus', 'together'],
  computer: { side: 1, levels: LEVELS, choose: (d, level) => choose(d.g, level as Level) },
  result: (d) => (!d.g.winner ? null : d.g.winner === 3 ? 'draw' : d.g.winner === 1 ? 0 : 1),
  begun: (d) => d.list.length > 0,
}
