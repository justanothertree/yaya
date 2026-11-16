import { describe, expect, it } from 'vitest'
import { rng } from './bricks'
import {
  EMPTY,
  HEAD_PIN,
  OIL,
  SPACING,
  bowl,
  card,
  needle,
  next,
  plan,
  playGame,
  wobble,
  rack,
  readSaved,
  score,
  strayFor,
  type Saved,
} from './bowling'

const ALL = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

describe('the pins', () => {
  it('stand in a triangle a foot apart, the head pin at the front', () => {
    const pins = rack()
    expect(pins).toHaveLength(10)
    expect(pins[0]).toMatchObject({ n: 1, x: 0, y: HEAD_PIN })
    for (let a = 0; a < 10; a++)
      for (let b = a + 1; b < 10; b++)
        expect(Math.hypot(pins[a].x - pins[b].x, pins[a].y - pins[b].y)).toBeGreaterThan(
          SPACING - 1e-9,
        )
    // the back row spans three feet either side of the middle... and a half
    expect(pins.find((p) => p.n === 7)!.x).toBeCloseTo(-1.5 * SPACING, 9)
    expect(pins.find((p) => p.n === 10)!.x).toBeCloseTo(1.5 * SPACING, 9)
  })
})

describe('a ball', () => {
  it('in the gutter knocks nothing down', () => {
    const r = bowl(ALL, { x: -0.45, angle: -0.02, speed: 7.6, hook: 0 })
    expect(r.gutter).toBe(true)
    expect(r.felled).toEqual([])
  })
  it('is never a gutter ball once it has knocked a pin down', () => {
    // a hooking ball deflected sideways off the pins used to be counted as in the gutter
    let checked = 0
    for (let x = -0.3; x <= 0.3; x += 0.06)
      for (let a = -0.02; a <= 0.02; a += 0.005) {
        const r = bowl(ALL, { x, angle: a, speed: 7.6, hook: 0.5 })
        if (r.felled.length) {
          checked++
          expect(r.gutter).toBe(false)
        }
      }
    expect(checked).toBeGreaterThan(20)
  })
  it('straight at the head pin leaves the 4-6 split, as a head-on ball does', () => {
    const r = bowl(ALL, { x: 0, angle: 0, speed: 7.6, hook: 0 })
    expect(ALL.filter((p) => !r.felled.includes(p))).toEqual([4, 6])
  })
  it('hooks left once it is off the oil, and only then', () => {
    const path = (hook: number) => bowl([10], { x: 0.2, angle: 0, speed: 7.6, hook }, true).frames
    const straight = path(0)
    const curled = path(1)
    const at = (frames: typeof straight, y: number) => frames.find((f) => f.ball[1] >= y)!.ball[0]
    expect(at(curled, OIL - 0.5)).toBeCloseTo(at(straight, OIL - 0.5), 6)
    expect(at(curled, HEAD_PIN - 0.5)).toBeLessThan(at(straight, HEAD_PIN - 0.5) - 0.1)
  })
  it('picks off a lone pin it is sent straight at', () => {
    const ten = rack([10])[0]
    // aimed from the foul line to the 10 pin's spot
    const angle = Math.atan2(ten.x - 0.1, ten.y - 0.3)
    expect(bowl([10], { x: 0.1, angle, speed: 7.6, hook: 0 }).felled).toEqual([10])
  })
})

describe('the scorecard', () => {
  it('scores the classic example game as 167', () => {
    const rolls = [10, 7, 3, 9, 0, 10, 0, 8, 8, 2, 0, 6, 10, 10, 10, 8, 1]
    expect(card(rolls).map((f) => f.total)).toEqual([20, 39, 48, 66, 74, 84, 90, 120, 148, 167])
  })
  it('makes twelve strikes 300, all spares with fives 150, and all nines 90', () => {
    expect(score(Array(12).fill(10))).toBe(300)
    expect(score(Array(21).fill(5))).toBe(150)
    expect(score(Array(10).fill([9, 0]).flat())).toBe(90)
  })
  it('leaves a frame open until its bonus balls are bowled', () => {
    expect(
      card([10, 3])
        .map((f) => f.total)
        .slice(0, 2),
    ).toEqual([null, null])
    expect(card([7, 3]).map((f) => f.total)[0]).toBe(null)
    expect(card([7, 3, 4]).map((f) => f.total)[0]).toBe(14)
  })
  it('knows when the rack is fresh and when the game is over', () => {
    expect(next([10])).toEqual({ over: false, fresh: true })
    expect(next([7])).toEqual({ over: false, fresh: false })
    expect(next([7, 2])).toEqual({ over: false, fresh: true })
    const nine = Array(9).fill([9, 0]).flat()
    expect(next([...nine, 9, 0]).over).toBe(true)
    expect(next([...nine, 9, 1]).over).toBe(false) // a spare in the tenth earns a third ball
    expect(next([...nine, 9, 1, 5]).over).toBe(true)
    expect(next([...nine, 10, 10]).over).toBe(false)
    expect(next([...nine, 10, 10, 10]).over).toBe(true)
  })
})

describe('the computer', () => {
  it('finds the pocket: its planned first ball, bowled without a wobble, is a strike', () => {
    for (const lv of ['easy', 'fair', 'hard'] as const) {
      const s = plan(ALL, lv, rng(3))
      expect(bowl(ALL, s).felled).toHaveLength(10)
    }
  })
  it('converts more spares and fells more pins level by level', () => {
    // four leaves from easy to hard: a lone corner pin each side, a three-pin line, a bucket
    const leaves = [[10], [7], [3, 6, 10], [2, 4, 5, 8]]
    const spares = (lv: 'easy' | 'fair' | 'hard') => {
      const r = rng(5)
      let made = 0
      for (const leave of leaves) {
        const s = plan(leave, lv, r)
        for (let i = 0; i < 15; i++)
          if (bowl(leave, wobble(s, lv, r)).felled.length === leave.length) made++
      }
      return made / (leaves.length * 15)
    }
    const first = (lv: 'easy' | 'fair' | 'hard') => {
      const r = rng(9)
      const s = plan(ALL, lv, r)
      let t = 0
      for (let i = 0; i < 40; i++) t += bowl(ALL, wobble(s, lv, r)).felled.length
      return t / 40
    }
    // measured: spares made 10, 31 and 51 of 60; first balls 6.7, 8.05 and 8.8 pins. Whole games
    // (Easy 102, Fair 153, Hard 167 over four each) say the same, but three games is too few to
    // separate Fair from Hard reliably and took eighteen seconds — the spares are where they differ
    const s = { easy: spares('easy'), fair: spares('fair'), hard: spares('hard') }
    expect(s.fair).toBeGreaterThan(s.easy + 0.2)
    expect(s.hard).toBeGreaterThan(s.fair + 0.15)
    expect(first('fair')).toBeGreaterThan(first('easy') + 0.8)
  }, 60_000)
  it('bowls a whole game to its end', () => {
    const rolls = playGame('hard', rng(2))
    expect(next(rolls).over).toBe(true)
    expect(rolls.length).toBeGreaterThanOrEqual(11)
    expect(rolls.length).toBeLessThanOrEqual(21)
    expect(score(rolls)).toBeGreaterThan(0)
  }, 30_000)
})

describe('your release', () => {
  it('swings the needle end to end, and strays most at the ends', () => {
    expect(needle(0)).toBeCloseTo(0, 9)
    let lo = 1
    let hi = -1
    for (let t = 0; t < 2; t += 0.01) {
      lo = Math.min(lo, needle(t))
      hi = Math.max(hi, needle(t))
    }
    expect(lo).toBeCloseTo(-1, 2)
    expect(hi).toBeCloseTo(1, 2)
    expect(strayFor(0)).toBe(0)
    expect(Math.abs(strayFor(1))).toBeGreaterThan(Math.abs(strayFor(0.5)))
  })
})

describe('what is kept', () => {
  it('round-trips every field that is not a default', () => {
    const s: Saved = {
      level: 'hard',
      lane: 'retro',
      left: true,
      stance: { x: -0.2, angle: 0.012, speed: 8.4, hook: 0.9 },
      record: {
        easy: { won: 3, lost: 1, best: 134, strikes: 9 },
        fair: { won: 2, lost: 5, best: 171, strikes: 20 },
        hard: { won: 1, lost: 7, best: 212, strikes: 31 },
      },
    }
    for (const k of Object.keys(s) as (keyof Saved)[]) expect(s[k]).not.toEqual(EMPTY[k])
    expect(readSaved(JSON.stringify(s))).toEqual(s)
  })
  it('falls back field by field, and no game is over 300', () => {
    const r = readSaved(
      JSON.stringify({ stance: { x: 9, speed: 7 }, record: { easy: { best: 301 } } }),
    )
    expect(r.stance).toEqual({ ...EMPTY.stance, speed: 7 })
    expect(r.record.easy.best).toBe(300)
  })
})
