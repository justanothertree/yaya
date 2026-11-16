import { describe, expect, it } from 'vitest'
import { rng } from './bricks'
import { bowl, score, wobble, type Shot } from './bowling'
import { MAX_BALLS, bowlingRules as R, inside, readBall, type BowlingGame } from './bowlingRoom'

const ALL = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
/** a ball that drops into the gutter before the pins: nothing down, whatever is standing */
const GUTTER: Shot = { x: 0.5, angle: 0.05, speed: 7.6, hook: 0 }
/** straight down the middle, hard */
const MIDDLE: Shot = { x: 0, angle: 0, speed: 8.6, hook: 0 }
const wire = (balls: Shot[]) => ({ balls: balls.map((s) => [s.x, s.angle, s.speed, s.hook]) })

/**
 * A whole match through the room's own rules, every ball of it, from bowlers whose stance, line,
 * speed and hook are all drawn at random inside what a bowler here can send: strikes, spares,
 * splits and gutters all come up. Not the computer's plan — that searches a few hundred balls
 * for each one bowled, and a match of it took 9 seconds here and over 20 on a busy runner. The
 * computer's own ball is asked of the rules below, once.
 */
function playThrough(seed: number) {
  const rand = rng(seed ^ 0x51ed27)
  let g = R.fresh()
  const seen: BowlingGame[] = [g]
  while (R.turn(g) !== null) {
    const side = R.turn(g) as 0 | 1
    const s = inside({
      x: (rand() * 2 - 1) * 0.4,
      angle: (rand() * 2 - 1) * 0.03,
      speed: 6.6 + rand() * 2,
      hook: rand() < 0.5 ? 0 : rand(),
    })
    expect(R.legal(g, s, side)).toBe(true)
    expect(R.legal(g, s, side === 0 ? 1 : 0)).toBe(false)
    g = R.apply(g, s, side)
    seen.push(g)
  }
  return { g, seen }
}

describe('bowling on the wire', () => {
  it('replays to the very same game from its balls, at every ball of real matches', () => {
    let strikes = 0
    let spares = 0
    for (const seed of [1, 2, 3, 4]) {
      const { g, seen } = playThrough(seed)
      for (const d of seen.slice(1)) {
        const { standing, roll } = d.last!
        if (roll.felled.length === 10) strikes++
        else if (standing.length < 10 && roll.felled.length === standing.length) spares++
      }
      expect(g.rolls[0].length).toBeGreaterThanOrEqual(11)
      expect(g.rolls[1].length).toBeGreaterThanOrEqual(11)
      for (const d of seen) {
        const w = JSON.parse(JSON.stringify(R.encode(d)))
        const back = R.decode(w)!
        expect(back.rolls).toEqual(d.rolls)
        expect(back.standing).toEqual(d.standing)
        expect(back.up).toBe(d.up)
        expect(back.last?.by).toBe(d.last?.by)
        expect(back.last?.standing).toEqual(d.last?.standing)
        expect(back.last?.roll.felled).toEqual(d.last?.roll.felled)
        expect(R.encode(back)).toEqual(w)
      }
      // and the winner is the one with the higher score
      const [a, b] = [score(g.rolls[0]), score(g.rolls[1])]
      expect(R.result!(g)).toBe(a > b ? 0 : b > a ? 1 : 'draw')
    }
    // the matches were worth replaying: racks cleared both ways, not only open frames
    expect(strikes).toBeGreaterThan(0)
    expect(spares).toBeGreaterThan(0)
  })

  it('keeps the last ball’s path for showing it, and the pins it was bowled at', () => {
    const g = R.decode(wire([GUTTER, MIDDLE]))!
    expect(g.last!.roll.frames.length).toBeGreaterThan(10)
    expect(g.last!.by).toBe(0)
    expect(g.last!.standing).toEqual(ALL)
  })

  it('takes turns a frame each, the bowler keeping the lane for their second ball', () => {
    let g = R.fresh()
    expect(R.turn(g)).toBe(0)
    g = R.apply(g, GUTTER, 0)
    expect(R.turn(g)).toBe(0)
    expect(g.standing).toEqual(ALL)
    g = R.apply(g, GUTTER, 0)
    expect(R.turn(g)).toBe(1)
    expect(g.rolls).toEqual([[0, 0], []])
    // a ball that leaves pins standing: the next ball is at those, by the same bowler
    const felled = bowl(ALL, MIDDLE).felled
    expect(felled.length).toBeGreaterThan(0)
    g = R.apply(g, MIDDLE, 1)
    if (felled.length < 10) {
      expect(R.turn(g)).toBe(1)
      expect(g.standing).toEqual(ALL.filter((p) => !felled.includes(p)))
    } else expect(R.turn(g)).toBe(0)
  })

  it('ends when both games are over, and a game of gutters each is a draw', () => {
    const balls = Array.from({ length: 40 }, () => GUTTER)
    const g = R.decode(wire(balls))!
    expect(R.turn(g)).toBeNull()
    expect(g.rolls[0]).toHaveLength(20)
    expect(g.rolls[1]).toHaveLength(20)
    expect(R.result!(g)).toBe('draw')
    expect(R.legal(g, GUTTER)).toBe(false)
    expect(R.decode(wire([...balls, GUTTER]))).toBeNull()
    expect(R.decode(wire(balls.slice(0, 39)))!.up).toBe(1)
  })

  it('refuses a ball outside what any bowler here could send', () => {
    expect(readBall([0, 0, 7.6, 0.5])).toEqual({ x: 0, angle: 0, speed: 7.6, hook: 0.5 })
    expect(readBall(MIDDLE)).toEqual(MIDDLE)
    for (const bad of [
      [0.6, 0, 7.6, 0],
      [0, 0.11, 7.6, 0],
      [0, 0, 4.9, 0],
      [0, 0, 10.1, 0],
      [0, 0, 7.6, 1.1],
      [0, 0, NaN, 0],
      [0, 0, 7.6],
      ['0', 0, 7.6, 0],
      null,
      3,
    ])
      expect(readBall(bad)).toBeNull()
  })

  it('refuses a game that is not a list of balls', () => {
    expect(R.decode(null)).toBeNull()
    expect(R.decode({})).toBeNull()
    expect(R.decode({ balls: [[0, 0, 99, 0]] })).toBeNull()
    expect(R.decode(wire(Array.from({ length: MAX_BALLS + 1 }, () => GUTTER)))).toBeNull()
  })

  it('holds the computer’s wildest wobble to a ball the room will take', () => {
    // a hand that strays as far as it can, every time, on the loosest level
    const wild = wobble({ x: 0.36, angle: 0.036, speed: 8.6, hook: 1 }, 'easy', () => 1)
    expect(readBall(wild)).toBeNull()
    expect(readBall(inside(wild))).not.toBeNull()
    const g = R.fresh()
    expect(R.legal(g, R.computer!.choose(g, 'easy'), 1)).toBe(false) // not its turn yet
    const h = R.decode(wire([GUTTER, GUTTER]))!
    expect(R.legal(h, R.computer!.choose(h, 'hard'), 1)).toBe(true)
  })
})
