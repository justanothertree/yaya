import { describe, expect, it } from 'vitest'
import {
  attacksOf,
  HIT_SHAPES,
  hurtBox,
  inBox,
  isHitShape,
  moveTable,
  movesOf,
  pairOf,
  petWide,
  posedAt,
  tellOf,
  wound,
  POUNCE,
  slotFor,
  type Aim,
  type Attack,
} from './attack'
import { PART_WORDS, partOf, rigOf, WORDS } from './rig'
import type { Drawing, Stroke } from '../draw/strokes'
import { PET_TALL } from './play'

/**
 * The moves a drawing turns into.
 *
 * ⚠️ A WIND-UP AND A RECOVERY ARE WHAT MAKE AN ATTACK A DECISION. Live for the whole swing and
 * the only question is who pressed first; live for the middle third and there is a moment to
 * step into and a moment to punish, which is the entire game underneath a fighting game. Every
 * move this module can produce has to have that shape, whoever drew it.
 *
 * ⚠️ AND REACH IS IN PET-HEIGHTS, NOT WIDTHS, which is a mistake this file has already made
 * and written down: a width is the one measurement that varies wildly between two creatures
 * standing side by side, so reach in widths gave a long-tailed creature nearly twice the range
 * before any bonus — and a sweep came out covering the whole stage.
 */

const stroke = (over: Partial<Stroke> = {}): Stroke => ({
  t: 'brush',
  c: '#4a7c3f',
  a: 1,
  w: 0.03,
  p: [0.35, 0.35, 0.65, 0.65],
  ...over,
})

const creature = (layers: string[], ratio = 1): Drawing => ({
  v: 1,
  name: layers.join('-') || 'blank',
  ratio,
  bg: null,
  layers,
  strokes: layers.map((_, i) =>
    stroke({
      l: i,
      p: [0.25 + i * 0.04, 0.2 + i * 0.06, 0.6 + i * 0.05, 0.6 + i * 0.04],
    }),
  ),
})

const ZOO = [
  creature(['body']),
  creature(['body', 'leg', 'leg']),
  creature(['body', 'tail']),
  creature(['body', 'wing', 'wing']),
  creature(['body', 'arm', 'arm']),
  creature(['body', 'horn', 'horn']),
  creature(['body', 'head', 'mouth']),
  creature(['body', 'flame']),
  creature(['body', 'leg', 'leg', 'tail', 'head'], 16 / 9),
  creature(['body', 'wing', 'wing', 'arm'], 3 / 4),
]

/**
 * ⚠️ attacksOf TAKES PARTS, NOT A DRAWING, which I had to read to find out — rigOf is
 * the step between, and movesOf is the two of them together plus the slot table. Worth going
 * through both doors here: attacksOf is what a creature CAN do and movesOf is what ends up on
 * the six keys, and they are not the same list.
 */
const rawOf = (d: Drawing) => attacksOf(rigOf(d), d.hits)
const everyMove = () => ZOO.flatMap(rawOf)

describe('every move a drawing can produce', () => {
  it('has a wind-up and a recovery rather than being live throughout', () => {
    for (const a of [...everyMove(), POUNCE]) {
      const [from, to] = a.live
      expect(from, `${a.name} starts hurting at ${from}`).toBeGreaterThan(0)
      expect(to, `${a.name} stops hurting at ${to}`).toBeLessThanOrEqual(1)
      expect(to, `${a.name} is live from ${from} to ${to}`).toBeGreaterThan(from)
      /* it must not be live for the whole swing, or there is no moment to punish */
      expect(to - from, `${a.name} is live for ${(to - from).toFixed(2)} of its span`).toBeLessThan(
        0.9,
      )
    }
  })

  it('and takes a real amount of time', () => {
    for (const a of [...everyMove(), POUNCE]) {
      expect(a.span, `${a.name} spans ${a.span}`).toBeGreaterThan(0.05)
      expect(a.span).toBeLessThan(4)
    }
  })

  /**
   * ⚠️ REACH IS IN PET-HEIGHTS AND A SWEEP ONCE COVERED THE WHOLE STAGE. A creature is one
   * pet-height tall, so a reach beyond a few of those is a move that hits from off screen.
   */
  it('and reaches a believable distance, in creatures', () => {
    for (const a of [...everyMove(), POUNCE]) {
      expect(a.reach, `${a.name} reaches ${a.reach}`).toBeGreaterThan(0)
      expect(a.reach, `${a.name} reaches ${a.reach} pet-heights`).toBeLessThan(5)
    }
  })

  it('and hurts, and says where it came from', () => {
    for (const a of everyMove()) {
      expect(a.bite, `${a.name} does ${a.bite}`).toBeGreaterThan(0)
      expect(a.name.length).toBeGreaterThan(0)
      expect(a.from.length).toBeGreaterThan(0)
    }
  })

  it('and how much of its shove goes upward is a fraction', () => {
    for (const a of [...everyMove(), POUNCE]) {
      expect(a.lift, `${a.name} lifts ${a.lift}`).toBeGreaterThanOrEqual(0)
      expect(a.lift).toBeLessThanOrEqual(1)
    }
  })

  it('and costs something to have thrown', () => {
    for (const a of everyMove()) expect(a.rest).toBeGreaterThanOrEqual(0)
  })
})

describe('what a drawing is made of decides what it can do', () => {
  it('so different creatures get different moves', () => {
    const sets = ZOO.map((d) =>
      rawOf(d)
        .map((a) => a.name)
        .join(','),
    )
    expect(new Set(sets).size, 'every creature in the zoo fights identically').toBeGreaterThan(2)
  })

  it('and a creature drawn with nothing still has something to throw', () => {
    expect(Array.isArray(rawOf(creature([])))).toBe(true)
    expect(movesOf(creature([])).length, 'a plain creature has no moves at all').toBeGreaterThan(0)
  })

  /**
   * ⚠️ THE PART WORDS THE PAINT ROOM OFFERS HAVE TO REACH THIS TOO. rig.ts turns a name into a
   * part; this turns parts into moves. A word that the rig understands but that buys nothing
   * here is still the room promising something that does not happen — just one step further on.
   */
  it('and a creature with a named part does not fight like a blank one', () => {
    const plain = movesOf(creature(['body']))
      .map((a) => a.name)
      .join(',')
    let differed = 0
    for (const w of PART_WORDS) {
      const with_ = movesOf(creature(['body', w]))
        .map((a) => a.name)
        .join(',')
      if (with_ !== plain) differed++
    }
    expect(
      differed,
      `none of the ${PART_WORDS.length} part words changed the moves`,
    ).toBeGreaterThan(2)
  })
})

describe('the six slots a creature fights with', () => {
  /**
   * ⚠️ QUICK AND HEAVY, NEUTRAL UP AND DOWN, which is six — and the numbering has to be
   * stable because a slot number is what goes on the wire for somebody else's swing.
   */
  it('are numbered the same way every time', () => {
    const seen = new Map<number, string>()
    for (const aim of ['neutral', 'up', 'down'] as Aim[])
      for (const heavy of [false, true]) {
        const n = slotFor(heavy, aim)
        expect(seen.has(n), `slot ${n} is both ${seen.get(n)} and ${aim}/${heavy}`).toBe(false)
        seen.set(n, `${aim}/${heavy}`)
      }
    expect([...seen.keys()].sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5])
  })

  it('and a move table fills all six for every creature', () => {
    for (const d of ZOO) {
      const table = moveTable(rawOf(d))
      expect(table.length, `${d.name} got ${table.length} moves`).toBe(6)
      for (const a of table) expect(a, `${d.name} has a hole in its table`).toBeTruthy()
    }
  })

  it('and the heavy of a pair hits harder than the quick one', () => {
    for (const d of ZOO) {
      const [quick, heavy] = pairOf(movesOf(d))
      expect(heavy.bite, `${d.name}: heavy ${heavy.bite} vs quick ${quick.bite}`).toBeGreaterThan(
        quick.bite,
      )
    }
  })

  it('and a creature with no moves at all still has a pair', () => {
    const [a, b] = pairOf([])
    expect(a).toBeTruthy()
    expect(b.bite).toBeGreaterThan(a.bite)
  })
})

describe('how wide a creature is to hit', () => {
  /**
   * ⚠️ THE BODY, NOT THE REACH. How wide a creature is to HIT is honestly its drawing's
   * business — somebody who drew a long low thing is easier to catch, the same way it is
   * drawn. How far it can REACH is not, or being drawn wide would be a straight upgrade.
   */
  it('follows the drawing, unlike reach', () => {
    const narrow = petWide(creature(['body'], 0.5))
    const wide = petWide(creature(['body'], 2))
    expect(wide).toBeGreaterThan(narrow)
    expect(narrow).toBeGreaterThan(0)
  })

  it('and is measured against the one height every creature shares', () => {
    const square = petWide(creature(['body'], 1))
    expect(square).toBeGreaterThan(PET_TALL * 0.1)
    expect(square).toBeLessThan(PET_TALL * 10)
  })
})

describe('the region a swing is hurting', () => {
  /* ⚠️ `gone` is SECONDS elapsed, not a fraction — hurtBox divides by the span itself */
  const at = { x: 0.5, y: 0.5, facing: 1 }
  const move: Attack = { ...POUNCE, live: [0.3, 0.6], span: 1 }

  it('is nothing before the wind-up is done', () => {
    expect(hurtBox(at, move, 0.1)).toBeNull()
  })

  it('and nothing again once it has recovered', () => {
    expect(hurtBox(at, move, 0.9)).toBeNull()
  })

  it('but something in the middle', () => {
    const box = hurtBox(at, move, 0.45)
    expect(box).toBeTruthy()
    expect(box!.x1).toBeGreaterThan(box!.x0)
    expect(box!.y1).toBeGreaterThan(box!.y0)
  })

  it('and it reaches the way the creature is facing', () => {
    const right = hurtBox({ ...at, facing: 1 }, move, 0.45)!
    const left = hurtBox({ ...at, facing: -1 }, move, 0.45)!
    expect(right.x1 - at.x).toBeGreaterThan(left.x1 - at.x)
    expect(at.x - left.x0).toBeGreaterThan(at.x - right.x0)
  })

  /* ⚠️ a move that comes out BOTH sides does not care which way you face */
  it('and a two-sided move covers the same ground whichever way you face', () => {
    const both: Attack = { ...move, both: true }
    const right = hurtBox({ ...at, facing: 1 }, both, 0.45)!
    const left = hurtBox({ ...at, facing: -1 }, both, 0.45)!
    expect(left).toEqual(right)
    expect(right.x0).toBeLessThan(at.x)
    expect(right.x1).toBeGreaterThan(at.x)
  })

  /**
   * ⚠️ AND THE BOX IS THE SIZE ITS REACH SAYS, IN PET-HEIGHTS. This is the assertion
   * that was missing when I first wrote this describe: every test here was about the box's
   * SHAPE — does it exist, which way does it point, is a longer one longer — and not one of
   * them pinned its SCALE. Deleting the pet-height conversion made the box five times too big
   * and every test still passed, which is the exact bug the header of this module records: a
   * sweep that came out covering the whole stage.
   */
  it('and one creature-height of reach is one creature-height of box', () => {
    const one = hurtBox(at, { ...move, reach: 1, both: false }, 0.45)!
    expect(one.x1 - one.x0).toBeCloseTo(PET_TALL, 6)
    const three = hurtBox(at, { ...move, reach: 3, both: false }, 0.45)!
    expect(three.x1 - three.x0).toBeCloseTo(PET_TALL * 3, 6)
  })

  it('and its height follows rise the same way', () => {
    const tall = hurtBox(at, { ...move, rise: 2 }, 0.45)!
    expect(tall.y1 - tall.y0).toBeCloseTo(PET_TALL * 4, 6)
  })

  it('and a longer-reaching move hurts further', () => {
    const short = hurtBox(at, { ...move, reach: 0.5 }, 0.45)!
    const long = hurtBox(at, { ...move, reach: 2 }, 0.45)!
    expect(long.x1 - long.x0).toBeGreaterThan(short.x1 - short.x0)
  })

  it('and standing in it is a question with an answer', () => {
    const box = hurtBox(at, move, 0.45)!
    const middle = { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2, facing: 1 }
    expect(inBox(middle, 0.1, box)).toBe(true)
    expect(inBox({ ...middle, x: box.x1 + 1 }, 0.1, box)).toBe(false)
  })

  /* ⚠️ a wider creature is caught from further away, because a body is a box not a point */
  it('and a wider creature is caught where a narrow one is not', () => {
    const box = hurtBox(at, move, 0.45)!
    const just = { x: box.x1 + 0.03, y: (box.y0 + box.y1) / 2, facing: 1 }
    expect(inBox(just, 0.02, box)).toBe(false)
    expect(inBox(just, 0.2, box)).toBe(true)
  })
})

describe('the hit shapes somebody can pick', () => {
  it('are all recognised by the reader that validates them', () => {
    for (const [id] of HIT_SHAPES) expect(isHitShape(id), `${id} is offered but refused`).toBe(true)
  })

  it('and nothing else is', () => {
    expect(isHitShape('wallop')).toBe(false)
    expect(isHitShape('')).toBe(false)
    expect(isHitShape(undefined)).toBe(false)
    expect(isHitShape(7)).toBe(false)
  })

  it('and each has a name and a description to show', () => {
    for (const [id, glyph, label] of HIT_SHAPES) {
      expect(id.length).toBeGreaterThan(0)
      expect(glyph.length).toBeGreaterThan(0)
      expect(label.length).toBeGreaterThan(2)
    }
  })
})

/**
 * The stage before the blow, which is the first one anybody can draw.
 *
 * ⚠️ AN ATTACK HAS ALWAYS HAD THREE STAGES AND ONLY THE MIDDLE ONE HAD A PICTURE. `live` names a
 * window inside `span`, so there is a wind-up before it and a recovery after — and what a
 * creature LOOKED like during the first of those was the same thing it looked like during the
 * second. The park's telegraph note says what that cost where it matters most: the only readable
 * part of a boss winding up was a rectangle the engine drew, identically for every creature
 * anybody has ever made.
 *
 * ⚠️ THE TESTS THAT MATTER HERE ARE THE TWO THAT ARE NOT ABOUT THE NEW THING. A drawing with no
 * tell has to behave EXACTLY as it did — every creature that exists is one of those — and a tell
 * must not quietly make a creature measure bigger, which is the bug the spell layer shipped with
 * and that `hiddenLayers` has a note about in those words.
 */
describe('a drawn wind-up', () => {
  /** the same creature, with and without a pose to wind up in */
  const plain = creature(['body', 'arm', 'hit'])
  const withTell = creature(['body', 'arm', 'hit', 'windup'])

  it('is read off a layer called tell, windup or brace, and nothing else is', () => {
    for (const word of ['tell', 'windup', 'wind up', 'brace', 'readying'])
      expect(partOf(word), `"${word}" does not read as a tell`).toBe('tell')
    /* ⚠️ THE SUBSTRING TRAP, WHICH HAS CAUGHT rig.ts TWICE. Matching is `includes` and the first
       entry in WORDS wins, so this is the real question rather than whether two words overlap:
       does every word still resolve to the kind that owns it, now that a kind went in FIRST? */
    for (const [kind, words] of WORDS)
      for (const w of words ?? []) expect(partOf(w), `"${w}" should still be a ${kind}`).toBe(kind)
  })

  /** ⚠️ and somebody will type this, which is the whole reason tell goes before hit in WORDS */
  it('and "hit windup" is a wind-up rather than a hit', () => {
    expect(partOf('hit windup')).toBe('tell')
    expect(partOf('hit')).toBe('hit')
  })

  it('leaves a creature that has not drawn one exactly as it was', () => {
    expect(tellOf(plain)).toBeNull()
    for (const a of movesOf(plain)) {
      /* posedAt with no tell is the old `a.layer` for the whole swing, by construction */
      expect(posedAt(a, 0, null)).toBe(a.layer)
      expect(posedAt(a, a.span * 0.99, null)).toBe(a.layer)
      expect(posedAt(a, a.span, null)).toBeUndefined()
    }
  })

  /** ⚠️ the bug the spell layer shipped with: "it also seems to be influencing the size" */
  it('and does not make the creature measure any bigger', () => {
    expect(petWide(withTell)).toBeCloseTo(petWide(plain), 10)
  })

  it('shows the wind-up pose first and the blow second', () => {
    const tell = tellOf(withTell)
    expect(tell, 'a drawing with a windup layer has a tell').not.toBeNull()
    const a = movesOf(withTell).find((m) => m.from === 'hit')!
    const turn = a.live[0] * a.span
    expect(posedAt(a, turn * 0.5, tell), 'winding up').toBe(tell!.layer)
    expect(posedAt(a, turn * 1.01, tell), 'the blow is out').toBe(a.layer)
    expect(posedAt(a, a.span + 0.001, tell), 'over').toBeUndefined()
  })

  /**
   * ⚠️ THE TRADE, AND IT IS THE WHOLE MECHANIC. A tell must buy readability and cost commitment.
   * Stretching the span alone would make a telegraphed move hurt for LONGER as well as take
   * longer, which would make drawing a big wind-up a straight upgrade and the decision no
   * decision at all.
   */
  it('and buys its wind-up with commitment, not with a longer dangerous window', () => {
    const a = movesOf(plain).find((m) => m.from === 'hit')!
    for (const slow of [0.05, 0.12, 0.26]) {
      const w = wound(a, { layer: 9, slow })
      const was = (a.live[1] - a.live[0]) * a.span
      const now = (w.live[1] - w.live[0]) * w.span
      expect(now, `live window at slow ${slow}`).toBeCloseTo(was, 6)
      expect(w.span, `span at slow ${slow}`).toBeCloseTo(a.span + slow, 10)
      expect(w.live[0] * w.span, `wind-up at slow ${slow}`).toBeCloseTo(
        a.live[0] * a.span + slow,
        6,
      )
    }
  })

  /** ⚠️ and a bigger pose is a slower one, which is how the mechanic gets drawn in */
  it('and a bigger pose is a slower wind-up', () => {
    const small = creature(['body', 'arm', 'hit'])
    small.layers = [...(small.layers ?? []), 'windup']
    small.strokes = [...small.strokes, stroke({ l: 3, p: [0.48, 0.48, 0.52, 0.52] })]
    const big = creature(['body', 'arm', 'hit'])
    big.layers = [...(big.layers ?? []), 'windup']
    big.strokes = [...big.strokes, stroke({ l: 3, p: [0.1, 0.1, 0.9, 0.9] })]
    const a = tellOf(small)!
    const b = tellOf(big)!
    expect(b.slow, 'a sweeping wind-up against a tight one').toBeGreaterThan(a.slow)
  })
})

/**
 * ⚠️ AND A SECOND EXCLUSION, WHICH THE SIZE TEST ABOVE DOES NOT REACH. There are two places a
 * creature's body gets measured and they answer different callers: `notBodyLayers` feeds
 * bodyRatio and so petWide, and `drawnAttacks` takes its own body box for the reach and heft of
 * what you drew. Reverting either one leaves the other passing, which I found by reintroducing
 * the bug in the wrong file and watching the test stay green — so this asks the second one in
 * the only terms it can be wrong in: a wind-up drawn far out must not change the swing's reach.
 */
describe('a wind-up that is drawn a long way out', () => {
  const near = creature(['body', 'arm', 'hit'])
  const far = creature(['body', 'arm', 'hit'])
  far.layers = [...(far.layers ?? []), 'windup']
  far.strokes = [...far.strokes, stroke({ l: 3, p: [0.9, 0.45, 0.99, 0.55] })]

  it('does not change what the swing beside it reaches or hits for', () => {
    const a = movesOf(near).find((m) => m.from === 'hit')!
    const b = movesOf(far).find((m) => m.from === 'hit')!
    expect(b.reach, 'reach').toBeCloseTo(a.reach, 10)
    expect(b.bite, 'bite').toBe(a.bite)
    expect(b.rise, 'rise').toBeCloseTo(a.rise, 10)
  })
})
