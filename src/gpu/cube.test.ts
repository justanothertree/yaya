import { describe, expect, it } from 'vitest'
import { rng } from './bricks'
import {
  EMPTY,
  LINES,
  THROUGH,
  choose,
  forcedWin,
  match,
  newGame,
  place,
  readSaved,
  undo,
  winsAt,
  type Level,
  type Saved,
} from './cube'

const cell = (l: number, r: number, c: number) => l * 16 + r * 4 + c
/** a fresh generator that has run a little: its first numbers for a small seed are near nought */
const warm = (s: number) => {
  const r = rng(s)
  for (let i = 0; i < 6; i++) r()
  return r
}

describe('the cube', () => {
  it('has seventy-six lines of four, each straight and each different', () => {
    expect(LINES).toHaveLength(76)
    expect(new Set(LINES.map((l) => [...l].sort((a, b) => a - b).join())).size).toBe(76)
    // 16 in each direction of a layer across three axes is 48; 6 diagonals in each of 3 planes
    // of slices is 24; and the 4 long diagonals through the middle
    for (const line of LINES) {
      const p = line.map((i) => [Math.floor(i / 16), Math.floor(i / 4) % 4, i % 4])
      const step = [0, 1, 2].map((a) => p[1][a] - p[0][a])
      for (let k = 1; k < 4; k++)
        for (let a = 0; a < 3; a++) expect(p[k][a] - p[k - 1][a]).toBe(step[a])
    }
    // the corners and the eight middle cells lie on seven lines; the rest on four
    expect(THROUGH[cell(0, 0, 0)]).toHaveLength(7)
    expect(THROUGH[cell(1, 1, 1)]).toHaveLength(7)
    expect(THROUGH[cell(0, 0, 1)]).toHaveLength(4)
  })
})

describe('a game', () => {
  it('is won by four in a line through the layers, straight down or slanting', () => {
    const down = [0, 1, 2, 3].map((l) => cell(l, 2, 1))
    const slant = [0, 1, 2, 3].map((l) => cell(l, l, 3 - l))
    for (const line of [down, slant]) {
      let g = newGame()
      const others = [cell(0, 0, 0), cell(0, 0, 1), cell(0, 0, 2)].filter((i) => !line.includes(i))
      for (let k = 0; k < 3; k++) g = place(place(g, line[k]), others[k] ?? cell(3, 0, 0))
      expect(g.over).toBe(false)
      g = place(g, line[3])
      expect(g.winner).toBe(1)
      expect([...g.line].sort((a, b) => a - b)).toEqual([...line].sort((a, b) => a - b))
    }
  })
  it('takes no mark on a taken cell, and can take moves back', () => {
    let g = place(newGame(), 5)
    expect(place(g, 5)).toBe(g)
    g = place(g, 9)
    g = place(g, 13)
    expect(undo(g).moves).toEqual([5, 9])
    expect(undo(g, 2).moves).toEqual([5])
    expect(undo(g, 2).turn).toBe(2)
  })
})

describe('the computer', () => {
  it('sees a threat, and takes a win or blocks one', () => {
    const g = newGame()
    const cells = g.cells.slice()
    for (const c of [0, 1, 2]) cells[cell(0, 0, c)] = 2
    expect(winsAt(cells, 2)).toEqual([cell(0, 0, 3)])
    // every level, and every time: Easy, which otherwise picks among its best few, included
    for (const level of ['easy', 'fair', 'hard'] as Level[])
      for (let s = 1; s <= 20; s++) {
        expect(choose({ ...g, cells, turn: 1 }, level, warm(s))).toBe(cell(0, 0, 3))
        expect(choose({ ...g, cells, turn: 2 }, level, warm(s))).toBe(cell(0, 0, 3))
      }
  })
  it('finds a win by threats alone, where one mark makes two that cannot both be blocked', () => {
    // crosses on two lines that meet at a corner, each holding two: a mark at the meeting point
    // threatens both lines at once
    const cells = new Int8Array(64)
    for (const i of [cell(0, 0, 1), cell(0, 0, 2), cell(0, 1, 0), cell(0, 2, 0)]) cells[i] = 1
    expect(forcedWin(cells, 1)).toBe(cell(0, 0, 0))
    // and none where there is nothing to make a threat with
    expect(forcedWin(new Int8Array(64), 1)).toBe(-1)
  })
  it('plays better level by level, from both sides', () => {
    // measured on other games: Fair beats Easy 55 in 60, Hard beats Fair 42 in 60
    const games = (a: Level, b: Level, n: number) => {
      let won = 0
      for (let s = 1; s <= n; s++) {
        const r = s % 2 ? match(a, b, warm(s * 97)) : match(b, a, warm(s * 97))
        if (r.winner === (s % 2 ? 1 : 2)) won++
      }
      return won
    }
    expect(games('fair', 'easy', 20)).toBeGreaterThanOrEqual(12)
    expect(games('hard', 'fair', 12)).toBeGreaterThanOrEqual(8)
  }, 60_000)
})

describe('what is kept', () => {
  it('round-trips every field that is not a default', () => {
    const s: Saved = {
      level: 'hard',
      look: 'neon',
      hints: true,
      record: {
        easy: { won: 3, lost: 1, drawn: 1 },
        fair: { won: 2, lost: 5, drawn: 0 },
        hard: { won: 1, lost: 7, drawn: 2 },
      },
    }
    for (const k of Object.keys(s) as (keyof Saved)[]) expect(s[k]).not.toEqual(EMPTY[k])
    expect(readSaved(JSON.stringify(s))).toEqual(s)
    expect(readSaved('{"look":"gold","hints":"yes"}')).toEqual(EMPTY)
  })
})
