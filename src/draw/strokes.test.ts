import { describe, expect, it } from 'vitest'
import {
  frameCount,
  isFreehand,
  layerCount,
  MAX_LAYERS,
  NONE,
  packDrawing,
  RAINBOW,
  readDrawing,
  readStroke,
  RETIRED_TOOLS,
  simplifyDrawing,
  strokeBox,
  TOOLS,
  type Drawing,
  type Stroke,
  type Tool,
} from './strokes'

/**
 * The format every picture anybody has ever made is saved in.
 *
 * ⚠️ THE ONE THAT MATTERS MOST IS THE TOOL ORDER. A packed stroke stores its tool as an INDEX
 * into TOOLS, so moving or removing an entry silently repaints every drawing anyone has saved —
 * a brush stroke becomes an eraser and the picture is gone with no error to explain it. That is
 * why RETIRED_TOOLS exists rather than deletion, and it is the reason the list below is written
 * out by hand: a test that derived the order from TOOLS would agree with any reordering.
 */

const stroke = (over: Partial<Stroke> = {}): Stroke => ({
  t: 'brush',
  c: '#4a7c3f',
  a: 1,
  w: 0.05,
  p: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6],
  ...over,
})

const drawing = (over: Partial<Drawing> = {}): Drawing => ({
  v: 1,
  name: 'a picture',
  ratio: 1.5,
  bg: null,
  strokes: [stroke()],
  ...over,
})

const round = (d: Drawing) => readDrawing(packDrawing(d))

describe('the tool list is append only', () => {
  /**
   * ⚠️ WRITTEN OUT BY HAND ON PURPOSE. Deriving this from TOOLS would make it agree with
   * whatever TOOLS happens to say, which is precisely the change it exists to catch. If a new
   * tool is added it goes on the END and this list gets one more line; if this test fails any
   * other way, every saved drawing is about to repaint wrong.
   */
  it('and these are its indices, for as long as anybody has a saved drawing', () => {
    expect(TOOLS.map(([t]) => t)).toEqual([
      'brush',
      'eraser',
      'line',
      'rect',
      'ellipse',
      'fill',
      'spray',
      'ember',
      'vine',
      'comet',
      'marker',
      'nib',
      'pencil',
      'star',
      'arrow',
      'crayon',
      'neon',
      'triangle',
      'text',
    ])
  })

  it('and a retired tool is still in it, still drawable, just not offered', () => {
    for (const t of RETIRED_TOOLS) {
      expect(
        TOOLS.some(([id]) => id === t),
        `${t} was deleted rather than retired`,
      ).toBe(true)
      const back = round(drawing({ strokes: [stroke({ t })] }))
      expect(back!.strokes[0].t).toBe(t)
    }
  })

  it('and every tool survives being saved and opened', () => {
    for (const [t] of TOOLS) {
      const one = stroke({ t, x: t === 'text' ? 'hello' : undefined })
      const back = round(drawing({ strokes: [one] }))
      expect(back!.strokes[0].t, `${t} came back as something else`).toBe(t)
    }
  })

  it('and freehand is a question about a tool, not a list that drifted', () => {
    expect(isFreehand('brush')).toBe(true)
    expect(isFreehand('eraser')).toBe(true)
    expect(isFreehand('rect')).toBe(false)
    expect(isFreehand('text')).toBe(false)
  })
})

describe('a drawing comes back the way it went in', () => {
  it('with its name, its paper and its background', () => {
    const d = drawing({ name: 'Clawbert', ratio: 0.75, bg: '#112233' })
    const back = round(d)!
    expect(back.name).toBe('Clawbert')
    expect(back.ratio).toBeCloseTo(0.75, 3)
    expect(back.bg).toBe('#112233')
  })

  it('and no background stays no background', () => {
    expect(round(drawing({ bg: null }))!.bg).toBeNull()
  })

  it('and its points, to the precision the format keeps', () => {
    const p = [0.1234, 0.5678, 0.9, 0.0123, 0.5, 0.5]
    const back = round(drawing({ strokes: [stroke({ p })] }))!
    back.strokes[0].p.forEach((n, i) => expect(n).toBeCloseTo(p[i], 2))
  })

  it('and colour, alpha and width', () => {
    const one = stroke({ c: '#ff0088', a: 0.42, w: 0.123 })
    const back = round(drawing({ strokes: [one] }))!.strokes[0]
    expect(back.c).toBe('#ff0088')
    expect(back.a).toBeCloseTo(0.42, 2)
    expect(back.w).toBeCloseTo(0.123, 3)
  })

  /* ⚠️ two colours that are not colours, and both have to survive as themselves */
  it('and the two colours that are not hex', () => {
    expect(round(drawing({ strokes: [stroke({ c: NONE })] }))!.strokes[0].c).toBe(NONE)
    expect(round(drawing({ strokes: [stroke({ c: RAINBOW })] }))!.strokes[0].c).toBe(RAINBOW)
  })

  it('and symmetry and echo, which are numbers on a stroke rather than copies of it', () => {
    const one = stroke({ k: 6, e: 3 })
    const back = round(drawing({ strokes: [one] }))!.strokes[0]
    expect(back.k).toBe(6)
    expect(back.e).toBe(3)
  })

  it('and the words on a text stroke', () => {
    const one = stroke({ t: 'text', x: 'happy birthday', p: [0.1, 0.5, 0.9, 0.5] })
    expect(round(drawing({ strokes: [one] }))!.strokes[0].x).toBe('happy birthday')
  })

  /**
   * ⚠️ `id` EXISTS SO DRAWING TOGETHER CAN TAKE A STROKE BACK, AND MUST NOT REACH A FILE.
   * That is by construction rather than by remembering: packDrawing lists the fields it writes
   * and readStroke lists the ones it reads, so a property neither mentions cannot travel.
   */
  it('but the running id it carried does not travel to disk', () => {
    const back = round(drawing({ strokes: [stroke({ id: 'mine-42' })] }))!
    expect(back.strokes[0].id).toBeUndefined()
  })
})

describe('layers and frames', () => {
  /**
   * ⚠️ NAMED LAYERS COUNT EVEN WHEN THERE IS ONLY ONE, and this is the bug the comment on
   * `layered` records: the check asked whether any stroke had a truthy `l`, and layer ZERO is
   * not truthy — so a one-layer drawing called `body` packed to a flat file with its names
   * dropped, which in the minions module is the difference between a creature that breathes
   * and one the rig cannot read.
   */
  it('a single named layer survives the round trip', () => {
    const d = drawing({ layers: ['body'], strokes: [stroke({ l: 0 })] })
    const back = round(d)!
    expect(back.layers).toEqual(['body'])
  })

  it('and three names with everything drawn on the first', () => {
    const d = drawing({ layers: ['body', 'wing', 'tail'], strokes: [stroke({ l: 0 })] })
    expect(round(d)!.layers).toEqual(['body', 'wing', 'tail'])
  })

  it('and which layer each stroke sits on', () => {
    const d = drawing({
      layers: ['a', 'b', 'c'],
      strokes: [stroke({ l: 0 }), stroke({ l: 2 }), stroke({ l: 1 })],
    })
    expect(round(d)!.strokes.map((k) => k.l ?? 0)).toEqual([0, 2, 1])
  })

  /**
   * ⚠️ -1 AND NOT 0 ON THE WIRE, because "on every frame" has to survive and 0 is a real
   * frame. A background drawn once and animated over is exactly a stroke with no frame.
   */
  it('and a stroke that belongs to every frame stays on every frame', () => {
    const d = drawing({ fps: 8, strokes: [stroke({ f: 0 }), stroke({}), stroke({ f: 2 })] })
    const back = round(d)!
    expect(back.strokes[0].f).toBe(0)
    expect(back.strokes[1].f).toBeUndefined()
    expect(back.strokes[2].f).toBe(2)
  })

  it('and how many frames there are is the highest one used', () => {
    expect(frameCount(drawing({ strokes: [stroke({ f: 0 }), stroke({ f: 3 })] }))).toBe(4)
    expect(frameCount(drawing())).toBe(0)
  })

  it('and how many layers is the same question', () => {
    expect(layerCount(drawing({ strokes: [stroke({ l: 0 }), stroke({ l: 4 })] }))).toBe(5)
  })

  it('and a flat drawing still writes the smaller format it always wrote', () => {
    expect(packDrawing(drawing()).v).toBe(4)
    expect(packDrawing(drawing({ layers: ['body'] })).v).toBe(5)
  })
})

describe('the door is shut to junk', () => {
  it('and nothing that is not a drawing gets through', () => {
    expect(readDrawing(null)).toBeNull()
    expect(readDrawing('a drawing')).toBeNull()
    expect(readDrawing(7)).toBeNull()
    expect(readDrawing({ v: 1 })).toBeNull()
    expect(readDrawing({ v: 1, strokes: 'lots' })).toBeNull()
  })

  it('and a stroke with no points is not a stroke', () => {
    expect(readStroke({ t: 'brush', c: '#fff', a: 1, w: 0.1, p: [] })).toBeNull()
    expect(readStroke(null)).toBeNull()
    expect(readStroke({})).toBeNull()
  })

  it('and a tool nobody has heard of does not become one that exists', () => {
    const back = readDrawing({
      v: 1,
      name: 'x',
      ratio: 1,
      bg: null,
      strokes: [{ ...stroke(), t: 'chainsaw' as Tool }],
    })
    /* either refused outright or fallen back — what it must NOT do is keep 'chainsaw' */
    if (back?.strokes.length) expect(TOOLS.some(([t]) => t === back.strokes[0].t)).toBe(true)
  })

  it('and more layers than a drawing may have are cut back', () => {
    const many = Array.from({ length: MAX_LAYERS + 20 }, (_, i) => `layer ${i}`)
    const back = round(drawing({ layers: many, strokes: [stroke({ l: 0 })] }))!
    expect(back.layers!.length).toBeLessThanOrEqual(MAX_LAYERS)
  })

  it('and a wild page shape is pulled back to something drawable', () => {
    for (const ratio of [0, -4, 1e9, Number.NaN]) {
      const back = readDrawing({ ...drawing(), ratio })
      if (back) {
        expect(back.ratio).toBeGreaterThan(0)
        expect(Number.isFinite(back.ratio)).toBe(true)
      }
    }
  })

  it('and a packed drawing reads back the same as the plain one it came from', () => {
    const d = drawing({ layers: ['body'], fps: 6, strokes: [stroke({ l: 0, f: 1 })] })
    const viaPacked = readDrawing(packDrawing(d))!
    const viaPlain = readDrawing(d)!
    expect(viaPacked.strokes[0].t).toBe(viaPlain.strokes[0].t)
    expect(viaPacked.layers).toEqual(viaPlain.layers)
    expect(viaPacked.strokes[0].f).toBe(viaPlain.strokes[0].f)
  })
})

describe('the box a stroke fills', () => {
  /**
   * ⚠️ IT COMES BACK IN FRACTIONS, NOT PIXELS, and `w`/`h` are only there to work out
   * how far the stroke's own thickness pushes the box out — a fat line on a small canvas
   * covers proportionally more of it. Worth writing down because the signature reads like a
   * pixel box and the first version of this test confidently asserted 80.
   */
  it('covers the points it was drawn through, in fractions of the page', () => {
    const b = strokeBox(stroke({ p: [0.2, 0.3, 0.8, 0.7], w: 0 }), 100, 100)
    expect(b.x0).toBeLessThanOrEqual(0.2)
    expect(b.x1).toBeGreaterThanOrEqual(0.8)
    expect(b.y0).toBeLessThanOrEqual(0.3)
    expect(b.y1).toBeGreaterThanOrEqual(0.7)
  })

  it('and a thicker line fills a bigger one', () => {
    const thin = strokeBox(stroke({ p: [0.5, 0.5, 0.5, 0.5], w: 0.01 }), 100, 100)
    const fat = strokeBox(stroke({ p: [0.5, 0.5, 0.5, 0.5], w: 0.4 }), 100, 100)
    expect(fat.x1 - fat.x0).toBeGreaterThan(thin.x1 - thin.x0)
  })

  /* the same stroke on a bigger canvas is padded LESS, because the pad is the line's width */
  it('and the same stroke is padded less on a bigger page', () => {
    const small = strokeBox(stroke({ w: 0.05 }), 100, 100)
    const big = strokeBox(stroke({ w: 0.05 }), 400, 400)
    expect(big.x1 - big.x0).toBeLessThan(small.x1 - small.x0)
  })
})

describe('simplifying a drawing', () => {
  /** a genuine zig-zag: a straight line has nothing to throw away and collapses at any tolerance */
  const wobbly = () =>
    drawing({
      strokes: [
        stroke({
          p: Array.from({ length: 600 }, (_, i) =>
            i % 2 === 0 ? i / 600 : 0.5 + Math.sin(i) * 0.08,
          ),
        }),
      ],
    })

  it('throws points away when it is allowed to', () => {
    const before = wobbly().strokes[0].p.length
    const after = simplifyDrawing(wobbly(), 0.05).strokes[0].p.length
    expect(after).toBeLessThan(before)
    expect(after).toBeGreaterThanOrEqual(4)
  })

  it('but keeps the ends where they were, so the picture does not move', () => {
    const p = wobbly().strokes[0].p
    const after = simplifyDrawing(wobbly(), 0.05).strokes[0].p
    expect(after[0]).toBeCloseTo(p[0], 6)
    expect(after[1]).toBeCloseTo(p[1], 6)
    expect(after[after.length - 2]).toBeCloseTo(p[p.length - 2], 6)
    expect(after[after.length - 1]).toBeCloseTo(p[p.length - 1], 6)
  })

  it('and asked for nothing, throws nothing away', () => {
    const d = wobbly()
    expect(simplifyDrawing(d, 0).strokes[0].p.length).toBe(d.strokes[0].p.length)
  })

  /* a line that is already straight has no detail to lose, whatever it is asked */
  it('and a straight line is two points however gently you ask', () => {
    const line = drawing({
      strokes: [
        stroke({ p: Array.from({ length: 200 }, (_, i) => (i % 2 === 0 ? i / 200 : 0.5)) }),
      ],
    })
    expect(simplifyDrawing(line, 0).strokes[0].p.length).toBe(4)
  })
})
