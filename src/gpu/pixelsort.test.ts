import { describe, expect, it } from 'vitest'
import code from './pixelsort.wgsl?raw'
import {
  AXIS,
  IDX_BITS,
  KEY_BITS,
  LINE,
  PAD,
  SORT,
  compareExchange,
  directionOf,
  keysOf,
  level,
  measure,
  sourceOf,
  stages,
} from './pixelsort'
import { wgslLayout } from './wgslLayout'

function lcg(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 4294967296
  }
}

const runNetwork = (keys: Uint32Array) => {
  for (const [k, j] of stages(keys.length)) compareExchange(keys, k, j)
  return keys
}

describe('the shader and this file describe one sorter', () => {
  const wgsl = wgslLayout(code, 'Sort')

  it('agrees about where every field of the uniform lives', () => {
    const { bytes, lineLen, ...rest } = SORT
    expect(wgsl.offsets).toEqual({ ...rest, line_len: lineLen })
    expect(wgsl.bytes).toBe(bytes)
  })

  it('packs keys with the same bits', () => {
    const num = (name: string) => Number(new RegExp(`const ${name} = (\\w+)u;`).exec(code)?.[1])
    expect([num('IDX_BITS'), num('KEY_BITS'), num('PAD'), num('LINE')]).toEqual([
      IDX_BITS,
      KEY_BITS,
      PAD,
      LINE,
    ])
    // a line's places fit the index bits, and a line of single-pixel spans fits above them
    expect(2 ** IDX_BITS).toBe(LINE)
    expect(LINE * 2 ** (KEY_BITS + IDX_BITS)).toBeLessThanOrEqual(2 ** 32)
  })
})

describe('the sorting network', () => {
  it('has k(k+1)/2 stages for 2ᵏ keys, and every stage pairs each key with exactly one other', () => {
    expect(stages(1024).length).toBe(55)
    expect(stages(8).length).toBe(6)
    for (const [k, j] of stages(64)) {
      const partner = Array.from({ length: 64 }, (_, i) => (j === k / 2 ? i ^ (k - 1) : i ^ j))
      expect(partner.every((p, i) => partner[p] === i && p !== i)).toBe(true)
    }
  })

  it('leaves every block sorted the same way round after each level, so a picture melts', () => {
    const rand = lcg(4)
    const keys = Uint32Array.from({ length: 64 }, () => Math.floor(rand() * 1000))
    for (const [k, j] of stages(64)) {
      compareExchange(keys, k, j)
      if (j !== 1) continue
      // a level is done: every block of k keys is in ascending order
      for (let b = 0; b < 64; b += k)
        for (let i = b + 1; i < b + k; i++)
          expect(keys[i], `level ${k}`).toBeGreaterThanOrEqual(keys[i - 1])
    }
  })

  it('sorts anything an ordinary sort does, ties and all', () => {
    const rand = lcg(3)
    for (const n of [2, 16, 1024]) {
      for (const spread of [5, 1e9]) {
        const keys = Uint32Array.from({ length: n }, () => Math.floor(rand() * spread))
        const want = [...keys].sort((a, b) => a - b)
        expect([...runNetwork(keys)]).toEqual(want)
      }
    }
  })
})

describe('the keys', () => {
  const inside = (n: number) => Array.from({ length: n }, () => true)

  it('sort a single span by brightness and say where each pixel came from', () => {
    const v = [0.9, 0.2, 0.6, 0.4]
    const keys = runNetwork(keysOf(v, inside(4), 0, 1, 8))
    expect([...keys.slice(0, 4)].map(sourceOf).map((i) => v[i])).toEqual([0.2, 0.4, 0.6, 0.9])
    // the padding sorts after every real key
    expect([...keys.slice(4)]).toEqual([PAD, PAD, PAD, PAD])
  })

  it('never move a pixel out of its span, and leave pixels outside every span where they were', () => {
    // two bright spans either side of a dark pixel; the threshold keeps the dark one out
    const v = [0.9, 0.5, 0.7, 0.05, 0.8, 0.6]
    const keys = runNetwork(keysOf(v, inside(6), 0.3, 1, 8))
    const from = [...keys.slice(0, 6)].map(sourceOf)
    expect(from).toEqual([1, 2, 0, 3, 5, 4])
    // and outside the stroke counts as outside every span
    const masked = runNetwork(keysOf(v, [true, true, true, true, false, false], 0, 1, 8))
    expect([...masked.slice(0, 6)].map(sourceOf)).toEqual([3, 1, 2, 0, 4, 5])
  })

  it('keep equal pixels in the order they were in', () => {
    const v = [0.5, 0.5, 0.5, 0.1]
    const keys = runNetwork(keysOf(v, inside(4), 0, 1, 4))
    expect([...keys].map(sourceOf)).toEqual([3, 0, 1, 2])
  })

  it('agree with an ordinary stable sort of each span, on a long random line', () => {
    const rand = lcg(9)
    const n = 1000
    const v = Array.from({ length: n }, () => rand())
    const ins = Array.from({ length: n }, () => rand() > 0.1)
    const lo = 0.25
    const hi = 0.95
    const got = [...runNetwork(keysOf(v, ins, lo, hi)).slice(0, n)].map(sourceOf)
    // the same thing done the plain way: cut into spans, sort each by level, keep ties in order
    const want: number[] = []
    let run: number[] = []
    const flush = () => {
      want.push(...run.sort((a, b) => level(v[a]) - level(v[b]) || a - b))
      run = []
    }
    for (let i = 0; i < n; i++) {
      if (ins[i] && v[i] >= lo && v[i] <= hi) run.push(i)
      else {
        flush()
        want.push(i)
      }
    }
    flush()
    expect(got).toEqual(want)
  })
})

describe('what a pixel is sorted by, and which way', () => {
  it('measures brightness as the eye does, hue round the wheel, and warmth from blue to red', () => {
    expect(measure(1, 1, 1, 'light')).toBeCloseTo(1, 9)
    expect(measure(0, 1, 0, 'light')).toBeGreaterThan(measure(1, 0, 0, 'light'))
    expect(measure(1, 0, 0, 'light')).toBeGreaterThan(measure(0, 0, 1, 'light'))
    expect([measure(1, 0, 0, 'hue'), measure(0, 1, 0, 'hue'), measure(0, 0, 1, 'hue')]).toEqual([
      0,
      1 / 3,
      2 / 3,
    ])
    expect(measure(1, 0, 0, 'warmth')).toBe(1)
    expect(measure(0, 0, 1, 'warmth')).toBe(0)
    expect(level(1)).toBe(1023)
  })

  it('takes a swipe as the direction it went furthest, and a dab as no swipe at all', () => {
    expect(directionOf(100, 20)).toBe('right')
    expect(directionOf(-100, 60)).toBe('left')
    expect(directionOf(10, 90)).toBe('down')
    expect(directionOf(-30, -90)).toBe('up')
    expect(directionOf(5, 5)).toBeNull()
    expect(AXIS.up).toEqual({ axis: 1, flip: true })
  })
})
