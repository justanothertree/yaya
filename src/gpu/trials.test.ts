import { describe, expect, it } from 'vitest'
import code from './trials.wgsl?raw'
import { wgslLayout } from './wgslLayout'
import {
  ANCHORS,
  MAX_DUST,
  TEXEL,
  TRIAL,
  fieldFor,
  packSegments,
  packTrial,
  readBest,
  signedDistance,
  sprayFor,
  inGround,
  HEAD,
  IDLE,
  QUARRY,
  WHEEL_R,
  bodyPoint,
  frame,
  groundAt,
  nearest,
  retry,
  spawn,
  startRun,
  tick,
  type Bike,
  type Course,
  type Input,
} from './trials'

const flat: Course = {
  name: 'flat',
  start: [0, 0],
  checkpoints: [],
  finish: 1e9,
  chains: [
    [
      [-50, -30],
      [-50, 0],
      [500, 0],
      [500, -30],
    ],
  ],
}
const ride = (b: Bike, c: Course, input: Input, seconds: number) => {
  for (let k = 0; k < seconds * 60; k++) frame(b, c, input)
  return b
}
/** how deep the deepest wheel sits in the ground */
const sunk = (b: Bike, c: Course) =>
  Math.max(...b.wheels.map((w) => WHEEL_R - (nearest(c, [w.x, w.y], 2)?.d ?? 9)))
const speed = (b: Bike) => Math.hypot(b.vx, b.vy)

describe('the ground', () => {
  it('is below each chain: a point above is outside, a point below inside, and a step face pushes sideways', () => {
    expect(nearest(flat, [3, 0.2], 1)).toMatchObject({ d: expect.closeTo(0.2, 12), n: [0, 1] })
    expect(nearest(flat, [3, -0.2], 1)?.d).toBeCloseTo(-0.2, 12)
    // the far side of the block at x = 44.6 in the Quarry: just right of its face is air, pushed right and up
    const face = nearest(QUARRY, [44.5, 0.3], 0.5)!
    expect(face.d).toBeGreaterThan(0)
    expect(face.n[0]).toBeGreaterThan(0.5)
  })
  it('knows its height anywhere along the course, and that the gap has none', () => {
    expect(groundAt(QUARRY, 3)).toBe(0)
    expect(groundAt(QUARRY, 42)).toBeCloseTo(0.4, 9)
    expect(groundAt(QUARRY, 66)).toBe(null)
    expect(groundAt(QUARRY, 94)).toBeCloseTo(5.5, 9)
  })
})

describe('the bike', () => {
  it('stands on flat ground: settles on its springs, does not sink, slide or tip', () => {
    const b = ride(spawn([0, 0]), flat, IDLE, 4)
    expect(sunk(b, flat)).toBeLessThan(0.03)
    expect(sunk(b, flat)).toBeGreaterThan(0)
    expect(speed(b)).toBeLessThan(0.02)
    expect(Math.abs(b.a)).toBeLessThan(0.01)
    expect(Math.abs(b.x)).toBeLessThan(0.05)
    expect(b.crashed).toBe(false)
    // the suspension carries it: the frame sags below each wheel's centre on its springs
    for (const k of [0, 1]) {
      const q = bodyPoint(b, ANCHORS[k])
      expect(b.wheels[k].y - q.y).toBeGreaterThan(0.03)
      expect(b.wheels[k].y - q.y).toBeLessThan(0.15)
    }
  })

  it('drives forward on the throttle, the wheels rolling rather than spinning on the spot', () => {
    const b = ride(spawn([0, 0]), flat, { gas: true, brake: false, lean: 0 }, 2)
    expect(b.vx).toBeGreaterThan(6)
    expect(b.x).toBeGreaterThan(5)
    // rolling: the rear wheel's rim speed is close to the ground speed
    const w = b.wheels[1]
    expect(Math.abs(w.vx + w.w * WHEEL_R)).toBeLessThan(0.5)
  })

  it('stops on the brake', () => {
    const b = ride(spawn([0, 0]), flat, { gas: true, brake: false, lean: 0 }, 2)
    ride(b, flat, { gas: false, brake: true, lean: 0 }, 2.5)
    expect(speed(b)).toBeLessThan(0.3)
  })

  it('lifts the front on the throttle with a lean back — a wheelie — and turns either way in the air', () => {
    const back = ride(spawn([0, 0]), flat, { gas: true, brake: false, lean: 1 }, 0.6)
    expect(back.a).toBeGreaterThan(0.15)
    expect(back.wheels[1].y).toBeGreaterThan(back.wheels[0].y + 0.1)
    // in the air, a lean turns the whole bike, either way and as much as each other
    const nose = ride(spawn([0, 30]), flat, { gas: false, brake: false, lean: -1 }, 0.3)
    const tail = ride(spawn([0, 30]), flat, { gas: false, brake: false, lean: 1 }, 0.3)
    expect(nose.a).toBeLessThan(-0.4)
    expect(tail.a).toBeCloseTo(-nose.a, 6)
  })

  it('keeps each wheel on its fork: hitting the face of a block at speed moves it up, not back', () => {
    const b = spawn([30, 0])
    b.vx = 9
    b.wheels.forEach((w) => {
      w.vx = 9
      w.w = -9 / WHEEL_R
    })
    let across = 0
    for (let k = 0; k < 130; k++) {
      frame(b, QUARRY, { gas: b.vx < 9, brake: false, lean: 0 })
      b.wheels.forEach((w, i) => {
        const q = bodyPoint(b, ANCHORS[i])
        across = Math.max(
          across,
          Math.abs((w.x - q.x) * Math.cos(b.a) + (w.y - q.y) * Math.sin(b.a)),
        )
      })
    }
    expect(b.x).toBeGreaterThan(44)
    // measured: 0.06 with the fork, 0.21 when it was one isotropic spring
    expect(across).toBeLessThan(0.1)
  })

  it('takes a drop of five metres on its springs without the wheels going through the ground', () => {
    const b = spawn([0, 5])
    let deepest = 0
    for (let k = 0; k < 120; k++) {
      frame(b, flat, IDLE)
      deepest = Math.max(deepest, sunk(b, flat))
    }
    expect(deepest).toBeLessThan(WHEEL_R * 0.6)
    expect(b.wheels.every((w) => w.y > 0)).toBe(true)
    expect(b.crashed).toBe(false)
  })

  it('crashes when the rider’s head meets the ground, and stops driving', () => {
    const b = spawn([0, 0])
    b.a = Math.PI
    b.y = 0.9
    b.wheels.forEach((w, k) => {
      const q = bodyPoint(b, ANCHORS[k])
      w.x = q.x
      w.y = q.y
    })
    ride(b, flat, { gas: true, brake: false, lean: 0 }, 2)
    expect(b.crashed).toBe(true)
    const x = b.x
    ride(b, flat, { gas: true, brake: false, lean: 0 }, 1)
    expect(Math.abs(b.x - x)).toBeLessThan(0.5)
    expect(bodyPoint(b, HEAD).y).toBeLessThan(0.6)
  })
})

describe('a run of the Quarry', () => {
  /**
   * A scripted rider, a few lines long: throttle on, and lean to keep the bike's angle near the
   * ground's slope a little ahead, a touch back in the air. If it finishes, the course can be.
   */
  const rider = (b: Bike): Input => {
    const ahead = groundAt(QUARRY, b.x + 1.2)
    const here = groundAt(QUARRY, b.x - 0.3)
    const want = ahead !== null && here !== null ? Math.atan2(ahead - here, 1.5) : 0.1
    const air = !b.touching[0] && !b.touching[1]
    const err = want + (air ? 0.05 : 0.08) - b.a
    return {
      gas: b.vx < (air ? 99 : 9),
      brake: false,
      lean: Math.max(-1, Math.min(1, err * 3 - b.w * 0.4)),
    }
  }

  it('can be finished — the scripted rider gets to the flag without crashing — and the clock is whole frames', () => {
    let run = startRun(QUARRY)
    let crashes = 0
    for (let k = 0; k < 60 * 120 && !run.finished; k++) {
      tick(run, QUARRY, rider(run.bike))
      if (run.bike.crashed) {
        crashes++
        run = retry(run, QUARRY)
      }
    }
    expect(run.finished).toBe(true)
    expect(crashes).toBe(0)
    expect(run.checkpoint).toBe(QUARRY.checkpoints.length - 1)
    expect(Number.isInteger(run.frames)).toBe(true)
    expect(run.frames / 60).toBeGreaterThan(15)
    expect(run.frames / 60).toBeLessThan(90)
  })

  it('is the same ride every time: no randomness anywhere in it', () => {
    const go = () => {
      const run = startRun(QUARRY)
      for (let k = 0; k < 600; k++) tick(run, QUARRY, rider(run.bike))
      return [run.bike.x, run.bike.y, run.bike.a, run.frames]
    }
    expect(go()).toEqual(go())
  })

  it('stops the clock on a crash, and a retry starts at the last checkpoint with the clock kept', () => {
    const run = startRun(QUARRY)
    run.checkpoint = 1
    run.frames = 1234
    run.bike.crashed = true
    tick(run, QUARRY, { gas: true, brake: false, lean: 0 })
    expect(run.frames).toBe(1234)
    const again = retry(run, QUARRY)
    expect(again.frames).toBe(1234)
    expect(again.bike.crashed).toBe(false)
    expect(again.bike.x).toBeCloseTo(QUARRY.checkpoints[1], 9)
  })
})

describe('the shader and this file describe one ride', () => {
  const wgsl = wgslLayout(code, 'Trial')
  it('agrees about where every field of the uniform lives', () => {
    const { bytes, ...rest } = TRIAL
    expect(wgsl.offsets).toEqual(rest)
    expect(wgsl.bytes).toBe(bytes)
  })
  it('writes every field where the shader will look for it', () => {
    const bike = spawn([10, 0])
    bike.a = 0.25
    bike.crashed = true
    bike.wheels[0].spin = 3
    bike.wheels[1].spin = -2
    const v = new DataView(
      packTrial(
        {
          w: 640,
          h: 360,
          cam: [12, 2],
          scale: 40,
          time: 9,
          bike,
          lean: -1,
          course: QUARRY,
          passed: 2,
          dust: 77,
        },
        123,
      ),
    )
    const u = (k: string, i = 0) => v.getUint32(wgsl.offsets[k] + 4 * i, true)
    const f = (k: string, i = 0) => v.getFloat32(wgsl.offsets[k] + 4 * i, true)
    const field = fieldFor(QUARRY)
    expect([u('size'), u('size', 1), u('segments'), u('dust'), u('grid'), u('grid', 1)]).toEqual([
      640,
      360,
      123,
      77,
      ...field.grid,
    ])
    expect([f('cam'), f('cam', 1), f('scale'), f('time'), f('texel')]).toEqual(
      [12, 2, 40, 9, TEXEL].map(Math.fround),
    )
    expect([f('origin'), f('origin', 1)]).toEqual(field.origin.map(Math.fround))
    expect([0, 1, 2, 3].map((i) => f('body', i))).toEqual(
      [bike.x, bike.y, 0.25, -1].map(Math.fround),
    )
    expect([f('rear', 2), f('front', 2), f('passed'), f('crashed')]).toEqual([3, -2, 2, 1])
    expect([0, 1, 2, 3].map((i) => f('flags', i))).toEqual(QUARRY.checkpoints.map(Math.fround))
    expect(f('flagsY', 2)).toBeCloseTo(groundAt(QUARRY, QUARRY.checkpoints[2])!, 5)
    expect([f('finish'), f('finish', 1)]).toEqual(
      [QUARRY.finish, groundAt(QUARRY, QUARRY.finish)!].map(Math.fround),
    )
  })
  it('bakes every edge, the closing ones too, so the shader counts crossings as inGround does', () => {
    const segs = packSegments(QUARRY)
    expect(segs.length / 4).toBe(QUARRY.chains.reduce((n, c) => n + c.length, 0))
    // and the signed distance the bake must reproduce agrees with nearest() where both apply
    for (const p of [
      [3, 0.2],
      [3, -0.2],
      [66, 0.5],
      [44.5, 0.3],
      [94, 6],
    ] as [number, number][]) {
      const n = nearest(QUARRY, p, 3)!
      expect(signedDistance(QUARRY, p)).toBeCloseTo(n.d, 9)
      expect(signedDistance(QUARRY, p) < 0).toBe(inGround(QUARRY, p))
    }
  })
  it('covers the whole course with room above, in whole texels', () => {
    const { origin, grid } = fieldFor(QUARRY)
    const xs = QUARRY.chains.flat().map((p) => p[0])
    expect(origin[0]).toBeLessThan(Math.min(...xs))
    expect(origin[0] + grid[0] * TEXEL).toBeGreaterThan(Math.max(...xs))
    expect(origin[1] + grid[1] * TEXEL).toBeGreaterThan(5.5 + 6)
    expect(grid.every(Number.isInteger)).toBe(true)
  })
})

describe('mud', () => {
  const lcg = (seed: number) => {
    let s = seed >>> 0
    return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296
  }
  it('flies off a slipping tyre, backwards from the way the tread runs, and not off a rolling one', () => {
    const b = spawn([5, 0])
    ride(b, QUARRY, { gas: true, brake: false, lean: 0 }, 0.2)
    const spray = sprayFor(b, QUARRY, lcg(1))
    expect(spray.length).toBeGreaterThan(0)
    expect(spray.length % 8).toBe(0)
    for (let i = 0; i < spray.length; i += 8) expect(spray[i + 2]).toBeLessThan(0)
    const rolling = ride(spawn([5, 0]), QUARRY, IDLE, 2)
    expect(sprayFor(rolling, QUARRY, lcg(1))).toEqual([])
    expect(MAX_DUST % 64).toBe(0)
  })
})

describe('a stored best time', () => {
  it('is believed only as a whole number of frames between a second and an hour', () => {
    expect(readBest('1500')).toBe(1500)
    for (const bad of [null, '', 'abc', '15.5', '-60', '59', '9999999', '1e5', ' 1500', '{"t":1}'])
      expect(readBest(bad)).toBe(null)
  })
})
