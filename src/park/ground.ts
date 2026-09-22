import { VIEW, type Spot } from './walk'
import { worldPlanes } from './world'

/**
 * How high the ground is, place by place.
 *
 * ⚠️ THE PLACES ARE THE TERRAIN, rather than a second set of shapes laid over them. The park
 * already has five landmarks with positions and sizes, they are already on the little map, and
 * a player already says "meet me at the rocks" — so the rocks being a thing you can climb onto
 * costs one number each and no new geography. Inventing separate platforms would have given
 * the park two worlds that have to be kept in step.
 *
 * ⚠️ IN PET-HEIGHTS, like every other vertical measurement here. A jump peaks at HOP.up, which
 * is 0.62, so these numbers are deliberately placed either side of it:
 *
 *     the ring    0.22   a step. Anything can get up, and it changes what reaches you.
 *     the rocks   0.50   a scramble. A plain jump clears it with room to spare.
 *     the trees   0.72   ONLY WITH WINGS — a plain jump peaks at 0.62 and cannot.
 *
 * ⚠️ THAT LAST ONE IS THE POINT OF THE WHOLE FILE. Wings were a 26% higher jump and a longer
 * glide, both true and both invisible — "still a lack of gliding or movement abilities that i
 * can tell in testing". A place you can only reach by being able to fly is an ability you
 * cannot miss, and it needs somewhere to fly TO before it is worth having.
 *
 * ⚠️ THE POND IS NOT IN HERE and nor is the little wood. Every place being terrain would make
 * the park a climbing frame; two groves at different heights would also make "the trees" an
 * ambiguous thing to say. The far trees are the tall ones.
 */
export type Plane = {
  /** the landmark it is, by name — see MARKS */
  name: string
  top: number
}

export type Ground = { at: Spot; size: number; top: number; name: string; kind: string }

/**
 * ⚠️ THE TABLE MOVED TO world.ts AND THE REASONING STAYED HERE. The three heights above
 * are still the argument — a step, a scramble, and the one only wings reach — but which
 * places exist is now a thing that can be a drawing, so the list and the heights have to live
 * together. This file is the geometry: given the places, where is the ground.
 */
export const PLANES = worldPlanes

/**
 * ⚠️ STOOD ON, NOT STOOD IN. A landmark's `size` is how big it looks; the ground you can put
 * your feet on is the middle of it, because a creature standing on the very lip of a circle is
 * a creature half in the air with nothing under it. Two thirds is the flat part.
 */
const STAND = 0.66

/**
 * How high the ground is where you are standing, in pet-heights. 0 is the grass.
 *
 * ⚠️ MEASURED ON SCREEN, NOT IN WORLD UNITS, the same rule nearestMark follows and for the
 * same reason: the field is 16:10, so a circle in world units is an ellipse to look at, and a
 * plateau you could stand on from the north but not from the east is not a plateau.
 *
 * ⚠️ THE HIGHEST WINS, so overlapping places stack rather than fight. None overlap today; a
 * rule that only works while nothing overlaps is a rule waiting for the map maker.
 */
export function groundAt(s: Spot): number {
  let top = 0
  for (const p of worldPlanes()) {
    const dx = ((s.x - p.at.x) / VIEW.w) * (16 / 10)
    const dy = (s.y - p.at.y) / VIEW.h
    if (Math.hypot(dx, dy) <= p.size * STAND && p.top > top) top = p.top
  }
  return top
}

/** Which place you are stood on top of, or null on the grass. */
export function planeAt(s: Spot): Ground | null {
  let best: Ground | null = null
  for (const p of worldPlanes()) {
    const dx = ((s.x - p.at.x) / VIEW.w) * (16 / 10)
    const dy = (s.y - p.at.y) / VIEW.h
    if (Math.hypot(dx, dy) <= p.size * STAND && (!best || p.top > best.top)) best = p
  }
  return best
}
