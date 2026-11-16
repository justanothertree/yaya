import {
  LEVELS,
  PIT_CHOICES,
  SEED_CHOICES,
  choose,
  legal,
  score,
  sow,
  start,
  type Board,
  type Level,
  type Rules as MancalaRules,
  type Side,
} from './mancala'
import type { Rules } from '../lab/social/room'

/**
 * Mancala as a room game (src/lab/social/room.ts). Seat 0 sows from the near row and moves first,
 * seat 1 from the far one; together, the two seats sow for side 0 between them and the computer is
 * side 1, with mancala.ts's own `choose`.
 *
 * Ending in your own store keeps the turn, as it always does: the room asks mancala.ts whose turn
 * it is after every sowing, so a run of extra turns is one side's however long it is.
 *
 * ⚠️ THE GAME TRAVELS AS ITS PITS, NOT AS ITS BOARD, replayed through mancala.ts's own `sow` from
 * the rules it was started with. So a board nobody could have reached cannot be sent at all: seeds
 * appearing from nowhere, a pit sown out of turn, an empty pit sown, or rules the toy does not
 * offer. The rules travel with the game, because the host's rules start it and every other seat
 * must replay it with the same ones.
 */
export type MancalaGame = {
  rules: MancalaRules
  b: Board
  /** whose turn, or null once the game is over */
  turn: Side | null
  /** every pit sown, in order */
  pits: number[]
  /** the seeds the last sowing dropped, in order, for lighting the board */
  path: number[]
}

/** far more sowings than any real game takes; a list longer than this is not a game */
export const MAX_SOWINGS = 400

function fresh(rules: MancalaRules): MancalaGame {
  return { rules, b: start(rules), turn: 0, pits: [], path: [] }
}

function after(g: MancalaGame, pit: number): MancalaGame {
  const s = sow(g.b, pit, g.turn!, g.rules)
  return { ...g, b: s.board, turn: s.over ? null : s.next, pits: [...g.pits, pit], path: s.path }
}

/** the rules a game was sent with, if they are the toy's own; null for anything else */
export function readRules(x: unknown): MancalaRules | null {
  const o = x as Record<string, unknown> | null
  if (!o || typeof o !== 'object') return null
  if (!(PIT_CHOICES as readonly unknown[]).includes(o.pits)) return null
  if (!(SEED_CHOICES as readonly unknown[]).includes(o.seeds)) return null
  if (typeof o.captures !== 'boolean') return null
  return { pits: o.pits as number, seeds: o.seeds as number, captures: o.captures }
}

/** the game these pits make from these rules, or null at the first that is not a sowing there */
export function replay(rules: MancalaRules, pits: readonly unknown[]): MancalaGame | null {
  if (pits.length > MAX_SOWINGS) return null
  let g = fresh(rules)
  for (const p of pits) {
    if (g.turn === null || !Number.isInteger(p) || !legal(g.b, g.turn).includes(p as number))
      return null
    g = after(g, p as number)
  }
  return g
}

export function mancalaRules(rules: MancalaRules): Rules<MancalaGame, number> {
  return {
    fresh: () => fresh(rules),
    turn: (g) => g.turn,
    legal: (g, pit, by) =>
      g.turn !== null &&
      (by === undefined || by === g.turn) &&
      g.pits.length < MAX_SOWINGS &&
      Number.isInteger(pit) &&
      legal(g.b, g.turn).includes(pit),
    apply: (g, pit) => after(g, pit),
    encode: (g) => ({
      pits: g.rules.pits,
      seeds: g.rules.seeds,
      captures: g.rules.captures,
      sown: g.pits,
    }),
    decode: (x) => {
      const o = x as Record<string, unknown> | null
      const r = readRules(o)
      if (!r || !Array.isArray(o!.sown)) return null
      return replay(r, o!.sown)
    },
    readMove: (x) =>
      Number.isInteger(x) && (x as number) >= 0 && (x as number) < 14 ? (x as number) : null,
    modes: ['versus', 'together'],
    computer: {
      side: 1,
      levels: LEVELS,
      choose: (g, level) => choose(g.b, 1, level as Level, g.rules),
    },
    result: (g) => {
      if (g.turn !== null) return null
      const [a, b] = score(g.b)
      return a > b ? 0 : b > a ? 1 : 'draw'
    },
    begun: (g) => g.pits.length > 0,
  }
}
