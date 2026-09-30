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
  /** how wide it is, as a multiple of how wide it would have been */
  spread: number
}

/**
 * ⚠️ A BAND, FOR THE SAME REASON temperOf HAS ONE. Its note: "variety without a band is just a
 * random stat generator, and the failure is not that some bosses are weak — it is that some are
 * impossible and nobody can tell which from looking." A drawing arriving over an unauthenticated
 * relay decides this, so the worst picture anybody sends is still a move you can stand next to,
 * and the best one is still a move you can walk away from.
 */
const BAND = { reach: [0.55, 1.9], spread: [0.6, 1.8] } as const

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

  const body = boxOf(parts.filter((p) => p.kind !== 'spell' && p.kind !== 'hit'))
  const mark = boxOf(spell)
  if (!body || !mark) return null

  const tall = Math.max(1e-6, body.y1 - body.y0)
  const wide = Math.max(1e-6, body.x1 - body.x0)
  const across = Math.max(tall, wide)

  /* how far the drawn shape's middle sits from the body's, in bodies */
  const bx = (body.x0 + body.x1) / 2
  const by = (body.y0 + body.y1) / 2
  const mx = (mark.x0 + mark.x1) / 2
  const my = (mark.y0 + mark.y1) / 2
  const away = Math.hypot(mx - bx, my - by) / across

  /* and how big it is, against the same body */
  const big = Math.max(mark.x1 - mark.x0, mark.y1 - mark.y0) / across

  /**
   * ⚠️ CENTRED ON 1 SO THAT DRAWING THE ORDINARY THING CHANGES NOTHING. A spell layer about
   * half a body across, sitting about half a body out, is the shape somebody draws without
   * thinking about it — and it should land where the cast already landed. The multipliers move
   * from there, which is what makes "further out" and "wider" mean what they say.
   */
  return {
    reach: hold(0.6 + away * 0.8, BAND.reach),
    spread: hold(0.55 + big * 0.9, BAND.spread),
  }
}
