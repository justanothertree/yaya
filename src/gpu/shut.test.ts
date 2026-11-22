import { describe, expect, it } from 'vitest'
import { rng } from './bricks'
import {
  ALL,
  EMPTY,
  EXPECT,
  ROLLS,
  SHUT_CHANCE,
  bestDice,
  chooseDice,
  chooseWay,
  newTurn,
  oneDieAllowed,
  pick,
  playTurn,
  readSaved,
  roll,
  score,
  sum,
  tilesOf,
  ways,
  type Saved,
  type Turn,
} from './shut'

const bits = (...tiles: number[]) => tiles.reduce((s, t) => s | (1 << (t - 1)), 0)
const warm = (s: number) => {
  const r = rng(s)
  for (let i = 0; i < 8; i++) r()
  return r
}

describe('the tiles and dice', () => {
  it('finds every set of tiles that adds up to a roll', () => {
    expect(ways(ALL, 5).map(tilesOf).sort()).toEqual([[1, 4], [2, 3], [5]])
    expect(ways(ALL, 1)).toEqual([bits(1)])
    expect(ways(bits(2, 4), 5)).toEqual([])
    // and every way to make twelve from the nine, counted by hand: 3+9, 4+8, 5+7; 1+2+9, 1+3+8,
    // 1+4+7, 1+5+6, 2+3+7, 2+4+6, 3+4+5; 1+2+3+6, 1+2+4+5
    expect(ways(ALL, 12).every((w) => sum(w) === 12)).toBe(true)
    expect(ways(ALL, 12)).toHaveLength(12)
  })
  it('rolls two dice as often as dice fall, and one only with the seven, eight and nine down', () => {
    for (const n of [1, 2] as const)
      expect(ROLLS[n].reduce((s, r) => s + r.p, 0)).toBeCloseTo(1, 12)
    expect(ROLLS[2].find((r) => r.roll === 7)!.p).toBeCloseTo(6 / 36, 12)
    expect(ROLLS[2].find((r) => r.roll === 12)!.p).toBeCloseTo(1 / 36, 12)
    expect(oneDieAllowed(bits(1, 2, 6))).toBe(true)
    expect(oneDieAllowed(bits(1, 9))).toBe(false)
  })
})

describe('playing it best', () => {
  it('reckons a single tile left exactly as it can be worked out by hand', () => {
    // the 1 alone: one die makes it a time in six, two dice never — so one die, and 5/6 of a point
    expect(EXPECT[bits(1)]).toBeCloseTo(5 / 6, 12)
    expect(SHUT_CHANCE[bits(1)]).toBeCloseTo(1 / 6, 12)
    expect(bestDice(bits(1))).toBe(1)
    // the 9 alone: two dice only, four ways in thirty-six
    expect(EXPECT[bits(9)]).toBeCloseTo((9 * 32) / 36, 12)
    expect(SHUT_CHANCE[bits(9)]).toBeCloseTo(4 / 36, 12)
    // the 6 alone: one die makes it 1/6, two dice 5/36 — one die is better
    expect(EXPECT[bits(6)]).toBeCloseTo((6 * 5) / 6, 12)
    expect(EXPECT[0]).toBe(0)
  })
  it('scores, played out thousands of times, what it reckons it will', () => {
    // the table says what the best player is left with on average; playing that player many times
    // through dice actually thrown is a different road to the same number
    const r = warm(42)
    let total = 0
    const n = 20000
    for (let k = 0; k < n; k++) total += sum(playTurn('hard', r))
    expect(total / n).toBeCloseTo(EXPECT[ALL], 0)
    expect(Math.abs(total / n - EXPECT[ALL])).toBeLessThan(0.25)
  })
  it('chooses the tiles that leave least to expect, and the dice to match', () => {
    // a 9 rolled with every tile up: of all the ways, Hard takes the one the table likes best
    const w = chooseWay(ALL, 9, 'hard', warm(1))
    for (const x of ways(ALL, 9)) expect(EXPECT[ALL & ~w]).toBeLessThanOrEqual(EXPECT[ALL & ~x])
    // and where the rule of thumb is wrong: 1 to 5 up and a 7 rolled, Fair (fewest tiles, the
    // biggest) shuts 2 and 5; Hard shuts 3 and 4, keeping the 1 and 2 that make small rolls —
    // 3.81 to expect after, against 4.36
    expect(chooseWay(bits(1, 2, 3, 4, 5), 7, 'hard', warm(1))).toBe(bits(3, 4))
    expect(chooseWay(bits(1, 2, 3, 4, 5), 7, 'fair', warm(1))).toBe(bits(2, 5))
    expect(EXPECT[bits(1, 2, 5)]).toBeLessThan(EXPECT[bits(1, 3, 4)])
    // Fair takes fewest tiles, the biggest
    expect(chooseWay(ALL, 9, 'fair', warm(1))).toBe(bits(9))
    expect(chooseWay(bits(1, 2, 3, 4), 7, 'fair', warm(1))).toBe(bits(3, 4))
    // a roll nothing makes
    expect(chooseWay(bits(9), 3, 'hard', warm(1))).toBe(0)
    expect(chooseDice(bits(9, 1), 'hard')).toBe(2)
  })
  it('leaves less level by level', () => {
    // measured on other turns: Easy leaves about 20.3, Fair 12.1, Hard 11.0
    const avg = (level: 'easy' | 'fair' | 'hard') => {
      const r = warm(77)
      let t = 0
      for (let k = 0; k < 6000; k++) t += sum(playTurn(level, r))
      return t / 6000
    }
    const easy = avg('easy')
    const fair = avg('fair')
    const hard = avg('hard')
    expect(easy - fair).toBeGreaterThan(5)
    expect(fair - hard).toBeGreaterThan(0.5)
  })
})

describe('a turn on the page', () => {
  it('rolls, takes picked tiles that add up, refuses too many, and rolls again', () => {
    // a die that always shows the number asked
    const fixed = (...faces: number[]) => {
      let i = 0
      return () => (faces[i++ % faces.length] - 1) / 6 + 0.01
    }
    let t: Turn = roll(newTurn(), 2, fixed(3, 4))
    expect(t.dice).toEqual([3, 4])
    expect(t.live).toBe(true)
    // no second roll while these dice wait
    expect(roll(t, 2, fixed(1, 1))).toBe(t)
    t = pick(t, 2)
    expect(t.picked).toBe(bits(2))
    // the 9 would be too many
    expect(pick(t, 9)).toBe(t)
    t = pick(t, 5)
    expect(t.up).toBe(ALL & ~bits(2, 5))
    expect(t.live).toBe(false)
    // one die is not allowed with the 7, 8 and 9 up
    expect(roll(t, 1, fixed(4))).toBe(t)
    // a roll the tiles cannot make ends it, and the score is what is left
    const stuck: Turn = { ...newTurn(), up: bits(9) }
    const end = roll(stuck, 2, fixed(1, 1))
    expect(end.over).toBe(true)
    expect(score(end)).toBe(9)
    // shutting the last tile shuts the box
    const last = pick(roll({ ...newTurn(), up: bits(4) }, 1, fixed(4)), 4)
    expect(last.over).toBe(true)
    expect(score(last)).toBe(0)
  })
})

describe('what is kept', () => {
  it('round-trips every field that is not a default, and refuses a best no turn could leave', () => {
    const s: Saved = {
      level: 'hard',
      look: 'brass',
      odds: true,
      record: {
        easy: { won: 3, lost: 1, drawn: 1 },
        fair: { won: 2, lost: 5, drawn: 0 },
        hard: { won: 1, lost: 7, drawn: 2 },
      },
      best: 4,
      shut: 2,
      turns: 31,
    }
    for (const k of Object.keys(s) as (keyof Saved)[]) expect(s[k]).not.toEqual(EMPTY[k])
    expect(readSaved(JSON.stringify(s))).toEqual(s)
    expect(readSaved('{"best":46,"look":"gold","odds":"y"}')).toEqual(EMPTY)
    expect(readSaved('{"best":0}').best).toBe(0)
  })
})
