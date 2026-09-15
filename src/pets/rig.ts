import type { Drawing, Stroke } from '../draw/strokes'

/**
 * The rig, and the whole idea of this module: A DRAWING'S LAYER NAMES ARE ITS SKELETON.
 *
 * Josh's suggestion was a "blueprint pet animation rig for what you draw", and the expensive way
 * to build that is a rig editor — joints, bones, weights, a second document beside the picture
 * that has to be kept in step with it. The cheap way is already in the file format. A drawing has
 * LAYERS, layers have NAMES, and somebody drawing a bird puts the wing on its own layer without
 * being asked, because that is how you draw a bird.
 *
 * So there is no rig to build and nothing new to store. Name a layer `wing` and it flaps. Call it
 * `tail` and it wags. The picture is the rig, and it was the rig before this file existed.
 *
 * Three things fall out of that, and all three are the point:
 *
 *   · ANY drawing is already a pet. No names, one layer, no parts — it breathes and bobs, which
 *     is enough to read as alive. Naming layers makes it better; nothing makes it fail.
 *   · You can go and rename a layer in the paint room and the pet changes. The rig is editable
 *     with the tools that already exist, by a person who has never heard the word "rig".
 *   · A pet drawn with FRAMES plays its frames instead. Somebody who would rather animate it by
 *     hand already has a frame editor, and both of the things Josh described are now true at
 *     once — draw the pieces and have them moved for you, or draw the motion yourself.
 *
 * ⚠️ A FILL ON A MOVING PART IS UNDEFINED, and deliberately unhandled. `fill` is the one raster
 * operation in the format: it floods from a point using the pixels already on the canvas, so
 * under a part transform it would flood the right point of the wrong picture. A part that is
 * moved is a part whose pixels are not where the fill was recorded against. Put fills on the
 * body, or on a pet that does not move much.
 */

export type PartKind = 'body' | 'head' | 'wing' | 'leg' | 'tail' | 'ear' | 'eye' | 'arm' | 'antenna'

/**
 * What each name means, in the words people actually use.
 *
 * ⚠️ SUBSTRING, NOT EQUALITY, because nobody names a layer `wing`. They name it "left wing",
 * "wing 2", "Wings". Matching on a substring costs nothing and is the difference between a
 * feature that works for the person who read the instructions and one that works.
 */
const WORDS: Array<[PartKind, string[]]> = [
  ['eye', ['eye', 'pupil', 'blink']],
  ['wing', ['wing', 'flap']],
  ['antenna', ['antenna', 'antennae', 'feeler', 'whisker']],
  ['ear', ['ear']],
  ['tail', ['tail']],
  ['leg', ['leg', 'foot', 'feet', 'paw', 'claw', 'hoof']],
  ['arm', ['arm', 'fin', 'hand', 'flipper']],
  ['head', ['head', 'face', 'snout', 'beak']],
  ['body', ['body', 'shell', 'torso']],
]

/** the words worth typing, in the order the room lists them — body is what everything else is */
export const PART_WORDS: string[] = ['wing', 'head', 'leg', 'tail', 'ear', 'eye', 'arm', 'antenna']

export function partOf(name: string | undefined): PartKind {
  const n = (name ?? '').toLowerCase()
  for (const [kind, words] of WORDS) if (words.some((w) => n.includes(w))) return kind
  return 'body'
}

/** What each part does, in one line, so the room can say what it understood. */
export const PART_DOES: Record<PartKind, string> = {
  body: 'breathes',
  head: 'bobs and tilts',
  wing: 'flaps',
  leg: 'shuffles',
  tail: 'wags',
  ear: 'twitches',
  eye: 'blinks',
  arm: 'sways',
  antenna: 'wobbles',
}

export type Box = { x0: number; y0: number; x1: number; y1: number }

export type Part = {
  kind: PartKind
  /** the layer this is, so the drawing can be painted a part at a time in layer order */
  layer: number
  name: string
  /** ⚠️ carried, not looked up. This is walked sixty times a second; regrouping the stroke list
      by layer on every frame is the kind of cost that only shows up once six pets are on screen */
  strokes: Stroke[]
  box: Box
  /** where it turns, in 0–1 space */
  px: number
  py: number
  /**
   * ⚠️ -1 for a part on the left of the body, 1 for one on the right. Two wings given the same
   * rotation both swing the same way, which reads as a picture sliding rather than a bird
   * flying. The side is the only thing needed to make them mirror, and it comes free from where
   * the part was drawn.
   */
  side: number
  /**
   * ⚠️ FOR THE LIMBS THAT TAKE TURNS, and only those. Legs alternate; wings do not — a bird
   * beats both wings together and the SIDE is what makes them mirror. Applying both to the same
   * part cancels them out: measured at t=0.35 a pair of wings came out at -0.351 and -0.533,
   * which is two wings sagging in the same direction rather than one wingbeat.
   */
  phase: number
}

const boxOf = (strokes: Stroke[]): Box | null => {
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const s of strokes)
    for (let i = 0; i + 1 < s.p.length; i += 2) {
      if (s.p[i] < x0) x0 = s.p[i]
      if (s.p[i] > x1) x1 = s.p[i]
      if (s.p[i + 1] < y0) y0 = s.p[i + 1]
      if (s.p[i + 1] > y1) y1 = s.p[i + 1]
    }
  return x0 === Infinity ? null : { x0, y0, x1, y1 }
}

/**
 * The part of the paper the creature is actually ON.
 *
 * ⚠️ A PET IS ITS INK, NOT ITS PAPER, and until this existed it was its paper. Somebody drew a
 * small square in the middle of a full-size canvas, put it in the corner of the site, and got a
 * tiny square in a large box of nothing — because the view was sized from the paper and the
 * creature was wherever on it they happened to draw. Nobody draws to the edges, so EVERY pet was
 * smaller than it should have been; the square just made it obvious.
 *
 * Cropping to the ink means where you drew it and how much of the page you used stop being part
 * of the result, which is the same promise the format already makes about canvas size.
 *
 * ⚠️ GENEROUS, NOT TIGHT. Half a stroke's width sticks out past the points it is measured
 * from, and a wing swings well past where it rests — a box that fits the still pose would clip
 * the moving one. 12% of the creature's own size, plus half the fattest stroke.
 */
export function inkBox(d: Drawing): Box | null {
  const b = boxOf(d.strokes)
  if (!b) return null
  let fat = 0
  for (const s of d.strokes) if (s.w > fat) fat = s.w
  const padX = fat / 2 + (b.x1 - b.x0) * 0.12 + 0.02
  const padY = fat / 2 + (b.y1 - b.y0) * 0.12 + 0.02
  return { x0: b.x0 - padX, y0: b.y0 - padY, x1: b.x1 + padX, y1: b.y1 + padY }
}

/**
 * The shape a pet's view should be: the ink's own proportions, not the paper's.
 *
 * ⚠️ x and y are fractions of DIFFERENT lengths — the paper's width and its height — so the ink
 * box's true shape is its fractional shape times the paper's. Getting this wrong is what would
 * turn the crop into a stretch, and it is the same width-over-height trap Drawing.ratio documents.
 */
export function petRatio(d: Drawing): number {
  const b = inkBox(d)
  const paper = d.ratio > 0.05 && d.ratio < 20 ? d.ratio : 1
  if (!b) return paper
  const bw = b.x1 - b.x0
  const bh = b.y1 - b.y0
  if (bw <= 0 || bh <= 0) return paper
  return Math.max(0.05, Math.min(20, (bw / bh) * paper))
}

/**
 * Read a drawing as a skeleton.
 *
 * ⚠️ THE PIVOT IS THE POINT ON THE PART NEAREST THE MIDDLE OF THE PET, and that single rule
 * gets every limb approximately right without anybody placing a joint. A wing attaches at the
 * body, so it pivots on its inner edge. A leg attaches upward, so it pivots at its top. A head
 * attaches downward, a tail attaches at the end nearest the body. The thing a limb hangs off is
 * always toward the middle, because that is what a limb is.
 */
export function rigOf(d: Drawing): Part[] {
  const whole = boxOf(d.strokes)
  if (!whole) return []
  const cx = (whole.x0 + whole.x1) / 2
  const cy = (whole.y0 + whole.y1) / 2

  const byLayer = new Map<number, Stroke[]>()
  for (const s of d.strokes) {
    const l = s.l ?? 0
    const list = byLayer.get(l)
    if (list) list.push(s)
    else byLayer.set(l, [s])
  }

  const parts: Part[] = []
  for (const [layer, strokes] of [...byLayer].sort((a, b) => a[0] - b[0])) {
    const box = boxOf(strokes)
    if (!box) continue
    const name = d.layers?.[layer] ?? ''
    const kind = partOf(name)
    /* the corner of its own box closest to the middle: clamp the centre INTO the box */
    const px = Math.max(box.x0, Math.min(box.x1, cx))
    const py = Math.max(box.y0, Math.min(box.y1, cy))
    const mid = (box.x0 + box.x1) / 2
    parts.push({
      kind,
      layer,
      strokes,
      name: name || 'unnamed',
      box,
      px,
      py,
      side: mid < cx ? -1 : 1,
      phase: parts.filter((p) => p.kind === kind).length * Math.PI,
    })
  }
  return parts
}

export type Pose = {
  /** radians about the pivot */
  rot: number
  /** 0–1 space, added after the rotation */
  dx: number
  dy: number
  /** about the pivot, y separately so an eye can close */
  sx: number
  sy: number
}

const STILL: Pose = { rot: 0, dx: 0, dy: 0, sx: 1, sy: 1 }

/**
 * Where a part is at time `t`, in seconds.
 *
 * @param energy 0 is asleep, 1 is wide awake — everything scales by it, so one number is the
 * difference between a pet dozing in the corner and one that has just been prodded.
 */
export function poseOf(part: Part, t: number, energy = 1): Pose {
  const e = Math.max(0, Math.min(1, energy))
  const s = part.side
  const ph = part.phase
  switch (part.kind) {
    /* paired and symmetric: the side mirrors them, so they beat together */
    case 'wing':
      return { ...STILL, rot: s * Math.sin(t * 7) * 0.55 * e }
    case 'antenna':
      return { ...STILL, rot: s * Math.sin(t * 2.9) * 0.22 * e }
    /* paired and alternating: the phase takes turns, and a leg swinging forward turns the same
       way on both sides — mirroring these would be a creature doing the splits */
    case 'leg':
      return { ...STILL, rot: Math.sin(t * 5 + ph) * 0.16 * e }
    case 'arm':
      return { ...STILL, rot: Math.sin(t * 1.7 + ph) * 0.14 * e }
    /* ⚠️ BOTH, and they do not fight here: the side is the DIRECTION and the phase is the
       TIMING of a spike rather than the sign of a wave. Two ears twitching a moment apart is
       what an animal does; two ears twitching in lockstep is a machine. */
    case 'ear':
      return { ...STILL, rot: s * twitch(t, ph) * 0.3 * e }
    /* ⚠️ NO PHASE. Eyes blink together — desynchronised eyelids do not read as lifelike,
       they read as a rendering fault. */
    case 'eye':
      return { ...STILL, sy: 1 - blink(t) * 0.92 }
    case 'tail':
      return { ...STILL, rot: Math.sin(t * 3.4) * 0.28 * e }
    case 'head':
      return {
        ...STILL,
        rot: Math.sin(t * 0.9) * 0.07 * e,
        dy: Math.sin(t * 2.2 + 0.6) * -0.012 * e,
      }
    default:
      /* breathing: a body is never completely still, and this is the whole difference between a
         picture of an animal and an animal */
      return {
        ...STILL,
        sx: 1 + Math.sin(t * 2.2) * 0.012 * e,
        sy: 1 + Math.sin(t * 2.2) * 0.02 * e,
      }
  }
}

/** a short spike every few seconds, at an offset that is not a round number */
function twitch(t: number, ph: number): number {
  const p = (t + ph) % 3.7
  return p < 0.18 ? Math.sin((p / 0.18) * Math.PI) : 0
}

function blink(t: number): number {
  const p = t % 4.3
  return p < 0.14 ? Math.sin((p / 0.14) * Math.PI) : 0
}

/** The whole pet's own drift, so it is not a rigid thing with moving parts. */
export function bodyPose(t: number, energy = 1): { dy: number; rot: number } {
  const e = Math.max(0, Math.min(1, energy))
  return { dy: Math.sin(t * 1.6) * -0.01 * e, rot: Math.sin(t * 0.55) * 0.02 * e }
}
