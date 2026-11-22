import { describe, expect, it } from 'vitest'
import {
  EMPTY,
  GATES,
  GRASS_SPEED,
  TOP_SPEED,
  TRACKS,
  dailyTrack,
  drive,
  locate,
  goldLap,
  medals,
  newLap,
  onTrack,
  packGhost,
  paceLap,
  pilot,
  progress,
  readSaved,
  selfClear,
  sharpest,
  speedOf,
  startCar,
  unpackGhost,
  type Car,
  type Track,
} from './timetrial'

const ring = TRACKS[0]
const at = (t: Track, i: number, extra: Partial<Car> = {}): Car => ({
  ...startCar(t),
  x: t.pts[i].x,
  y: t.pts[i].y,
  i,
  ...extra,
})

describe('tracks', () => {
  it('every track is a clean loop that never comes near itself, with no bend tighter than a car can take', () => {
    for (const t of [
      ...TRACKS,
      ...Array.from({ length: 30 }, (_, k) => dailyTrack(1000 + k * 7)),
    ]) {
      expect(t.length).toBeGreaterThan(600)
      expect(selfClear(t)).toBe(true)
      expect(sharpest(t)).toBeGreaterThan(8)
    }
  })
  it("today's track is everyone's, and tomorrow's is another", () => {
    expect(dailyTrack(42).pts).toEqual(dailyTrack(42).pts)
    expect(dailyTrack(43).pts).not.toEqual(dailyTrack(42).pts)
  })
  it('finds how far a point is from the middle of the road', () => {
    const i = 100
    const a = ring.pts[i]
    const b = ring.pts[i + 1]
    const len = Math.hypot(b.x - a.x, b.y - a.y)
    // five metres straight out sideways from the centreline
    const p = { x: a.x - ((b.y - a.y) / len) * 5, y: a.y + ((b.x - a.x) / len) * 5 }
    expect(locate(ring, a).off).toBeCloseTo(0, 6)
    expect(locate(ring, p).off).toBeCloseTo(5, 1)
    expect(locate(ring, p, i).i).toBe(locate(ring, p).i)
  })
})

describe('the car', () => {
  it('never beats its top speed, and on the grass is held far below it', () => {
    let c = startCar(ring)
    let top = 0
    for (let k = 0; k < 60 * 30; k++) {
      c = drive(ring, c, pilot(ring, c), 1 / 60)
      top = Math.max(top, speedOf(c))
    }
    expect(top).toBeLessThanOrEqual(TOP_SPEED)
    expect(top).toBeGreaterThan(TOP_SPEED * 0.8)
    // well off the road, flat out, for ten seconds
    let g: Car = { ...startCar(ring), x: 0, y: 0, i: 0, off: 99 }
    for (let k = 0; k < 600; k++) g = drive(ring, g, { gas: 1, brake: 0, steer: 0 }, 1 / 60)
    expect(onTrack(ring, g)).toBe(false)
    expect(speedOf(g)).toBeLessThanOrEqual(GRASS_SPEED)
  })
  it('the brake stops it and does not reverse it; steering turns it the way it is pushed', () => {
    let c = {
      ...startCar(ring),
      vx: 30 * Math.cos(startCar(ring).heading),
      vy: 30 * Math.sin(startCar(ring).heading),
    }
    for (let k = 0; k < 180; k++) c = drive(ring, c, { gas: 0, brake: 1, steer: 0 }, 1 / 60)
    expect(speedOf(c)).toBeLessThan(0.01)
    const moving = {
      ...startCar(ring),
      vx: 20 * Math.cos(startCar(ring).heading),
      vy: 20 * Math.sin(startCar(ring).heading),
    }
    const left = drive(ring, moving, { gas: 0, brake: 0, steer: -1 }, 0.1)
    const right = drive(ring, moving, { gas: 0, brake: 0, steer: 1 }, 0.1)
    expect(left.heading).toBeLessThan(moving.heading)
    expect(right.heading).toBeGreaterThan(moving.heading)
    // standing still, the wheel turns nothing
    expect(drive(ring, startCar(ring), { gas: 0, brake: 0, steer: 1 }, 0.1).heading).toBe(
      startCar(ring).heading,
    )
  })
})

describe('laps', () => {
  it('the computer laps every track, and its medal lap is a flying one, quicker than its first', () => {
    for (const t of [...TRACKS, dailyTrack(7)]) {
      const pace = paceLap(t)
      expect(pace).toBeGreaterThan(t.length / TOP_SPEED)
      expect(pace).toBeLessThan(t.length / 12)
    }
  })
  it('the car starts just behind the line, and the first time over it starts the clock and finishes nothing', () => {
    const c = startCar(ring)
    expect((ring.along[c.i] / ring.length) * GATES).toBeGreaterThan(GATES - 1)
    const r = progress(ring, newLap(), at(ring, ring.pts.length - 1), at(ring, 1), 3)
    expect(r.done).toBeNull()
    expect(r.lap).toEqual({ next: 1, started: 3 })
  })
  it('a lap counts only when every part of the track was driven in order — no short cuts', () => {
    const n = ring.pts.length
    // the middle of each part, by distance along the road (the samples are not evenly spaced)
    const partStart = (k: number) =>
      ring.along.findIndex((a) => (a / ring.length) * GATES >= k + 0.5)
    // all the way round, one part at a time
    let lap = progress(ring, newLap(), at(ring, n - 1), at(ring, 1), 0).lap
    let prev = at(ring, 1)
    for (let k = 1; k < GATES; k++) {
      const c = at(ring, partStart(k))
      lap = progress(ring, lap, prev, c, k).lap
      prev = c
    }
    lap = progress(ring, lap, prev, at(ring, n - 1), 9).lap
    expect(progress(ring, lap, at(ring, n - 1), at(ring, 1), 20).done).toBe(20)
    // from the second part straight across to the last, then over the line
    let cut = progress(ring, newLap(), at(ring, n - 1), at(ring, 1), 0).lap
    cut = progress(ring, cut, at(ring, 1), at(ring, partStart(1)), 1).lap
    cut = progress(ring, cut, at(ring, partStart(1)), at(ring, n - 1), 2).lap
    expect(progress(ring, cut, at(ring, n - 1), at(ring, 1), 6).done).toBeNull()
  })
  it('gold is the computer at its best; a gentler driver is slower; the medals run gold, silver, bronze', () => {
    const pace = paceLap(TRACKS[1])
    expect(paceLap(TRACKS[1], 0.7)).toBeGreaterThan(pace)
    // gold is the best of several ways of driving, so never slower than any one of them
    const gold = goldLap(TRACKS[2])
    for (const k of [0.8, 1, 1.1]) expect(gold).toBeLessThanOrEqual(paceLap(TRACKS[2], k))
    const m = medals(pace)
    expect(m.gold).toBeLessThan(m.silver)
    expect(m.silver).toBeLessThan(m.bronze)
  })
})

describe('ghosts and saves', () => {
  it('a ghost keeps every position to a decimetre and every heading to a hundredth', () => {
    const lap = [
      { x: 12.345, y: -7.81, heading: 1.234 },
      { x: -150.04, y: 99.99, heading: -3.1 },
    ]
    const back = unpackGhost(packGhost(lap))
    back.forEach((s, k) => {
      expect(s.x).toBeCloseTo(lap[k].x, 1)
      expect(s.y).toBeCloseTo(lap[k].y, 1)
      expect(s.heading).toBeCloseTo(lap[k].heading, 2)
    })
    expect(unpackGhost('1,2')).toEqual([])
    expect(unpackGhost('<script>')).toEqual([])
  })
  it('round-trips every field away from its default, and drops a lap for a track that is not one', () => {
    const s = {
      track: 'hairpins',
      colour: 3,
      ghost: false,
      autoGas: true,
      best: {
        harbour: { lap: 25.31, ghost: '10,20,30;11,21,31' },
        'day-1813764870': { lap: 27.5, ghost: '' },
      },
    }
    expect(readSaved(JSON.stringify(s))).toEqual(s)
    expect(
      readSaved(JSON.stringify({ best: { moon: { lap: 3, ghost: '' }, ring: { lap: -1 } } })),
    ).toEqual(EMPTY)
    expect(readSaved('x')).toEqual(EMPTY)
  })
})
