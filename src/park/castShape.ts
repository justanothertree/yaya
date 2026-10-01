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
  /**
   * How hard it curves as it travels, in radians per pet-height — signed, and 0 for a straight
   * one. Only the two casts that actually GO somewhere read it; see patchesOf.
   */
  bend: number
  /**
   * How many times it fires, 1 to 3 — one for each substantial stroke on the layer. Only the
   * bolt has room in its own clock for a second one; see patchesOf.
   */
  beats: number
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

/**
 * How hard a drawn curve turns what it throws.
 *
 * ⚠️ BANDED IN RADIANS PER PET-HEIGHT, and the band is what keeps a curve a curve rather than
 * a spiral. A bolt flies about 5.5 pet-heights, so the ceiling is a little over a right angle
 * across its whole flight — enough that stepping sideways is no longer the automatic answer,
 * not so much that it comes back round at you.
 *
 * ⚠️ AND A SEMICIRCLE IS THE FAR END, which is the most curved thing a single drawn gesture can
 * be before it stops reading as a sweep and starts reading as a loop: its sagitta is exactly half
 * its chord, so BEND_GAIN is set to hand that case the ceiling.
 */
const BAND_BEND = [-0.2, 0.2] as const
const BEND_GAIN = 0.4

/**
 * How straight the gesture has to be to count as one.
 *
 * ⚠️ BECAUSE A CIRCLE IS NOT A SWEEP, AND IS THE OBVIOUS THING TO DRAW. A closed loop comes
 * back to where it started, so its chord is nearly nothing while its path is long — and the
 * signed bend of a shape whose two ends meet is noise, swinging on which pixel happened to be
 * last. A blob already says something through its proportions, and what it should say about a
 * PATH is nothing.
 */
const BEND_SWEEP = 0.35

/**
 * How many marks make a rhythm.
 *
 * ⚠️ THREE, BECAUSE THE BOLT'S OWN CLOCK SAYS SO. It is 1.2s long with a 0.42s wind-up, and a
 * beat lands every 0.16s — so a fourth would be launching with less than half a flight left and
 * would blink out mid-air. The ceiling is the window, not a preference.
 *
 * ⚠️ AND A BEAT HAS TO BE A MARK YOU MEANT TO MAKE. Counting every stroke would turn a lifted
 * pen and a stray speck into a rhythm somebody did not ask for, so a stroke counts when it is a
 * quarter of the longest one — which is a rule about the drawing rather than a number of pixels,
 * and so survives being drawn at any size.
 */
const BEATS_MOST = 3
const BEAT_REAL = 0.25

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
  return { reach, spread: 1 / reach, ...gestureOf(art, spell) }
}

/**
 * Which way the gesture you drew turns, in radians per pet-height.
 *
 * ⚠️ THE SECOND HALF OF "DRAW YOUR OWN ABILITIES", and the half the first one's note called
 * "much harder". It is not harder because the geometry is hard; it is harder because a cast
 * that MOVES has to move identically on every machine, and the module it feeds says why in its
 * own first line — nothing new goes over the wire, so everyone derives the same patches from
 * the same four numbers. A path derived from the drawing keeps that bargain exactly, because
 * everybody already has the drawing. A path that were sent would break it.
 *
 * ⚠️ THE LONGEST STROKE IS THE GESTURE. A spell layer might hold a shape and then a couple of
 * ticks and flourishes beside it, and averaging those together gives a direction nobody drew.
 * "The longest line on the layer is the path it takes" is a rule you can hold in your head and
 * aim at, which is the same standard the layer NAMES are held to.
 *
 * ⚠️ MEASURED AS SAGITTA OVER CHORD, which is scale-free by construction — the same arc drawn
 * small in a corner and drawn across the page gives the same number. That is not a nicety here,
 * it is the rule the rest of this file follows: how big you drew something is thrown away
 * everywhere else, and the one place it was not thrown away is the free win that had to be
 * taken out of the reach dial a day ago.
 */
function gestureOf(art: Drawing, spell: Part[]): { bend: number; beats: number } {
  /* ⚠️ x and y are fractions of DIFFERENT lengths — the paper's width and its height — so every
     length below is taken in ratio-corrected space. Measured raw, the same curve drawn on wide
     paper and on tall paper would be two different casts. rig.ts has the long note. */
  const r = art.ratio > 0.05 && art.ratio < 20 ? art.ratio : 1

  /* ⚠️ every drawn length measured once, because the longest is the PATH and how many of them
     are worth counting is the RHYTHM — two readings of the same simple list */
  const runs: Array<{ p: number[]; run: number }> = []
  for (const part of spell)
    for (const k of part.strokes) {
      /* a bucket's points are a seed and a flood, not a line somebody dragged — see boxOf */
      if (k.t === 'fill' || k.p.length < 4) continue
      let run = 0
      for (let i = 2; i + 1 < k.p.length; i += 2)
        run += Math.hypot((k.p[i] - k.p[i - 2]) * r, k.p[i + 1] - k.p[i - 1])
      if (run > 0) runs.push({ p: k.p, run })
    }
  let far = 0
  let path: number[] | null = null
  for (const k of runs)
    if (k.run > far) {
      far = k.run
      path = k.p
    }
  if (!path || !(far > 0)) return { bend: 0, beats: 1 }
  const beats = Math.max(
    1,
    Math.min(BEATS_MOST, runs.filter((k) => k.run >= far * BEAT_REAL).length),
  )
  const straight = { bend: 0, beats }
  /* a two-point stroke is a straight line however it is stored — it still counts as a beat */
  if (path.length < 6) return straight

  const ax = path[0] * r
  const ay = path[1]
  const bx = path[path.length - 2] * r
  const by = path[path.length - 1]
  const cx = bx - ax
  const cy = by - ay
  const chord = Math.hypot(cx, cy)
  /* a loop came back to where it started, so it has a long path and no chord — and no sweep */
  if (chord < far * BEND_SWEEP) return straight

  /**
   * ⚠️ SIGNED, AND THE SIGN IS THE WHOLE POINT. An unsigned "how bent is it" would turn every
   * curve the same way, which is a stylised flourish rather than a thing you drew. The cross
   * product against the chord says which side of it the gesture bows out on, and the park
   * applies that to the left or right of the way the cast is travelling — so "it curves the way
   * you drew it" is true rather than nearly true.
   */
  let bow = 0
  for (let i = 0; i + 1 < path.length; i += 2) {
    const sx = path[i] * r - ax
    const sy = path[i + 1] - ay
    const off = (cx * sy - cy * sx) / chord
    if (Math.abs(off) > Math.abs(bow)) bow = off
  }
  return { bend: hold((bow / chord) * BEND_GAIN, BAND_BEND), beats }
}
