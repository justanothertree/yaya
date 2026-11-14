/**
 * Share readers for the board and card toys — see bests.ts for the rules every reader keeps: each
 * calls the toy's own readSaved with the toy's own key, and words only what that returns.
 *
 * Nearly every one of these keeps `record: Record<Level, Tally>`, written once when a game against
 * the computer ends, so most readers are `versus` plus whatever else that toy's tally holds. The
 * line names the HARDEST level with a win and that level's own figures — a quickest win kept on
 * Easy is not a claim about the Hard computer.
 */
import {
  readSaved as readBackgammon,
  LEVELS as BACKGAMMON_LEVELS,
  BACKGAMMON_KEY,
} from '../../gpu/backgammon'
import {
  readSaved as readBreakthrough,
  LEVELS as BREAKTHROUGH_LEVELS,
  BREAKTHROUGH_KEY,
} from '../../gpu/breakthrough'
import { readSaved as readChess, LEVELS as CHESS_LEVELS, CHESS_KEY } from '../../gpu/chess'
import {
  readSaved as readCribbage,
  LEVELS as CRIBBAGE_LEVELS,
  CRIBBAGE_KEY,
} from '../../gpu/cribbage'
import { readSaved as readCube, LEVELS as CUBE_LEVELS, CUBE_KEY } from '../../gpu/cube'
import {
  readSaved as readDominoes,
  LEVELS as DOMINOES_LEVELS,
  DOMINOES_KEY,
} from '../../gpu/dominoes'
import { readSaved as readDots, LEVELS as DOTS_LEVELS, DOTS_KEY } from '../../gpu/dots'
import {
  readSaved as readDraughts,
  LEVELS as DRAUGHTS_LEVELS,
  DRAUGHTS_KEY,
} from '../../gpu/draughts'
import { readSaved as readEights, LEVELS as EIGHTS_LEVELS, EIGHTS_KEY } from '../../gpu/eights'
import { readSaved as readFences, LEVELS as FENCES_LEVELS, FENCES_KEY } from '../../gpu/fences'
import { readSaved as readFourRow, LEVELS as FOUR_LEVELS, FOUR_KEY } from '../../gpu/fourrow'
import { readSaved as readFox, FOX_KEY } from '../../gpu/fox'
import { readSaved as readGin, LEVELS as GIN_LEVELS, GIN_KEY } from '../../gpu/gin'
import { readSaved as readGo, LEVELS as GO_LEVELS, GO_KEY } from '../../gpu/goboard'
import { readSaved as readGomoku, LEVELS as GOMOKU_LEVELS, GOMOKU_KEY } from '../../gpu/gomoku'
import { readSaved as readHalma, LEVELS as HALMA_LEVELS, HALMA_KEY } from '../../gpu/halma'
import { readSaved as readHearts, LEVELS as HEARTS_LEVELS, HEARTS_KEY } from '../../gpu/hearts'
import { readSaved as readHex, LEVELS as HEX_LEVELS, HEX_KEY } from '../../gpu/hex'
import { readSaved as readLiars, LEVELS as LIARS_LEVELS, LIARS_KEY } from '../../gpu/liars'
import { readSaved as readMancala, LEVELS as MANCALA_LEVELS, MANCALA_KEY } from '../../gpu/mancala'
import { readSaved as readMorris, LEVELS as MORRIS_LEVELS, MORRIS_KEY } from '../../gpu/morris'
import { readSaved as readReversi, LEVELS as REVERSI_LEVELS, REVERSI_KEY } from '../../gpu/reversi'
import { readSaved as readSea, LEVELS as SEA_LEVELS, SEA_KEY } from '../../gpu/seabattle'
import { readSaved as readShut, LEVELS as SHUT_LEVELS, SHUT_KEY } from '../../gpu/shut'
import { readSaved as readSpades, LEVELS as SPADES_LEVELS, SPADES_KEY } from '../../gpu/spades'
import { readSaved as readTwentyOne, START_CHIPS, TWENTYONE_KEY } from '../../gpu/twentyone'
import {
  readSaved as readUltimate,
  LEVELS as ULTIMATE_LEVELS,
  ULTIMATE_KEY,
} from '../../gpu/ultimate'
import { readSaved as readYacht, LEVELS as YACHT_LEVELS, YACHT_KEY } from '../../gpu/yacht'
import { onlineLine } from '../social/online'
import type { Reader } from './words'

/** what every toy's tally has in common: wins, and either losses (and draws) or games played */
export type Tally = { won: number; lost?: number; drawn?: number; played?: number }

/** "1 game", "3 games" */
const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
/** "once", "twice", "3 times" */
const times = (n: number) => (n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`)
/** a level as the toys show it — every Demo's LEVEL_NAMES is its id with a capital */
const named = (level: string) => level.charAt(0).toUpperCase() + level.slice(1)

/** the hardest level with at least one win (levels run easiest first), or null when none has */
export function hardestWin<L extends string, T extends Tally>(
  levels: readonly L[],
  record: Record<L, T>,
): { level: L; tally: T } | null {
  for (let i = levels.length - 1; i >= 0; i--) {
    const tally = record[levels[i]]
    if (tally.won > 0) return { level: levels[i], tally }
  }
  return null
}

/** "won 5 of 8 games against the Hard computer (1 drawn)" */
export function wonOf(t: Tally, against: string): string {
  const games = t.played ?? t.won + (t.lost ?? 0) + (t.drawn ?? 0)
  const drawn = t.drawn ? ` (${t.drawn} drawn)` : ''
  return `won ${t.won} of ${count(games, 'game')} ${against}${drawn}`
}

/** the parts that are there, joined — or null when none are */
const join = (...parts: (string | false | null)[]) => parts.filter(Boolean).join(', ') || null

/**
 * The record against the hardest computer beaten, and what else that level's tally keeps. `many`
 * is for the tables of several computers (and a partner), where "the Hard computer" would be
 * wrong: those say "on Hard".
 */
export function versus<L extends string, T extends Tally>(
  levels: readonly L[],
  record: Record<L, T>,
  more: (t: T) => (string | false | null)[] = () => [],
  many = false,
): string | null {
  const best = hardestWin(levels, record)
  if (!best) return null
  const name = named(best.level)
  const against = many ? `on ${name}` : `against the ${name} computer`
  return join(wonOf(best.tally, against), ...more(best.tally))
}

const quickest = (moves: number, unit = 'moves') => moves > 0 && `quickest win in ${moves} ${unit}`
const widest = (margin: number, one: string, many?: string) =>
  margin > 0 && `widest win ${count(margin, one, many)}`

export const BOARD: Record<string, Reader> = {
  backgammon: (read) =>
    versus(BACKGAMMON_LEVELS, readBackgammon(read(BACKGAMMON_KEY)).record, (t) => [
      `${count(t.points, 'point')} to ${t.against}`,
    ]),
  breakthrough: (read) =>
    versus(BREAKTHROUGH_LEVELS, readBreakthrough(read(BREAKTHROUGH_KEY)).record, (t) => [
      quickest(t.fastest),
    ]),
  chess: (read) =>
    join(versus(CHESS_LEVELS, readChess(read(CHESS_KEY)).record), onlineLine(read, 'chess')),
  cribbage: (read) =>
    versus(CRIBBAGE_LEVELS, readCribbage(read(CRIBBAGE_KEY)).record, (t) => [
      t.skunks > 0 && count(t.skunks, 'skunk'),
      t.best > 0 && `best hand ${t.best}`,
    ]),
  cube: (read) => versus(CUBE_LEVELS, readCube(read(CUBE_KEY)).record),
  dominoes: (read) => versus(DOMINOES_LEVELS, readDominoes(read(DOMINOES_KEY)).record),
  dots: (read) =>
    versus(DOTS_LEVELS, readDots(read(DOTS_KEY)).record, (t) => [widest(t.best, 'box', 'boxes')]),
  draughts: (read) => versus(DRAUGHTS_LEVELS, readDraughts(read(DRAUGHTS_KEY)).record),
  eights: (read) => versus(EIGHTS_LEVELS, readEights(read(EIGHTS_KEY)).record, undefined, true),
  fences: (read) =>
    versus(FENCES_LEVELS, readFences(read(FENCES_KEY)).record, (t) => [quickest(t.best)]),
  fourrow: (read) =>
    versus(FOUR_LEVELS, readFourRow(read(FOUR_KEY)).record, (t) => [quickest(t.fastest)]),
  // the fox's record is kept per SIDE, not per level, so no level can be claimed
  fox: (read) => {
    const r = readFox(read(FOX_KEY)).record
    return join(
      r.geese.won > 0 && wonOf(r.geese, 'as the geese'),
      r.fox.won > 0 && wonOf(r.fox, 'as the fox'),
    )
  },
  gin: (read) =>
    versus(GIN_LEVELS, readGin(read(GIN_KEY)).record, (t) => [
      t.gins > 0 && `went gin ${times(t.gins)}`,
    ]),
  go: (read) => versus(GO_LEVELS, readGo(read(GO_KEY)).record),
  gomoku: (read) =>
    join(versus(GOMOKU_LEVELS, readGomoku(read(GOMOKU_KEY)).record), onlineLine(read, 'gomoku')),
  halma: (read) =>
    versus(HALMA_LEVELS, readHalma(read(HALMA_KEY)).record, (t) => [quickest(t.fewest)]),
  hearts: (read) =>
    versus(
      HEARTS_LEVELS,
      readHearts(read(HEARTS_KEY)).record,
      (t) => [t.moons > 0 && `shot the moon ${times(t.moons)}`],
      true,
    ),
  hex: (read) =>
    versus(HEX_LEVELS, readHex(read(HEX_KEY)).record, (t) => [
      t.best > 1 && `best run ${t.best} in a row`,
    ]),
  liars: (read) =>
    versus(
      LIARS_LEVELS,
      readLiars(read(LIARS_KEY)).record,
      (t) => [t.caught > 0 && `caught ${count(t.caught, 'lie')}`],
      true,
    ),
  mancala: (read) =>
    versus(MANCALA_LEVELS, readMancala(read(MANCALA_KEY)).record, (t) => [widest(t.best, 'seed')]),
  morris: (read) => versus(MORRIS_LEVELS, readMorris(read(MORRIS_KEY)).record),
  reversi: (read) =>
    join(
      versus(REVERSI_LEVELS, readReversi(read(REVERSI_KEY)).record, (t) => [
        widest(t.best, 'disc'),
      ]),
      onlineLine(read, 'reversi'),
    ),
  seabattle: (read) =>
    versus(SEA_LEVELS, readSea(read(SEA_KEY)).record, (t) => [quickest(t.fewest, 'shots')]),
  shut: (read) => {
    const s = readShut(read(SHUT_KEY))
    // alone, a score is what is left standing: 0 is the box shut, and `best` is null until a game
    const alone =
      s.shut > 0
        ? `box shut ${times(s.shut)} in ${count(s.turns, 'game')} alone`
        : s.best !== null && `lowest left alone ${s.best} in ${count(s.turns, 'game')}`
    return join(versus(SHUT_LEVELS, s.record), alone)
  },
  spades: (read) =>
    versus(
      SPADES_LEVELS,
      readSpades(read(SPADES_KEY)).record,
      (t) => [t.nils > 0 && `made nil ${times(t.nils)}`],
      true,
    ),
  // the bank everybody starts with is no achievement; a peak above it is
  twentyone: (read) => {
    const s = readTwentyOne(read(TWENTYONE_KEY))
    if (s.peak <= START_CHIPS) return null
    return join(
      `most chips ever ${s.peak.toLocaleString('en')} over ${count(s.hands, 'hand')}`,
      s.decided > 0 && `${Math.round((100 * s.agreed) / s.decided)}% of decisions by the book`,
    )
  },
  ultimate: (read) => versus(ULTIMATE_LEVELS, readUltimate(read(ULTIMATE_KEY)).record),
  yacht: (read) => {
    const s = readYacht(read(YACHT_KEY))
    return join(versus(YACHT_LEVELS, s.record), s.best > 0 && `best game alone ${s.best}`)
  },
}
