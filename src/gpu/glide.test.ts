import { describe, expect, it } from 'vitest'
import {
  CIRCLING,
  DT,
  PACE,
  SPEED,
  TASKS,
  TRAINER,
  air,
  climbHere,
  fitPolar,
  fly,
  glideRatio,
  launch,
  minSinkSpeed,
  par,
  pilot,
  readSaved,
  sink,
  speedToFly,
  stars,
  step,
} from './glide'

const kmh = (v: number) => v * 3.6
const task = (id: string) => TASKS.find((t) => t.id === id)!

describe('the polar', () => {
  it('passes through the three points it was fitted to', () => {
    const p = fitPolar([
      [20, 0.7],
      [25, 0.8],
      [40, 1.6],
    ])
    expect(sink(p, 20)).toBeCloseTo(0.7, 9)
    expect(sink(p, 25)).toBeCloseTo(0.8, 9)
    expect(sink(p, 40)).toBeCloseTo(1.6, 9)
  })
  it('is shaped like a trainer: about 0.7 m/s at its slowest sink, about 1 in 31 at best', () => {
    expect(sink(TRAINER, minSinkSpeed(TRAINER))).toBeLessThan(0.7)
    expect(sink(TRAINER, minSinkSpeed(TRAINER))).toBeGreaterThan(0.6)
    expect(glideRatio(TRAINER, speedToFly(TRAINER, 0))).toBeGreaterThan(30)
    expect(glideRatio(TRAINER, speedToFly(TRAINER, 0))).toBeLessThan(33)
  })
})

describe('speed to fly — the closed forms against a plain search', () => {
  // the search shares no algebra with the closed form: it just tries every speed
  const argmax = (f: (v: number) => number) => {
    let best = -Infinity
    let at = 0
    for (let v = SPEED.min; v <= SPEED.max; v += 0.001) {
      const y = f(v)
      if (y > best) [best, at] = [y, v]
    }
    return at
  }
  it('with no climb expected, the best glide: the speed that goes furthest per metre lost', () => {
    expect(speedToFly(TRAINER, 0)).toBeCloseTo(
      argmax((v) => glideRatio(TRAINER, v)),
      2,
    )
  })
  it('for an expected climb m, the speed that makes the best average across country', () => {
    // glide at v, then climb back the height lost at m: average speed v·m / (sink + m)
    for (const m of [0.5, 1, 2, 3])
      for (const a of [0, -1, 0.5]) {
        const want = argmax((v) => (v * m) / (sink(TRAINER, v) - a + m))
        expect(speedToFly(TRAINER, m, a), `m ${m}, air ${a}`).toBeCloseTo(want, 2)
      }
  })
  it('flies faster for a stronger day, and faster again through sinking air', () => {
    const s = [0, 1, 2, 3].map((m) => speedToFly(TRAINER, m))
    for (let i = 1; i < s.length; i++) expect(s[i]).toBeGreaterThan(s[i - 1])
    expect(speedToFly(TRAINER, 1, -1)).toBeGreaterThan(speedToFly(TRAINER, 1, 0))
    expect(speedToFly(TRAINER, 1, 1)).toBeLessThan(speedToFly(TRAINER, 1, 0))
    // and never outside what the glider can be flown at
    expect(kmh(speedToFly(TRAINER, 10, -5))).toBeCloseTo(kmh(SPEED.max), 6)
  })
})

describe('the flight', () => {
  it('a final glide at best glide goes height × glide ratio, as the arithmetic says', () => {
    const t = { ...task('glide'), finish: 1e9 }
    const v = speedToFly(TRAINER, 0)
    const r = fly(t, (_, g) => {
      g.v = v
      g.circling = false
    })
    expect(r.end).toBe('landed')
    // a flight notices the ground only after the step that crossed it, so it lands up to ONE STEP
    // long — v × DT × PACE, about 15 m here — and never short
    const exact = t.start * glideRatio(TRAINER, v)
    expect(r.x).toBeGreaterThanOrEqual(exact - 1e-6)
    expect(r.x).toBeLessThan(exact + v * DT * PACE)
  })
  it('circling climbs at the thermal’s lift less the circling sink, and only goes up in a core', () => {
    const t = task('first')
    const th = t.thermals[0]
    const g = { ...launch(t), x: th.x, h: 600, circling: true }
    const h0 = g.h
    step(t, g)
    const want = th.lift - sink(TRAINER, minSinkSpeed(TRAINER)) * CIRCLING
    expect((g.h - h0) / g.t).toBeCloseTo(want, 6)
    expect(climbHere(t, th.x + th.r * 1.5, 600)).toBeLessThan(0)
    expect(air(t, th.x, t.base + 10)).toBe(-t.sinkAir) // no lift above cloudbase
  })
  it('circling works towards the core', () => {
    const t = task('first')
    const th = t.thermals[0]
    const g = { ...launch(t), x: th.x + th.r * 0.8, h: 600, circling: true }
    for (let i = 0; i < 40; i++) step(t, g)
    expect(Math.abs(g.x - th.x)).toBeLessThan(th.r * 0.8)
  })
})

describe('the tasks', () => {
  it('every one has a par, and a pilot who never circles cannot reach it where thermals are needed', () => {
    for (const t of TASKS) {
      expect(par(t), t.id).not.toBeNull()
      const r = fly(t, (_, g) => {
        g.v = speedToFly(TRAINER, 0)
        g.circling = false
      })
      expect(r.end, t.id).toBe(t.thermals.length ? 'landed' : 'finished')
    }
  })
  it('the final glide is lost flying much too slow or much too fast', () => {
    const t = task('glide')
    for (const v of [SPEED.min, SPEED.max])
      expect(
        fly(t, (_, g) => {
          g.v = v
          g.circling = false
        }).end,
      ).toBe('landed')
  })
  it('greed lands out: a pilot waiting for 4 m/s lands short on every thermal task', () => {
    for (const t of TASKS.filter((x) => x.thermals.length))
      expect(fly(t, pilot(4)).end, t.id).toBe('landed')
  })
  it('MacCready’s rule holds: on a single thermal, the best setting is about the climb it gives', () => {
    // a result of the theory, not of tuning: nothing in the pilot or the task was set to make it so
    const t = task('first')
    const climb = t.thermals[0].lift - sink(TRAINER, minSinkSpeed(TRAINER)) * CIRCLING
    expect(Math.abs(par(t)!.m - climb)).toBeLessThanOrEqual(0.25)
  })
  it('stars against par', () => {
    expect([100, 109, 125, 200].map((x) => stars(x, 100))).toEqual([3, 3, 2, 1])
  })
})

describe('what is kept', () => {
  it('keeps a best time per task and drops anything else', () => {
    const s = { glide: 700.5, street: 3000 }
    expect(readSaved(JSON.stringify(s))).toEqual(s)
    expect(readSaved(JSON.stringify({ glide: -1, nope: 5, blue: 'x' }))).toEqual({})
    expect(readSaved('{')).toEqual({})
  })
})
