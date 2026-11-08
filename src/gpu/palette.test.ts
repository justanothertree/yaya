import { describe, expect, it } from 'vitest'
import {
  MAX_COLOURS,
  MAX_KEPT,
  asCss,
  asHexList,
  contrast,
  error,
  findPalette,
  grade,
  hex,
  keep,
  oklab,
  packPalette,
  parseHex,
  readKept,
  samples,
  srgb,
  type Lab,
  type Rgb,
} from './palette'

/** a picture of flat colours in given amounts, shuffled so no order in the pixels helps */
const picture = (parts: [Rgb, number][]) => {
  const px: number[] = []
  for (const [c, n] of parts)
    for (let i = 0; i < n; i++) px.push(...c.map((v) => Math.round(v * 255)), 255)
  // a fixed shuffle of whole pixels
  let a = 7
  for (let i = px.length / 4 - 1; i > 0; i--) {
    a = (a * 1103515245 + 12345) >>> 0
    const j = a % (i + 1)
    for (let k = 0; k < 4; k++) [px[i * 4 + k], px[j * 4 + k]] = [px[j * 4 + k], px[i * 4 + k]]
  }
  return samples(Uint8ClampedArray.from(px))
}
const RED: Rgb = [1, 0, 0]
const TEAL: Rgb = [0, 128 / 255, 128 / 255]
const CREAM: Rgb = [1, 240 / 255, 200 / 255]
const close = (a: Lab, b: Lab, eps = 1e-3) => a.every((v, i) => Math.abs(v - b[i]) < eps)

describe('colour spaces', () => {
  it('agrees with the published OKLab values', () => {
    // Ottosson's own table: white, and sRGB red, green and blue
    const want: [Rgb, Lab][] = [
      [
        [1, 1, 1],
        [1, 0, 0],
      ],
      [
        [1, 0, 0],
        [0.62796, 0.22486, 0.12585],
      ],
      [
        [0, 1, 0],
        [0.86644, -0.23389, 0.1795],
      ],
      [
        [0, 0, 1],
        [0.45201, -0.03246, -0.31153],
      ],
    ]
    for (const [c, l] of want) expect(close(oklab(c), l, 2e-4), hex(c)).toBe(true)
  })

  it('comes back from OKLab to the same sRGB', () => {
    for (let i = 0; i < 200; i++) {
      const c: Rgb = [(i * 37) % 256, (i * 91) % 256, (i * 53) % 256].map((v) => v / 255) as Rgb
      srgb(oklab(c)).forEach((v, j) => expect(v).toBeCloseTo(c[j], 5))
    }
  })

  it('reads and writes hex', () => {
    expect(hex([1, 0.5, 0])).toBe('#ff8000')
    expect(parseHex('#FF8000')).toEqual([1, 128 / 255, 0])
    expect(parseHex('fff')).toEqual([1, 1, 1])
    for (const bad of ['', '#ggg', '#12345', 'red', '#1234567']) expect(parseHex(bad)).toBeNull()
  })
})

describe('readability', () => {
  it('has the contrast ratios WCAG gives', () => {
    expect(contrast([0, 0, 0], [1, 1, 1])).toBeCloseTo(21, 6)
    expect(contrast(TEAL, TEAL)).toBe(1)
    // #777 on white is the textbook near miss: 4.48, just under AA
    expect(contrast(parseHex('#777')!, [1, 1, 1])).toBeCloseTo(4.48, 2)
    expect(grade(contrast(parseHex('#777')!, [1, 1, 1]))).toBe('large')
    expect(grade(contrast(parseHex('#767676')!, [1, 1, 1]))).toBe('AA')
    expect(grade(21)).toBe('AAA')
    expect(grade(2.9)).toBe('no')
    // and it does not care which is the text
    expect(contrast(RED, CREAM)).toBe(contrast(CREAM, RED))
  })
})

describe('finding a palette', () => {
  it('finds the colours a picture is made of, and how much of it each is', () => {
    const s = picture([
      [RED, 500],
      [TEAL, 300],
      [CREAM, 200],
    ])
    for (const seed of [1, 2, 3, 99, 12345]) {
      const f = findPalette(s, 3, seed)
      const want = [TEAL, RED, CREAM].map(oklab) // darkest first
      f.colours.forEach((c, i) => expect(close(c, want[i]), `seed ${seed}`).toBe(true))
      expect(f.share.map((x) => Math.round(x * 100))).toEqual([30, 50, 20])
      expect(error(s, f.colours)).toBeLessThan(1e-4)
    }
  })

  it('keeps a locked colour exactly, and fits the rest round it', () => {
    const s = picture([
      [RED, 500],
      [TEAL, 300],
      [CREAM, 200],
    ])
    const mine = oklab([0.2, 0.2, 0.9])
    const f = findPalette(s, 3, 4, [mine])
    const k = f.locked.indexOf(true)
    expect(f.locked.filter(Boolean).length).toBe(1)
    expect(f.colours[k]).toEqual(mine)
    // the two free colours went to the biggest parts of the picture the locked one cannot cover
    const free = f.colours.filter((_, i) => !f.locked[i])
    expect(free.some((c) => close(c, oklab(RED), 0.02))).toBe(true)
  })

  it('never has an empty or broken colour, even asked for more than the picture holds', () => {
    const s = picture([
      [RED, 40],
      [TEAL, 60],
    ])
    const f = findPalette(s, 6, 3)
    expect(f.colours.length).toBe(6)
    for (const c of f.colours) for (const v of c) expect(Number.isFinite(v)).toBe(true)
    expect(f.share.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 9)
  })

  it('is darkest first, keeps k within bounds, and copes with no picture', () => {
    const s = picture([
      [RED, 50],
      [TEAL, 50],
      [CREAM, 50],
      [[0.1, 0.1, 0.1], 50],
    ])
    const f = findPalette(s, 4, 8)
    for (let i = 1; i < 4; i++) expect(f.colours[i][0]).toBeGreaterThanOrEqual(f.colours[i - 1][0])
    expect(findPalette(s, 1, 1).colours.length).toBe(2)
    expect(findPalette(s, 50, 1).colours.length).toBe(MAX_COLOURS)
    expect(findPalette(new Float32Array(0), 3, 1).colours.length).toBe(3)
  })

  it('stands for a picture better with more colours', () => {
    const s = picture([
      [RED, 100],
      [TEAL, 100],
      [CREAM, 100],
      [[0.1, 0.1, 0.1], 100],
    ])
    const e = [2, 3, 4].map((k) => error(s, findPalette(s, k, 5).colours))
    expect(e[1]).toBeLessThan(e[0])
    expect(e[2]).toBeLessThan(e[1])
  })
})

describe('what leaves the page, and what is kept', () => {
  it('writes hex and CSS', () => {
    expect(asHexList([RED, CREAM])).toBe('#ff0000 #fff0c8')
    expect(asCss([RED, CREAM])).toBe(
      ':root {\n  --palette-1: #ff0000;\n  --palette-2: #fff0c8;\n}\n',
    )
  })

  it('keeps palettes round a reload, and drops what is not one', () => {
    let list = keep([], [RED, TEAL, CREAM], 1700000000123)!
    list = keep(list, [CREAM, [0.1, 0.2, 0.3]], 1700000000456)!
    const back = readKept(JSON.stringify(list))
    expect(back).toEqual(list)
    expect(back[0].colours).toEqual(['#fff0c8', '#1a334d'])
    expect(back[1]).toEqual({ colours: ['#ff0000', '#008080', '#fff0c8'], at: 1700000000123 })
    const bad = [
      { colours: ['#ff0000'], at: 1 },
      { colours: ['#ff0000', 'nope'], at: 1 },
      { colours: ['ff0000', '#00ff00'], at: 1 },
      { colours: ['#ff0000', '#00ff00'], at: 'x' },
      { colours: Array(11).fill('#ffffff'), at: 1 },
      null,
    ]
    expect(readKept(JSON.stringify([...bad, list[0]]))).toEqual([list[0]])
    expect(readKept('not json')).toEqual([])
    expect(readKept(null)).toEqual([])
  })

  it('refuses a new palette when the shelf is full rather than dropping an old one', () => {
    let list: ReturnType<typeof readKept> = []
    for (let i = 0; i < MAX_KEPT; i++) list = keep(list, [[i / 40, 0, 0], CREAM], i)!
    expect(list.length).toBe(MAX_KEPT)
    expect(keep(list, [TEAL, CREAM], 99)).toBeNull()
    // the same palette again needs no room: it moves to the front
    const again = keep(list, [[5 / 40, 0, 0], CREAM], 100)!
    expect(again.length).toBe(MAX_KEPT)
    expect(again[0].at).toBe(100)
  })

  it('packs each colour as (L, a, b, chosen) then its sRGB', () => {
    const cs = [TEAL, RED].map(oklab)
    const p = packPalette(cs, 1)
    expect(p.length).toBe(MAX_COLOURS * 8)
    expect([...p.slice(0, 4)].map((v) => +v.toFixed(5))).toEqual(
      [...cs[0], 0].map((v) => +Math.fround(v).toFixed(5)),
    )
    expect(p[11]).toBe(1)
    expect(hex([p[12], p[13], p[14]])).toBe('#ff0000')
  })
})
