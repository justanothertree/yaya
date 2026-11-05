import { describe, expect, it } from 'vitest'
import code from './galaxy.wgsl?raw'
import { GALAXY, MAX_TILT, dragView, packGalaxy, type GalaxyParams } from './galaxy'
import { wgslLayout } from './wgslLayout'

describe('the uniform the shader reads is the one JavaScript writes', () => {
  const wgsl = wgslLayout(code, 'Galaxy')

  it('agrees with the shader about where every field lives', () => {
    const { bytes, ...table } = GALAXY
    expect(wgsl.offsets).toEqual(table)
    expect(wgsl.bytes).toBe(bytes)
  })

  it('writes every field where the shader will look for it', () => {
    const p: GalaxyParams = {
      aspect: 1.5,
      time: 12.5,
      twist: 7.25,
      tilt: 0.5,
      turn: 2.25,
      size: 0.0078125,
      glow: 0.375,
      pulse: 0.625,
      kick: 0.875,
      count: 131072,
    }
    const v = new DataView(packGalaxy(p))
    for (const k of [
      'aspect',
      'time',
      'twist',
      'tilt',
      'turn',
      'size',
      'glow',
      'pulse',
      'kick',
    ] as const)
      expect(v.getFloat32(wgsl.offsets[k], true)).toBe(p[k])
    expect(v.getUint32(wgsl.offsets.count, true)).toBe(131072)
  })
})

describe('turning the view', () => {
  const w = 800
  const h = 500
  it('turns once round for a drag the full width', () => {
    expect(dragView({ turn: 0, tilt: 0.5 }, w, 0, w, h).turn).toBeCloseTo(Math.PI * 2, 12)
  })

  it('tilts from face on to the limit for a drag the full height, and no further either way', () => {
    expect(dragView({ turn: 0, tilt: 0 }, 0, h, w, h).tilt).toBeCloseTo(MAX_TILT, 12)
    expect(dragView({ turn: 0, tilt: 0 }, 0, 3 * h, w, h).tilt).toBe(MAX_TILT)
    expect(dragView({ turn: 0, tilt: 0.2 }, 0, -h, w, h).tilt).toBe(0)
    // never edge on: an edge-on galaxy is a line
    expect(MAX_TILT).toBeLessThan(Math.PI / 2)
  })
})
