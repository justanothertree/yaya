import { describe, expect, it } from 'vitest'
import types from './neon-types.wgsl?raw'
import flood from './neon-flood.wgsl?raw'
import {
  LETTER_STEP,
  MAX_LETTERS,
  NEON,
  brightness,
  exactDistance,
  faultyLetter,
  jfaSteps,
  jumpFlood,
  letterRed,
  packNeon,
  seedsOf,
} from './neon'
import { wgslLayout } from './wgslLayout'

describe('the shader and this file describe one sign', () => {
  const wgsl = wgslLayout(types, 'Neon')

  it('agrees about where every field of the uniform lives', () => {
    const { bytes, ...table } = NEON
    expect(wgsl.offsets).toEqual(table)
    expect(wgsl.bytes).toBe(bytes)
  })

  it('writes every field where the shader will look for it', () => {
    const v = new DataView(
      packNeon({
        w: 300,
        h: 200,
        step: 64,
        style: 'solid',
        time: 2.5,
        scale: 2,
        palette: 'gold',
        letters: 5,
      }),
    )
    const u = (k: string, i = 0) => v.getUint32(wgsl.offsets[k] + 4 * i, true)
    const f = (k: string) => v.getFloat32(wgsl.offsets[k], true)
    expect([u('size'), u('size', 1), u('step'), u('style'), u('palette'), u('letters')]).toEqual([
      300, 200, 64, 1, 2, 5,
    ])
    expect([f('time'), f('scale')]).toEqual([2.5, 2])
  })

  it('reads letters back with the same spacing they were drawn with, and every letter fits in red', () => {
    expect(flood).toContain(`const LETTER_STEP = ${LETTER_STEP.toFixed(1)};`)
    expect(letterRed(MAX_LETTERS - 1)).toBeLessThanOrEqual(255)
    // an antialiased edge reads back a few out; that must still name the same letter
    for (let i = 0; i < MAX_LETTERS; i++)
      for (const err of [-6, -3, 0, 3, 6])
        expect(Math.round((letterRed(i) + err) / LETTER_STEP) - 1).toBe(i)
  })
})

describe('the jump flood', () => {
  it('halves from about half the field down to one, then takes one more step of one', () => {
    expect(jfaSteps(240, 140)).toEqual([128, 64, 32, 16, 8, 4, 2, 1, 1])
    expect(jfaSteps(2, 2)).toEqual([1, 1])
  })

  it('carries a lone seed to every pixel', () => {
    const w = 37
    const h = 23
    const seeds = new Int32Array(w * h).fill(-1)
    seeds[11 * w + 5] = 11 * w + 5
    expect(new Set(jumpFlood(seeds, w, h))).toEqual(new Set([11 * w + 5]))
  })

  it('finds nearly every pixel its true nearest seed, and the rest within half a pixel', () => {
    // measured on this fixture: 34 of 122,880 pixels off (worst 0.92px) without the extra pass at
    // step 1, and 2 (worst 0.36px) with it — so a bound between the two holds the pass to its job
    const w = 96
    const h = 64
    let x = 777
    const rand = () => (x = (Math.imul(x, 1103515245) + 12345) >>> 0) / 4294967296
    let wrong = 0
    let worst = 0
    for (let round = 0; round < 20; round++) {
      const seeds = new Int32Array(w * h).fill(-1)
      for (let k = 0; k < 60; k++) {
        const i = Math.floor(rand() * w * h)
        seeds[i] = i
      }
      const near = jumpFlood(seeds, w, h)
      const exact = exactDistance(seeds, w, h)
      for (let i = 0; i < w * h; i++) {
        const got = Math.hypot((near[i] % w) - (i % w), Math.floor(near[i] / w) - Math.floor(i / w))
        if (got - exact[i] > 1e-9) wrong++
        worst = Math.max(worst, got - exact[i])
      }
    }
    expect(wrong).toBeLessThan(10)
    expect(worst).toBeLessThan(0.5)
  })
})

describe('seeds', () => {
  const w = 10
  const h = 10
  const mask = new Uint8Array(w * h)
  for (let y = 2; y < 8; y++) for (let x = 2; x < 8; x++) mask[y * w + x] = 255

  it('bends a tube round the outline only, and fills a solid sign', () => {
    const tube = seedsOf(mask, w, h, 'tube').filter((s) => s >= 0).length
    const solid = seedsOf(mask, w, h, 'solid').filter((s) => s >= 0).length
    expect(tube).toBe(6 * 4 - 4) // a 6×6 square's edge
    expect(solid).toBe(36)
  })
})

describe('flickering', () => {
  it('is dark before a letter is lit, stutters on, then holds', () => {
    expect(brightness(0, 1, 2, -10, -1)).toBe(0)
    const warming = new Set<number>()
    for (let t = 2; t < 2.6; t += 0.01) warming.add(brightness(0, t, 2, -10, -1))
    expect(warming).toEqual(new Set([1, 0.08]))
    for (let t = 2.6; t < 10; t += 0.13) expect(brightness(0, t, 2, -10, -1)).toBe(1)
  })

  it('lets the faulty letter buzz now and then, and only that one', () => {
    let dark = 0
    let n = 0
    for (let t = 1; t < 60; t += 0.01, n++) {
      const b = brightness(3, t, 0, -10, 3)
      if (b < 1) dark++
      expect(brightness(2, t, 0, -10, 3)).toBe(1)
    }
    expect(dark / n).toBeGreaterThan(0.01)
    expect(dark / n).toBeLessThan(0.15)
  })

  it('stutters every letter for a second after a knock, and then steadies', () => {
    const during = new Set<number>()
    for (let t = 5; t < 5.9; t += 0.01) during.add(brightness(1, t, 0, 5, -1))
    expect(during.size).toBeGreaterThan(1)
    expect(brightness(1, 6.05, 0, 5, -1)).toBe(1)
  })

  it('picks the same faulty letter for the same word, and never a space', () => {
    expect(faultyLetter('HELLO THERE')).toBe(faultyLetter('HELLO THERE'))
    for (const w of ['A B C', 'NEON', 'hi there', ' x '])
      expect(w[faultyLetter(w)].trim()).not.toBe('')
    expect(faultyLetter('   ')).toBe(-1)
  })
})
