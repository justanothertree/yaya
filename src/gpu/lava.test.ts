import { describe, expect, it } from 'vitest'
import code from './lava.wgsl?raw'
import {
  LAVA,
  MAX_BLOBS,
  blobAt,
  fill,
  packBlobs,
  packLava,
  seeded,
  stepLamp,
  type Blob,
} from './lava'
import { wgslLayout } from './wgslLayout'

const run = (
  blobs: Blob[],
  seconds: number,
  power = 1,
  aspect = 0.6,
  each?: (t: number) => void,
) => {
  for (let i = 0; i < seconds * 60; i++) {
    stepLamp(blobs, 1 / 60, { aspect, power, time: i / 60 })
    each?.(i / 60)
  }
}

describe('the uniform the shader reads is the one JavaScript writes', () => {
  it('agrees with the shader about where every field lives', () => {
    const wgsl = wgslLayout(code, 'Lava')
    const { bytes, ...table } = LAVA
    expect(wgsl.offsets).toEqual(table)
    expect(wgsl.bytes).toBe(bytes)
    const v = new DataView(packLava({ aspect: 0.75, count: 9, time: 12.5, scheme: 3 }))
    expect([
      v.getFloat32(0, true),
      v.getUint32(4, true),
      v.getFloat32(8, true),
      v.getUint32(12, true),
    ]).toEqual([0.75, 9, 12.5, 3])
  })

  it('packs each blob as x, y, r, heat, and nothing past the ones there are', () => {
    const b = packBlobs([{ x: 0.25, y: 0.5, vx: 9, vy: 9, r: 0.0625, heat: 0.75 }])
    expect([...b.slice(0, 4)]).toEqual([0.25, 0.5, 0.0625, 0.75])
    expect(b.slice(4).every((v) => v === 0)).toBe(true)
    expect(b.length).toBe(MAX_BLOBS * 4)
  })
})

describe('the lamp does what a lava lamp does', () => {
  it('lifts warm wax and sinks cool wax', () => {
    const warm = [{ x: 0.5, y: 0.5, vx: 0, vy: 0, r: 0.07, heat: 1 }]
    const cool = [{ x: 0.5, y: 0.5, vx: 0, vy: 0, r: 0.07, heat: 0 }]
    run(warm, 1)
    run(cool, 1)
    expect(warm[0].y).toBeLessThan(0.45)
    expect(cool[0].y).toBeGreaterThan(0.55)
  })

  it('carries one blob from the bulb to the top and back, again and again', () => {
    const one = [{ x: 0.5, y: 0.9, vx: 0, vy: 0, r: 0.08, heat: 0 }]
    let trips = 0
    let up = false
    run(one, 60, 1, 0.6, () => {
      if (!up && one[0].y < 0.2) [up, trips] = [true, trips + 1]
      if (up && one[0].y > 0.8) up = false
    })
    // a round trip every eight seconds or so; four in a minute is a lamp that works
    expect(trips).toBeGreaterThanOrEqual(4)
  })

  it('does nothing much with the bulb off', () => {
    const lamp = fill(8, seeded(3))
    run(lamp, 30, 0)
    expect(lamp.every((b) => b.y > 0.6)).toBe(true)
  })

  it('keeps a full lamp moving: never all up, never all down, for a minute', () => {
    const lamp = fill(10, seeded(7))
    const ups: number[] = []
    run(lamp, 60, 1, 0.6, (t) => {
      if (t > 10) ups.push(lamp.filter((b) => b.y < 0.4).length)
    })
    expect(Math.max(...ups)).toBeGreaterThanOrEqual(3)
    expect(Math.min(...ups)).toBeLessThan(10)
  })

  it('keeps every blob inside the glass, with heat between cold and hot, for two minutes', () => {
    const escapes: string[] = []
    for (const aspect of [0.5, 1.6]) {
      const lamp = fill(16, seeded(11))
      run(lamp, 120, 2, aspect, (t) => {
        for (const b of lamp) {
          const inside =
            b.x * aspect >= b.r - 1e-9 &&
            (1 - b.x) * aspect >= b.r - 1e-9 &&
            b.y >= b.r - 1e-9 &&
            1 - b.y >= b.r - 1e-9
          if (!inside || b.heat < 0 || b.heat > 1) escapes.push(`${aspect} @${t.toFixed(2)}s`)
        }
      })
    }
    expect(escapes).toEqual([])
  })
})

describe('reaching into the lamp', () => {
  const two: Blob[] = [
    { x: 0.3, y: 0.5, vx: 0, vy: 0, r: 0.1, heat: 0 },
    { x: 0.7, y: 0.5, vx: 0, vy: 0, r: 0.1, heat: 0 },
  ]
  it('finds the nearest blob within two of its radii', () => {
    expect(blobAt(two, 0.33, 0.5, 1)).toBe(0)
    expect(blobAt(two, 0.69, 0.55, 1)).toBe(1)
  })
  it('finds nothing in open liquid', () => {
    expect(blobAt(two, 0.5, 0.1, 1)).toBe(-1)
  })
})
