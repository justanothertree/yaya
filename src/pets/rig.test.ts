import { describe, expect, it } from 'vitest'
import {
  boxOf,
  inFrontOfOrder,
  inkBox,
  partOf,
  PART_DOES,
  PART_PARENT,
  PART_WORDS,
  petRatio,
  rigOf,
  type PartKind,
} from './rig'
import type { Drawing, Stroke } from '../draw/strokes'

/**
 * The reader that turns a drawing into a skeleton.
 *
 * ⚠️ A LAYER NAME IS AN INSTRUCTION HERE, which is the module's whole bet: you called a layer
 * `wing`, so the thing flaps. That makes partOf the most load-bearing string comparison in the
 * project — every creature anybody has drawn is animated by it, and a change to the matching
 * silently re-animates all of them. There is no error to catch: a wing that stops being a wing
 * just becomes a body and stops moving.
 *
 * ⚠️ AND inkBox IS BORROWED BY THE MAP MAKER. cropToInk builds every stamp out of it, so a
 * change here moves scenery in a room that has nothing to do with pets.
 */

const stroke = (over: Partial<Stroke> = {}): Stroke => ({
  t: 'brush',
  c: '#4a7c3f',
  a: 1,
  w: 0.02,
  p: [0.4, 0.4, 0.6, 0.6],
  ...over,
})

const drawing = (over: Partial<Drawing> = {}): Drawing => ({
  v: 1,
  name: 'a creature',
  ratio: 1,
  bg: null,
  strokes: [stroke()],
  ...over,
})

describe('reading a part out of a layer name', () => {
  it('knows the word wherever it sits in the name', () => {
    expect(partOf('wing')).toBe('wing')
    expect(partOf('left wing')).toBe('wing')
    expect(partOf('WING')).toBe('wing')
    expect(partOf('big wings 2')).toBe('wing')
  })

  /**
   * ⚠️ EVERY WORD THE ROOM OFFERS HAS TO BE A WORD THIS UNDERSTANDS. PART_WORDS is what the
   * paint room suggests when somebody names a layer; a word on that list that partOf did not
   * recognise would be the room teaching people an instruction the reader ignores.
   */
  it('and every word the paint room suggests actually does something', () => {
    for (const w of PART_WORDS) {
      expect(partOf(w), `the room offers "${w}" and the rig makes nothing of it`).not.toBe('body')
    }
  })

  it('and anything else is just body', () => {
    expect(partOf('')).toBe('body')
    expect(partOf(undefined)).toBe('body')
    expect(partOf('squiggle')).toBe('body')
    expect(partOf('layer 3')).toBe('body')
  })

  it('and every kind it can return has a sentence describing it', () => {
    const kinds = new Set<PartKind>(['body', ...PART_WORDS.map((w) => partOf(w))])
    for (const k of kinds) {
      expect(PART_DOES[k], `${k} has nothing to say for itself`).toBeTruthy()
    }
  })

  /* ⚠️ a parent has to be a real part, or the hierarchy walks off the end of the table */
  it('and every part that hangs off another hangs off one that exists', () => {
    for (const [child, parent] of Object.entries(PART_PARENT)) {
      expect(PART_DOES[parent as PartKind], `${child} hangs off ${parent}`).toBeTruthy()
      expect(parent, `${child} is its own parent`).not.toBe(child)
    }
  })

  it('and nothing hangs off itself through a loop', () => {
    for (const start of Object.keys(PART_PARENT) as PartKind[]) {
      const seen = new Set<PartKind>()
      let at: PartKind | undefined = start
      while (at) {
        expect(seen.has(at), `${start} loops back through ${at}`).toBe(false)
        seen.add(at)
        at = PART_PARENT[at]
      }
    }
  })
})

describe('the box the ink fills', () => {
  it('is the spread of what was drawn, not the whole page', () => {
    const b = inkBox(drawing({ strokes: [stroke({ p: [0.4, 0.4, 0.5, 0.5] })] }), [], false)
    expect(b).toBeTruthy()
    expect(b!.x0).toBeGreaterThan(0.2)
    expect(b!.x1).toBeLessThan(0.8)
  })

  it('and nothing drawn is no box at all', () => {
    expect(inkBox(drawing({ strokes: [] }), [], false)).toBeNull()
  })

  /**
   * ⚠️ `room` IS THE 12% A CREATURE NEEDS TO ANIMATE INSIDE, and cropToInk asks for it to be
   * left off — a rock does not flap, and the headroom would be exactly the empty margin that
   * cropping exists to remove.
   */
  it('and asking for headroom gives a bigger box than not', () => {
    const d = drawing({ strokes: [stroke({ p: [0.4, 0.4, 0.6, 0.6] })] })
    const tight = inkBox(d, [], false)!
    const roomy = inkBox(d, [], true)!
    expect(roomy.x1 - roomy.x0).toBeGreaterThan(tight.x1 - tight.x0)
  })

  it('and a hidden layer is not part of the picture', () => {
    const d = drawing({
      layers: ['body', 'wing'],
      strokes: [
        stroke({ l: 0, p: [0.45, 0.45, 0.55, 0.55] }),
        stroke({ l: 1, p: [0.02, 0.02, 0.06, 0.06] }),
      ],
    })
    const all = inkBox(d, [], false)!
    const without = inkBox(d, [1], false)!
    expect(without.x0).toBeGreaterThan(all.x0)
  })

  it('and boxOf agrees with itself about an empty list', () => {
    expect(boxOf([], 1)).toBeNull()
  })
})

describe('building a skeleton', () => {
  const creature = () =>
    drawing({
      layers: ['body', 'left wing', 'right wing', 'head'],
      strokes: [
        stroke({ l: 0, p: [0.4, 0.4, 0.6, 0.7] }),
        stroke({ l: 1, p: [0.15, 0.35, 0.38, 0.5] }),
        stroke({ l: 2, p: [0.62, 0.35, 0.85, 0.5] }),
        stroke({ l: 3, p: [0.45, 0.15, 0.55, 0.32] }),
      ],
    })

  it('finds one part per layer, named by what it was called', () => {
    const parts = rigOf(creature())
    expect(parts).toHaveLength(4)
    expect(parts.map((p) => p.kind)).toEqual(['body', 'wing', 'wing', 'head'])
  })

  it('and a drawing with nothing on it has no skeleton', () => {
    expect(rigOf(drawing({ strokes: [] }))).toEqual([])
  })

  /**
   * ⚠️ AN UNNAMED DRAWING IS STILL A CREATURE. Most pictures have no layer names at all, and
   * they have to come back as a body that breathes rather than as nothing.
   */
  it('and a drawing with no names at all is one body', () => {
    const parts = rigOf(drawing())
    expect(parts).toHaveLength(1)
    expect(parts[0].kind).toBe('body')
  })

  /**
   * ⚠️ TWO WINGS GIVEN THE SAME ROTATION BOTH SWING THE SAME WAY, which reads as a picture
   * sliding rather than a bird flapping — so a part knows which side of the body it is on.
   */
  it('and a part on the left knows it is on the left', () => {
    const parts = rigOf(creature())
    const wings = parts.filter((p) => p.kind === 'wing')
    expect(wings).toHaveLength(2)
    expect(wings[0].side).not.toBe(wings[1].side)
  })

  it('and its pivot sits inside the part it turns', () => {
    for (const p of rigOf(creature())) {
      expect(p.px, `${p.name} pivot x`).toBeGreaterThanOrEqual(p.box.x0 - 1e-6)
      expect(p.px).toBeLessThanOrEqual(p.box.x1 + 1e-6)
      expect(p.py, `${p.name} pivot y`).toBeGreaterThanOrEqual(p.box.y0 - 1e-6)
      expect(p.py).toBeLessThanOrEqual(p.box.y1 + 1e-6)
    }
  })

  it('and it carries its own strokes rather than looking them up every frame', () => {
    const parts = rigOf(creature())
    expect(parts.reduce((n, p) => n + p.strokes.length, 0)).toBe(4)
    for (const p of parts) expect(p.strokes.length).toBeGreaterThan(0)
  })

  it('and layers come back in the order they were drawn in', () => {
    const layers = rigOf(creature()).map((p) => p.layer)
    expect(layers).toEqual([...layers].sort((a, b) => a - b))
  })
})

describe('warning about what is drawn in front of what', () => {
  /**
   * ⚠️ IT REPORTS A COMPLAINT, NOT AN ORDER, which I had to read the code to find out
   * — my first version of these tests handed it a Part[] and expected a permutation back. It
   * takes the whole drawing, and answers "is anything painted over something it usually sits
   * behind", which is the question the paint room asks on somebody's behalf.
   */
  const stack = (names: string[]) =>
    drawing({
      layers: names,
      strokes: names.map((_, i) => stroke({ l: i, p: [0.3 + i * 0.02, 0.3, 0.5 + i * 0.02, 0.6] })),
    })

  it('says nothing when the order is the usual one', () => {
    /* ascending layer order is back to front, and this is back to front */
    expect(inFrontOfOrder(stack(['tail', 'wing', 'body', 'head', 'eye']))).toEqual([])
  })

  it('and complains when something sits in front of what it belongs behind', () => {
    const out = inFrontOfOrder(stack(['eye', 'tail']))
    expect(out).toHaveLength(1)
    expect(out[0].name).toBe('tail')
    expect(out[0].over).toBe('eye')
  })

  /**
   * ⚠️ THE BODY IS IN THIS, and leaving it out was the bug the function's own comment
   * records: "a wing in front of the body" is the whole complaint it exists for, and filtering
   * the body out answered "no problem" for the one arrangement anybody would want telling about.
   */
  it('and a wing in front of the body is exactly what it is for', () => {
    const out = inFrontOfOrder(stack(['body', 'wing']))
    expect(out).toHaveLength(1)
    expect(out[0].name).toBe('wing')
    expect(out[0].over).toBe('body')
  })

  /**
   * ⚠️ ONE AT A TIME. Four things in the wrong order produce six complaints, and a
   * paragraph of them is a paragraph nobody reads — fix one and the next appears.
   */
  it('and says only one thing however many are wrong', () => {
    expect(inFrontOfOrder(stack(['eye', 'head', 'body', 'wing', 'tail']))).toHaveLength(1)
  })

  it('and has nothing to say about an empty drawing', () => {
    expect(inFrontOfOrder(drawing({ strokes: [] }))).toEqual([])
  })
})

describe('the paper a part is measured on', () => {
  /**
   * ⚠️ IT ONLY MATTERS FOR A STROKE THAT MAKES COPIES OF ITSELF, which is the whole of
   * the bug rigOf's comment records: a part carrying symmetry had its mirrored copies placed by
   * a rotation in the WRONG aspect, so the box missed the ink at both ends while overshooting
   * sideways — measured on a six-fold wing at y 0.152–0.998 against a box saying 0.258–0.842.
   *
   * My first attempt at this compared a plain stroke on square and wide paper and found no
   * difference, and concluded the ratio was ignored. It is not: a plain stroke simply has no
   * copies to place, so there is nothing for the aspect to get wrong.
   */
  const spun = (ratio: number) => boxOf([stroke({ k: 6, p: [0.45, 0.1, 0.55, 0.45] })], ratio)!

  it('changes where a mirrored part lands', () => {
    const square = spun(1)
    const wide = spun(16 / 9)
    const tall = (b: { y0: number; y1: number }) => b.y1 - b.y0
    expect(Math.abs(tall(wide) - tall(square))).toBeGreaterThan(1e-6)
  })

  it('but a stroke with no copies is the same box whatever the paper', () => {
    const plain = (ratio: number) => boxOf([stroke({ p: [0.3, 0.3, 0.7, 0.7] })], ratio)!
    expect(plain(16 / 9)).toEqual(plain(1))
  })

  it('and a nonsense paper shape falls back rather than producing nonsense', () => {
    for (const ratio of [0, -4, 1e9]) {
      const b = boxOf([stroke({ k: 4 })], ratio)!
      expect(Number.isFinite(b.x0) && Number.isFinite(b.y1), `ratio ${ratio}`).toBe(true)
    }
  })
})

describe('the shape a creature is drawn at', () => {
  it('is a positive number for anything with ink on it', () => {
    const r = petRatio(drawing())
    expect(r).toBeGreaterThan(0)
    expect(Number.isFinite(r)).toBe(true)
  })

  it('and stays sane for a drawing whose paper shape is nonsense', () => {
    for (const ratio of [0, -3, 1e9]) {
      const r = petRatio({ ...drawing(), ratio })
      expect(Number.isFinite(r), `ratio ${ratio} gave ${r}`).toBe(true)
      expect(r).toBeGreaterThan(0)
    }
  })
})
