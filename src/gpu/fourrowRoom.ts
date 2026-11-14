import {
  SIZES,
  drop,
  full,
  lineAt,
  newGrid,
  other,
  type Disc,
  type Grid,
  type Size,
  type Who,
} from './fourrow'
import type { Rules, Seat } from '../lab/social/room'

/**
 * Four in a row as a room game (src/lab/social/room.ts): seat 0 plays the first colour and moves
 * first, seat 1 the second. Every rule is fourrow.ts's own — `drop` and `lineAt` — so a game in a
 * call is the same game as one against the computer.
 *
 * ⚠️ decode REFUSES A BOARD THAT COULD NOT HAVE BEEN PLAYED. It comes from somebody else's client,
 * and the toy draws it: a size the toy does not offer, a disc floating over a gap, one colour two
 * ahead of the other, a "winning line" that is not the winner's discs. Each is a board no game
 * reaches, so none is believed.
 */
export type FourGame = {
  g: Grid
  /** whose turn, or null once the game is over */
  turn: Who | null
  /** 0 while playing or for a draw */
  winner: Disc
  line: number[] | null
  moves: number
}

export function fourRowRules(size: Size, need: number): Rules<FourGame, number> {
  return {
    fresh: () => ({ g: newGrid(size, need), turn: 1, winner: 0, line: null, moves: 0 }),
    turn: (s) => (s.turn === null ? null : ((s.turn - 1) as Seat)),
    legal: (s, col) =>
      s.turn !== null &&
      Number.isInteger(col) &&
      col >= 0 &&
      col < s.g.cols &&
      s.g.heights[col] < s.g.rows,
    apply: (s, col) => {
      const who = s.turn!
      const g = drop(s.g, col, who)
      const line = lineAt(g, col)
      const moves = s.moves + 1
      if (line) return { g, turn: null, winner: who, line, moves }
      if (full(g)) return { g, turn: null, winner: 0, line: null, moves }
      return { g, turn: other(who), winner: 0, line: null, moves }
    },
    encode: (s) => ({
      cols: s.g.cols,
      rows: s.g.rows,
      need: s.g.need,
      cells: s.g.cells,
      heights: s.g.heights,
      turn: s.turn ?? 0,
      winner: s.winner,
      line: s.line,
      moves: s.moves,
    }),
    decode: readFourGame,
    readMove: (x) =>
      Number.isInteger(x) && (x as number) >= 0 && (x as number) < 9 ? (x as number) : null,
  }
}

const ints = (v: unknown, n: number, lo: number, hi: number): number[] | null =>
  Array.isArray(v) && v.length === n && v.every((x) => Number.isInteger(x) && x >= lo && x <= hi)
    ? (v as number[])
    : null

export function readFourGame(x: unknown): FourGame | null {
  const o = x as Record<string, unknown> | null
  if (!o || typeof o !== 'object') return null
  const { cols, rows, need } = o
  if (!Object.values(SIZES).some(([c, r]) => c === cols && r === rows)) return null
  const C = cols as number
  const R = rows as number
  if ((need !== 4 && need !== 5) || need > Math.min(C, R)) return null
  const cells = ints(o.cells, C * R, 0, 2) as Disc[] | null
  const heights = ints(o.heights, C, 0, R)
  if (!cells || !heights) return null
  // gravity: every column solid from the floor up to its height, empty above
  for (let c = 0; c < C; c++)
    for (let r = 0; r < R; r++) if ((cells[r * C + c] !== 0) !== r < heights[c]) return null
  const n1 = cells.filter((d) => d === 1).length
  const n2 = cells.filter((d) => d === 2).length
  if (n1 - n2 !== 0 && n1 - n2 !== 1) return null
  if (o.moves !== n1 + n2) return null
  const winner = o.winner
  if (winner !== 0 && winner !== 1 && winner !== 2) return null
  const turnRaw = o.turn
  if (turnRaw !== 0 && turnRaw !== 1 && turnRaw !== 2) return null
  const turn: Who | null = turnRaw === 0 ? null : turnRaw
  // whose turn it is follows from the counts; an over game has no turn
  if (turn !== null && (winner !== 0 || turn !== (n1 === n2 ? 1 : 2))) return null
  const line =
    o.line === null ? null : ints(o.line, Array.isArray(o.line) ? o.line.length : -1, 0, C * R - 1)
  if (o.line !== null && !line) return null
  if (winner !== 0) {
    if (turn !== null || !line || line.length < (need as number)) return null
    if (!line.every((i) => cells[i] === winner)) return null
  } else if (line !== null || (turn === null && n1 + n2 !== C * R)) return null
  return {
    g: { cols: C, rows: R, need: need as number, cells, heights },
    turn,
    winner,
    line,
    moves: n1 + n2,
  }
}
