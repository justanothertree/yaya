import { describe, expect, it } from 'vitest'
import {
  EMPTY,
  choose,
  count,
  flips,
  moves,
  nextTurn,
  place,
  readSaved,
  recordGame,
  start,
  weights,
  type Board,
  type Disc,
  type Level,
  type Who,
} from './reversi'

const seeded = (seed: number) => {
  let s = seed >>> 0 || 1
  return () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    return (s >>> 0) / 2 ** 32
  }
}
/** a board from rows of '.', 'x' (dark) and 'o' (light) */
const from = (rows: string[]): Board => ({
  n: rows.length,
  cells: rows
    .join('')
    .split('')
    .map((ch) => (ch === 'x' ? 1 : ch === 'o' ? 2 : 0) as Disc),
})
const at = (n: number, r: number, c: number) => r * n + c

function game(hi: Level, lo: Level, seat: Who, n: number, seed: number) {
  const rand = seeded(seed)
  let b = start(n)
  let who: Who | null = 1
  let placed = 4
  while (who) {
    b = place(b, choose(b, who, who === seat ? hi : lo, rand), who)
    placed++
    const [d, l] = count(b)
    expect(d + l).toBe(placed)
    who = nextTurn(b, who)
  }
  const [d, l] = count(b)
  return seat === 1 ? d - l : l - d
}

describe('the rules', () => {
  it('starts with four discs and four moves for dark', () => {
    const b = start(8)
    expect(count(b)).toEqual([2, 2])
    expect(moves(b, 1).sort((a, c) => a - c)).toEqual([
      at(8, 2, 3),
      at(8, 3, 2),
      at(8, 4, 5),
      at(8, 5, 4),
    ])
    expect(moves(start(6), 1)).toHaveLength(4)
  })
  it('turns over every bracketed line, in all eight directions at once', () => {
    const b = from(['xxxxx', 'xooox', 'xo.ox', 'xooox', 'xxxxx'])
    const f = flips(b, at(5, 2, 2), 1)
    expect(f).toHaveLength(8)
    const after = place(b, at(5, 2, 2), 1)
    expect(count(after)).toEqual([25, 0])
  })
  it('a line that runs into the edge or a gap is not bracketed', () => {
    const b = from(['.oox', 'o...', 'o...', '....'])
    expect(flips(b, 0, 1)).toEqual([1, 2])
    expect(() => place(b, at(4, 3, 3), 1)).toThrow()
  })
  it('a side with no move passes, and the game ends when neither has one', () => {
    // light has nowhere to go, so dark moves again
    const b = from(['xo..', '....', '....', '....'])
    expect(moves(b, 2)).toEqual([])
    expect(nextTurn(b, 2)).toBe(1)
    const full = from(['xxxx', 'xxxx', 'xxxx', 'xxxo'])
    expect(nextTurn(full, 1)).toBeNull()
  })
  it('weighs the corners highest and the squares that hand them over lowest, alike on every side', () => {
    for (const n of [6, 8, 10]) {
      const w = weights(n)
      expect(w[0]).toBe(100)
      expect(w[at(n, 1, 1)]).toBe(-40)
      for (let r = 0; r < n; r++)
        for (let c = 0; c < n; c++) {
          expect(w[at(n, r, c)]).toBe(w[at(n, c, r)])
          expect(w[at(n, r, c)]).toBe(w[at(n, n - 1 - r, c)])
        }
    }
  })
})

describe('the computer', () => {
  it('takes a corner when it is offered', () => {
    const b = from([
      '.oox....',
      '........',
      '........',
      '...ox...',
      '...xo...',
      '........',
      '........',
      '........',
    ])
    for (const level of ['fair', 'hard'] as Level[]) expect(choose(b, 1, level, seeded(2))).toBe(0)
  })
  // Each seed is played from both seats, since moving first matters. Measured: fair beat easy 8–0
  // on 8×8 and 11–1 on 6×6; hard beat fair 8–0 on 8×8, 4–0 on 10×10 and 12–0 on 6×6 once it looked
  // further on the small board (4–4 before). Hard's slowest move was 410 ms, on 6×6. Seeded, so the
  // same every run.
  it('each level beats the one below it, from either seat, and every disc is counted', () => {
    const wins = (hi: Level, lo: Level, n: number, games: number) => {
      let w = 0
      for (let k = 0; k < games; k++)
        for (const seat of [1, 2] as Who[]) if (game(hi, lo, seat, n, 700 + k) > 0) w++
      return w
    }
    expect(wins('fair', 'easy', 8, 3)).toBeGreaterThanOrEqual(5)
    expect(wins('hard', 'fair', 8, 3)).toBeGreaterThanOrEqual(5)
  }, 60000)
})

describe('reversi saves', () => {
  it('a game moves the record on', () => {
    let r = EMPTY.record.fair
    r = recordGame(r, 40, 24)
    r = recordGame(r, 32, 32)
    r = recordGame(r, 10, 54)
    expect(r).toEqual({ won: 1, lost: 1, drawn: 1, best: 16 })
  })
  it('round-trips every field away from its default', () => {
    const s = {
      level: 'hard',
      size: 10,
      board: 'slate',
      discs: 'candy',
      side: 2,
      hints: false,
      record: {
        easy: { won: 3, lost: 1, drawn: 2, best: 9 },
        fair: { won: 4, lost: 5, drawn: 1, best: 7 },
        hard: { won: 1, lost: 8, drawn: 3, best: 2 },
      },
    }
    expect(readSaved(JSON.stringify(s))).toEqual(s)
  })
  it('a broken store loses only what is bad', () => {
    expect(readSaved('{')).toEqual(EMPTY)
    expect(readSaved(JSON.stringify({ size: 7, side: 3, discs: 'gold', hints: false }))).toEqual({
      ...EMPTY,
      hints: false,
    })
  })
})
