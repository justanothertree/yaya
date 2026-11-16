import { PATTERNS, SIZES, dark, make, press, seedFor, type Pattern } from './lamps'
import type { Rules, Seat } from '../lab/social/room'

/**
 * Lamps as a room game (src/lab/social/room.ts), on the day's board at the host's size.
 *
 * TOGETHER is one board that either seat presses at any time. Presses commute — each switches
 * the same lamps whatever came before — so two people pressing at once never conflict: the board
 * ends the same in whatever order the host hears them, and the room's 'any' turn takes a press
 * made against an older board. VERSUS is a race: each seat its own copy of the same board, and
 * the first to switch theirs off wins.
 *
 * ⚠️ A BOARD TRAVELS AS ITS PRESSES, AND IS REPLAYED from the day's board through lamps.ts's own
 * `make` and `press`. No undo in a call: pressing a lamp again is its undo. A list that goes dark
 * before its last press, or a race where both boards are dark, is a game nobody played, and is
 * refused.
 */
export type LampsGame = {
  day: number
  size: number
  pattern: Pattern
  /** each board's presses: one board together, one per seat in a race */
  boards: number[][]
  /** each board's lamps now */
  lit: boolean[][]
  /** the board that went dark first, or null while everyone is still pressing */
  winner: Seat | null
}

/** the most presses a board may carry: far past par on any size */
export const MAX_PRESSES = 400

const starts = new Map<string, boolean[]>()
/** the day's board, made once per day, size and pattern */
export function startOf(day: number, size: number, pattern: Pattern): boolean[] {
  const k = `${day}|${size}|${pattern}`
  let b = starts.get(k)
  if (!b) {
    b = make(size, pattern, seedFor(day, size, pattern))
    starts.set(k, b)
  }
  return b
}

/** a board's lamps after these presses, or null if it went dark before the last one */
function litAfter(start: boolean[], n: number, pattern: Pattern, list: readonly number[]) {
  let lit = start
  for (const i of list) {
    if (dark(lit)) return null
    lit = press(lit, n, i, pattern)
  }
  return lit
}

/** the game these presses make, or null if no game could have made them */
export function lampsGame(
  day: number,
  size: number,
  pattern: Pattern,
  boards: number[][],
): LampsGame | null {
  const start = startOf(day, size, pattern)
  const lit: boolean[][] = []
  for (const b of boards) {
    const l = litAfter(start, size, pattern, b)
    if (!l) return null
    lit.push(l)
  }
  const out = lit.map(dark)
  if (out.filter(Boolean).length > 1) return null
  const w = out.indexOf(true)
  return {
    day,
    size,
    pattern,
    boards,
    lit,
    winner: w < 0 ? null : boards.length === 1 ? 0 : (w as Seat),
  }
}

const whichBoard = (g: LampsGame, by: Seat | undefined) => (g.boards.length === 1 ? 0 : (by ?? 0))

export function lampsRules(day: number, size: number, pattern: Pattern): Rules<LampsGame, number> {
  return {
    fresh: (mode) => lampsGame(day, size, pattern, mode === 'together' ? [[]] : [[], []])!,
    turn: (g) => (g.winner !== null ? null : 'any'),
    legal: (g, i, by) =>
      g.winner === null &&
      Number.isInteger(i) &&
      i >= 0 &&
      i < g.size * g.size &&
      g.boards[whichBoard(g, by)].length < MAX_PRESSES,
    apply: (g, i, by) => {
      const k = whichBoard(g, by)
      const boards = g.boards.map((b, j) => (j === k ? [...b, i] : b))
      return lampsGame(g.day, g.size, g.pattern, boards) ?? g
    },
    encode: (g) => ({ day: g.day, size: g.size, pattern: g.pattern, boards: g.boards }),
    decode: (x) => {
      const o = x as Record<string, unknown> | null
      if (!o || typeof o !== 'object') return null
      const { day, size, pattern, boards } = o
      if (!Number.isInteger(day) || (day as number) < 1 || (day as number) > 1e6) return null
      if (!(SIZES as readonly unknown[]).includes(size)) return null
      if (!(PATTERNS as readonly unknown[]).includes(pattern)) return null
      const n = size as number
      if (!Array.isArray(boards) || (boards.length !== 1 && boards.length !== 2)) return null
      if (
        !boards.every(
          (b) =>
            Array.isArray(b) &&
            b.length <= MAX_PRESSES &&
            b.every((i) => Number.isInteger(i) && i >= 0 && i < n * n),
        )
      )
        return null
      return lampsGame(day as number, n, pattern as Pattern, boards as number[][])
    },
    readMove: (x) =>
      Number.isInteger(x) && (x as number) >= 0 && (x as number) < 49 ? (x as number) : null,
    modes: ['versus', 'together'],
    result: (g) => g.winner,
    begun: (g) => g.boards.some((b) => b.length > 0),
  }
}
