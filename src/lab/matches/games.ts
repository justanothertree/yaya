import { LEVELS as CHESS_LEVELS } from '../../gpu/chess'
import { chessRules } from '../../gpu/chessRoom'
import { LEVELS as REVERSI_LEVELS, SIZES } from '../../gpu/reversi'
import { reversiRules } from '../../gpu/reversiRoom'
import { LEVELS as POOL_LEVELS } from '../../gpu/pool'
import { poolRules } from '../../gpu/poolRoom'
import type { Rules } from '../social/room'
import { MATCH_NAMES } from './names'

/**
 * The toys a match by turns can be played on, as the browser needs them: a name for the bell and
 * the list, the levels and sizes a challenge may ask for, and the toy's own `Rules` for a match's
 * settings — the same objects the call rooms play on and `lab-move` checks every move with.
 *
 * ⚠️ THREE LISTS MUST AGREE: this one, `GAMES` in supabase/functions/lab-move/core.ts (what the
 * server can play) and `lab_match_playable` in the matches migration (what may be challenged).
 * games.test.ts compares this one with the server's, settings and all, so a toy added to one and
 * not the other fails `npm run test` — the server's own test already compares it with the SQL.
 *
 * Kept apart from the server's list rather than imported from it, because that file is bundled
 * for Deno and re-deployed by hand: a change made here for the browser must never quietly become a
 * change to what is deployed.
 */
export type MatchToy = {
  name: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rulesFor: (settings: Record<string, unknown>) => Rules<any, any> | null
  /** what Together may ask the computer to play at, easiest first */
  levels: readonly string[]
  /** board sizes, where the toy has them */
  sizes?: readonly number[]
}

export const MATCH_TOYS: Record<string, MatchToy> = {
  reversi: {
    name: MATCH_NAMES.reversi,
    rulesFor: (s) => {
      const size = s.size ?? 8
      return (SIZES as readonly unknown[]).includes(size) ? reversiRules(size as number) : null
    },
    levels: REVERSI_LEVELS,
    sizes: SIZES,
  },
  chess: { name: MATCH_NAMES.chess, rulesFor: () => chessRules, levels: CHESS_LEVELS },
  pool: { name: MATCH_NAMES.pool, rulesFor: () => poolRules, levels: POOL_LEVELS },
}

export const matchToy = (demo: string): MatchToy | null =>
  Object.hasOwn(MATCH_TOYS, demo) ? MATCH_TOYS[demo] : null
