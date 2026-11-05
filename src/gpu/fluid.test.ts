import { describe, expect, it } from 'vitest'
import code from './fluid.wgsl?raw'
import {
  FLUID,
  MAX_FORCE,
  bloom,
  dragForce,
  gridSize,
  hue,
  isTap,
  packFluid,
  type FluidParams,
} from './fluid'
import { wgslLayout } from './wgslLayout'

describe('the uniform the shader reads is the one JavaScript writes', () => {
  const wgsl = wgslLayout(code, 'Fluid')

  it('agrees with the shader about where every field lives', () => {
    const { bytes, ...table } = FLUID
    expect(wgsl.offsets).toEqual(table)
    expect(wgsl.bytes).toBe(bytes)
  })

  it('writes every field where the shader will look for it', () => {
    const p: FluidParams = {
      texel: [0.5, 0.25],
      dyeTexel: [0.125, 0.0625],
      point: [0.3, 0.7],
      force: [-40, 25],
      color: [0.75, 0.5, 0.25],
      ink: 0.625,
      aspect: 1.75,
      radius: 0.0025,
      dt: 0.015625,
      swirl: 18,
      velDecay: 0.375,
      dyeDecay: 1.5,
    }
    const v = new DataView(packFluid(p))
    const f = (name: string, k = 0) => v.getFloat32(wgsl.offsets[name] + 4 * k, true)
    expect([f('texel'), f('texel', 1), f('dye_texel'), f('dye_texel', 1)]).toEqual([
      0.5, 0.25, 0.125, 0.0625,
    ])
    expect([f('point'), f('point', 1), f('force'), f('force', 1)]).toEqual([
      Math.fround(0.3),
      Math.fround(0.7),
      -40,
      25,
    ])
    expect([f('color'), f('color', 1), f('color', 2), f('color', 3)]).toEqual([
      0.75, 0.5, 0.25, 0.625,
    ])
    expect(f('aspect')).toBe(1.75)
    expect(f('radius')).toBe(Math.fround(0.0025))
    expect([f('dt'), f('swirl'), f('vel_decay'), f('dye_decay')]).toEqual([
      0.015625, 18, 0.375, 1.5,
    ])
  })
})

describe('the grids', () => {
  it('keep their cells square, whichever way the canvas faces', () => {
    for (const [w, h] of [
      [1600, 560],
      [375, 600],
      [800, 800],
    ]) {
      const g = gridSize(w, h, 192)
      expect(Math.max(g.w, g.h)).toBe(192)
      // a cell's width and height in canvas pixels agree to within one cell's rounding
      expect(Math.abs(w / g.w - h / g.h)).toBeLessThan(
        Math.max(w / g.w, h / g.h) / Math.min(g.w, g.h) + 1e-9,
      )
    }
  })
})

describe('a drag', () => {
  it('pushes as fast as the pointer moved, in sim texels, scaled by the gain', () => {
    // 100 CSS px in 0.1 s across a 1000 px canvas on a 200-texel grid: 20 texels in 0.1 s
    const [fx, fy] = dragForce(100, 0, 0.1, 1000, 200, 1)
    expect(fx).toBeCloseTo(200, 9)
    expect(fy).toBe(0)
  })

  it('pushes the same across as down', () => {
    const [ax] = dragForce(30, 0, 0.05, 900, 180)
    const [, by] = dragForce(0, 30, 0.05, 900, 180)
    expect(ax).toBeCloseTo(by, 9)
  })

  it('caps a flick, keeping its direction', () => {
    const [fx, fy] = dragForce(3000, 4000, 0.001, 500, 200)
    expect(Math.hypot(fx, fy)).toBeCloseTo(MAX_FORCE, 6)
    expect(fx / fy).toBeCloseTo(0.75, 9)
  })

  it('does nothing in no time at all', () => {
    expect(dragForce(10, 10, 0, 500, 200)).toEqual([0, 0])
  })
})

describe('colour', () => {
  it('names the primaries and secondaries where the wheel puts them', () => {
    const near = (h: number) => hue(h).map((c) => Math.round(c * 100) / 100)
    expect(near(0)).toEqual([1, 0, 0])
    expect(near(1 / 6)).toEqual([1, 1, 0])
    expect(near(1 / 3)).toEqual([0, 1, 0])
    expect(near(1 / 2)).toEqual([0, 1, 1])
    expect(near(2 / 3)).toEqual([0, 0, 1])
    expect(near(5 / 6)).toEqual([1, 0, 1])
  })
})

describe('a tap', () => {
  it('is a press that barely moved and was soon let go', () => {
    expect(isTap(0, 80)).toBe(true)
    expect(isTap(7, 250)).toBe(true)
    expect(isTap(12, 80)).toBe(false) // a short flick is a drag
    expect(isTap(2, 600)).toBe(false) // a hold is not a tap
  })

  it('blossoms evenly round the point, so the pool is not set drifting', () => {
    const b = bloom([0.3, 0.6], [1, 0, 0], 6, 600)
    expect(b).toHaveLength(6)
    for (const s of b) {
      expect(s.point).toEqual([0.3, 0.6])
      expect(Math.hypot(...s.force)).toBeCloseTo(600, 9)
    }
    const net = b.reduce((n, s) => [n[0] + s.force[0], n[1] + s.force[1]], [0, 0])
    expect(Math.hypot(net[0], net[1])).toBeLessThan(1e-9)
    // and no two petals share a direction
    const angles = new Set(b.map((s) => Math.round(Math.atan2(s.force[1], s.force[0]) * 1000)))
    expect(angles.size).toBe(6)
  })
})
