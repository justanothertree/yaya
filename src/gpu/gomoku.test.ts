import { describe, expect, it } from 'vitest'
import { rng } from './bricks'
import {
  EMPTY,
  candidates,
  choose,
  newGame,
  place,
  readSaved,
  shape,
  undo,
  type Game,
  type Level,
  type Saved,
} from './gomoku'

const N = 13
const at = (r: number, c: number) => r * N + c
/** a game with stones placed by side, black to move unless said */
function board(black: [number, number][], white: [number, number][], turn: 1 | 2 = 1): Game {
  const g = newGame(N)
  const cells = g.cells.slice()
  for (const [r, c] of black) cells[at(r, c)] = 1
  for (const [r, c] of white) cells[at(r, c)] = 2
  return { ...g, cells, turn, moves: [...black, ...white].map(([r, c]) => at(r, c)) }
}

describe('a game', () => {
  it('is won by five in a row in any of the four directions, and by more than five', () => {
    const lines: [number, number][][] = [
      [0, 1, 2, 3, 4].map((k) => [6, 2 + k]),
      [0, 1, 2, 3, 4].map((k) => [2 + k, 6]),
      [0, 1, 2, 3, 4].map((k) => [2 + k, 2 + k]),
      [0, 1, 2, 3, 4].map((k) => [2 + k, 10 - k]),
    ]
    for (const line of lines) {
      const g = board(line.slice(0, 4), [
        [0, 0],
        [0, 1],
        [0, 2],
        [0, 3],
      ])
      const won = place(g, at(...line[4]))
      expect(won.winner).toBe(1)
      expect(won.line).toHaveLength(5)
      expect(won.over).toBe(true)
      // four is not enough
      expect(
        place(
          board(line.slice(0, 3), [
            [0, 0],
            [0, 1],
            [0, 2],
          ]),
          at(...line[3]),
        ).winner,
      ).toBe(0)
    }
    // the fifth stone in the middle of a gap makes six, which still wins
    const six = board(
      [
        [6, 1],
        [6, 2],
        [6, 4],
        [6, 5],
        [6, 6],
      ],
      [
        [0, 0],
        [0, 1],
        [0, 2],
        [0, 3],
        [0, 4],
      ],
    )
    expect(place(six, at(6, 3)).line).toHaveLength(6)
  })
  it('takes no stone on a taken point, and ends level when the board is full', () => {
    const g = place(newGame(N), at(6, 6))
    expect(place(g, at(6, 6))).toBe(g)
    // four by four can never hold five in a row: filled, it is over and nobody has won
    let small = newGame(4)
    for (let k = 0; k < 16; k++) {
      expect(small.over).toBe(false)
      small = place(small, k)
    }
    expect(small.over).toBe(true)
    expect(small.winner).toBe(0)
  })
  it('takes moves back, one or two at a time', () => {
    let g = newGame(N)
    for (const m of [at(6, 6), at(6, 7), at(7, 7)]) g = place(g, m)
    expect(undo(g).moves).toEqual([at(6, 6), at(6, 7)])
    expect(undo(g, 2).moves).toEqual([at(6, 6)])
    expect(undo(g, 2).turn).toBe(2)
  })
})

describe('the shapes', () => {
  it('see a five, an open four, and two threats at once', () => {
    const four = board(
      [
        [6, 3],
        [6, 4],
        [6, 5],
        [6, 6],
      ],
      [],
    )
    expect(shape(four.cells, N, at(6, 7), 1)).toBeGreaterThanOrEqual(1e7)
    const three = board(
      [
        [6, 4],
        [6, 5],
        [6, 6],
      ],
      [],
    )
    // an open three made an open four: unstoppable
    expect(shape(three.cells, N, at(6, 7), 1)).toBeGreaterThanOrEqual(1e6)
    // the same three closed at one end makes only a four
    const closed = board(
      [
        [6, 4],
        [6, 5],
        [6, 6],
      ],
      [[6, 3]],
    )
    expect(shape(closed.cells, N, at(6, 7), 1)).toBeLessThan(1e6)
    // two open twos crossing at a point make two open threes there
    const cross = board(
      [
        [6, 5],
        [6, 6],
        [4, 7],
        [5, 7],
      ],
      [],
    )
    expect(shape(cross.cells, N, at(6, 7), 1)).toBeGreaterThanOrEqual(3e5)
  })
  it('looks only near the stones, or at the middle of an empty board', () => {
    expect(candidates(newGame(N))).toEqual([at(6, 6)])
    const g = place(newGame(N), at(0, 0))
    const c = candidates(g)
    expect(c).toHaveLength(8)
    expect(c.every((i) => Math.floor(i / N) <= 2 && i % N <= 2)).toBe(true)
  })
})

describe('the computer', () => {
  it('wins when it can, and stops a five when it must', () => {
    for (const level of ['easy', 'fair', 'hard'] as Level[]) {
      const win = board(
        [
          [6, 3],
          [6, 4],
          [6, 5],
          [6, 6],
        ],
        [
          [3, 3],
          [3, 4],
          [3, 5],
          [3, 6],
        ],
      )
      expect([at(6, 2), at(6, 7)]).toContain(choose(win, level, rng(1)))
      const block = board(
        [
          [1, 1],
          [9, 9],
          [11, 2],
        ],
        [
          [6, 3],
          [6, 4],
          [6, 5],
          [6, 6],
        ],
      )
      // white has four open at both ends: black must take an end, every time — Easy, which now and
      // then plays a lesser point, included
      for (let k = 1; k <= 20; k++) {
        // the generator's first few numbers for a small seed are near nought, which would never
        // let Easy's now-and-then happen: let it run a little first
        const r = rng(k)
        for (let i = 0; i < 8; i++) r()
        expect([at(6, 2), at(6, 7)]).toContain(choose(block, level, r))
      }
    }
  })
  it('on Fair and Hard, stops an open three before it becomes an open four', () => {
    for (const level of ['fair', 'hard'] as Level[]) {
      const g = board(
        [
          [10, 1],
          [10, 11],
        ],
        [
          [6, 4],
          [6, 5],
          [6, 6],
        ],
      )
      expect([at(6, 3), at(6, 7)]).toContain(choose(g, level, rng(2)))
    }
  })
  it('wins more games, level by level, from both colours', () => {
    // measured on other games: Fair beats Easy 80 in 100 and loses 11; Hard beats Fair 64 in 100
    // and loses 14
    const games = (a: Level, b: Level, n: number) => {
      let won = 0
      for (let s = 1; s <= n; s++) {
        const rand = rng(s * 53)
        const aBlack = s % 2 === 1
        let g = newGame(N)
        while (!g.over) g = place(g, choose(g, (g.turn === 1) === aBlack ? a : b, rand))
        if (g.winner && (g.winner === 1) === aBlack) won++
      }
      return won
    }
    expect(games('fair', 'easy', 20)).toBeGreaterThanOrEqual(13)
    expect(games('hard', 'fair', 20)).toBeGreaterThanOrEqual(10)
  }, 60_000)
})

describe('what is kept', () => {
  it('round-trips every field that is not a default', () => {
    const s: Saved = {
      level: 'hard',
      size: 11,
      look: 'night',
      record: {
        easy: { won: 3, lost: 1, drawn: 1 },
        fair: { won: 2, lost: 5, drawn: 0 },
        hard: { won: 1, lost: 7, drawn: 2 },
      },
    }
    for (const k of Object.keys(s) as (keyof Saved)[]) expect(s[k]).not.toEqual(EMPTY[k])
    expect(readSaved(JSON.stringify(s))).toEqual(s)
    expect(readSaved('{"size":15,"look":"jade"}')).toEqual(EMPTY)
  })
})
