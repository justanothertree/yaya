import { describe, expect, it } from 'vitest'
import { PUZZLES } from './puzzles'
import { BRIDGES_KEY } from '../../gpu/bridges'
import { CAGES_KEY } from '../../gpu/cages'
import { CODE_KEY } from '../../gpu/codebreaker'
import { GOLF_KEY } from '../../gpu/golf'
import { LAMPS_KEY } from '../../gpu/lamps'
import { LEVELS_KEY, ROOMS, encode } from '../../gpu/levels'
import { MINES_KEY } from '../../gpu/mines'
import { PEGS_KEY } from '../../gpu/pegs'
import { PIPES_KEY } from '../../gpu/pipes'
import { SUDOKU_KEY } from '../../gpu/sudoku'
import { TENTS_KEY } from '../../gpu/tents'
import { TILES_KEY } from '../../gpu/tiles'
import { FOLD_KEY, PUZZLES as FOLDS } from '../../gpu/fold'
import { SEEDLING_KEY, LEVELS as GARDENS } from '../../gpu/seedling'
import { SHADOWBOX_KEY, PUZZLES as BOXES } from '../../gpu/shadowbox'
import { TOPPLE_KEY, PUZZLES as TOPPLES } from '../../gpu/topple'
import registry from '../../sections/labDemos.tsx?raw'

/* the JSON a toy writes, under its own key — and nothing else in storage */
const at = (key: string, saved: unknown) => (k: string) =>
  k === key ? JSON.stringify(saved) : null
const empty = () => null
/** a calendar date as the day number the daily toys keep (daily.ts's dayNumber, from the calendar) */
const day = (y: number, month: number, d: number) => Date.UTC(y, month - 1, d) / 86400000

describe('share lines for the puzzle toys', () => {
  it('names only toys that exist', () => {
    for (const id of Object.keys(PUZZLES)) expect(registry, id).toContain(`id: '${id}'`)
  })
  it('says nothing for any of them with nothing kept', () => {
    for (const [id, r] of Object.entries(PUZZLES)) expect(r(empty), id).toBeNull()
  })

  /* the daily boards: several days kept, the newest NOT last in the list, a smaller board on the
     newest day and a faster time on an older one — so "newest day, biggest board" is really asked */
  it('bridges: the newest day’s biggest map, and the count', () => {
    const read = at(BRIDGES_KEY, {
      size: 11,
      look: 'night',
      clashes: false,
      bests: [
        { day: day(2026, 11, 14), size: 11, seconds: 520 },
        { day: day(2026, 11, 14), size: 7, seconds: 61 },
        { day: day(2026, 11, 12), size: 11, seconds: 400 },
      ],
      solvedCount: 23,
    })
    expect(PUZZLES.bridges(read)).toBe('11×11 on 14 Nov in 8:40, 23 maps solved')
    expect(PUZZLES.bridges(at(BRIDGES_KEY, { size: 11, look: 'map', bests: [] }))).toBeNull()
  })
  it('cages', () => {
    const read = at(CAGES_KEY, {
      size: 4,
      look: 'sun',
      clashes: false,
      bests: [
        { day: day(2026, 11, 13), size: 6, seconds: 754 },
        { day: day(2026, 11, 13), size: 4, seconds: 40 },
        { day: day(2026, 11, 9), size: 6, seconds: 300 },
      ],
      solvedCount: 1,
    })
    expect(PUZZLES.cages(read)).toBe('6×6 on 13 Nov in 12:34, 1 board solved')
    expect(PUZZLES.cages(at(CAGES_KEY, { size: 6, look: 'slate', solvedCount: 0 }))).toBeNull()
  })
  it('tents, across a month and past the hour', () => {
    const read = at(TENTS_KEY, {
      size: 8,
      look: 'beach',
      clashes: false,
      autoGrass: true,
      bests: [
        { day: day(2026, 11, 2), size: 10, seconds: 3725 },
        { day: day(2026, 10, 30), size: 10, seconds: 200 },
      ],
      solvedCount: 5,
    })
    expect(PUZZLES.tents(read)).toBe('10×10 on 2 Nov in 1:02:05, 5 fields solved')
    expect(PUZZLES.tents(at(TENTS_KEY, { autoGrass: true, bests: [] }))).toBeNull()
  })
  it('pipes: both boards of the biggest size, wrapped and not', () => {
    const read = at(PIPES_KEY, {
      size: 5,
      wrap: true,
      look: 'neon',
      bests: [
        { day: day(2026, 11, 14), size: 9, wrap: true, seconds: 130, turns: 52 },
        { day: day(2026, 11, 14), size: 9, wrap: false, seconds: 125, turns: 38 },
        { day: day(2026, 11, 14), size: 5, wrap: false, seconds: 20, turns: 9 },
        { day: day(2026, 11, 11), size: 9, wrap: false, seconds: 90, turns: 30 },
      ],
      solvedCount: 31,
    })
    expect(PUZZLES.pipes(read)).toBe(
      '9×9 on 14 Nov in 2:05 (38 turns), 9×9 wrapped in 2:10 (52 turns), 31 boards solved',
    )
    expect(PUZZLES.pipes(at(PIPES_KEY, { size: 9, wrap: true, solvedCount: 0 }))).toBeNull()
  })
  it('lamps: presses against par, with the pattern', () => {
    const read = at(LAMPS_KEY, {
      size: 4,
      pattern: 'cross',
      look: 'neon',
      bests: [
        { day: day(2026, 11, 14), size: 7, pattern: 'cross', presses: 20, par: 14 },
        { day: day(2026, 11, 14), size: 7, pattern: 'plus', presses: 16, par: 16 },
        { day: day(2026, 11, 14), size: 4, pattern: 'plus', presses: 5, par: 5 },
        { day: day(2026, 11, 10), size: 7, pattern: 'plus', presses: 12, par: 12 },
      ],
      solvedCount: 9,
    })
    expect(PUZZLES.lamps(read)).toBe(
      '7×7 ✖ on 14 Nov in 20 presses (par 14), 7×7 ✚ in 16 presses (par 16), 9 boards solved',
    )
    expect(PUZZLES.lamps(at(LAMPS_KEY, { size: 7, pattern: 'cross', bests: [] }))).toBeNull()
  })

  it('codebreaker: the daily code it cracked, and every code', () => {
    const spread = Array(13).fill(0)
    spread[0] = 2
    spread[3] = 1
    spread[4] = 3
    const read = at(CODE_KEY, {
      rules: { length: 5, colours: 8, repeats: false, tries: 12 },
      level: 'lucky',
      pegs: 'shapes',
      counting: true,
      spread,
      daily: { day: '2026-11-9', guesses: 4 },
    })
    expect(PUZZLES.codebreaker(read)).toBe(
      'cracked the 9 Nov code in 4 of 10, 4 codes cracked, fewest guesses 3',
    )
    // a lost daily and nothing but failures is nothing to share
    const lost = Array(13).fill(0)
    lost[0] = 3
    expect(
      PUZZLES.codebreaker(at(CODE_KEY, { spread: lost, daily: { day: '2026-11-9', guesses: 0 } })),
    ).toBeNull()
  })
  it('golf: the lowest score, signed the way the toy signs it', () => {
    const read = at(GOLF_KEY, {
      back: 'stars',
      felt: 'red',
      wrap: true,
      hints: false,
      played: 12,
      cleared: 5,
      best: -3,
      onPar: 4,
      today: { day: 12345, score: 2 },
    })
    expect(PUZZLES.golf(read)).toBe('best score −3, cleared 5 of 12 deals, 4 on par or better')
    // a score of 0 is a score, not nothing — and a deal not cleared says nothing about clearing
    expect(PUZZLES.golf(at(GOLF_KEY, { played: 1, best: 0 }))).toBe('best score 0')
    expect(PUZZLES.golf(at(GOLF_KEY, { felt: 'blue', played: 0, best: null }))).toBeNull()
  })
  it('levels: the rooms that come with it, and anybody else’s', () => {
    const read = at(LEVELS_KEY, {
      draft: encode(ROOMS[1]),
      kept: [encode({ ...ROOMS[0], name: 'My maze' })],
      best: {
        [encode(ROOMS[0])]: 12,
        [encode(ROOMS[2])]: 30,
        [encode({ ...ROOMS[0], name: 'My maze' })]: 9,
      },
      hero: { colour: 1, hat: 'crown' },
    })
    expect(PUZZLES.levels(read)).toBe('2 of 5 rooms solved, plus 1 player-made room')
    const mine = at(LEVELS_KEY, { best: { [encode({ ...ROOMS[3], name: 'Slide' })]: 4 } })
    expect(PUZZLES.levels(mine)).toBe('1 player-made room solved')
    expect(PUZZLES.levels(at(LEVELS_KEY, { draft: encode(ROOMS[1]), best: {} }))).toBeNull()
  })
  it('mines: the best time on each size, and the record', () => {
    const read = at(MINES_KEY, {
      size: 'large',
      theme: 'night',
      mark: 'star',
      best: { small: 123, large: 1875 },
      won: 14,
      played: 20,
      today: { day: 999, tenths: 150 },
    })
    expect(PUZZLES.mines(read)).toBe('best small 12.3 s, large 187.5 s, cleared 14 of 20 boards')
    expect(PUZZLES.mines(at(MINES_KEY, { theme: 'sand', won: 0, played: 4 }))).toBeNull()
  })
  it('pegs: the fewest left on each board, and the perfect finishes', () => {
    const read = at(PEGS_KEY, {
      board: 'triangle',
      look: 'glow',
      best: { english: 1, triangle: 2 },
      perfects: { english: 3, triangle: 0 },
    })
    expect(PUZZLES.pegs(read)).toBe('cross down to 1 peg (3 perfect), triangle down to 2 pegs')
    expect(
      PUZZLES.pegs(at(PEGS_KEY, { board: 'triangle', best: { english: 0, triangle: 0 } })),
    ).toBeNull()
  })
  it('sudoku: the best time at each level', () => {
    const read = at(SUDOKU_KEY, {
      level: 'tricky',
      theme: 'mint',
      clashes: false,
      best: { tricky: 903, gentle: 252 },
      today: { day: 5, seconds: 300 },
      solved: 12,
    })
    expect(PUZZLES.sudoku(read)).toBe('best gentle 4:12, tricky 15:03, 12 puzzles solved')
    expect(PUZZLES.sudoku(at(SUDOKU_KEY, { level: 'tricky', solved: 0 }))).toBeNull()
  })
  it('tiles: the best time on each layout, by name', () => {
    const read = at(TILES_KEY, {
      layout: 'twin',
      style: 'night',
      glow: true,
      best: { arches: 552, pyramid: 400 },
      today: { day: 5, seconds: 300 },
      cleared: 7,
    })
    expect(PUZZLES.tiles(read)).toBe('best Pyramid 6:40, Arches 9:12, 7 boards cleared')
    expect(PUZZLES.tiles(at(TILES_KEY, { layout: 'twin', cleared: 0 }))).toBeNull()
  })

  /* the four whose parser moved out of the component for this (keptBests.test.ts pins it): solved
     out of order, so "furthest" is the furthest in the toy's order and not the last one kept */
  it('fold: how many solved, and the furthest with its fewest folds', () => {
    const read = at(FOLD_KEY, {
      puzzle: 2,
      colour: 3,
      best: { [FOLDS[4].name]: 6, [FOLDS[0].name]: 1, [FOLDS[2].name]: 3 },
    })
    expect(PUZZLES.fold(read)).toBe(
      `3 of ${FOLDS.length} puzzles solved, up to ${FOLDS[4].name} in 6 folds`,
    )
    expect(PUZZLES.fold(at(FOLD_KEY, { puzzle: 4, colour: 1, best: {} }))).toBeNull()
  })
  it('shadow box: the furthest with its fewest blocks', () => {
    const read = at(SHADOWBOX_KEY, { puzzle: 1, best: { [BOXES[3].name]: 9, [BOXES[1].name]: 1 } })
    expect(PUZZLES.shadowbox(read)).toBe(
      `2 of ${BOXES.length} puzzles solved, up to ${BOXES[3].name} in 9 blocks`,
    )
    expect(PUZZLES.shadowbox(at(SHADOWBOX_KEY, { puzzle: 3, best: {} }))).toBeNull()
  })
  it('topple: the furthest with its fewest dominoes, one domino said as one', () => {
    const read = at(TOPPLE_KEY, {
      puzzle: 0,
      best: { [TOPPLES[1].name]: 1 },
      free: { dominoes: [], bells: [], walls: [] },
    })
    expect(PUZZLES.topple(read)).toBe(
      `1 of ${TOPPLES.length} puzzles solved, up to ${TOPPLES[1].name} in 1 domino`,
    )
    expect(PUZZLES.topple(at(TOPPLE_KEY, { puzzle: 2, best: {} }))).toBeNull()
  })
  it('seedling: the furthest garden with its seeds and generation', () => {
    const read = at(SEEDLING_KEY, {
      level: -1,
      best: { [GARDENS[5].name]: { seeds: 4, gen: 37 }, [GARDENS[1].name]: { seeds: 2, gen: 8 } },
    })
    expect(PUZZLES.seedling(read)).toBe(
      `2 of ${GARDENS.length} gardens solved, up to ${GARDENS[5].name} in 4 seeds (generation 37)`,
    )
    expect(PUZZLES.seedling(at(SEEDLING_KEY, { level: 2, best: {} }))).toBeNull()
  })
})
