import { LEVELS as CHESS_LEVELS } from '../../gpu/chess'
import { chessRules } from '../../gpu/chessRoom'
import { LEVELS as REVERSI_LEVELS, SIZES } from '../../gpu/reversi'
import { reversiRules } from '../../gpu/reversiRoom'
import { LEVELS as POOL_LEVELS } from '../../gpu/pool'
import { poolRules } from '../../gpu/poolRoom'
import { LEVELS as GOMOKU_LEVELS, SIZES as GOMOKU_SIZES } from '../../gpu/gomoku'
import { gomokuRules } from '../../gpu/gomokuRoom'
import { LEVELS as DRAUGHTS_LEVELS } from '../../gpu/draughts'
import { draughtsRules } from '../../gpu/draughtsRoom'
import { LEVELS as DOTS_LEVELS, SIZES as DOTS_SIZES } from '../../gpu/dots'
import { dotsRules } from '../../gpu/dotsRoom'
import { LEVELS as FOUR_LEVELS } from '../../gpu/fourrow'
import { fourRowMatchRules, readFourSettings } from '../../gpu/fourrowRoom'
import { LEVELS as MANCALA_LEVELS } from '../../gpu/mancala'
import { mancalaRules, readMancalaSettings } from '../../gpu/mancalaRoom'
import { LEVELS as MORRIS_LEVELS } from '../../gpu/morris'
import { morrisRules } from '../../gpu/morrisRoom'
import { LEVELS as HEX_LEVELS, SIZES as HEX_SIZES } from '../../gpu/hex'
import { hexRules, readHexSettings } from '../../gpu/hexRoom'
import { LEVELS as ULTIMATE_LEVELS } from '../../gpu/ultimate'
import { ultimateRules } from '../../gpu/ultimateRoom'
import { LEVELS as BREAKTHROUGH_LEVELS, SIZES as BREAKTHROUGH_SIZES } from '../../gpu/breakthrough'
import { breakthroughRules, readBreakthroughSize } from '../../gpu/breakthroughRoom'
import { LEVELS as FENCES_LEVELS, SIZES as FENCES_SIZES } from '../../gpu/fences'
import { fencesRules, readFencesSize } from '../../gpu/fencesRoom'
import { LEVELS as HALMA_LEVELS } from '../../gpu/halma'
import { halmaRules } from '../../gpu/halmaRoom'
import { LEVELS as GO_LEVELS } from '../../gpu/goboard'
import { goRules } from '../../gpu/goRoom'
import { LEVELS as FOX_LEVELS } from '../../gpu/fox'
import { foxRules } from '../../gpu/foxRoom'
import { LEVELS as CUBE_LEVELS } from '../../gpu/cube'
import { cubeRules } from '../../gpu/cubeRoom'
import { LEVELS as ARTILLERY_LEVELS } from '../../gpu/artillery'
import { artilleryRules } from '../../gpu/artilleryRoom'
import { LEVELS as BOWLING_LEVELS } from '../../gpu/bowling'
import { bowlingRules } from '../../gpu/bowlingRoom'
import { LEVELS as CURLING_LEVELS } from '../../gpu/curling'
import { curlingMatchRules } from '../../gpu/curlingRoom'
import { LEVELS as PUTT_LEVELS } from '../../gpu/putt'
import { puttRules } from '../../gpu/puttRoom'
import { LEVELS as DARTS_LEVELS } from '../../gpu/darts'
import { dartsMatchRules } from '../../gpu/dartsRoom'
import { LEVELS as BACKGAMMON_LEVELS } from '../../gpu/backgammon'
import { backgammonRules } from '../../gpu/backgammonRoom'
import { LEVELS as SEA_LEVELS, SIZES as SEA_SIZES } from '../../gpu/seabattle'
import { readSeaSettings, seaRules } from '../../gpu/seabattleRoom'
import { LEVELS as DICE_LEVELS, diceRules } from '../../gpu/diceRoom'
import { LEVELS as YACHT_LEVELS } from '../../gpu/yacht'
import { yachtRules } from '../../gpu/yachtRoom'
import { LEVELS as SHUT_LEVELS } from '../../gpu/shut'
import { shutRules } from '../../gpu/shutRoom'
import { codeRules, readCodeSettings } from '../../gpu/codebreakerRoom'
import { boxRules, readBoxSettings } from '../../gpu/shadowboxRoom'
import { readRpsSettings, rpsRules } from '../../gpu/rpsRoom'
import { ginRules, readGinSettings } from '../../gpu/ginRoom'
import { cribRules } from '../../gpu/cribbageRoom'
import { dominoRules, readDominoSettings } from '../../gpu/dominoesRoom'
import { heartsRules, readHeartsSettings } from '../../gpu/heartsRoom'
import { readSpadesSettings, spadesRules } from '../../gpu/spadesRoom'
import { eightsRules, readEightsSettings } from '../../gpu/eightsRoom'
import { liarsRules, readLiarsSettings } from '../../gpu/liarsRoom'
import { holdemRules } from '../../gpu/holdemRoom'
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
  gomoku: {
    name: MATCH_NAMES.gomoku,
    rulesFor: (s) => {
      const size = s.size ?? 13
      return (GOMOKU_SIZES as readonly unknown[]).includes(size)
        ? gomokuRules(size as number)
        : null
    },
    levels: GOMOKU_LEVELS,
    sizes: GOMOKU_SIZES,
  },
  draughts: { name: MATCH_NAMES.draughts, rulesFor: () => draughtsRules, levels: DRAUGHTS_LEVELS },
  dots: {
    name: MATCH_NAMES.dots,
    rulesFor: (s) => {
      const size = s.size ?? 4
      return (DOTS_SIZES as readonly unknown[]).includes(size) ? dotsRules(size as number) : null
    },
    levels: DOTS_LEVELS,
    sizes: DOTS_SIZES,
  },
  fourrow: {
    name: MATCH_NAMES.fourrow,
    rulesFor: (s) => {
      const read = readFourSettings(s)
      return read ? fourRowMatchRules(...read) : null
    },
    levels: FOUR_LEVELS,
  },
  mancala: {
    name: MATCH_NAMES.mancala,
    rulesFor: (s) => {
      const read = readMancalaSettings(s)
      return read ? mancalaRules(read) : null
    },
    levels: MANCALA_LEVELS,
  },
  morris: { name: MATCH_NAMES.morris, rulesFor: () => morrisRules, levels: MORRIS_LEVELS },
  hex: {
    name: MATCH_NAMES.hex,
    rulesFor: (s) => {
      const read = readHexSettings(s)
      return read ? hexRules(...read) : null
    },
    levels: HEX_LEVELS,
    sizes: HEX_SIZES,
  },
  ultimate: { name: MATCH_NAMES.ultimate, rulesFor: () => ultimateRules, levels: ULTIMATE_LEVELS },
  breakthrough: {
    name: MATCH_NAMES.breakthrough,
    rulesFor: (s) => {
      const size = readBreakthroughSize(s)
      return size === null ? null : breakthroughRules(size)
    },
    levels: BREAKTHROUGH_LEVELS,
    sizes: BREAKTHROUGH_SIZES,
  },
  fences: {
    name: MATCH_NAMES.fences,
    rulesFor: (s) => {
      const size = readFencesSize(s)
      return size === null ? null : fencesRules(size)
    },
    levels: FENCES_LEVELS,
    sizes: FENCES_SIZES,
  },
  halma: { name: MATCH_NAMES.halma, rulesFor: () => halmaRules, levels: HALMA_LEVELS },
  go: { name: MATCH_NAMES.go, rulesFor: () => goRules, levels: GO_LEVELS },
  fox: { name: MATCH_NAMES.fox, rulesFor: () => foxRules, levels: FOX_LEVELS },
  cube: { name: MATCH_NAMES.cube, rulesFor: () => cubeRules, levels: CUBE_LEVELS },
  artillery: {
    name: MATCH_NAMES.artillery,
    rulesFor: () => artilleryRules,
    levels: ARTILLERY_LEVELS,
  },
  bowling: { name: MATCH_NAMES.bowling, rulesFor: () => bowlingRules, levels: BOWLING_LEVELS },
  curling: { name: MATCH_NAMES.curling, rulesFor: () => curlingMatchRules, levels: CURLING_LEVELS },
  putt: { name: MATCH_NAMES.putt, rulesFor: () => puttRules, levels: PUTT_LEVELS },
  darts: { name: MATCH_NAMES.darts, rulesFor: () => dartsMatchRules, levels: DARTS_LEVELS },
  backgammon: {
    name: MATCH_NAMES.backgammon,
    rulesFor: () => backgammonRules,
    levels: BACKGAMMON_LEVELS,
  },
  seabattle: {
    name: MATCH_NAMES.seabattle,
    rulesFor: (s) => {
      const set = readSeaSettings(s)
      return set === null ? null : seaRules(set)
    },
    levels: SEA_LEVELS,
    sizes: SEA_SIZES,
  },
  dice: { name: MATCH_NAMES.dice, rulesFor: () => diceRules, levels: DICE_LEVELS },
  yacht: { name: MATCH_NAMES.yacht, rulesFor: () => yachtRules, levels: YACHT_LEVELS },
  shut: { name: MATCH_NAMES.shut, rulesFor: () => shutRules, levels: SHUT_LEVELS },
  codebreaker: {
    name: MATCH_NAMES.codebreaker,
    rulesFor: (s) => {
      const rules = readCodeSettings(s)
      return rules === null ? null : codeRules(rules)
    },
    levels: ['easy', 'fair', 'hard'],
  },
  shadowbox: {
    name: MATCH_NAMES.shadowbox,
    rulesFor: (s) => {
      const set = readBoxSettings(s)
      return set === null ? null : boxRules(set.rounds)
    },
    levels: ['easy', 'fair', 'hard'],
  },
  rps: {
    name: MATCH_NAMES.rps,
    rulesFor: (s) => {
      const set = readRpsSettings(s)
      return set === null ? null : rpsRules(set.firstTo)
    },
    levels: ['easy', 'fair', 'hard'],
  },
  gin: {
    name: MATCH_NAMES.gin,
    rulesFor: (s) => {
      const set = readGinSettings(s)
      return set === null ? null : ginRules(set.target)
    },
    levels: ['easy', 'fair', 'hard'],
  },
  cribbage: {
    name: MATCH_NAMES.cribbage,
    rulesFor: () => cribRules,
    levels: ['easy', 'fair', 'hard'],
  },
  dominoes: {
    name: MATCH_NAMES.dominoes,
    rulesFor: (s) => {
      const set = readDominoSettings(s)
      return set === null ? null : dominoRules(set.target)
    },
    levels: ['easy', 'fair', 'hard'],
  },
  hearts: {
    name: MATCH_NAMES.hearts,
    rulesFor: (s) => {
      const set = readHeartsSettings(s)
      return set === null ? null : heartsRules(set.end, set.level)
    },
    levels: ['easy', 'fair', 'hard'],
  },
  spades: {
    name: MATCH_NAMES.spades,
    rulesFor: (s) => {
      const set = readSpadesSettings(s)
      return set === null ? null : spadesRules(set.target, set.level)
    },
    levels: ['easy', 'fair', 'hard'],
  },
  eights: {
    name: MATCH_NAMES.eights,
    rulesFor: (s) => {
      const set = readEightsSettings(s)
      return set === null ? null : eightsRules(set.target)
    },
    levels: ['easy', 'fair', 'hard'],
  },
  liars: {
    name: MATCH_NAMES.liars,
    rulesFor: (s) => {
      const set = readLiarsSettings(s)
      return set === null ? null : liarsRules(set.wild)
    },
    levels: ['easy', 'fair', 'hard'],
  },
  poker: {
    name: MATCH_NAMES.poker,
    rulesFor: () => holdemRules,
    levels: ['easy', 'fair', 'hard'],
  },
}

export const matchToy = (demo: string): MatchToy | null =>
  Object.hasOwn(MATCH_TOYS, demo) ? MATCH_TOYS[demo] : null
