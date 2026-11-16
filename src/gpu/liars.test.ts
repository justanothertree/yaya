import { describe, expect, it } from 'vitest'
import {
  DICE,
  EMPTY,
  atLeast,
  bid,
  call,
  chance,
  cheapest,
  countOf,
  decide,
  legal,
  newGame,
  playGame,
  readSaved,
  total,
  type Game,
  type Level,
  type Saved,
} from './liars'

/** a round with the dice set by the test */
const table = (dice: number[][], wild = true, turn = 0): Game => ({
  ...newGame(dice.length, 1, wild, turn),
  dice,
  left: dice.map((d) => d.length),
})

describe('bidding', () => {
  it('raises by more dice, or as many of a higher face', () => {
    const prev = { q: 3, f: 4 }
    expect(legal({ q: 3, f: 5 }, prev, false, 10)).toBe(true)
    expect(legal({ q: 4, f: 2 }, prev, false, 10)).toBe(true)
    expect(legal({ q: 3, f: 3 }, prev, false, 10)).toBe(false)
    expect(legal({ q: 3, f: 4 }, prev, false, 10)).toBe(false)
    expect(legal({ q: 11, f: 6 }, prev, false, 10)).toBe(false)
  })
  it('with ones wild, onto ones needs half as many, and off them twice and one more', () => {
    expect(legal({ q: 2, f: 1 }, { q: 4, f: 5 }, true, 15)).toBe(true)
    expect(legal({ q: 1, f: 1 }, { q: 4, f: 5 }, true, 15)).toBe(false)
    expect(legal({ q: 3, f: 1 }, { q: 5, f: 5 }, true, 15)).toBe(true) // half of 5, rounded up
    expect(legal({ q: 7, f: 2 }, { q: 3, f: 1 }, true, 15)).toBe(true)
    expect(legal({ q: 6, f: 6 }, { q: 3, f: 1 }, true, 15)).toBe(false)
    expect(legal({ q: 4, f: 1 }, { q: 3, f: 1 }, true, 15)).toBe(true)
  })
  it('names the cheapest raise on every face', () => {
    // after four fives with ones wild: two ones; five of anything lower or the same; four sixes
    expect(cheapest({ q: 4, f: 5 }, true, 15)).toEqual([
      { q: 2, f: 1 },
      { q: 5, f: 2 },
      { q: 5, f: 3 },
      { q: 5, f: 4 },
      { q: 5, f: 5 },
      { q: 4, f: 6 },
    ])
    // nothing fits once the bid is every die on the table
    expect(cheapest({ q: 10, f: 6 }, false, 10)).toEqual([null, null, null, null, null, null])
  })
  it('passes the turn round the table, skipping anyone who is out', () => {
    const g = { ...table([[2, 3], [], [4, 4]]), left: [2, 0, 2] }
    expect(bid(g, { q: 1, f: 4 }).turn).toBe(2)
  })
})

describe('calling a lie', () => {
  it('counts the face and the wild ones, and the caller loses when the bid stands', () => {
    const g = bid(
      table([
        [1, 4, 4],
        [2, 4, 6],
      ]),
      { q: 4, f: 4 },
    )
    expect(countOf(g, 4)).toBe(4) // three fours and a wild one
    const after = call(g)
    expect(after.shown).toMatchObject({ actual: 4, loser: 1 })
    expect(after.left).toEqual([3, 2])
    expect(after.turn).toBe(1) // the loser starts the next round
  })
  it('the bidder loses when the dice fall short', () => {
    const g = bid(
      table([
        [1, 4, 4],
        [2, 4, 6],
      ]),
      { q: 5, f: 4 },
    )
    expect(call(g).shown!.loser).toBe(0)
  })
  it('does not count ones as wild when they are not, or in a bid on ones', () => {
    const g = table(
      [
        [1, 1, 4],
        [2, 4, 6],
      ],
      false,
    )
    expect(countOf(g, 4)).toBe(2)
    expect(
      countOf(
        table([
          [1, 1, 4],
          [2, 4, 6],
        ]),
        1,
      ),
    ).toBe(2)
  })
  it('ends with the last player holding dice, and rolls fresh dice for the rest', () => {
    let g = { ...table([[3], [5, 5]]), left: [1, 2] }
    g = bid(g, { q: 2, f: 3 })
    g = call(g)
    expect(g.winner).toBe(1)
    const fresh = call(bid(newGame(3, 7), { q: 1, f: 2 }))
    expect(fresh.dice.map((d) => d.length)).toEqual(fresh.left)
    expect(total(fresh)).toBe(3 * DICE - 1)
  })
})

describe('the odds', () => {
  it('works out at-least chances that add up', () => {
    expect(atLeast(0, 10, 1 / 6)).toBe(1)
    expect(atLeast(11, 10, 1 / 6)).toBe(0)
    expect(atLeast(1, 1, 1 / 6)).toBeCloseTo(1 / 6, 12)
    expect(atLeast(1, 2, 0.5)).toBeCloseTo(0.75, 12)
    // the chance of exactly k is the difference of two tails, and they sum to one
    let sum = 0
    for (let k = 0; k <= 12; k++) sum += atLeast(k, 12, 1 / 3) - atLeast(k + 1, 12, 1 / 3)
    expect(sum).toBeCloseTo(1, 12)
  })
  it('counts its own dice as certain and the rest as chances', () => {
    const g = table([
      [4, 4, 4, 4, 4],
      [2, 2, 2, 2, 2],
    ])
    expect(chance(g, 0, { q: 5, f: 4 }, 'easy')).toBe(1)
    expect(chance(g, 0, { q: 6, f: 4 }, 'easy')).toBeCloseTo(1 - Math.pow(2 / 3, 5), 10)
  })
})

describe('the computer', () => {
  it('only ever makes legal moves, and every game ends with one winner', () => {
    for (let s = 0; s < 8; s++) {
      const r = playGame(['easy', 'fair', 'hard'], s)
      expect(r.winner).not.toBeNull()
      expect(r.left).toBeGreaterThan(0)
    }
  })
  it('calls a bid no table could hold, and believes one it can see itself', () => {
    // nine twos among ten dice, with the computer holding five fours: a lie whoever looks
    const wild = bid(
      table(
        [
          [2, 3, 5, 6, 6],
          [4, 4, 4, 4, 4],
        ],
        true,
        0,
      ),
      { q: 9, f: 2 },
    )
    for (const lv of ['fair', 'hard'] as const)
      expect(decide(wild, lv, () => 0.5).kind).toBe('call')
    // four fours, when it holds five of them itself: it raises rather than calls
    const own = bid(
      table(
        [
          [4, 4, 4, 4, 4],
          [2, 3, 5, 6, 6],
        ],
        true,
        1,
      ),
      { q: 4, f: 4 },
    )
    for (const lv of ['easy', 'fair', 'hard'] as const)
      expect(decide(own, lv, () => 0.5).kind).toBe('bid')
  })
  it('is stronger level by level, from both seats', () => {
    const play = (a: Level, b: Level, n: number) => {
      let won = 0
      let margin = 0
      for (let s = 0; s < n; s++) {
        const x = playGame([a, b], s * 3 + 1)
        const y = playGame([b, a], s * 3 + 2)
        won += (x.winner === 0 ? 1 : 0) + (y.winner === 1 ? 1 : 0)
        margin += (x.winner === 0 ? x.left : -x.left) + (y.winner === 1 ? y.left : -y.left)
      }
      return { won: won / (2 * n), margin: margin / (2 * n) }
    }
    // measured: Fair beats Easy 97%; Hard beats Fair 60% over four hundred games it was not tuned on
    expect(play('fair', 'easy', 30).won).toBeGreaterThan(0.85)
    const hard = play('hard', 'fair', 60)
    expect(hard.won).toBeGreaterThan(0.52)
    expect(hard.margin).toBeGreaterThan(0.1)
  }, 60_000)
})

describe('what is kept', () => {
  it('round-trips every field that is not a default', () => {
    const s: Saved = {
      level: 'hard',
      rivals: 3,
      wild: false,
      cup: 'velvet',
      record: {
        easy: { won: 3, lost: 1, caught: 4, fooled: 2 },
        fair: { won: 2, lost: 5, caught: 6, fooled: 1 },
        hard: { won: 1, lost: 7, caught: 2, fooled: 3 },
      },
    }
    for (const k of Object.keys(s) as (keyof Saved)[]) expect(s[k]).not.toEqual(EMPTY[k])
    expect(readSaved(JSON.stringify(s))).toEqual(s)
  })
  it('falls back on anything it does not recognise', () => {
    expect(readSaved(JSON.stringify({ rivals: 5, wild: 'no' }))).toEqual(EMPTY)
  })
})
