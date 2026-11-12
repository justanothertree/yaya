import { describe, expect, it } from 'vitest'
import {
  EMPTY,
  HOUSES,
  PEERS,
  answers,
  clashes,
  hint,
  make,
  readSaved,
  reason,
  type Grid,
} from './sudoku'

describe('the grid', () => {
  it('27 houses of nine, and every cell sees twenty others', () => {
    expect(HOUSES).toHaveLength(27)
    for (const h of HOUSES) expect(new Set(h).size).toBe(9)
    for (const p of PEERS) expect(p).toHaveLength(20)
  })
  it('a digit twice in a row, column or box is a clash', () => {
    const g: Grid = Array(81).fill(0)
    g[0] = 5
    g[8] = 5
    expect([...clashes(g)].sort((a, b) => a - b)).toEqual([0, 8])
    g[8] = 6
    g[10] = 5
    expect([...clashes(g)].sort((a, b) => a - b)).toEqual([0, 10])
  })
})

describe('making puzzles', () => {
  // measured over twenty seeds each: gentle needed only singles every time, steady pointing or
  // pairs every time, tricky the third kind 13 times in 20 and the second otherwise; the slowest
  // tricky puzzle took 622 ms to make
  it('one answer each, the answer keeps every clue and every rule, and the reasoning matches the level', () => {
    const grades: Record<string, number[]> = { gentle: [], steady: [], tricky: [] }
    for (const level of ['gentle', 'steady', 'tricky'] as const)
      for (let seed = 1; seed <= 10; seed++) {
        const { puzzle, answer } = make(level, seed)
        expect(answers(puzzle)).toBe(1)
        puzzle.forEach((d, i) => d && expect(answer[i]).toBe(d))
        expect(answer.every(Boolean)).toBe(true)
        expect(clashes(answer).size).toBe(0)
        grades[level].push(reason(puzzle).level)
      }
    expect(grades.gentle.every((x) => x === 1)).toBe(true)
    expect(grades.steady.every((x) => x === 2)).toBe(true)
    expect(grades.tricky.every((x) => x >= 2)).toBe(true)
    expect(grades.tricky.filter((x) => x === 3).length).toBeGreaterThanOrEqual(5)
  }, 60000)
  it('the same seed makes the same puzzle', () => {
    expect(make('steady', 7).puzzle).toEqual(make('steady', 7).puzzle)
  })
})

/**
 * Three puzzles made once and written down, so the reasoner is tested on puzzles it had no part
 * in making. ⚠️ Tested only on fresh ones, a reasoner broken to guess between two places passed:
 * `make` uses the same reasoner to choose which clues to take away, so it kept exactly the clues
 * that let the broken one get lucky.
 */
const FIXED: [string, string, string, number][] = [
  [
    'gentle',
    '230001006000800005009000100000060802190020000005000000000050000800040600000003024',
    '234571986761894235589632147347965812198427563625318479412756398873249651956183724',
    1,
  ],
  [
    'steady',
    '100605000000340060000920300010090853200050000000006010038000600000400002002000009',
    '193675428827341965465928371716294853284153796359786214938512647671439582542867139',
    2,
  ],
  [
    'tricky',
    '500004800000960000004000730060000000790040000025009008000507190000012060000000003',
    '516734829273968451984251736461823975798645312325179648632587194849312567157496283',
    3,
  ],
]
const grid = (s: string) => s.split('').map(Number)

describe('reasoning', () => {
  it('solves the written-down puzzles at their grade, every step the right digit', () => {
    for (const [, p, a, level] of FIXED) {
      const r = reason(grid(p))
      expect(r.solved).toBe(true)
      expect(r.level).toBe(level)
      for (const s of r.steps) expect(s.digit).toBe(grid(a)[s.cell])
    }
  })
  it('every step it takes writes the digit the answer has there', () => {
    for (const level of ['gentle', 'steady', 'tricky'] as const)
      for (let seed = 20; seed < 26; seed++) {
        const { puzzle, answer } = make(level, seed)
        const r = reason(puzzle)
        expect(r.solved).toBe(true)
        for (const s of r.steps) expect(s.digit).toBe(answer[s.cell])
      }
  }, 60000)
  it('a hint names an empty cell and its right digit, with a reason in words', () => {
    const { puzzle, answer } = make('steady', 3)
    const h = hint(puzzle)!
    expect(puzzle[h.cell]).toBe(0)
    expect(h.digit).toBe(answer[h.cell])
    expect(h.why.length).toBeGreaterThan(10)
  })
})

describe('sudoku saves', () => {
  it('round-trips every field away from its default', () => {
    const s = {
      level: 'tricky',
      theme: 'night',
      clashes: false,
      best: { gentle: 120, steady: 400, tricky: 900 },
      today: { day: 3999999999, seconds: 512 },
      solved: 9,
    }
    expect(readSaved(JSON.stringify(s))).toEqual(s)
    expect(readSaved('[')).toEqual(EMPTY)
  })
})
