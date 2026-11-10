import { describe, expect, it } from 'vitest'
import {
  DRAW_AFTER,
  EMPTY,
  at,
  choose,
  colOf,
  count,
  moves,
  newGame,
  play,
  readSaved,
  rowOf,
  type Game,
  type Level,
  type Piece,
  type Who,
} from './draughts'

const seeded = (seed: number) => {
  let s = seed >>> 0 || 1
  return () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    return (s >>> 0) / 2 ** 32
  }
}
/** a board with pieces where they are asked to be, by row and column */
const board = (pieces: [number, number, Piece][], turn: Who = 1): Game => {
  const b = Array<Piece>(32).fill(0)
  for (const [r, c, p] of pieces) b[at(r, c)] = p
  return { board: b, turn, quiet: 0, winner: 0 }
}
const sq = (r: number, c: number) => at(r, c)

describe('the board', () => {
  it('numbers the 32 dark squares, and only those', () => {
    const seen = new Set<number>()
    for (let i = 0; i < 32; i++) {
      expect((rowOf(i) + colOf(i)) % 2).toBe(1)
      expect(at(rowOf(i), colOf(i))).toBe(i)
      seen.add(rowOf(i) * 8 + colOf(i))
    }
    expect(seen.size).toBe(32)
    expect(at(0, 0)).toBe(-1)
    expect(at(-1, 1)).toBe(-1)
  })
  it('starts with twelve each, and the first side has seven moves', () => {
    const g = newGame()
    expect(count(g, 1)).toBe(12)
    expect(count(g, 2)).toBe(12)
    expect(moves(g)).toHaveLength(7)
    for (const m of moves(g)) expect(rowOf(m.path[1])).toBe(4)
  })
})

describe('the rules', () => {
  it('a man steps diagonally forward only; a king both ways', () => {
    const man = board([
      [4, 3, 1],
      [0, 1, 2],
    ])
    expect(
      moves(man)
        .map((m) => m.path[1])
        .sort((a, b) => a - b),
    ).toEqual([sq(3, 2), sq(3, 4)])
    const king = board([
      [4, 3, 3],
      [0, 1, 2],
    ])
    expect(moves(king)).toHaveLength(4)
  })
  it('a capture must be taken, and a piece keeps jumping while it can', () => {
    // a single take is open to the man on the left, a double to the man on the right
    const g = board([
      [6, 1, 1],
      [5, 2, 2],
      [6, 5, 1],
      [5, 6, 2],
      [3, 6, 2],
      [0, 7, 2],
    ])
    const list = moves(g)
    expect(list.every((m) => m.taken.length)).toBe(true)
    const double = list.find((m) => m.path[0] === sq(6, 5))!
    expect(double.path).toEqual([sq(6, 5), sq(4, 7), sq(2, 5)])
    const after = play(g, double)
    expect(count(after, 2)).toBe(2)
    expect(after.board[sq(2, 5)]).toBe(1)
  })
  it('a man crowned by a jump stops there, even with another take beside it', () => {
    // over (1,2) to the far row; as a king it could then take (1,4), but the move has ended
    const g = board([
      [2, 1, 1],
      [1, 2, 2],
      [1, 4, 2],
      [7, 0, 2],
    ])
    const m = moves(g)
    expect(m).toHaveLength(1)
    expect(m[0].path).toEqual([sq(2, 1), sq(0, 3)])
    const after = play(g, m[0])
    expect(after.board[sq(0, 3)]).toBe(3)
    expect(after.turn).toBe(2)
  })
  it('a side with nothing left, or nowhere to go, has lost', () => {
    const last = play(
      board([
        [3, 2, 1],
        [2, 3, 2],
      ]),
      moves(
        board([
          [3, 2, 1],
          [2, 3, 2],
        ]),
      )[0],
    )
    expect(last.winner).toBe(1)
    // side 2's man on (6,1) is blocked by (7,0) and (7,2), and cannot be taken by them either:
    // the squares behind it, (5,0) and (5,2), are side 1's too
    const stuck = board([
      [7, 0, 1],
      [7, 2, 1],
      [5, 0, 1],
      [5, 2, 1],
      [6, 1, 2],
      [4, 5, 1],
    ])
    const after = play(stuck, moves(stuck).find((m) => m.path[0] === sq(4, 5))!)
    expect(moves(after)).toEqual([])
    expect(after.winner).toBe(1)
  })
  it(`kings moving to and fro for ${DRAW_AFTER} moves is a draw; a man's step resets it`, () => {
    const g = {
      ...board([
        [7, 0, 3],
        [0, 7, 4],
      ]),
      quiet: DRAW_AFTER - 1,
    }
    expect(play(g, moves(g)[0]).winner).toBe(3)
    const man = {
      ...board([
        [5, 0, 1],
        [0, 7, 4],
      ]),
      quiet: DRAW_AFTER - 1,
    }
    expect(play(man, moves(man)[0]).quiet).toBe(0)
  })
})

describe('the computer', () => {
  it('takes the double over the single, at every level that looks ahead', () => {
    const g = board([
      [6, 1, 1],
      [5, 2, 2],
      [6, 5, 1],
      [5, 6, 2],
      [3, 6, 2],
      [0, 7, 2],
      [0, 1, 2],
    ])
    for (const lv of ['fair', 'hard'] as Level[])
      for (let k = 1; k <= 3; k++) expect(choose(g, lv, seeded(k)).taken).toHaveLength(2)
  })
  // measured from both seats over eight seeded games: fair beat easy 8–0 and hard beat fair 8–0.
  // Hard cut to depth 2 goes red here. Fair cut to easy's depth does not: what separates those two
  // in a game is mostly easy's stray moves, which is what easy is for.
  it('each level beats the one below it, from either seat', () => {
    const wins = (hi: Level, lo: Level) => {
      let w = 0
      for (let k = 0; k < 2; k++)
        for (const seat of [1, 2] as Who[]) {
          const rand = seeded(50 + k)
          let g = newGame()
          for (let n = 0; n < 400 && !g.winner; n++)
            g = play(g, choose(g, g.turn === seat ? hi : lo, rand))
          if (g.winner === seat) w++
        }
      return w
    }
    expect(wins('fair', 'easy')).toBe(4)
    expect(wins('hard', 'fair')).toBeGreaterThanOrEqual(3)
  }, 60000)
})

describe('draughts saves', () => {
  it('round-trips every field away from its default', () => {
    const s = {
      level: 'hard',
      board: 'ice',
      pieces: 'mint',
      hints: false,
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
    expect(readSaved(JSON.stringify({ board: 'marble', hints: false, level: 'fair' }))).toEqual({
      ...EMPTY,
      hints: false,
    })
  })
})
