import { rigOf, type Part } from '../pets/rig'
import type { Drawing } from '../draw/strokes'

/**
 * Where a creature's big moves land, taken from the picture.
 *
 * ⚠️ THIS IS TO THE CASTS WHAT THE `hit` LAYER IS TO THE SWINGS, and that one's note already
 * says the whole idea: "where you draw it decides everything about the move... so the whole of
 * 'draw your own attacks' is one layer name." Swings have worked that way for a long time. The
 * four big casts never did — patchesOf read a creature's DIALS (how quick it is, how brave) and
 * never its SHAPE, so every fissure in the game was the same fissure.
 *
 * ⚠️ THE FOOTPRINT ONLY, DELIBERATELY, AND IT IS THE FIRST HALF OF A BIGGER THING. A swell
 * still swells and a fissure still rolls outward; what a drawing decides is how far out it
 * lands and how wide it is. Making the drawing decide how it MOVES as well is the other half,
 * and a much harder one — every machine has to derive identical motion from the same picture,
 * which is the determinism rule the whole fight lives under.
 *
 * ⚠️ AND IT COSTS THE WIRE NOTHING. This is a pure function of the drawing and everybody in the
 * park already has the drawing — the same bargain temperOf makes. A cast still travels as one
 * small number; what changed is what both ends work out from the picture they already share.
 */

export type CastShape = {
  /** how far out it lands, as a multiple of where it would have landed */
  reach: number
  /** how wide it is, as a multiple of how wide it would have been — always 1 / reach */
  spread: number
}

/**
 * ⚠️ A BAND, FOR THE SAME REASON temperOf HAS ONE. Its note: "variety without a band is just a
 * random stat generator, and the failure is not that some bosses are weak — it is that some are
 * impossible and nobody can tell which from looking." A drawing arriving over an unauthenticated
 * relay decides this, so the worst picture anybody sends is still a move you can stand next to,
 * and the best one is still a move you can walk away from.
 */
const BAND = { reach: [0.55, 1.9] } as const

/**
 * The aspect that changes nothing, and how hard the dial turns.
 *
 * ⚠️ A SHAPE ABOUT TWICE AS LONG AS IT IS THICK IS "THE ORDINARY THING", so somebody who draws
 * a spell mark without thinking about it lands where the cast already landed. A circle is the
 * far end of one side and a 4:1 streak is the far end of the other, which is a dial a hand can
 * actually draw both ends of.
 */
const NEUTRAL = 2
const TILT = 0.45

const hold = (v: number, [lo, hi]: readonly [number, number]) =>
  Math.max(lo, Math.min(hi, Number.isFinite(v) ? v : 1))

const boxOf = (parts: Part[]) => {
  if (!parts.length) return null
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const p of parts) {
    x0 = Math.min(x0, p.box.x0)
    y0 = Math.min(y0, p.box.y0)
    x1 = Math.max(x1, p.box.x1)
    y1 = Math.max(y1, p.box.y1)
  }
  return Number.isFinite(x0) ? { x0, y0, x1, y1 } : null
}

/**
 * What the drawing says about where its casts land, or null when it says nothing.
 *
 * ⚠️ NULL IS NOT A DEFAULT OF 1, AND THE DIFFERENCE IS THE WHOLE COMPATIBILITY STORY. Every
 * creature anybody has already drawn has no spell layer, so it returns null and patchesOf does
 * exactly what it did yesterday — not "the same numbers by coincidence", but the same code path.
 * Nobody's boss changes until somebody draws one.
 *
 * ⚠️ MEASURED AGAINST THE BODY, NOT THE PAGE. A creature drawn small in the corner of a big
 * canvas and the same creature filling it are the same creature, and the park draws both at the
 * same height — so a footprint measured against the sheet would mean the same drawing threw a
 * different cast depending on how zoomed out somebody was when they drew it.
 */
/**
 * The same answer, remembered per drawing.
 *
 * ⚠️ BECAUSE THE LOOP ASKS EVERY FRAME, FOR EVERYBODY. castShapeOf walks every stroke through
 * rigOf, and the room already has a note about how expensive that is — a park with four people
 * and two bosses would run it four hundred times a second otherwise.
 *
 * ⚠️ AND KEYED ON THE DRAWING ITSELF, so a peer whose look has not changed is never recomputed
 * and one who redraws is. A WeakMap rather than a cache with a size, because the key is the
 * drawing and the drawing going away is exactly when the answer stops mattering.
 */
const seen = new WeakMap<Drawing, CastShape | null>()

export function shapeOf(art: Drawing | null | undefined): CastShape | null {
  if (!art) return null
  const had = seen.get(art)
  if (had !== undefined) return had
  const made = castShapeOf(art)
  seen.set(art, made)
  return made
}

export function castShapeOf(art: Drawing): CastShape | null {
  const parts = rigOf(art)
  const spell = parts.filter((p) => p.kind === 'spell')
  if (!spell.length) return null

  const mark = boxOf(spell)
  if (!mark) return null

  const w = mark.x1 - mark.x0
  const h = mark.y1 - mark.y0
  const long = Math.max(w, h)
  if (!(long > 0)) return null
  /* ⚠️ a perfectly straight line has no thickness at all, which is the far end of the dial
     rather than a division by zero — it clamps to the ceiling either way, but through the
     band instead of through hold()'s not-a-number fallback, which would read as NEUTRAL */
  const thick = Math.max(Math.min(w, h), long / 1000)

  /**
   * ⚠️ ITS PROPORTIONS DECIDE, AND ITS SIZE DECIDES NOTHING — AND THAT IS A CORRECTION. This
   * read the shape's length and its thickness as two separate dials against the body, so both
   * went UP together: a big blob was the maximum of everything at once and there was no shape
   * you could draw that cost you anything. Said plainly, and it is the right objection: "im not
   * liking that reach balancing, it should cost something."
   *
   * ⚠️ AND SIZE WAS NEVER THE RIGHT QUESTION ANYWAY. Everywhere else in this project how big
   * you drew something is thrown away on purpose — a creature is cropped to its own ink and
   * drawn at one fixed height, so a tiny sketch and a full page come out identical. A cast that
   * got stronger the bigger you drew it was the one place that rule did not hold, which is
   * also why it read as a free win: the thing it rewarded is the thing nothing else measures.
   *
   *   a circle           ->  lands close, covers the most ground
   *   about 2:1          ->  exactly what it would have done anyway
   *   a 4:1 streak       ->  reaches as far as it goes, and covers the least
   */
  const reach = hold(1 + (long / thick - NEUTRAL) * TILT, BAND.reach)

  /**
   * ⚠️ THE COST, AS ONE LINE OF ARITHMETIC. Width is the reciprocal of reach, so the two
   * multiply to exactly 1 for every drawing anybody can make — reaching twice as far covers
   * half as much ground, and there is no shape that buys both. It is a band on the product
   * rather than a band on each, which is why the spread needs no clamp of its own: it cannot
   * leave [1/1.9, 1/0.55] without the reach leaving its band first.
   *
   * ⚠️ AND THE SWELL PAYS WITHOUT BEING PAID, deliberately. A swell grows where you stand, so
   * it has no "further" to buy — drawing for reach makes it smaller and gives it nothing back.
   * That is the trade being real rather than decorative: aiming your kit at range costs you the
   * one cast that is not about range.
   */
  return { reach, spread: 1 / reach }
}
