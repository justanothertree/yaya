import { describe, expect, it } from 'vitest'
import {
  contrast,
  DEFAULT_SEED,
  derivePalette,
  hexToHsl,
  hslToHex,
  parseHex,
  rate,
  readableOn,
} from './customTheme'

/**
 * The colour maths the whole site's readability rests on.
 *
 * ⚠️ THIS ONE HAS AN ORACLE OUTSIDE THE CODEBASE, which makes it the strongest kind of test
 * here. WCAG 2 defines the contrast ratio exactly, and its published worked examples — black on
 * white is 21:1, a colour on itself is 1:1, the AA threshold is 4.5 — are numbers this file must
 * agree with and cannot be checked against itself. Everywhere else the best available check is
 * an invariant; here it is a right answer somebody else wrote down.
 *
 * ⚠️ AND IT IS NOT DECORATION. A contrast function that is quietly wrong ships themes nobody
 * can read, to people who will assume the fault is their eyes.
 */

const near = (got: number, want: number, why: string, slack = 0.01) =>
  expect(Math.abs(got - want), `${why}: ${got} vs ${want}`).toBeLessThan(slack)

describe('reading a hex colour', () => {
  it('takes the long form, with or without a hash', () => {
    expect(parseHex('#ff8000')).toEqual({ r: 255, g: 128, b: 0 })
    expect(parseHex('ff8000')).toEqual({ r: 255, g: 128, b: 0 })
  })

  it('and the short form, which doubles each digit', () => {
    expect(parseHex('#f80')).toEqual({ r: 255, g: 136, b: 0 })
    expect(parseHex('#fff')).toEqual({ r: 255, g: 255, b: 255 })
  })

  it('and is not case fussy', () => {
    expect(parseHex('#AABBCC')).toEqual(parseHex('#aabbcc'))
  })

  it('but refuses what is not a colour', () => {
    expect(parseHex('')).toBeNull()
    expect(parseHex('nope')).toBeNull()
    expect(parseHex('#12')).toBeNull()
    expect(parseHex('#1234567')).toBeNull()
    expect(parseHex('#ggghhh')).toBeNull()
  })
})

describe('contrast, against the numbers WCAG published', () => {
  /**
   * ⚠️ 21:1 IS THE MAXIMUM THE FORMULA CAN PRODUCE, and it is what black on white must give.
   * If this drifts, every rating on the appearance screen is wrong by the same amount and
   * nothing on screen would say so.
   */
  it('black on white is 21 to 1', () => {
    near(contrast('#000000', '#ffffff'), 21, 'black on white')
  })

  it('and white on black is the same, because it is a ratio', () => {
    near(contrast('#ffffff', '#000000'), contrast('#000000', '#ffffff'), 'symmetry')
  })

  it('and any colour against itself is 1 to 1', () => {
    for (const c of ['#000000', '#ffffff', '#22c55e', '#7f3f1f']) {
      near(contrast(c, c), 1, `${c} on itself`)
    }
  })

  /* mid grey #777777 against white — the published worked example is about 4.48:1 */
  it('and mid grey on white is just under the AA line', () => {
    const got = contrast('#777777', '#ffffff')
    near(got, 4.48, 'grey on white', 0.05)
    expect(rate(got)).toBe('large')
  })

  it('and #767676 on white is the classic "just passes" grey', () => {
    /* the well-known smallest grey that reaches 4.5 on white */
    expect(contrast('#767676', '#ffffff')).toBeGreaterThanOrEqual(4.5)
    expect(rate(contrast('#767676', '#ffffff'))).toBe('aa')
  })

  it('and is never below 1 or above 21, whatever it is handed', () => {
    const shades = ['#000', '#fff', '#22c55e', '#e02020', '#2563eb', '#f5a623', '#8b5a2b']
    for (const a of shades)
      for (const b of shades) {
        const r = contrast(a, b)
        expect(r).toBeGreaterThanOrEqual(1 - 1e-9)
        expect(r).toBeLessThanOrEqual(21 + 1e-9)
      }
  })

  it('and gives the safe answer rather than throwing on junk', () => {
    expect(contrast('nope', '#ffffff')).toBe(1)
    expect(contrast('#ffffff', 'also nope')).toBe(1)
  })
})

describe('the AA thresholds are the ones the standard sets', () => {
  it('4.5 passes for normal text and 4.49 does not', () => {
    expect(rate(4.5)).toBe('aa')
    expect(rate(4.49)).toBe('large')
  })

  /**
   * ⚠️ 3:1 IS LARGE TEXT AND UI BOUNDARIES ONLY, which is exactly the distinction that makes
   * "it looked fine" and "it passes" different answers.
   */
  it('and 3 is large-text only, below which nothing passes', () => {
    expect(rate(3)).toBe('large')
    expect(rate(2.99)).toBe('fail')
    expect(rate(1)).toBe('fail')
  })
})

describe('picking something readable to put on a colour', () => {
  it('is white on a dark background and dark on a light one', () => {
    expect(readableOn('#000000')).toBe('#ffffff')
    expect(readableOn('#ffffff')).not.toBe('#ffffff')
  })

  /**
   * ⚠️ AND WHATEVER IT PICKS HAS TO BE READABLE, which is the only thing that actually
   * matters about it. Checked across the spectrum rather than on two colours, because the
   * awkward cases are the mid-tones where neither answer is obviously right.
   */
  it('and whatever it picks passes AA, at every hue', () => {
    for (let h = 0; h < 360; h += 15) {
      for (const l of [0.2, 0.35, 0.5, 0.65, 0.8]) {
        const bg = hslToHex({ h, s: 0.7, l })
        const got = contrast(readableOn(bg), bg)
        expect(rate(got), `${bg} got ${got.toFixed(2)}`).not.toBe('fail')
      }
    }
  })
})

describe('hex and HSL round trip', () => {
  it('for colours that have a hue', () => {
    for (const hex of ['#22c55e', '#e02020', '#2563eb', '#f5a623', '#7c3aed']) {
      const back = hslToHex(hexToHsl(hex))
      const a = parseHex(hex)!
      const b = parseHex(back)!
      /* a byte either way is the cost of going through floating point twice */
      expect(Math.abs(a.r - b.r), `${hex} red`).toBeLessThanOrEqual(1)
      expect(Math.abs(a.g - b.g), `${hex} green`).toBeLessThanOrEqual(1)
      expect(Math.abs(a.b - b.b), `${hex} blue`).toBeLessThanOrEqual(1)
    }
  })

  it('and for greys, which have no hue to remember', () => {
    for (const hex of ['#000000', '#808080', '#ffffff']) {
      const back = hslToHex(hexToHsl(hex))
      const a = parseHex(hex)!
      const b = parseHex(back)!
      expect(Math.abs(a.r - b.r)).toBeLessThanOrEqual(1)
      expect(a.r === a.g && a.g === a.b).toBe(true)
      expect(b.r === b.g && b.g === b.b).toBe(true)
    }
  })

  it('and hslToHex always produces something parseHex accepts', () => {
    for (let h = -400; h <= 800; h += 97) {
      for (const s of [0, 0.5, 1]) {
        for (const l of [0, 0.5, 1]) {
          const hex = hslToHex({ h, s, l })
          expect(parseHex(hex), `h${h} s${s} l${l} gave ${hex}`).not.toBeNull()
        }
      }
    }
  })

  it('and a hue outside 0–360 wraps rather than breaking', () => {
    const a = parseHex(hslToHex({ h: 30, s: 0.6, l: 0.5 }))!
    const b = parseHex(hslToHex({ h: 390, s: 0.6, l: 0.5 }))!
    expect(Math.abs(a.r - b.r)).toBeLessThanOrEqual(1)
    expect(Math.abs(a.g - b.g)).toBeLessThanOrEqual(1)
    expect(Math.abs(a.b - b.b)).toBeLessThanOrEqual(1)
  })

  it('and lightness 0 and 1 are black and white whatever the hue', () => {
    for (const h of [0, 120, 240]) {
      expect(parseHex(hslToHex({ h, s: 1, l: 0 }))).toEqual({ r: 0, g: 0, b: 0 })
      expect(parseHex(hslToHex({ h, s: 1, l: 1 }))).toEqual({ r: 255, g: 255, b: 255 })
    }
  })
})

describe('a palette built from three colours', () => {
  /**
   * ⚠️ THE POINT OF THE WHOLE FILE IS THAT THE RESULT IS READABLE. A seed is three colours
   * somebody picked; everything else is derived, and the derivation is where a theme becomes
   * unusable without anybody choosing to make it so.
   */
  it('puts its text on its background legibly', () => {
    const p = derivePalette(DEFAULT_SEED)
    const got = contrast(p['--text'], p['--bg'])
    expect(rate(got), `default theme text got ${got.toFixed(2)}`).toBe('aa')
  })

  it('and keeps muted text at least large-text readable', () => {
    const p = derivePalette(DEFAULT_SEED)
    const got = contrast(p['--muted'], p['--bg'])
    expect(rate(got), `muted got ${got.toFixed(2)}`).not.toBe('fail')
  })

  it('and gives every variable it promises, as a colour', () => {
    const p = derivePalette(DEFAULT_SEED)
    for (const [k, v] of Object.entries(p)) {
      if (!k.startsWith('--')) continue
      if (typeof v !== 'string' || !v.startsWith('#')) continue
      expect(parseHex(v), `${k} is ${v}`).not.toBeNull()
    }
  })

  it('and survives a seed of three identical colours without throwing', () => {
    const flat = derivePalette({ bg: '#808080', text: '#808080', accent: '#808080' })
    expect(parseHex(flat['--bg'])).not.toBeNull()
    expect(parseHex(flat['--text'])).not.toBeNull()
  })
})
