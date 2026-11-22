import {
  LEVELS,
  START,
  choose,
  fromFen,
  moves,
  outcome,
  play,
  posKey,
  san,
  sqName,
  type Level,
  type Move,
  type Outcome,
  type Pos,
} from './chess'
import type { Rules } from '../lab/social/room'

/**
 * Chess as a room game (src/lab/social/room.ts). Seat 0 plays white, seat 1 black; together, the
 * two seats play white between them and the computer plays black, with chess.ts's own `choose`.
 *
 * ⚠️ THE GAME TRAVELS AS ITS MOVES, AND IS REPLAYED. A position sent whole would have to be
 * checked for being reachable — castling rights, en passant, a king left in check — which is the
 * whole of chess again. A move list replayed from the start through chess.ts's own `moves` and
 * `play` cannot describe an illegal position at all: the first move that is not legal where it
 * stands refuses the lot. A long game is a few hundred moves of five characters.
 *
 * A move is written as its squares, and the piece it promotes to: "e2e4", "e7e8q".
 */
export type ChessTurn = { pos: Pos; move: Move | null; name: string }
export type ChessGame = { list: string[]; turns: ChessTurn[]; over: Outcome }

/** the most moves a game may carry: far past any real game, short of a flood */
export const MAX_MOVES = 600

export const uci = (m: Move) => `${sqName(m.from)}${sqName(m.to)}${m.promo.toLowerCase()}`

/** the game after these moves from the start, or null at the first one not legal where it stands */
export function replay(list: readonly string[]): ChessGame | null {
  const turns: ChessTurn[] = [{ pos: fromFen(START), move: null, name: '' }]
  let over: Outcome = null
  for (const code of list) {
    if (over) return null
    const p = turns[turns.length - 1].pos
    const m = moves(p).find((x) => uci(x) === code)
    if (!m) return null
    const next = play(p, m)
    turns.push({ pos: next, move: m, name: san(p, m) })
    over = outcome(
      next,
      turns.map((t) => posKey(t.pos)),
    )
  }
  return { list: [...list], turns, over }
}

const posOf = (g: ChessGame) => g.turns[g.turns.length - 1].pos
const history = (g: ChessGame) => g.turns.map((t) => posKey(t.pos))

export const chessRules: Rules<ChessGame, string> = {
  fresh: () => replay([])!,
  turn: (g) => (g.over ? null : posOf(g).turn === 'w' ? 0 : 1),
  legal: (g, code, by) =>
    !g.over &&
    (by === undefined || (by === 0 ? 'w' : 'b') === posOf(g).turn) &&
    g.list.length < MAX_MOVES &&
    moves(posOf(g)).some((m) => uci(m) === code),
  apply: (g, code) => replay([...g.list, code]) ?? g,
  encode: (g) => ({ moves: g.list }),
  decode: (x) => {
    const list = (x as { moves?: unknown } | null)?.moves
    if (!Array.isArray(list) || list.length > MAX_MOVES) return null
    if (!list.every((c) => typeof c === 'string' && /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(c)))
      return null
    return replay(list as string[])
  },
  readMove: (x) => (typeof x === 'string' && /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(x) ? x : null),
  modes: ['versus', 'together'],
  computer: {
    side: 1,
    levels: LEVELS,
    choose: (g, level) => uci(choose(posOf(g), level as Level, Math.random, history(g))),
  },
  result: (g) => (!g.over ? null : g.over.winner === null ? 'draw' : g.over.winner === 'w' ? 0 : 1),
  begun: (g) => g.list.length > 0,
}
