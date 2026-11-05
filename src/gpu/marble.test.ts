import { describe, expect, it } from 'vitest'
import code from './marble.wgsl?raw'
import { INKS, MARBLE, PAPER, packMarble, recipe } from './marble'
import { wgslLayout } from './wgslLayout'

describe('the uniform the shader reads is the one JavaScript writes', () => {
  const wgsl = wgslLayout(code, 'Marble')

  it('agrees with the shader about where every field lives', () => {
    const { bytes, ...table } = MARBLE
    expect(wgsl.offsets).toEqual(table)
    expect(wgsl.bytes).toBe(bytes)
  })

  it('writes a drop and a stroke where the shader looks for them', () => {
    const f = (b: ArrayBuffer, k: string, i = 0) =>
      new DataView(b).getFloat32(wgsl.offsets[k] + 4 * i, true)
    const u = (b: ArrayBuffer, k: string) => new DataView(b).getUint32(wgsl.offsets[k], true)
    const drop = packMarble(
      { op: 'drop', at: [0.25, -0.125], radius: 0.0625, color: [0.75, 0.5, 0.25] },
      1.5,
    )
    expect([f(drop, 'color'), f(drop, 'color', 1), f(drop, 'color', 2)]).toEqual([0.75, 0.5, 0.25])
    expect([
      f(drop, 'a'),
      f(drop, 'a', 1),
      f(drop, 'radius'),
      f(drop, 'aspect'),
      u(drop, 'op'),
    ]).toEqual([0.25, -0.125, 0.0625, 1.5, 1])
    const stroke = packMarble(
      { op: 'stroke', from: [0.5, 0.25], to: [-0.25, 0.125], sharp: 0.03125, spacing: 0.0625 },
      2,
    )
    expect([f(stroke, 'a'), f(stroke, 'a', 1), f(stroke, 'b'), f(stroke, 'b', 1)]).toEqual([
      0.5, 0.25, -0.25, 0.125,
    ])
    expect([f(stroke, 'sharp'), f(stroke, 'spacing'), u(stroke, 'op')]).toEqual([
      0.03125, 0.0625, 2,
    ])
    // a stroke leaves no drop behind it in the slot it reuses
    expect(f(stroke, 'radius')).toBe(0)
  })

  it('agrees with the shader about the colour of the paper', () => {
    const m = code.match(/const PAPER = vec3f\(([^)]*)\)/)
    expect(m?.[1].split(',').map(Number)).toEqual([...PAPER])
  })
})

describe('the recipe', () => {
  const aspect = 1.6
  const ops = recipe(aspect, INKS.ebru.inks)

  it('is made in front of you, in order', () => {
    for (let i = 1; i < ops.length; i++) expect(ops[i].t).toBeGreaterThanOrEqual(ops[i - 1].t)
    expect(ops[ops.length - 1].t).toBeGreaterThan(3)
  })

  it('floats every drop on the tray, in every ink of the set', () => {
    const drops = ops.flatMap((x) => (x.o.op === 'drop' ? [x.o] : []))
    for (const d of drops) {
      expect(Math.abs(d.at[0])).toBeLessThan(aspect / 2)
      expect(Math.abs(d.at[1])).toBeLessThan(0.5)
    }
    expect(new Set(drops.map((d) => d.color.join())).size).toBe(INKS.ebru.inks.length)
  })

  it('combs as well as drops', () => {
    const strokes = ops.filter((x) => x.o.op === 'stroke')
    expect(strokes.some((x) => x.o.op === 'stroke' && x.o.spacing > 0)).toBe(true)
    expect(strokes.some((x) => x.o.op === 'stroke' && x.o.spacing === 0)).toBe(true)
  })
})
