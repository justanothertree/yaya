import { describe, expect, it } from 'vitest'
import types from './swarm-types.wgsl?raw'
import { wgslLayout } from './wgslLayout'
import step from './swarm-step.wgsl?raw'
import {
  COUNTS,
  DEFAULT_COUNT,
  PARAMS,
  PARTICLE_BYTES,
  TOUCH_CEILING,
  WORKGROUP,
  countLabel,
  countsFor,
  dotSize,
  glowFor,
  packParams,
  stepSeconds,
  toWorld,
  workgroupsFor,
  type Params,
} from './swarm'

describe('the uniform the shader reads is the one JavaScript writes', () => {
  const wgsl = wgslLayout(types, 'Params')

  it('agrees with the shader about where every field lives', () => {
    const { bytes, ...table } = PARAMS
    expect(wgsl.offsets).toEqual(table)
    expect(wgsl.bytes).toBe(bytes)
  })

  it('writes every field where the shader will look for it', () => {
    // ⚠️ every field something other than its default and other than its neighbours, so a field
    // written into the wrong slot — or not written at all — cannot pass by coincidence
    const p: Params = {
      pointer: [0.25, -0.75],
      aspect: 1.5,
      dt: 0.016,
      time: 42.5,
      flow: 0.8,
      pull: -1.25,
      size: 0.003,
      glow: 0.6,
      count: 131072,
    }
    const view = new DataView(packParams(p))
    const f = (name: string) => view.getFloat32(wgsl.offsets[name], true)
    expect([f('pointer'), view.getFloat32(wgsl.offsets.pointer + 4, true)]).toEqual([0.25, -0.75])
    expect(f('aspect')).toBe(1.5)
    expect(f('dt')).toBeCloseTo(0.016, 6)
    expect(f('time')).toBe(42.5)
    expect(f('flow')).toBeCloseTo(0.8, 6)
    expect(f('pull')).toBe(-1.25)
    expect(f('size')).toBeCloseTo(0.003, 6)
    expect(f('glow')).toBeCloseTo(0.6, 6)
    expect(view.getUint32(wgsl.offsets.count, true)).toBe(131072)
  })

  it('sizes a particle the way the shader does', () => {
    expect(wgslLayout(types, 'Particle').bytes).toBe(PARTICLE_BYTES)
  })

  it('dispatches in the group size the shader declares', () => {
    const sizes = [...step.matchAll(/@workgroup_size\((\d+)\)/g)].map((m) => Number(m[1]))
    expect(sizes.length).toBe(2)
    for (const s of sizes) expect(s).toBe(WORKGROUP)
  })
})

describe('every particle is advanced exactly once', () => {
  it('launches enough invocations, and never a whole spare group', () => {
    for (const n of [1, 63, 64, 65, 1000, ...COUNTS, (1 << 21) + 1]) {
      const invocations = workgroupsFor(n) * WORKGROUP
      expect(invocations).toBeGreaterThanOrEqual(n)
      expect(invocations - n).toBeLessThan(WORKGROUP)
    }
  })
})

describe('what a device can hold', () => {
  // the WebGPU spec's default limits, which every adapter meets
  const DEFAULTS = {
    maxStorageBufferBindingSize: 134217728,
    maxBufferSize: 268435456,
    maxComputeWorkgroupsPerDimension: 65535,
  }

  it('offers every count on a device at the defaults', () => {
    expect(countsFor(DEFAULTS)).toEqual([...COUNTS])
    expect(COUNTS).toContain(DEFAULT_COUNT)
  })

  it('drops what will not fit in a binding', () => {
    const small = { ...DEFAULTS, maxStorageBufferBindingSize: 16 * 1024 * 1024 }
    for (const n of countsFor(small)) expect(n * PARTICLE_BYTES).toBeLessThanOrEqual(16 << 20)
    expect(countsFor(small)).not.toContain(1 << 21)
    expect(countsFor(small)).toContain(1 << 19)
  })

  it('drops what would fit in memory but cannot be launched', () => {
    const narrow = { ...DEFAULTS, maxComputeWorkgroupsPerDimension: 8192 }
    // 8192 groups of 64 is 524,288: exactly the third count, and not one more
    expect(countsFor(narrow)).toEqual([1 << 15, 1 << 17, 1 << 19])
  })

  it('keeps a touch-only device to the ceiling, and its default within it', () => {
    expect(countsFor(DEFAULTS, TOUCH_CEILING)).toEqual([1 << 15, 1 << 17, 1 << 19])
    expect(DEFAULT_COUNT).toBeLessThanOrEqual(TOUCH_CEILING)
  })

  it('names each count the way a person reads it', () => {
    expect(COUNTS.map(countLabel)).toEqual(['32K', '128K', '512K', '2M'])
  })
})

describe('the world the swarm lives in', () => {
  it('puts the canvas corners at the corners of the field', () => {
    const [w, h] = [1200, 600]
    expect(toWorld(0, 0, w, h)).toEqual([-2, 1])
    expect(toWorld(w, h, w, h)).toEqual([2, -1])
    expect(toWorld(w / 2, h / 2, w, h)).toEqual([0, 0])
  })

  it('measures a step across the same as a step up', () => {
    const [w, h] = [1000, 400]
    const [x0, y0] = toWorld(300, 200, w, h)
    const [x1] = toWorld(350, 200, w, h)
    const [, y1] = toWorld(300, 250, w, h)
    expect(Math.abs(x1 - x0)).toBeCloseTo(Math.abs(y1 - y0), 12)
  })

  it('draws a dot the number of pixels across it was asked for', () => {
    for (const [px, height] of [
      [2, 600],
      [3, 1440],
      [1.5, 333],
    ]) {
      // clip space is two units tall and spans `height` pixels; the quad is ±size
      const drawnPx = ((2 * dotSize(px, height)) / 2) * height
      expect(drawnPx).toBeCloseTo(px, 9)
    }
  })
})

describe('time', () => {
  it('stands still on the first frame', () => {
    expect(stepSeconds(null, 1234)).toBe(0)
  })

  it('takes an ordinary frame as it comes', () => {
    expect(stepSeconds(1000, 1016)).toBeCloseTo(0.016, 9)
  })

  it('never takes a minute away from the tab in one step', () => {
    expect(stepSeconds(0, 60_000)).toBe(1 / 30)
    expect(stepSeconds(5000, 4000)).toBe(0)
  })
})

describe('brightness', () => {
  const screen = 1600 * 900

  it('dims each dot as the swarm grows, so the field does not', () => {
    const a = glowFor(1 << 19, 2, screen)
    const b = glowFor(1 << 20, 2, screen)
    expect(a).toBeLessThan(1)
    expect(b / a).toBeCloseTo(0.5, 9)
  })

  it('never brightens a sparse swarm past full, or dims a dense one to nothing', () => {
    expect(glowFor(1, 2, screen)).toBe(1)
    expect(glowFor(1e12, 2, screen)).toBe(0.03)
  })
})
