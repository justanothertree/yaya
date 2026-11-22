import { describe, expect, it } from 'vitest'
import {
  DEFAULT_RULES,
  EMPTY,
  LEVELS,
  choose,
  landing,
  legal,
  opposite,
  readSaved,
  score,
  sow,
  start,
  storeOf,
  total,
  type Board,
  type Level,
  type Rules,
  type Side,
} from './mancala'

/** a seeded source, so a match between computers is the same match every run */
const seeded = (seed: number) => {
  let s = seed >>> 0 || 1
  return () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    return (s >>> 0) / 2 ** 32
  }
}

function play(a: Level, b: Level, rules: Rules, seed: number) {
  const rand = seeded(seed)
  let board = start(rules)
  let side: Side = seed % 2 ? 0 : 1
  for (let turn = 0; turn < 400; turn++) {
    const lv = side === 0 ? a : b
    const s = sow(board, choose(board, side, lv, rules, rand), side, rules)
    expect(total(s.board)).toBe(rules.pits * 2 * rules.seeds)
    board = s.board
    if (s.over) return score(board)
    side = s.next
  }
  throw new Error('never ended')
}

describe('sowing', () => {
  it('lays a board out with stores empty and every pit full', () => {
    const b = start({ pits: 5, seeds: 3, captures: true })
    expect(b).toEqual([3, 3, 3, 3, 3, 0, 3, 3, 3, 3, 3, 0])
    expect(storeOf(b, 0)).toBe(5)
    expect(storeOf(b, 1)).toBe(11)
    expect(opposite(b, 0)).toBe(10)
    expect(opposite(b, 4)).toBe(6)
  })
  it('sows one seed a pit, into your store, and ending there goes again', () => {
    const b = start(DEFAULT_RULES)
    const s = sow(b, 2, 0, DEFAULT_RULES)
    expect(s.path).toEqual([3, 4, 5, 6])
    expect(s.board.slice(0, 7)).toEqual([4, 4, 0, 5, 5, 5, 1])
    expect(s.next).toBe(0)
    expect(sow(b, 3, 0, DEFAULT_RULES).next).toBe(1)
  })
  it("skips the other side's store on the way round", () => {
    const b: Board = [0, 0, 0, 0, 0, 10, 0, 1, 1, 1, 1, 1, 1, 0]
    const s = sow(b, 5, 0, DEFAULT_RULES)
    expect(s.path).not.toContain(13)
    expect(s.path).toEqual([6, 7, 8, 9, 10, 11, 12, 0, 1, 2])
    expect(s.board[13]).toBe(0)
  })
  it('ending in an empty pit of yours takes what is opposite, only when there is something', () => {
    const b: Board = [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 5, 0, 0]
    // pit 0's one seed lands in pit 1, empty and opposite pit 11 (5 seeds)
    const s = sow(b, 0, 0, DEFAULT_RULES)
    expect(s.captured).toEqual({ from: 11, seeds: 6 })
    expect(s.board[6]).toBe(6)
    // with captures off, nothing is taken
    expect(sow(b, 0, 0, { captures: false }).captured).toBeNull()
    // and opposite an empty pit, nothing either
    const c: Board = [1, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 2, 0]
    expect(sow(c, 0, 0, DEFAULT_RULES).captured).toBeNull()
  })
  it('when a side runs dry, each side keeps what is left on it', () => {
    const b: Board = [0, 0, 0, 0, 0, 1, 20, 2, 0, 3, 0, 0, 0, 10]
    const s = sow(b, 5, 0, DEFAULT_RULES)
    expect(s.over).toBe(true)
    expect(score(s.board)).toEqual([21, 15])
    expect(legal(s.board, 0)).toEqual([])
  })
  it("refuses to sow from an empty pit or the other side's", () => {
    const b = start(DEFAULT_RULES)
    expect(() => sow(b, 8, 0, DEFAULT_RULES)).toThrow()
    expect(() => sow(b, 6, 0, DEFAULT_RULES)).toThrow()
  })
  it('the hint names the very pit the last seed lands in', () => {
    const rand = seeded(5)
    let b = start(DEFAULT_RULES)
    let side: Side = 0
    for (let i = 0; i < 60; i++) {
      const m = legal(b, side)[Math.floor(rand() * legal(b, side).length)]
      const s = sow(b, m, side, { captures: false })
      expect(landing(b, m, side)).toBe(s.path[s.path.length - 1])
      if (s.over) break
      b = s.board
      side = s.next
    }
  })
})

describe('the computer', () => {
  it('takes a go-again and a capture when they are there', () => {
    // pit 3 holds 3 seeds: exactly to the store
    expect(choose([0, 0, 0, 3, 0, 0, 0, 1, 1, 1, 1, 1, 1, 0], 0, 'fair', DEFAULT_RULES)).toBe(3)
    // pit 0's seed lands in empty pit 1, opposite 9 seeds; pit 4 only gives a seed away
    const b: Board = [1, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0, 9, 1, 0]
    expect(choose(b, 0, 'hard', DEFAULT_RULES)).toBe(0)
  })
  it('every game ends with every seed accounted for', () => {
    for (const rules of [
      DEFAULT_RULES,
      { pits: 4, seeds: 3, captures: false },
      { pits: 5, seeds: 6, captures: true },
    ])
      for (let g = 0; g < 4; g++) {
        const [a, b] = play('easy', 'fair', rules, g + 1)
        expect(a + b).toBe(rules.pits * 2 * rules.seeds)
      }
  })
  // measured over seeded games: fair beat easy 36 of 36, hard beat fair 25 of 32 (one drawn).
  // The games are seeded, so these counts are the same every run, not a chance of passing.
  it('each level beats the one below it, most of the time', () => {
    const tally = (hi: Level, lo: Level, n: number) => {
      let wins = 0
      for (let g = 0; g < n; g++) {
        const [a, b] = play(hi, lo, DEFAULT_RULES, 100 + g)
        if (a > b) wins++
      }
      return wins
    }
    expect(tally('fair', 'easy', 12)).toBeGreaterThanOrEqual(10)
    expect(tally('hard', 'fair', 8)).toBeGreaterThanOrEqual(6)
  }, 30000)
  it('thinks fast enough to answer a tap', () => {
    const b = start(DEFAULT_RULES)
    const t = performance.now()
    choose(b, 1, 'hard', DEFAULT_RULES)
    expect(performance.now() - t).toBeLessThan(1500)
  })
})

describe('mancala saves', () => {
  it('round-trips every field away from its default', () => {
    const s = {
      rules: { pits: 5, seeds: 6, captures: false },
      level: 'hard',
      look: 'sea',
      seedLook: 'gems',
      hints: true,
      record: {
        easy: { won: 3, lost: 1, drawn: 2, best: 9 },
        fair: { won: 4, lost: 5, drawn: 1, best: 7 },
        hard: { won: 1, lost: 8, drawn: 0, best: 2 },
      },
    }
    expect(readSaved(JSON.stringify(s))).toEqual(s)
  })
  it('a broken store loses only what is bad', () => {
    expect(readSaved('{')).toEqual(EMPTY)
    const back = readSaved(
      JSON.stringify({ rules: { pits: 9, seeds: 4 }, level: 'godlike', hints: true }),
    )
    expect(back).toEqual({ ...EMPTY, hints: true })
    expect(LEVELS).toHaveLength(3)
  })
})
