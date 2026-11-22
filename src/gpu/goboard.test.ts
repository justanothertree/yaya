import { describe, expect, it } from 'vitest'
import {
  EMPTY,
  KOMI,
  N,
  PASS,
  choose,
  group,
  newGame,
  play,
  readSaved,
  score,
  stampsFrom,
  PLAYOUTS,
  winner,
  type Game,
  type Stone,
  type Who,
} from './goboard'
import { rng } from './bricks'

/** a position from a picture: '.' empty, 'x' black, 'o' white, rows top to bottom */
const board = (rows: string[], turn: Who = 1): Game => ({
  ...newGame(),
  board: rows
    .join('')
    .split('')
    .map((ch) => (ch === 'x' ? 1 : ch === 'o' ? 2 : 0)) as Stone[],
  turn,
})
const at = (r: number, c: number) => r * N + c
const blank = '.........'

describe('stones and liberties', () => {
  it('a stone surrounded on every side is taken, and so is a whole group', () => {
    const g = board([
      '.x.......',
      'xo.......',
      '.x.......',
      blank,
      blank,
      blank,
      blank,
      blank,
      blank,
    ])
    const after = play(g, at(1, 2))!
    expect(after.board[at(1, 1)]).toBe(0)
    expect(after.taken[1]).toBe(1)
    const two = board(['xoox.....', '.xx......', blank, blank, blank, blank, blank, blank, blank])
    expect(group(two.board, at(0, 1)).liberties).toBe(0)
  })
  it('a move with no liberty is refused, unless it captures', () => {
    const g = board(['.o.......', 'o........', blank, blank, blank, blank, blank, blank, blank])
    expect(play(g, at(0, 0))).toBeNull()
    const takes = board([
      '.ox......',
      'ox.......',
      'x........',
      blank,
      blank,
      blank,
      blank,
      blank,
      blank,
    ])
    // black at the corner takes both white stones' last liberty... it fills its own last breath but captures
    const after = play(takes, at(0, 0))
    expect(after).not.toBeNull()
  })
  it('a single stone taken in a ko cannot be taken straight back', () => {
    const g = board(
      ['.xo......', 'xo.o.....', '.xo......', blank, blank, blank, blank, blank, blank],
      1,
    )
    const took = play(g, at(1, 2))!
    expect(took.board[at(1, 1)]).toBe(0)
    expect(took.ko).toBe(at(1, 1))
    expect(play(took, at(1, 1))).toBeNull()
    // after a move elsewhere and a reply, it may
    const later = play(play(took, at(8, 8))!, at(8, 0))!
    expect(play(later, at(1, 1))).not.toBeNull()
  })
  it('two passes in a row end the game', () => {
    const g = play(play(newGame(), PASS)!, PASS)!
    expect(g.over).toBe(true)
    expect(play(g, 0)).toBeNull()
  })
})

describe('the count', () => {
  it('stones plus the empty points only one colour reaches, and komi to white', () => {
    // black owns the left four columns, white the right four, column 4 is a wall of black
    const rows = Array.from({ length: N }, () => '....xo...')
    const s = score(board(rows).board)
    expect(s.black).toBe(5 * N)
    expect(s.white).toBe(4 * N + KOMI)
    expect(winner(board(rows))).toBe(1)
    // an empty point touching both counts for neither
    expect(score(board(['x.o......', ...Array(8).fill(blank)]).board).owner[1]).toBe(0)
  })
})

describe('the computer', () => {
  // a single stone already as good as dead is not worth taking at once, and random games agree;
  // four stones with one breath left are — the question is whether it sees the big capture
  it('takes a chain of four in atari', () => {
    const g = board(
      ['.........', '.xxxx....', 'xoooo....', '.xxxx....', blank, blank, blank, blank, blank],
      1,
    )
    // hard, every time; fair took it two times in three with these seeds — its playouts rate the
    // capture BELOW quiet moves (0.72-0.85 against about 0.9), and only the bias for taking stones
    // brings it back, so it is the level that plays out enough games to be asked
    for (let k = 1; k <= 5; k++) expect(choose(g, 'hard', rng(k))).toBe(at(2, 5))
  }, 30000)
  // measured: an Int32Array of stamps, with the count started 50 short of 2³¹, threw "NEIGH[p] is
  // not iterable" on the first move; the count reaches that in a long sitting at the hard level
  it('still plays once its walks have been counted past 2³¹', () => {
    stampsFrom(2 ** 31 - 50)
    expect(() => choose(newGame(), 'easy', rng(1))).not.toThrow()
    stampsFrom(0)
  })
  it('every move it makes is legal, and a game against itself ends', () => {
    const rand = rng(3)
    let g = newGame()
    while (!g.over && g.moves < 300) {
      const m = choose(g, 'easy', rand)
      const next = play(g, m)
      expect(next).not.toBeNull()
      g = next!
    }
    expect(g.over).toBe(true)
  }, 60000)
})

describe('the levels', () => {
  // measured at full strength from both colours: fair beat easy 6 of 6, hard beat fair 7 of 8, the
  // slowest hard move 406 ms. That is minutes of play, so the suite asks the same question smaller:
  // does a player with five times the playouts beat one without?
  it('more playouts beat fewer, from either colour', () => {
    const keep = { ...PLAYOUTS }
    Object.assign(PLAYOUTS, { easy: 40, fair: 200 })
    let wins = 0
    for (let s = 1; s <= 3; s++)
      for (const strong of [1, 2] as Who[]) {
        const rand = rng(s)
        let g = newGame()
        while (!g.over && g.moves < 250)
          g = play(g, choose(g, g.turn === strong ? 'fair' : 'easy', rand)) ?? play(g, PASS)!
        if (winner(g) === strong) wins++
      }
    Object.assign(PLAYOUTS, keep)
    expect(wins).toBeGreaterThanOrEqual(5)
  }, 120000)
})

describe('go saves', () => {
  it('round-trips every field away from its default', () => {
    const s = {
      level: 'hard',
      board: 'slate',
      shade: false,
      record: { easy: { won: 3, lost: 1 }, fair: { won: 4, lost: 6 }, hard: { won: 1, lost: 8 } },
    }
    expect(readSaved(JSON.stringify(s))).toEqual(s)
    expect(readSaved('x')).toEqual(EMPTY)
  })
})
