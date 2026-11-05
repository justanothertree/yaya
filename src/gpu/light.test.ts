import { describe, expect, it } from 'vitest'
import types from './light-types.wgsl?raw'
import bake from './light-bake.wgsl?raw'
import {
  LIGHT,
  MAX_SHAPES,
  SCENES,
  SCENE_IDS,
  SHAPE_FLOATS,
  blendFor,
  box,
  drifted,
  hitTest,
  lamp,
  packLight,
  packShapes,
  scene,
  sdf,
  toWorld,
  type Shape,
} from './light'
import { wgslLayout } from './wgslLayout'

describe('the shader and this file describe one room', () => {
  const wgsl = wgslLayout(types, 'Light')

  it('agrees about where every field of the uniform lives', () => {
    const { bytes, ...table } = LIGHT
    expect(wgsl.offsets).toEqual(table)
    expect(wgsl.bytes).toBe(bytes)
  })

  it('writes every field where the shader will look for it', () => {
    const v = new DataView(
      packLight({ w: 320, h: 200, count: 7, frame: 99, rays: 16, exposure: 1.5, blend: 0.25 }),
    )
    const u = (k: string, i = 0) => v.getUint32(wgsl.offsets[k] + 4 * i, true)
    const f = (k: string) => v.getFloat32(wgsl.offsets[k], true)
    expect([u('size'), u('size', 1), u('count'), u('frame'), u('rays')]).toEqual([
      320, 200, 7, 99, 16,
    ])
    expect([f('aspect'), f('exposure'), f('blend')]).toEqual([Math.fround(1.6), 1.5, 0.25])
  })

  it('packs each shape where the bake reads it: place and size, colour and power, angle and kind', () => {
    const b = packShapes([lamp(0.5, -0.25, 1, 0.125), box(-0.5, 0.75, 0.25, 0.0625, 0.5)])
    expect([...b.subarray(0, 4)]).toEqual([0.5, -0.25, 0.125, 0])
    expect(b[7]).toBeCloseTo(2.2, 6) // the lamp's power, in .w of its second vec4
    expect([...b.subarray(SHAPE_FLOATS, SHAPE_FLOATS + 4)]).toEqual([-0.5, 0.75, 0.25, 0.0625])
    expect([b[SHAPE_FLOATS + 8], b[SHAPE_FLOATS + 9]]).toEqual([0.5, 2])
    expect(b.length).toBe(MAX_SHAPES * SHAPE_FLOATS)
    // the bake tells a circle from a box by kind < 1.5, and a lamp by kind < 0.5
    expect(bake).toContain('c.y < 1.5')
    expect(bake).toContain('shapes[3u * i + 2u].y < 0.5')
  })
})

describe('distances', () => {
  const disc: Shape = {
    kind: 'disc',
    x: 1,
    y: 0,
    r: 0.5,
    h: 0,
    angle: 0,
    colour: [0, 0, 0],
    power: 0,
  }

  it('measures a circle from its edge, negative inside', () => {
    expect(sdf(disc, 3, 0)).toBeCloseTo(1.5, 12)
    expect(sdf(disc, 1, 0)).toBeCloseTo(-0.5, 12)
  })

  it('measures a box from its sides and its corners, turned or not', () => {
    const b = box(0, 0, 1, 0.5)
    expect(sdf(b, 3, 0)).toBeCloseTo(2, 12)
    expect(sdf(b, 0, 2)).toBeCloseTo(1.5, 12)
    expect(sdf(b, 4, 4.5)).toBeCloseTo(5, 12) // from the corner (1, 0.5): a 3-4-5 triangle
    expect(sdf(b, 0, 0)).toBeCloseTo(-0.5, 12)
    // turned a quarter: its long side now runs up and down
    const t = box(0, 0, 1, 0.5, Math.PI / 2)
    expect(sdf(t, 0, 3)).toBeCloseTo(2, 12)
    expect(sdf(t, 3, 0)).toBeCloseTo(2.5, 12)
    // ⚠️ a quarter turn looks the same either way round, so it cannot tell which way a box turns:
    // turned an eighth ANTICLOCKWISE (y up), a long thin wall runs up to the right
    const eighth = box(0, 0, 1, 0.05, Math.PI / 4)
    expect(sdf(eighth, 0.6, 0.6)).toBeLessThan(0)
    expect(sdf(eighth, 0.6, -0.6)).toBeGreaterThan(0.5)
  })

  it('finds the nearest surface, and the light only a lamp gives', () => {
    const room = [lamp(-1, 0, 0, 0.1), disc]
    expect(scene(room, -0.5, 0).d).toBeCloseTo(0.4, 12)
    expect(scene(room, -0.5, 0).emit[0]).toBeGreaterThan(0)
    expect(scene(room, 0.4, 0).emit).toEqual([0, 0, 0])
  })

  it('picks the shape on top when two overlap, and nothing a little way off', () => {
    const under = box(0, 0, 0.5, 0.5)
    const over = lamp(0, 0, 0, 0.1)
    expect(hitTest([under, over], 0, 0)).toBe(1)
    expect(hitTest([under, over], 0.4, 0)).toBe(0)
    expect(hitTest([under, over], 2, 2)).toBe(-1)
  })
})

describe('gathering light', () => {
  it('averages a still room exactly: after n frames every frame has counted the same', () => {
    let picture = 0
    const samples = [3, 1, 4, 1, 5, 9, 2, 6]
    samples.forEach((s, n) => (picture += (s - picture) * blendFor(n, false)))
    expect(picture).toBeCloseTo(samples.reduce((a, b) => a + b) / samples.length, 12)
  })

  it('keeps no more than a short memory while anything moves', () => {
    expect(blendFor(500, true)).toBe(0.2)
    expect(blendFor(0, true)).toBe(1)
  })
})

describe('the rooms', () => {
  it('fit inside the canvas, upright or wide, every shape whole', () => {
    for (const a of [0.8, 1.6, 2.4])
      for (const id of SCENE_IDS)
        for (const s of SCENES[id].make(a)) {
          const reach = Math.max(s.r, s.h)
          expect(Math.abs(s.x) + reach).toBeLessThan(a)
          expect(Math.abs(s.y) + reach).toBeLessThan(1)
        }
  })

  it('have at least one lamp and fewer shapes than the buffer holds', () => {
    for (const id of SCENE_IDS) {
      const room = SCENES[id].make(1.5)
      expect(room.some((s) => s.kind === 'lamp')).toBe(true)
      expect(room.length).toBeLessThanOrEqual(MAX_SHAPES)
    }
  })

  it('drifts lamps and leaves everything else where it was put', () => {
    const wall = box(0.3, 0.2, 0.2, 0.05)
    expect(drifted(wall, 0, 12)).toBe(wall)
    const l = lamp(0, 0, 0)
    expect(drifted(l, 0, 3).x).not.toBe(0)
  })

  it('puts the canvas corners at the corners of the room', () => {
    expect(toWorld(0, 0, 600, 400)).toEqual([-1.5, 1])
    expect(toWorld(600, 400, 600, 400)).toEqual([1.5, -1])
  })
})
