import {
  LEVELS,
  SIZES,
  choose,
  fenceOk,
  newGame,
  play,
  steps,
  type Game,
  type Level,
  type Move,
  type Who,
} from './fences'
import type { Rules } from '../lab/social/room'

/**
 * Fences as a room game (src/lab/social/room.ts). Seat 0 starts at the bottom, races to the top
 * and moves first; seat 1 starts at the top. Together, the two seats share the bottom side and the
 * computer races from the top, with fences.ts's own `choose`.
 *
 * A move is a step to a square, or a fence on a crossing. The game travels as its moves, compact on
 * the wire — ['s', row, col] or ['h' | 'v', row, col] — replayed through fences.ts's own `steps`,
 * `fenceOk` and `play` on a board of the size it was started on. So a step through a fence, a fence
 * on a fence, a fence nobody has left, or one that shuts a side in cannot be sent at all.
 */
export type FencesGame = { g: Game; list: Move[]; last: Move | null }

/** far more moves than a race takes; a list longer than this is not a game */
export const MAX_MOVES = 600

const fresh = (n: number): FencesGame => ({ g: newGame(n as 7 | 9, 0), list: [], last: null })

/** whether a move is one where the game stands, for the side whose turn it is */
export function isMove(g: Game, m: Move): boolean {
  if (g.winner !== null) return false
  if (m.kind === 'step') return steps(g).some(([r, c]) => r === m.to[0] && c === m.to[1])
  return fenceOk(g, m.o, m.r, m.c)
}

/** a move as the wire carries it, and back */
export const packMove = (m: Move): [string, number, number] =>
  m.kind === 'step' ? ['s', m.to[0], m.to[1]] : [m.o, m.r, m.c]
export function readMove(x: unknown): Move | null {
  const o = (Array.isArray(x) ? x : x && typeof x === 'object' ? packMove(x as Move) : null) as
    | unknown[]
    | null
  if (!o || o.length !== 3) return null
  const [k, r, c] = o
  if (
    !Number.isInteger(r) ||
    !Number.isInteger(c) ||
    (r as number) < 0 ||
    (c as number) < 0 ||
    (r as number) > 8 ||
    (c as number) > 8
  )
    return null
  if (k === 's') return { kind: 'step', to: [r as number, c as number] }
  if (k === 'h' || k === 'v') return { kind: 'fence', o: k, r: r as number, c: c as number }
  return null
}

/** the game these moves make on this board, or null at the first that is not a move there */
export function replay(n: number, list: readonly unknown[]): FencesGame | null {
  if (list.length > MAX_MOVES) return null
  let d = fresh(n)
  for (const x of list) {
    const m = readMove(x)
    if (!m || !isMove(d.g, m)) return null
    d = { g: play(d.g, m), list: [...d.list, m], last: m }
  }
  return d
}

/** a match's board from its settings: the toy's own sizes, 9 when none is named; null otherwise */
export function readFencesSize(s: Record<string, unknown>): number | null {
  const size = s.size ?? 9
  return (SIZES as readonly unknown[]).includes(size) ? (size as number) : null
}

export function fencesRules(size: number): Rules<FencesGame, Move> {
  return {
    fresh: () => fresh(size),
    turn: (d) => (d.g.winner !== null ? null : d.g.turn),
    legal: (d, m, by) =>
      (by === undefined || by === d.g.turn) && d.list.length < MAX_MOVES && isMove(d.g, m),
    apply: (d, m) => ({ g: play(d.g, m), list: [...d.list, m], last: m }),
    encode: (d) => ({ n: d.g.n, moves: d.list.map(packMove) }),
    decode: (x) => {
      const o = x as { n?: unknown; moves?: unknown } | null
      if (!o || !(SIZES as readonly unknown[]).includes(o.n) || !Array.isArray(o.moves)) return null
      return replay(o.n as number, o.moves)
    },
    readMove,
    modes: ['versus', 'together'],
    computer: { side: 1, levels: LEVELS, choose: (d, level) => choose(d.g, level as Level) },
    result: (d) => (d.g.winner === null ? null : (d.g.winner as Who)),
    begun: (d) => d.list.length > 0,
  }
}
