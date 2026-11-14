/**
 * Share readers for the puzzle toys — see bests.ts for the rules every reader keeps: each calls the
 * toy's own readSaved on the toy's own key and only words the result.
 *
 * ⚠️ THE DAILY ONES DESCRIBE THE NEWEST KEPT DAY, NEVER "TODAY". A reader must not depend on the
 * clock, and a best kept from last Tuesday is still a best — so the line names its date. Bests are
 * appended as they improve, so the newest day is the largest `day`, not the last entry. A day can
 * hold several boards; the line gives the biggest one played (both variants when there are two at
 * that size), which keeps it to one sentence whatever was played.
 *
 * Golf, Mines, Sudoku and Tiles also keep a "today" — but its day is `daySeed`, a hash of the date
 * (bricks.ts), which cannot be turned back into one, so those share their all-time bests instead.
 */
import { readSaved as readBridges, BRIDGES_KEY } from '../../gpu/bridges'
import { readSaved as readCages, CAGES_KEY } from '../../gpu/cages'
import { readSaved as readCode, CODE_KEY, DEFAULT_RULES } from '../../gpu/codebreaker'
import { readSaved as readGolf, GOLF_KEY } from '../../gpu/golf'
import { readSaved as readLamps, LAMPS_KEY, type Best as LampsBest } from '../../gpu/lamps'
import { readSaved as readLevels, LEVELS_KEY, ROOMS, encode } from '../../gpu/levels'
import { readSaved as readMines, MINES_KEY, SIZES as MINE_SIZES } from '../../gpu/mines'
import { readSaved as readPegs, PEGS_KEY, BOARDS as PEG_BOARDS } from '../../gpu/pegs'
import { readSaved as readPipes, PIPES_KEY, type Best as PipesBest } from '../../gpu/pipes'
import { readSaved as readSudoku, SUDOKU_KEY, LEVELS as SUDOKU_LEVELS } from '../../gpu/sudoku'
import { readSaved as readTents, TENTS_KEY } from '../../gpu/tents'
import { readSaved as readTiles, TILES_KEY, LAYOUTS } from '../../gpu/tiles'
import { readSaved as readFold, FOLD_KEY, PUZZLES as FOLDS } from '../../gpu/fold'
import { readSaved as readSeedling, SEEDLING_KEY, LEVELS as GARDENS } from '../../gpu/seedling'
import { readSaved as readShadowbox, SHADOWBOX_KEY, PUZZLES as BOXES } from '../../gpu/shadowbox'
import { readSaved as readTopple, TOPPLE_KEY, PUZZLES as TOPPLES } from '../../gpu/topple'
import { clock, type Reader } from './words'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
/** a day number (daily.ts's dayNumber) as "14 Nov" — read in UTC, which is how it was made */
const dayLabel = (day: number) => {
  const d = new Date(day * 86400000)
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`
}
/** codebreaker's local-date key, "2026-11-14", as the same day number */
const dayOfKey = (key: string) => {
  const [y, m, d] = key.split('-').map(Number)
  return Math.floor(Date.UTC(y, m - 1, d) / 86400000)
}
const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
const join = (parts: (string | null)[]) => parts.filter(Boolean).join(', ') || null

/**
 * The newest kept day's biggest board(s), worded: "9×9 on 14 Nov in 3:12" — and a second board of
 * the same size after a comma. `label` names a board, `result` says how it went.
 */
function newestDay<B extends { day: number; size: number }>(
  bests: B[],
  label: (b: B) => string,
  result: (b: B) => string,
): string | null {
  if (!bests.length) return null
  const day = Math.max(...bests.map((b) => b.day))
  const that = bests.filter((b) => b.day === day)
  const size = Math.max(...that.map((b) => b.size))
  const [first, ...rest] = that
    .filter((b) => b.size === size)
    .sort((a, b) => label(a).localeCompare(label(b)))
  return [
    `${label(first)} on ${dayLabel(day)} in ${result(first)}`,
    ...rest.map((b) => `${label(b)} in ${result(b)}`),
  ].join(', ')
}

const square = (b: { size: number }) => `${b.size}×${b.size}`
const timed = (b: { seconds: number }) => clock(b.seconds)
/** the five daily boards that keep a best per day and size, and a count of everything finished */
const daily = (newest: string | null, solvedCount: number, what: string) =>
  join([newest, solvedCount ? `${count(solvedCount, what)} solved` : null])

const LAMP_PATTERN = { plus: '✚', cross: '✖' } as const
/** golf scores the way the toy prints them: +3, 0, −2 */
const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0')
const PEG_NAMES = { english: 'cross', triangle: 'triangle' } as const

/**
 * Fold, Shadow box, Topple and Seedling: puzzles in a fixed order, easiest first, each keeping its
 * fewest per puzzle. The line counts what is solved and names the furthest one reached with its
 * fewest — the hardest thing done, in the toy's own unit.
 */
function furthest(
  order: readonly { name: string }[],
  has: (name: string) => number | undefined,
  what: string,
  unit: (n: number) => string,
): string | null {
  const done = order.filter((p) => has(p.name) !== undefined)
  if (!done.length) return null
  const top = done[done.length - 1]
  return `${done.length} of ${count(order.length, what)} solved, up to ${top.name} in ${unit(has(top.name)!)}`
}

export const PUZZLES: Record<string, Reader> = {
  bridges: (read) => {
    const s = readBridges(read(BRIDGES_KEY))
    return daily(newestDay(s.bests, square, timed), s.solvedCount, 'map')
  },
  cages: (read) => {
    const s = readCages(read(CAGES_KEY))
    return daily(newestDay(s.bests, square, timed), s.solvedCount, 'board')
  },
  tents: (read) => {
    const s = readTents(read(TENTS_KEY))
    return daily(newestDay(s.bests, square, timed), s.solvedCount, 'field')
  },
  pipes: (read) => {
    const s = readPipes(read(PIPES_KEY))
    const newest = newestDay(
      s.bests,
      (b: PipesBest) => `${square(b)}${b.wrap ? ' wrapped' : ''}`,
      (b) => `${clock(b.seconds)} (${count(b.turns, 'turn')})`,
    )
    return daily(newest, s.solvedCount, 'board')
  },
  lamps: (read) => {
    const s = readLamps(read(LAMPS_KEY))
    const newest = newestDay(
      s.bests,
      (b: LampsBest) => `${square(b)} ${LAMP_PATTERN[b.pattern]}`,
      (b) => `${count(b.presses, 'press', 'presses')} (par ${b.par})`,
    )
    return daily(newest, s.solvedCount, 'board')
  },
  codebreaker: (read) => {
    const s = readCode(read(CODE_KEY))
    // the daily code is always played on the default rules, and its day is a local date as text
    const won = s.daily?.guesses ? s.daily : null
    const cracked = s.spread.slice(1).reduce((a, n) => a + n, 0)
    const fewest = s.spread.findIndex((n, i) => i > 0 && n > 0)
    return join([
      won
        ? `cracked the ${dayLabel(dayOfKey(won.day))} code in ${won.guesses} of ${DEFAULT_RULES.tries}`
        : null,
      cracked ? `${count(cracked, 'code')} cracked, fewest guesses ${fewest}` : null,
    ])
  },
  golf: (read) => {
    const s = readGolf(read(GOLF_KEY))
    if (s.best === null) return null
    return join([
      `best score ${signed(s.best)}`,
      s.cleared ? `cleared ${s.cleared} of ${count(s.played, 'deal')}` : null,
      s.onPar ? `${s.onPar} on par or better` : null,
    ])
  },
  levels: (read) => {
    const s = readLevels(read(LEVELS_KEY))
    const own = new Set(ROOMS.map(encode))
    const rooms = ROOMS.filter((r) => s.best[encode(r)] !== undefined).length
    const made = Object.keys(s.best).filter((k) => !own.has(k)).length
    if (!rooms && !made) return null
    const players = count(made, 'player-made room')
    if (!rooms) return `${players} solved`
    return `${rooms} of ${ROOMS.length} rooms solved${made ? `, plus ${players}` : ''}`
  },
  mines: (read) => {
    const s = readMines(read(MINES_KEY))
    if (!s.won) return null
    const best = (Object.keys(MINE_SIZES) as (keyof typeof MINE_SIZES)[])
      .filter((k) => s.best[k] !== undefined)
      .map((k) => `${k} ${(s.best[k]! / 10).toFixed(1)} s`)
    return join([
      best.length ? `best ${best.join(', ')}` : null,
      `cleared ${s.won} of ${count(s.played, 'board')}`,
    ])
  },
  pegs: (read) => {
    const s = readPegs(read(PEGS_KEY))
    return join(
      PEG_BOARDS.filter((k) => s.best[k] > 0).map(
        (k) =>
          `${PEG_NAMES[k]} down to ${count(s.best[k], 'peg')}${s.perfects[k] ? ` (${s.perfects[k]} perfect)` : ''}`,
      ),
    )
  },
  sudoku: (read) => {
    const s = readSudoku(read(SUDOKU_KEY))
    const best = SUDOKU_LEVELS.filter((l) => s.best[l] !== undefined).map(
      (l) => `${l} ${clock(s.best[l]!)}`,
    )
    return join([
      best.length ? `best ${best.join(', ')}` : null,
      s.solved ? `${count(s.solved, 'puzzle')} solved` : null,
    ])
  },
  fold: (read) => {
    const s = readFold(read(FOLD_KEY))
    return furthest(
      FOLDS,
      (n) => s.best[n],
      'puzzle',
      (k) => count(k, 'fold'),
    )
  },
  shadowbox: (read) => {
    const s = readShadowbox(read(SHADOWBOX_KEY))
    return furthest(
      BOXES,
      (n) => s.best[n],
      'puzzle',
      (k) => count(k, 'block'),
    )
  },
  topple: (read) => {
    const s = readTopple(read(TOPPLE_KEY))
    return furthest(
      TOPPLES,
      (n) => s.best[n],
      'puzzle',
      (k) => count(k, 'domino', 'dominoes'),
    )
  },
  seedling: (read) => {
    const s = readSeedling(read(SEEDLING_KEY))
    const line = furthest(
      GARDENS,
      (n) => s.best[n]?.seeds,
      'garden',
      (k) => count(k, 'seed'),
    )
    if (!line) return null
    const top = GARDENS.filter((g) => s.best[g.name]).at(-1)!
    return `${line} (generation ${s.best[top.name].gen})`
  },
  tiles: (read) => {
    const s = readTiles(read(TILES_KEY))
    const best = LAYOUTS.filter((l) => s.best[l.id] !== undefined).map(
      (l) => `${l.name} ${clock(s.best[l.id])}`,
    )
    return join([
      best.length ? `best ${best.join(', ')}` : null,
      s.cleared ? `${count(s.cleared, 'board')} cleared` : null,
    ])
  },
}
