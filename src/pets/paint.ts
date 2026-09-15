import { frameCount, paintDrawing, paintStroke, type Drawing } from '../draw/strokes'
import { bodyPose, inkBox, poseOf, type Part } from './rig'

/**
 * A pet, painted at one instant.
 *
 * ⚠️ A PLAIN FUNCTION OF TIME, not a loop and not a component. Everything that shows a pet — the
 * room, the profile block, the one that walks along the bottom of the page — wants the same
 * picture at a different size, and a component that owned the clock would have to be three
 * components. It is also the only way this is testable: the animation runs on
 * requestAnimationFrame, which never fires in the browser pane, so the thing that has to be
 * checkable is "what does it look like at t = 0.4" rather than "does it move".
 */

export type PetPaint = {
  /** seconds; any monotonic clock will do */
  t: number
  /** 0 asleep, 1 awake. Reduced motion passes 0 and the pet simply stands there. */
  energy?: number
  /** -1 to face the other way */
  facing?: number
}

export function paintPet(
  ctx: CanvasRenderingContext2D,
  art: Drawing,
  parts: Part[],
  w: number,
  h: number,
  { t, energy = 1, facing = 1 }: PetPaint,
) {
  ctx.clearRect(0, 0, w, h)
  ctx.save()
  if (facing < 0) {
    ctx.translate(w, 0)
    ctx.scale(-1, 1)
  }

  /**
   * ⚠️ THE VIEW IS THE CREATURE, NOT THE PAGE IT WAS DRAWN ON — see inkBox. Applied here,
   * around everything, so it lands on the strokes, the part pivots and the line widths alike:
   * lineWidth is in user space, so a scaled context thickens strokes by exactly the amount it
   * magnifies them, and nothing has to know it is being cropped.
   *
   * ⚠️ UNIFORM DESPITE THE TWO SCALE FACTORS. 1/bw and 1/bh differ, but the caller sizes the
   * canvas from petRatio, which is the ink box's own shape — so the two cancel to one magnification
   * and a rotating wing rotates rather than shears. Size a pet's canvas any other way and it will.
   */
  const box = inkBox(art)
  const bw = box ? box.x1 - box.x0 : 0
  const bh = box ? box.y1 - box.y0 : 0
  const crop = () => {
    if (!box || bw <= 0 || bh <= 0) return
    ctx.translate((-box.x0 * w) / bw, (-box.y0 * h) / bh)
    ctx.scale(1 / bw, 1 / bh)
  }

  /**
   * ⚠️ A DRAWN ANIMATION BEATS THE RIG, because somebody who drew twelve frames of their pet
   * walking has said exactly what it should do and does not need a guess laid over the top. This
   * is the same rule the download panel follows: frames if it has them, otherwise the other
   * thing. Both of the ways Josh described end up supported and neither needed a setting.
   */
  const frames = frameCount(art)
  if (frames > 1) {
    const fps = Math.max(1, Math.min(24, art.fps ?? 8))
    const f = energy > 0 ? Math.floor(t * fps) % frames : 0
    crop()
    paintDrawing(ctx, art, w, h, { frame: f })
    ctx.restore()
    return
  }

  const body = bodyPose(t, energy)
  /* the whole pet leans and drifts about its own middle, then the parts move within it */
  ctx.translate(w / 2, h / 2)
  ctx.rotate(body.rot)
  ctx.translate(-w / 2, -h / 2)
  ctx.translate(0, body.dy * h)
  /* ⚠️ AFTER the body's lean, so the pet turns about the middle of what you can see rather
     than about the middle of a page that is no longer on screen */
  crop()

  /* parts arrive in layer order, which is the order the picture is drawn in — see rigOf */
  for (const part of parts) {
    const pose = poseOf(part, t, energy)
    const px = part.px * w
    const py = part.py * h
    ctx.save()
    ctx.translate(px + pose.dx * w, py + pose.dy * h)
    ctx.rotate(pose.rot)
    ctx.scale(pose.sx, pose.sy)
    ctx.translate(-px, -py)
    for (const s of part.strokes) paintStroke(ctx, s, w, h)
    ctx.restore()
  }
  ctx.restore()
}
