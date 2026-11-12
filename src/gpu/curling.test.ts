import { describe, expect, it } from 'vitest'
import { rng } from './bricks'
import {
  BACK,
  EMPTY,
  HALF_W,
  HOG,
  HOUSE_R,
  MU,
  STEP,
  STONES_EACH,
  STONE_R,
  TEE,
  after,
  choose,
  count,
  drawTo,
  fromButton,
  hitAt,
  left,
  match,
  newGame,
  pathOf,
  readSaved,
  restOf,
  slide,
  step,
  throwPlan,
  toThrow,
  value,
  type Game,
  type Saved,
  type Stone,
  type Team,
} from './curling'

const at = (x: number, y: number, team: Team = 1): Stone => ({ x, y, vx: 0, vy: 0, spin: 0, team })
const endOf = (speed: number, spin: 1 | -1, swept = false) => {
  const p = pathOf(speed, spin, swept)
  return p[p.length - 1]
}

describe('the ice', () => {
  it('slows a stone that is not turning evenly, so it goes v²/2μ in v/μ seconds', () => {
    let s: Stone[] = [{ x: 0, y: 0, vx: 0, vy: 3, spin: 0, team: 0 }]
    let t = 0
    while (s[0].vy > 0) {
      s = step(s, null)
      t += STEP
    }
    expect(s[0].x).toBe(0)
    expect(s[0].y).toBeCloseTo((3 * 3) / (2 * MU), 1)
    expect(t).toBeCloseTo(3 / MU, 1)
  })
  it('curls a stone the way it turns, the same either way, and most when it is slow', () => {
    const cw = endOf(4.2, 1)
    const ccw = endOf(4.2, -1)
    expect(cw.x).toBeGreaterThan(0.5)
    expect(ccw.x).toBeCloseTo(-cw.x, 9)
    expect(ccw.y).toBeCloseTo(cw.y, 9)
    // a fast stone passing the tee has hardly begun to curl; a slow one stopping there has curled
    const fast = pathOf(7, 1).find((p) => p.y >= TEE)!
    expect(Math.abs(fast.x)).toBeLessThan(0.15)
    expect(Math.abs(restOf(drawTo({ x: 0, y: TEE }, 1)).x)).toBeLessThan(0.01)
    expect(cw.x / cw.y).toBeGreaterThan((fast.x / fast.y) * 3)
  })
  it('carries a swept stone further and straighter', () => {
    const plain = endOf(3.5, 1)
    const swept = endOf(3.5, 1, true)
    expect(swept.y).toBeGreaterThan(plain.y + 1.5)
    expect(swept.x / swept.y).toBeLessThan((plain.x / plain.y) * 0.7)
  })
  it('turns a whole path with the line it is thrown along, so the aim can be worked out', () => {
    const r = rng(5)
    for (let k = 0; k < 20; k++) {
      const shot = {
        angle: (r() - 0.5) * 0.2,
        speed: 3.6 + r(),
        spin: (r() < 0.5 ? 1 : -1) as 1 | -1,
      }
      const real = slide([], shot, 0).stones[0]
      const said = restOf(shot)
      expect(Math.hypot(real.x - said.x, real.y - said.y)).toBeLessThan(0.005)
    }
    // and the throw that comes to rest on a spot does
    for (const spot of [
      { x: 0, y: TEE },
      { x: -1.1, y: TEE + 0.8 },
      { x: 0.7, y: TEE - 2.6 },
    ])
      for (const spin of [1, -1] as const) {
        const s = slide([], drawTo(spot, spin), 0).stones[0]
        expect(Math.hypot(s.x - spot.x, s.y - spot.y)).toBeLessThan(0.01)
      }
  })
})

describe('stones meeting', () => {
  it('a straight hit stops the thrower near enough dead and sends the other on', () => {
    const target = at(0.3, TEE)
    const r = slide([target], hitAt(target, 1, 4.6), 0, null, true)
    const mine = r.stones.find((s) => s.team === 0)!
    const theirs = r.stones.find((s) => s.team === 1)
    expect(Math.hypot(mine.x - 0.3, mine.y - TEE)).toBeLessThan(0.35)
    // knocked a long way back, or right out of play
    expect(theirs === undefined || theirs.y > TEE + 1).toBe(true)
  })
  it('keeps momentum through a knock and never adds energy', () => {
    const p: Stone = { x: 0, y: 0, vx: 0.4, vy: 2, spin: 0, team: 0 }
    const q: Stone = { x: 0.05, y: 0.28, vx: 0, vy: 0, spin: 0, team: 1 }
    const before = { px: p.vx + q.vx, py: p.vy + q.vy, e: p.vx ** 2 + p.vy ** 2 }
    step([p, q], null, 1e-9)
    expect(p.vx + q.vx).toBeCloseTo(before.px, 6)
    expect(p.vy + q.vy).toBeCloseTo(before.py, 6)
    const e = p.vx ** 2 + p.vy ** 2 + q.vx ** 2 + q.vy ** 2
    expect(e).toBeLessThan(before.e)
    expect(e).toBeGreaterThan(before.e * 0.9)
  })
  it('takes a thrown stone off that stops short of the hog line, unless it touched a stone', () => {
    const short = drawTo({ x: 0, y: HOG - 1 }, 1)
    expect(slide([], short, 0).stones).toHaveLength(0)
    const blocker = at(restOf(short).x, HOG - 0.75)
    const kept = slide([blocker], short, 0).stones
    expect(kept.some((s) => s.team === 0)).toBe(true)
  })
  it('takes a stone off past the back line or over the side', () => {
    // this one would come to rest a metre past the back line, well inside the sides
    expect(slide([], { angle: 0, speed: 4.9, spin: 1 }, 0).stones).toHaveLength(0)
    expect(slide([], { angle: 0.25, speed: 4.4, spin: 1 }, 0).stones).toHaveLength(0)
    expect(BACK).toBe(TEE + HOUSE_R)
    expect(HALF_W).toBeGreaterThan(HOUSE_R)
  })
})

describe('the score of an end', () => {
  it('goes to the stone nearest the button, one for each of its side nearer than the other best', () => {
    expect(count([])).toEqual({ team: null, points: 0 })
    expect(count([at(0, TEE - 2.5, 0)])).toEqual({ team: null, points: 0 })
    const lie = [at(0.1, TEE, 0), at(0, TEE + 0.5, 0), at(0.6, TEE, 1), at(-1, TEE, 0)]
    expect(count(lie)).toEqual({ team: 0, points: 2 })
    // a stone just biting the twelve-foot counts; one just outside does not
    const edge = HOUSE_R + STONE_R
    expect(count([at(0, TEE + edge - 0.01, 1)])).toEqual({ team: 1, points: 1 })
    expect(count([at(0, TEE + edge + 0.01, 1)])).toEqual({ team: null, points: 0 })
    expect(fromButton({ x: 3, y: TEE + 4 })).toBeCloseTo(5, 9)
  })
})

describe('a game', () => {
  it('is thrown in turn, the side without the hammer first, four stones each', () => {
    let g: Game = newGame(4, 0)
    const order: Team[] = []
    for (let i = 0; i < STONES_EACH * 2; i++) {
      expect(left(g, 1) + left(g, 0)).toBe(STONES_EACH * 2 - i)
      order.push(toThrow(g))
      g = after(g, []).game
    }
    expect(order).toEqual([1, 0, 1, 0, 1, 0, 1, 0])
    expect(g.scores).toEqual([[0, 0]])
  })
  it('gives the hammer to the side that did not score, and keeps it on a blank end', () => {
    const play = (g: Game, stones: Stone[]) => {
      for (let i = 0; i < STONES_EACH * 2 - 1; i++) g = after(g, []).game
      return after(g, stones)
    }
    let r = play(newGame(4, 0), [at(0, TEE, 0), at(0.4, TEE, 0), at(1, TEE, 1)])
    expect(r.ended).toEqual({ team: 0, points: 2 })
    expect(r.game.scores).toEqual([[2, 0]])
    expect(r.game.hammer).toBe(1)
    r = play(r.game, [])
    expect(r.game.hammer).toBe(1)
    r = play(r.game, [at(0, TEE, 1)])
    expect(r.game.hammer).toBe(0)
  })
  it('plays one extra end when level, and is a draw if still level', () => {
    const play = (g: Game, stones: Stone[]) => {
      for (let i = 0; i < STONES_EACH * 2 - 1; i++) g = after(g, []).game
      return after(g, stones).game
    }
    let g = newGame(2, 0)
    g = play(g, [at(0, TEE, 0)])
    g = play(g, [at(0, TEE, 1)])
    expect(g.over).toBe(false)
    g = play(g, [])
    expect(g.over).toBe(true)
    const won = play(play(play(newGame(2, 0), [at(0, TEE, 0)]), [at(0, TEE, 1)]), [at(0, TEE, 1)])
    expect(won.over).toBe(true)
    expect(won.scores).toHaveLength(3)
  })
})

describe('the computer', () => {
  it('with the last stone of an end and the other side lying shot, takes the end back', () => {
    // their stone on the button, a guard well wide: the last stone must beat it, by drawing in
    // closer or by knocking it out
    for (const level of ['fair', 'hard'] as const) {
      const lie = [at(0.05, TEE + 0.1), at(-1.5, TEE - 2.5)]
      const plan = choose(lie, 0, level, true, rng(3))
      expect(value(slide(lie, plan.shot, 0).stones, 0, true)).toBeGreaterThanOrEqual(1)
    }
  })
  it('knocks them out when there is no way to draw in past them', () => {
    // two of theirs sitting in front of the button: every draw on the list leaves them one up,
    // and a hit takes the end — measured, the best draw is worth -1 and the best hit +1
    const lie = [at(0.05, TEE - 0.1), at(-0.3, TEE - 0.2), at(0.35, TEE - 0.25)]
    const plan = choose(lie, 0, 'hard', true, rng(3))
    expect(plan.kind).toBe('hit')
    expect(value(slide(lie, plan.shot, 0).stones, 0, true)).toBeGreaterThanOrEqual(1)
  })
  it('scores more, level by level, in whole games', () => {
    // measured on other seeds: Fair beats Easy 130 games in 150 and Hard beats Fair 223 in 300;
    // on these, 11 of 12 and 26 of 30
    let fair = 0
    for (let s = 1; s <= 12; s++) if (match('fair', 'easy', s * 7919 + 3).winner === 0) fair++
    expect(fair).toBeGreaterThanOrEqual(9)
    let hard = 0
    let margin = 0
    for (let s = 1; s <= 30; s++) {
      const m = match('hard', 'fair', s * 7919 + 3)
      if (m.winner === 0) hard++
      margin += m.totals[0] - m.totals[1]
    }
    expect(hard).toBeGreaterThanOrEqual(21)
    expect(margin).toBeGreaterThan(15)
  }, 60_000)
  it('mends a light throw by sweeping, and Easy does not sweep', () => {
    const plan = {
      shot: drawTo({ x: 0, y: TEE }, 1),
      kind: 'draw' as const,
      target: { x: 0, y: TEE },
    }
    const light = () => {
      let n = 0
      // every stray comes out at -0.87 of a hand: short of the button, and a little to one side
      return () => (n++ % 4 === 0 ? 0 : 0.5)
    }
    const swept = throwPlan([], plan, 0, 'fair', light()).stones[0]
    // measured: Fair finishes 19cm past the button from 1.2m short; Easy, unswept, stays short
    expect(Math.abs(swept.y - TEE)).toBeLessThan(0.25)
    const unswept = throwPlan([], plan, 0, 'easy', light()).stones
    expect(unswept.length === 0 || unswept[0].y < TEE - 0.5).toBe(true)
  })
})

describe('what is kept', () => {
  it('round-trips every field that is not a default', () => {
    const s: Saved = {
      level: 'hard',
      ice: 'pond',
      ends: 6,
      line: false,
      record: {
        easy: { won: 3, lost: 1, drawn: 1, bestEnd: 2 },
        fair: { won: 2, lost: 5, drawn: 2, bestEnd: 3 },
        hard: { won: 1, lost: 7, drawn: 3, bestEnd: 4 },
      },
    }
    for (const k of Object.keys(s) as (keyof Saved)[]) expect(s[k]).not.toEqual(EMPTY[k])
    expect(readSaved(JSON.stringify(s))).toEqual(s)
  })
  it('falls back on anything it does not recognise', () => {
    expect(readSaved('{"ice":"lava","ends":5,"line":"yes"}')).toEqual(EMPTY)
    expect(readSaved('[1]')).toEqual(EMPTY)
    expect(readSaved('not json')).toEqual(EMPTY)
  })
})
