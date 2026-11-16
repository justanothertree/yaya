import { PATTERNS, SIZES, make, runSolve, solve, type Pattern, type Size } from './lamps'
import type { Rules, Seat } from '../lab/social/room'

/**
 * Lamps as a duel by turns (src/lab/matches): both players switch off the same board, each on
 * their own, and the fewer presses wins — an undo counts, as the toy counts it. The same number
 * is a draw. A move is a whole solve: every press, and -1 for each one taken back.
 *
 * ⚠️ NOT THE DAY'S BOARD, though the plan said so (docs/2026-11-14-lab-async-matches-plan.md,
 * step 9). The toy's 💡 Hint solves today's board from wherever it stands, so a duel on it could be
 * won by asking the toy in another tab. The board is made from a seed the server picks with the
 * yes, through the toy's own `make`, so there is nowhere to look it up.
 *
 * ⚠️ THE FIRST SOLVE IS SEALED (Rules.hidden), as Rock paper scissors seals its first throw: kept
 * in the match's secret until the second is in, and then both are shown. Without that the second
 * player would know the number to beat, or simply copy it. The friend solves first, straight
 * after saying yes, since they are the one at the board; then the challenger.
 *
 * Versus only. A computer would play par, which is exact (lamps.ts solve), so together against it
 * could at best be drawn.
 */
export type DuelGame = {
  size: Size
  pattern: Pattern
  /** the board's seed, picked by the server with the yes; null before */
  seed: number | null
  /** each side's solve, the challenger's first: shown once both are in */
  solves: [number[] | null, number[] | null]
  /** the friend's solve is in and sealed */
  sealed: boolean
  /** what it is: only on the server, until the challenger's is in */
  pending: number[] | null
}
export type DuelMove = { solve: number[] }

export function readDuelSettings(
  s: Record<string, unknown>,
): { size: Size; pattern: Pattern } | null {
  const size = s.size ?? 5
  const pattern = s.pattern ?? 'plus'
  if (!(SIZES as readonly unknown[]).includes(size)) return null
  if (!(PATTERNS as readonly unknown[]).includes(pattern)) return null
  return { size: size as Size, pattern: pattern as Pattern }
}

const boards = new Map<string, boolean[]>()
/** the duel's board, made once per seed, size and pattern */
export function boardOf(g: Pick<DuelGame, 'seed' | 'size' | 'pattern'>): boolean[] | null {
  if (g.seed === null) return null
  const k = `${g.seed}|${g.size}|${g.pattern}`
  let b = boards.get(k)
  if (!b) {
    b = make(g.size, g.pattern, g.seed)
    boards.set(k, b)
  }
  return b
}
/** the fewest presses this board can be switched off in */
export const parOf = (g: DuelGame) => {
  const b = boardOf(g)
  return b ? solve(b, g.size, g.pattern)!.length : null
}

/** a solve's presses on this duel's board, or null if it does not switch it off */
export function pressesOf(g: DuelGame, a: unknown): number | null {
  const b = boardOf(g)
  if (!b) return null
  const run = runSolve(b, g.size, g.pattern, a)
  return run.ok ? run.presses : null
}

/** the friend first, then the challenger; nobody once the challenger's is in */
export const whoseMove = (g: DuelGame): Seat | null =>
  g.seed === null || g.solves[0] !== null ? null : g.sealed ? 0 : 1

const fresh = (size: Size, pattern: Pattern): DuelGame => ({
  size,
  pattern,
  seed: null,
  solves: [null, null],
  sealed: false,
  pending: null,
})

const isSeed = (x: unknown): x is number =>
  Number.isInteger(x) && (x as number) >= 0 && (x as number) < 2 ** 32

/** the duel anybody in it may see: the board's seed, whether a solve is sealed, and both at the end */
export function replayPublic(size: Size, pattern: Pattern, x: unknown): DuelGame | null {
  const o = x as Record<string, unknown> | null
  if (!o || typeof o !== 'object' || Object.keys(o).sort().join() !== 'sealed,seed,solves')
    return null
  const { seed, solves, sealed } = o
  if (typeof sealed !== 'boolean' || !Array.isArray(solves) || solves.length !== 2) return null
  if (seed !== null && !isSeed(seed)) return null
  const g: DuelGame = { ...fresh(size, pattern), seed: seed as number | null, sealed }
  if (solves[0] === null && solves[1] === null) {
    // before the yes nothing can be sealed
    return seed === null && sealed ? null : g
  }
  // both shown, or neither: and once shown, nothing is sealed, and each switches the board off
  if (
    seed === null ||
    sealed ||
    pressesOf(g, solves[0]) === null ||
    pressesOf(g, solves[1]) === null
  )
    return null
  return { ...g, solves: [[...solves[0]], [...solves[1]]] }
}

export function duelRules(size: Size, pattern: Pattern): Rules<DuelGame, DuelMove> {
  return {
    fresh: () => fresh(size, pattern),
    turn: whoseMove,
    legal: (g, m, by) => {
      const s = whoseMove(g)
      return s !== null && (by === undefined || by === s) && pressesOf(g, m.solve) !== null
    },
    apply: (g, m) => {
      const s = whoseMove(g)
      if (s === null || pressesOf(g, m.solve) === null) return g
      if (s === 1) return { ...g, sealed: true, pending: [...m.solve] }
      // the challenger's: both are shown, once the sealed one is known, which is on the server
      return { ...g, sealed: false, pending: null, solves: [[...m.solve], g.pending] }
    },
    encode: (g) => ({ seed: g.seed, solves: g.solves, sealed: g.sealed }),
    decode: (x) => replayPublic(size, pattern, x),
    readMove: (x) => {
      const o = x as { solve?: unknown } | null
      if (!o || typeof o !== 'object' || Object.keys(o).join() !== 'solve') return null
      const a = o.solve
      return Array.isArray(a) && a.every((v) => Number.isInteger(v)) ? { solve: [...a] } : null
    },
    modes: ['versus'],
    result: (g) => {
      if (whoseMove(g) !== null || !g.solves[0] || !g.solves[1]) return null
      const [a, b] = [g.solves[0].length, g.solves[1].length]
      return a < b ? 0 : b < a ? 1 : 'draw'
    },
    begun: (g) => g.sealed || g.solves[0] !== null,
    hidden: {
      secret: (g) => ({ pending: g.pending }),
      join: (g, secret) => {
        const p = (secret as { pending?: unknown } | null)?.pending
        // a sealed solve is there exactly when the state says one is waiting, and is a solve
        if (g.sealed !== (p !== null && p !== undefined)) return null
        if (p == null) return { ...g, pending: null }
        return pressesOf(g, p) === null ? null : { ...g, pending: [...(p as number[])] }
      },
      // the friend may see the solve they sealed; nobody else anything
      mine: (g, side) => (side === 1 ? g.pending : null),
      // a solve is never history: it is in the state once both are in, and secret until then
      logged: () => ({}),
      // the board, from a seed nobody could have looked at before the yes
      accept: (g) => ({ ...g, seed: Math.floor(Math.random() * 2 ** 32) }),
    },
  }
}

/** each side's presses, the challenger's first, once both are shown */
export const pressesBoth = (g: DuelGame): [number, number] | null =>
  g.solves[0] && g.solves[1] ? [g.solves[0].length, g.solves[1].length] : null
