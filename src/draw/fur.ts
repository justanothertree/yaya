/**
 * Fur, which lies the way your hand went.
 *
 * The second of the physics brushes, and chosen for the same reason the first one was: it has to
 * behave like a material rather than throw decoration off the line — see drip.ts for the note
 * about `ember` and `vine` being retired the same day the brushes were asked for.
 *
 * ⚠️ IT IS FOR THE THING THIS ROOM IS ACTUALLY FOR. Every creature in the park is a drawing made
 * here, and a furry one currently means drawing each hair. Fur is the texture a creature is most
 * often made of, so it is the brush that saves the most work rather than the one that looks most
 * impressive in a demo.
 *
 * ⚠️ AND THE PHYSICS IS THE LAY. Hair is not scatter — it has a direction, and the direction is
 * the one the brush travelled: drag left to right and the coat sweeps back to the left, exactly as
 * it would if you ran your hand along an animal. That is why this cannot be a per-point splatter
 * and why a hair's angle is given RELATIVE to travel rather than absolutely.
 */

/**
 * ⚠️ THE SAME FROZEN HASH drip.ts uses, and frozen for the same reason: pictures store points,
 * not hairs, so every hair is recomputed from the points whenever anybody opens the drawing.
 * Changing a constant in here would silently re-grow the coat on every saved picture.
 */
const noise = (n: number) => {
  const x = Math.sin(n * 12.9898) * 43758.5453
  return x - Math.floor(x)
}

/**
 * One hair.
 *
 * ⚠️ `turn` IS MEASURED FROM STRAIGHT BACK, NOT FROM THE PAGE, and that is what keeps this module
 * free of the canvas. A direction in the drawing's own 0..1 space is not a direction on screen —
 * x is scaled by the width and y by the height, so an angle computed here would come out wrong on
 * every canvas that is not square. The renderer knows the aspect, works out which way the stroke
 * was travelling in pixels, and adds `turn` to the reverse of it. Same split `ember` already
 * makes, and the reason its sparks come off the line correctly at any shape.
 */
export type Hair = {
  /** where it leaves the line, in the drawing's own 0..1 space */
  x: number
  y: number
  /** how long it is, in SHORT SIDES — the same unit as Stroke.w */
  len: number
  /** how far it leans off straight-back, in radians; negative is one side, positive the other */
  turn: number
}

/**
 * The most a hair may be, as a multiple of the brush's own width.
 *
 * ⚠️ IN BRUSH WIDTHS, so a fine brush draws down and a fat one draws a mane, and so the bound is
 * a sentence about the brush rather than a number about the canvas. The test asserts this
 * multiple.
 */
export const HAIR_MOST = 2.6

/**
 * How far a hair may lean off straight-back.
 *
 * ⚠️ UNDER A QUARTER TURN, WHICH IS THE WHOLE CLAIM. Past a right angle a hair is no longer
 * swept back — it is standing up, or pointing the way the hand went, and a coat with hairs
 * leading the stroke reads as having been brushed the wrong way. Keeping the whole spread inside
 * ±90° is what makes this fur rather than a bottle brush, and the test pins it.
 *
 * ⚠️ AND 45° RATHER THAN THE 69° THIS SHIPPED AT FOR TEN MINUTES, which a measurement caught. At
 * 69° off straight-back the horizontal reach of a hair is only cos(69°) — about a third of its
 * length — so a coat laid along a horizontal stroke barely leaned at all and read as scatter
 * rather than as lay. Scatter is what `spray` is for. Narrowing the spread is what makes the
 * direction of the stroke visible in the result, which is the entire point of the brush.
 */
export const LEAN_MOST = Math.PI / 4

/**
 * How dense the coat is: the share of points along the line that grow a hair.
 *
 * ⚠️ HIGHER THAN drip's, because fur is a texture and a drip is an event. One run in eight reads
 * as ink escaping; one hair in eight reads as a line somebody drew badly. Per point, so a slow
 * hand lays a thicker coat for the same reason a slow hand sheds more ink.
 */
const COAT = 0.55

/**
 * The coat along a line.
 *
 * ⚠️ SEEDED FROM THE POSITION, NEVER THE INDEX — the same decision drip.ts explains at length.
 * This brush is freehand, so `simplifyDrawing` thins its points to fit a byte ceiling, and a
 * seed taken from `i` would re-grow every hair somewhere else the moment a drawing was saved.
 *
 * ⚠️ BUT ONLY THE POSITIONS ARE PROMISED, NOT THE ANGLES, and that is an honest difference from
 * drip. A hair's lay comes from the direction the stroke was travelling, which the renderer reads
 * off the neighbouring points — and thinning removes neighbours. So a thinned coat keeps its
 * hairs where they were and lays them along the simplified path instead of the original one,
 * which moves them by however much the path itself was smoothed. A drip that moves is obviously
 * wrong; a hair that leans a degree differently is the same coat on a slightly tidier line.
 */
export function furFrom(p: number[], w: number): Hair[] {
  const out: Hair[] = []
  if (!(w > 0)) return out
  for (let i = 0; i + 1 < p.length; i += 2) {
    const x = p[i]
    const y = p[i + 1]
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue
    /* the mixing constants stampFrame and drip both use — two coordinates into one seed */
    const seed = x * 127.1 + y * 311.7
    if (noise(seed) > COAT) continue
    out.push({
      x,
      y,
      /* never nothing and never the whole bound, so HAIR_MOST is the bound the comment claims */
      len: (0.3 + noise(seed + 3.1) * 0.7) * HAIR_MOST * w,
      /**
       * ⚠️ SPREAD ACROSS BOTH SIDES FROM ONE DRAW, rather than alternating by index. Alternating
       * would put the sides in the order the points happen to be in, which thinning changes — so
       * a saved drawing would part its coat differently. Taken from the seed, a hair keeps its
       * side for as long as the point exists.
       */
      turn: (noise(seed + 5.7) * 2 - 1) * LEAN_MOST,
    })
  }
  return out
}
