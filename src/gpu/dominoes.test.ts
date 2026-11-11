import { describe, expect, it } from 'vitest'
import {
  EMPTY,
  SET,
  choose,
  deal,
  drawOrPass,
  ends,
  fits,
  handPips,
  lay,
  playable,
  readSaved,
  type Level,
  type Round,
  type Tile,
} from './dominoes'
import { rng } from './bricks'

const play = (r: Round, l0: Level, l1: Level, rand: () => number, each?: (r: Round) => void) => {
  for (let k = 0; k < 300 && !r.over; k++) {
    const c = choose(r, r.turn === 0 ? l0 : l1, rand)
    r = c ? lay(r, c.tile, c.side) : drawOrPass(r)
    each?.(r)
  }
  return r
}

describe('the set and the deal', () => {
  it('28 tiles, every pair once, 168 pips in all; seven each and fourteen in the boneyard', () => {
    expect(SET).toHaveLength(28)
    expect(new Set(SET.map((t) => t.join())).size).toBe(28)
    expect(handPips(SET)).toBe(168)
    const r = deal(1)
    expect(r.hands.map((h) => h.length)).toEqual([7, 7])
    expect(r.yard).toHaveLength(14)
  })
})

describe('laying tiles', () => {
  it('a tile goes where an end matches, turned to fit, and the line always joins up', () => {
    const r: Round = {
      ...deal(1),
      hands: [
        [
          [2, 5],
          [5, 6],
        ],
        [[1, 1]],
      ],
      line: [{ a: 3, b: 5 }],
      turn: 0,
    }
    expect(fits(r, [2, 5] as Tile)).toEqual(['right'])
    const after = lay(r, [5, 6], 'right')
    expect(after.line[1]).toEqual({ a: 5, b: 6 })
    expect(ends(after)).toEqual([3, 6])
    expect(lay(r, [2, 5], 'left')).toBe(r)
    for (let s = 1; s <= 200; s++)
      play(deal(s), 'easy', 'easy', rng(s), (x) => {
        for (let k = 1; k < x.line.length; k++) expect(x.line[k - 1].b).toBe(x.line[k].a)
        expect(x.hands[0].length + x.hands[1].length + x.yard.length + x.line.length).toBe(28)
      })
  })
  it('nothing to lay: draw one; nothing left to draw: pass, and remember the number they lack', () => {
    const r: Round = {
      ...deal(1),
      hands: [[[0, 0]], [[6, 6]]],
      yard: [[1, 2]],
      line: [{ a: 3, b: 4 }],
      turn: 0,
    }
    expect(playable(r)).toEqual([])
    const drew = drawOrPass(r)
    expect(drew.hands[0]).toHaveLength(2)
    expect(drew.lacks[0].has(3) && drew.lacks[0].has(4)).toBe(true)
    const passed = drawOrPass({ ...drew, yard: [] })
    expect(passed.turn).toBe(1)
    expect(passed.passes).toBe(1)
  })
})

describe('scoring', () => {
  it('out first scores the pips left in the other hand; a blocked line goes to the lighter hand by the difference', () => {
    const r: Round = {
      ...deal(1),
      hands: [
        [[3, 4]],
        [
          [6, 6],
          [1, 2],
        ],
      ],
      line: [{ a: 0, b: 3 }],
      turn: 0,
    }
    expect(lay(r, [3, 4], 'right').over).toEqual({ winner: 0, points: 15, why: 'out' })
    const stuck: Round = {
      ...deal(1),
      hands: [
        [[6, 6]],
        [
          [5, 5],
          [0, 1],
        ],
      ],
      yard: [],
      line: [{ a: 3, b: 4 }],
      turn: 0,
      passes: 0,
    }
    const end = drawOrPass(drawOrPass(stuck))
    expect(end.over).toEqual({ winner: 1, points: 1, why: 'blocked' })
  })
})

describe('the computer', () => {
  // measured over 4,000 rounds from both seats: fair won 60.7% against easy, hard 58.6% against fair
  it('each level wins more rounds than the one below it', () => {
    const rate = (hi: Level, lo: Level) => {
      let wins = 0
      let n = 0
      for (let s = 1; s <= 500; s++)
        for (const seat of [0, 1] as const) {
          const o = play(
            deal(s, (s % 2) as 0 | 1),
            seat === 0 ? hi : lo,
            seat === 0 ? lo : hi,
            rng(s + 7),
          ).over!
          n++
          if (o.winner === seat) wins++
        }
      return wins / n
    }
    expect(rate('fair', 'easy')).toBeGreaterThan(0.56)
    expect(rate('hard', 'fair')).toBeGreaterThan(0.55)
  })
})

describe('dominoes saves', () => {
  it('round-trips every field away from its default', () => {
    const s = {
      level: 'hard',
      style: 'candy',
      target: 50,
      hints: false,
      record: { easy: { won: 3, lost: 1 }, fair: { won: 4, lost: 6 }, hard: { won: 1, lost: 8 } },
    }
    expect(readSaved(JSON.stringify(s))).toEqual(s)
    expect(readSaved('{')).toEqual(EMPTY)
  })
})
