import { paintPet } from './paint'
import { paintDrawing, poseFrame } from '../draw/strokes'
import { castLayers, footRoom, inkBox, petBox, petCanvas, rigOf } from './rig'
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

/**
 * One stamp of a creature holding a named pose, or null if it has not drawn one.
 *
 * ⚠️ A SEPARATE STAMP RATHER THAN A FRAME ON THE WALK SHEET, because a pose is not part of a
 * cycle and putting it on the strip would mean `frameAt` could land on it — a minion would die
 * for a sixth of a second in the middle of running. It is also the honest shape for what this
 * is: a walk is many pictures played in order, a pose is one picture shown when something is
 * true.
 *
 * ⚠️ AND NULL WHEN NOBODY DREW ONE, which is what lets the caller fall back rather than branch.
 * Baking the rig's idle here instead would be a death pose that looks exactly like standing
 * about, which is worse than no pose at all because it reads as a bug.
 */
export function bakePose(art: Drawing, tall: number, pose: string): Baked | null {
  if (typeof document === 'undefined' || !(tall > 0)) return null
  if (poseFrame(art, pose) < 0) return null
  const box = petBox(art, petCanvas(art, tall))
  if (!(box.w > 0) || !(box.h > 0)) return null
  const sheet = document.createElement('canvas')
  sheet.width = box.w
  sheet.height = box.h
  const ctx = sheet.getContext('2d')
  if (!ctx) return null
  paintPet(ctx, art, rigOf(art), box.w, box.h, { t: 0, energy: 0, pose })
  return { sheet, w: box.w, h: box.h, frames: 1, foot: footRoom(art) }
}

/**
 * The spell layer on its own, cropped to its own ink, as an image a cast can be painted with.
 *
 * ⚠️ BECAUSE THE SPELL LAYER WAS AN INVISIBLE MODIFIER AND THE NAME SAID OTHERWISE. "i never
 * understood how to use the spell layer" came with what was expected instead — drawing the thing
 * that flies — and this is that: the ink you drew becomes the bolt, the fissure, the swell.
 * Nothing about where a cast goes or what it does changes; only what it looks like, which is the
 * one part that was never yours.
 *
 * ⚠️ CROPPED TO THE SPELL'S OWN BOX, not to the page. A cast patch is a circle somewhere in the
 * world and the drawing has to fill it; painting the whole page into that circle would put your
 * ink in whatever corner of it you happened to draw, at whatever size the rest of the creature
 * left over. castLayers already knows which layers these are, and pictureBox already makes the
 * matching decision for the creature's own picture.
 *
 * ⚠️ AND A DATA URL RATHER THAN A CANVAS, because the thing that consumes it is a CSS
 * background on a `.park-patch` span. A cast is already DOM — four circles positioned and scaled
 * by the same numbers the hit test uses — so this needed no renderer, only a picture.
 */
export function bakeSpell(art: Drawing, px = 128): string | null {
  if (typeof document === 'undefined' || !(px > 0)) return null
  const mine = castLayers(art)
  if (!mine.length) return null
  const keep = new Set(mine)
  /* the box of the spell ALONE — skip is "layers to leave out", so skip everything else */
  const others = (art.layers ?? []).map((_n, i) => i).filter((i) => !keep.has(i))
  const box = inkBox(art, others, false)
  if (!box) return null
  const bw = box.x1 - box.x0
  const bh = box.y1 - box.y0
  if (!(bw > 0) || !(bh > 0)) return null
  const cv = document.createElement('canvas')
  cv.width = px
  cv.height = px
  const ctx = cv.getContext('2d')
  if (!ctx) return null
  /* ⚠️ paintDrawing puts a page point p at p*px, so this maps the spell's box onto the whole
     canvas: scale by the box, then slide its corner to the origin. */
  ctx.save()
  ctx.scale(1 / bw, 1 / bh)
  ctx.translate(-box.x0 * px, -box.y0 * px)
  paintDrawing(ctx, art, px, px, { hidden: others })
  ctx.restore()
  return cv.toDataURL()
}
