import {
  LEVELS,
  SIZES,
  choose,
  count,
  moves,
  nextTurn,
  place,
  start,
  type Board,
  type Disc,
  type Who,
} from './reversi'
import type { Rules, Seat } from '../lab/social/room'

/**
 * Reversi as a room game (src/lab/social/room.ts). Seat 0 plays dark and moves first, seat 1
 * light. Together, the two seats play dark between them and the computer plays light, at the
 * level the lobby picked — with reversi.ts's own `choose`, so the call's computer is the toy's.
 * Every rule is reversi.ts's own: `moves`, `place` and `nextTurn`, passes included.
 *
 * ⚠️ decode REFUSES A BOARD THE TOY COULD NOT DRAW OR PLAY ON. It comes from somebody else's
 * client: a size the toy does not offer, fewer than the four starting discs, a turn given to a
 * side with no move, or a game called over while either side could still move.
 */
export type ReversiGame = { b: Board; turn: Who | null }

export const toSeat = (w: Who): Seat => (w === 1 ? 0 : 1)
export const toWho = (s: Seat): Who => (s === 0 ? 1 : 2)

export function reversiRules(size: number): Rules<ReversiGame, number> {
  return {
    fresh: () => ({ b: start(size), turn: 1 }),
    turn: (g) => (g.turn === null ? null : toSeat(g.turn)),
    legal: (g, i, by) =>
      g.turn !== null &&
      (by === undefined || toWho(by) === g.turn) &&
      Number.isInteger(i) &&
      moves(g.b, g.turn).includes(i),
    apply: (g, i) => {
      const b = place(g.b, i, g.turn!)
      return { b, turn: nextTurn(b, g.turn!) }
    },
    encode: (g) => ({ n: g.b.n, cells: g.b.cells, turn: g.turn ?? 0 }),
    decode: readReversiGame,
    readMove: (x) =>
      Number.isInteger(x) && (x as number) >= 0 && (x as number) < 100 ? (x as number) : null,
    modes: ['versus', 'together'],
    computer: {
      side: 1,
      levels: LEVELS,
      choose: (g, level) => choose(g.b, 2, level as (typeof LEVELS)[number]),
    },
    result: (g) => {
      if (g.turn !== null) return null
      const [d, l] = count(g.b)
      return d > l ? 0 : l > d ? 1 : 'draw'
    },
    begun: (g) => {
      const [d, l] = count(g.b)
      return d + l > 4
    },
  }
}

export function readReversiGame(x: unknown): ReversiGame | null {
  const o = x as Record<string, unknown> | null
  if (!o || typeof o !== 'object') return null
  const n = o.n as number
  if (!(SIZES as readonly number[]).includes(n)) return null
  const cells = o.cells
  if (
    !Array.isArray(cells) ||
    cells.length !== n * n ||
    !cells.every((c) => c === 0 || c === 1 || c === 2)
  )
    return null
  const b: Board = { n, cells: cells as Disc[] }
  const [d, l] = count(b)
  if (d + l < 4) return null
  const t = o.turn
  if (t !== 0 && t !== 1 && t !== 2) return null
  if (t === 0) {
    // over: neither side may have a move left
    if (moves(b, 1).length || moves(b, 2).length) return null
    return { b, turn: null }
  }
  if (!moves(b, t).length) return null
  return { b, turn: t }
}
