import { describe, expect, it } from 'vitest'
import { castShapeOf, shapeOf } from './castShape'
import { inPatch, patchesOf } from './cast'
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
    const fat = { reach: 1, spread: 1.6, bend: 0 }
    for (const k of ['bloom', 'mark', 'wave', 'bolt'] as const) {
      expect(wide(k, fat), `${k} did not widen`).toBeGreaterThan(wide(k, null))
    }
  })

  it('and a further drawing throws the aimed ones further', () => {
    const far = { reach: 1.7, spread: 1, bend: 0 }
    for (const k of ['mark', 'bolt'] as const) {
      expect(out(k, far), `${k} did not reach further`).toBeGreaterThan(out(k, null))
    }
  })

  /** ⚠️ a swell grows where you stand, so there is nowhere further out for it to land */
  it('and leaves the swell where it stands, because that is what a swell is', () => {
    const far = { reach: 1.9, spread: 1, bend: 0 }
    expect(out('bloom', far)).toBeCloseTo(out('bloom', null), 6)
  })

  /**
   * ⚠️ AND A FATTER FISSURE IS STILL CROSSABLE, because the drawn width goes through the same
   * spacing that keeps a creature's worth of floor between the steps. It was a wall at every
   * size once, for everybody, and a drawn footprint must not put it back.
   */
  it('and a fissure drawn fat still leaves room to walk through it', () => {
    for (const spread of [1, 1.4, 1 / 0.55]) {
      const steps = patchesOf('wave', FROM, AIM, 0.6, 1, 0, { reach: 1, spread, bend: 0 })
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
        out('wave', { reach, spread: 1 / reach, bend: 0 }),
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

/**
 * Which way the thing you drew travels.
 *
 * ⚠️ THE SECOND HALF, AND THE ONE THE FIRST HALF'S NOTE CALLED "MUCH HARDER". Not because the
 * geometry is hard — because a cast that MOVES has to move identically on every machine, and
 * cast.ts opens by saying nothing new goes over the wire. A path derived from the drawing keeps
 * that; a path that were sent would not.
 */
describe('which way a drawn cast travels', () => {
  /** a spell layer that is an actual drawn gesture rather than a rectangle of ink */
  const gesture = (p: number[], ratio = 1): Drawing => ({
    v: 1,
    name: 'Test',
    ratio,
    bg: null,
    layers: ['body', 'spell'],
    strokes: [stroke([0.4, 0.4, 0.6, 0.6], 0), { ...stroke(p, 1) }],
  })

  /** an arc bowing `bow` to one side of a chord of `wide`, starting at (x, y) */
  const arc = (bow: number, wide = 0.7, x = 0.15, y = 0.5, n = 16) => {
    const p: number[] = []
    for (let i = 0; i <= n; i++) {
      const u = i / n
      p.push(x + u * wide, y + bow * Math.sin(u * Math.PI))
    }
    return p
  }

  it('says nothing for a line drawn straight', () => {
    expect(castShapeOf(gesture(arc(0)))!.bend).toBe(0)
  })

  /** ⚠️ and a two-point stroke is a straight line however it is stored — every older fixture */
  it('and nothing for a shape with no drawn path in it', () => {
    expect(castShapeOf(creature([body(), ['spell', [0.6, 0.4, 0.9, 0.6]]]))!.bend).toBe(0)
  })

  /**
   * ⚠️ AND NOTHING FOR A LOOP, WHICH IS THE OBVIOUS THING TO DRAW. A closed shape comes back to
   * where it started, so its chord is nearly nothing and the side it "bows out on" is decided by
   * whichever pixel happened to be last — noise, dressed up as a decision.
   */
  it('and nothing for a loop, which has no way it is going', () => {
    const ring: number[] = []
    for (let i = 0; i <= 24; i++) {
      const a = (i / 24) * Math.PI * 2
      ring.push(0.5 + Math.cos(a) * 0.2, 0.5 + Math.sin(a) * 0.2)
    }
    expect(castShapeOf(gesture(ring))!.bend).toBe(0)
  })

  it('and curves the way it was drawn, either way', () => {
    const down = castShapeOf(gesture(arc(0.2)))!.bend
    const up = castShapeOf(gesture(arc(-0.2)))!.bend
    expect(down).toBeGreaterThan(0)
    expect(up).toBeLessThan(0)
    expect(up).toBeCloseTo(-down, 10)
  })

  it('and harder for a tighter curve', () => {
    expect(castShapeOf(gesture(arc(0.3)))!.bend).toBeGreaterThan(
      castShapeOf(gesture(arc(0.1)))!.bend,
    )
  })

  /** ⚠️ scale-free by construction, which is the rule the reach dial had to be taught */
  it('and the same curve drawn bigger is the same curve', () => {
    const small = castShapeOf(gesture(arc(0.06, 0.21, 0.1, 0.2)))!.bend
    const big = castShapeOf(gesture(arc(0.24, 0.84, 0.05, 0.5)))!.bend
    expect(big).toBeCloseTo(small, 10)
  })

  /** ⚠️ and no drawing turns a cast round in circles */
  it('and no drawing can curve one without limit', () => {
    for (const bow of [0.5, 2, 40]) {
      const b = castShapeOf(gesture(arc(bow)))!.bend
      expect(Math.abs(b)).toBeLessThanOrEqual(0.2)
    }
  })
})

describe('what a curve does to the casts', () => {
  const FROM = { x: 0.5, y: 0.5 }
  const AIM = { x: 1, y: 0 }
  /** an ordinary creature's width, the thing that has to fit between two steps */
  const MY_WIDE = PARK_TALL * 0.5
  const shape = (bend: number) => ({ reach: 1, spread: 1, bend })
  const last = (k: 'bolt' | 'wave', bend: number, t = 0.9) => {
    const ps = patchesOf(k, FROM, AIM, t, 1, 0, shape(bend))
    return ps[ps.length - 1].at
  }
  /** how far from the caster, and how far FORWARD, in pet-heights */
  const gone = (at: { x: number; y: number }) => ({
    out: Math.hypot((at.x - FROM.x) * WORLD_WIDE, (at.y - FROM.y) * PARK.down) / PARK_TALL,
    ahead: ((at.x - FROM.x) * WORLD_WIDE) / PARK_TALL,
  })

  /**
   * ⚠️ THE TWO THAT DO NOT TRAVEL DO NOT CURVE, which is the same rule the reach dial follows
   * about the swell. A bend is a fact about a path; a swell has none, and a mark is placed
   * rather than thrown — curving it would cost the one sentence anybody dodges it by.
   */
  it('nothing at all to the two that stay where they are put', () => {
    for (const k of ['bloom', 'mark'] as const) {
      const straight = JSON.stringify(patchesOf(k, FROM, AIM, 0.9, 1, 0, shape(0)))
      for (const bend of [-0.2, -0.05, 0.05, 0.2])
        expect(JSON.stringify(patchesOf(k, FROM, AIM, 0.9, 1, 0, shape(bend))), `${k} moved`).toBe(
          straight,
        )
    }
  })

  it('and takes the two that travel off the line, either way', () => {
    for (const k of ['bolt', 'wave'] as const) {
      expect(last(k, 0).y, `${k} did not start on the line`).toBeCloseTo(FROM.y, 10)
      expect(last(k, 0.15).y, `${k} did not curve`).toBeGreaterThan(FROM.y)
      expect(last(k, -0.15).y, `${k} did not curve back`).toBeLessThan(FROM.y)
    }
  })

  /**
   * ⚠️ THE COST, AND IT IS THE SAME COST A CURVE HAS IN THE WORLD. arcFrom is given the
   * ARCLENGTH, so a curved cast covers exactly as much ground as a straight one and gets less
   * far from you — forward progress is sin(θ)/bend rather than the distance travelled. Nothing
   * was invented to charge for a curve, which is what stops this being the reach dial again:
   * that one was a free win precisely because nothing was paying for it.
   */
  it('and a curved one gets less far, because it went the same distance round a bend', () => {
    for (const k of ['bolt', 'wave'] as const) {
      const flat = gone(last(k, 0))
      for (const bend of [0.08, 0.15, 0.2]) {
        const bent = gone(last(k, bend))
        expect(bent.ahead, `${k} at ${bend} lost no ground`).toBeLessThan(flat.ahead)
        /* ⚠️ and never further from the caster than a straight one, either — a chord cannot be
           longer than the arc it is drawn under, and if this ever fails the cost is a gain */
        expect(bent.out, `${k} at ${bend} travelled further overall`).toBeLessThanOrEqual(
          flat.out + 1e-9,
        )
      }
    }
  })

  /**
   * ⚠️ AND IT STILL HAS TO BE CROSSABLE, which is the one thing about the fissure that has gone
   * wrong before and the reason cast.test.ts carries a note about nearly shipping it shut. The
   * old sweep walks the x axis at a fixed y, which is only the fissure's own line while it is
   * straight — a curved one would stroll out from under the check and report floor everywhere.
   *
   * ⚠️ SO IT ASKS inPatch, BETWEEN EACH PAIR OF STEPS, along the line joining their centres:
   * "is there anywhere on the way through that a creature of this width can be". That is the
   * question somebody crossing is asking, and it shares no arithmetic with the spacing sum that
   * places them.
   */
  const crossable = (bend: number, spread: number, scale: number) => {
    const steps = patchesOf('wave', FROM, AIM, 0.6, scale, 0, { reach: 1, spread, bend })
    for (let i = 1; i < steps.length; i++) {
      const a = steps[i - 1].at
      const b = steps[i].at
      let room = false
      for (let u = 0; u <= 1 && !room; u += 1 / 400) {
        const at = { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u }
        /* ⚠️ THE CROSSER IS A PLAYER, and inPatch's fourth argument is the TARGET's scale —
           not the caster's. Passed `scale` here it asked whether a boss-sized creature could
           cross a boss's own fissure, which is a harder question nobody in the game is asking,
           and it duly failed. The thing that has to fit through is a person. */
        if (!steps.some((p) => inPatch(at, MY_WIDE, p))) room = true
      }
      if (!room) return false
    }
    return true
  }

  it('and a curved fissure is still one you can get through', () => {
    for (const bend of [-0.2, -0.1, 0, 0.1, 0.2])
      for (const spread of [1 / 1.9, 1, 1 / 0.55])
        for (const scale of [1, 2.05, 3.05])
          expect(
            crossable(bend, spread, scale),
            `bend ${bend} spread ${spread} scale ${scale}`,
          ).toBe(true)
  })

  /** ⚠️ and the whole pattern still lands where somebody can see it — sideways counts too */
  it('and a curved fissure still lands on the field', () => {
    for (const bend of [-0.2, 0, 0.2])
      for (const scale of [1, 3.05]) {
        const steps = patchesOf('wave', FROM, AIM, 0.6, scale, 0, {
          reach: 1.9,
          spread: 1 / 1.9,
          bend,
        })
        for (const p of steps)
          expect(gone(p.at).out, `bend ${bend} scale ${scale} left the field`).toBeLessThan(9)
      }
  })
})
