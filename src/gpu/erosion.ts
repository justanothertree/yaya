/**
 * The arithmetic of the Lab's eroding landscape: rain falls, runs downhill, carries the ground
 * away where it runs fast and drops it where it slows, and steep slopes slump — so valleys,
 * rivers and fans of sand carve themselves into whatever land is there.
 *
 * ⚠️ WATER MOVES THROUGH PIPES, NOT AS PARTICLES. This is the "virtual pipes" shallow-water model
 * (Mei, Decaudin & Hu, 2007): every cell keeps four outflows, one through a pipe to each
 * neighbour, and each frame a pipe's flow is pushed by the difference in water SURFACE height
 * across it. A cell can never send more water than it has (the outflows are scaled down to fit),
 * and what one cell sends, its neighbour receives — so water is conserved exactly by
 * construction, which erosion.test.ts checks. From the flows comes a velocity; from the velocity
 * and the slope, how much sediment the water could carry; the difference is picked up or put down.
 *
 * Every step is mirrored in erosion-step.wgsl, one function to one compute pass, so the tests can
 * hold the shader to this file.
 */

/** Hand-packed to match `struct Land` — erosion.test.ts lays the struct out from the shader. */
export const LAND = {
  view: 0,
  eye: 64,
  n: 76,
  rayO: 80,
  dt: 92,
  rayD: 96,
  tool: 108,
  rain: 112,
  step: 116,
  radius: 120,
  open: 124,
  bytes: 128,
} as const

/** cells each way */
export const N = 256
/** gravity, in cells per second² */
export const G = 9.81
/** seconds per step */
export const DT = 0.04
/**
 * How much sediment flowing water can carry, per unit of speed and slope. ⚠️ First 0.6, with
 * KS 0.5: a storm carved 20 cells deep in 24 seconds and gullied every slope into needles — a
 * landscape that is finished before anybody has watched it. A fifth of that lets a river take a
 * minute or two to cut its valley.
 */
export const KC = 0.12
/** how quickly it picks ground up, and puts sediment down, per second */
export const KS = 0.3
export const KD = 0.4
/** how quickly standing water dries, per second */
export const KE = 0.03
/** flat ground still lets water carry something: the slope is read as at least this */
export const MIN_TILT = 0.05
/** water shallower than this carries proportionally less, so a damp film does not dig */
export const DEPTH_CAP = 0.6
/** steeper than this many cells of height per cell, ground slumps */
export const TALUS = 1.4
export const KT = 4
/**
 * How quickly a pipe's flow dies away by itself, per second. ⚠️ The pipe model as published keeps
 * every flow's momentum and loses none of it, so a heap of water on flat ground never settled: it
 * sloshed as a standing wave for good (measured: max − min depth still 0.38 against a mean of 0.31
 * after a minute). Friction lets it come to rest, and rivers still run.
 */
export const FRICTION = 0.6
/**
 * How much rain falls everywhere in a storm, cells of water per second. ⚠️ First as drops — a
 * cell in 250 got 0.35 of water each step — and every drop dug its own pit, pocking the land with
 * spikes. Rain that falls evenly runs together into streams instead; the finger's rain is the
 * downpour.
 */
export const RAIN = 0.04

/** one cell: ground, water, sediment carried, and the ground it started as */
export type Fields = {
  b: Float32Array
  d: Float32Array
  s: Float32Array
  b0: Float32Array
  /** outflow through each pipe: left, right, up, down */
  f: Float32Array
  vx: Float32Array
  vy: Float32Array
}

export const fieldsFor = (n: number): Fields => ({
  b: new Float32Array(n * n),
  d: new Float32Array(n * n),
  s: new Float32Array(n * n),
  b0: new Float32Array(n * n),
  f: new Float32Array(n * n * 4),
  vx: new Float32Array(n * n),
  vy: new Float32Array(n * n),
})

const DX = [-1, 1, 0, 0]
const DY = [0, 0, -1, 1]
/** the pipe on the far side that points back: left ↔ right, up ↔ down */
const BACK = [1, 0, 3, 2]

/**
 * 1 — flux: each pipe's flow is pushed by the difference in surface height across it, never
 * negative, then all four are scaled so the cell does not send more than it holds. Past the edge
 * of the map, an `open` edge is dry ground at the cell's own height — water pours off — and a
 * closed one is a wall.
 */
export function stepFlux(F: Fields, n: number, dt: number, open: boolean) {
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const i = y * n + x
      const h = F.b[i] + F.d[i]
      let sum = 0
      for (let k = 0; k < 4; k++) {
        const nx = x + DX[k]
        const ny = y + DY[k]
        const inside = nx >= 0 && ny >= 0 && nx < n && ny < n
        let flow = 0
        if (inside || open) {
          const hn = inside ? F.b[ny * n + nx] + F.d[ny * n + nx] : F.b[i]
          flow = Math.max(0, F.f[i * 4 + k] * (1 - FRICTION * dt) + dt * G * (h - hn))
        }
        F.f[i * 4 + k] = flow
        sum += flow
      }
      const scale = sum > 0 ? Math.min(1, F.d[i] / (sum * dt)) : 0
      for (let k = 0; k < 4; k++) F.f[i * 4 + k] *= scale
    }
}

/** 2 — water: what flows in less what flows out, and the velocity that flow makes */
export function stepWater(F: Fields, n: number, dt: number) {
  const d2 = new Float32Array(F.d.length)
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const i = y * n + x
      const inflow = [0, 0, 0, 0]
      for (let k = 0; k < 4; k++) {
        const nx = x + DX[k]
        const ny = y + DY[k]
        if (nx >= 0 && ny >= 0 && nx < n && ny < n) inflow[k] = F.f[(ny * n + nx) * 4 + BACK[k]]
      }
      const out = F.f[i * 4] + F.f[i * 4 + 1] + F.f[i * 4 + 2] + F.f[i * 4 + 3]
      const dn = Math.max(0, F.d[i] + dt * (inflow[0] + inflow[1] + inflow[2] + inflow[3] - out))
      // water through the cell each way: in from the left and out to the right, less the reverse
      const wx = (inflow[0] - F.f[i * 4] + F.f[i * 4 + 1] - inflow[1]) / 2
      const wy = (inflow[2] - F.f[i * 4 + 2] + F.f[i * 4 + 3] - inflow[3]) / 2
      const mean = (F.d[i] + dn) / 2
      F.vx[i] = mean > 1e-4 ? wx / mean : 0
      F.vy[i] = mean > 1e-4 ? wy / mean : 0
      d2[i] = dn
    }
  F.d.set(d2)
}

const at = (a: Float32Array, n: number, x: number, y: number) =>
  a[Math.min(n - 1, Math.max(0, y)) * n + Math.min(n - 1, Math.max(0, x))]

/** how steep the ground is at a cell, as the sine of its tilt, never less than MIN_TILT */
export function tiltAt(b: Float32Array, n: number, x: number, y: number) {
  const gx = (at(b, n, x + 1, y) - at(b, n, x - 1, y)) / 2
  const gy = (at(b, n, x, y + 1) - at(b, n, x, y - 1)) / 2
  const g2 = gx * gx + gy * gy
  return Math.max(MIN_TILT, Math.sqrt(g2 / (1 + g2)))
}

/**
 * 3 — erode and dry: water that could carry more than it does picks ground up; water carrying
 * more than it could puts some down. What leaves the ground joins the sediment and the other way
 * about, so ground plus sediment is unchanged by this step. Then a little water dries.
 */
export function stepErode(F: Fields, n: number, dt: number) {
  const tilt = new Float32Array(F.b.length)
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) tilt[y * n + x] = tiltAt(F.b, n, x, y)
  for (let i = 0; i < F.b.length; i++) {
    const speed = Math.hypot(F.vx[i], F.vy[i])
    const capacity = KC * tilt[i] * speed * Math.min(1, F.d[i] / DEPTH_CAP)
    const moved = capacity > F.s[i] ? KS * (capacity - F.s[i]) * dt : -KD * (F.s[i] - capacity) * dt
    // never dig past what the water could carry, nor put down more than it has
    const m = Math.max(-F.s[i], moved)
    F.b[i] -= m
    F.s[i] += m
    F.d[i] *= 1 - KE * dt
  }
}

/**
 * 4 — carry and slump: the sediment is carried along with the water (traced back along the
 * velocity and read between cells), and where the ground is steeper than TALUS it slides down,
 * each pair of neighbours trading exactly what the other loses.
 */
export function stepSettle(F: Fields, n: number, dt: number) {
  const s2 = new Float32Array(F.s.length)
  const b2 = new Float32Array(F.b.length)
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const i = y * n + x
      const px = Math.min(n - 1, Math.max(0, x - F.vx[i] * dt))
      const py = Math.min(n - 1, Math.max(0, y - F.vy[i] * dt))
      const x0 = Math.floor(px)
      const y0 = Math.floor(py)
      const fx = px - x0
      const fy = py - y0
      const s00 = at(F.s, n, x0, y0)
      const s10 = at(F.s, n, x0 + 1, y0)
      const s01 = at(F.s, n, x0, y0 + 1)
      const s11 = at(F.s, n, x0 + 1, y0 + 1)
      s2[i] = (s00 * (1 - fx) + s10 * fx) * (1 - fy) + (s01 * (1 - fx) + s11 * fx) * fy
      let slump = 0
      for (let k = 0; k < 4; k++) {
        const nx = x + DX[k]
        const ny = y + DY[k]
        if (nx < 0 || ny < 0 || nx >= n || ny >= n) continue
        const diff = F.b[ny * n + nx] - F.b[i]
        slump += Math.max(0, diff - TALUS) - Math.max(0, -diff - TALUS)
      }
      b2[i] = F.b[i] + KT * dt * slump * 0.25
    }
  F.s.set(s2)
  F.b.set(b2)
}

/** one whole step, as the GPU takes it (without the rain and the finger, which come first) */
export function step(F: Fields, n: number, dt = DT, open = true) {
  stepFlux(F, n, dt, open)
  stepWater(F, n, dt)
  stepErode(F, n, dt)
  stepSettle(F, n, dt)
}

/** a hash of two integers to 0..1, the same as erosion-step.wgsl's, for rain and for land */
export function hash(a: number, b: number): number {
  let x = (Math.imul(a, 747796405) + Math.imul(b, 2891336453)) >>> 0
  x = Math.imul((x >>> ((x >>> 28) + 4)) ^ x, 277803737) >>> 0
  x = ((x >>> 22) ^ x) >>> 0
  return x / 4294967295
}

export const LANDS = { hills: 'Hills', ridge: 'Ridge', mesa: 'Mesa' } as const
export type LandKind = keyof typeof LANDS

/** smooth noise on a lattice, 0..1 */
function noise(x: number, y: number, seed: number) {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const fx = x - xi
  const fy = y - yi
  const u = fx * fx * (3 - 2 * fx)
  const v = fy * fy * (3 - 2 * fy)
  const h = (a: number, b: number) => hash(a + seed * 7919, b - seed * 104729)
  return (
    (h(xi, yi) * (1 - u) + h(xi + 1, yi) * u) * (1 - v) +
    (h(xi, yi + 1) * (1 - u) + h(xi + 1, yi + 1) * u) * v
  )
}

/**
 * Land to start with, heights in cells: Hills (rolling noise, higher in the middle), Ridge (a
 * long spine with spurs) or Mesa (flat-topped tablelands with cliffs, which slump and gully).
 */
export function landFor(kind: LandKind, n: number, seed: number): Float32Array {
  const out = new Float32Array(n * n)
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const u = x / n
      const v = y / n
      let fbm = 0
      let amp = 0.5
      let f = 3
      for (let o = 0; o < 6; o++) {
        fbm += noise(u * f, v * f, seed + o) * amp
        amp *= 0.5
        f *= 2
      }
      const r = Math.hypot(u - 0.5, v - 0.5)
      let h: number
      if (kind === 'ridge') {
        const spine = Math.abs(v - 0.5 - 0.12 * Math.sin(u * 7 + seed))
        h = 46 * Math.max(0, 1 - spine * 3.2) ** 1.5 + 30 * (1 - Math.abs(2 * fbm - 1)) ** 2
      } else if (kind === 'mesa') {
        const t = fbm * (1.2 - r)
        h = 10 + 30 * Math.min(1, Math.max(0, (t - 0.38) * 9)) + 6 * fbm
      } else h = 6 + 150 * Math.max(0, fbm - 0.3) ** 1.3 * Math.max(0, 1.15 - r * 1.3)
      out[y * n + x] = h
    }
  return out
}

type V3 = [number, number, number]

/** the vertical field of view, radians */
export const FOV = (50 * Math.PI) / 180

export type Camera = {
  eye: V3
  fwd: V3
  right: V3
  up: V3
  aspect: number
  /** world to clip, column-major, as WGSL's mat4x4f reads it */
  view: Float32Array
}

/**
 * A camera on a sphere round the middle of the land, `yaw` round and `pitch` above the horizon,
 * `dist` away, looking at a point a little above the ground. Depth runs 0..1, as WebGPU's does.
 */
export function orbitCamera(yaw: number, pitch: number, dist: number, aspect: number): Camera {
  const target: V3 = [0, 12, 0]
  const eye: V3 = [
    target[0] + dist * Math.cos(pitch) * Math.sin(yaw),
    target[1] + dist * Math.sin(pitch),
    target[2] + dist * Math.cos(pitch) * Math.cos(yaw),
  ]
  const f = [target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]]
  const fl = Math.hypot(...f)
  const fwd: V3 = [f[0] / fl, f[1] / fl, f[2] / fl]
  // right = fwd × up(world), up = right × fwd
  const r = [-fwd[2], 0, fwd[0]]
  const rl = Math.hypot(...r) || 1
  const right: V3 = [r[0] / rl, r[1] / rl, r[2] / rl]
  const up: V3 = [
    right[1] * fwd[2] - right[2] * fwd[1],
    right[2] * fwd[0] - right[0] * fwd[2],
    right[0] * fwd[1] - right[1] * fwd[0],
  ]
  const near = 1
  const far = 3000
  const t = 1 / Math.tan(FOV / 2)
  const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
  // rows of the view matrix: right, up, −fwd; then a perspective with depth 0..1
  const rows = [
    [right[0], right[1], right[2], -dot(right, eye)],
    [up[0], up[1], up[2], -dot(up, eye)],
    [-fwd[0], -fwd[1], -fwd[2], dot(fwd, eye)],
  ]
  const proj = [
    [t / aspect, 0, 0, 0],
    [0, t, 0, 0],
    [0, 0, far / (near - far), (near * far) / (near - far)],
    [0, 0, -1, 0],
  ]
  const viewRows = [...rows, [0, 0, 0, 1]]
  const m = new Float32Array(16)
  for (let row = 0; row < 4; row++)
    for (let col = 0; col < 4; col++) {
      let s = 0
      for (let k = 0; k < 4; k++) s += proj[row][k] * viewRows[k][col]
      m[col * 4 + row] = s
    }
  return { eye, fwd, right, up, aspect, view: m }
}

/** the ray from the eye through a point of the screen (−1..1 each way, y up) */
export function rayAt(c: Camera, sx: number, sy: number): V3 {
  const t = Math.tan(FOV / 2)
  const d = [0, 1, 2].map((k) => c.fwd[k] + c.right[k] * sx * t * c.aspect + c.up[k] * sy * t)
  const l = Math.hypot(d[0], d[1], d[2])
  return [d[0] / l, d[1] / l, d[2] / l]
}

/** where a world point lands on screen (−1..1, y up) and its depth, through the view matrix */
export function project(c: Camera, p: V3): V3 {
  const m = c.view
  const v = [0, 1, 2, 3].map((r) => m[r] * p[0] + m[4 + r] * p[1] + m[8 + r] * p[2] + m[12 + r])
  return [v[0] / v[3], v[1] / v[3], v[2] / v[3]]
}

export const TOOLS = { rain: '🌧 Rain', raise: '⛰ Raise', dig: '⛏ Dig', turn: '🔄 Turn' } as const
export type Tool = keyof typeof TOOLS
export const TOOL_ID: Record<Tool, number> = { rain: 1, raise: 2, dig: 3, turn: 0 }

export type LandFrame = {
  cam: Camera
  /** the finger's ray, or null when nothing is touching (or it is turning the view) */
  ray: V3 | null
  tool: Tool
  rain: number
  step: number
  radius: number
  open: boolean
}

export function packLand(p: LandFrame, into = new ArrayBuffer(LAND.bytes)) {
  const f = new Float32Array(into)
  const u = new Uint32Array(into)
  f.set(p.cam.view, LAND.view / 4)
  f.set(p.cam.eye, LAND.eye / 4)
  u[LAND.n / 4] = N
  f.set(p.cam.eye, LAND.rayO / 4)
  f[LAND.dt / 4] = DT
  f.set(p.ray ?? [0, 0, 1], LAND.rayD / 4)
  u[LAND.tool / 4] = p.ray ? TOOL_ID[p.tool] : 0
  f[LAND.rain / 4] = p.rain
  u[LAND.step / 4] = p.step
  f[LAND.radius / 4] = p.radius
  u[LAND.open / 4] = p.open ? 1 : 0
  return into
}
