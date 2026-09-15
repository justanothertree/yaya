import { frameCount, paintDrawing, paintStroke, type Drawing } from '../draw/strokes'
import { bodyPose, inkBox, poseOf, TUNE, type Mood, type Part } from './rig'

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
  /** what it is doing, and where it is looking. Absent is idle and straight ahead. */
  mood?: Mood
}

export function paintPet(
  ctx: CanvasRenderingContext2D,
  art: Drawing,
  parts: Part[],
  w: number,
  h: number,
  { t, energy = 1, facing = 1, mood }: PetPaint,
) {
  /* ⚠️ A stance is the same rig with the clock and the amplitude scaled — see TUNE. Nothing
     below branches on which stance it is, so a part added later works in all of them. */
  const tune = TUNE[mood?.stance ?? 'idle']
  const rt = t * tune.rate
  const re = energy * tune.swing
  const lookX = Math.max(-1, Math.min(1, mood?.lookX ?? 0))
  const lookY = Math.max(-1, Math.min(1, mood?.lookY ?? 0))
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
    const f = energy > 0 ? Math.floor(rt * fps) % frames : 0
    crop()
    paintDrawing(ctx, art, w, h, { frame: f })
    ctx.restore()
    return
  }

  const body = bodyPose(rt, re)
  /* the whole pet leans and drifts about its own middle, then the parts move within it */
  ctx.translate(w / 2, h / 2)
  /* ⚠️ The lean applies even at zero energy: a stance is a POSE, and reduced motion means a
     still creature rather than one that forgets it was crouching. */
  ctx.rotate(body.rot + tune.lean)
  ctx.scale(tune.squashX, tune.squashY)
  ctx.translate(-w / 2, -h / 2)
  ctx.translate(0, (body.dy + tune.drop) * h)
  /* ⚠️ AFTER the body's lean, so the pet turns about the middle of what you can see rather
     than about the middle of a page that is no longer on screen */
  crop()

  /* parts arrive in layer order, which is the order the picture is drawn in — see rigOf */
  for (const part of parts) {
    const pose = poseOf(part, rt, re)
    /**
     * ⚠️ LOOKING IS THE HEAD AND THE EYES AND NOTHING ELSE, which is what makes it read as a
     * glance rather than as the whole creature sliding. The eyes move further than the head does,
     * because that is what eyes do.
     *
     * ⚠️ AND SLEEP SHUTS THEM HERE rather than inside poseOf, so the pose functions stay pure
     * functions of time and this stays the one place that knows what a stance is.
     */
    const looks = part.kind === 'head' || part.kind === 'eye'
    const reach = part.kind === 'eye' ? 0.026 : 0.012
    const dx = pose.dx + (looks ? lookX * reach : 0)
    const dy = pose.dy + (looks ? lookY * reach * 0.8 : 0)
    const rot = pose.rot + (part.kind === 'head' ? lookX * 0.09 : 0)
    const sy = tune.shut && part.kind === 'eye' ? 0.08 : pose.sy
    const px = part.px * w
    const py = part.py * h
    ctx.save()
    ctx.translate(px + dx * w, py + dy * h)
    ctx.rotate(rot)
    ctx.scale(pose.sx, sy)
    ctx.translate(-px, -py)
    for (const s of part.strokes) paintStroke(ctx, s, w, h)
    ctx.restore()
  }
  ctx.restore()
}
