import { describe, expect, it } from 'vitest'
import {
  E,
  EMPTY,
  N,
  S,
  W,
  across,
  keepBest,
  make,
  openEnds,
  par,
  reached,
  readSaved,
  rotate,
  solved,
  turn,
  type Board,
  type Saved,
} from './pipes'

const bits = (t: number) => [N, E, S, W].filter((s) => t & s).length
/** the shape of a tile, whichever way it is turned */
const shape = (t: number) => Math.min(t, turn(t, 1), turn(t, 2), turn(t, 3))

describe('tiles', () => {
  it('turn a quarter clockwise, and four turns is none', () => {
    expect(turn(N)).toBe(E)
    expect(turn(E)).toBe(S)
    expect(turn(W)).toBe(N)
    expect(turn(N | E)).toBe(E | S)
    for (let t = 0; t < 16; t++) {
      expect(turn(t, 4)).toBe(t)
      expect(turn(turn(t, 1), -1)).toBe(t)
      expect(bits(turn(t, 3))).toBe(bits(t))
    }
  })
  it('find their neighbours, off the edge only when the board does not wrap', () => {
    expect(across(5, false, 0, N)).toBe(-1)
    expect(across(5, false, 0, E)).toBe(1)
    expect(across(5, true, 0, N)).toBe(20)
    expect(across(5, true, 4, E)).toBe(0)
  })
})

describe('a board', () => {
  for (const wrap of [false, true])
    it(`is laid as one tree over every square${wrap ? ', wrapping' : ''}`, () => {
      for (let seed = 1; seed < 60; seed++) {
        const b = make(seed, 7, wrap)
        const laid: Board = { ...b, tiles: b.solution }
        // a tree: everything reached, nothing open, and one fewer link than squares
        expect(solved(laid)).toBe(true)
        const links = b.solution.reduce((s, t) => s + bits(t), 0) / 2
        expect(links).toBe(49 - 1)
        expect(b.solution.every((t) => t !== 0)).toBe(true)
      }
    })
  it('is handed out turned, keeping every tile’s shape', () => {
    for (let seed = 1; seed < 40; seed++) {
      const b = make(seed, 5)
      expect(solved(b)).toBe(false)
      b.tiles.forEach((t, i) => expect(shape(t)).toBe(shape(b.solution[i])))
      // and properly turned, not one tile out: most tiles need at least a turn
      expect(par(b)).toBeGreaterThanOrEqual(25 / 4)
    }
  })
  it('is the same board for the same seed', () => {
    expect(make(42, 9)).toEqual(make(42, 9))
    expect(make(42, 9).solution).not.toEqual(make(43, 9).solution)
  })
})

describe('the water', () => {
  it('flows only through sides that open onto each other', () => {
    // a straight north-south over a straight east-west: they do not meet
    const b: Board = { n: 5, wrap: false, solution: [], tiles: new Array(25).fill(0), source: 12 }
    b.tiles[12] = N | S
    b.tiles[7] = E | W
    expect([...reached(b)]).toEqual([12])
    expect(openEnds(b)).toBe(4)
    b.tiles[7] = S
    expect(reached(b).has(7)).toBe(true)
    expect(openEnds(b)).toBe(1) // the source's south end
  })
  it('counts a pipe pointing off the edge as open, unless the board wraps', () => {
    const b: Board = { n: 5, wrap: false, solution: [], tiles: new Array(25).fill(0), source: 0 }
    b.tiles[0] = W
    expect(openEnds(b)).toBe(1)
    expect(solved({ ...b, n: 1, tiles: [W] })).toBe(false)
    // wrapping, the west side of square 0 meets the east side of square 4
    b.tiles[4] = E
    expect(openEnds(b)).toBe(2) // both point off the board
    expect(openEnds({ ...b, wrap: true })).toBe(0) // wrapping, they meet
  })
  it('is solved by turning every tile back, and by nothing less', () => {
    const b = make(7, 5)
    let fixed = b
    for (let i = 0; i < 25; i++) while (fixed.tiles[i] !== b.solution[i]) fixed = rotate(fixed, i)
    expect(solved(fixed)).toBe(true)
    // undo any one turn and it is not
    const wrong = fixed.tiles.findIndex((t) => turn(t, 1) !== t)
    expect(solved(rotate(fixed, wrong))).toBe(false)
  })
})

describe('par', () => {
  it('counts the fewest turns home, either way round', () => {
    const b = make(3, 7)
    const p = par(b)
    // turning each tile its own fewest way gets there in exactly par turns
    let fixed = b
    let turns = 0
    for (let i = 0; i < b.tiles.length; i++) {
      const cw = [0, 1, 2, 3].find((k) => turn(b.tiles[i], k) === b.solution[i])!
      const k = cw <= 2 ? cw : -1
      if (k) {
        fixed = rotate(fixed, i, k)
        turns += Math.abs(k)
      }
    }
    expect(solved(fixed)).toBe(true)
    expect(turns).toBe(p)
    expect(par({ ...b, tiles: b.solution })).toBe(0)
  })
})

describe('what is kept', () => {
  it('round-trips every field that is not a default', () => {
    const s: Saved = {
      size: 9,
      wrap: true,
      look: 'neon',
      bests: [{ day: 20400, size: 5, wrap: true, seconds: 41, turns: 33 }],
      solvedCount: 12,
    }
    for (const k of Object.keys(s) as (keyof Saved)[]) expect(s[k]).not.toEqual(EMPTY[k])
    expect(readSaved(JSON.stringify(s))).toEqual(s)
  })
  it('keeps the faster finish for a day and board, and forgets old days', () => {
    const a = { day: 100, size: 7, wrap: false, seconds: 60, turns: 40 }
    let bests = keepBest([], a, 100)
    bests = keepBest(bests, { ...a, seconds: 70 }, 100)
    expect(bests).toEqual([a])
    bests = keepBest(bests, { ...a, seconds: 50, turns: 55 }, 100)
    expect(bests[0].seconds).toBe(50)
    bests = keepBest(bests, { ...a, size: 9, seconds: 90 }, 100)
    expect(bests).toHaveLength(2)
    expect(keepBest(bests, { ...a, day: 120 }, 120)).toHaveLength(1)
  })
})
