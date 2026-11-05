import { describe, expect, it } from 'vitest'
import code from './kaleido.wgsl?raw'
import {
  DOODLE_SECONDS,
  KALEIDO,
  SYMMETRIES,
  doodle,
  fadeFor,
  packKaleido,
  toCentred,
  type KaleidoParams,
} from './kaleido'
import { wgslLayout } from './wgslLayout'

describe('the uniform the shader reads is the one JavaScript writes', () => {
  const wgsl = wgslLayout(code, 'Kaleido')

  it('agrees with the shader about where every field lives', () => {
    const { bytes, ...table } = KALEIDO
    expect(wgsl.offsets).toEqual(table)
    expect(wgsl.bytes).toBe(bytes)
  })

  it('writes every field where the shader will look for it', () => {
    const p: KaleidoParams = {
      a: [0.125, -0.25],
      b: [0.375, 0.5],
      color: [0.75, 0.5, 0.25],
      aspect: 1.5,
      radius: 0.0625,
      fade: 0.875,
      n: 12,
      mirror: true,
      drawing: true,
    }
    const v = new DataView(packKaleido(p))
    const f = (name: string, k = 0) => v.getFloat32(wgsl.offsets[name] + 4 * k, true)
    const u = (name: string) => v.getUint32(wgsl.offsets[name], true)
    expect([f('a'), f('a', 1), f('b'), f('b', 1)]).toEqual([0.125, -0.25, 0.375, 0.5])
    expect([f('color'), f('color', 1), f('color', 2)]).toEqual([0.75, 0.5, 0.25])
    expect([f('aspect'), f('radius'), f('fade')]).toEqual([1.5, 0.0625, 0.875])
    expect([u('n'), u('mirror'), u('drawing')]).toEqual([12, 1, 1])
    expect(
      new DataView(packKaleido({ ...p, mirror: false, drawing: false })).getUint32(
        wgsl.offsets.mirror,
        true,
      ),
    ).toBe(0)
  })
})

describe('centred coordinates', () => {
  it('put the middle of the canvas at the origin', () => {
    expect(toCentred(400, 300, 800, 600)).toEqual([0, 0])
    expect(toCentred(0, 0, 800, 600)).toEqual([-(800 / 600) / 2, -0.5])
  })

  it('measure a step across the same as a step down, so a turn is a turn', () => {
    const [x0, y0] = toCentred(300, 200, 1200, 500)
    const [x1] = toCentred(350, 200, 1200, 500)
    const [, y1] = toCentred(300, 250, 1200, 500)
    expect(x1 - x0).toBeCloseTo(y1 - y0, 12)
  })
})

describe('fading', () => {
  it('fades the same in a second whatever the frame rate', () => {
    const after = (fps: number) => fadeFor(0.3, 1 / fps) ** fps
    expect(after(30)).toBeCloseTo(0.3, 9)
    expect(after(120)).toBeCloseTo(0.3, 9)
  })

  it('keeps everything when asked to, and leaves a still frame alone', () => {
    expect(fadeFor(1, 1 / 60)).toBe(1)
    expect(fadeFor(0.2, 0)).toBe(1)
  })
})

describe('the doodle', () => {
  it('stays well inside the screen, so no wedge loses its end off an edge', () => {
    for (let seed = 0; seed < 20; seed++)
      for (let t = 0; t <= DOODLE_SECONDS; t += 0.02)
        expect(Math.hypot(...doodle(t, seed))).toBeLessThan(0.45)
  })

  it('starts near the middle and wanders out', () => {
    const r = (t: number) => Math.hypot(...doodle(t, 3))
    expect(r(0)).toBeLessThan(0.07)
    expect(
      Math.max(...Array.from({ length: 100 }, (_, i) => r((i / 100) * DOODLE_SECONDS))),
    ).toBeGreaterThan(0.25)
  })

  it('is a different shape for a different seed', () => {
    expect(doodle(1, 1)).not.toEqual(doodle(1, 2))
  })

  it('offers symmetries a person can name', () => {
    expect([...SYMMETRIES]).toEqual([4, 6, 8, 12])
  })
})
