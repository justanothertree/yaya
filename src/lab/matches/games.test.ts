import { describe, expect, it, vi } from 'vitest'
import { GAMES } from '../../../supabase/functions/lab-move/core'
import { MATCH_TOYS } from './games'
import { MATCH_LEVELS, MATCH_NAMES } from './names'

/**
 * The browser's list of match toys against the server's. A toy the server can play and the
 * browser cannot show would be a challenge nobody can open; the other way round, a board the
 * server refuses every move on. And the same settings must make the same game on both sides, or
 * the board on screen is not the board being played.
 */
const SETTINGS: Record<string, Record<string, unknown>[]> = {
  reversi: [{}, { size: null }, { size: 6 }, { size: 8 }, { size: 10 }, { size: 6, level: 'hard' }],
  chess: [{}, { level: 'easy' }],
  pool: [{}, { level: 'hard' }],
  gomoku: [{}, { size: null }, { size: 11 }, { size: 13 }, { size: 11, level: 'fair' }],
  draughts: [{}, { level: 'hard' }],
  dots: [{}, { size: null }, { size: 3 }, { size: 6 }, { size: 5, level: 'hard' }],
  fourrow: [{}, { size: 'small' }, { size: 'wide', need: 5 }, { size: 'classic', level: 'hard' }],
  mancala: [{}, { pits: 4 }, { seeds: 6, captures: false }, { pits: 5, seeds: 3, level: 'hard' }],
  morris: [{}, { level: 'hard' }],
  hex: [{}, { size: 7 }, { size: 11, swap: true }, { swap: false, level: 'hard' }],
  ultimate: [{}, { level: 'hard' }],
  breakthrough: [{}, { size: 6 }, { size: 8, level: 'hard' }],
  fences: [{}, { size: 7 }, { size: 9, level: 'hard' }],
  halma: [{}, { level: 'hard' }],
  go: [{}, { level: 'hard' }],
}
const REFUSED: Record<string, Record<string, unknown>[]> = {
  reversi: [{ size: 7 }, { size: '8' }, { size: 12 }],
  chess: [],
  pool: [],
  gomoku: [{ size: 12 }, { size: '13' }, { size: 15 }],
  draughts: [],
  dots: [{ size: 2 }, { size: '4' }, { size: 7 }],
  fourrow: [{ size: 'small', need: 5 }, { size: 'huge' }, { need: 3 }, { size: 7 }],
  mancala: [{ pits: 7 }, { pits: '6' }, { seeds: 2 }, { captures: 'yes' }],
  morris: [],
  hex: [{ size: 8 }, { size: '9' }, { swap: 'yes' }, { size: 13 }],
  ultimate: [],
  breakthrough: [{ size: 7 }, { size: '8' }, { size: 10 }],
  fences: [{ size: 8 }, { size: '9' }, { size: 11 }],
  halma: [],
  go: [],
}

describe('the match toys', () => {
  it('are the same toys in the browser, on the server and in the names the bell uses', () => {
    const server = Object.keys(GAMES).sort()
    expect(Object.keys(MATCH_TOYS).sort()).toEqual(server)
    expect(Object.keys(MATCH_NAMES).sort()).toEqual(server)
    expect(Object.keys(SETTINGS).sort()).toEqual(server)
  })

  it('make the same fresh game from the same settings, on both sides', () => {
    for (const [demo, list] of Object.entries(SETTINGS))
      for (const s of list) {
        const mine = MATCH_TOYS[demo].rulesFor(s)
        const theirs = GAMES[demo](s)?.rules
        expect(mine, `${demo} ${JSON.stringify(s)}`).not.toBeNull()
        // a fresh rack is shuffled from Math.random: the same draw on both sides, for the comparison
        const same = () => vi.spyOn(Math, 'random').mockReturnValue(0.4321)
        same()
        const a = mine!.encode(mine!.fresh('versus'))
        same()
        const b = theirs!.encode(theirs!.fresh('versus'))
        vi.restoreAllMocks()
        expect(a).toEqual(b)
        expect(mine!.modes).toEqual(theirs!.modes)
        expect(mine!.computer?.levels).toEqual(theirs!.computer?.levels)
      }
  })

  it('refuse the same settings, on both sides', () => {
    for (const [demo, list] of Object.entries(REFUSED))
      for (const s of list) {
        expect(MATCH_TOYS[demo].rulesFor(s), `${demo} ${JSON.stringify(s)}`).toBeNull()
        expect(GAMES[demo](s)).toBeNull()
      }
  })

  it('offer exactly the computer levels the server will accept', () => {
    for (const [demo, toy] of Object.entries(MATCH_TOYS))
      expect(toy.levels).toEqual(GAMES[demo]({})!.rules.computer!.levels)
  })

  it('all offer the levels a profile’s challenge lists without loading the rules', () => {
    for (const toy of Object.values(MATCH_TOYS)) expect(toy.levels).toEqual(MATCH_LEVELS)
  })
})
