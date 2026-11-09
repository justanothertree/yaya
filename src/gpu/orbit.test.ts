import { describe, expect, it } from 'vitest'
import {
  DT,
  LEVELS,
  MU,
  THRUST,
  advance,
  autopilot,
  circular,
  elements,
  fly,
  hohmann,
  launch,
  met,
  predict,
  readBests,
  stars,
} from './orbit'

const period = (r: number) => 2 * Math.PI * Math.sqrt(r ** 3 / MU)

describe('gravity', () => {
  it('a circular orbit stays circular for fifty laps, its energy unmoved', () => {
    const s = circular(2)
    const e0 = elements(s)
    const steps = Math.round((50 * period(2)) / DT)
    for (let i = 0; i < steps; i++) advance(s, 0)
    const e1 = elements(s)
    expect(e1.peri).toBeCloseTo(2, 6)
    expect(e1.apo).toBeCloseTo(2, 6)
    expect(Math.abs(e1.energy - e0.energy)).toBeLessThan(1e-9)
    // and fifty laps bring it back to where it started
    expect(Math.hypot(s.p[0] - 2, s.p[1])).toBeLessThan(0.01)
  })

  it('knows the orbit it is on: a circle has e = 0, and speed √2 times circular is escape', () => {
    const c = elements(circular(3))
    // √(1 + 2Eh²) cancels to nothing at a circle, which costs float its last digits: 1e-8, not 0
    expect(c.e).toBeCloseTo(0, 6)
    const s = circular(3)
    s.v = [s.v[0] * Math.SQRT2, s.v[1] * Math.SQRT2]
    expect(elements(s).energy).toBeCloseTo(0, 12)
    // a tangential speed between gives an ellipse whose periapsis is where it was
    const t = circular(2)
    t.v = [t.v[0] * 1.2, t.v[1] * 1.2]
    const el = elements(t)
    expect(el.peri).toBeCloseTo(2, 9)
    // vis-viva: the apoapsis of that ellipse, worked out by hand
    const v = 1.2 * Math.sqrt(MU / 2)
    const a = 1 / (2 / 2 - (v * v) / MU)
    expect(el.apo).toBeCloseTo(2 * a - 2, 9)
  })

  it('the predicted path is the path flown', () => {
    const s = circular(2)
    s.v = [s.v[0] * 1.15, s.v[1] * 1.15]
    const path = predict(s, 10, 100)
    const c = { ...s, p: [...s.p] as [number, number], v: [...s.v] as [number, number] }
    for (let i = 0; i < Math.round(10 / DT); i++) advance(c, 0)
    const end = path[path.length - 1]
    expect(Math.hypot(end[0] - c.p[0], end[1] - c.p[1])).toBeLessThan(0.02)
  })
})

describe('burning', () => {
  it('a burn changes speed by THRUST × time, spends exactly that, and stops when fuel does', () => {
    const s = circular(2)
    s.fuel = 0.05
    const v0 = Math.hypot(...s.v)
    for (let i = 0; i < 10; i++) advance(s, 1)
    expect(s.spent).toBeCloseTo(10 * DT * THRUST, 12)
    // with gravity's own small change over the same moment, the speed went up by about that
    expect(Math.hypot(...s.v) - v0).toBeGreaterThan(9 * DT * THRUST)
    for (let i = 0; i < 1e5; i++) advance(s, 1)
    expect(s.fuel).toBeCloseTo(0, 12)
    expect(s.spent).toBeCloseTo(0.05, 12)
  })

  it('the cheapest two-burn transfer costs what Hohmann said in 1925', () => {
    // 2 → 4 with GM 1: worked by hand from vis-viva
    const a = 3
    const want =
      Math.sqrt(2 / 2 - 1 / a) - Math.sqrt(1 / 2) + (Math.sqrt(1 / 4) - Math.sqrt(2 / 4 - 1 / a))
    expect(hohmann(2, 4)).toBeCloseTo(want, 12)
    expect(hohmann(4, 2)).toBeCloseTo(want, 12)
  })
})

describe('the levels', () => {
  it('every level can be flown within its fuel, near the least the formula allows', () => {
    for (const l of LEVELS) {
      const f = autopilot(l)
      expect(f.outcome, l.name).toBe('done')
      expect(f.ship.spent, l.name).toBeLessThanOrEqual(l.fuel)
      expect(f.ship.spent / l.least, l.name).toBeLessThan(1.1)
      expect(stars(l, f.ship.spent), l.name).toBe(3)
    }
  })

  it('no level is met where it starts, and one can be lost', () => {
    for (const l of LEVELS) expect(met(l, launch(l).ship), l.name).toBe(false)
    // burning backwards from the start of "Higher" until the fuel is gone comes down on the planet
    const f = launch(LEVELS[0])
    for (let i = 0; i < 3000 && f.outcome === 'flying'; i++) fly(f, -1, 0.05)
    expect(['crashed', 'adrift']).toContain(f.outcome)
  })

  it('scores against the formula: three stars within 10%, two within 30%', () => {
    const l = LEVELS[0]
    expect(stars(l, l.least * 1.05)).toBe(3)
    expect(stars(l, l.least * 1.2)).toBe(2)
    expect(stars(l, l.least * 1.5)).toBe(1)
  })
})

describe('kept in this browser', () => {
  it('keeps a best only if a flight could have spent it', () => {
    const l = LEVELS[0]
    const b = readBests(JSON.stringify({ [l.name]: l.least * 1.02, Nope: 1, [LEVELS[1].name]: 99 }))
    expect(b).toEqual({ [l.name]: l.least * 1.02 })
    expect(readBests(JSON.stringify({ [l.name]: l.least * 0.5 }))).toEqual({})
    expect(readBests('junk')).toEqual({})
  })
})
