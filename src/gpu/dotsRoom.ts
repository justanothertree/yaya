import {
  LEVELS,
  SIZES,
  choose,
  copy,
  lineCount,
  newGame,
  over,
  play,
  type Game,
  type Level,
} from './dots'
import type { Rules } from '../lab/social/room'

/**
 * Dots and boxes as a room game (src/lab/social/room.ts). Seat 0 is the first player and draws
 * first, seat 1 the second; together, the two seats draw for the first player between them and
 * the computer is the second, with dots.ts's own `choose`.
 *
 * Closing a box keeps the turn, as it always does — the room asks dots.ts whose turn it is after
 * every line, so a run of boxes is one player's (or together, the team's) run however long it is.
 *
 * The game travels as its lines, replayed through dots.ts's own `play` on a fresh board of the
 * size sent: a line drawn twice, or a line off the board, refuses the lot.
 */
export type DotsGame = { g: Game; lines: number[] }

const after = (d: DotsGame, l: number): DotsGame => {
  const g = copy(d.g)
  play(g, l)
  return { g, lines: [...d.lines, l] }
}

export function replay(n: number, lines: readonly number[]): DotsGame | null {
  let d: DotsGame = { g: newGame(n, n, 0), lines: [] }
  const total = lineCount(d.g.b)
  for (const l of lines) {
    if (!Number.isInteger(l) || l < 0 || l >= total || d.g.drawn[l]) return null
    d = after(d, l)
  }
  return d
}

export function dotsRules(size: number): Rules<DotsGame, number> {
  return {
    fresh: () => ({ g: newGame(size, size, 0), lines: [] }),
    turn: (d) => (over(d.g) ? null : d.g.turn),
    legal: (d, l, by) =>
      !over(d.g) &&
      (by === undefined || by === d.g.turn) &&
      Number.isInteger(l) &&
      l >= 0 &&
      l < lineCount(d.g.b) &&
      !d.g.drawn[l],
    apply: (d, l) => after(d, l),
    encode: (d) => ({ n: d.g.b.rows, lines: d.lines }),
    decode: (x) => {
      const o = x as { n?: unknown; lines?: unknown } | null
      if (!o || !(SIZES as readonly unknown[]).includes(o.n) || !Array.isArray(o.lines)) return null
      return replay(o.n as number, o.lines as number[])
    },
    readMove: (x) =>
      Number.isInteger(x) && (x as number) >= 0 && (x as number) < 100 ? (x as number) : null,
    modes: ['versus', 'together'],
    computer: { side: 1, levels: LEVELS, choose: (d, level) => choose(copy(d.g), level as Level) },
    result: (d) => {
      if (!over(d.g)) return null
      const [a, b] = d.g.score
      return a > b ? 0 : b > a ? 1 : 'draw'
    },
    begun: (d) => d.lines.length > 0,
  }
}
