import { describe, expect, it } from 'vitest'
import { EMPTY, choose, moves, newGame, play, readSaved, type Level, type Who } from './ultimate'

const seeded = (seed: number) => {
  let s = seed >>> 0 || 1
  return () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    return (s >>> 0) / 2 ** 32
  }
}
const sq = (board: number, square: number) => board * 9 + square

describe('the rules', () => {
  it('opens with all 81 squares, and a square sends the other player to its board', () => {
    expect(moves(newGame())).toHaveLength(81)
    const g = play(newGame(), sq(4, 2))
    expect(g.next).toBe(2)
    expect(moves(g).every((m) => Math.floor(m / 9) === 2)).toBe(true)
    expect(() => play(g, sq(5, 0))).toThrow()
  })
  it('three in a row wins a small board, and a move sent to a finished board may go anywhere', () => {
    // X holds squares 0 and 1 of board 0 and is sent there: square 2 takes it
    const before = newGame()
    before.cells[sq(0, 0)] = 1
    before.cells[sq(0, 1)] = 1
    const g = play({ ...before, next: 0 }, sq(0, 2))
    expect(g.boards[0]).toBe(1)
    // O is now sent to board 2; play there and send X to board 0, which is won: X may go anywhere
    const h = play(g, sq(2, 0))
    expect(h.next).toBe(-1)
    expect(moves(h).some((m) => Math.floor(m / 9) === 0)).toBe(false)
    expect(moves(h).length).toBeGreaterThan(30)
  })
  it('three small boards in a row win the game', () => {
    let g = newGame()
    g = { ...g, boards: [1, 1, 0, 0, 0, 0, 0, 0, 0], cells: g.cells.slice() }
    // fill board 2 to two in a row for X, then complete it
    g.cells[sq(2, 0)] = 1
    g.cells[sq(2, 1)] = 1
    g = { ...g, next: 2 }
    const won = play(g, sq(2, 2))
    expect(won.boards[2]).toBe(1)
    expect(won.winner).toBe(1)
    expect(moves(won)).toEqual([])
  })
  it('a full small board with no line belongs to nobody', () => {
    let g = newGame()
    const fill = [1, 2, 1, 1, 2, 2, 2, 1] as const
    g = { ...g, cells: g.cells.slice(), next: 0 }
    fill.forEach((m, k) => (g.cells[sq(0, k)] = m))
    const after = play({ ...g, turn: 1 }, sq(0, 8))
    expect(after.boards[0]).toBe(3)
  })
})

describe('the computer', () => {
  it('wins the game in one when it can', () => {
    let g = newGame()
    g = { ...g, boards: [2, 2, 0, 0, 0, 0, 0, 0, 0], cells: g.cells.slice(), turn: 2, next: 2 }
    g.cells[sq(2, 4)] = 2
    g.cells[sq(2, 8)] = 2
    for (const level of ['easy', 'fair', 'hard'] as Level[])
      expect(play(g, choose(g, level, seeded(1))).winner).toBe(2)
  })
  it('fair beats easy from either seat, and every game ends', () => {
    let w = 0
    for (let k = 0; k < 2; k++)
      for (const seat of [1, 2] as Who[]) {
        const rand = seeded(30 + k)
        let g = newGame()
        for (let n = 0; n < 81 && !g.winner; n++)
          g = play(g, choose(g, g.turn === seat ? 'fair' : 'easy', rand))
        expect(g.winner).not.toBe(0)
        if (g.winner === seat) w++
      }
    expect(w).toBe(4)
  }, 60000)
})

describe('ultimate saves', () => {
  it('round-trips every field away from its default', () => {
    const s = {
      level: 'hard',
      marks: 'space',
      theme: 'neon',
      guide: false,
      record: {
        easy: { won: 3, lost: 1, drawn: 2 },
        fair: { won: 4, lost: 5, drawn: 1 },
        hard: { won: 1, lost: 8, drawn: 3 },
      },
    }
    expect(readSaved(JSON.stringify(s))).toEqual(s)
  })
  it('a broken store loses only what is bad', () => {
    expect(readSaved('{')).toEqual(EMPTY)
    expect(readSaved(JSON.stringify({ marks: 'runes', guide: false }))).toEqual({
      ...EMPTY,
      guide: false,
    })
  })
})
