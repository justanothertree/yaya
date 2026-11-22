import { describe, expect, it } from 'vitest'
import { rng } from './bricks'
import {
  CATS,
  EMPTY,
  FULL,
  PAR,
  bestBox,
  chooseKeep,
  fill,
  hold,
  holdFor,
  newGame,
  open,
  plan,
  readSaved,
  roll,
  score,
  solo,
  soloGame,
  total,
  type Card,
  type Cat,
  type Saved,
} from './yacht'

/** a card with only the boxes named still open */
const only = (...cats: Cat[]): Card =>
  Object.fromEntries(CATS.filter((k) => !cats.includes(k)).map((k) => [k, 0]))
const warm = (s: number) => {
  const r = rng(s)
  for (let i = 0; i < 8; i++) r()
  return r
}

describe('the boxes', () => {
  it('score each throw by the classic rules', () => {
    const cases: [number[], Partial<Record<Cat, number>>][] = [
      [[3, 3, 3, 5, 5], { threes: 9, fives: 10, full: 19, four: 0, choice: 19, yacht: 0 }],
      [[6, 6, 6, 6, 2], { sixes: 24, twos: 2, four: 24, full: 0, choice: 26 }],
      [[4, 4, 4, 4, 4], { fours: 20, four: 16, yacht: 50, full: 0, choice: 20, ones: 0 }],
      [[5, 1, 3, 2, 4], { little: 30, big: 0, ones: 1, choice: 15 }],
      [[2, 6, 4, 5, 3], { big: 30, little: 0, sixes: 6 }],
      [[1, 2, 3, 4, 4], { little: 0, big: 0, fours: 8, four: 0 }],
    ]
    for (const [dice, want] of cases)
      for (const [k, v] of Object.entries(want))
        expect([dice, k, score(dice, k as Cat)]).toEqual([dice, k, v])
  })
  it('add up, and know which are still open', () => {
    const card: Card = { ones: 3, yacht: 50, full: 0 }
    expect(total(card)).toBe(53)
    expect(open(card)).toHaveLength(9)
    expect(open(card)).not.toContain('full')
  })
})

describe('the computer', () => {
  it('works out the chance of what it is chasing exactly', () => {
    // four sixes and the yacht the only box: one roll of one die makes it one time in six, two rolls
    // eleven in thirty-six
    const p1 = plan([6, 6, 6, 6, 1], only('yacht'), 1)
    expect([...p1.keep].sort()).toEqual([6, 6, 6, 6])
    expect(p1.value).toBeCloseTo(50 / 6 - PAR.yacht, 10)
    expect(plan([6, 6, 6, 6, 1], only('yacht'), 2).value).toBeCloseTo(
      (50 * 11) / 36 - PAR.yacht,
      10,
    )
    // three sixes and two others: both thrown again must both come up six, one time in 36 — every
    // way two dice can fall counted by how many ways it happens, not each pair once
    const p3 = plan([6, 6, 6, 1, 2], only('yacht'), 1)
    expect([...p3.keep].sort()).toEqual([6, 6, 6])
    expect(p3.value).toBeCloseTo(50 / 36 - PAR.yacht, 10)
    // one to four and a six, the little straight the only box: keep the four, one die to roll
    const p2 = plan([1, 2, 3, 4, 6], only('little'), 1)
    expect([...p2.keep].sort()).toEqual([1, 2, 3, 4])
    expect(p2.value).toBeCloseTo(30 / 6 - PAR.little, 10)
    // with nothing to chase, no score: a hand already a yacht keeps everything
    expect(plan([2, 2, 2, 2, 2], only('yacht'), 2).keep).toHaveLength(5)
    // and by score alone, without the par
    expect(plan([6, 6, 6, 6, 1], only('yacht'), 1, false).value).toBeCloseTo(50 / 6, 10)
  })
  it('chooses where to score by what the dice beat, on Hard', () => {
    // three ones, a two and a three: 3 in ones costs a point of par, 8 in choice costs fourteen
    const dice = [1, 1, 1, 2, 3]
    expect(bestBox(dice, {})).toBe('ones')
    expect(bestBox(dice, {}, false)).toBe('choice')
    // and a yacht where one is made
    expect(bestBox([5, 5, 5, 5, 5], {})).toBe('yacht')
  })
  it('on Hard, looks past the next roll to the one after', () => {
    // two pairs, low, and a six, with only the full house open — which scores the dice: Fair, one
    // roll ahead, keeps the pairs for a one-in-three chance at a low full house; Hard keeps the twos
    // and the six and throws twice for a better one
    const dice = [1, 1, 2, 2, 6]
    const card = only('full')
    const hard = chooseKeep(dice, card, 2, 'hard')
    const fair = chooseKeep(dice, card, 2, 'fair')
    expect(dice.filter((_, i) => hard[i])).toEqual([2, 2, 6])
    expect(dice.filter((_, i) => fair[i])).toEqual([1, 1, 2, 2])
    // and it pays: each keep played out many times, the second roll as Hard would play it
    const playOut = (held: boolean[], seed: number) => {
      const r = warm(seed)
      let sum = 0
      for (let t = 0; t < 4000; t++) {
        let g = { ...newGame(), cards: [card, FULL] as [Card, Card], dice, held, rolls: 2 }
        g = roll(g, r)
        g = roll(hold(g, chooseKeep(g.dice, card, 1, 'hard')), r)
        sum += score(g.dice, 'full')
      }
      return sum / 4000
    }
    expect(playOut(hard, 1)).toBeGreaterThan(playOut(fair, 1))
  })
  it('holds the right dice as they lie', () => {
    expect(holdFor([3, 6, 3, 1, 6], [6, 6, 3])).toEqual([true, true, false, false, true])
    // Easy keeps the face it has most of, the higher on a tie
    expect(chooseKeep([2, 5, 2, 5, 1], {}, 2, 'easy')).toEqual([false, true, false, true, false])
  })
  it('scores more on its own, level by level', () => {
    // measured on other games: Easy averages about 110 alone, Fair about 151, Hard about 160; Hard's
    // weighing of boxes by par is worth about eight of those points — without it, 152
    const avg = (level: 'easy' | 'fair' | 'hard', n: number) => {
      let sum = 0
      for (let s = 1; s <= n; s++) sum += solo(level, warm(s * 61))
      return sum / n
    }
    const easy = avg('easy', 40)
    const fair = avg('fair', 40)
    const hard = avg('hard', 40)
    expect(fair - easy).toBeGreaterThan(25)
    expect(hard - fair).toBeGreaterThan(3)
  }, 60_000)
})

describe('a game', () => {
  it('rolls every die on the first roll, and only the free ones after', () => {
    let g = roll(newGame(), warm(3))
    expect(g.rolls).toBe(2)
    const before = g.dice
    g = roll(hold(g, [true, false, true, false, false]), warm(4))
    expect(g.dice[0]).toBe(before[0])
    expect(g.dice[2]).toBe(before[2])
    expect(g.rolls).toBe(1)
    g = roll(roll(g, warm(5)), warm(6))
    expect(g.rolls).toBe(0)
    // no fourth roll
    expect(roll(g, warm(7))).toBe(g)
    // and nothing held before the first roll
    expect(hold(newGame(), [true, true, true, true, true]).held).toEqual(newGame().held)
  })
  it('fills each box once, passes the turn, and ends when both cards are full', () => {
    let g = newGame()
    expect(fill(g, 'ones')).toBe(g)
    const r = warm(9)
    for (let t = 0; t < 24; t++) {
      g = roll(g, r)
      const side = g.turn
      const box = open(g.cards[side])[0]
      const was = score(g.dice, box)
      const next = fill(g, box)
      expect(next.cards[side][box]).toBe(was)
      expect(fill({ ...next, turn: side, rolls: 1 }, box).cards).toBe(next.cards)
      g = next
      expect(g.over).toBe(t === 23)
      if (!g.over) expect(g.turn).toBe(side === 0 ? 1 : 0)
    }
  })
  it('alone, keeps the turn with the one player, for twelve turns', () => {
    let g = soloGame()
    expect(open(g.cards[1])).toEqual([])
    const r = warm(11)
    for (let t = 0; t < 12; t++) {
      expect(g.turn).toBe(0)
      g = fill(roll(g, r), open(g.cards[0])[0])
    }
    expect(g.over).toBe(true)
    expect(total(FULL)).toBe(0)
  })
})

describe('what is kept', () => {
  it('round-trips every field that is not a default, and refuses a best no game could make', () => {
    const s: Saved = {
      level: 'hard',
      look: 'sea',
      advice: true,
      record: {
        easy: { won: 3, lost: 1, drawn: 1 },
        fair: { won: 2, lost: 5, drawn: 0 },
        hard: { won: 1, lost: 7, drawn: 2 },
      },
      best: 212,
    }
    for (const k of Object.keys(s) as (keyof Saved)[]) expect(s[k]).not.toEqual(EMPTY[k])
    expect(readSaved(JSON.stringify(s))).toEqual(s)
    expect(readSaved('{"level":"wild","look":"gold","advice":1,"best":298}')).toEqual(EMPTY)
    // the most a game can make
    const most = [
      [1, 1, 1, 1, 1],
      [2, 2, 2, 2, 2],
      [3, 3, 3, 3, 3],
      [4, 4, 4, 4, 4],
      [5, 5, 5, 5, 5],
      [6, 6, 6, 6, 6],
      [6, 6, 6, 5, 5],
      [6, 6, 6, 6, 6],
      [1, 2, 3, 4, 5],
      [2, 3, 4, 5, 6],
      [6, 6, 6, 6, 6],
      [6, 6, 6, 6, 6],
    ]
    expect(most.reduce((s, d, i) => s + score(d, CATS[i]), 0)).toBe(297)
    expect(readSaved('{"best":297}').best).toBe(297)
  })
})
