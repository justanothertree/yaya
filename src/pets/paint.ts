import { frameCount, paintDrawing, paintStroke, type Drawing } from '../draw/strokes'
import {
  bodyPose,
  inkBox,
  PART_PARENT,
  petRatio,
  poseOf,
  rigOf,
  TUNE,
  type Mood,
  type Part,
  type PartKind,
  type Stance,
} from './rig'

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
  /**
   * Which hit layer to reveal, if any.
   *
   * ⚠️ HIT LAYERS ARE INVISIBLE UNLESS NAMED HERE. They are the drawn attacks — see the note in
   * rig.ts — so a creature standing about shows none of them, and a creature mid-swing shows
   * exactly the one it is throwing. Undefined means none, which is the common case and the one
   * every existing caller gets for free.
   */
  show?: number
}

export function paintPet(
  ctx: CanvasRenderingContext2D,
  art: Drawing,
  parts: Part[],
  w: number,
  h: number,
  { t, energy = 1, facing = 1, mood, show }: PetPaint,
  /**
   * Called with each part once its own transform is on the context, INSTEAD of painting it.
   *
   * ⚠️ THE ONE WAY TO ASK WHERE A POSE PUTS THINGS WITHOUT A SECOND COPY OF THIS FUNCTION.
   * poseRoom needs the transform every part ends up under, and the obvious way to get it is to
   * write the chain out again somewhere else — which was tried, and was wrong four times over
   * before it was thrown away: the pivot mapped through the wrong crop, the part offsets scaled
   * by the wrong axis, worst cases compounded that never co-occur. Every one of those was a
   * confident, plausible, silently-too-small answer. Handing out the real matrix cannot be any
   * of those things, because it is the matrix the ink is actually drawn with.
   */
  onPart?: (part: Part, ctx: CanvasRenderingContext2D) => void,
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
  /* ⚠️ the whole picture, so an attack drawn past the creature still lands on the bitmap —
     see petRatio, which sizes the canvas from the same box for exactly this reason */
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

  /**
   * One part's own movement, as a transform on whatever frame it is already in.
   *
   * ⚠️ THE EYES' REACH CAME DOWN when they started riding on the head, and that is arithmetic
   * rather than taste: they were moved 0.026 on their own and are now moved by the head as well,
   * so leaving it would have them travel half as far again as they ever did. They still out-run
   * the head, which is what eyes do — they just do it by adding to it now.
   */
  const place = (part: Part) => {
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
    const reach = part.kind === 'eye' ? 0.014 : 0.012
    const dx = pose.dx + (looks ? lookX * reach : 0)
    const dy = pose.dy + (looks ? lookY * reach * 0.8 : 0)
    const rot = pose.rot + (part.kind === 'head' ? lookX * 0.09 : 0)
    const sy = tune.shut && part.kind === 'eye' ? 0.08 : pose.sy
    const px = part.px * w
    const py = part.py * h
    ctx.translate(px + dx * w, py + dy * h)
    ctx.rotate(rot)
    ctx.scale(pose.sx, sy)
    ctx.translate(-px, -py)
  }

  /* ⚠️ what each kind IS, looked up once rather than searched for per part per frame. The first
     part of a kind wins, which is what somebody who drew two ear layers means by "the head". */
  const byKind = new Map<PartKind, Part>()
  for (const part of parts) if (!byKind.has(part.kind)) byKind.set(part.kind, part)

  /* parts arrive in layer order, which is the order the picture is drawn in — see rigOf */
  for (const part of parts) {
    /* ⚠️ AN ATTACK IS NOT PART OF STANDING THERE. A hit layer is drawn only while it is the
       one being thrown, which is what lets somebody draw a slash across the whole creature
       without it being there the rest of the time — see PetPaint.show.

       ⚠️ EXCEPT WHEN SOMETHING IS MEASURING. A bitmap has to be big enough for the frame
       the slash IS out, so `onPart` sees every layer. */
    if (!onPart && part.kind === 'hit' && part.layer !== show) continue
    ctx.save()
    /* ⚠️ the parent's movement first, so the child is posed in a frame that has already moved —
       an ear turns with the head AND twitches, instead of having to choose. See PART_PARENT. */
    const up = PART_PARENT[part.kind]
    const parent = up ? byKind.get(up) : undefined
    if (parent && parent !== part) place(parent)
    place(part)
    if (onPart) onPart(part, ctx)
    else for (const s of part.strokes) paintStroke(ctx, s, w, h)
    ctx.restore()
  }
  ctx.restore()
}

/** how many samples of each stance's own clock make an envelope */
const POSE_LOOK = 36
/**
 * A sliver of slack.
 *
 * ⚠️ BECAUSE SAMPLING IS NOT PROOF. Two of the part poses are spikes rather than waves —
 * `twitch` for an ear and `blink` for an eye — so a grid of samples can step over the top of
 * one. This is the couple of pixels that costs nothing and covers it, and it is an admission
 * rather than a tuning: the honest alternative is solving each pose for its maximum, which is
 * a second copy of poseOf and the thing this whole function exists to avoid.
 */
const POSE_EDGE = 0.02
/**
 * The most margin a drawing may ask for, per side.
 *
 * ⚠️ A 4:1 CREATURE GENUINELY NEEDS SIX TIMES THE PIXELS, because a limb on it is longer
 * than the creature is tall and a dive swings that limb through a quarter turn. That is real
 * and it is drawn correctly. This is only here so that something pathological — a hairline
 * twenty times as wide as it is tall — cannot ask for a bitmap that will not fit in memory.
 * Past this a pose is clipped again, which is the better of the two failures.
 */
const POSE_MOST = 2

/**
 * How far outside its box a creature's own animation paints, as a fraction of that box per side.
 *
 * ⚠️ THE CANVAS IS NOT THE PICTURE, and that is the distinction this exists to make.
 * inkBox answers "how big is the drawing", and every room, every hitbox, bodyFill, footRoom and
 * the altitude of a jump are measured against it and must not move. This answers "how much room
 * does POSING it need", and the answer is margin on the bitmap, not a bigger drawing.
 *
 * ⚠️ WHICH IS WHY IT IS NOT MORE PADDING IN inkBox. That is the obvious fix and it is wrong
 * twice over: bodyFill is floored at 0.35 and footRoom capped at 0.4, so past a certain padding
 * both compensations saturate and every creature quietly renders small and floating.
 *
 * ⚠️ AND IT ASKS paintPet RATHER THAN WORKING IT OUT. There is no arithmetic here that the
 * renderer does not do — the matrix comes back from the real transform stack, with the real
 * stance table, the real poseOf and the real parent chain on it. A hand-written copy of that
 * chain was tried first and was wrong four separate ways, each time by a plausible margin that
 * looked like a tuning problem rather than a bug. This cannot be off by a factor, because it is
 * not computing the factor.
 *
 * ⚠️ NO PIXELS ARE DRAWN. The context is one pixel and nothing is painted into it; only the
 * transform is read. That is what makes it cheap enough to do per drawing.
 */
/**
 * ⚠️ ONCE PER DRAWING, FOREVER. This walks every stance and is the most expensive thing in
 * the module by a wide margin — and the park mounts the same art several times over: a boss, a
 * walker, and whatever else is out. Measured unmemoised at 30 to 70ms each, which is a visible
 * hitch on walking into a room. Keyed on the drawing object, so it lives exactly as long as the
 * drawing does and a redrawn creature gets a fresh answer.
 */
const ROOMS = new WeakMap<Drawing, { x: number; y: number }>()

export function poseRoom(art: Drawing, parts?: Part[]): { x: number; y: number } {
  const had = ROOMS.get(art)
  if (had) return had
  const got = measureRoom(art, parts)
  ROOMS.set(art, got)
  return got
}

function measureRoom(art: Drawing, parts?: Part[]): { x: number; y: number } {
  const rig = parts ?? rigOf(art)
  if (!rig.length || typeof document === 'undefined') return { x: 0, y: 0 }
  const box = inkBox(art)
  if (!box) return { x: 0, y: 0 }
  const bw = box.x1 - box.x0
  const bh = box.y1 - box.y0
  if (!(bw > 0) || !(bh > 0)) return { x: 0, y: 0 }

  /* the shape the bitmap will be, which is the space the transform reports in */
  const wh = petRatio(art)
  const w = wh >= 1 ? 1000 : Math.round(1000 * wh)
  const h = wh >= 1 ? Math.round(1000 / wh) : 1000
  const probe = document.createElement('canvas')
  probe.width = 1
  probe.height = 1
  const ctx = probe.getContext('2d')
  if (!ctx) return { x: 0, y: 0 }

  let fat = 0
  for (const k of art.strokes) if (k.w > fat) fat = k.w
  /* ⚠️ half the brush either side of the line it was dragged along — the same correction
     inkBox makes, and worth up to 25 pixels of clipping on its own. See paintStroke. */
  const half = (Math.max(0.5, fat * Math.min(w, h)) / 2) * 1.02

  let x0 = 0
  let y0 = 0
  let x1 = w
  let y1 = h
  const look = (part: Part, c: CanvasRenderingContext2D) => {
    const m = c.getTransform()
    /* how much the matrix magnifies, so the brush is fattened by whatever the pose did */
    const grow = Math.sqrt(Math.max(m.a * m.a + m.b * m.b, m.c * m.c + m.d * m.d))
    const pad = half * grow
    for (const px of [part.box.x0 * w, part.box.x1 * w])
      for (const py of [part.box.y0 * h, part.box.y1 * h]) {
        const tx = m.a * px + m.c * py + m.e
        const ty = m.b * px + m.d * py + m.f
        if (tx - pad < x0) x0 = tx - pad
        if (ty - pad < y0) y0 = ty - pad
        if (tx + pad > x1) x1 = tx + pad
        if (ty + pad > y1) y1 = ty + pad
      }
  }

  for (const stance of Object.keys(TUNE) as Stance[]) {
    const tune = TUNE[stance]
    for (let i = 0; i < POSE_LOOK; i++) {
      /* ⚠️ TWO SECONDS OF THE STANCE'S OWN CLOCK. A `spin` is `rot: t * 3.2` and does not
         come back, so this has to cover a whole turn rather than a wobble — see poseOf.
         ⚠️ AND 1.3 ENERGY, which is what the park drives a moving creature at.
         ⚠️ AND THE LOOK AT FULL DEFLECTION, because a head follows the pointer. */
      const t = ((i / POSE_LOOK) * 4) / Math.max(0.2, tune.rate)
      paintPet(
        ctx,
        art,
        rig,
        w,
        h,
        { t, energy: 1.3, facing: 1, mood: { stance, lookX: 1, lookY: 1 } },
        look,
      )
      paintPet(
        ctx,
        art,
        rig,
        w,
        h,
        { t, energy: 1.3, facing: 1, mood: { stance, lookX: -1, lookY: -1 } },
        look,
      )
    }
  }

  /* ⚠️ PER SIDE AND SYMMETRIC, because the bitmap is centred on the box it pads */
  const cap = (v: number) => Math.min(POSE_MOST, Math.max(0, v) + POSE_EDGE)
  return { x: cap(Math.max(-x0, x1 - w) / w), y: cap(Math.max(-y0, y1 - h) / h) }
}
