import {
  LEVELS,
  SIZES,
  choose,
  moves,
  newGame,
  play,
  type Game,
  type Level,
  type Move,
} from './breakthrough'
import type { Rules } from '../lab/social/room'

/**
 * Breakthrough as a room game (src/lab/social/room.ts). Seat 0 plays the near side, moving up the
 * board and first; seat 1 the far side; together, the two seats play the near side between them
 * and the computer plays the far one, with breakthrough.ts's own `choose`.
 *
 * A move is two squares, from and to; whether it takes is the board's business, not the sender's.
 * The game travels as those pairs, replayed through breakthrough.ts's own `moves` and `play` on a
 * board of the size it was started on, so a piece that moves backwards, sideways into a piece, or
 * straight ahead onto one cannot be sent at all.
 */
export type BreakthroughGame = { g: Game; list: [number, number][]; last: Move | null }

const fresh = (n: number): BreakthroughGame => ({ g: newGame(n, 1), list: [], last: null })

const find = (g: Game, from: unknown, to: unknown) =>
  moves(g).find((m) => m.from === from && m.to === to) ?? null

function after(d: BreakthroughGame, m: Move): BreakthroughGame {
  return { g: play(d.g, m), list: [...d.list, [m.from, m.to]], last: m }
}

/** the game these moves make on this board, or null at the first that is not a move there */
export function replay(n: number, list: readonly unknown[]): BreakthroughGame | null {
  if (list.length > n * n * n) return null
  let d = fresh(n)
  for (const x of list) {
    const m = Array.isArray(x) && x.length === 2 ? find(d.g, x[0], x[1]) : null
    if (!m) return null
    d = after(d, m)
  }
  return d
}

/** a move from the wire or the room: two whole squares, as a pair or as a move */
function readMove(x: unknown): Move | null {
  const o = x as Partial<Move> | [unknown, unknown] | null
  const [from, to] = Array.isArray(o) ? o : o && typeof o === 'object' ? [o.from, o.to] : []
  return Number.isInteger(from) &&
    Number.isInteger(to) &&
    (from as number) >= 0 &&
    (to as number) >= 0 &&
    (from as number) < 64 &&
    (to as number) < 64
    ? { from: from as number, to: to as number, take: false }
    : null
}

/** a match's board from its settings: the toy's own sizes, 8 when none is named; null otherwise */
export function readBreakthroughSize(s: Record<string, unknown>): number | null {
  const size = s.size ?? 8
  return (SIZES as readonly unknown[]).includes(size) ? (size as number) : null
}

export function breakthroughRules(size: number): Rules<BreakthroughGame, Move> {
  return {
    fresh: () => fresh(size),
    turn: (d) => (d.g.winner ? null : d.g.turn === 1 ? 0 : 1),
    legal: (d, m, by) =>
      !d.g.winner && (by === undefined || by === d.g.turn - 1) && find(d.g, m.from, m.to) !== null,
    apply: (d, m) => {
      const real = find(d.g, m.from, m.to)
      return real ? after(d, real) : d
    },
    encode: (d) => ({ n: d.g.board.n, moves: d.list }),
    decode: (x) => {
      const o = x as { n?: unknown; moves?: unknown } | null
      if (!o || !(SIZES as readonly unknown[]).includes(o.n) || !Array.isArray(o.moves)) return null
      return replay(o.n as number, o.moves)
    },
    readMove,
    modes: ['versus', 'together'],
    computer: { side: 1, levels: LEVELS, choose: (d, level) => choose(d.g, level as Level) },
    result: (d) => (!d.g.winner ? null : d.g.winner === 1 ? 0 : 1),
    begun: (d) => d.list.length > 0,
  }
}
