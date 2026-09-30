import { describe, expect, it } from 'vitest'
import { castShapeOf, shapeOf } from './castShape'
import { patchesOf } from './cast'
import { PARK_TALL, ASPECT } from './strike'
import { PARK } from './walk'
import { partOf } from '../pets/rig'
import type { Drawing, Stroke } from '../draw/strokes'

/**
 * A cast's footprint, taken from the picture.
 *
 * ⚠️ THE FIRST HALF OF "DRAW YOUR OWN ABILITIES", and the half that costs the wire nothing. A
 * swing's shape has come from a `hit` layer for a long time — that layer's own note says "the
 * whole of 'draw your own attacks' is one layer name" — while the four big casts read a
 * creature's DIALS and never its SHAPE, so every fissure in the game was the same fissure.
 *
 * ⚠️ AND THE TEST THAT MATTERS MOST IS THAT NOTHING CHANGED. Every creature anybody has already
 * drawn has no spell layer, and has to throw exactly what it threw yesterday — not "the same
 * numbers by coincidence", the same code path.
 */

const WORLD_WIDE = PARK.across * ASPECT

const stroke = (p: number[], l: number): Stroke => ({
  t: 'brush',
  c: '#4a7c3f',
  a: 1,
  w: 0.04,
  p,
  l,
})

/** a creature of named layers; `box` gives each layer a rectangle of ink */
const creature = (parts: Array<[string, number[]]>): Drawing => ({
  v: 1,
  name: 'Test',
  ratio: 1,
  bg: null,
  layers: parts.map(([name]) => name),
  strokes: parts.map(([, box], i) => stroke(box, i)),
})

const body = (): [string, number[]] => ['body', [0.4, 0.4, 0.6, 0.6]]

describe('what the drawing says about where a cast lands', () => {
  it('says nothing when nothing was drawn for it', () => {
    expect(castShapeOf(creature([body()]))).toBeNull()
    expect(castShapeOf(creature([body(), ['leg', [0.45, 0.6, 0.5, 0.7]]]))).toBeNull()
  })

  /**
   * ⚠️ THE WORDS ARE THE INTERFACE, so they have to actually read as the kind. rig.ts warns
   * twice that its word list is matched by SUBSTRING and that order is correctness there — it
   * has been caught by that twice, once turning a fang into a propeller.
   */
  it('and reads the words meant for it', () => {
    for (const word of ['spell', 'magic', 'rune', 'sigil', 'cast']) {
      expect(partOf(word), `"${word}" does not read as a spell`).toBe('spell')
    }
  })

  /** ⚠️ and does not steal a word another kind already owned — `blast` has been a hit for ages */
  it('and leaves the words that were already taken alone', () => {
    for (const word of ['blast', 'hit', 'attack', 'slash', 'swipe', 'strike', 'swing']) {
      expect(partOf(word), `"${word}" stopped being a hit`).toBe('hit')
    }
    expect(partOf('horn')).toBe('horn')
    expect(partOf('wing')).toBe('wing')
  })

  it('and a fatter drawn shape means a wider cast', () => {
    const thin = castShapeOf(creature([body(), ['spell', [0.62, 0.48, 0.9, 0.52]]]))!
    const fat = castShapeOf(creature([body(), ['spell', [0.62, 0.25, 0.9, 0.75]]]))!
    expect(fat.spread).toBeGreaterThan(thin.spread)
  })

  /**
   * ⚠️ ITS LENGTH, NOT ITS DISTANCE, AND THAT IS A CORRECTION. Reach used to come from how far
   * the shape sat from the body, so "lands further away" could only be drawn by drawing further
   * away — and a creature filling its page has nowhere to do that. Reported at once: "I can't
   * really draw away from my guy on the same canvas space as I drew him in."
   */
  it('and a longer drawn shape means a cast that lands further out', () => {
    const stub = castShapeOf(creature([body(), ['spell', [0.62, 0.46, 0.7, 0.54]]]))!
    const streak = castShapeOf(creature([body(), ['spell', [0.62, 0.46, 1.0, 0.54]]]))!
    expect(streak.reach).toBeGreaterThan(stub.reach)
  })

  /**
   * ⚠️ AND IT CAN BE DRAWN ANYWHERE, which is the whole point of the change. The same shape on
   * top of the creature and off to one side has to mean the same thing, or the tool is still
   * telling somebody where to draw.
   */
  it('and where it sits on the page makes no difference', () => {
    const over = castShapeOf(creature([body(), ['spell', [0.3, 0.46, 0.68, 0.54]]]))!
    const aside = castShapeOf(creature([body(), ['spell', [0.6, 0.46, 0.98, 0.54]]]))!
    expect(aside.reach).toBeCloseTo(over.reach, 6)
    expect(aside.spread).toBeCloseTo(over.spread, 6)
  })

  /**
   * ⚠️ MEASURED AGAINST THE BODY, NOT THE PAGE. The same creature drawn small in a corner and
   * drawn filling the sheet is the same creature, and the park draws both at the same height —
   * so a footprint measured against the canvas would mean how zoomed out somebody happened to be
   * decided how far their fissure reached.
   */
  it('and the same creature drawn bigger on the page is the same creature', () => {
    const small = creature([body(), ['spell', [0.62, 0.45, 0.72, 0.55]]])
    const grown = creature([
      ['body', [0.2, 0.2, 0.8, 0.8]],
      ['spell', [0.2, 0.35, 0.5, 0.65]],
    ])
    const a = castShapeOf(small)!
    const b = castShapeOf(grown)!
    expect(b.spread).toBeCloseTo(a.spread, 10)
    expect(b.reach).toBeCloseTo(a.reach, 10)
  })

  /**
   * ⚠️ THE ONE THAT SAYS IT COSTS SOMETHING, and it is the whole point of the dial. Reach and
   * width used to be two knobs that both turned up with size, so the best drawing was simply
   * the biggest one and no shape you could draw cost you anything. Reported in those words:
   * "im not liking that reach balancing, it should cost something."
   *
   * ⚠️ MULTIPLIED, NOT ADDED, because a cast that reaches twice as far should cover half the
   * ground rather than a fixed amount less. Checked across the whole dial and a little past
   * both ends of it, so the clamps cannot quietly buy something back.
   */
  it('and never buys reach and width at once', () => {
    for (const [w, h] of [
      [0.1, 0.1],
      [0.2, 0.1],
      [0.4, 0.1],
      [0.9, 0.1],
      [0.05, 0.4],
      [0.9, 0.001],
      [0.3, 0.29],
      [80, 80],
    ] as const) {
      const out = castShapeOf(creature([body(), ['spell', [0.05, 0.05, 0.05 + w, 0.05 + h]]]))!
      expect(out.reach * out.spread, `${w}x${h} came out to more than one cast`).toBeCloseTo(1, 10)
    }
  })

  /**
   * ⚠️ AND DRAWING IT BIGGER IS NOT DRAWING IT BETTER. The same proportions at four sizes is
   * the same cast, which is the rule the REST of this project has always followed — a creature
   * is cropped to its own ink and drawn at one fixed height, so how big you drew it is thrown
   * away on purpose. The cast was the one place that was not true, and that is exactly where
   * the free win was.
   */
  it('and the same shape drawn bigger is the same cast', () => {
    const at = (k: number) =>
      castShapeOf(creature([body(), ['spell', [0.1, 0.1, 0.1 + 0.3 * k, 0.1 + 0.1 * k]]]))!
    const one = at(1)
    for (const k of [0.25, 0.5, 2, 3]) {
      expect(at(k).reach, `${k}x as big changed the reach`).toBeCloseTo(one.reach, 10)
      expect(at(k).spread, `${k}x as big changed the width`).toBeCloseTo(one.spread, 10)
    }
  })

  /**
   * ⚠️ A BAND, FOR THE REASON temperOf HAS ONE: "some are impossible and nobody can tell which
   * from looking". This arrives over an unauthenticated relay, so the worst drawing anybody can
   * send still has to be a move you can stand next to.
   */
  it('and no drawing can make a cast without limit', () => {
    const daft = creature([
      ['body', [0.499, 0.499, 0.5, 0.5]],
      ['spell', [-40, -40, 40, 40]],
    ])
    const out = castShapeOf(daft)!
    expect(out.spread).toBeLessThanOrEqual(1 / 0.55 + 1e-9)
    expect(out.reach).toBeLessThanOrEqual(1.9)
    expect(out.spread).toBeGreaterThan(0)
    expect(out.reach).toBeGreaterThan(0)
  })
})

describe('what it does to the casts', () => {
  const FROM = { x: 0.5, y: 0.5 }
  const AIM = { x: 1, y: 0 }
  const wide = (k: 'bloom' | 'mark' | 'wave' | 'bolt', shape: ReturnType<typeof castShapeOf>) =>
    Math.max(...patchesOf(k, FROM, AIM, 0.6, 1, 0, shape).map((p) => p.r))
  const out = (k: 'bloom' | 'mark' | 'wave' | 'bolt', shape: ReturnType<typeof castShapeOf>) => {
    const ps = patchesOf(k, FROM, AIM, 0.6, 1, 0, shape)
    return ((ps[ps.length - 1].at.x - FROM.x) * WORLD_WIDE) / PARK_TALL
  }

  /**
   * ⚠️ THIS IS THE ONE THAT MATTERS. Nobody has a spell layer, so nobody's boss may change —
   * and null takes the same path rather than multiplying by a 1 that happens to cancel.
   */
  it('nothing at all, for a creature that never drew one', () => {
    for (const k of ['bloom', 'mark', 'wave', 'bolt'] as const) {
      const before = patchesOf(k, FROM, AIM, 0.6, 1, 0)
      const after = patchesOf(k, FROM, AIM, 0.6, 1, 0, null)
      expect(JSON.stringify(after), `${k} moved`).toBe(JSON.stringify(before))
    }
  })

  it('and a wider drawing makes every cast wider', () => {
    const fat = { reach: 1, spread: 1.6 }
    for (const k of ['bloom', 'mark', 'wave', 'bolt'] as const) {
      expect(wide(k, fat), `${k} did not widen`).toBeGreaterThan(wide(k, null))
    }
  })

  it('and a further drawing throws the aimed ones further', () => {
    const far = { reach: 1.7, spread: 1 }
    for (const k of ['mark', 'bolt'] as const) {
      expect(out(k, far), `${k} did not reach further`).toBeGreaterThan(out(k, null))
    }
  })

  /** ⚠️ a swell grows where you stand, so there is nowhere further out for it to land */
  it('and leaves the swell where it stands, because that is what a swell is', () => {
    const far = { reach: 1.9, spread: 1 }
    expect(out('bloom', far)).toBeCloseTo(out('bloom', null), 6)
  })

  /**
   * ⚠️ AND A FATTER FISSURE IS STILL CROSSABLE, because the drawn width goes through the same
   * spacing that keeps a creature's worth of floor between the steps. It was a wall at every
   * size once, for everybody, and a drawn footprint must not put it back.
   */
  it('and a fissure drawn fat still leaves room to walk through it', () => {
    for (const spread of [1, 1.4, 1 / 0.55]) {
      const steps = patchesOf('wave', FROM, AIM, 0.6, 1, 0, { reach: 1, spread })
      for (let i = 1; i < steps.length; i++) {
        const apart = Math.hypot(
          (steps[i].at.x - steps[i - 1].at.x) * WORLD_WIDE,
          (steps[i].at.y - steps[i - 1].at.y) * PARK.down,
        )
        const floor = apart - steps[i].r - steps[i - 1].r
        expect(floor, `spread ${spread} closed the gaps`).toBeGreaterThan(0.4 * PARK_TALL)
      }
    }
  })

  /** ⚠️ and still on the field, which is the budget the step count pays for */
  it('and a fissure drawn far still lands where it can be seen', () => {
    for (const reach of [1, 1.5, 1.9]) {
      expect(
        out('wave', { reach, spread: 1 / reach }),
        `reach ${reach} left the field`,
      ).toBeLessThan(9)
    }
  })

  /** ⚠️ same drawing, same answer — both ends work it out rather than being told */
  it('and the cache gives the same answer as working it out', () => {
    const art = creature([body(), ['spell', [0.7, 0.4, 0.85, 0.6]]])
    expect(shapeOf(art)).toEqual(castShapeOf(art))
    expect(shapeOf(art), 'a second ask changed its mind').toEqual(castShapeOf(art))
  })
})
