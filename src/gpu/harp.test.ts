import { describe, expect, it } from 'vitest'
import code from './harp.wgsl?raw'
import {
  DECAY,
  HARP,
  MODES,
  crossings,
  displacement,
  layout,
  modeAmp,
  nearest,
  packHarp,
  packStrings,
  phrase,
  tune,
} from './harp'
import { wgslLayout } from './wgslLayout'

describe('the shader and this file describe one harp', () => {
  const wgsl = wgslLayout(code, 'Harp')

  it('agrees about where every field of the uniform lives', () => {
    const { bytes, ...table } = HARP
    expect(wgsl.offsets).toEqual(table)
    expect(wgsl.bytes).toBe(bytes)
  })

  it('agrees about how fast a string dies and how fast it is seen to swing', () => {
    expect(code).toContain(`const DECAY = ${DECAY};`)
    expect(code).toContain('return 2.2 * pow(2.0, (midi - 60.0) / 24.0);')
  })

  it('writes every field, and every string, where the shader will look', () => {
    const v = new DataView(packHarp({ w: 640, h: 480, time: 2.5, count: 12, width: 7 }))
    const u = (k: string, i = 0) => v.getUint32(wgsl.offsets[k] + 4 * i, true)
    const f = (k: string) => v.getFloat32(wgsl.offsets[k], true)
    expect([u('size'), u('size', 1), u('count'), u('modes')]).toEqual([640, 480, 12, MODES])
    expect([f('time'), f('width')]).toEqual([2.5, 7])
    const s = packStrings(
      [{ x: 10, top: 20, bottom: 300, midi: 60 }],
      [{ at: 1.5, where: 0.25, amp: -0.5 }],
    )
    expect([...s.subarray(0, 7)]).toEqual([10, 20, 300, 60, 1.5, 0.25, -0.5])
    // an unplucked string is still: no amplitude
    expect(packStrings([{ x: 1, top: 2, bottom: 3, midi: 60 }], [])[6]).toBe(0)
  })
})

describe('tuning and standing', () => {
  it('tunes up a pentatonic scale from C3, into the next octave', () => {
    expect(tune('penta', 48, 7)).toEqual([48, 50, 52, 55, 57, 60, 62])
  })

  it('stands the strings evenly, low on the left, each shorter than the last, inside the canvas', () => {
    const s = layout(tune('penta', 48, 12), 800, 500)
    for (let i = 1; i < s.length; i++) {
      expect(s[i].x - s[i - 1].x).toBeCloseTo(s[1].x - s[0].x, 9)
      expect(s[i].bottom - s[i].top).toBeLessThan(s[i - 1].bottom - s[i - 1].top)
      expect(s[i].midi).toBeGreaterThan(s[i - 1].midi)
    }
    for (const t of s) {
      expect(t.x).toBeGreaterThan(0)
      expect(t.x).toBeLessThan(800)
      expect(t.top).toBeGreaterThan(0)
      expect(t.bottom).toBeLessThan(500)
    }
  })
})

describe('strumming', () => {
  const s = layout(tune('penta', 48, 6), 600, 400)

  it('finds the strings a stroke crossed, in the order it crossed them, and where', () => {
    const y = 300
    const right = crossings(s, [0, y], [600, y])
    expect(right.map((c) => c.i)).toEqual([0, 1, 2, 3, 4, 5])
    for (const c of right)
      expect(c.where).toBeCloseTo((y - s[c.i].top) / (s[c.i].bottom - s[c.i].top), 9)
    expect(crossings(s, [600, y], [0, y]).map((c) => c.i)).toEqual([5, 4, 3, 2, 1, 0])
  })

  it('sounds a string once when a stroke ends right on it and the next carries on', () => {
    const x = s[2].x
    const both = [
      ...crossings(s, [x - 10, 300], [x, 300]),
      ...crossings(s, [x, 300], [x + 10, 300]),
    ]
    expect(both.map((c) => c.i)).toEqual([2])
  })

  it('does not sound a string the stroke passed above or below', () => {
    expect(crossings(s, [0, 2], [600, 2])).toEqual([])
  })

  it('plucks the string nearest a tap, if it is near enough', () => {
    expect(nearest(s, s[3].x + 5, 300, 14)?.i).toBe(3)
    expect(nearest(s, (s[3].x + s[4].x) / 2, 300, 14)).toBeNull()
  })
})

describe('a plucked string', () => {
  /** the shape the finger pulled it into: a triangle, height 1 at the pluck */
  const triangle = (p: number, x: number) => (x < p ? x / p : (1 - x) / (1 - p))

  it('starts as exactly the triangle it was pulled into — its modes are that shape’s Fourier series', () => {
    const pluck = { at: 0, where: 0.3, amp: 1 }
    for (const x of [0.1, 0.3, 0.5, 0.8]) {
      let y = 0
      for (let n = 1; n <= 2000; n++) y += modeAmp(n, pluck.where) * Math.sin(n * Math.PI * x)
      expect(y).toBeCloseTo(triangle(0.3, x), 2)
    }
  })

  it('keeps the pluck’s corner sharp with the modes it is drawn with', () => {
    expect(displacement({ at: 0, where: 0.3, amp: 1 }, 0.3, 0, 60)).toBeGreaterThan(0.9)
  })

  it('plucked in the middle has no even modes — the round, hollow tone', () => {
    for (const n of [2, 4, 6]) expect(Math.abs(modeAmp(n, 0.5))).toBeLessThan(1e-12)
    expect(Math.abs(modeAmp(2, 0.1))).toBeGreaterThan(0.1)
  })

  it('dies away, and a pluck from the other side swings the other way', () => {
    const p = { at: 0, where: 0.4, amp: 1 }
    const energy = (since: number) => {
      let e = 0
      for (let k = 0; k <= 50; k++) e += displacement(p, k / 50, since, 60) ** 2
      return e
    }
    // sampled at whole swings of the lowest mode, so phase does not hide the decay
    const period = 1 / 2.2
    expect(energy(period * 6)).toBeLessThan(energy(0) * 0.1)
    expect(displacement({ ...p, amp: -1 }, 0.4, 0, 60)).toBeCloseTo(
      -displacement(p, 0.4, 0, 60),
      12,
    )
  })
})

describe('playing by itself', () => {
  it('plays the same phrase for the same seed, in time order, on strings that exist', () => {
    expect(phrase(12, 7)).toEqual(phrase(12, 7))
    expect(phrase(12, 7)).not.toEqual(phrase(12, 8))
    const p = phrase(12, 3)
    for (let i = 1; i < p.length; i++) expect(p[i].t).toBeGreaterThan(p[i - 1].t)
    for (const n of p) {
      expect(n.i).toBeGreaterThanOrEqual(0)
      expect(n.i).toBeLessThan(12)
    }
  })
})
