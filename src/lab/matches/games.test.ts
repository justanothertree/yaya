import { describe, expect, it, vi } from 'vitest'
import { GAMES } from '../../../supabase/functions/lab-move/core'
import { MATCH_TOYS } from './games'
import { MATCH_LEVELS, MATCH_NAMES, VERSUS_ONLY } from './names'

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
  fox: [{}, { level: 'hard' }],
  cube: [{}, { level: 'hard' }],
  artillery: [{}, { level: 'hard' }],
  bowling: [{}, { level: 'hard' }],
  curling: [{}, { level: 'hard' }],
  putt: [{}, { level: 'hard' }],
  darts: [{}, { level: 'hard' }],
  backgammon: [{}, { level: 'hard' }],
  seabattle: [
    {},
    { size: 8 },
    { size: 10, fleet: 'swarm', apart: false, again: true, level: 'hard' },
  ],
  dice: [{}, { level: 'fair' }],
  yacht: [{}, { level: 'hard' }],
  shut: [{}, { level: 'hard' }],
  codebreaker: [
    {},
    { length: 3, colours: 4 },
    { length: 5, colours: 8, repeats: false, tries: 12, level: 'hard' },
  ],
  shadowbox: [{}, { rounds: 1 }, { rounds: 5, level: 'hard' }],
  rps: [{}, { firstTo: 5 }, { firstTo: 10, level: 'hard' }],
  gin: [{}, { target: 100 }, { target: 50, level: 'hard' }],
  cribbage: [{}, { level: 'hard' }],
  dominoes: [{}, { target: 50 }, { target: 100, level: 'hard' }],
  hearts: [{}, { end: 50 }, { end: 100, level: 'hard' }],
  spades: [{}, { target: 200 }, { target: 500, level: 'hard' }],
  eights: [{}, { target: 50 }, { target: 100, level: 'hard' }],
  liars: [{}, { wild: false }, { wild: true, level: 'hard' }],
  poker: [{}, { level: 'hard' }],
  lamps: [{}, { size: 4, pattern: 'cross' }, { size: 7 }],
  twentyone: [{}, { rounds: 5 }, { rounds: 10, level: 'hard' }],
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
  fox: [],
  cube: [],
  artillery: [],
  bowling: [],
  curling: [],
  putt: [],
  darts: [],
  backgammon: [],
  seabattle: [{ size: 9 }, { fleet: 'armada' }, { apart: 'yes' }, { again: 1 }],
  dice: [],
  yacht: [],
  shut: [],
  codebreaker: [{ length: 6 }, { colours: 9 }, { repeats: 'no' }, { tries: 7 }],
  shadowbox: [{ rounds: 2 }, { rounds: '3' }, { rounds: 0 }],
  rps: [{ firstTo: 4 }, { firstTo: '3' }, { firstTo: 0 }],
  gin: [{ target: 75 }, { target: '50' }, { target: 0 }],
  cribbage: [],
  dominoes: [{ target: 75 }, { target: '100' }, { target: 0 }],
  hearts: [{ end: 75 }, { end: '100' }, { level: 'expert' }],
  spades: [{ target: 250 }, { target: '300' }, { level: 'expert' }],
  eights: [{ target: 75 }, { target: '100' }, { target: 0 }],
  liars: [{ wild: 'yes' }, { wild: 1 }],
  poker: [],
  lamps: [{ size: 8 }, { size: '5' }, { pattern: 'diagonal' }],
  twentyone: [{ rounds: 7 }, { rounds: '10' }],
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
      expect(toy.levels, demo).toEqual(GAMES[demo]({})!.rules.computer?.levels ?? [])
  })

  it('are versus alone exactly where the server offers no Together, which the challenges hide', () => {
    for (const demo of Object.keys(MATCH_TOYS)) {
      const rules = GAMES[demo]({})!.rules
      const together = (rules.modes ?? ['versus']).includes('together')
      expect(VERSUS_ONLY.has(demo), demo).toBe(!together)
      // a toy with Together has the computer to play it against, and one without has none
      expect(!!rules.computer, demo).toBe(together)
    }
  })

  it('all offer the levels a profile’s challenge lists without loading the rules', () => {
    for (const [demo, toy] of Object.entries(MATCH_TOYS))
      if (!VERSUS_ONLY.has(demo)) expect(toy.levels, demo).toEqual(MATCH_LEVELS)
  })
})
