import { describe, expect, it } from 'vitest'
import { rng } from './bricks'
import {
  EMPTY,
  HOLES,
  HOME,
  NEAR,
  at,
  goalOf,
  match,
  moves,
  movesFrom,
  newGame,
  play,
  progress,
  readSaved,
  won,
  type Saved,
} from './halma'

const blank = () => new Int8Array(HOLES.length)
const C = at(0, 0)

describe('the board', () => {
  it('is a star of 121 holes, with ten in each of the two points that are played', () => {
    expect(HOLES).toHaveLength(121)
    expect(HOME[1]).toHaveLength(10)
    expect(HOME[2]).toHaveLength(10)
    expect(goalOf(1)).toEqual(HOME[2])
    // every hole is next to at most six others, and being next to is mutual
    NEAR.forEach((ns, i) => {
      for (const n of ns) if (n >= 0) expect(NEAR[n]).toContain(i)
    })
    expect(NEAR[C].every((n) => n >= 0)).toBe(true)
    // a point's tip has only two neighbours
    const tip = at(4, -8)
    expect(NEAR[tip].filter((n) => n >= 0)).toHaveLength(2)
  })
  it('starts with each side in its own point, the bottom side to move', () => {
    const g = newGame()
    expect(HOME[1].every((i) => g.cells[i] === 1)).toBe(true)
    expect(HOME[2].every((i) => g.cells[i] === 2)).toBe(true)
    expect(g.turn).toBe(1)
    expect(HOME[1].every((i) => progress(i, 1) <= 3)).toBe(true)
    expect(HOME[2].every((i) => progress(i, 1) >= 13)).toBe(true)
  })
})

describe('a move', () => {
  it('steps to an empty neighbour', () => {
    const c = blank()
    c[C] = 1
    expect(
      movesFrom(c, C)
        .map((m) => m.to)
        .sort(),
    ).toEqual(NEAR[C].slice().sort())
  })
  it('hops over a neighbour, anybody’s, and keeps hopping, but never steps and hops together', () => {
    const c = blank()
    c[C] = 1
    c[at(1, 0)] = 2 // hop east to (2,0)
    c[at(3, 0)] = 1 // and again to (4,0)
    const m = movesFrom(c, C)
    const to = (q: number, r: number) => m.find((x) => x.to === at(q, r))
    expect(to(2, 0)?.path).toEqual([C, at(2, 0)])
    expect(to(4, 0)?.path).toEqual([C, at(2, 0), at(4, 0)])
    // a step after a hop is not a move: (5,0) is next to (4,0) but cannot be reached
    expect(to(5, 0)).toBeUndefined()
    // and nothing lands on a peg
    expect(to(1, 0)).toBeUndefined()
    expect(to(3, 0)).toBeUndefined()
  })
  it('turns corners on a chain of hops, and lands on each hole once by its shortest way', () => {
    const c = blank()
    c[C] = 1
    c[at(1, 0)] = 2
    c[at(2, 1)] = 2 // from (2,0) hop south-east over (2,1) to (2,2)
    const m = movesFrom(c, C)
    expect(m.find((x) => x.to === at(2, 2))?.path).toEqual([C, at(2, 0), at(2, 2)])
    expect(new Set(m.map((x) => x.to)).size).toBe(m.length)
  })
  it('opens with fourteen moves from the start', () => {
    // the four front pegs step into the two holes ahead of each and the back pegs hop over them
    expect(moves(newGame())).toHaveLength(14)
  })
})

describe('the goal', () => {
  it('is won by filling the far point, with at least one of your own pegs among those in it', () => {
    const c = blank()
    for (const i of goalOf(1)) c[i] = 1
    expect(won(c, 1)).toBe(true)
    // a side that leaves its pegs at home cannot stop the other winning by them
    const spoil = blank()
    goalOf(1).forEach((i, k) => (spoil[i] = k === 0 ? 1 : 2))
    expect(won(spoil, 1)).toBe(true)
    const all2 = blank()
    for (const i of goalOf(1)) all2[i] = 2
    expect(won(all2, 1)).toBe(false)
    const gap = blank()
    goalOf(1).forEach((i, k) => (gap[i] = k === 0 ? 0 : 1))
    expect(won(gap, 1)).toBe(false)
  })
  it('ends the game on the move that fills it', () => {
    const g = newGame()
    const cells = blank()
    const goal = goalOf(1)
    goal.slice(1).forEach((i) => (cells[i] = 1))
    const last = goal[0]
    const from = NEAR[last].find((n) => n >= 0 && !goal.includes(n))!
    cells[from] = 1
    cells[HOME[1][0]] = 2
    const after = play({ ...g, cells }, { from, to: last, path: [from, last] })
    expect(after.winner).toBe(1)
  })
})

describe('the computer', () => {
  it('plays better level by level, and every game finishes', () => {
    // measured on other games: Fair beats Easy 48 in 60, Hard beats Fair 38 in 40
    let fair = 0
    for (let s = 1; s <= 16; s++) {
      const r = s % 2 ? match('fair', 'easy', rng(s), 1) : match('easy', 'fair', rng(s), 1)
      expect(r.winner).not.toBe(0)
      if (r.winner === (s % 2 ? 1 : 2)) fair++
    }
    expect(fair).toBeGreaterThanOrEqual(12)
    let hard = 0
    for (let s = 1; s <= 10; s++) {
      const r = s % 2 ? match('hard', 'fair', rng(s), 1) : match('fair', 'hard', rng(s), 1)
      if (r.winner === (s % 2 ? 1 : 2)) hard++
    }
    expect(hard).toBeGreaterThanOrEqual(8)
  }, 60_000)
})

describe('what is kept', () => {
  it('round-trips every field that is not a default', () => {
    const s: Saved = {
      level: 'hard',
      look: 'night',
      hints: false,
      record: {
        easy: { won: 3, lost: 1, fewest: 38 },
        fair: { won: 2, lost: 5, fewest: 44 },
        hard: { won: 1, lost: 7, fewest: 51 },
      },
    }
    for (const k of Object.keys(s) as (keyof Saved)[]) expect(s[k]).not.toEqual(EMPTY[k])
    expect(readSaved(JSON.stringify(s))).toEqual(s)
    expect(readSaved('{"look":"jade","hints":0}')).toEqual(EMPTY)
  })
})
