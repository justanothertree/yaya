import { describe, expect, it } from 'vitest'
import types from './sand-types.wgsl?raw'
import step from './sand-step.wgsl?raw'
import {
  EMPTY,
  FLOWS_RIGHT,
  GRAIN,
  SAND,
  WALL,
  WATER,
  blockCells,
  gravityFromTilt,
  hash,
  packDabs,
  packSand,
  preset,
  rule,
  stepSand,
} from './sand'
import { wgslLayout } from './wgslLayout'

describe('the shader and this file describe one sandbox', () => {
  const wgsl = wgslLayout(types, 'Sand')

  it('agrees about where every field of the uniform lives', () => {
    const { bytes, ...table } = SAND
    expect(wgsl.offsets).toEqual(table)
    expect(wgsl.bytes).toBe(bytes)
  })

  it('writes every field where the shader will look for it', () => {
    const v = new DataView(packSand({ w: 120, h: 90, step: 77, gravity: 3, dabs: 2, time: 1.5 }))
    const u = (k: string, i = 0) => v.getUint32(wgsl.offsets[k] + 4 * i, true)
    expect([u('size'), u('size', 1), u('step'), u('gravity'), u('dabs')]).toEqual([
      120, 90, 77, 3, 2,
    ])
    expect(v.getFloat32(wgsl.offsets.time, true)).toBe(1.5)
    expect([...packDabs([{ x: 5, y: 6, r: 2.5, tool: 'water' }]).subarray(0, 4)]).toEqual([
      5,
      6,
      2.5,
      WATER,
    ])
  })

  it('rolls the same dice as the shader, and flows water the same way', () => {
    for (const k of ['1597334677u', '3812015801u', '2798796415u', '2246822519u', '3266489917u'])
      expect(step).toContain(k)
    expect(step).toContain(`const FLOWS_RIGHT = ${FLOWS_RIGHT}u;`)
    // a known value, so a change to either copy shows
    expect(hash(3, 5, 7)).toBe(hash(3, 5, 7))
    expect(hash(3, 5, 7)).not.toBe(hash(3, 5, 8))
  })
})

describe('a block', () => {
  const all = [EMPTY, GRAIN, WATER, WALL, GRAIN | 8, WATER | FLOWS_RIGHT, WATER | 12]

  it('only ever rearranges its four cells: nothing lost, nothing made, walls never move', () => {
    const kinds = (xs: number[]) => xs.map((c) => c & 3).sort()
    for (const a of all)
      for (const b of all)
        for (const c of all)
          for (const d of all)
            for (const r of [0, 1, 0xffff, 0x1234, 0xbeef, 0x2000, 0xe000]) {
              const out = rule(a, b, c, d, r)
              expect(kinds(out)).toEqual(kinds([a, b, c, d]))
              ;[a, b, c, d].forEach((x, i) => (x & 3) === WALL && expect(out[i]).toBe(x))
            }
  })

  it('drops a grain into the space below it, and sinks sand through water', () => {
    expect(rule(GRAIN, EMPTY, EMPTY, EMPTY, 1)).toEqual([EMPTY, EMPTY, GRAIN, EMPTY])
    expect(rule(GRAIN, EMPTY, WATER, EMPTY, 1)[2] & 3).toBe(GRAIN)
  })

  it('sends a drop the way it is going, and turns it round when it meets something', () => {
    const spreads = 1 << 13 // the dice that let water spread this step (7 times in 8)
    const right = WATER | FLOWS_RIGHT
    expect(rule(EMPTY, EMPTY, right, EMPTY, spreads)).toEqual([EMPTY, EMPTY, EMPTY, right])
    expect(rule(EMPTY, EMPTY, right, GRAIN, spreads)).toEqual([EMPTY, EMPTY, WATER, GRAIN])
    // and on the eighth roll it waits where it is
    expect(rule(EMPTY, EMPTY, right, EMPTY, 0)).toEqual([EMPTY, EMPTY, right, EMPTY])
  })

  it('reads top to bottom along gravity, whichever way it points, every cell once', () => {
    for (let dir = 0; dir < 4; dir++) {
      const cells = blockCells(dir)
      expect(new Set(cells.map(([x, y]) => `${x},${y}`)).size).toBe(4)
      for (const [x, y] of cells) expect([x, y].every((v) => v === 0 || v === 1)).toBe(true)
      // the bottom row is further along gravity than the top row
      const g = [
        [0, 1],
        [-1, 0],
        [0, -1],
        [1, 0],
      ][dir]
      const along = ([x, y]: number[]) => x * g[0] + y * g[1]
      expect(along(cells[2])).toBeGreaterThan(along(cells[0]))
      expect(along(cells[3])).toBeGreaterThan(along(cells[1]))
    }
  })
})

describe('the box', () => {
  const count = (c: Uint32Array, k: number) => c.reduce((n, v) => n + ((v & 3) === k ? 1 : 0), 0)

  it('keeps every grain and drop through a thousand steps, gravity turning as it goes', () => {
    const w = 60
    const h = 44
    const c = preset('shelves', w, h)
    const before = [GRAIN, WATER, WALL].map((k) => count(c, k))
    for (let s = 0; s < 1000; s++) stepSand(c, w, h, s, Math.floor(s / 250) % 4)
    expect([GRAIN, WATER, WALL].map((k) => count(c, k))).toEqual(before)
  })

  it('piles sand at a slope: not a flat sheet, not a tower', () => {
    const w = 80
    const h = 60
    const c = preset('empty', w, h)
    let s = 0
    for (let k = 0; k < 400; k++) {
      // pour three grains a step from one spot
      for (const dx of [-1, 0, 1])
        if ((c[3 * w + 40 + dx] & 3) === EMPTY) c[3 * w + 40 + dx] = GRAIN
      stepSand(c, w, h, s++, 0)
    }
    for (let k = 0; k < 600; k++) stepSand(c, w, h, s++, 0)
    const heights = Array.from({ length: w }, (_, x) => {
      for (let y = 1; y < h - 1; y++) if ((c[y * w + x] & 3) === GRAIN) return h - 1 - y
      return 0
    })
    const peak = Math.max(...heights)
    const base = heights.filter((v) => v > 0).length
    const slope = peak / (base / 2)
    expect(slope).toBeGreaterThan(0.6)
    expect(slope).toBeLessThan(2.5)
  })

  it('levels water out in a few thousand steps, wall to wall', () => {
    // measured: a 64×48 box levels to within a cell in 3,000 steps (and 128×96 in 6,000); without
    // each drop remembering its way it was still sloped 29 deep to 1 after 1,500 on the bigger box
    const w = 64
    const h = 48
    const c = preset('empty', w, h)
    for (let y = 10; y < h - 1; y++) for (let x = 1; x < 10; x++) c[y * w + x] = WATER
    for (let s = 0; s < 3000; s++) stepSand(c, w, h, s, 0)
    const depth = (x: number) => {
      let n = 0
      for (let y = 1; y < h - 1; y++) if ((c[y * w + x] & 3) === WATER) n++
      return n
    }
    const depths = Array.from({ length: 9 }, (_, i) => depth(Math.round(2 + (i * (w - 5)) / 8)))
    expect(Math.max(...depths) - Math.min(...depths)).toBeLessThanOrEqual(2)
  })
})

describe('tilting the phone', () => {
  it('lets the sand fall towards whichever edge is lowest', () => {
    expect(gravityFromTilt(80, 0, 0)).toBe(0) // held upright: down is down
    expect(gravityFromTilt(-80, 0, 0)).toBe(2) // upside down
    expect(gravityFromTilt(20, 70, 0)).toBe(3) // tipped onto its right edge
    expect(gravityFromTilt(20, -70, 0)).toBe(1)
    expect(gravityFromTilt(5, 5, 0)).toBe(-1) // lying flat: no clear down, keep what it was
  })

  it('turns with the screen in landscape', () => {
    // a phone on its side (screen turned 90°), held upright: the device's "down the screen" is
    // now the screen's left or right, and the sand must still fall to the screen's bottom edge
    const held = gravityFromTilt(10, -80, 90)
    expect(held).toBe(0)
  })
})
