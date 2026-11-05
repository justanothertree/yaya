/**
 * The arithmetic of the Lab's fireflies: each is a clock — a phase going round at its own pace,
 * flashing as it passes the top — and each nudges its clock towards the flashing it sees around it.
 * That is the Kuramoto model, and past a certain coupling strength a crowd of clocks that start
 * anyhow fall into step by themselves, as real fireflies in Southeast Asia do.
 *
 * ⚠️ WHAT EACH FIREFLY SEES IS SUMMED WITH INTEGER ATOMICS. A firefly is pulled towards the
 * average phase of its own patch of meadow, so every patch needs the sum of cos θ and sin θ over
 * the fireflies in it — many writers to one total. WGSL has no float atomics, so the sums are
 * kept in FIXED POINT: each firefly adds round(cos θ · SCALE) with atomicAdd to an i32. The sums are
 * then exact (integer addition does not care about order), which floats added by many threads
 * would not be — and fireflies.test.ts can check them to the last unit.
 */

/** Hand-packed to match `struct Flies` — fireflies.test.ts lays the struct out from the shader. */
export const FLIES = {
  size: 0,
  count: 8,
  cells: 12,
  dt: 16,
  time: 20,
  pull: 24,
  kick: 28,
  tap: 32,
  beat: 44,
  bytes: 48,
} as const

/** fixed-point scale for the sums: a firefly's cos θ is added as an integer this many times bigger */
export const SCALE = 1024
/** the meadow is cut into this many patches across; each firefly feels its own and its neighbours' */
export const CELLS = [16, 10] as const

export const COUNTS = [1024, 4096, 12288] as const
export const TOUCH_CEILING = 4096

/** each firefly's own pace is one flash a second give or take this fraction, spread evenly */
export const PACE_SPREAD = 0.1

/**
 * How strongly they pull each other. With paces spread evenly over ω₀ ± γ, Kuramoto's crowd only
 * falls into step above K = 4γ/π — here 4 · 2π · 0.1 / π = 0.8 — so Shy sits below it and stays a
 * crowd, and Social and Crowd sit above it and lock. fireflies.test.ts derives the 0.8 rather than
 * reading it from here.
 */
export const MOODS = { shy: ['Shy', 0.4], social: ['Social', 1.6], crowd: ['Crowd', 4] } as const
export type Mood = keyof typeof MOODS

const TAU = Math.PI * 2

/**
 * ⚠️ A BEAT ONLY LEADS THEM IF IT SETS THEIR PACE, NOT JUST THEIR PHASE. The first version had a beat
 * pull every clock towards flashing now and nothing else, and measured in a simulation it led
 * nobody: at 70/min the fireflies' own one-a-second pace drifts off the beat faster than a kick can
 * pull it back, and at 120/min — two beats to every flash — the kick on the off-beat finds every
 * clock halfway round and pulls it exactly as hard the other way, so the two cancel. Beats with the
 * crowd flashing came out no better than with no kicks at all. So a beat does three things:
 *  - its tempo is FOLDED into the fireflies' own range, halving it until it is one they can keep;
 *  - their pace is drawn most of the way to it (FOLLOW), keeping a little of their own;
 *  - only the beats the folding kept kick them (`every`), so no kick undoes the last.
 * Simulated, that locks a Shy crowd onto the beat in 2–4s from 55 to 175/min, flashing within 5% of
 * a turn of it; fireflies.test.ts asks the same of `stepKuramoto`.
 */
export const FOLLOW = 0.95
/** a beat's or a tap's pull fades over this many seconds — mirrored in fireflies-step.wgsl */
export const FADE = 0.12
/** the slowest and fastest paces a beat is folded into, flashes a second */
export const BEAT_RANGE = [0.7, 1.4] as const

/** A tempo (per minute) as the fireflies take it up: their pace (rad/s), and which beats they flash on. */
export function beatFor(bpm: number): { pace: number; every: number } {
  let hz = bpm / 60
  let every = 1
  while (hz > BEAT_RANGE[1]) {
    hz /= 2
    every *= 2
  }
  while (hz < BEAT_RANGE[0]) hz *= 2
  return { pace: hz * TAU, every }
}

/** how bright a firefly is at phase θ: a quick flash just after it passes the top, dark otherwise */
export function glow(theta: number): number {
  const t = (((theta % TAU) + TAU) % TAU) / TAU
  return Math.exp(-((t / 0.06) ** 2)) + 0.25 * Math.exp(-(((t - 0.06) / 0.08) ** 2))
}

/** the order parameter: 1 when every phase is the same, near 0 when they are scattered */
export function order(phases: ArrayLike<number>): number {
  let c = 0
  let s = 0
  for (let i = 0; i < phases.length; i++) {
    c += Math.cos(phases[i])
    s += Math.sin(phases[i])
  }
  return Math.hypot(c, s) / Math.max(1, phases.length)
}

/**
 * One step of the Kuramoto model, mean field (every firefly sees all): dθ/dt = ω + K·R·sin(ψ − θ).
 * The GPU does the same with each firefly seeing its own patch and the patches beside it; this is
 * the version the tests can reason about. With a `drive`, it is also what a beat does in
 * fireflies-step.wgsl: pace drawn to the beat's, and a kick pulling each clock towards flashing as
 * the kick lands — aimed `pace · FADE` ahead, because the kick goes on pulling while they move.
 */
export function stepKuramoto(
  theta: Float64Array,
  omega: Float64Array,
  k: number,
  dt: number,
  drive?: { pace: number; kick: number },
) {
  let c = 0
  let s = 0
  for (let i = 0; i < theta.length; i++) {
    c += Math.cos(theta[i])
    s += Math.sin(theta[i])
  }
  c /= theta.length
  s /= theta.length
  for (let i = 0; i < theta.length; i++) {
    const pace = drive?.pace ? omega[i] + (drive.pace - omega[i]) * FOLLOW : omega[i]
    // K·R·sin(ψ − θ) = K·(s·cos θ − c·sin θ)
    let turn = pace + k * (s * Math.cos(theta[i]) - c * Math.sin(theta[i]))
    if (drive) turn += drive.kick * KICK_PULL * Math.sin(pace * FADE - theta[i])
    theta[i] += turn * dt
  }
}

/** how hard a beat pulls every clock — mirrored in fireflies-step.wgsl */
export const KICK_PULL = 6

/** the patch a point of the meadow (0..1 each way) falls in */
export const cellOf = (u: number, v: number) => {
  const cx = Math.min(CELLS[0] - 1, Math.max(0, Math.floor(u * CELLS[0])))
  const cy = Math.min(CELLS[1] - 1, Math.max(0, Math.floor(v * CELLS[1])))
  return cy * CELLS[0] + cx
}

/**
 * Fireflies to start with: scattered over the meadow (0..1 each way, more of them low down where
 * the grass is), each with its own pace — about one flash a second, a little faster or slower —
 * and a phase anywhere. x, y, phase, pace.
 */
export function seedFlies(n: number, rand: () => number): Float32Array<ArrayBuffer> {
  const out = new Float32Array(n * 4)
  for (let i = 0; i < n; i++)
    out.set(
      [
        rand(),
        0.25 + 0.75 * Math.sqrt(rand()),
        rand() * TAU,
        TAU * (1 + PACE_SPREAD * (2 * rand() - 1)),
      ],
      i * 4,
    )
  return out
}

export type FliesFrame = {
  w: number
  h: number
  count: number
  dt: number
  time: number
  mood: Mood
  /** 1 on a beat of the music, falling away: everyone is pulled towards flashing now */
  kick: number
  /** a tap: where (0..1), and how fresh (1 the frame it happened, falling) */
  tap: readonly [number, number, number]
  /** the pace a beat has set them (rad/s, from `beatFor`), or 0 for each their own */
  beat: number
}

export function packFlies(p: FliesFrame, into = new ArrayBuffer(FLIES.bytes)) {
  const u = new Uint32Array(into)
  const f = new Float32Array(into)
  u[0] = p.w
  u[1] = p.h
  u[FLIES.count / 4] = p.count
  u[FLIES.cells / 4] = CELLS[0] * CELLS[1]
  f[FLIES.dt / 4] = p.dt
  f[FLIES.time / 4] = p.time
  f[FLIES.pull / 4] = MOODS[p.mood][1]
  f[FLIES.kick / 4] = p.kick
  f.set(p.tap, FLIES.tap / 4)
  f[FLIES.beat / 4] = p.beat
  return into
}

/**
 * The beat somebody is tapping, per minute, from their recent tap times (ms) — or null until there
 * are three taps evenly enough spaced to call a rhythm (each gap within a third of the average).
 */
export function tempoOf(times: readonly number[]): number | null {
  if (times.length < 3) return null
  const gaps = times.slice(1).map((t, i) => t - times[i])
  const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length
  if (mean <= 0 || gaps.some((g) => Math.abs(g - mean) > mean / 3)) return null
  return 60000 / mean
}

/**
 * How in step the meadow is, from the patches' sums (cos, sin, count per patch, fixed point):
 * `near` is how in step each patch is with itself, averaged over the fireflies; `all` is the whole
 * meadow at once. A patch of one says nothing about being in step with anybody, so it is left out
 * of `near` (and counted as out of step).
 *
 * ⚠️ TWO NUMBERS, BECAUSE A CROWD CAN BE PERFECTLY IN STEP AND STILL READ AS SCATTERED. Each
 * firefly only sees its own patch and the next, so a meadow can lock into a WAVE — every patch
 * flashing together, each a little after the one beside it — and stay that way. Measured on the
 * GPU over eight crowds after 15s of Crowd: every one had `near` at 0.99–1.00, while `all` ranged
 * from 0.44 to 0.99. One figure called the wave 44% in step, which is not what anybody watching sees.
 */
export function ordersOf(sums: ArrayLike<number>): { near: number; all: number } {
  let c = 0
  let s = 0
  let n = 0
  let near = 0
  for (let i = 0; i + 2 < sums.length; i += 3) {
    const m = sums[i + 2]
    c += sums[i]
    s += sums[i + 1]
    n += m
    if (m < 2) continue
    /* ⚠️ a handful of clocks at random still add up to something — about √m of them — so a
       scattered meadow of 25 to a patch read 25% "in step nearby". Taking away what chance alone
       gives, R² ≈ (|Σ|² − m) / (m(m − 1)), reads 0 for a scattered patch and still 1 for a locked
       one — and it is AVERAGED before the square root: rooting each patch's and clamping its
       negatives first kept 0.16 of the noise at six to a patch. */
    near += m * (((sums[i] ** 2 + sums[i + 1] ** 2) / SCALE ** 2 - m) / (m * (m - 1)))
  }
  return n
    ? { near: Math.sqrt(Math.max(0, near / n)), all: Math.hypot(c, s) / (n * SCALE) }
    : { near: 0, all: 0 }
}
