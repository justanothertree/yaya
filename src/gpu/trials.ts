/**
 * The arithmetic of the Lab's bike trials: a little motorbike on springs, a course of dirt, and
 * the rules of a run — the clock, the checkpoints, and the crash.
 *
 * ⚠️ THE PHYSICS IS ALL HERE, ON THE CPU, AND THE GPU NEVER DECIDES ANYTHING THAT MATTERS TO A RUN.
 * A game is only fair if the same inputs make the same ride, so the bike is a handful of bodies
 * stepped at a fixed 600 Hz with nothing random in it: a chassis, two wheels held to it by
 * spring-damper suspension, ground contact as a stiff penalty spring with Coulomb friction that the
 * wheel's spin drives. trials.test.ts rides it — at rest, on the throttle, over a step, off a drop,
 * upside down — and a scripted rider finishes the course, which is the claim that the course can be
 * finished at all. The GPU bakes the course into a signed distance field once, and from then on
 * draws the ground from it and bounces the mud the wheels throw off it.
 */

export type V2 = [number, number]

/** world: metres, y up */
export const G = 14
/** fixed physics step and how many make a 60th of a second */
export const SUBSTEPS = 10
export const STEP = 1 / 60 / SUBSTEPS

export const WHEEL_R = 0.36
const WHEEL_M = 1.4
const WHEEL_I = 0.5 * WHEEL_M * WHEEL_R * WHEEL_R
const BODY_M = 9
const BODY_I = 2.4
/** where the wheels hang from, in the chassis frame (x forward, y up) */
export const ANCHORS: [V2, V2] = [
  [-0.72, -0.3],
  [0.72, -0.3],
]
/** the rider's head, and the chassis's own corners, in the chassis frame */
export const HEAD: V2 = [-0.12, 0.95]
const HULL: V2[] = [
  [-0.55, 0.15],
  [0.55, 0.15],
  [0, -0.2],
]
const HEAD_R = 0.2
const SUSP_K = 1100
const SUSP_C = 45
/** the fork across its own travel: stiff, so a wheel goes up and down and not back and forth */
const FORK_K = 9000
const FORK_C = 120
const GROUND_K = 9000
const GROUND_C = 90
const MU = 1.1
/** how sharply friction grips once the tyre slips: a regularised Coulomb law */
const GRIP = 400
const MOTOR = 42
/** how much of the engine's torque pushes back on the frame (the rest goes into the chain) */
const KICK = 0.5
const MAX_SPIN = 60
const BRAKE = 22
const LEAN = 60

export type Wheel = { x: number; y: number; vx: number; vy: number; spin: number; w: number }
export type Bike = {
  x: number
  y: number
  a: number
  vx: number
  vy: number
  w: number
  wheels: [Wheel, Wheel]
  crashed: boolean
  /** whether each wheel touched the ground this frame, for the dust */
  touching: [boolean, boolean]
  /** how fast each tyre is slipping against the ground, m/s, for the dust */
  slip: [number, number]
}
export type Input = { gas: boolean; brake: boolean; lean: number }
export const IDLE: Input = { gas: false, brake: false, lean: 0 }

/** a course: chains of points (the ground is BELOW each chain), checkpoints and a finish, in metres */
export type Course = {
  name: string
  chains: V2[][]
  start: V2
  checkpoints: number[]
  finish: number
}

const rot = (p: V2, a: number): V2 => [
  p[0] * Math.cos(a) - p[1] * Math.sin(a),
  p[0] * Math.sin(a) + p[1] * Math.cos(a),
]

/** where a chassis-frame point is in the world, and how fast it is moving */
export function bodyPoint(b: Bike, p: V2) {
  const r = rot(p, b.a)
  return { x: b.x + r[0], y: b.y + r[1], vx: b.vx - b.w * r[1], vy: b.vy + b.w * r[0], r }
}

export function spawn(at: V2): Bike {
  const b: Bike = {
    x: at[0],
    y: at[1] + WHEEL_R - ANCHORS[0][1] + 0.12,
    a: 0,
    vx: 0,
    vy: 0,
    w: 0,
    wheels: [null!, null!] as unknown as [Wheel, Wheel],
    crashed: false,
    touching: [false, false],
    slip: [0, 0],
  }
  b.wheels = ANCHORS.map((p) => {
    const q = bodyPoint(b, p)
    return { x: q.x, y: q.y, vx: 0, vy: 0, spin: 0, w: 0 }
  }) as [Wheel, Wheel]
  return b
}

/**
 * Whether a point is in the ground: each chain is closed along its two deep ends into a polygon,
 * and a ray to the right crosses an odd number of its edges from inside.
 */
export function inGround(course: Course, p: V2) {
  let inside = false
  for (const chain of course.chains)
    for (let i = 0; i < chain.length; i++) {
      const a = chain[i]
      const c = chain[(i + 1) % chain.length]
      if (
        a[1] > p[1] !== c[1] > p[1] &&
        p[0] < a[0] + ((p[1] - a[1]) * (c[0] - a[0])) / (c[1] - a[1])
      )
        inside = !inside
    }
  return inside
}

/**
 * The nearest point of the ground to `p` within `within`: the signed distance (negative inside) and
 * the way out, or null if none is that close.
 *
 * ⚠️ THE SIGN COMES FROM BEING INSIDE, NOT FROM WHICH SIDE OF A SEGMENT'S LINE THE POINT IS. That
 * test is only right beside the segment: past its end — above the top of a wall, say — the line
 * runs on through the air, and a wheel landing just over a lip was told it was deep inside the
 * ground and thrown down into the gap at 26 m/s.
 */
export function nearest(course: Course, p: V2, within: number) {
  let best: { d: number; at: V2 } | null = null
  for (const chain of course.chains)
    for (let i = 0; i + 1 < chain.length; i++) {
      const a = chain[i]
      const c = chain[i + 1]
      if (Math.max(a[0], c[0]) < p[0] - within || Math.min(a[0], c[0]) > p[0] + within) continue
      const dx = c[0] - a[0]
      const dy = c[1] - a[1]
      const l = dx * dx + dy * dy
      const t = l > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l)) : 0
      const q: V2 = [a[0] + t * dx, a[1] + t * dy]
      const d = Math.hypot(p[0] - q[0], p[1] - q[1])
      if (d < within && (!best || d < best.d)) best = { d, at: q }
    }
  if (!best) return null
  const inside = inGround(course, p)
  const e: V2 = [p[0] - best.at[0], p[1] - best.at[1]]
  const n: V2 = best.d > 1e-9 ? [e[0] / best.d, e[1] / best.d] : [0, 1]
  return inside
    ? { d: -best.d, n: [-n[0], -n[1]] as V2, at: best.at }
    : { d: best.d, n, at: best.at }
}

/** a penalty contact: the force pushing a point of radius r out of the ground, with friction */
function contact(course: Course, p: V2, v: V2, r: number, tangentialExtra = 0) {
  const hit = nearest(course, p, r + 0.5)
  if (!hit || hit.d >= r) return null
  const depth = r - hit.d
  const n = hit.n
  const vn = v[0] * n[0] + v[1] * n[1]
  const fn = Math.max(0, GROUND_K * depth - GROUND_C * vn)
  const t: V2 = [n[1], -n[0]]
  const slip = v[0] * t[0] + v[1] * t[1] + tangentialExtra
  const ft = -Math.max(-MU * fn, Math.min(MU * fn, GRIP * slip))
  return { n, t, fn, ft, slip }
}

/** one fixed step of the whole bike */
export function step(b: Bike, course: Course, input: Input, dt = STEP) {
  let fx = 0
  let fy = -G * BODY_M
  let torque = 0
  const addAt = (r: V2, f: V2) => {
    fx += f[0]
    fy += f[1]
    torque += r[0] * f[1] - r[1] * f[0]
  }
  b.wheels.forEach((wh, k) => {
    const q = bodyPoint(b, ANCHORS[k])
    /* suspension: soft along the fork (the frame's own up), stiff across it. ⚠️ AN ISOTROPIC SPRING
       WAS WRONG: a wheel that hit the face of a block swung back half a metre against it, and
       came off with its speed reversed — the frame hung on a pendulum rather than a fork */
    const up: V2 = [-Math.sin(b.a), Math.cos(b.a)]
    const fwd: V2 = [Math.cos(b.a), Math.sin(b.a)]
    const d: V2 = [q.x - wh.x, q.y - wh.y]
    const dv: V2 = [q.vx - wh.vx, q.vy - wh.vy]
    const along = SUSP_K * (d[0] * up[0] + d[1] * up[1]) + SUSP_C * (dv[0] * up[0] + dv[1] * up[1])
    const across =
      FORK_K * (d[0] * fwd[0] + d[1] * fwd[1]) + FORK_C * (dv[0] * fwd[0] + dv[1] * fwd[1])
    const s: V2 = [up[0] * along + fwd[0] * across, up[1] * along + fwd[1] * across]
    addAt(q.r, [-s[0], -s[1]])
    let wfx = s[0]
    let wfy = s[1] - G * WHEEL_M
    let wtorque = 0
    if (!b.crashed) {
      // the engine turns the back wheel, and pushes back on the frame: that is what lifts the front
      if (k === 0 && input.gas) {
        wtorque -= MOTOR
        torque += MOTOR * KICK
      }
      if (input.brake) {
        const brake = Math.sign(wh.w) * Math.min(BRAKE, (Math.abs(wh.w) * WHEEL_I) / dt)
        wtorque -= brake
        torque += brake
      }
    }
    /* the tyre: its contact point moves with the wheel plus its spin. With the contact at −R·n,
       ω × r adds ω·R along the tangent t = (n.y, −n.x) — so a wheel rolling without slipping
       (v = −ω·R) has a contact point that is still */
    const c = contact(course, [wh.x, wh.y], [wh.vx, wh.vy], WHEEL_R, wh.w * WHEEL_R)
    b.touching[k] = !!c
    b.slip[k] = 0
    if (c) {
      wfx += c.n[0] * c.fn + c.t[0] * c.ft
      wfy += c.n[1] * c.fn + c.t[1] * c.ft
      // friction at the rim turns the wheel: r × F with r = −R·n and F along t is R·ft
      wtorque += WHEEL_R * c.ft
      b.slip[k] = Math.abs(c.slip)
    }
    wh.vx += (wfx / WHEEL_M) * dt
    wh.vy += (wfy / WHEEL_M) * dt
    wh.w = Math.max(-MAX_SPIN, Math.min(MAX_SPIN, wh.w + (wtorque / WHEEL_I) * dt))
    wh.x += wh.vx * dt
    wh.y += wh.vy * dt
    wh.spin += wh.w * dt
  })
  // the chassis's own corners and the rider's head against the ground
  for (const p of [...HULL, HEAD]) {
    const q = bodyPoint(b, p)
    const r = p === HEAD ? HEAD_R : 0.08
    const c = contact(course, [q.x, q.y], [q.vx, q.vy], r)
    if (!c) continue
    if (p === HEAD) b.crashed = true
    addAt(q.r, [c.n[0] * c.fn + c.t[0] * c.ft, c.n[1] * c.fn + c.t[1] * c.ft])
  }
  if (!b.crashed) torque += LEAN * input.lean
  b.vx += (fx / BODY_M) * dt
  b.vy += (fy / BODY_M) * dt
  b.w += (torque / BODY_I) * dt
  b.x += b.vx * dt
  b.y += b.vy * dt
  b.a += b.w * dt
}

/** a 60th of a second: SUBSTEPS fixed steps */
export function frame(b: Bike, course: Course, input: Input) {
  const touch = [false, false]
  const slip = [0, 0]
  for (let s = 0; s < SUBSTEPS; s++) {
    step(b, course, input)
    for (const k of [0, 1]) {
      touch[k] ||= b.touching[k]
      slip[k] = Math.max(slip[k], b.slip[k])
    }
  }
  b.touching = touch as [boolean, boolean]
  b.slip = slip as [number, number]
}

/* ---------------------------------------------------------------- a run ---------------------- */

export type Run = {
  bike: Bike
  /** seconds since the start, in whole frames so it is the same on every machine */
  frames: number
  /** the furthest checkpoint passed: where a restart puts you */
  checkpoint: number
  finished: boolean
}

export const startRun = (course: Course): Run => ({
  bike: spawn(course.start),
  frames: 0,
  checkpoint: -1,
  finished: false,
})

/** one frame of a run: the bike, the clock, the checkpoints and the finish line */
export function tick(run: Run, course: Course, input: Input) {
  if (run.finished) return
  frame(run.bike, course, run.bike.crashed ? IDLE : input)
  if (!run.bike.crashed) run.frames++
  const x = run.bike.x
  while (
    run.checkpoint + 1 < course.checkpoints.length &&
    x >= course.checkpoints[run.checkpoint + 1]
  )
    run.checkpoint++
  if (!run.bike.crashed && x >= course.finish) run.finished = true
}

/** back on the bike at the last checkpoint passed, the clock still running */
export function retry(run: Run, course: Course): Run {
  const at = run.checkpoint >= 0 ? course.checkpoints[run.checkpoint] : course.start[0]
  const ground = groundAt(course, at) ?? course.start[1]
  return { ...run, bike: spawn([at, ground]), finished: false }
}

/** the highest ground at x, or null where there is none */
export function groundAt(course: Course, x: number): number | null {
  let best: number | null = null
  for (const chain of course.chains)
    for (let i = 0; i + 1 < chain.length; i++) {
      const a = chain[i]
      const c = chain[i + 1]
      if (x < Math.min(a[0], c[0]) || x > Math.max(a[0], c[0]) || a[0] === c[0]) continue
      const y = a[1] + ((x - a[0]) / (c[0] - a[0])) * (c[1] - a[1])
      if (best === null || y > best) best = y
    }
  return best
}

export const seconds = (frames: number) => frames / 60
export const clock = (frames: number) => {
  const s = frames / 60
  return `${Math.floor(s / 60)}:${(s % 60).toFixed(2).padStart(5, '0')}`
}

/* ---------------------------------------------------------------- the course ----------------- */

/** a run of gentle bumps from x0 over `len` metres */
const bumps = (x0: number, y: number, len: number, h: number, n: number): V2[] =>
  Array.from({ length: n * 4 + 1 }, (_, i) => {
    const x = x0 + (len * i) / (n * 4)
    return [x, y + h * Math.max(0, Math.sin((Math.PI * (x - x0) * n) / len)) ** 1.5]
  })
/** a smooth hill from (x0, y0) to (x1, y1) */
const slope = (x0: number, y0: number, x1: number, y1: number, n = 10): V2[] =>
  Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n
    return [x0 + (x1 - x0) * t, y0 + (y1 - y0) * (0.5 - 0.5 * Math.cos(Math.PI * t))]
  })
const DEEP = -30

/**
 * The Quarry: one course, in five parts with a checkpoint between each — bumps to learn the
 * throttle on, a block and a log to learn to lift the front, a gap to jump, a long hill and a
 * staircase to climb, a pit to cross, and a run down to the flag.
 *
 * ⚠️ EVERY STEP UP HAS A FACE THAT LEANS. A wheel meets a square step of height h with a normal
 * whose upward part is (R − h)/R: at h = 0.3 on a 0.36 wheel that is 0.17, a wall, and the bike
 * bounced straight back off it at ten metres a second forty times running. A face rising over half a
 * metre is a ramp a wheel can roll up, which is what a rider would expect a dirt step to be.
 */
export const QUARRY: Course = {
  name: 'The Quarry',
  start: [3, 0],
  checkpoints: [34, 72, 108, 142],
  finish: 176,
  chains: [
    [
      [-12, DEEP],
      [-12, 6],
      [-10, 6],
      [-9, 0],
      ...bumps(14, 0, 14, 0.45, 4),
      [40, 0],
      [40.5, 0.4],
      [44, 0.4],
      [44.6, 0],
      ...slope(48, 0, 50, 0.7, 6),
      ...slope(50, 0.7, 52, 0, 6),
      /* the kicker: straight, so it still slopes up at the lip — a smooth hill would level off
         there and throw the bike flat into the gap (measured: two metres short at 9 m/s) */
      [56, 0],
      [57, 0.1],
      [63.2, 1.6],
      [64, 1.82],
      [64.2, 1.6],
      [64.2, DEEP],
    ],
    [
      [67.5, DEEP],
      [67.5, 1.2],
      ...slope(68, 1.2, 74, 0.6, 8),
      ...slope(78, 0.6, 92, 5.5, 16),
      [96, 5.5],
      ...slope(96, 5.5, 106, 2, 14),
      [110, 2],
      [110.5, 2.4],
      [112.5, 2.4],
      [113, 2.8],
      [115, 2.8],
      [115.5, 3.2],
      [117.5, 3.2],
      [118, 3.6],
      [121, 3.6],
      ...slope(121, 3.6, 126, 1.2, 8),
      ...slope(126, 1.2, 130, -0.8, 6),
      [133, -0.8],
      ...slope(133, -0.8, 137, 1.2, 6),
      [144, 1.2],
      ...slope(144, 1.2, 160, -1, 16),
      ...bumps(160, -1, 10, 0.35, 3),
      [184, -1],
      [186, 6],
      [188, 6],
      [188, DEEP],
    ],
  ],
}

/* ---------------------------------------------------------------- for the GPU ---------------- */

/** Hand-packed to match `struct Trial` — trials.test.ts lays the struct out from the shader. */
export const TRIAL = {
  size: 0,
  cam: 8,
  scale: 16,
  time: 20,
  origin: 24,
  grid: 32,
  texel: 40,
  segments: 44,
  body: 48,
  rear: 64,
  front: 80,
  flags: 96,
  flagsY: 112,
  finish: 128,
  passed: 136,
  crashed: 140,
  dust: 144,
  bytes: 160,
} as const

/** the baked distance field's spacing, metres a texel */
export const TEXEL = 1 / 8
/** most mud and dust in the air at once */
export const MAX_DUST = 4096

/** the area the field covers: the course's extent, with room above for the bike and the flags */
export function fieldFor(course: Course) {
  const xs = course.chains.flat().map((p) => p[0])
  const ys = course.chains
    .flat()
    .map((p) => p[1])
    .filter((y) => y > -20)
  const origin: V2 = [Math.min(...xs) - 2, Math.min(...ys) - 4]
  const top = Math.max(...ys) + 8
  return {
    origin,
    grid: [
      Math.ceil((Math.max(...xs) + 2 - origin[0]) / TEXEL),
      Math.ceil((top - origin[1]) / TEXEL),
    ] as [number, number],
  }
}

/**
 * Every edge of the ground for the bake, as (ax, ay, bx, by): each chain's own edges and the one
 * that closes it along the bottom, so the shader can count crossings exactly as `inGround` does.
 */
export function packSegments(course: Course): Float32Array<ArrayBuffer> {
  const out: number[] = []
  for (const chain of course.chains)
    for (let i = 0; i < chain.length; i++) {
      const a = chain[i]
      const c = chain[(i + 1) % chain.length]
      out.push(a[0], a[1], c[0], c[1])
    }
  return Float32Array.from(out)
}

/** the signed distance the bake should give at a point: CPU's answer, for the GPU probe */
export function signedDistance(course: Course, p: V2) {
  let best = Infinity
  for (const chain of course.chains)
    for (let i = 0; i < chain.length; i++) {
      const a = chain[i]
      const c = chain[(i + 1) % chain.length]
      const dx = c[0] - a[0]
      const dy = c[1] - a[1]
      const l = dx * dx + dy * dy
      const t = l > 0 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l)) : 0
      best = Math.min(best, Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy))
    }
  return inGround(course, p) ? -best : best
}

export type Frame = {
  w: number
  h: number
  cam: V2
  scale: number
  time: number
  bike: Bike
  lean: number
  course: Course
  passed: number
  dust: number
}

export function packTrial(f: Frame, segments: number, into = new ArrayBuffer(TRIAL.bytes)) {
  const u = new Uint32Array(into)
  const fl = new Float32Array(into)
  const field = fieldFor(f.course)
  u[0] = f.w
  u[1] = f.h
  fl.set(f.cam, TRIAL.cam / 4)
  fl[TRIAL.scale / 4] = f.scale
  fl[TRIAL.time / 4] = f.time
  fl.set(field.origin, TRIAL.origin / 4)
  u.set(field.grid, TRIAL.grid / 4)
  fl[TRIAL.texel / 4] = TEXEL
  u[TRIAL.segments / 4] = segments
  const b = f.bike
  fl.set([b.x, b.y, b.a, f.lean], TRIAL.body / 4)
  b.wheels.forEach((w, k) => fl.set([w.x, w.y, w.spin, 0], (k ? TRIAL.front : TRIAL.rear) / 4))
  const cps = f.course.checkpoints.slice(0, 4)
  fl.set([...cps, ...Array(4 - cps.length).fill(-1e6)], TRIAL.flags / 4)
  fl.set(
    [0, 1, 2, 3].map((k) => (k < cps.length ? (groundAt(f.course, cps[k]) ?? 0) : 0)),
    TRIAL.flagsY / 4,
  )
  fl.set([f.course.finish, groundAt(f.course, f.course.finish) ?? 0], TRIAL.finish / 4)
  fl[TRIAL.passed / 4] = f.passed
  fl[TRIAL.crashed / 4] = b.crashed ? 1 : 0
  u[TRIAL.dust / 4] = f.dust
  return into
}

/**
 * Mud and dust thrown off the tyres: where a wheel touches and slips, a spray off the back of the
 * contact, faster the more it slips. Random only in how it looks, from a seeded generator, so a
 * test can ask for the same spray twice. Each particle is eight floats: x, y, vx, vy, life, size,
 * shade, 0.
 */
export function sprayFor(b: Bike, course: Course, rand: () => number): number[] {
  const out: number[] = []
  b.wheels.forEach((w, k) => {
    if (!b.touching[k] || b.slip[k] < 1.2) return
    const hit = nearest(course, [w.x, w.y], WHEEL_R + 0.3)
    if (!hit) return
    const n = hit.n
    const t: V2 = [n[1], -n[0]]
    // the tyre's surface runs backwards over the ground when it spins faster than it rolls
    const dir = Math.sign(w.w * WHEEL_R + w.vx * t[0] + w.vy * t[1]) || -1
    const count = Math.min(6, Math.floor(b.slip[k] / 1.2))
    for (let i = 0; i < count; i++) {
      const s = Math.min(9, b.slip[k]) * (0.4 + 0.5 * rand())
      out.push(
        w.x - n[0] * WHEEL_R * 0.9,
        w.y - n[1] * WHEEL_R * 0.9 + 0.05,
        t[0] * s * dir + n[0] * (1.5 + 2.5 * rand()) + (rand() - 0.5),
        t[1] * s * dir + n[1] * (1.5 + 2.5 * rand()),
        1.2 + rand() * 1.4,
        0.03 + 0.05 * rand(),
        rand(),
        0,
      )
    }
  })
  return out
}

/** where a best time is kept: frames, a whole number */
export const BEST_KEY = 'lab_trials_best_v1'

/**
 * A stored best time, or null. ⚠️ STORAGE IS INPUT: anything could be under the key — another
 * version's format, a hand edit, a string — so only a whole number of frames between a second and
 * an hour is believed.
 */
export function readBest(raw: string | null): number | null {
  if (raw === null || !/^\d{1,7}$/.test(raw)) return null
  const n = Number(raw)
  return n >= 60 && n <= 60 * 60 * 60 ? n : null
}
