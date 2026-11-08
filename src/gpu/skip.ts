/**
 * The Lab's stone-skipping game: a throw, the flight it makes over a lake, every touch of the water
 * and what each challenge asks of it. Pure, so skip.test.ts can throw a thousand stones without a GPU.
 *
 * ⚠️ A TOY MODEL, AND THE PAGE SAYS SO. It borrows the shape of Clanet, Hersen & Bocquet's
 * experiments (Nature 427, 2004): a stone skips best when its face meets the water tilted about 20°,
 * it cannot skip if it comes in steeper than about 45°, and below a few metres a second it sinks.
 * Those three facts are built in. Everything else — how much speed a bounce costs, how the tilt
 * creeps up as spin dies — is tuned so a good throw makes tens of skips and a careless one two or
 * three, which is what people manage. It is not a fluid simulation and makes no measured claim.
 *
 * Units: metres, seconds, degrees. x along the lake from the thrower's feet, y up from the water.
 */

export const G = 9.81
/** where the stone leaves the hand: a low side-arm throw */
export const HAND = 1
/** the tilt at which a stone skips best — the experiments' "magic angle" */
export const BEST_TILT = 20
/** steeper than this, a stone at the best tilt goes in instead of skipping */
export const STEEPEST = 45
/** slower than this along the water, nothing skips */
export const SLOWEST = 2.5
/** the step the flight is worked out in */
export const DT = 1 / 600

export type Throw = {
  /** m/s, leaving the hand */
  speed: number
  /** degrees above the horizontal (negative: thrown down at the water) */
  angle: number
  /** degrees: the stone's face against the water. 20 is best */
  tilt: number
}

/** how well a tilt skips, 0 to 1: best at 20°, gone by about 50° and below about 0° */
export const tiltQuality = (tilt: number) => Math.exp(-(((tilt - BEST_TILT) / 14) ** 2))

/** the steepest a stone can come in and still skip, at a tilt */
export const steepest = (tilt: number) => STEEPEST * Math.sqrt(tiltQuality(tilt))
/** the slowest it can be going and still skip, at a tilt */
export const slowest = (tilt: number) => SLOWEST / Math.max(0.05, tiltQuality(tilt))

export type Touch = {
  x: number
  /** seconds after the throw */
  t: number
  /** the angle it came in at, degrees below the horizontal */
  incoming: number
  /** speed along the water before and after */
  before: number
  after: number
}

export type Course = {
  /** a bridge to pass under: its deck spans x from `at` to `at + width`, its underside `clear` up */
  bridge?: { at: number; width: number; clear: number }
  /** where the far shore starts */
  shore: number
}

export type End = 'sank' | 'shore' | 'bridge'
export type Flight = {
  /** the stone's place every 1/60 s: x, y, tilt */
  path: [number, number, number][]
  touches: Touch[]
  skips: number
  /** how far it got: where it sank, hit or reached */
  distance: number
  end: End
  /** seconds from throw to end */
  time: number
}

/**
 * The whole flight, worked out at once: a ballistic arc (air drag is small for a stone at these
 * speeds and is left out), and at each touch of the water either a skip or the end. The UI replays
 * `path`; nothing is decided while it plays.
 */
export function fly(t: Throw, course: Course): Flight {
  const a = (t.angle * Math.PI) / 180
  let x = 0
  let y = HAND
  let vx = t.speed * Math.cos(a)
  let vy = t.speed * Math.sin(a)
  let tilt = t.tilt
  // spin comes from the throw: a faster flick spins it faster, and spin is what holds the tilt
  let spin = t.speed * 0.9
  let time = 0
  const path: [number, number, number][] = [[x, y, tilt]]
  const touches: Touch[] = []
  let end: End = 'sank'
  let sinceFrame = 0
  for (let step = 0; step < 600 * 120; step++) {
    vy -= G * DT
    x += vx * DT
    y += vy * DT
    time += DT
    sinceFrame += DT
    if (sinceFrame >= 1 / 60 - 1e-9) {
      sinceFrame = 0
      path.push([x, Math.max(0, y), tilt])
    }
    const b = course.bridge
    if (b && x >= b.at && x <= b.at + b.width && y >= b.clear) {
      end = 'bridge'
      break
    }
    if (x >= course.shore) {
      end = 'shore'
      x = course.shore
      break
    }
    if (y > 0 || vy >= 0) continue
    // a touch: skip, or go in
    const incoming = (Math.atan2(-vy, vx) * 180) / Math.PI
    const before = vx
    if (incoming > steepest(tilt) || vx < slowest(tilt)) {
      touches.push({ x, t: time, incoming, before, after: 0 })
      end = 'sank'
      break
    }
    const q = tiltQuality(tilt)
    // the bounce costs speed — least at the best tilt, more for a steep entry
    vx *= 1 - (0.035 + 0.12 * (1 - q) + 0.08 * (incoming / 45) ** 2)
    // it leaves with part of its fall and a little planing lift, which is why hops shrink
    vy = 0.5 * -vy + 0.035 * vx
    y = 0
    // each touch bleeds spin, and as the spin dies a tilt that is off wobbles further off — the
    // way it was already leaning, or nose-up from the best — until it is too steep or too flat
    spin *= 0.93
    tilt += (tilt < BEST_TILT ? -1 : 1) * (1.3 / (1 + spin / 4))
    touches.push({ x, t: time, incoming, before, after: vx })
    path.push([x, 0, tilt])
  }
  if (path[path.length - 1][0] !== x) path.push([x, Math.max(0, y), tilt])
  return {
    path,
    touches,
    skips: touches.filter((h) => h.after > 0).length,
    distance: x,
    end,
    time,
  }
}

/* ----------------------------------------------------------------------- throwing it */

/** the drag-back that aims a throw: how far (0–1 of the most) and which way, in degrees */
export const SPEEDS = { min: 4, max: 20 }
export const ANGLES = { min: -20, max: 30 }
export function aim(pull: number, angle: number): Pick<Throw, 'speed' | 'angle'> {
  const p = Math.max(0, Math.min(1, pull))
  return {
    speed: SPEEDS.min + (SPEEDS.max - SPEEDS.min) * p,
    angle: Math.max(ANGLES.min, Math.min(ANGLES.max, angle)),
  }
}

/** the stone wobbles in the hand: its tilt swings 0° to 60° and back every WOBBLE seconds, and the
 *  moment you let go picks the tilt it flies with. The skill is letting go near 20°. */
export const WOBBLE = 1.6
export const wobble = (t: number) => 30 - 30 * Math.cos((2 * Math.PI * t) / WOBBLE)

/* --------------------------------------------------------------------------- challenges */

export type Goal =
  | { kind: 'skips'; n: number }
  | { kind: 'reach'; x: number }
  | { kind: 'shore' }
  | { kind: 'under'; skips: number }

export type Challenge = { id: string; name: string; goal: Goal; course: Course; hint: string }

const LAKE: Course = { shore: 60 }
export const CHALLENGES: Challenge[] = [
  {
    id: 'three',
    name: 'Three skips',
    goal: { kind: 'skips', n: 3 },
    course: LAKE,
    hint: 'Pull back, and let go while the stone is nearly flat.',
  },
  {
    id: 'buoy',
    name: 'Past the buoy',
    goal: { kind: 'reach', x: 20 },
    course: LAKE,
    hint: 'A harder pull goes further — but only if it still skips.',
  },
  {
    id: 'ten',
    name: 'Ten skips',
    goal: { kind: 'skips', n: 10 },
    course: LAKE,
    hint: 'Throw flat: aim along the water, not up at the sky.',
  },
  {
    id: 'bridge',
    name: 'Under the bridge',
    goal: { kind: 'under', skips: 3 },
    course: { shore: 60, bridge: { at: 14, width: 3, clear: 0.8 } },
    hint: 'Keep it low: a stone skipping high hits the bridge.',
  },
  {
    id: 'shore',
    name: 'The far bank',
    goal: { kind: 'shore' },
    course: { shore: 34 },
    hint: 'Skip all the way across.',
  },
  {
    id: 'twenty',
    name: 'Twenty skips',
    goal: { kind: 'skips', n: 20 },
    course: LAKE,
    hint: 'Fast, flat, and at the magic tilt.',
  },
]

export function judge(c: Challenge, f: Flight): boolean {
  const g = c.goal
  switch (g.kind) {
    case 'skips':
      return f.skips >= g.n
    case 'reach':
      return f.distance >= g.x
    case 'shore':
      return f.end === 'shore'
    case 'under': {
      const b = c.course.bridge!
      return f.end !== 'bridge' && f.distance > b.at + b.width && f.skips >= g.skips
    }
  }
}

/** a sentence about a flight, for the page and for a screen reader */
export function describe(f: Flight): string {
  const skips = f.skips === 1 ? '1 skip' : `${f.skips} skips`
  const where =
    f.end === 'shore'
      ? 'and reached the far bank'
      : f.end === 'bridge'
        ? 'and hit the bridge'
        : `and sank ${f.distance.toFixed(1)} m out`
  return `${skips}, ${where}.`
}

/* ---------------------------------------------------------------------------- what is kept */

export const SKIP_KEY = 'lab_skip_v1'
export type Saved = { best: number; furthest: number; done: string[] }
export const EMPTY: Saved = { best: 0, furthest: 0, done: [] }
export function readSaved(text: string | null): Saved {
  let v: unknown
  try {
    v = JSON.parse(text ?? 'null')
  } catch {
    return { ...EMPTY, done: [] }
  }
  const out: Saved = { ...EMPTY, done: [] }
  if (typeof v !== 'object' || !v || Array.isArray(v)) return out
  const o = v as Record<string, unknown>
  if (Number.isInteger(o.best) && (o.best as number) >= 0 && (o.best as number) <= 1000)
    out.best = o.best as number
  if (Number.isFinite(o.furthest) && (o.furthest as number) >= 0 && (o.furthest as number) <= 1000)
    out.furthest = o.furthest as number
  if (Array.isArray(o.done)) {
    const ids = new Set(CHALLENGES.map((c) => c.id))
    out.done = [...new Set(o.done.filter((d): d is string => typeof d === 'string' && ids.has(d)))]
  }
  return out
}
