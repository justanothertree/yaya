import { describe, expect, it } from 'vitest'
import code from './rain.wgsl?raw'
import {
  CLING,
  MAX_DROPS,
  PANE,
  STREAK,
  breathFrom,
  packDrops,
  packPane,
  raindrop,
  stepDrops,
  toSegment,
  water,
  wipeDrops,
  type Drop,
} from './rain'
import { wgslLayout } from './wgslLayout'

function lcg(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}
const ids = () => {
  let n = 1000
  return () => n++
}
const drop = (x: number, y: number, r: number, id = 0): Drop => ({
  x,
  y,
  r,
  vx: 0,
  vy: 0,
  run: 0,
  id,
})

describe('the shader and this file describe one window', () => {
  const wgsl = wgslLayout(code, 'Pane')
  it('agrees about where every field of the uniform lives', () => {
    const { bytes, ...rest } = PANE
    expect(wgsl.offsets).toEqual(rest)
    expect(wgsl.bytes).toBe(bytes)
  })
  it('writes every field where the shader will look for it, and every drop', () => {
    const v = new DataView(
      packPane({
        w: 640,
        h: 480,
        fall: [0.6, 0.8],
        drops: 12,
        wipes: 3,
        dt: 0.016,
        regrow: 0.05,
        breath: 0.7,
        brush: 22,
      }),
    )
    const u = (k: string, i = 0) => v.getUint32(wgsl.offsets[k] + 4 * i, true)
    const f = (k: string, i = 0) => v.getFloat32(wgsl.offsets[k] + 4 * i, true)
    expect([u('size'), u('size', 1), u('drops'), u('wipes')]).toEqual([640, 480, 12, 3])
    expect([f('fall'), f('fall', 1), f('dt'), f('regrow'), f('breath'), f('brush')]).toEqual(
      [0.6, 0.8, 0.016, 0.05, 0.7, 22].map(Math.fround),
    )
    // in the canvas's own pixels, and a tail that grows with speed until it is whole
    const d = { ...drop(10, 20, 5), vx: STREAK * 0.3, vy: STREAK * 0.4 }
    expect([...packDrops([d], 2).slice(0, 4)].map((x) => +x.toFixed(5))).toEqual([20, 40, 10, 0.5])
    expect(packDrops([{ ...d, vx: STREAK * 9 }])[3]).toBe(1)
    expect(packDrops(Array.from({ length: MAX_DROPS + 5 }, () => d)).length).toBe(MAX_DROPS * 4)
  })
})

describe('the drops', () => {
  const dt = 1 / 60

  it('cling while small, however the glass is tilted', () => {
    const rand = lcg(2)
    let d = [drop(100, 100, CLING * 0.9)]
    for (let k = 0; k < 120; k++) d = stepDrops(d, [0, 900], dt, 400, 400, rand, ids())
    expect(d).toHaveLength(1)
    expect([d[0].x, d[0].y]).toEqual([100, 100])
  })

  it('run along gravity once heavy enough, whichever way gravity points', () => {
    for (const g of [
      [0, 900],
      [900, 0],
      [-600, 600],
    ] as const) {
      const rand = lcg(3)
      let d = [drop(200, 200, 20)]
      for (let k = 0; k < 30; k++) d = stepDrops(d, g, dt, 400, 400, rand, ids())
      const big = d.reduce((a, b) => (b.r > a.r ? b : a))
      const moved = [big.x - 200, big.y - 200]
      expect(moved[0] * g[0] + moved[1] * g[1]).toBeGreaterThan(0)
      // and nearly straight along it
      const along = (moved[0] * g[0] + moved[1] * g[1]) / Math.hypot(...g)
      expect(along / Math.hypot(...moved)).toBeGreaterThan(0.99)
    }
  })

  it('leave droplets behind as they run, paid for out of their own water', () => {
    const rand = lcg(4)
    let d = [drop(200, 50, 18)]
    const before = water(d)
    for (let k = 0; k < 60; k++) d = stepDrops(d, [0, 900], dt, 400, 4000, rand, ids())
    expect(d.length).toBeGreaterThan(3)
    expect(water(d)).toBeCloseTo(before, 6)
  })

  it('swallow the drops they touch, keeping all the water and where its middle was', () => {
    const rand = lcg(5)
    const d = [drop(100, 100, 6), drop(108, 100, 5), drop(300, 300, 3)]
    const before = water(d)
    const after = stepDrops(d, [0, 0], dt, 400, 400, rand, ids())
    expect(after).toHaveLength(2)
    expect(water(after)).toBeCloseTo(before, 9)
    const merged = after.find((x) => x.r > 6)!
    expect(merged.x).toBeCloseTo((100 * 36 + 108 * 25) / 61, 9)
  })

  it('keep every drop of water through a storm, on glass tall enough that none runs off', () => {
    const rand = lcg(6)
    const next = ids()
    let d: Drop[] = Array.from({ length: 120 }, (_, i) => raindrop(400, 400, rand, i))
    let added = water(d)
    for (let k = 0; k < 200; k++) {
      const before = water(d)
      const stepped = stepDrops(d, [0, 900], dt, 400, 1e6, rand, next)
      expect(water(stepped)).toBeCloseTo(before, 4)
      d = stepped
      const fresh = raindrop(400, 400, rand, next())
      added += fresh.r * fresh.r
      d.push(fresh)
    }
    expect(d.length).toBeLessThan(MAX_DROPS)
    expect(water(d)).toBeCloseTo(added, 3)
  })

  it('run off the bottom and are gone, and never number more than MAX_DROPS', () => {
    const rand = lcg(7)
    let d = [drop(200, 390, 20), drop(100, 100, 3)]
    for (let k = 0; k < 60; k++) d = stepDrops(d, [0, 900], dt, 400, 400, rand, ids())
    expect(d.some((x) => x.r > 15)).toBe(false)
    expect(d.some((x) => x.x === 100 && x.y === 100)).toBe(true)
    const crowd = Array.from({ length: MAX_DROPS + 50 }, (_, i) =>
      drop((i % 40) * 10, Math.floor(i / 40) * 10, 1, i),
    )
    expect(stepDrops(crowd, [0, 0], dt, 400, 400, rand, ids())).toHaveLength(MAX_DROPS)
  })
})

describe('a finger on the glass', () => {
  it('measures to a segment, its ends included', () => {
    expect(toSegment([5, 3], [0, 0], [10, 0])).toBe(3)
    expect(toSegment([-4, 3], [0, 0], [10, 0])).toBe(5)
    expect(toSegment([13, 4], [0, 0], [10, 0])).toBe(5)
    expect(toSegment([3, 4], [0, 0], [0, 0])).toBe(5)
  })
  it('takes the drops it passes over and leaves the rest', () => {
    const d = [drop(50, 10, 4, 1), drop(50, 40, 4, 2), drop(200, 10, 4, 3), drop(50, 21, 4, 4)]
    const left = wipeDrops(d, [[0, 10, 100, 10]], 10)
    // 1 is under it; 4 is 11 away, and its own edge reaches inside the finger
    expect(left.map((x) => x.id)).toEqual([2, 3])
  })
})

describe('a breath', () => {
  it('rises slowly, falls faster, and is not the room', () => {
    let b = 0
    for (let k = 0; k < 60; k++) b = breathFrom(0.08, b, 1 / 60)
    expect(b).toBe(0)
    // half a second of blowing is most of a breath, and not all of it
    for (let k = 0; k < 30; k++) b = breathFrom(0.6, b, 1 / 60)
    expect(b).toBeGreaterThan(0.6)
    expect(b).toBeLessThan(0.75)
    let up = b
    for (let k = 0; k < 600; k++) up = breathFrom(0.6, up, 1 / 60)
    expect(up).toBeCloseTo(1, 6)
    // and it is gone again in a quarter of a second
    for (let k = 0; k < 15; k++) b = breathFrom(0, b, 1 / 60)
    expect(b).toBeLessThan(0.3)
  })
  it('is not fooled by a knock: a single loud frame is a small breath', () => {
    const b = breathFrom(1, 0, 1 / 60)
    expect(b).toBeLessThan(0.05)
  })
})
