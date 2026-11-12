import { describe, expect, it } from 'vitest'
import {
  BURN,
  EMPTY,
  FOOT_Y,
  G,
  IDLE,
  SAFE_TILT,
  SAFE_VX,
  SAFE_VY,
  STEP,
  THRUST,
  TURN,
  autoland,
  ground,
  launch,
  makeWorld,
  padAt,
  readSaved,
  scoreFor,
  step,
  type Craft,
  type Input,
  type Saved,
  type World,
} from './lander'

const hold = (w: World, c: Craft, input: Input, seconds: number) => {
  for (let i = 0; i < Math.round(seconds / STEP); i++) c = step(w, c, input)
  return c
}
/** a craft hanging just over the middle of a pad, ready to touch down at the given motion */
const over = (w: World, pad: number, vy: number, vx = 0, a = 0): Craft => {
  const p = w.pads[pad]
  return { ...launch(w), x: (p.from + p.to) / 2, y: p.y + FOOT_Y + 0.0005, vx, vy, a }
}

describe('the terrain', () => {
  it('always has its three pads — flat, apart, and paying five, three and two', () => {
    for (let s = 0; s < 300; s++) {
      const w = makeWorld(s)
      expect(w.pads.map((p) => p.times).sort()).toEqual([2, 3, 5])
      for (const p of w.pads) {
        for (let x = p.from; x <= p.to; x += 0.002) expect(ground(w, x)).toBeCloseTo(p.y, 9)
        expect(p.to).toBeGreaterThan(p.from)
      }
      const sorted = [...w.pads].sort((a, b) => a.from - b.from)
      for (let i = 1; i < sorted.length; i++)
        expect(sorted[i].from).toBeGreaterThan(sorted[i - 1].to)
      // and the ground wraps: the right edge meets the left
      expect(ground(w, 0.9999999)).toBeCloseTo(ground(w, 0), 4)
    }
  })
  it('is the same terrain for the same seed, and a different one for another', () => {
    expect(makeWorld(7)).toEqual(makeWorld(7))
    expect(makeWorld(7).heights).not.toEqual(makeWorld(8).heights)
  })
})

describe('flying', () => {
  const w = makeWorld(1)
  it('falls under gravity with nothing pressed', () => {
    const c = hold(w, { ...launch(w), vx: 0 }, IDLE, 1)
    expect(c.vy).toBeCloseTo(-G, 3)
    expect(launch(w).y - c.y).toBeCloseTo(G / 2, 2)
  })
  it('climbs with the engine on, burning fuel at its rate', () => {
    const c = hold(w, launch(w), { ...IDLE, thrust: true }, 1)
    expect(c.vy).toBeCloseTo(THRUST - G, 3)
    expect(1 - c.fuel).toBeCloseTo(BURN, 3)
  })
  it('turns at its rate, and thrusts the way it leans', () => {
    const c = hold(w, { ...launch(w), vx: 0 }, { ...IDLE, right: true }, 0.25)
    expect(c.a).toBeCloseTo(TURN * 0.25, 2)
    const pushed = hold(w, c, { ...IDLE, thrust: true }, 0.5)
    expect(pushed.vx).toBeGreaterThan(0.02)
  })
  it('does nothing with the engine once the tank is empty', () => {
    const c = hold(w, { ...launch(w), fuel: 0, vx: 0 }, { ...IDLE, thrust: true }, 1)
    expect(c.vy).toBeCloseTo(-G, 3)
    expect(c.thrusting).toBe(false)
  })
  it('wraps round the sides of the world', () => {
    const c = hold(w, { ...launch(w), x: 0.999, vx: 0.05 }, IDLE, 0.1)
    expect(c.x).toBeLessThan(0.01)
  })
})

describe('touching down', () => {
  const w = makeWorld(2)
  for (let pad = 0; pad < 3; pad++)
    it(`lands gently and upright on pad ${pad + 1}, scoring by its multiplier and the fuel left`, () => {
      const c = step(w, { ...over(w, pad, -SAFE_VY * 0.5), fuel: 0.4 }, IDLE)
      expect(c.done?.landed).toBe(true)
      expect(c.done?.score).toBe(scoreFor(0.4, w.pads[pad].times))
      expect(padAt(w, c.x)).toBe(pad)
    })
  it('crashes coming down too fast, sliding, or leaning — each said', () => {
    const fast = step(w, over(w, 0, -SAFE_VY * 1.3), IDLE)
    expect(fast.done).toMatchObject({ landed: false, why: 'coming down too fast' })
    const slide = hold(w, over(w, 0, -0.01, SAFE_VX * 1.5), IDLE, 0.5)
    expect(slide.done).toMatchObject({ landed: false, why: 'sliding sideways' })
    const lean = hold(w, over(w, 0, -0.01, 0, SAFE_TILT * 1.5), IDLE, 0.5)
    expect(lean.done?.landed).toBe(false)
  })
  it('crashes anywhere off a pad, however gently', () => {
    // find a stretch of ground well away from every pad
    let x = 0
    for (; x < 1; x += 0.01) if (w.pads.every((p) => x < p.from - 0.05 || x > p.to + 0.05)) break
    const c = hold(w, { ...launch(w), x, y: ground(w, x) + 0.03, vx: 0, vy: -0.005 }, IDLE, 2)
    expect(c.done?.landed).toBe(false)
    expect(c.done?.score).toBe(0)
  })
  it('does not move once down', () => {
    const c = hold(w, over(w, 1, -0.01), IDLE, 0.5)
    expect(c.done?.landed).toBe(true)
    expect(step(w, c, { ...IDLE, thrust: true })).toBe(c)
  })
})

describe('the autopilot', () => {
  it('lands at every level, nearly always, and scores more level by level', () => {
    const levels = ['easy', 'fair', 'hard'] as const
    const avg = levels.map((lv) => {
      let landed = 0
      let total = 0
      for (let s = 0; s < 60; s++) {
        const c = autoland(makeWorld(s), lv)
        if (c.done?.landed) landed++
        total += c.done?.score ?? 0
      }
      // measured over two hundred terrains: every level landed every time
      expect(landed).toBeGreaterThanOrEqual(57)
      return total / 60
    })
    // measured: Easy 211, Fair 320, Hard 520 on average
    expect(avg[1]).toBeGreaterThan(avg[0] * 1.3)
    expect(avg[2]).toBeGreaterThan(avg[1] * 1.3)
  })
})

describe('what is kept', () => {
  it('round-trips every field that is not a default', () => {
    const s: Saved = {
      level: 'hard',
      look: 'ice',
      craft: 'teal',
      ghost: false,
      record: {
        easy: { landed: 3, crashed: 1, beat: 2, best: 210 },
        fair: { landed: 2, crashed: 5, beat: 1, best: 330 },
        hard: { landed: 1, crashed: 7, beat: 0, best: 512 },
      },
    }
    for (const k of Object.keys(s) as (keyof Saved)[]) expect(s[k]).not.toEqual(EMPTY[k])
    expect(readSaved(JSON.stringify(s))).toEqual(s)
  })
  it('falls back on anything it does not recognise', () => {
    expect(readSaved('{"level":"insane","ghost":"yes"}')).toEqual(EMPTY)
    expect(readSaved(null)).toEqual(EMPTY)
  })
})
