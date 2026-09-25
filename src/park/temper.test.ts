import { describe, expect, it } from 'vitest'
import { givesGround, goesBig, pounces, runsAtYou, saysOf, temperOf } from './temper'
import type { Drawing, Stroke } from '../draw/strokes'
import { CAST } from './cast'

/**
 * How a drawing becomes a boss.
 *
 * ⚠️ THE INTERESTING PROPERTY HERE IS A DISTRIBUTION, NOT A VALUE. Every other module has
 * right answers; this one has a band, and the failure it has already suffered twice is a dial
 * pinned against its own floor — the size dial and the first cast dial both ended up there, and
 * the comments say so. "Every creature came out the same" is invisible from any single case and
 * obvious across twenty, which is what these ask.
 *
 * ⚠️ AND A BAND IS THE WHOLE SAFETY STORY. Variety without one is a random stat generator, and
 * the failure is not that some bosses are weak — it is that some are impossible and nobody can
 * tell which from looking.
 */

const stroke = (over: Partial<Stroke> = {}): Stroke => ({
  t: 'brush',
  c: '#4a7c3f',
  a: 1,
  w: 0.03,
  p: [0.4, 0.4, 0.6, 0.6],
  ...over,
})

/**
 * A creature built from named parts and a shape.
 *
 * ⚠️ THE SHAPE HAS TO VARY AS WELL AS THE NAMES, which the first version of this file
 * got wrong. Every creature was laid out by the same formula, so they differed only in what
 * their layers were CALLED — and `scale` and `range` are read off geometry, so across fifteen
 * of them scale moved by 0.05 inside a band of a whole unit. That looks exactly like a pinned
 * dial and was not one: it was a zoo that could not tell the difference.
 */
const creature = (layers: string[], ratio = 1, spread = 1): Drawing => ({
  v: 1,
  name: layers.join('-') || 'blank',
  ratio,
  bg: null,
  layers,
  strokes: layers.map((_, i) => {
    const mid = 0.5
    const reach = 0.08 + i * 0.05 * spread
    return stroke({
      l: i,
      w: (0.02 + (i % 4) * 0.015) * spread,
      p: [
        Math.max(0.02, mid - reach),
        Math.max(0.02, mid - reach * 0.8),
        Math.min(0.98, mid + reach * 0.9),
        Math.min(0.98, mid + reach),
      ],
    })
  }),
})

/**
 * A spread of genuinely different creatures.
 *
 * ⚠️ BUILT FROM THE PART WORDS THE RIG UNDERSTANDS, because that is what the dials are read
 * off — a list of creatures that differed only in their stroke coordinates would exercise none
 * of the reading this module does.
 */
const ZOO: Drawing[] = [
  creature(['body']),
  creature(['body', 'leg', 'leg']),
  creature(['body', 'leg', 'leg', 'leg', 'leg']),
  creature(['body', 'wing', 'wing']),
  creature(['body', 'wing', 'wing', 'tail']),
  creature(['body', 'head', 'arm', 'arm']),
  creature(['body', 'head', 'arm', 'arm', 'leg', 'leg']),
  creature(['body', 'horn', 'horn', 'leg', 'leg']),
  creature(['body', 'flame', 'tail']),
  creature(['body', 'eye', 'eye', 'mouth']),
  creature(['body', 'wheel', 'wheel']),
  creature(['body', 'antenna', 'antenna', 'leg']),
  creature(['body', 'heart']),
  creature(['body', 'halo', 'wing', 'wing']),
  creature(['body', 'ear', 'ear', 'leg', 'leg', 'tail']),
  creature(['body', 'leg', 'leg'], 16 / 9),
  creature(['body', 'wing', 'wing'], 3 / 4),
  creature(['body', 'head', 'leg', 'leg'], 2),
  /* and the same parts drawn small, sprawling, and somewhere between */
  creature(['body', 'leg', 'leg', 'head'], 1, 0.3),
  creature(['body', 'leg', 'leg', 'head'], 1, 2.2),
  creature(['body', 'wing', 'wing', 'tail'], 1, 0.4),
  creature(['body', 'wing', 'wing', 'tail'], 1, 1.8),
  creature(['body', 'arm', 'arm', 'leg', 'leg', 'head'], 1.4, 2.4),
]

const tempers = () => ZOO.map((d) => temperOf(d))

describe('every boss lands inside the band', () => {
  /**
   * ⚠️ THE BAND IS WHAT MAKES THE WORST DRAWING ANYBODY MAKES STILL A FIGHT, and the best one
   * still beatable. A dial outside it is not a boss with character, it is a boss nobody can
   * beat and no way to tell from looking at the picture.
   */
  it('however strange the drawing', () => {
    for (const t of tempers()) {
      expect(t.scale).toBeGreaterThan(1)
      expect(t.scale).toBeLessThan(5)
      expect(t.life).toBeGreaterThan(100)
      expect(t.life).toBeLessThan(700)
      for (const k of ['pace', 'range', 'beat', 'nerve', 'charge'] as const) {
        expect(Number.isFinite(t[k]), `${k} is ${t[k]}`).toBe(true)
        expect(t[k], `${k} is ${t[k]}`).toBeGreaterThan(0)
        expect(t[k]).toBeLessThan(3)
      }
    }
  })

  it('and a drawing with nothing on it is still a boss', () => {
    const t = temperOf({ v: 1, name: 'empty', ratio: 1, bg: null, strokes: [] })
    expect(Number.isFinite(t.scale)).toBe(true)
    expect(t.life).toBeGreaterThan(0)
    expect(t.casts).toHaveLength(3)
  })
})

describe('the drawing actually decides', () => {
  /**
   * ⚠️ THIS IS THE CHECK THAT WOULD HAVE CAUGHT BOTH PINNED DIALS. A dial sitting against its
   * own floor across a whole zoo is not visible in any single case — every creature simply gets
   * the same boss, and nothing on screen says so.
   */
  it.each(['scale', 'life', 'pace', 'range', 'beat', 'nerve'] as const)(
    'so %s is not the same number for everybody',
    (dial) => {
      const seen = new Set(tempers().map((t) => Math.round(t[dial] * 1000)))
      expect(
        seen.size,
        `${dial} took ${seen.size} distinct values across ${ZOO.length}`,
      ).toBeGreaterThan(2)
    },
  )

  /**
   * ⚠️ A DIAL PINNED AGAINST ITS OWN FLOOR IS THIS MODULE'S RECORDED FAILURE, twice
   * over — the size dial and the first cast dial both ended up there. It is invisible in any
   * single case and obvious across a zoo, so the threshold is a real fraction of each band
   * rather than "moved at all": a dial that shifts by a thousandth is pinned in practice.
   */
  it('and no dial is pinned against the edge of its own band', () => {
    const all = tempers()
    const bands = {
      scale: 3.05 - 2.05,
      pace: 1.3 - 0.68,
      range: 1.02 - 0.5,
      beat: 0.92 - 0.34,
      nerve: 0.92 - 0.2,
    } as const
    for (const dial of ['scale', 'pace', 'range', 'beat', 'nerve'] as const) {
      const vs = all.map((t) => t[dial])
      const span = Math.max(...vs) - Math.min(...vs)
      expect(
        span / bands[dial],
        `${dial} uses ${((span / bands[dial]) * 100).toFixed(0)}% of its band across the zoo`,
      ).toBeGreaterThan(0.15)
    }
  })

  /**
   * ⚠️ AND NOT ONE CAST FOR EVERYBODY, which is the failure this module's own comment records:
   * the casts were a rotation through a fixed list, so two completely different bosses had the
   * same three big attacks in the same order — the part of the fight that ignored the drawing.
   */
  it('and the favourite cast is not the same one for every creature', () => {
    const favourites = new Set(tempers().map((t) => t.casts[0]))
    expect(favourites.size, `every boss in the zoo favours ${[...favourites]}`).toBeGreaterThan(1)
  })

  it('and every boss still gets all three, in an order', () => {
    for (const t of tempers()) {
      expect(t.casts).toHaveLength(3)
      expect(new Set(t.casts).size, 'the same cast twice').toBe(3)
      for (const c of t.casts) expect(CAST[c], `${c} is not a cast`).toBeTruthy()
    }
  })

  it('and the same drawing always reads the same way', () => {
    const d = ZOO[6]
    expect(temperOf(d)).toEqual(temperOf(d))
  })
})

describe('what the room says it read', () => {
  it('is a sentence for every creature in the zoo', () => {
    for (const d of ZOO) {
      const said = saysOf(temperOf(d))
      expect(said.length, `${d.name} got "${said}"`).toBeGreaterThan(20)
      expect(said.endsWith('.'), `${d.name}: "${said}"`).toBe(true)
    }
  })

  it('and it is not the same sentence for everybody', () => {
    const said = new Set(ZOO.map((d) => saysOf(temperOf(d))))
    expect(said.size).toBeGreaterThan(2)
  })

  it('and it mentions the cast it actually favours', () => {
    for (const d of ZOO) {
      const t = temperOf(d)
      const said = saysOf(t)
      expect(said).toContain(CAST[t.casts[0]].says)
    }
  })
})

describe('the questions the fight asks, beat by beat', () => {
  /**
   * ⚠️ THESE TAKE A BEAT NUMBER, NOT JUST A TEMPER, which I found out by reading them
   * after my first version passed one argument and every boss in the zoo answered false to
   * everything. They are a deterministic roll per beat, so the thing worth asserting is not
   * what any single beat does — it is the RATE over many, and how that rate moves with the
   * dial that is supposed to drive it.
   */
  const rateOf = (
    fn: (beat: number, t: ReturnType<typeof temperOf>) => boolean,
    t: ReturnType<typeof temperOf>,
  ) => {
    let hits = 0
    for (let beat = 0; beat < 400; beat++) if (fn(beat, t)) hits++
    return hits / 400
  }

  it.each([
    ['givesGround', givesGround],
    ['runsAtYou', runsAtYou],
    ['pounces', pounces],
    ['goesBig', goesBig],
  ] as const)('%s happens sometimes and not always', (name, fn) => {
    for (const t of tempers()) {
      const r = rateOf(fn, t)
      expect(r, `${name} never happens for one of the zoo`).toBeGreaterThan(0)
      expect(r, `${name} happens on every single beat`).toBeLessThan(1)
    }
  })

  /**
   * ⚠️ A POUNCE NOBODY MEETS IS THE BUG THAT WAS REPORTED, and this guards that end of
   * it hard. `charge * 0.5` had been set against the range the formula COULD produce rather
   * than the one it does, which made a leap every fifteen seconds — "i cant notice any leap".
   *
   * ⚠️ THE OTHER END IS DELIBERATELY LOOSE, because I nearly asserted a range the code
   * never promised. The note on `pounces` records real creatures landing between 0.12 and 0.34
   * charge, and my first upper bound came straight from that — then a horned, four-legged
   * creature in the zoo came out at 0.82 and pounced every 2.3 beats. Legal: the band allows up
   * to 0.95. So the bound here is only "not on nearly every beat", and how often the keenest
   * creature SHOULD pounce is a tuning question for whoever owns the fight, not for a test.
   */
  it('and a pounce is something you actually see, for every boss', () => {
    for (const t of tempers()) {
      const r = rateOf(pounces, t)
      expect(r, `pounce every ${(1 / r).toFixed(1)} beats`).toBeGreaterThan(1 / 10)
      expect(r, `pounce every ${(1 / r).toFixed(1)} beats`).toBeLessThan(0.6)
    }
  })

  /**
   * ⚠️ AND THE DIAL HAS TO DRIVE THE BEHAVIOUR, which is the actual content of this
   * module. A boss that never gives ground is exactly the one that should be willing to pay
   * for a heavy swing; a darter is the one that should not. If these stop tracking, the
   * drawing has stopped deciding and nothing on screen would say so.
   */
  const fake = (over: Partial<ReturnType<typeof temperOf>>) => ({ ...temperOf(ZOO[0]), ...over })

  it('so a braver boss goes big more often than a timid one', () => {
    expect(rateOf(goesBig, fake({ nerve: 0.9 }))).toBeGreaterThan(
      rateOf(goesBig, fake({ nerve: 0.2 })),
    )
  })

  it('and a timid one gives ground more often than a brave one', () => {
    expect(rateOf(givesGround, fake({ nerve: 0.2 }))).toBeGreaterThan(
      rateOf(givesGround, fake({ nerve: 0.9 })),
    )
  })

  /* ⚠️ the run and the pounce come off the SAME instinct — a creature drawn to come at
     you does both, which is why they share `charge` */
  it('and a charger both runs at you and pounces more than a hanger-back', () => {
    const eager = fake({ charge: 0.9 })
    const shy = fake({ charge: 0.05 })
    expect(rateOf(runsAtYou, eager)).toBeGreaterThan(rateOf(runsAtYou, shy))
    expect(rateOf(pounces, eager)).toBeGreaterThan(rateOf(pounces, shy))
  })

  it('and the same beat always answers the same way', () => {
    const t = temperOf(ZOO[4])
    for (const beat of [0, 7, 51, 399]) {
      expect(pounces(beat, t)).toBe(pounces(beat, t))
      expect(goesBig(beat, t)).toBe(goesBig(beat, t))
    }
  })
})
