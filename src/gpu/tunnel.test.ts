import { describe, expect, it } from 'vitest'
import code from './tunnel.wgsl?raw'
import {
  CATCH,
  FULL_TILT,
  GAP,
  LAP,
  ORB,
  RADIUS,
  REACH,
  REACHED,
  ROOM,
  TUNNEL,
  camera,
  fly,
  hash,
  orbOffset,
  orbZ,
  packTunnel,
  path,
  takeOff,
  tiltStick,
  type Flight,
} from './tunnel'
import { wgslLayout } from './wgslLayout'

const constant = (name: string) => {
  const m = code.match(new RegExp(`const ${name} = ([0-9.]+);`))
  if (!m) throw new Error(`no ${name} in tunnel.wgsl`)
  return Number(m[1])
}

describe('the shader and this file describe one tunnel', () => {
  const wgsl = wgslLayout(code, 'Tunnel')

  it('agrees about where every field of the uniform lives', () => {
    const { bytes, prevTaken, ...rest } = TUNNEL
    expect(wgsl.offsets).toEqual({ ...rest, prev_taken: prevTaken })
    expect(wgsl.bytes).toBe(bytes)
  })

  it('agrees about the tunnel’s size, its lap and its orbs', () => {
    expect([LAP, RADIUS, GAP, REACH, ORB]).toEqual(
      ['LAP', 'RADIUS', 'GAP', 'REACH', 'ORB'].map(constant),
    )
  })

  it('writes every field where the shader will look for it', () => {
    const cam = {
      eye: [0.5, -0.25, 12.5],
      fwd: [0, 0.6, 0.8],
      right: [1, 0, 0],
      up: [0, 0.8, -0.6],
    } as const
    const f: Flight = { ...takeOff(), s: 20, first: 4, prevTaken: true }
    const b = packTunnel({ cam, time: 7.5, aspect: 1.5, speed: 9, flash: 0.25, f, theme: 'ice' })
    const v = new DataView(b)
    const at = (field: string, i = 0) => v.getFloat32(wgsl.offsets[field] + 4 * i, true)
    const u = (field: string) => v.getUint32(wgsl.offsets[field], true)
    expect([0, 1, 2, 3].map((i) => at('eye', i))).toEqual([0.5, -0.25, 12.5, 7.5])
    expect([0, 1, 2, 3].map((i) => at('fwd', i))).toEqual([
      0,
      Math.fround(0.6),
      Math.fround(0.8),
      1.5,
    ])
    expect(at('right', 3)).toBe(9)
    expect(at('up', 3)).toBe(0.25)
    expect([u('first'), u('prev_taken'), u('palette')]).toEqual([4, 1, 2])
    // the next orb is 4 · 6 + 3 = 27 along, and we are at 20
    expect(at('ahead')).toBe(7)
  })
})

describe('the tunnel', () => {
  it('comes round to exactly where it was every lap, so a wrapped camera sees the same tunnel', () => {
    for (const z of [0, 13.7, 101, 239.9]) {
      const [a, b] = [path(z), path(z + LAP * 17)]
      expect(a[0]).toBeCloseTo(b[0], 9)
      expect(a[1]).toBeCloseTo(b[1], 9)
    }
  })

  it('hangs every orb where it can be reached, and out of the wall', () => {
    for (let k = 0; k < 2000; k++) {
      const r = Math.hypot(...orbOffset(k))
      expect(r).toBeLessThanOrEqual(ROOM)
      expect(r + ORB).toBeLessThan(RADIUS - 0.13) // the wall ripples in by up to 0.13
    }
  })

  it('scatters orbs all round the tunnel rather than in one place', () => {
    const quadrants = [0, 0, 0, 0]
    for (let k = 0; k < 400; k++) {
      const [x, y] = orbOffset(k)
      quadrants[(x > 0 ? 1 : 0) + (y > 0 ? 2 : 0)]++
    }
    for (const n of quadrants) expect(n).toBeGreaterThan(70)
    for (let k = 0; k < 1000; k++) expect(hash(k)).toBeGreaterThanOrEqual(0)
  })

  it('keeps you off the wall however long you hold the stick', () => {
    let f = takeOff()
    for (let i = 0; i < 300; i++) f = fly(f, 1 / 60, [1, 1], 5).f
    expect(Math.hypot(...f.off)).toBeCloseTo(ROOM, 9)
    expect(ROOM).toBeLessThan(RADIUS - 0.13 - 0.05)
  })
})

describe('catching orbs', () => {
  it('catches an orb you are sitting on, and misses one you are not', () => {
    const o = orbOffset(0)
    const on = fly({ ...takeOff(), off: o }, 1, [0, 0], orbZ(0))
    expect([on.caught, on.f.caught, on.f.missed, on.f.prevTaken]).toEqual([1, 1, 0, true])
    const away = fly({ ...takeOff(), off: [-o[0], -o[1]] }, 1, [0, 0], orbZ(0))
    expect([away.caught, away.f.caught, away.f.missed, away.f.prevTaken]).toEqual([0, 0, 1, false])
  })

  it('reaches every orb exactly once, however the frames fall', () => {
    let f = takeOff()
    const steps = [1 / 144, 1 / 30, 0.25, 1.3]
    for (let i = 0; i < 400; i++) f = fly(f, steps[i % 4], [Math.sin(i), Math.cos(i * 0.7)], 9).f
    const reached = Math.floor((f.s + REACHED - orbZ(0)) / GAP) + 1
    expect(f.caught + f.missed).toBe(reached)
    expect(f.first).toBe(reached)
  })

  it('a streak ends on a miss and the best one is kept', () => {
    let f: Flight = { ...takeOff(), streak: 4, best: 4 }
    const o = orbOffset(0)
    f = fly({ ...f, off: [-o[0], -o[1]] }, 1, [0, 0], orbZ(0)).f
    expect([f.streak, f.best]).toEqual([0, 4])
  })

  /** a pilot who always steers straight for the next orb, full stick */
  const perfect = (speed: number, orbs: number) => {
    let f = takeOff()
    while (f.first < orbs) {
      const o = orbOffset(f.first)
      const d = [o[0] - f.off[0], o[1] - f.off[1]]
      const l = Math.hypot(d[0], d[1])
      const stick: [number, number] = l < 0.02 ? [0, 0] : [d[0] / l, d[1] / l]
      f = fly(f, 1 / 60, stick, speed).f
    }
    return f.caught / orbs
  }

  it('can be flown perfectly at Cruise and Fast, and asks you to choose at Warp', () => {
    expect(perfect(5, 300)).toBe(1)
    expect(perfect(9, 300)).toBe(1)
    const warp = perfect(15, 300)
    expect(warp).toBeLessThan(1)
    expect(warp).toBeGreaterThan(0.5)
  })

  it('does not count a near pass as far off as the next lane', () => {
    expect(CATCH).toBeLessThan(RADIUS * REACH)
  })
})

describe('the camera', () => {
  const dot = (a: readonly number[], b: readonly number[]) =>
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

  it('is a true basis wherever you are, however you lean', () => {
    for (const [s, lean] of [
      [0, [0, 0]],
      [77, [1, -0.5]],
      [240 * 9 + 5, [-1, 1]],
    ] as const) {
      const c = camera({ ...takeOff(), s, off: [0.3, -0.2] }, lean)
      for (const v of [c.fwd, c.right, c.up]) expect(Math.hypot(...v)).toBeCloseTo(1, 9)
      expect(dot(c.fwd, c.right)).toBeCloseTo(0, 9)
      expect(dot(c.fwd, c.up)).toBeCloseTo(0, 9)
      expect(dot(c.right, c.up)).toBeCloseTo(0, 9)
      expect(c.fwd[2]).toBeGreaterThan(0.8) // looking down the tunnel
      expect(c.eye[2]).toBeGreaterThanOrEqual(0)
      expect(c.eye[2]).toBeLessThan(LAP)
    }
  })

  it('banks into a turn: steering right tips up towards the right', () => {
    expect(camera(takeOff(), [1, 0]).up[0]).toBeGreaterThan(0.2)
    expect(camera(takeOff(), [-1, 0]).up[0]).toBeLessThan(-0.2)
  })
})

describe('steering by tilt', () => {
  const rest = { beta: 40, gamma: 5 }

  it('is measured from how the phone was held, not from flat', () => {
    expect(tiltStick(40, 5, rest, 0)).toEqual([0, 0])
    expect(tiltStick(40, 5 + FULL_TILT, rest, 0)).toEqual([1, 0])
    expect(tiltStick(40 + FULL_TILT / 2, 5, rest, 0)).toEqual([0, 0.5])
    expect(tiltStick(40 - 90, 5 - 90, rest, 0)).toEqual([-1, -1])
  })

  it('turns with the screen in landscape', () => {
    const [x, y] = tiltStick(40 + FULL_TILT, 5, rest, 90)
    expect(Math.abs(x)).toBeCloseTo(1, 9)
    expect(y).toBeCloseTo(0, 9)
  })
})
