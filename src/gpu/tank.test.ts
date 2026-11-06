import { describe, expect, it } from 'vitest'
import types from './tank-types.wgsl?raw'
import step from './tank-step.wgsl?raw'
import {
  MAX_PELLETS,
  PELLET_LIFE,
  TANK,
  order,
  packPellets,
  packTank,
  seedFish,
  stepPellets,
  toTank,
} from './tank'
import { wgslLayout } from './wgslLayout'

describe('the uniform the shader reads is the one JavaScript writes', () => {
  const wgsl = wgslLayout(types, 'Tank')

  it('agrees with the shader about where every field lives', () => {
    const { bytes, ...table } = TANK
    expect(wgsl.offsets).toEqual(table)
    expect(wgsl.bytes).toBe(bytes)
  })

  it('writes every field where the shader will look for it', () => {
    const v = new DataView(
      packTank({
        aspect: 1.5,
        dt: 0.0625,
        time: 12.5,
        count: 1536,
        shark: [0.25, -0.5],
        hunting: true,
        food: 3,
        size: 0.0625,
      }),
    )
    const f = (k: string, i = 0) => v.getFloat32(wgsl.offsets[k] + 4 * i, true)
    const u = (k: string) => v.getUint32(wgsl.offsets[k], true)
    expect([
      f('aspect'),
      f('dt'),
      f('time'),
      f('shark'),
      f('shark', 1),
      f('hunting'),
      f('size'),
    ]).toEqual([1.5, 0.0625, 12.5, 0.25, -0.5, 1, 0.0625])
    expect([u('count'), u('food')]).toEqual([1536, 3])
  })

  it('shares its tile with the shader', () => {
    expect(step).toMatch(/const TILE = 64u;/)
    expect(step).toMatch(/var<workgroup> tile: array<vec4f, 64>;/)
    expect(step).toMatch(/@workgroup_size\(64\)/)
  })
})

describe('the tank', () => {
  it('puts the canvas corners at the corners of the water, with the top at -1', () => {
    expect(toTank(0, 0, 800, 500)).toEqual([-1.6, -1])
    expect(toTank(800, 500, 800, 500)).toEqual([1.6, 1])
  })

  it('stocks every fish inside the glass, already swimming', () => {
    const f = seedFish(300, 1.5)
    for (let i = 0; i < 300; i++) {
      expect(Math.abs(f[i * 4])).toBeLessThan(1.5)
      expect(Math.abs(f[i * 4 + 1])).toBeLessThan(1)
      expect(Math.hypot(f[i * 4 + 2], f[i * 4 + 3])).toBeGreaterThan(0.2)
    }
  })

  it('reads a school by how much it agrees: all one way is 1, two halves opposed is 0', () => {
    const one = new Float32Array([0, 0, 1, 0, 0, 0, 2, 0, 0, 0, 0.5, 0])
    expect(order(one)).toBeCloseTo(1, 9)
    const opposed = new Float32Array([0, 0, 1, 0, 0, 0, -1, 0])
    expect(order(opposed)).toBeCloseTo(0, 9)
  })
})

describe('food', () => {
  it('sinks, fades, and is gone after its life, never through the floor', () => {
    let p = [{ x: 0, y: 0.9, left: 1 }]
    p = stepPellets(p, 2)
    expect(p[0].y).toBeLessThanOrEqual(0.95)
    expect(p[0].left).toBeCloseTo(1 - 2 / PELLET_LIFE, 9)
    expect(stepPellets(p, PELLET_LIFE)).toEqual([])
  })

  it('packs each pellet as x, y, what is left, and nothing past the ones there are', () => {
    const b = packPellets([{ x: 0.25, y: -0.5, left: 0.75 }])
    expect([...b.slice(0, 3)]).toEqual([0.25, -0.5, 0.75])
    expect(b.slice(4).every((v) => v === 0)).toBe(true)
    expect(b.length).toBe(MAX_PELLETS * 4)
  })
})
