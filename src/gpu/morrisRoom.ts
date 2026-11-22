import { LEVELS, choose, moves, newGame, play, type Game, type Level, type Move } from './morris'
import type { Rules } from '../lab/social/room'

/**
 * Nine men's morris as a room game (src/lab/social/room.ts). Seat 0 plays the first colour and
 * places first, seat 1 the second; together, the two seats play the first colour between them and
 * the computer plays the second, with morris.ts's own `choose`.
 *
 * A move is three numbers: where a man came from (-1 from the hand), where it went, and the man a
 * mill took (-1 for none). The game travels as those moves, replayed through morris.ts's own
 * `moves` and `play`, so every rule that makes the game travels with it: a man moves only along a
 * line until a side is down to three and flies, a mill takes a man that is not in a mill while one
 * is left, and a mill MUST take. A move that is not one of the moves where it stands refuses the lot.
 */
export type MorrisGame = { g: Game; list: Move[]; last: Move | null }

/** the most moves a game may carry: the draw rule ends any real game long before */
export const MAX_MOVES = 1000

const same = (a: Move, b: Move) => a.from === b.from && a.to === b.to && a.take === b.take
const fresh = (): MorrisGame => ({ g: newGame(), list: [], last: null })

/** a move from the wire, or null: three whole numbers on the board, -1 meaning none */
export function readMove(x: unknown): Move | null {
  if (!Array.isArray(x) || x.length !== 3) return null
  const [from, to, take] = x
  const ok = (v: unknown, none: boolean) =>
    Number.isInteger(v) && (v as number) >= (none ? -1 : 0) && (v as number) < 24
  return ok(from, true) && ok(to, false) && ok(take, true) ? { from, to, take } : null
}

/** the game these moves make, or null at the first that is not a move where it stands */
export function replay(list: readonly unknown[]): MorrisGame | null {
  if (list.length > MAX_MOVES) return null
  let d = fresh()
  for (const x of list) {
    const asked = readMove(x)
    const m = asked && moves(d.g).find((y) => same(y, asked))
    if (!m) return null
    d = { g: play(d.g, m), list: [...d.list, m], last: m }
  }
  return d
}

export const morrisRules: Rules<MorrisGame, Move> = {
  fresh,
  turn: (d) => (d.g.winner ? null : d.g.turn === 1 ? 0 : 1),
  legal: (d, m, by) =>
    !d.g.winner &&
    (by === undefined || by === d.g.turn - 1) &&
    d.list.length < MAX_MOVES &&
    moves(d.g).some((x) => same(x, m)),
  apply: (d, m) => {
    const real = moves(d.g).find((x) => same(x, m))
    return real ? { g: play(d.g, real), list: [...d.list, real], last: real } : d
  },
  encode: (d) => ({ moves: d.list.map((m) => [m.from, m.to, m.take]) }),
  decode: (x) => {
    const list = (x as { moves?: unknown } | null)?.moves
    return Array.isArray(list) ? replay(list) : null
  },
  // the wire carries a move as [from, to, take]; a room's own act carries the object
  readMove: (x) =>
    readMove(
      Array.isArray(x)
        ? x
        : x && typeof x === 'object'
          ? [(x as Move).from, (x as Move).to, (x as Move).take]
          : null,
    ),
  modes: ['versus', 'together'],
  computer: { side: 1, levels: LEVELS, choose: (d, level) => choose(d.g, level as Level) },
  result: (d) => (!d.g.winner ? null : d.g.winner === 3 ? 'draw' : d.g.winner === 1 ? 0 : 1),
  begun: (d) => d.list.length > 0,
}
