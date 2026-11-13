import { describe, expect, it } from 'vitest'
import {
  BASE,
  BASELINE,
  CHARSET,
  DEFAULT_STYLE,
  EMPTY,
  GRID_H,
  INKS,
  PRESETS,
  RANGES,
  STARTER,
  decode,
  encode,
  glyphOf,
  has,
  layout,
  onGrid,
  readSaved,
  setPoint,
  type Font,
  type Style,
} from './typeface'

describe('the base font', () => {
  it('has every letter and digit, and every point is on the grid in half-dots', () => {
    for (const c of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789') expect(BASE[c], c).toBeDefined()
    for (const [c, gl] of Object.entries(BASE)) {
      expect(gl.strokes.length, c).toBeGreaterThan(0)
      for (const st of gl.strokes) {
        expect(st.length, c).toBeGreaterThanOrEqual(2)
        for (const p of st) {
          expect(onGrid(p), `${c} ${p}`).toBe(true)
          expect(p[0] * 2, `${c} ${p}`).toBe(Math.round(p[0] * 2))
          expect(p[1] * 2, `${c} ${p}`).toBe(Math.round(p[1] * 2))
          // a letter stays within its own width
          expect(p[0], c).toBeLessThanOrEqual(gl.w)
        }
      }
    }
  })
  it('letters sit on the baseline: every capital reaches it, and only the comma goes below', () => {
    for (const c of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
      const ys = BASE[c].strokes.flat().map((p) => p[1])
      expect(Math.max(...ys), c).toBe(BASELINE)
      expect(Math.min(...ys), c).toBe(0)
    }
    const below = Object.entries(BASE)
      .filter(([, gl]) => gl.strokes.flat().some((p) => p[1] > BASELINE))
      .map(([c]) => c)
    expect(below).toEqual([','])
  })
  it('lower case is typed as capitals, and an unknown character keeps its space', () => {
    expect(has('a')).toBe(true)
    expect(glyphOf(STARTER, 'q')).toBe(BASE.Q)
    expect(has('é')).toBe(false)
    const l = layout('AéB', STARTER, 999)
    expect(l.placed.map((p) => p.c)).toEqual(['A', 'é', 'B'])
    expect(l.placed[2].x).toBeCloseTo(2 * (4 + DEFAULT_STYLE.tracking), 9)
  })
})

describe('setting type', () => {
  it('wraps whole words at the width, and a newline starts a line', () => {
    const l = layout('AB CD EF', STARTER, 15)
    const rows = [...new Set(l.placed.map((p) => p.y))]
    expect(rows).toHaveLength(3)
    expect(l.placed.filter((p) => p.y === rows[1]).map((p) => p.c)).toEqual(['C', 'D'])
    expect([...new Set(layout('A\nB', STARTER, 999).placed.map((p) => p.y))]).toHaveLength(2)
  })
  it('a word longer than the line still gets set, on a line of its own', () => {
    const l = layout('ABCDEFGHIJ', STARTER, 10)
    expect(l.placed).toHaveLength(10)
  })
  it('width and tracking change the spacing by exactly what they say', () => {
    const style: Style = { ...DEFAULT_STYLE, width: 1.5, tracking: 2 }
    const l = layout('AB', { ...STARTER, style }, 999)
    expect(l.placed[1].x).toBeCloseTo(4 * 1.5 + 2, 9)
    expect(l.width).toBeCloseTo(4 * 1.5 * 2 + 2, 9)
  })
  it('slant leans letters about the baseline: the baseline stays put, the top moves', () => {
    const style: Style = { ...DEFAULT_STYLE, slant: 0.3 }
    const at = { c: 'A', x: 10, y: 0 }
    expect(setPoint([2, BASELINE], at, style)).toEqual([12, BASELINE])
    expect(setPoint([2, 0], at, style)[0]).toBeCloseTo(12 + BASELINE * 0.3, 9)
    expect(GRID_H).toBe(7)
  })
})

describe('a font as a link', () => {
  const font: Font = {
    name: 'Mïne ✓',
    style: {
      weight: 1.2,
      slant: 0.2,
      width: 1.3,
      ends: 'square',
      corners: 0.8,
      outline: true,
      inline: true,
      shadow: true,
      tracking: 2.5,
      leading: 4,
      ink: 5,
      ink2: 9,
      paper: 3,
    },
    glyphs: {
      A: {
        w: 4,
        strokes: [
          [
            [0, 6],
            [2, 0],
            [4, 6],
          ],
          [
            [1, 3.5],
            [3, 3.5],
          ],
        ],
      },
      '.': {
        w: 2,
        strokes: [
          [
            [1, 5.5],
            [1, 6],
          ],
        ],
      },
    },
  }
  it('round-trips the style (to the slider step), every redrawn letter, the name and the message', () => {
    const back = decode(encode(font, 'HI THERE\nLINE 2 ✓'))!
    expect(back.message).toBe('HI THERE\nLINE 2 ✓')
    expect(back.font.name).toBe('Mïne ✓')
    expect(back.font.glyphs).toEqual(font.glyphs)
    for (const k of ['ends', 'outline', 'inline', 'shadow', 'ink', 'ink2', 'paper'] as const)
      expect(back.font.style[k], k).toBe(font.style[k])
    for (const k of ['weight', 'slant', 'width', 'corners', 'tracking', 'leading'] as const) {
      const [lo, hi] = RANGES[k]
      expect(Math.abs(back.font.style[k] - font.style[k]), k).toBeLessThanOrEqual(
        // half a step of the byte, plus the rounding to thousandths decode does for tidy numbers
        (hi - lo) / 255 / 2 + 0.0005 + 1e-9,
      )
    }
  })
  it('a font with nothing redrawn is a short link', () => {
    expect(encode(STARTER, 'HELLO').length).toBeLessThan(80)
  })
  it('turns away anything malformed or out of range', () => {
    const good = encode(font, 'X')
    expect(decode(good.slice(0, -3))).toBeNull()
    expect(decode(good + 'AA')).toBeNull()
    expect(decode('!!!!!!!!')).toBeNull()
    // a colour past the palette
    const bin = atob(good.replace(/-/g, '+').replace(/_/g, '/'))
    const bad = bin.slice(0, 8) + String.fromCharCode(INKS.length) + bin.slice(9)
    expect(decode(btoa(bad).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''))).toBeNull()
  })
  it('every preset is a style the sliders can hold', () => {
    for (const p of PRESETS) {
      const s = { ...DEFAULT_STYLE, ...p.style }
      for (const k of Object.keys(RANGES) as (keyof typeof RANGES)[]) {
        expect(s[k], `${p.name} ${k}`).toBeGreaterThanOrEqual(RANGES[k][0])
        expect(s[k], `${p.name} ${k}`).toBeLessThanOrEqual(RANGES[k][1])
      }
    }
    expect(CHARSET.length).toBeGreaterThan(40)
  })
})

describe('type saves', () => {
  it('round-trips the font in hand and the kept ones', () => {
    const s = { current: encode(STARTER, 'A'), fonts: [encode(STARTER, 'B'), encode(STARTER, 'C')] }
    expect(readSaved(JSON.stringify(s))).toEqual(s)
  })
  it('a broken store loses only what is bad', () => {
    expect(readSaved('{')).toEqual(EMPTY)
    expect(
      readSaved(JSON.stringify({ current: 'bad', fonts: ['x', encode(STARTER, 'D')] })),
    ).toEqual({ current: '', fonts: [encode(STARTER, 'D')] })
  })
})
