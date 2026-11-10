import { describe, expect, it } from 'vitest'
import {
  EMPTY,
  around,
  bridgeSaves,
  chain,
  choose,
  empty,
  other,
  place,
  readSaved,
  recordGame,
  swap,
  winner,
  type Board,
  type Level,
  type Player,
  type Stone,
} from './hex'

const seeded = (seed: number) => {
  let s = seed >>> 0 || 1
  return () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    return (s >>> 0) / 2 ** 32
  }
}
/** a board from rows of '.', 'r' and 'b' */
const from = (rows: string[]): Board => ({
  n: rows.length,
  cells: rows
    .join('')
    .split('')
    .map((ch) => (ch === 'r' ? 1 : ch === 'b' ? 2 : 0) as Stone),
})

function game(hi: Level, lo: Level, seat: Player, n: number, seed: number) {
  const rand = seeded(seed)
  let b = place(empty(n), Math.floor(rand() * n * n), 1)
  let p: Player = 2
  while (!winner(b)) {
    b = place(b, choose(b, p, p === seat ? hi : lo, rand), p)
    p = other(p)
  }
  return winner(b) === seat
}

describe('the board', () => {
  it('a cell has six neighbours inside, fewer at the edges and corners', () => {
    expect(around(5, 12)).toHaveLength(6)
    expect(around(5, 0)).toHaveLength(2)
    expect(around(5, 4)).toHaveLength(3)
    expect(around(5, 24)).toHaveLength(2)
    for (let i = 0; i < 25; i++) for (const j of around(5, i)) expect(around(5, j)).toContain(i)
  })
  it('finds a chain edge to edge, zig-zags included, and not a broken one', () => {
    const red = from(['.r...', '.r...', 'r....', 'r....', 'r....'])
    expect(chain(red.cells, 5, 1)).not.toBeNull()
    expect(winner(red)).toBe(1)
    const broken = from(['.r...', '.r...', '.....', 'r....', 'r....'])
    expect(winner(broken)).toBeNull()
    const blue = from(['.....', 'bbb..', '..bbb', '.....', '.....'])
    expect(winner(blue)).toBe(2)
    // red's own edges do not count for blue, nor the other way round
    expect(chain(from(['rrrrr', '.....', '.....', '.....', '.....']).cells, 5, 1)).toBeNull()
  })
  it('a full board always has exactly one winner', () => {
    const rand = seeded(3)
    for (let k = 0; k < 300; k++) {
      const n = 3 + (k % 7)
      const cells = Array.from({ length: n * n }, () => (rand() < 0.5 ? 1 : 2) as Stone)
      const r = chain(cells, n, 1) !== null
      const b = chain(cells, n, 2) !== null
      expect(r !== b).toBe(true)
    }
  })
  it('the swap rule mirrors the first stone across to the second player', () => {
    const b = place(empty(9), 2 * 9 + 6, 1)
    const s = swap(b)
    expect(s.cells[6 * 9 + 2]).toBe(2)
    expect(s.cells.filter((c) => c).length).toBe(1)
    expect(() => swap(empty(9))).toThrow()
  })
  it('knows when a bridge has been cut into, and where to answer', () => {
    // red at (1,2) and (3,1) share exactly two neighbours, (2,1) and (2,2): a bridge
    const b = from(['.....', '..r..', '.....', '.r...', '.....'])
    expect(bridgeSaves(b, 1)).toEqual([])
    const cut = from(['.....', '..r..', '.b...', '.r...', '.....'])
    expect(bridgeSaves(cut, 1)).toEqual([2 * 5 + 2])
  })
})

describe('the computer', () => {
  it('takes a win in one, and blocks one when it can', () => {
    // red down the first column needs only the corner below it: one way to win, one to stop it
    const win = from(['r....', 'r....', 'r....', 'r....', '.b.b.'])
    for (const level of ['easy', 'fair', 'hard'] as Level[]) {
      const m = choose(win, 1, level, seeded(1))
      expect(winner(place(win, m, 1))).toBe(1)
    }
    for (const level of ['fair', 'hard'] as Level[])
      expect(choose(win, 2, level, seeded(2))).toBe(4 * 5)
  })
  // Measured from both seats: fair beat easy 16 of 16 and hard beat fair 13 of 16 on 9×9. This
  // checks 7×7, which is quicker. Seeded, so the same every run.
  it('each level beats the one below it, from either seat', () => {
    const wins = (hi: Level, lo: Level, games: number) => {
      let w = 0
      for (let g = 0; g < games; g++)
        for (const seat of [1, 2] as Player[]) if (game(hi, lo, seat, 7, 40 + g)) w++
      return w
    }
    // fair wins 7 of these 8 and hard 8 of 8
    expect(wins('fair', 'easy', 4)).toBeGreaterThanOrEqual(7)
    expect(wins('hard', 'fair', 4)).toBeGreaterThanOrEqual(7)
  }, 60000)
})

describe('hex saves', () => {
  it('a game moves the record on, and a loss ends the run', () => {
    let r = EMPTY.record.hard
    r = recordGame(r, true)
    r = recordGame(r, true)
    r = recordGame(r, false)
    expect(r).toEqual({ won: 2, lost: 1, streak: 0, best: 2 })
  })
  it('round-trips every field away from its default', () => {
    const s = {
      level: 'hard',
      size: 11,
      side: 2,
      swap: true,
      theme: 'paper',
      record: {
        easy: { won: 3, lost: 1, streak: 2, best: 3 },
        fair: { won: 4, lost: 5, streak: 0, best: 2 },
        hard: { won: 1, lost: 8, streak: 1, best: 1 },
      },
    }
    expect(readSaved(JSON.stringify(s))).toEqual(s)
  })
  it('a broken store loses only what is bad', () => {
    expect(readSaved('{')).toEqual(EMPTY)
    expect(readSaved(JSON.stringify({ size: 13, side: 5, swap: true }))).toEqual({
      ...EMPTY,
      swap: true,
    })
  })
})
