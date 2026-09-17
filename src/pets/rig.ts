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

export type PartKind =
  | 'body'
  | 'head'
  | 'wing'
  | 'leg'
  | 'tail'
  | 'ear'
  | 'eye'
  | 'arm'
  | 'antenna'
  | 'mouth'
  | 'pulse'
  | 'spin'
  | 'flame'
  | 'float'
  | 'horn'
  | 'hit'

/**
 * What each name means, in the words people actually use.
 *
 * ⚠️ SUBSTRING, NOT EQUALITY, because nobody names a layer `wing`. They name it "left wing",
 * "wing 2", "Wings". Matching on a substring costs nothing and is the difference between a
 * feature that works for the person who read the instructions and one that works.
 */
const WORDS: Array<[PartKind, string[]]> = [
  /**
   * ⚠️ A LAYER YOU DO NOT SEE UNTIL YOU SWING IT. Everything else in this list is a piece of a
   * creature that is always there; a hit is the one part that is hidden by default, appears for
   * the fraction of a second it is dangerous, and IS the dangerous region while it does. Where
   * you draw it decides everything about the move — how far it reaches, how high it sends
   * somebody, how much it hurts — so the whole of "draw your own attacks" is one layer name.
   *
   * First in the list because it is the one kind that must never be mistaken for something else,
   * and none of its words contains or is contained by anything below.
   */
  ['hit', ['hit', 'attack', 'strike', 'slash', 'swipe', 'blast', 'swing']],
  ['eye', ['eye', 'pupil', 'blink']],
  /**
   * ⚠️ ORDER IS CORRECTNESS HERE, not taste, because these are SUBSTRINGS. "heart" contains
   * "ear" and "gear" contains "ear" — put the ear entry first and a heart becomes an ear and a
   * gear twitches. Anything whose word contains a shorter word below it has to come above it.
   */
  ['pulse', ['heart', 'pulse', 'glow', 'gem', 'core']],
  /**
   * ⚠️ ABOVE 'spin' BECAUSE "fang" CONTAINS "fan", which is exactly the trap the note at the
   * top of this list describes, and I walked into it anyway — checked that none of these words
   * contained a shorter one BELOW them, and missed that one of them contains a shorter one ABOVE.
   * Caught by asking what every new word actually reads as: `fang` came back as a propeller.
   *
   * ⚠️ `claw` IS DELIBERATELY NOT HERE. It has meant a foot since the rig was written, and
   * quietly turning somebody's paw into a weapon changes a creature they already drew.
   *
   * ⚠️ THE LATER ADDITIONS CAME FROM ASKING, NOT FROM GUESSING. Seventy-five plausible layer
   * names were put through partOf and thirty came back as `body`, which is the answer that means
   * "this does nothing" — and a word that does nothing says so nowhere. Most of those thirty were
   * right (a belly, a shoulder and a mane ARE body), but antler, talon, teeth, tooth, fist,
   * tentacle and nose plainly were not. Added with the owner's go-ahead that creatures already
   * drawn may change, which is the cost this list otherwise has to weigh every time.
   */
  ['horn', ['horn', 'spike', 'blade', 'sword', 'tusk', 'fang', 'stinger', 'pincer', 'antler']],
  ['spin', ['wheel', 'rotor', 'propeller', 'gear', 'fan']],
  ['flame', ['flame', 'fire', 'torch', 'candle']],
  ['float', ['halo', 'aura', 'balloon', 'ghost', 'cloud', 'bubble', 'float']],
  ['mouth', ['mouth', 'jaw', 'tongue', 'teeth', 'tooth']],
  ['wing', ['wing', 'flap']],
  ['antenna', ['antenna', 'antennae', 'feeler', 'whisker']],
  ['ear', ['ear']],
  ['tail', ['tail']],
  ['leg', ['leg', 'foot', 'feet', 'paw', 'claw', 'hoof', 'talon']],
  ['arm', ['arm', 'fin', 'hand', 'flipper', 'fist', 'tentacle']],
  ['head', ['head', 'face', 'snout', 'beak', 'nose']],
  ['body', ['body', 'shell', 'torso']],
]

/** the words worth typing, in the order the room lists them — body is what everything else is */
export const PART_WORDS: string[] = [
  'wing',
  'head',
  'leg',
  'tail',
  'ear',
  'eye',
  'arm',
  'antenna',
  'mouth',
  'heart',
  'wheel',
  'flame',
  'halo',
  'horn',
  'hit',
]

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
  mouth: 'opens and closes',
  pulse: 'beats',
  spin: 'spins',
  flame: 'flickers',
  float: 'drifts',
  horn: 'juts out, and hits hardest of anything',
  hit: 'is hidden until you attack with it',
}

/**
 * What a part hangs off, when it hangs off something other than the creature itself.
 *
 * ⚠️ AN EAR IS ON THE HEAD, NOT ON THE ANIMAL. Every part was posed about its own pivot against
 * the body, so a head could bob and tilt while the ears attached to it stayed exactly where they
 * were drawn — the head slid out from under them. Asked for directly: the ears should move with
 * the head. The same is true of an eye, a mouth and a whisker, and it is what makes a face read
 * as a face rather than as five drawings near each other.
 *
 * ⚠️ ONE LEVEL, ON PURPOSE. Anything not named here hangs off the body, which is the whole
 * creature and already moves as one — so a wing or a leg needs no entry and pays no cost. A
 * deeper tree would want joints, a bind pose and an order to resolve them in, which is the rig
 * editor this module exists to avoid. The parts that genuinely ride on another part are the ones
 * on the head, and naming them is the entire hierarchy.
 *
 * ⚠️ BY KIND, so it keeps working for a drawing whose layers are called whatever they are called:
 * the names are already read down to kinds by partOf, and this sits on top of that rather than
 * beside it.
 */
export const PART_PARENT: Partial<Record<PartKind, PartKind>> = {
  ear: 'head',
  eye: 'head',
  mouth: 'head',
  antenna: 'head',
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
/**
 * Which layers are attacks rather than anatomy.
 *
 * ⚠️ READ OFF THE NAMES WITHOUT BUILDING A RIG, because the cheap callers — how wide is this
 * creature, what shape is its canvas — are asked on every frame and must not walk every stroke
 * to find out. `rigOf` answers the same question the expensive way when it is already working.
 */
export function hitLayers(d: Drawing): number[] {
  const out: number[] = []
  d.layers?.forEach((n, i) => {
    if (partOf(n) === 'hit') out.push(i)
  })
  return out
}

/**
 * @param skip layers to leave out — a creature is measured by its body, never by the swing it
 * can throw. Without this, drawing a long slash makes the creature itself render small inside a
 * canvas sized to hold an attack that is invisible almost all of the time.
 */
export function inkBox(d: Drawing, skip: number[] = []): Box | null {
  const keep = skip.length ? d.strokes.filter((k) => !skip.includes(k.l ?? 0)) : d.strokes
  const b = boxOf(keep.length ? keep : d.strokes)
  if (!b) return null
  let fat = 0
  for (const s of keep) if (s.w > fat) fat = s.w
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
  /**
   * ⚠️ THE WHOLE PICTURE, ATTACKS INCLUDED, because this decides the SHAPE OF THE CANVAS and
   * the canvas is what everything is drawn into. Cropping the view to the body alone means a
   * slash drawn beyond the creature lands outside the bitmap and is simply not there — measured:
   * an uppercut drawn above the head rendered exactly zero pixels.
   *
   * ⚠️ WHICH IS NOT THE SAME QUESTION AS HOW BIG THE CREATURE IS. That one is bodyRatio below,
   * and hit detection asks that one — otherwise drawing a bigger attack would make you easier to
   * hit, which is the opposite of what drawing it should do.
   */
  const b = inkBox(d)
  const paper = d.ratio > 0.05 && d.ratio < 20 ? d.ratio : 1
  if (!b) return paper
  const bw = b.x1 - b.x0
  const bh = b.y1 - b.y0
  if (bw <= 0 || bh <= 0) return paper
  return Math.max(0.05, Math.min(20, (bw / bh) * paper))
}

/**
 * The creature's own proportions, with whatever it can swing left out.
 *
 * ⚠️ WHAT YOU ARE, NOT WHAT YOU CAN THROW. petRatio has to include the attacks so the canvas
 * is big enough to draw them in; how wide a target you make must not, or a longer slash would
 * quietly widen your own hitbox.
 */
export function bodyRatio(d: Drawing): number {
  const b = inkBox(d, hitLayers(d))
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
    /**
     * Where it turns.
     *
     * ⚠️ THE JOINT RULE IS NOT RIGHT FOR EVERYTHING, which only became true once there were
     * parts that are not limbs. A wheel hinged at the edge nearest the body does not spin, it
     * swings like a pendulum; a heart that beats about its corner lunges instead of pulsing; a
     * flame is anchored at its base and waves at the top; a jaw hinges at the back. The nearest
     * point to the middle is the right answer for anything that hangs OFF the creature, and the
     * wrong one for anything that sits IN it.
     */
    const mx = (box.x0 + box.x1) / 2
    const my = (box.y0 + box.y1) / 2
    const px =
      kind === 'spin' || kind === 'pulse' || kind === 'flame' || kind === 'mouth'
        ? mx
        : Math.max(box.x0, Math.min(box.x1, cx))
    const py =
      kind === 'spin' || kind === 'pulse'
        ? my
        : kind === 'flame'
          ? box.y1
          : kind === 'mouth'
            ? box.y0
            : Math.max(box.y0, Math.min(box.y1, cy))
    const mid = mx
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
 *
 * ⚠️ IT GOES ABOVE 1, and the ceiling used to be 1, which silently threw away every stance
 * that moves MORE than idle: run asks for 1.7 and alert for 1.15, and both were clamped back to
 * exactly idle's amplitude, so the only thing those stances actually did was run the clock faster.
 * Measured before the fix — a running leg swung no further than a standing one.
 */
export function poseOf(part: Part, t: number, energy = 1): Pose {
  const e = Math.max(0, Math.min(2, energy))
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
    /* ⚠️ Not a sine — a wheel goes round. The only motion here that does not come back. */
    case 'spin':
      return { ...STILL, rot: t * 3.2 * e }
    case 'pulse':
      return { ...STILL, sx: 1 + Math.sin(t * 3) * 0.13 * e, sy: 1 + Math.sin(t * 3) * 0.13 * e }
    /* ⚠️ Fast and small, and taller before it is wider — which is what reads as a flame rather
       than as something being squeezed. Anchored at its base, see the pivot above. */
    case 'flame':
      return {
        ...STILL,
        sx: 1 - Math.sin(t * 11 + 0.6) * 0.06 * e,
        sy: 1 + Math.sin(t * 11) * 0.11 * e,
        rot: Math.sin(t * 7.5) * 0.07 * e,
      }
    /* ⚠️ Slower and further than the body's breath, so a halo reads as hanging in the air
       rather than as part of the creature moving with it. */
    case 'float':
      return { ...STILL, dy: Math.sin(t * 1.1 + ph) * -0.03 * e }
    /* ⚠️ It shuts rather than gapes: 0 to 1 squashed onto the hinge at its top edge, so the
       mouth you drew is the mouth at its widest and everything else is it closing. */
    case 'mouth':
      return { ...STILL, sy: 1 - (0.5 + 0.5 * Math.sin(t * 2.6)) * 0.55 * e }
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

/**
 * What the creature is DOING, as a modulation of the rig rather than as more drawing.
 *
 * ⚠️ NO SECOND SET OF PICTURES, and that is the whole reason this is cheap. Asked how hard it
 * would be to "manage putting the drawings together" for idle, run, crouch and sleep — the answer
 * is that none of them need a drawing. The rig already knows which layer is a leg and which is an
 * eye, so running is the same legs faster and further with the body leaning into it, sleeping is
 * everything slowed almost to nothing with the eyes shut and the body settled down, and crouching
 * is the body squashed and lowered. One creature, five things it can be doing, zero extra work
 * from whoever drew it.
 *
 * ⚠️ IT IS A TUNING, NOT A BRANCH. Every stance is the same poseOf called with time and energy
 * scaled, plus a whole-body adjustment — so a stance cannot forget about a part, and a part added
 * later works in every stance without anybody revisiting this table.
 */
export type Stance = 'idle' | 'alert' | 'run' | 'crouch' | 'sleep' | 'pounce'

export type Mood = {
  stance: Stance
  /** where it is looking, -1 to 1 on each axis. 0,0 is straight ahead. */
  lookX?: number
  lookY?: number
}

export type Tune = {
  /** how fast the clock runs for it */
  rate: number
  /** how far everything moves, on top of energy */
  swing: number
  /** the whole creature leaning, in radians */
  lean: number
  /** and settling, in 0–1 space */
  drop: number
  squashX: number
  squashY: number
  /** eyes shut */
  shut: boolean
}

/**
 * ⚠️ POUNCE IS NOT IN THIS LIST, and that is the difference between it and the other five.
 * These are states: you pick one and the creature stays in it until you pick another, which is
 * what the buttons in the Pets room offer. A pounce is a THING THAT HAPPENS — it runs for about
 * a third of a second and gives the creature back — so offering it as a state you could leave a
 * pet stuck in would be offering the wrong shape of thing. It is triggered, by oneShot.
 */
export const STANCES: Array<[Stance, string]> = [
  ['idle', 'Idle'],
  ['alert', 'Alert'],
  ['run', 'Run'],
  ['crouch', 'Crouch'],
  ['sleep', 'Sleep'],
]

export const TUNE: Record<Stance, Tune> = {
  idle: { rate: 1, swing: 1, lean: 0, drop: 0, squashX: 1, squashY: 1, shut: false },
  /**
   * ⚠️ A LUNGE, AND IT IS STILL ONLY A TUNING. Asked for as an attack alongside the other
   * five, and skipped at the time because it wanted a triggered animation rather than a state.
   * The triggering is the new part — see oneShot — but the POSE needed nothing new at all: thrown
   * forward hard, squashed along its own length, everything moving at twice the rate and half as
   * far again. The same table as every other stance, so a part somebody adds later pounces too
   * without anybody revisiting this.
   */
  pounce: {
    rate: 2.2,
    swing: 1.9,
    lean: 0.3,
    drop: 0.02,
    squashX: 1.14,
    squashY: 0.88,
    shut: false,
  },
  /* braced and quick, standing a little taller — the pose before it does something */
  alert: {
    rate: 1.55,
    swing: 1.15,
    lean: -0.05,
    drop: -0.012,
    squashX: 0.98,
    squashY: 1.04,
    shut: false,
  },
  /* legs and arms at two and a half times, leaning into it, bobbing harder */
  run: { rate: 2.5, swing: 1.7, lean: 0.14, drop: 0, squashX: 1.02, squashY: 0.98, shut: false },
  /* down and wide, and slower because a crouch is a held pose */
  crouch: {
    rate: 0.7,
    swing: 0.55,
    lean: 0.05,
    drop: 0.055,
    squashX: 1.1,
    squashY: 0.76,
    shut: false,
  },
  /* almost still, settled, eyes shut. Not stopped: a sleeping thing still breathes. */
  sleep: {
    rate: 0.32,
    swing: 0.3,
    lean: 0.03,
    drop: 0.035,
    squashX: 1.04,
    squashY: 0.94,
    shut: true,
  },
}

/**
 * How long a pounce lasts, in seconds.
 *
 * ⚠️ SHORT ENOUGH THAT IT READS AS ONE MOVEMENT. Much longer and it is a pose being held,
 * which is the thing a stance already does and does better; much shorter and it is a flicker you
 * cannot tell you caused.
 */
export const POUNCE_FOR = 0.34

/** The whole pet's own drift, so it is not a rigid thing with moving parts. */
export function bodyPose(t: number, energy = 1): { dy: number; rot: number } {
  const e = Math.max(0, Math.min(1, energy))
  return { dy: Math.sin(t * 1.6) * -0.01 * e, rot: Math.sin(t * 0.55) * 0.02 * e }
}
