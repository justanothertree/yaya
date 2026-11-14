/**
 * The arithmetic of the Lab's strut: a creature whose step sequencer is at once its gait and its
 * song. Each muscle is a row of sixteen steps; where a step is lit the muscle pulls in and plays its
 * note — longer muscles lower, shorter higher — and wherever a foot comes down on the ground, a drum.
 * So a pattern that walks well is also a groove, and a groove you like either walks or falls over.
 *
 * The body is Critters' (the same joints, bones and muscles, the same checks, the same position-based
 * physics constants); what drives the muscles is new — a grid, not a brain — and so is what comes out:
 * notes and footfalls, which the GPU paints as ink on the floor the creature walks over, a picture of
 * the song that can be kept. strut.test.ts walks the presets and listens to them.
 */

import {
  DRAG,
  DT,
  FRICTION,
  G,
  ITERATIONS,
  MAX_BONES,
  MAX_JOINTS,
  muscles,
  problem,
  standUp,
  type Body,
  type V2,
} from './critters'

export const STEPS = 16
export const MAX_MUSCLES = 8
/** a lit step pulls a muscle in to this fraction of its rest; an unlit one lets it out to this */
export const PULL = 0.72
export const RELAX = 1.08
/** how quickly a muscle reaches its target length, seconds */
export const EASE = 0.05

export type Pattern = {
  /** per muscle (in the order the body lists them), which of the sixteen steps pull */
  rows: boolean[][]
  bpm: number
  instrument: Voice
  /** the scale's root, a MIDI note */
  root: number
}
export const VOICES = ['marimba', 'kalimba', 'vibes', 'pluck', 'bell', 'steelpan'] as const
export type Voice = (typeof VOICES)[number]

/** a sixteenth note at this tempo, seconds */
export const stepLength = (bpm: number) => 60 / bpm / 4

const PENTATONIC = [0, 2, 4, 7, 9]
/**
 * Each muscle's note: the muscles sorted longest first climb a pentatonic scale from the root, so a
 * long muscle is a low note and a short one high. ⚠️ Muscles of the same length take neighbouring
 * notes, in the order the body lists them — at first they shared one, and a symmetric creature (most
 * of them, and the Stomper) played a single pitch over and over.
 */
export function notes(body: Body, root: number): number[] {
  const lens = body.bones
    .filter((b) => b.muscle)
    .map((b) =>
      Math.hypot(
        body.joints[b.b][0] - body.joints[b.a][0],
        body.joints[b.b][1] - body.joints[b.a][1],
      ),
    )
  const order = lens
    .map((_, i) => i)
    .sort((a, b) => (Math.abs(lens[b] - lens[a]) < 0.005 ? 0 : lens[b] - lens[a]) || a - b)
  const rank = new Array<number>(lens.length)
  order.forEach((m, k) => (rank[m] = k))
  return rank.map((k) => root + 12 * Math.floor(k / 5) + PENTATONIC[k % 5])
}

/**
 * Each joint's drum, by where it stands: the feet (joints touching the ground at rest), left to
 * right, alternate kick and snare; joints higher up are toms and a cowbell, struck only when the
 * creature stumbles onto them. MIDI notes the synth's drum kit reads by their pitch class.
 */
export function drums(body: Body): number[] {
  const s = standUp(body)
  const order = s.map((_, i) => i).sort((a, b) => s[a][0] - s[b][0])
  const feet = order.filter((i) => s[i][1] < 0.05)
  const high = [40, 41, 43, 46]
  const out = new Array<number>(s.length)
  feet.forEach((j, k) => (out[j] = k % 2 === 0 ? 36 : 38))
  order.filter((i) => s[i][1] >= 0.05).forEach((j, k) => (out[j] = high[k % high.length]))
  return out
}

export type StrutState = {
  x: Float64Array
  y: Float64Array
  vx: Float64Array
  vy: Float64Array
  /** each muscle's length now */
  len: Float64Array
  /** time, seconds */
  t: number
}
export type Event =
  | { kind: 'note'; muscle: number; step: number }
  | { kind: 'foot'; joint: number; speed: number }

export function startStrut(body: Body): StrutState {
  const s = standUp(body)
  const rest = body.bones
    .filter((b) => b.muscle)
    .map((b) =>
      Math.hypot(
        body.joints[b.b][0] - body.joints[b.a][0],
        body.joints[b.b][1] - body.joints[b.a][1],
      ),
    )
  return {
    x: Float64Array.from(s.map((p) => p[0])),
    y: Float64Array.from(s.map((p) => p[1])),
    vx: new Float64Array(s.length),
    vy: new Float64Array(s.length),
    len: Float64Array.from(rest),
    t: 0,
  }
}

/** which step of the bar time t falls in */
export const stepAt = (t: number, bpm: number) => Math.floor(t / stepLength(bpm) + 1e-9) % STEPS

/**
 * `n` physics substeps: the muscles ease toward their step's length; gravity, Jacobi passes over the
 * bones, ground friction, as Critters. Returns what happened — a muscle starting a lit step (a note),
 * a joint landing on the ground hard enough to hear (a drum) — in order.
 */
export function strut(body: Body, p: Pattern, s: StrutState, n: number): Event[] {
  const events: Event[] = []
  const nj = body.joints.length
  const rest = body.bones.map((b) =>
    Math.hypot(
      body.joints[b.b][0] - body.joints[b.a][0],
      body.joints[b.b][1] - body.joints[b.a][1],
    ),
  )
  const muscleOf: number[] = []
  let m = 0
  for (const b of body.bones) muscleOf.push(b.muscle ? m++ : -1)
  const px = new Float64Array(nj)
  const py = new Float64Array(nj)
  const dx = new Float64Array(nj)
  const dy = new Float64Array(nj)
  const cnt = new Float64Array(nj)
  const ease = 1 - Math.exp(-DT / EASE)
  for (let k = 0; k < n; k++) {
    const step = stepAt(s.t, p.bpm)
    // a new step starts this substep (or the very first): every muscle lit on it sounds its note
    const fresh = s.t === 0 || stepAt(s.t - DT, p.bpm) !== step
    muscleOf.forEach((mi, i) => {
      if (mi < 0) return
      const on = p.rows[mi]?.[step] ?? false
      if (on && fresh) events.push({ kind: 'note', muscle: mi, step })
      const target = rest[i] * (on ? PULL : RELAX)
      s.len[mi] += (target - s.len[mi]) * ease
    })
    for (let i = 0; i < nj; i++) {
      s.vx[i] *= 1 - DRAG * DT
      s.vy[i] *= 1 - DRAG * DT
      s.vy[i] -= G * DT
      px[i] = s.x[i]
      py[i] = s.y[i]
      s.x[i] += s.vx[i] * DT
      s.y[i] += s.vy[i] * DT
    }
    for (let it = 0; it < ITERATIONS; it++) {
      dx.fill(0)
      dy.fill(0)
      cnt.fill(0)
      body.bones.forEach((b, i) => {
        const want = muscleOf[i] >= 0 ? s.len[muscleOf[i]] : rest[i]
        const ex = s.x[b.b] - s.x[b.a]
        const ey = s.y[b.b] - s.y[b.a]
        const d = Math.hypot(ex, ey) || 1e-9
        const c = (0.5 * (d - want)) / d
        dx[b.a] += ex * c
        dy[b.a] += ey * c
        dx[b.b] -= ex * c
        dy[b.b] -= ey * c
        cnt[b.a]++
        cnt[b.b]++
      })
      for (let i = 0; i < nj; i++) {
        if (cnt[i] === 0) continue
        s.x[i] += dx[i] / cnt[i]
        s.y[i] += dy[i] / cnt[i]
      }
    }
    for (let i = 0; i < nj; i++) {
      if (s.y[i] < 0) {
        // a landing: it was in the air a moment ago and came down fast enough to hear
        const speed = -s.vy[i]
        if (py[i] > 0.004 && speed > 0.35) events.push({ kind: 'foot', joint: i, speed })
        s.y[i] = 0
        s.x[i] = px[i] + (s.x[i] - px[i]) * (1 - FRICTION)
      }
      s.vx[i] = (s.x[i] - px[i]) / DT
      s.vy[i] = (s.y[i] - py[i]) / DT
    }
    s.t += DT
  }
  return events
}

/**
 * The dance itself: a faint dot under every joint, laid every few frames, so the walk leaves the
 * curves its joints traced as well as its notes. Eight floats a dot, as the blots.
 */
export function trailFor(s: StrutState): number[] {
  const out: number[] = []
  for (let i = 0; i < s.x.length; i++) out.push(s.x[i], s.y[i], 0.022, 2, 0.35, 0.3, 0.12, 0.15)
  return out
}

export const middleOf = (s: StrutState) => s.x.reduce((a, b) => a + b, 0) / s.x.length

/* ---------------------------------------------------------------- presets -------------------- */

const row = (s: string) => [...s].map((c) => c === 'x')

export const STRUTS: Record<string, { name: string; body: Body; pattern: Pattern }> = {
  stomper: {
    name: 'Stomper',
    body: {
      joints: [
        [-0.5, 0.6],
        [0.5, 0.6],
        [-0.5, 0.9],
        [0.5, 0.9],
        [-0.6, 0.05],
        [0.6, 0.05],
      ],
      bones: [
        { a: 0, b: 1, muscle: false },
        { a: 2, b: 3, muscle: false },
        { a: 0, b: 2, muscle: false },
        { a: 1, b: 3, muscle: false },
        { a: 0, b: 3, muscle: false },
        { a: 0, b: 4, muscle: false },
        { a: 2, b: 4, muscle: true },
        { a: 1, b: 5, muscle: false },
        { a: 3, b: 5, muscle: true },
      ],
    },
    pattern: {
      // found by searching 400 grooves for the furthest that stays upright (14.5 m in 8 bars)
      rows: [row('xxxx...xxxxx...x'), row('...xxxx....xxxx.')],
      bpm: 100,
      instrument: 'marimba',
      root: 48,
    },
  },
  inchworm: {
    name: 'Inchworm',
    body: {
      joints: [
        [-0.6, 0.1],
        [-0.2, 0.3],
        [0.2, 0.3],
        [0.6, 0.1],
        [-0.2, 0.1],
        [0.2, 0.1],
      ],
      bones: [
        { a: 0, b: 1, muscle: false },
        { a: 1, b: 2, muscle: true },
        { a: 2, b: 3, muscle: false },
        { a: 0, b: 4, muscle: false },
        { a: 4, b: 1, muscle: true },
        { a: 4, b: 5, muscle: true },
        { a: 5, b: 2, muscle: true },
        { a: 5, b: 3, muscle: false },
        { a: 1, b: 5, muscle: false },
      ],
    },
    pattern: {
      // the same search: 5.5 m in 8 bars, never higher than it is
      rows: [
        row('xxxx....xxxx....'),
        row('x..xxxxxx..xxxxx'),
        row('...xxxx....xxxx.'),
        row('.....xxx.....xxx'),
      ],
      bpm: 120,
      instrument: 'kalimba',
      root: 55,
    },
  },
}

/* ---------------------------------------------------------------- keeping one ---------------- */

export const STRUT_KEY = 'lab_strut_v1'

/**
 * A strut from untrusted JSON. ⚠️ DATA, NEVER CODE: the body must pass Critters' own check and fit
 * this toy's limits; the grid is booleans only, one row a muscle, sixteen steps; tempo, voice and
 * root are clamped or chosen from a list. Anything else is refused, not repaired.
 */
export function readStrut(text: string | null): { body: Body; pattern: Pattern } | null {
  if (!text || text.length > 50_000) return null
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return null
  }
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const b = (r.body ?? {}) as Record<string, unknown>
  const p = (r.pattern ?? {}) as Record<string, unknown>
  if (!Array.isArray(b.joints) || !Array.isArray(b.bones) || !Array.isArray(p.rows)) return null
  if (b.joints.length > MAX_JOINTS || b.bones.length > MAX_BONES) return null
  const fin = (x: unknown, lo: number, hi: number) =>
    typeof x === 'number' && Number.isFinite(x) ? Math.max(lo, Math.min(hi, x)) : NaN
  const joints = b.joints.map(
    (j): V2 => (Array.isArray(j) ? [fin(j[0], -3, 3), fin(j[1], 0, 3)] : [NaN, NaN]),
  )
  if (joints.some((j) => j.some(Number.isNaN))) return null
  const bones = b.bones.map((x) => {
    const o = (x ?? {}) as Record<string, unknown>
    return { a: Number(o.a), b: Number(o.b), muscle: o.muscle === true }
  })
  const body = { joints, bones }
  if (problem(body) || muscles(body) > MAX_MUSCLES) return null
  if (p.rows.length !== muscles(body)) return null
  if (
    !p.rows.every(
      (r2) => Array.isArray(r2) && r2.length === STEPS && r2.every((c) => typeof c === 'boolean'),
    )
  )
    return null
  const bpm = fin(p.bpm, 50, 180)
  return {
    body,
    pattern: {
      rows: (p.rows as boolean[][]).map((r2) => [...r2]),
      bpm: Number.isNaN(bpm) ? 100 : bpm,
      instrument: (VOICES as readonly string[]).includes(p.instrument as string)
        ? (p.instrument as Voice)
        : 'marimba',
      root: Math.round(Number.isNaN(fin(p.root, 36, 72)) ? 48 : fin(p.root, 36, 72)),
    },
  }
}

/**
 * The fewest bars any creature has taken to reach the flag, kept apart from the creature itself:
 * the creation is rewritten on every edit, and a best kept inside it would be one forgotten field
 * away from being erased. A best is a positive number of bars under a thousand, or nothing.
 */
export const STRUT_BEST_KEY = 'lab_strut_best_v1'
export function readBest(text: string | null): number | null {
  let v: unknown
  try {
    v = JSON.parse(text ?? 'null')
  } catch {
    return null
  }
  return typeof v === 'number' && Number.isFinite(v) && v > 0 && v < 1000 ? v : null
}
/** the kept best after reaching the flag in `bars`: never slower */
export const fewestBars = (best: number | null, bars: number) =>
  best === null || bars < best ? bars : best

/** a fresh grid for a body: nothing lit */
export const emptyRows = (body: Body) =>
  Array.from({ length: muscles(body) }, () => Array<boolean>(STEPS).fill(false))

/* ---------------------------------------------------------------- for the GPU ---------------- */

/** the painting: the strip of floor it covers, in metres, and its pixels a metre */
export const INK = { x0: -3, x1: 29, y0: -0.6, y1: 3.4, ppm: 48 } as const
export const inkSize = (): [number, number] => [
  Math.round((INK.x1 - INK.x0) * INK.ppm),
  Math.round((INK.y1 - INK.y0) * INK.ppm),
]
/** the parade's finish line, metres from the start */
export const FINISH = 24
export const MAX_SPLATS = 64
/** where the root note is painted, metres up the paper, and how much higher each semitone goes */
export const PITCH_FLOOR = 0.45
export const PITCH_STEP = 0.11

/** Hand-packed to match `struct Paint` — strut.test.ts lays the struct out from the shader. */
export const PAINT = {
  size: 0,
  ink: 8,
  origin: 16,
  cam: 24,
  ppm: 32,
  scale: 36,
  splats: 40,
  bones: 44,
  joints: 48,
  finish: 52,
  time: 56,
  bytes: 64,
} as const

export function packPaint(
  p: {
    w: number
    h: number
    cam: V2
    scale: number
    splats: number
    bones: number
    joints: number
    time: number
  },
  into = new ArrayBuffer(PAINT.bytes),
) {
  const u = new Uint32Array(into)
  const f = new Float32Array(into)
  const [iw, ih] = inkSize()
  u.set([p.w, p.h, iw, ih], 0)
  f.set([INK.x0, INK.y0], PAINT.origin / 4)
  f.set(p.cam, PAINT.cam / 4)
  f[PAINT.ppm / 4] = INK.ppm
  f[PAINT.scale / 4] = p.scale
  u[PAINT.splats / 4] = p.splats
  u[PAINT.bones / 4] = p.bones
  u[PAINT.joints / 4] = p.joints
  f[PAINT.finish / 4] = FINISH
  f[PAINT.time / 4] = p.time
  return into
}

/** a colour for a pitch: the twelve pitch classes round the colour wheel, so a key is a palette */
export function hueOf(midi: number): [number, number, number] {
  const h = (((midi % 12) + 12) % 12) / 12
  const k = (n: number) => (n + h * 6) % 6
  const f = (n: number) => 1 - Math.max(0, Math.min(k(n), 4 - k(n), 1))
  return [f(5), f(3), f(1)]
}

/**
 * What the events of a frame paint, two vec4fs each: (x, y, radius, 0) and the pigment (r, g, b,
 * wetness). ⚠️ PIGMENT ABSORBS: the paint is the colour a stroke takes OUT of the paper, so a red
 * note is laid down as (0, 1, 1) — what red paper reflection lacks — and overlapping notes darken
 * and mix the way watercolour does rather than adding up to white.
 */
export function splatsFor(
  events: readonly Event[],
  body: Body,
  p: Pattern,
  s: StrutState,
): number[] {
  const out: number[] = []
  const tones = notes(body, p.root)
  const muscleBones = body.bones.filter((b) => b.muscle)
  for (const e of events) {
    if (out.length / 8 >= MAX_SPLATS) break
    if (e.kind === 'note') {
      const b = muscleBones[e.muscle]
      if (!b) continue
      /* where the creature is along the floor, and as high up the paper as the note is up the
         scale — a score in watercolour. ⚠️ At first a note was laid where its muscle was, and a slow
         walker stacked every colour on one spot until it dried to black */
      const x = (s.x[b.a] + s.x[b.b]) / 2
      const y = PITCH_FLOOR + (tones[e.muscle] - p.root) * PITCH_STEP
      const c = hueOf(tones[e.muscle])
      out.push(x, y, 0.13, 0, (1 - c[0]) * 0.6, (1 - c[1]) * 0.6, (1 - c[2]) * 0.6, 1)
    } else {
      // a footfall: a dark stamp where it landed, bigger the harder it came down
      out.push(s.x[e.joint], 0.02, 0.06 + Math.min(0.12, e.speed * 0.05), 1, 0.6, 0.62, 0.7, 0.6)
    }
  }
  return out
}
