import { describe, expect, it } from 'vitest'
import {
  EMPTY,
  FOOT,
  POCKETS,
  R,
  TH,
  TW,
  canPlace,
  groupOf,
  newGame,
  place,
  plan,
  rack,
  aimLine,
  readSaved,
  shoot,
  strike,
  targets,
  type Ball,
  type Game,
  type Level,
} from './pool'
import { rng } from './bricks'

const ball = (n: number, x: number, y: number): Ball => ({ n, x, y, vx: 0, vy: 0, down: false })
/** a game with only the balls named, side 0 to shoot, the table already broken */
const table = (balls: Ball[], extra: Partial<Game> = {}): Game => ({
  balls,
  turn: 0,
  groups: [null, null],
  inHand: false,
  broken: true,
  winner: null,
  said: '',
  ...extra,
})
const apart = (bs: Ball[]) => {
  let min = Infinity
  for (let i = 0; i < bs.length; i++)
    for (let j = i + 1; j < bs.length; j++)
      if (!bs[i].down && !bs[j].down)
        min = Math.min(min, Math.hypot(bs[i].x - bs[j].x, bs[i].y - bs[j].y))
  return min
}

describe('the rack', () => {
  it('sixteen balls, none touching another too hard, the black in the middle and one of each kind behind', () => {
    const bs = rack(3)
    expect(bs.map((b) => b.n)).toEqual([...Array(16).keys()])
    expect(apart(bs)).toBeGreaterThanOrEqual(2 * R)
    const eight = bs.find((b) => b.n === 8)!
    expect(eight.x).toBeCloseTo(FOOT.x + 2 * R * Math.sqrt(3) * 1.002, 6)
    const back = bs.filter((b) => Math.abs(b.x - (FOOT.x + 4 * R * Math.sqrt(3) * 1.002)) < 1e-6)
    const corners = [back[0], back[back.length - 1]].map((b) => groupOf(b.n)).sort()
    expect(corners).toEqual(['solids', 'stripes'])
  })
})

describe('the balls', () => {
  it('a full-ball hit passes nearly all the speed on, and stops the cue ball', () => {
    // gently, so neither ball reaches a cushion and where each stops measures what it was given
    const { balls } = strike([ball(0, 0.5, 0.56), ball(1, 0.6, 0.56)], 0, 0.12)
    const one = balls.find((b) => b.n === 1)!
    const cue = balls.find((b) => b.n === 0)!
    const cueAfter = cue.x - (0.6 - 2 * R)
    expect(one.x - 0.6).toBeGreaterThan(0.3)
    expect(cueAfter).toBeLessThan((one.x - 0.6) * 0.1)
  })
  // at the hardest shot a ball moves 8.7mm a step; with steps of a thirtieth of a second it would
  // jump 17cm, past a whole ball, and this goes red
  it('the hardest shot never passes through a ball in its way, and nothing ever ends up overlapping or off the table', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const rand = rng(seed)
      const { balls, log } = strike(
        [
          ball(0, 0.3, 0.56),
          ball(5, 0.42 + rand() * 0.5, 0.56),
          ...rack(seed)
            .slice(1)
            .filter((b) => b.n !== 5),
        ],
        (rand() - 0.5) * 0.02,
        1,
      )
      expect(log.first).toBe(5)
      expect(apart(balls)).toBeGreaterThan(2 * R - 1e-3)
      for (const b of balls)
        if (!b.down)
          expect(
            b.x >= R - 1e-6 && b.x <= TW - R + 1e-6 && b.y >= R - 1e-6 && b.y <= TH - R + 1e-6,
          ).toBe(true)
    }
  })
  it('a ball rolled at a corner drops; one rolled at a cushion comes back off it', () => {
    const corner = strike([ball(0, 0.4, 0.4)], Math.atan2(-0.4, -0.4), 0.4)
    expect(corner.log.down).toEqual([0])
    const off = strike([ball(0, 1, 0.56)], -Math.PI / 2, 0.3)
    const b = off.balls[0]
    expect(b.down).toBe(false)
    expect(b.y).toBeGreaterThan(R)
  })
})

describe('the aiming guide', () => {
  it('meets the ball in its way at two radii, sends it along the line of centres, and otherwise finds the cushion', () => {
    const bs = [ball(0, 0.5, 0.5), ball(3, 1, 0.52)]
    const a = aimLine(bs, 0)
    expect(a.hit).toBe(3)
    expect(Math.hypot(a.x - 1, a.y - 0.52)).toBeCloseTo(2 * R, 9)
    expect(a.sends).toBeCloseTo(Math.atan2(0.52 - a.y, 1 - a.x), 9)
    // and the real shot agrees about which ball it meets first
    expect(strike(bs, 0, 0.3).log.first).toBe(3)
    const miss = aimLine(bs, Math.PI)
    expect(miss.hit).toBe(-1)
    expect(miss.x).toBeCloseTo(R, 9)
  })
})

describe('the rules', () => {
  const lineUp = (n: number, extra: Partial<Game> = {}) => {
    // a ball just off the top-right pocket, the cue ball straight behind it
    const p = POCKETS[2]
    const o = ball(n, p.x - 0.2, p.y + 0.2)
    const cue = ball(0, o.x - 0.3, o.y + 0.3)
    return table([cue, o, ball(8, 1, 0.8), ball(3, 0.3, 0.9), ball(12, 0.5, 0.9)], extra)
  }
  const aim = (g: Game, n: number) => {
    const cue = g.balls.find((b) => b.n === 0)!
    const o = g.balls.find((b) => b.n === n)!
    return Math.atan2(o.y - cue.y, o.x - cue.x)
  }
  it('potting on an open table decides the groups, and the shooter goes again', () => {
    const g = lineUp(2)
    const { game, log } = shoot(g, aim(g, 2), 0.5)
    expect(log.down).toContain(2)
    expect(game.groups).toEqual(['solids', 'stripes'])
    expect(game.turn).toBe(0)
  })
  it('hitting their group first is a foul: their turn, with the ball in hand', () => {
    const g = lineUp(10, { groups: ['solids', 'stripes'] })
    const { game } = shoot(g, aim(g, 10), 0.5)
    expect(game.turn).toBe(1)
    expect(game.inHand).toBe(true)
    expect(game.said).toMatch(/Foul/)
  })
  it('the cue ball going in is a foul, and it comes back for them to place', () => {
    const g = table([ball(0, 0.4, 0.4), ball(3, 1.5, 0.8)])
    const { game } = shoot(g, Math.atan2(-0.4, -0.4), 0.5)
    expect(game.inHand).toBe(true)
    expect(game.balls.find((b) => b.n === 0)!.down).toBe(false)
    expect(place(game, 0.9, 0.6).balls.find((b) => b.n === 0)).toMatchObject({ x: 0.9, y: 0.6 })
    expect(canPlace(game, 1.5, 0.8)).toBe(false)
  })
  it('the black: down too early loses; down last, fairly, wins; down on the break comes back', () => {
    const early = lineUp(8, { groups: ['solids', 'stripes'] })
    expect(shoot(early, aim(early, 8), 0.5).game.winner).toBe(1)
    const last = table([ball(0, 1.74, 0.5), ball(8, 2.04, 0.2), ball(12, 0.5, 0.9)], {
      groups: ['solids', 'stripes'],
    })
    expect(targets(last)).toEqual([8])
    expect(shoot(last, aim(last, 8), 0.5).game.winner).toBe(0)
    const brk = { ...lineUp(8), broken: false }
    const after = shoot(brk, aim(brk, 8), 0.5).game
    expect(after.winner).toBeNull()
    expect(after.balls.find((b) => b.n === 8)).toMatchObject({ down: false, x: FOOT.x, y: FOOT.y })
  })
  it('hitting nothing, or a ball that then reaches no cushion with nothing down, is a foul', () => {
    const g = table([ball(0, 1, 0.56), ball(3, 1.3, 0.56)], { groups: ['solids', 'stripes'] })
    expect(shoot(g, Math.PI, 0.05).game.inHand).toBe(true)
    expect(shoot(g, 0, 0.12).game.said).toMatch(/cushion/)
  })
})

describe('the computer', () => {
  it('pots a ball sitting over a pocket, and it is put back if it scratches', () => {
    const g = table(
      [ball(0, 1.6, 0.56), ball(4, 2.12, 0.12), ball(11, 0.8, 0.3), ball(8, 0.5, 0.7)],
      { groups: ['solids', 'stripes'] },
    )
    for (const lv of ['fair', 'hard'] as Level[]) {
      const p = plan(g, lv, rng(1))
      const { log } = shoot(g, p.angle, p.power)
      expect(log.down).toContain(4)
    }
  })
  // measured over 32 racks from both seats: fair beat easy 23, hard beat fair 27
  it('each level beats the one below it, from either seat', () => {
    const play = (l0: Level, l1: Level, seed: number) => {
      const rand = rng(seed)
      let g: Game = newGame(seed, (seed % 2) as 0 | 1)
      for (let shots = 0; g.winner === null && shots < 300; shots++) {
        const p = !g.broken
          ? { angle: (rand() - 0.5) * 0.04, power: 1 }
          : plan(g, g.turn === 0 ? l0 : l1, rand)
        if (p.place) g = place(g, p.place.x, p.place.y)
        g = shoot(g, p.angle, p.power).game
      }
      return g.winner
    }
    const wins = (hi: Level, lo: Level) => {
      let w = 0
      for (let s = 1; s <= 10; s++) {
        if (play(hi, lo, s * 7) === 0) w++
        if (play(lo, hi, s * 7) === 1) w++
      }
      return w
    }
    expect(wins('fair', 'easy')).toBeGreaterThanOrEqual(12)
    expect(wins('hard', 'fair')).toBeGreaterThanOrEqual(13)
  }, 60000)
})

describe('pool saves', () => {
  it('round-trips every field away from its default', () => {
    const s = {
      level: 'hard',
      cloth: 'red',
      guide: false,
      record: { easy: { won: 3, lost: 1 }, fair: { won: 4, lost: 6 }, hard: { won: 1, lost: 8 } },
    }
    expect(readSaved(JSON.stringify(s))).toEqual(s)
    expect(readSaved('[')).toEqual(EMPTY)
  })
})
