import {
  LEVELS,
  SIZES,
  choose,
  empty,
  other,
  place,
  swap,
  wantsSwap,
  winner,
  type Board,
  type Level,
  type Player,
} from './hex'
import type { Rules } from '../lab/social/room'

/**
 * Hex as a room game (src/lab/social/room.ts). Seat 0 is red, joining top to bottom, and moves
 * first; seat 1 is blue, joining left to right. Together, the two seats play red between them and
 * the computer plays blue, with hex.ts's own `choose` and its own mind about the swap.
 *
 * A move is a cell, or SWAP: with the swap rule on, the second player's first move may take the
 * first stone as their own, mirrored to their side. The game travels as its moves, replayed through
 * hex.ts's own `place` and `swap` from the size and rule it was started with, so the host's choices
 * travel with it and a board nobody could reach cannot be sent.
 */
export const SWAP = -1

export type HexGame = {
  b: Board
  /** whose turn, or null once somebody has joined their sides */
  turn: Player | null
  /** whether the swap rule is on for this game */
  swapRule: boolean
  /** every move, in order: a cell, or SWAP */
  moves: number[]
  /** the cell the last move put a stone on */
  last: number | null
}

const fresh = (n: number, swapRule: boolean): HexGame => ({
  b: empty(n),
  turn: 1,
  swapRule,
  moves: [],
  last: null,
})

const canSwap = (g: HexGame) => g.swapRule && g.moves.length === 1 && g.turn === 2

function isLegal(g: HexGame, m: number): boolean {
  if (g.turn === null || !Number.isInteger(m)) return false
  if (m === SWAP) return canSwap(g)
  return m >= 0 && m < g.b.cells.length && g.b.cells[m] === 0
}

function after(g: HexGame, m: number): HexGame {
  const p = g.turn!
  const b = m === SWAP ? swap(g.b) : place(g.b, m, p)
  const last = m === SWAP ? b.cells.findIndex((c) => c) : m
  return { ...g, b, turn: winner(b) ? null : other(p), moves: [...g.moves, m], last }
}

/** the game these moves make on this board, or null at the first that is not a move there */
export function replay(n: number, swapRule: boolean, moves: readonly unknown[]): HexGame | null {
  if (moves.length > n * n + 1) return null
  let g = fresh(n, swapRule)
  for (const m of moves) {
    if (!isLegal(g, m as number)) return null
    g = after(g, m as number)
  }
  return g
}

export function hexRules(size: number, swapRule: boolean): Rules<HexGame, number> {
  return {
    fresh: () => fresh(size, swapRule),
    turn: (g) => (g.turn === null ? null : g.turn === 1 ? 0 : 1),
    legal: (g, m, by) => (by === undefined || by === (g.turn ?? 0) - 1) && isLegal(g, m),
    apply: (g, m) => after(g, m),
    encode: (g) => ({ n: g.b.n, swap: g.swapRule, moves: g.moves }),
    decode: (x) => {
      const o = x as { n?: unknown; swap?: unknown; moves?: unknown } | null
      if (!o || !(SIZES as readonly unknown[]).includes(o.n)) return null
      if (typeof o.swap !== 'boolean' || !Array.isArray(o.moves)) return null
      return replay(o.n as number, o.swap, o.moves)
    },
    readMove: (x) =>
      Number.isInteger(x) && (x as number) >= SWAP && (x as number) < 121 ? (x as number) : null,
    modes: ['versus', 'together'],
    computer: {
      side: 1,
      levels: LEVELS,
      choose: (g, level) => (canSwap(g) && wantsSwap(g.b) ? SWAP : choose(g.b, 2, level as Level)),
    },
    result: (g) => {
      const w = winner(g.b)
      return w === null ? null : w === 1 ? 0 : 1
    },
    begun: (g) => g.moves.length > 0,
  }
}
