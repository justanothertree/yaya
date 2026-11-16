import {
  DRAW_AFTER,
  HOLES,
  LEVELS,
  choose,
  moves,
  newGame,
  play,
  type Game,
  type Level,
  type Move,
} from './halma'
import type { Rules } from '../lab/social/room'

/**
 * Chinese checkers as a room game (src/lab/social/room.ts), two points of the star as the toy
 * plays it. Seat 0 races from the near point and moves first, seat 1 from the far one; together,
 * the two seats share the near point and the computer races from the far one, with halma.ts's own
 * `choose`.
 *
 * A move is a peg and where it lands, [from, to]: whether that is a step or a chain of hops, and
 * which chain, is the board's business. The room looks it up among halma.ts's own `moves` and
 * plays the toy's version, so a landing no step or hop reaches cannot be sent at all.
 *
 * ⚠️ AND A ROOM GAME ENDS AT DRAW_AFTER PLIES AS A DRAW, which the toy against the computer never
 * needs: its winning rule (every goal hole filled, one at least by your own pegs) already stops a
 * side being blocked for ever. Two people can still wander, and a game on the wire must be bounded.
 */
export type HalmaGame = { g: Game; list: [number, number][]; last: Move | null }

const fresh = (): HalmaGame => ({ g: newGame(1), list: [], last: null })
const over = (d: HalmaGame) => d.g.winner !== 0 || d.list.length >= DRAW_AFTER
const find = (g: Game, from: unknown, to: unknown) =>
  moves(g).find((m) => m.from === from && m.to === to) ?? null
const after = (d: HalmaGame, m: Move): HalmaGame => ({
  g: play(d.g, m),
  list: [...d.list, [m.from, m.to]],
  last: m,
})

/** the game these moves make, or null at the first that is not a move where it stands */
export function replay(list: readonly unknown[]): HalmaGame | null {
  if (list.length > DRAW_AFTER) return null
  let d = fresh()
  for (const x of list) {
    const m = Array.isArray(x) && x.length === 2 && !over(d) ? find(d.g, x[0], x[1]) : null
    if (!m) return null
    d = after(d, m)
  }
  return d
}

/** a move from the wire or the room: a peg's hole and its landing, as a pair or as a move */
function readMove(x: unknown): Move | null {
  const o = x as Partial<Move> | unknown[] | null
  const [from, to] = Array.isArray(o) ? o : o && typeof o === 'object' ? [o.from, o.to] : []
  const ok = (v: unknown) =>
    Number.isInteger(v) && (v as number) >= 0 && (v as number) < HOLES.length
  return ok(from) && ok(to) ? { from: from as number, to: to as number, path: [] } : null
}

export const halmaRules: Rules<HalmaGame, Move> = {
  fresh,
  turn: (d) => (over(d) ? null : d.g.turn === 1 ? 0 : 1),
  legal: (d, m, by) =>
    !over(d) && (by === undefined || by === d.g.turn - 1) && find(d.g, m.from, m.to) !== null,
  apply: (d, m) => {
    const real = find(d.g, m.from, m.to)
    return real ? after(d, real) : d
  },
  encode: (d) => ({ moves: d.list }),
  decode: (x) => {
    const list = (x as { moves?: unknown } | null)?.moves
    return Array.isArray(list) ? replay(list) : null
  },
  readMove,
  modes: ['versus', 'together'],
  computer: { side: 1, levels: LEVELS, choose: (d, level) => choose(d.g, level as Level) },
  result: (d) => (!over(d) ? null : d.g.winner === 0 ? 'draw' : d.g.winner === 1 ? 0 : 1),
  begun: (d) => d.list.length > 0,
}
