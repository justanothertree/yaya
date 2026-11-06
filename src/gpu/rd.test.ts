import { describe, expect, it } from 'vitest'
import types from './rd-types.wgsl?raw'
import step from './rd-step.wgsl?raw'
import { MAP, PRESETS, RD, packRD, ratesAt, rdStep, seededGrid, type RDParams } from './rd'
import { wgslLayout } from './wgslLayout'

describe('the uniform the shader reads is the one JavaScript writes', () => {
  const wgsl = wgslLayout(types, 'RD')

  it('agrees with the shader about where every field lives', () => {
    const { bytes, ...table } = RD
    expect(wgsl.offsets).toEqual(table)
    expect(wgsl.bytes).toBe(bytes)
  })

  it('writes every field where the shader will look for it', () => {
    const p: RDParams = {
      cols: 321,
      rows: 123,
      feed: 0.0625,
      kill: 0.03125,
      da: 0.75,
      db: 0.375,
      brushes: 5,
      map: true,
      view: [800, 600],
      palette: 3,
      light: 0.5,
    }
    const v = new DataView(packRD(p))
    const f = (k: string, i = 0) => v.getFloat32(wgsl.offsets[k] + 4 * i, true)
    const u = (k: string) => v.getUint32(wgsl.offsets[k], true)
    expect(['cols', 'rows', 'brushes', 'map', 'palette'].map(u)).toEqual([321, 123, 5, 1, 3])
    expect([f('feed'), f('kill'), f('da'), f('db'), f('view'), f('view', 1), f('light')]).toEqual([
      0.0625, 0.03125, 0.75, 0.375, 800, 600, 0.5,
    ])
  })

  it('reads the map the way the shader sweeps it', () => {
    const m = step.match(
      /return vec2f\(mix\(([\d.]+), ([\d.]+), u\), mix\(([\d.]+), ([\d.]+), v\)\);/,
    )
    expect(m?.slice(1).map(Number)).toEqual([...MAP.feed, ...MAP.kill])
  })
})

/** cells where B has taken hold */
const grown = (g: Float32Array) => g.filter((v, i) => i % 2 === 1 && v > 0.2).length

describe('the chemistry', () => {
  it('leaves a bare grid bare: with no B there is nothing to grow from', () => {
    let g = seededGrid(24, 24, [])
    for (let i = 0; i < 200; i++) g = rdStep(g, 24, 24, PRESETS.coral.feed, PRESETS.coral.kill)
    expect(Math.max(...g.filter((_, i) => i % 2 === 1))).toBe(0)
    expect(Math.min(...g.filter((_, i) => i % 2 === 0))).toBeCloseTo(1, 9)
  })

  it('grows coral out of a single seed', () => {
    let g = seededGrid(48, 48, [[24, 24, 4]])
    const start = grown(g)
    for (let i = 0; i < 1500; i++) g = rdStep(g, 48, 48, PRESETS.coral.feed, PRESETS.coral.kill)
    expect(grown(g)).toBeGreaterThan(start * 4)
  })

  it('lets a seed die out where B dies faster than it is fed', () => {
    // far past the right of Pearson's map: kill outruns everything, and B fades away
    let g = seededGrid(32, 32, [[16, 16, 4]])
    for (let i = 0; i < 1500; i++) g = rdStep(g, 32, 32, 0.01, 0.09)
    expect(grown(g)).toBe(0)
  })

  it('keeps every preset inside the map it was read from', () => {
    for (const pr of Object.values(PRESETS)) {
      expect(pr.feed).toBeGreaterThanOrEqual(MAP.feed[0])
      expect(pr.feed).toBeLessThanOrEqual(MAP.feed[1])
      expect(pr.kill).toBeGreaterThanOrEqual(MAP.kill[0])
      expect(pr.kill).toBeLessThanOrEqual(MAP.kill[1])
    }
  })

  it('turns a tap on the map into the rates under it, and no further than its edges', () => {
    expect(ratesAt(0, 0)).toEqual({ feed: 0.01, kill: 0.045 })
    expect(ratesAt(1, 1)).toEqual({ feed: 0.09, kill: 0.07 })
    expect(ratesAt(0.5, 0.5).feed).toBeCloseTo(0.05, 12)
    expect(ratesAt(-1, 2)).toEqual({ feed: 0.01, kill: 0.07 })
  })
})
