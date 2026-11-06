/**
 * The arithmetic of the Lab's critters: a little creature you build from joints, bones and
 * muscles, and a race of 256 copies of it that learn, generation by generation, to walk.
 *
 * ⚠️ THE RACE RUNS ON THE GPU, A WORKGROUP A CREATURE, AND THIS FILE HOLDS A COPY OF IT. Each copy
 * is the same body with its own "brain" — every muscle's timing and strength, and the beat they
 * share — and its joints are stepped by position-based dynamics in the workgroup's shared memory:
 * gravity, the bones and the pulsing muscles as distance constraints (Jacobi, so the order threads
 * run in cannot matter), the ground with friction to push against. `simulate` is that, line for
 * line, so critters.test.ts can ask it questions and the GPU probe can hold the shader to it.
 * Choosing which brains breed is ordinary game logic and stays here, seeded, so a race can be
 * replayed.
 */

export type V2 = [number, number]
export type Bone = { a: number; b: number; muscle: boolean }
export type Body = { joints: V2[]; bones: Bone[] }
/** a brain: each muscle's phase (0..1) and strength (0..1), and the beat, beats a second */
export type Brain = { phase: number[]; strength: number[]; beat: number }

export const MAX_JOINTS = 16
export const MAX_BONES = 32
export const MAX_DEGREE = 8
export const POPULATION = 256
/** physics: a substep, constraint passes a substep, gravity, ground friction, muscle reach */
export const DT = 1 / 240
export const ITERATIONS = 6
export const G = 9.8
export const FRICTION = 0.85
export const REACH = 0.2
/** the air: a joint's speed fades by this much a second */
export const DRAG = 1.5
/** the fastest a brain may beat: much faster and the winners are the ones that fling themselves
   into the sky — measured, a 0.8 m hopper 5.8 m along in one second, most of it in the air */
export const MAX_BEAT = 1.5
/** seconds a generation runs */
export const GENERATION = 8

export const muscles = (body: Body) => body.bones.filter((b) => b.muscle).length

/* ---------------------------------------------------------------- bodies --------------------- */

export const PRESETS: Record<string, { name: string; body: Body }> = {
  hopper: {
    name: 'Hopper',
    body: {
      joints: [
        [-0.4, 0.1],
        [0.4, 0.1],
        [0, 0.6],
      ],
      bones: [
        { a: 0, b: 1, muscle: true },
        { a: 0, b: 2, muscle: false },
        { a: 1, b: 2, muscle: true },
      ],
    },
  },
  worm: {
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
  },
  quad: {
    name: 'Walker',
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
  },
}

const dist = (a: V2, b: V2) => Math.hypot(a[0] - b[0], a[1] - b[1])

/**
 * Whether a body can be raced, and if not, the sentence that says why. ⚠️ ALSO THE CHECK A FILE
 * MUST PASS: limits, every bone between two different joints that exist, no bone twice, no bone
 * too short to mean anything, at least one muscle, and every joint joined to the rest.
 */
export function problem(body: Body): string | null {
  const n = body.joints.length
  if (n < 2) return 'A critter needs at least two joints.'
  if (n > MAX_JOINTS) return `A critter can have ${MAX_JOINTS} joints at most.`
  if (body.bones.length > MAX_BONES) return `A critter can have ${MAX_BONES} bones at most.`
  const seen = new Set<string>()
  const degree = new Array<number>(n).fill(0)
  for (const b of body.bones) {
    if (
      !Number.isInteger(b.a) ||
      !Number.isInteger(b.b) ||
      b.a < 0 ||
      b.b < 0 ||
      b.a >= n ||
      b.b >= n ||
      b.a === b.b
    )
      return 'A bone joins two different joints.'
    const key = `${Math.min(b.a, b.b)}-${Math.max(b.a, b.b)}`
    if (seen.has(key)) return 'Two bones join the same joints.'
    seen.add(key)
    if (dist(body.joints[b.a], body.joints[b.b]) < 0.05) return 'A bone is too short.'
    degree[b.a]++
    degree[b.b]++
  }
  if (degree.some((d) => d > MAX_DEGREE)) return `A joint can hold ${MAX_DEGREE} bones at most.`
  if (!body.bones.some((b) => b.muscle))
    return 'It needs at least one muscle to move — tap a bone with 💪 Muscle.'
  // joined up: every joint reachable from the first
  const reach = new Set([0])
  for (let changed = true; changed; ) {
    changed = false
    for (const b of body.bones)
      if (reach.has(b.a) !== reach.has(b.b)) {
        reach.add(b.a)
        reach.add(b.b)
        changed = true
      }
  }
  if (reach.size < n) return 'Some joints are not joined to the rest.'
  return null
}

/**
 * Whether a body is its own mirror image with a single muscle — the one shape that cannot walk at
 * all: every push it makes is matched by the same push the other way, so its middle never moves
 * (measured: a hand-built triangle with one muscle in its base raced four generations, 1,024
 * critters, for 0.00 m). More muscles give a brain a way to break the tie.
 */
export function stuck(body: Body): boolean {
  if (muscles(body) !== 1) return false
  const mid = body.joints.reduce((s, j) => s + j[0], 0) / body.joints.length
  const mirror = body.joints.map(([x, y]) =>
    body.joints.findIndex(
      ([x2, y2]) => Math.abs(2 * mid - x - x2) < 1e-6 && Math.abs(y - y2) < 1e-6,
    ),
  )
  if (mirror.some((m) => m < 0)) return false
  const key = (a: number, b: number) => `${Math.min(a, b)}-${Math.max(a, b)}`
  const bones = new Map(body.bones.map((b) => [key(b.a, b.b), b.muscle]))
  return body.bones.every((b) => bones.get(key(mirror[b.a], mirror[b.b])) === b.muscle)
}

/** the body set down: its lowest joint on the ground, and centred on x = 0 */
export function standUp(body: Body): V2[] {
  const low = Math.min(...body.joints.map((j) => j[1]))
  const mid = body.joints.reduce((s, j) => s + j[0], 0) / body.joints.length
  return body.joints.map(([x, y]) => [x - mid, y - low + 0.02])
}

/* ---------------------------------------------------------------- the race ------------------- */

/** a muscle's length now: its rest length, pulsing with its brain */
export function muscleLength(
  rest: number,
  phase: number,
  strength: number,
  beat: number,
  t: number,
) {
  return rest * (1 + REACH * strength * Math.sin(2 * Math.PI * (beat * t + phase)))
}

export type State = { x: Float64Array; y: Float64Array; vx: Float64Array; vy: Float64Array }

export function fresh(body: Body): State {
  const s = standUp(body)
  const n = s.length
  return {
    x: Float64Array.from(s.map((p) => p[0])),
    y: Float64Array.from(s.map((p) => p[1])),
    vx: new Float64Array(n),
    vy: new Float64Array(n),
  }
}

/**
 * `steps` substeps of one creature, from time `t0`, as the shader does them: gravity, a guess,
 * ITERATIONS Jacobi passes over the bones (each joint averages what its bones ask of it), the
 * ground with friction, and the velocity from the move.
 */
export function simulate(body: Body, brain: Brain, s: State, t0: number, steps: number) {
  const n = body.joints.length
  const rest = body.bones.map((b) => dist(body.joints[b.a], body.joints[b.b]))
  const muscleOf = body.bones.map((_, i) => body.bones.slice(0, i).filter((b) => b.muscle).length)
  const px = new Float64Array(n)
  const py = new Float64Array(n)
  const dx = new Float64Array(n)
  const dy = new Float64Array(n)
  const cnt = new Float64Array(n)
  for (let k = 0; k < steps; k++) {
    const t = t0 + k * DT
    for (let i = 0; i < n; i++) {
      s.vx[i] *= 1 - DRAG * DT
      s.vy[i] *= 1 - DRAG * DT
      s.vy[i] -= G * DT
      px[i] = s.x[i]
      py[i] = s.y[i]
      s.x[i] += s.vx[i] * DT
      s.y[i] += s.vy[i] * DT
    }
    const len = body.bones.map((b, i) => {
      if (!b.muscle) return rest[i]
      const m = muscleOf[i]
      return muscleLength(rest[i], brain.phase[m] ?? 0, brain.strength[m] ?? 0, brain.beat, t)
    })
    for (let it = 0; it < ITERATIONS; it++) {
      dx.fill(0)
      dy.fill(0)
      cnt.fill(0)
      body.bones.forEach((b, i) => {
        const ex = s.x[b.b] - s.x[b.a]
        const ey = s.y[b.b] - s.y[b.a]
        const d = Math.hypot(ex, ey) || 1e-9
        const c = (0.5 * (d - len[i])) / d
        dx[b.a] += ex * c
        dy[b.a] += ey * c
        dx[b.b] -= ex * c
        dy[b.b] -= ey * c
        cnt[b.a]++
        cnt[b.b]++
      })
      for (let i = 0; i < n; i++) {
        if (cnt[i] === 0) continue
        s.x[i] += dx[i] / cnt[i]
        s.y[i] += dy[i] / cnt[i]
      }
    }
    for (let i = 0; i < n; i++) {
      if (s.y[i] < 0) {
        s.y[i] = 0
        // friction: on the ground, most of a joint's slide this substep is taken back
        s.x[i] = px[i] + (s.x[i] - px[i]) * (1 - FRICTION)
      }
      s.vx[i] = (s.x[i] - px[i]) / DT
      s.vy[i] = (s.y[i] - py[i]) / DT
    }
  }
}

/** how far a creature has walked: where its middle is now, against where it started */
export const middle = (s: State) => s.x.reduce((a, b) => a + b, 0) / s.x.length

/* ---------------------------------------------------------------- breeding ------------------- */

export function lcg(seed: number) {
  let s = seed >>> 0
  return () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296
}
const gauss = (rand: () => number) =>
  Math.sqrt(-2 * Math.log(Math.max(1e-12, rand()))) * Math.cos(2 * Math.PI * rand())

export function randomBrain(m: number, rand: () => number): Brain {
  return {
    phase: Array.from({ length: m }, () => rand()),
    strength: Array.from({ length: m }, () => 0.3 + 0.7 * rand()),
    beat: 0.4 + 1.1 * rand(),
  }
}

const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x))
export function mutate(b: Brain, rand: () => number, size = 0.08): Brain {
  return {
    phase: b.phase.map((p) => (((p + gauss(rand) * size) % 1) + 1) % 1),
    strength: b.strength.map((s) => clamp(s + gauss(rand) * size, 0, 1)),
    beat: clamp(b.beat + gauss(rand) * size, 0.3, MAX_BEAT),
  }
}

/** how many of each generation breed */
export const KEEP = 64

/**
 * The next generation from how far each walked: the best KEEP kept as they are, and the rest their
 * children, a small change each. Returns the brains in order, the best first.
 */
export function breed(
  brains: Brain[],
  distance: number[],
  rand: () => number,
  keep = KEEP,
): Brain[] {
  const order = brains.map((_, i) => i).sort((a, b) => distance[b] - distance[a] || a - b)
  const parents = order.slice(0, keep).map((i) => brains[i])
  const next = [...parents]
  for (let k = 0; next.length < brains.length; k++)
    next.push(mutate(parents[k % parents.length], rand))
  return next
}

/* ---------------------------------------------------------------- for the GPU ---------------- */

/** Hand-packed to match `struct Race` — critters.test.ts lays the struct out from the shader. */
export const RACE = {
  size: 0,
  joints: 8,
  bones: 12,
  count: 16,
  steps: 20,
  time: 24,
  scale: 28,
  cam: 32,
  best: 40,
  build: 44,
  bytes: 48,
} as const

/**
 * The body for the shader: each bone as (a, b, rest, muscle index or −1), and each joint's bones
 * (up to MAX_DEGREE, −1 past the last) so a joint's thread can gather its own corrections.
 */
export function packBody(body: Body): {
  bones: Float32Array<ArrayBuffer>
  adjacency: Int32Array<ArrayBuffer>
} {
  const bones = new Float32Array(MAX_BONES * 4)
  let m = 0
  body.bones.forEach((b, i) => {
    bones.set([b.a, b.b, dist(body.joints[b.a], body.joints[b.b]), b.muscle ? m++ : -1], i * 4)
  })
  const adjacency = new Int32Array(MAX_JOINTS * MAX_DEGREE).fill(-1)
  const fill = new Array<number>(MAX_JOINTS).fill(0)
  body.bones.forEach((b, i) => {
    for (const j of [b.a, b.b]) adjacency[j * MAX_DEGREE + fill[j]++] = i
  })
  return { bones, adjacency }
}

/** every brain, MAX_BONES phases then MAX_BONES strengths then the beat, per creature */
export const BRAIN_FLOATS = MAX_BONES * 2 + 4
export function packBrains(brains: readonly Brain[]): Float32Array<ArrayBuffer> {
  const f = new Float32Array(POPULATION * BRAIN_FLOATS)
  brains.slice(0, POPULATION).forEach((b, i) => {
    f.set(b.phase, i * BRAIN_FLOATS)
    f.set(b.strength, i * BRAIN_FLOATS + MAX_BONES)
    f[i * BRAIN_FLOATS + MAX_BONES * 2] = b.beat
  })
  return f
}

/** every creature's joints at the start: (x, y, vx, vy) a joint, MAX_JOINTS a creature */
export function packStart(body: Body, count = POPULATION): Float32Array<ArrayBuffer> {
  const s = standUp(body)
  const f = new Float32Array(count * MAX_JOINTS * 4)
  for (let c = 0; c < count; c++)
    s.forEach((p, j) => f.set([p[0], p[1], 0, 0], (c * MAX_JOINTS + j) * 4))
  return f
}

export function packRace(
  p: {
    w: number
    h: number
    joints: number
    bones: number
    count: number
    steps: number
    time: number
    cam: V2
    scale: number
    best: number
    build: boolean
  },
  into = new ArrayBuffer(RACE.bytes),
) {
  const u = new Uint32Array(into)
  const f = new Float32Array(into)
  u[0] = p.w
  u[1] = p.h
  u[RACE.joints / 4] = p.joints
  u[RACE.bones / 4] = p.bones
  u[RACE.count / 4] = p.count
  u[RACE.steps / 4] = p.steps
  f[RACE.time / 4] = p.time
  f.set(p.cam, RACE.cam / 4)
  f[RACE.scale / 4] = p.scale
  u[RACE.best / 4] = p.best
  u[RACE.build / 4] = p.build ? 1 : 0
  return into
}

/* ---------------------------------------------------------------- building ------------------- */

/** the joint within `r` of a point, nearest first, or −1 */
export function jointAt(body: Body, p: V2, r: number) {
  let best = -1
  let bd = r
  body.joints.forEach((j, i) => {
    const d = dist(j, p)
    if (d < bd) {
      bd = d
      best = i
    }
  })
  return best
}

/** the bone within `r` of a point, or −1 */
export function boneAt(body: Body, p: V2, r: number) {
  let best = -1
  let bd = r
  body.bones.forEach((b, i) => {
    const a = body.joints[b.a]
    const c = body.joints[b.b]
    const ex = c[0] - a[0]
    const ey = c[1] - a[1]
    const l = ex * ex + ey * ey
    const t = l > 0 ? clamp(((p[0] - a[0]) * ex + (p[1] - a[1]) * ey) / l, 0, 1) : 0
    const d = Math.hypot(p[0] - a[0] - t * ex, p[1] - a[1] - t * ey)
    if (d < bd) {
      bd = d
      best = i
    }
  })
  return best
}

/** a joint taken away, with its bones, and the rest renumbered */
export function removeJoint(body: Body, j: number): Body {
  return {
    joints: body.joints.filter((_, i) => i !== j),
    bones: body.bones
      .filter((b) => b.a !== j && b.b !== j)
      .map((b) => ({ ...b, a: b.a > j ? b.a - 1 : b.a, b: b.b > j ? b.b - 1 : b.b })),
  }
}

/** the grid a joint snaps to, metres */
export const SNAP = 0.1
export const snap = (p: V2): V2 => [
  Math.round(p[0] / SNAP) * SNAP,
  Math.max(0, Math.round(p[1] / SNAP) * SNAP),
]

/* ---------------------------------------------------------------- keeping one ---------------- */

export const CRITTER_KEY = 'lab_critter_v1'

/**
 * A critter from untrusted JSON. ⚠️ DATA, NEVER CODE: joints are numbers in range, bones point at
 * joints that exist, a brain's numbers are clamped — and the body must pass `problem` like one built
 * by hand. Returns null for anything else.
 */
export function readCritter(text: string | null): { body: Body; brain: Brain | null } | null {
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
  if (!Array.isArray(b.joints) || !Array.isArray(b.bones)) return null
  const num = (x: unknown, lo: number, hi: number) =>
    typeof x === 'number' && Number.isFinite(x) ? clamp(x, lo, hi) : NaN
  const joints = b.joints
    .slice(0, MAX_JOINTS + 1)
    .map((j): V2 => (Array.isArray(j) ? [num(j[0], -3, 3), num(j[1], 0, 3)] : [NaN, NaN]))
  if (joints.some((j) => j.some(Number.isNaN))) return null
  const bones = b.bones.slice(0, MAX_BONES + 1).map((x) => {
    const o = (x ?? {}) as Record<string, unknown>
    return { a: Number(o.a), b: Number(o.b), muscle: o.muscle === true }
  })
  const body = { joints, bones }
  if (problem(body)) return null
  const m = muscles(body)
  const br = (r.brain ?? null) as Record<string, unknown> | null
  let brain: Brain | null = null
  if (
    br &&
    Array.isArray(br.phase) &&
    Array.isArray(br.strength) &&
    br.phase.length === m &&
    br.strength.length === m
  ) {
    const ph = br.phase.map((x) => num(x, 0, 1))
    const st = br.strength.map((x) => num(x, 0, 1))
    const beat = num(br.beat, 0.3, MAX_BEAT)
    if (![...ph, ...st, beat].some(Number.isNaN)) brain = { phase: ph, strength: st, beat }
  }
  return { body, brain }
}
