import { describe, expect, it } from 'vitest'
import code from './crossing.wgsl?raw'
import {
  BEAM,
  BOAT,
  BOAT_R,
  CLEAR,
  COURSES,
  FADE,
  HULL,
  MAX_ROCKS,
  NIGHT,
  PER,
  WIDE,
  beamShape,
  blocked,
  lightAt,
  lineAt,
  makeCourse,
  packNight,
  rocksNear,
  rowsFor,
  sail,
  setOff,
  toWorld,
  type Course,
  type Helm,
  type Voyage,
} from './crossing'
import { wgslLayout } from './wgslLayout'

const still: Helm = { left: false, right: false, faster: false, slower: false }
/** a pilot who can see the corridor: steers for a point a little ahead on its line */
const pilot = (c: Course, v: Voyage, faster = false): Helm => {
  const b = v.boat
  const ty = b.y + 2.2
  let d = Math.atan2(ty - b.y, lineAt(c, ty) - b.x) - b.heading
  d = Math.atan2(Math.sin(d), Math.cos(d))
  return { left: d > 0.05, right: d < -0.05, faster, slower: false }
}
const voyage = (c: Course, helm: (v: Voyage) => Helm, seconds = 400) => {
  const v = setOff(c)
  const seen: Voyage['events'] = []
  for (let k = 0; k < seconds * 60 && !v.done && !v.wrecked; k++) {
    sail(v, c, helm(v), 1 / 60)
    seen.push(...v.events)
  }
  return { v, seen }
}

describe('a crossing', () => {
  it('is the same every time from the same seed, and different from another', () => {
    expect(makeCourse('a', 7, 60, 40)).toEqual(makeCourse('a', 7, 60, 40))
    expect(makeCourse('a', 8, 60, 40).rocks).not.toEqual(makeCourse('a', 7, 60, 40).rocks)
  })
  it('keeps its corridor clear: no rock within CLEAR of the line, anywhere along it', () => {
    for (const c of COURSES) {
      expect(c.rocks.length, c.name).toBeGreaterThan(30)
      for (let y = 0; y <= c.length; y += 0.1) {
        const x = lineAt(c, y)
        expect(x).toBeGreaterThan(2)
        expect(x).toBeLessThan(WIDE - 2)
        for (const [rx, ry, rr] of c.rocks)
          expect(Math.hypot(x - rx, y - ry), `${c.name} at ${y.toFixed(1)}`).toBeGreaterThanOrEqual(
            rr + CLEAR - 0.06,
          )
      }
    }
  })
  it('can be crossed: a pilot who follows the corridor gets home untouched and rings every buoy', () => {
    for (const c of COURSES)
      for (const fast of [false, true]) {
        const { v, seen } = voyage(c, (vv) => pilot(c, vv, fast))
        expect(v.done, c.name).toBe(true)
        expect(v.hull, c.name).toBe(HULL)
        expect(
          seen.filter((e) => e === 'bell'),
          c.name,
        ).toHaveLength(c.buoys.length)
      }
  })
  it('cannot be crossed blind: a boat left to sail straight on is wrecked', () => {
    for (const c of COURSES) {
      const { v, seen } = voyage(c, () => still)
      expect(v.wrecked, c.name).toBe(true)
      expect(
        seen.filter((e) => e === 'hit'),
        c.name,
      ).toHaveLength(HULL)
    }
  })
})

describe('the boat', () => {
  it('cruises when left alone, and comes up to full speed or down to slow', () => {
    const c = COURSES[0]
    const v = setOff(c)
    expect(v.boat.speed).toBe(BOAT.cruise)
    for (let k = 0; k < 600; k++) sail(v, { ...c, rocks: [] }, { ...still, faster: true }, 1 / 60)
    expect(v.boat.speed).toBeGreaterThan(BOAT.fast * 0.99)
    for (let k = 0; k < 600; k++) sail(v, { ...c, rocks: [] }, { ...still, slower: true }, 1 / 60)
    expect(v.boat.speed).toBeLessThan(BOAT.slow * 1.01)
  })
  it('turns at its own rate, port to the left', () => {
    const v = setOff(COURSES[0])
    const h0 = v.boat.heading
    sail(v, { ...COURSES[0], rocks: [] }, { ...still, left: true }, 0.5)
    expect(v.boat.heading - h0).toBeCloseTo(BOAT.turn * 0.5, 9)
  })
  it('a rock costs one hull point and throws the boat off — not one a frame while it scrapes', () => {
    const c: Course = { ...COURSES[0], rocks: [[6, 5, 0.8]], buoys: [] }
    const v = setOff(c)
    v.boat.x = 6
    v.boat.y = 3
    v.boat.heading = Math.PI / 2
    let hits = 0
    for (let k = 0; k < 60; k++) {
      sail(v, c, still, 1 / 60)
      hits += v.events.filter((e) => e === 'hit').length
    }
    expect(hits).toBe(1)
    expect(v.hull).toBe(HULL - 1)
    expect(Math.hypot(v.boat.x - 6, v.boat.y - 5)).toBeGreaterThanOrEqual(0.8 + BOAT_R - 1e-9)
  })
  it('stays in the channel: the banks turn it back', () => {
    const c: Course = { ...COURSES[0], rocks: [] }
    const v = setOff(c)
    v.boat.heading = 0.05
    for (let k = 0; k < 600; k++) sail(v, c, still, 1 / 60)
    expect(v.boat.x).toBeLessThanOrEqual(WIDE - BOAT_R)
    expect(v.boat.x).toBeGreaterThanOrEqual(BOAT_R)
  })
})

describe('the light', () => {
  const beam = { at: [6, 10] as [number, number], angle: Math.PI / 2, width: 0 }
  it('trades reach for width', () => {
    expect(beamShape(0)).toEqual({ half: BEAM.narrow, range: BEAM.narrowRange })
    expect(beamShape(1)).toEqual({ half: BEAM.wide, range: BEAM.wideRange })
    expect(lightAt(beam, [6, 22], [])).toBeGreaterThan(0)
    expect(lightAt({ ...beam, width: 1 }, [6, 22], [])).toBe(0)
    // and off the axis, only the wide beam sees
    expect(lightAt(beam, [7, 12], [])).toBe(0)
    expect(lightAt({ ...beam, width: 1 }, [7, 12], [])).toBeGreaterThan(0)
  })
  it('is brightest on its axis near the lamp, and nothing behind it', () => {
    expect(lightAt(beam, [6, 11], [])).toBeGreaterThan(lightAt(beam, [6, 20], []))
    expect(lightAt(beam, [6, 9], [])).toBe(0)
  })
  it('a rock throws a shadow behind it, and lights its own near face', () => {
    const rock: [number, number, number] = [6, 14, 0.8]
    expect(lightAt(beam, [6, 18], [rock])).toBe(0)
    expect(lightAt(beam, [6, 18], [])).toBeGreaterThan(0)
    expect(lightAt(beam, [6, 13.3], [rock])).toBeGreaterThan(0)
    expect(blocked([6, 10], [6, 18], [rock])).toBe(true)
    expect(blocked([6, 10], [8, 18], [rock])).toBe(false)
  })
})

describe('for the GPU', () => {
  it('the uniform agrees with the shader about where every field lives, and is written where read', () => {
    const wgsl = wgslLayout(code, 'Night')
    const { bytes, ...rest } = NIGHT
    expect(wgsl.offsets).toEqual(rest)
    expect(wgsl.bytes).toBe(bytes)
    const v = new DataView(
      packNight({
        w: 360,
        h: 640,
        map: [72, 552],
        cam: [6, 30],
        span: 18,
        beam: { at: [5, 25], angle: 1.25, width: 0.5 },
        boat: { x: 5, y: 24.75, heading: 1.5, speed: 2 },
        shaken: 0.5,
        rows: [60, 264],
        rocks: 40,
        buoys: 6,
        time: 3,
        length: 90,
        dt: 0.5,
      }),
    )
    const f = (o: number) => v.getFloat32(o, true)
    const u = (o: number) => v.getUint32(o, true)
    expect([u(0), u(4), u(8), u(12)]).toEqual([360, 640, 72, 552])
    expect([f(NIGHT.cam), f(NIGHT.cam + 4), f(NIGHT.cam + 8)]).toEqual([6, 30, 18])
    expect([0, 4, 8, 12].map((k) => f(NIGHT.lamp + k))).toEqual([5, 25, 1.25, 0.5])
    expect([0, 4, 8, 12].map((k) => f(NIGHT.boat + k))).toEqual([5, 24.75, 1.5, 0.5])
    expect([u(NIGHT.rows), u(NIGHT.rows + 4), u(NIGHT.rocks), u(NIGHT.buoys)]).toEqual([
      60, 264, 40, 6,
    ])
    expect([f(NIGHT.time), f(NIGHT.length)]).toEqual([3, 90])
    expect(f(NIGHT.fade)).toBeCloseTo(FADE ** 0.5, 6)
  })
  it('carries the shader’s copies of the beam and the map', () => {
    const num = (name: string) => Number(new RegExp(`const ${name} = ([0-9.]+);`).exec(code)?.[1])
    expect(
      ['WIDE', 'PER', 'NARROW', 'WIDE_HALF', 'NARROW_RANGE', 'WIDE_RANGE', 'BOAT_R'].map(num),
    ).toEqual([WIDE, PER, BEAM.narrow, BEAM.wide, BEAM.narrowRange, BEAM.wideRange, BOAT_R])
  })
  it('sends the rocks near the boat, nearest first and no more than fit, and the rows round it', () => {
    const c = COURSES[2]
    const near = rocksNear(c, 60)
    expect(near.length).toBeLessThanOrEqual(MAX_ROCKS)
    expect(near.every((r) => Math.abs(r[1] - 60) < 22 + r[2])).toBe(true)
    // every rock the beam could reach from there is in the list
    const reach = BEAM.narrowRange + 1
    for (const r of c.rocks) if (Math.abs(r[1] - 60) < reach) expect(near).toContainEqual(r)
    expect(rowsFor(c, 60)).toEqual([(60 - 22) * PER, 44 * PER])
    expect(rowsFor(c, 2)[0]).toBe(0)
  })
  it('puts the camera’s point in the middle of the stage, y up', () => {
    expect(toWorld([360, 640], [6, 30], 18, [180, 320])).toEqual([6, 30])
    expect(toWorld([360, 640], [6, 30], 18, [180, 0])[1]).toBeCloseTo(39, 9)
  })
})
