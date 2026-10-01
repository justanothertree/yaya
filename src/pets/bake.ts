import { paintPet } from './paint'
import { footRoom, petBox, petCanvas, rigOf } from './rig'
import type { Drawing } from '../draw/strokes'
import type { Stance } from './rig'

/**
 * A creature painted once, so it can be drawn a thousand times.
 *
 * ⚠️ THIS IS WHAT MAKES A SWARM POSSIBLE AT ALL, and the spike that said so is in
 * docs/2026-09-30-swarm-spike.md. Ten of a detailed creature on the live path — a rig painted
 * per creature per frame, which is what the park does today — costs 42ms, which is two and a
 * half frames gone for ten enemies and no game logic. The same drawing baked gives 800 for less
 * than a millisecond. There is no tuning that closes a gap of that size.
 *
 * ⚠️ AND THE BAKED COST DOES NOT CARE HOW COMPLICATED THE DRAWING IS. 800 of a 120-stroke
 * creature cost the same as 800 of an 11-stroke one, because the strokes are paid for once. That
 * is the whole reason this is worth having here rather than somewhere in the park: it means the
 * detail of what somebody draws stops being a performance budget. It stays a storage and wire
 * budget, which is a different ceiling with different rules — see ACCOUNT_ITEM_BYTES.
 *
 * ⚠️ BAKE BEFORE THE FIGHT, NEVER AT SPAWN. A detailed creature takes 110ms to bake, which is a
 * visible hitch, and it would land exactly when a wave arrives.
 */
export type Baked = {
  sheet: HTMLCanvasElement
  /** one frame, in pixels */
  w: number
  h: number
  frames: number
  /**
   * How much of a frame hangs below the creature's feet.
   *
   * ⚠️ CARRIED, BECAUSE A SPRITE STILL HAS TO STAND ON SOMETHING. The bottom of a pet's picture
   * is the bottom of its ink box, which holds the animation headroom and anything drawn below the
   * body — so putting the frame's bottom on the floor leaves the creature hovering above it. That
   * was a real bug in the park a day ago and there is no reason to ship it again in a new form.
   */
  foot: number
}

/**
 * Paint one creature's cycle into a strip.
 *
 * ⚠️ SIZED THROUGH petCanvas LIKE EVERY OTHER ROOM, so a baked creature is the same size as a
 * live one at the same height. A sprite that disagreed with the thing it replaces would be a
 * second answer to "how big is this creature", which this project has paid for twice already.
 */
export function bakeWalk(
  art: Drawing,
  tall: number,
  frames = 8,
  stance: Stance = 'run',
  seconds = 1,
): Baked | null {
  if (typeof document === 'undefined' || !(tall > 0) || frames < 1) return null
  const box = petBox(art, petCanvas(art, tall))
  if (!(box.w > 0) || !(box.h > 0)) return null
  const sheet = document.createElement('canvas')
  sheet.width = box.w * frames
  sheet.height = box.h
  const ctx = sheet.getContext('2d')
  if (!ctx) return null
  /* ⚠️ the rig once, not once per frame — it walks every stroke twice and that is the cost the
     whole module exists to stop paying repeatedly */
  const parts = rigOf(art)
  for (let i = 0; i < frames; i++) {
    ctx.save()
    ctx.translate(i * box.w, 0)
    paintPet(ctx, art, parts, box.w, box.h, {
      t: (i / frames) * seconds,
      energy: 1.2,
      mood: { stance },
    })
    ctx.restore()
  }
  return { sheet, w: box.w, h: box.h, frames, foot: footRoom(art) }
}

/**
 * Which frame of the strip belongs at this moment.
 *
 * ⚠️ ITS OWN FUNCTION SO IT CAN BE ASKED WITHOUT A CANVAS. Everything else here needs a browser;
 * this is the part with an off-by-one in it, and a loop that runs backwards or skips a frame is
 * exactly the kind of thing that is obvious in a test and invisible on screen at sixty a second.
 */
export const frameAt = (frames: number, t: number, seconds = 1): number => {
  if (!(frames > 1) || !Number.isFinite(t)) return 0
  const u = (t / seconds) % 1
  return Math.min(frames - 1, Math.floor((u < 0 ? u + 1 : u) * frames))
}

/**
 * Draw one, standing at (x, y), where y is the FLOOR its feet are on.
 *
 * ⚠️ THE FEET, NOT THE MIDDLE AND NOT THE TOP, because that is what every room in this project
 * means by where a creature is — its position is a point on the ground and its picture hangs off
 * that. See footRoom.
 */
export function blitBaked(
  ctx: CanvasRenderingContext2D,
  b: Baked,
  x: number,
  y: number,
  t: number,
  facing = 1,
  seconds = 1,
): void {
  const f = frameAt(b.frames, t, seconds)
  const top = y - b.h * (1 - b.foot)
  if (facing < 0) {
    /* ⚠️ mirrored like PetView mirrors, which is the only way a creature here ever turns round */
    ctx.save()
    ctx.translate(x, 0)
    ctx.scale(-1, 1)
    ctx.drawImage(b.sheet, f * b.w, 0, b.w, b.h, -b.w / 2, top, b.w, b.h)
    ctx.restore()
    return
  }
  ctx.drawImage(b.sheet, f * b.w, 0, b.w, b.h, x - b.w / 2, top, b.w, b.h)
}
