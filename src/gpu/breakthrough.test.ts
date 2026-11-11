import { describe, expect, it } from 'vitest'
import { rng } from './bricks'
import {
  EMPTY,
  HARD_BUDGET,
  advance,
  choose,
  count,
  covers,
  match,
  moves,
  movesOf,
  newGame,
  nodes,
  play,
  readSaved,
  value,
  type Board,
  type Game,
  type Saved,
  type Side,
} from './breakthrough'

/** a board from rows of text: 1 and 2 are pawns, . is empty; side 1 moves up */
const board = (...rows: string[]): Board => ({
  n: rows.length,
  cells: Int8Array.from(rows.join('').split(''), (ch) => (ch === '.' ? 0 : Number(ch))),
})
const game = (b: Board, turn: Side = 1): Game => ({ board: b, turn, winner: 0, plies: 0 })
const sq = (n: number, r: number, c: number) => r * n + c

describe('the board', () => {
  it('starts with two rows each, the bottom side to move, and every front pawn free', () => {
    const g = newGame(8)
    expect(count(g.board, 1)).toBe(16)
    expect(count(g.board, 2)).toBe(16)
    expect(g.turn).toBe(1)
    // eight front pawns: the two at the edges have two squares each, the six inside three
    expect(moves(g)).toHaveLength(2 * 2 + 6 * 3)
    expect(moves(newGame(6))).toHaveLength(2 * 2 + 4 * 3)
    expect(advance(8, sq(8, 7, 0), 1)).toBe(0)
    expect(advance(8, sq(8, 0, 0), 1)).toBe(7)
    expect(advance(8, sq(8, 0, 0), 2)).toBe(0)
  })
  it('steps forward straight or diagonally, and takes only on the diagonal', () => {
    const b = board(
      '......', //
      '......',
      '..2...',
      '..1...',
      '......',
      '......',
    )
    const m = movesOf(b, 1)
    // straight ahead is blocked by the pawn it faces, which it cannot take head-on
    expect(m.map((x) => x.to).sort((a, c) => a - c)).toEqual([sq(6, 2, 1), sq(6, 2, 3)])
    expect(m.every((x) => !x.take)).toBe(true)
    const b2 = board('......', '......', '.2.2..', '..1...', '......', '......')
    const takes = movesOf(b2, 1).filter((x) => x.take)
    expect(takes.map((x) => x.to).sort((a, c) => a - c)).toEqual([sq(6, 2, 1), sq(6, 2, 3)])
    // and the other side moves down the board
    expect(movesOf(b, 2).map((x) => x.to)).toEqual([sq(6, 3, 1), sq(6, 3, 3)])
  })
  it('is won by reaching the far row or by taking every pawn', () => {
    const near = game(board('.....2', '1.....', '......', '......', '......', '...2..'))
    const through = play(near, { from: sq(6, 1, 0), to: sq(6, 0, 0), take: false })
    expect(through.winner).toBe(1)
    const last = game(board('......', '......', '..2...', '.1....', '......', '......'))
    expect(play(last, { from: sq(6, 3, 1), to: sq(6, 2, 2), take: true }).winner).toBe(1)
    // a head-on block stops only the straight step: the blocked pawn still has its diagonals
    const block = game(board('2.....', '......', '......', '...2..', '......', '...1..'), 2)
    const after = play(block, { from: sq(6, 3, 3), to: sq(6, 4, 3), take: false })
    expect(after.winner).toBe(0)
    expect(moves(after)).toHaveLength(2)
    expect(play(newGame(6), moves(newGame(6))[0]).winner).toBe(0)
  })
  it('says which pawns guard a square and which threaten it', () => {
    const b = board('......', '......', '..2...', '.1.1..', '......', '......')
    // the 2 on c4 is threatened by both 1s; a 1 on c4 would be guarded by both
    expect(covers(b, sq(6, 2, 2), 1)).toBe(true)
    expect(covers(b, sq(6, 3, 1), 2)).toBe(true)
    expect(covers(b, sq(6, 3, 3), 2)).toBe(true)
    expect(covers(b, sq(6, 3, 1), 1)).toBe(false)
  })
})

describe('the computer', () => {
  it('steps through when it can', () => {
    const g = game(board('...2..', '.2.2..', '2.....', '......', '.1..1.', '..11..'), 2)
    // its pawn on a4 is one step from home: whatever else is on the board, that is the move
    const b = board('...2..', '.2.2..', '......', '......', '2...1.', '..11..')
    for (const level of ['easy', 'fair', 'hard'] as const) {
      const m = choose(game(b, 2), level, rng(3))
      expect(play(game(b, 2), m).winner).toBe(2)
    }
    expect(choose(g, 'fair', rng(1))).toBeTruthy()
  })
  it('counts a pawn stepping through as the end of the game, however deep in its look', () => {
    // c4 steps to b5, and whatever the other side answers it steps through on its next move; a look
    // that did not stop at the far row valued that no higher than taking a pawn on d3
    const b = board('.2.222', '2.2...', '..1...', '...2..', '11..11', '1...11')
    expect(choose(game(b, 1), 'fair', rng(1))).toEqual({ from: 14, to: 7, take: false })
  })
  it('takes the pawn that would otherwise step through next move', () => {
    // the bottom side's pawn on b5 is one step from home; the only answer is to take it
    const b = board('..2...', '.1....', '2.2...', '......', '...1..', '....11')
    for (const level of ['fair', 'hard'] as const) {
      const m = choose(game(b, 2), level, rng(5))
      expect(m.take).toBe(true)
      expect(m.to).toBe(sq(6, 1, 1))
    }
    // and it knows a pawn one step from home, with the move, is a win — and against it, that the
    // board is lost only when there is nothing to take it with
    expect(value(b, 1)).toBeGreaterThan(100_000)
    expect(value(b, 2)).toBeGreaterThan(-1000)
    const unguarded = board('....2.', '.1....', '2.2...', '......', '...1..', '....11')
    expect(value(unguarded, 2)).toBeLessThan(-100_000)
  })
  it('plays better level by level, from both seats', () => {
    const seat = (
      a: 'easy' | 'fair' | 'hard',
      b: 'easy' | 'fair' | 'hard',
      games: number,
      n: number,
    ) => {
      let won = 0
      for (let s = 1; s <= games; s++) {
        const r = s % 2 ? match(a, b, n, rng(s * 101)) : match(b, a, n, rng(s * 101))
        if (r.winner === (s % 2 ? 1 : 2)) won++
      }
      return won
    }
    // measured on other games: Fair beats Easy 56 in 60, Hard beats Fair 40 in 40; here 16 and 10
    expect(seat('fair', 'easy', 16, 8)).toBeGreaterThanOrEqual(13)
    expect(seat('hard', 'fair', 10, 6)).toBeGreaterThanOrEqual(8)
  }, 60_000)
  it('on Hard, sees a win five plies off that four plies cannot', () => {
    // found by playing Fair against itself until a position came up where only the deeper look
    // finds a forced win: the pawn on c3 steps up, and nothing saves the other side
    const b = board('.2.222', '2...22', '....2.', '.21.1.', '.1.1.1', '11..11')
    expect(choose(game(b, 1), 'hard', rng(1))).toEqual({ from: 20, to: 14, take: false })
  })
  it('calls off a five-ply look that runs past its budget, and still moves', () => {
    // four plies into a game on the big board, from a Hard-against-Fair game where it happened:
    // the five-ply look does not fit, so the four-ply answer decides
    const g = game(
      board(
        '22222222',
        '222.2222',
        '........',
        '.....2..',
        '........',
        '1...1...',
        '.111.111',
        '11111111',
      ),
    )
    const m = choose(g, 'hard', rng(2))
    expect(moves(g)).toContainEqual(m)
    // called off, not finished under the budget: otherwise this would say nothing
    expect(nodes).toBe(HARD_BUDGET + 1)
  })
})

describe('what is kept', () => {
  it('round-trips every field that is not a default', () => {
    const s: Saved = {
      level: 'hard',
      size: 6,
      look: 'neon',
      hints: false,
      record: {
        easy: { won: 3, lost: 1, fastest: 21 },
        fair: { won: 2, lost: 5, fastest: 30 },
        hard: { won: 1, lost: 7, fastest: 44 },
      },
    }
    for (const k of Object.keys(s) as (keyof Saved)[]) expect(s[k]).not.toEqual(EMPTY[k])
    expect(readSaved(JSON.stringify(s))).toEqual(s)
  })
  it('falls back on anything it does not recognise', () => {
    expect(readSaved('{"size":7,"look":"gold","hints":"yes"}')).toEqual(EMPTY)
    expect(readSaved('[]')).toEqual(EMPTY)
    expect(readSaved('{')).toEqual(EMPTY)
  })
})
