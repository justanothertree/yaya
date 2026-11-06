import { describe, expect, it } from 'vitest'
import types from './clay-types.wgsl?raw'
import {
  BLEND,
  CLAY,
  N,
  VOXEL,
  lump,
  orbit,
  packClay,
  rayThrough,
  smin,
  ssub,
  voxelCentre,
} from './clay'
import { wgslLayout } from './wgslLayout'

describe('the shader and this file describe one lump', () => {
  const wgsl = wgslLayout(types, 'Clay')

  it('agrees about where every field of the uniform lives', () => {
    const { bytes, rayO, rayD, ...rest } = CLAY
    expect(wgsl.offsets).toEqual({ ...rest, ray_o: rayO, ray_d: rayD })
    expect(wgsl.bytes).toBe(bytes)
  })

  it('writes every field where the shader will look for it', () => {
    const cam = orbit(0, 0, 2)
    const v = new DataView(
      packClay({
        cam,
        aspect: 1.5,
        ray: { o: [1, 2, 3], d: [0, 0, -1], radius: 0.25 },
        tool: 'smooth',
        mirror: true,
        glaze: 'jade',
      }),
    )
    const f = (k: string, i = 0) => v.getFloat32(wgsl.offsets[k] + 4 * i, true)
    const u = (k: string) => v.getUint32(wgsl.offsets[k], true)
    expect([f('eye', 2), f('eye', 3)]).toEqual([2, 1.5])
    expect([0, 1, 2, 3].map((i) => f('ray_o', i))).toEqual([1, 2, 3, 0.25])
    expect([f('ray_d', 2), f('ray_d', 3)]).toEqual([-1, 1])
    expect([u('n'), u('tool'), u('mirror'), u('glaze')]).toEqual([N, 2, 1, 2])
  })

  it('blends with the same width, and starts from the same lump', () => {
    expect(types).toContain(`const BLEND = ${BLEND};`)
    expect(types).toContain('return length(vec3f(p.x, p.y * 1.15, p.z)) - 0.55;')
  })
})

describe('folding shapes together', () => {
  it('is a plain union far from the seam, and rounds the corner near it', () => {
    expect(smin(0.5, -0.2)).toBe(-0.2)
    expect(smin(0.03, 0.03)).toBeLessThan(0.03)
    expect(smin(0.03, 0.03)).toBeCloseTo(0.03 - BLEND * 0.25, 12)
    // ⚠️ equal inputs cannot tell h from h², so part-way into the blend too: h = 0.75 here
    expect(smin(0.03, 0.05)).toBeCloseTo(0.03 - 0.75 * 0.75 * BLEND * 0.25, 12)
  })

  it('meets the plain union without a kink at the edge of the blend', () => {
    // just inside the blend's reach it differs from min by a vanishing amount, as a smooth join must
    const edge = 0.1 + BLEND
    expect(smin(0.1, edge - 1e-4) - 0.1).toBeCloseTo(0, 6)
  })

  it('carves: what is inside the brush becomes outside the clay', () => {
    // a point deep in the clay (-0.4) and deep in the brush (-0.3) is no longer clay
    expect(ssub(-0.4, -0.3)).toBeGreaterThan(0)
    // a point in the clay but far from the brush stays where it was
    expect(ssub(-0.4, 0.5)).toBe(-0.4)
  })
})

describe('the lump and the volume', () => {
  it('starts as a squashed ball: zero on its surface, inside negative', () => {
    expect(lump(0.55, 0, 0)).toBeCloseTo(0, 12)
    expect(lump(0, 0.55 / 1.15, 0)).toBeCloseTo(0, 12)
    expect(lump(0, 0, 0)).toBeLessThan(0)
  })

  it('fills the -1..1 cube with voxel centres', () => {
    expect(voxelCentre(0)).toBeCloseTo(-1 + VOXEL / 2, 12)
    expect(voxelCentre(N - 1)).toBeCloseTo(1 - VOXEL / 2, 12)
  })
})

describe('the camera', () => {
  const dot = (a: readonly number[], b: readonly number[]) =>
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

  it('stands its distance from the clay, looking at it, upright', () => {
    for (const [yaw, pitch] of [
      [0, 0],
      [1.3, 0.4],
      [-2, -0.9],
    ]) {
      const c = orbit(yaw, pitch, 2.5)
      expect(Math.hypot(...c.eye)).toBeCloseTo(2.5, 9)
      expect(
        dot(
          c.fwd,
          c.eye.map((x) => -x / 2.5),
        ),
      ).toBeCloseTo(1, 9)
      expect(dot(c.fwd, c.right)).toBeCloseTo(0, 9)
      expect(dot(c.fwd, c.up)).toBeCloseTo(0, 9)
      expect(c.right[1]).toBeCloseTo(0, 9) // the horizon stays level
      expect(c.up[1]).toBeGreaterThan(0)
    }
  })

  it('sends the middle of the canvas straight ahead, and the right edge to the right', () => {
    const c = orbit(0.7, 0.2, 2)
    const mid = rayThrough(c, 0, 0, 1.5)
    mid.forEach((v, k) => expect(v).toBeCloseTo(c.fwd[k], 9))
    expect(dot(rayThrough(c, 1, 0, 1.5), c.right)).toBeGreaterThan(0)
  })
})
