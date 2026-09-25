import type { Spot } from './walk'

/**
 * Things you cannot walk through.
 *
 * ⚠️ HEIGHT AND SOLIDITY ARE DIFFERENT ANSWERS TO DIFFERENT QUESTIONS, and keeping them apart
 * is most of the design. `rocks 0.5` is something you get ON TOP of — the park has had that
 * since ground.ts — and a wall is something you get STOPPED by. A place that was both would
 * have to decide what happens when you walk into it while standing higher than it, which is a
 * question nobody drawing a map wants to be asked.
 *
 * ⚠️ AND THIS IS WHAT SNEAKING WAS MISSING. notice.ts gave a boss an awareness state and the
 * note at the time said the only escapes were distance and waiting, because the park had
 * nothing to break line of sight with. A wall is the thing you hide behind, and it is the same
 * wall you cannot walk through — one shape doing both jobs, rather than a second invisible
 * layer that has to be kept in step with the visible one.
 *
 * ⚠️ A RECTANGLE, NOT A CIRCLE, AND THAT IS THE WHOLE REASON THIS FILE WAS REWRITTEN. Every
 * other place in the park is round, because every other place is a blob of scenery — but a
 * wall is long and thin by nature, and a Place carries a centre and a WIDTH. Drawn as a tall
 * narrow hedge, that became a small circle with the height thrown away: measured in the park,
 * a creature held against it for 1.4 seconds and then simply walked round the end of something
 * that looked like it reached the whole way. The box somebody drew IS the wall.
 *
 * ⚠️ IN WORLD UNITS, unlike the round places. An axis-aligned box stays axis-aligned however
 * the field is stretched, so there is no aspect to correct for here — the 16:10 conversion the
 * circles need exists because a circle in world units is an ellipse on screen, and a rectangle
 * is a rectangle either way.
 *
 * ⚠️ PURE, and the walls are handed in. It does not know about the world, which is what lets
 * the whole of it be checked with a list of boxes and no browser.
 */

/** the box somebody drew, in world units across the whole park */
export type Wall = { x0: number; y0: number; x1: number; y1: number; name: string }

/**
 * How much of a drawn place is actually solid.
 *
 * ⚠️ THE SAME TWO THIRDS groundAt STANDS ON. A place's size is how big it LOOKS, and the part
 * with substance is the middle of it — a creature stopped a full radius out from a soft-edged
 * blob is a creature stopped by nothing visible.
 */
export const SOLID = 0.66

/** the gap left between a creature and a wall, so it rests against one rather than inside it */
const SKIN = 0.0015

/**
 * Shrink a drawn box to the part that actually stops you.
 *
 * ⚠️ AND `keep` IS 1 FOR ANYTHING SOMEBODY DREW. SOLID is the right answer for the
 * park's own landmarks, which are soft-edged blobs: a creature stopped a full radius out from a
 * smudge is a creature stopped by nothing visible. A stamped drawing is not a smudge — it has
 * an outline, and the picture IS the shape — so taking a third of it away is a wall you can
 * walk around the edges of, which is exactly how it was reported. The header above already
 * claims "the box somebody drew IS the wall"; for stamps it was not, until this argument.
 */
export const wallOf = (
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  name: string,
  keep: number = SOLID,
): Wall => {
  const mx = (x0 + x1) / 2
  const my = (y0 + y1) / 2
  const hw = ((x1 - x0) / 2) * keep
  const hh = ((y1 - y0) / 2) * keep
  return { x0: mx - hw, y0: my - hh, x1: mx + hw, y1: my + hh, name }
}

/** Is this spot inside something solid? */
export function inWall(s: Spot, walls: Wall[]): Wall | null {
  for (const w of walls) if (s.x > w.x0 && s.x < w.x1 && s.y > w.y0 && s.y < w.y1) return w
  return null
}

/**
 * Where you actually end up, having tried to walk from `from` to `to`.
 *
 * ⚠️ OUT BY THE NEAREST EDGE, which is what makes it slide. Pushing out along the shortest way
 * free means walking into a wall face-on stops you dead in that axis and leaves the other one
 * untouched — so holding two keys against a wall still moves you along it, which is what a
 * hand on a keyboard expects. Refusing the move outright instead makes both keys stop working
 * the moment one of them is blocked.
 *
 * ⚠️ AND IT RESOLVES MORE THAN ONCE, because two boxes can overlap and being pushed out of one
 * can push you into the next. Three passes covers any corner somebody can draw and is bounded,
 * which matters in a function that runs every frame for every creature.
 */
export function slideAround(from: Spot, to: Spot, walls: Wall[]): Spot {
  if (!walls.length) return to
  let at = to
  for (let pass = 0; pass < 3; pass++) {
    const hit = inWall(at, walls)
    if (!hit) return at
    /* how far it is to each way out, and take the shortest */
    const left = at.x - hit.x0
    const right = hit.x1 - at.x
    const up = at.y - hit.y0
    const down = hit.y1 - at.y
    const least = Math.min(left, right, up, down)
    if (least === left) at = { ...at, x: hit.x0 - SKIN }
    else if (least === right) at = { ...at, x: hit.x1 + SKIN }
    else if (least === up) at = { ...at, y: hit.y0 - SKIN }
    else at = { ...at, y: hit.y1 + SKIN }
  }
  /* three pushes and still inside something: stay where you were rather than end up somewhere
     nobody asked for. A creature that does not move is recoverable; one that teleports is not */
  return inWall(at, walls) ? from : at
}

/**
 * Can something at `a` see something at `b`, or is there a wall between them?
 *
 * ⚠️ THE SLAB TEST, which is the standard way to put a segment against a box and the only one
 * that gets the ends right. A wall blocks sight when the line between two creatures passes
 * THROUGH it — not when it is merely near, and not when it is behind either of them, which is
 * why the overlap is clamped to the segment rather than taken on the infinite line.
 *
 * ⚠️ AND IT IS THE SAME BOXES THEY WALK INTO. A map where you can hide behind something you
 * can also walk through, or be seen through something you cannot, is a map that has two ideas
 * of where its walls are.
 */
export function canSee(a: Spot, b: Spot, walls: Wall[]): boolean {
  if (!walls.length) return true
  const dx = b.x - a.x
  const dy = b.y - a.y
  /* ⚠️ NOTHING CAN BE BETWEEN TWO THINGS IN THE SAME PLACE. Without this the slab test
     reads a zero-length segment as parallel to both pairs of edges and, for a point inside a
     box, concludes the box is in the way of itself. */
  if (Math.abs(dx) < 1e-9 && Math.abs(dy) < 1e-9) return true
  for (const w of walls) {
    let near = 0
    let far = 1
    let missed = false
    for (const [p, d, lo, hi] of [
      [a.x, dx, w.x0, w.x1],
      [a.y, dy, w.y0, w.y1],
    ] as Array<[number, number, number, number]>) {
      if (Math.abs(d) < 1e-9) {
        /* parallel to this pair of edges: either it is between them or it never crosses */
        if (p <= lo || p >= hi) {
          missed = true
          break
        }
        continue
      }
      const t0 = (lo - p) / d
      const t1 = (hi - p) / d
      near = Math.max(near, Math.min(t0, t1))
      far = Math.min(far, Math.max(t0, t1))
      if (near > far) {
        missed = true
        break
      }
    }
    if (!missed && near <= far) return false
  }
  return true
}
