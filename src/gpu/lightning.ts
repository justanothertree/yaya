/**
 * The arithmetic of the Lab's lightning: a stepped leader feeling its way down from the cloud,
 * branching, until one branch touches the ground and the path it took flashes — the return stroke.
 *
 * ⚠️ IT GROWS WHERE THE FIELD IS STRONGEST, CHOSEN BY CHANCE. This is the dielectric breakdown model
 * (Niemeyer, Pietronero & Wiesmann, 1984). The air holds an electric potential φ: 0 on the cloud
 * and on the channel already broken down, 1 on the ground and on any lightning rod. φ is the
 * solution of Laplace's equation between them, found by relaxing — every cell moved to its
 * neighbours' mean, again and again. Each step one more cell next to the channel breaks down,
 * chosen with probability ∝ φ^η: η = 1 branches wildly, larger η runs straighter.
 *
 * ⚠️ AND THE CHOICE IS AN EXPONENTIAL RACE, SO THE GPU CAN MAKE IT. Picking one cell in proportion
 * to a weight usually needs a running total over every candidate. Instead every candidate draws
 * its own time e = −ln(u)/w (u uniform) and the earliest wins: the winner is cell i with exactly
 * probability w_i / Σw, and "earliest" is an atomicMin over the floats' bits (positive floats sort
 * as their bits do), then a second pass where the cell whose time equals the minimum claims the
 * win. lightning.test.ts counts the wins.
 */

/** Hand-packed to match `struct Bolt` — lightning.test.ts lays the struct out from the shader. */
export const BOLT = {
  size: 0,
  grid: 8,
  eta: 16,
  step: 20,
  flash: 24,
  fade: 28,
  rods: 32,
  bytes: 40,
} as const

/** the longer side of the grid, in cells */
export const LONG = 192
/** how many relaxations of the field between one cell breaking down and the next */
export const RELAX = 12

export const KIND = { air: 0, channel: 1, ground: 2, rod: 3 } as const

/** a hash of two integers to 0..1 — the same as lightning.wgsl's */
export function hash(a: number, b: number): number {
  let x = (Math.imul(a, 747796405) + Math.imul(b, 2891336453)) >>> 0
  x = Math.imul((x >>> ((x >>> 28) + 4)) ^ x, 277803737) >>> 0
  x = ((x >>> 22) ^ x) >>> 0
  return x / 4294967295
}

export type Field = {
  w: number
  h: number
  /** the potential */
  phi: Float32Array<ArrayBuffer>
  /** what each cell is: air, channel, ground, rod */
  kind: Uint8Array
}

/** a sky: cloud along the top row (channel, φ = 0), ground along the bottom, air between */
export function freshField(
  w: number,
  h: number,
  rods: readonly (readonly [number, number])[] = [],
): Field {
  const kind = new Uint8Array(w * h)
  const phi = new Float32Array(w * h)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      kind[i] = y === 0 ? KIND.channel : y === h - 1 ? KIND.ground : KIND.air
      phi[i] = y / (h - 1)
    }
  for (const [x, y] of rods) kind[y * w + x] = KIND.rod
  for (let i = 0; i < kind.length; i++)
    if (kind[i] === KIND.channel) phi[i] = 0
    else if (kind[i] !== KIND.air) phi[i] = 1
  return { w, h, phi, kind }
}

/** one relaxation (Jacobi): air moves to its four neighbours' mean, the sides reflect */
export function relax(f: Field): void {
  const { w, h, phi, kind } = f
  const out = new Float32Array(phi.length)
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      if (kind[i] !== KIND.air) {
        out[i] = kind[i] === KIND.channel ? 0 : 1
        continue
      }
      const l = phi[y * w + Math.max(0, x - 1)]
      const r = phi[y * w + Math.min(w - 1, x + 1)]
      const u = phi[Math.max(0, y - 1) * w + x]
      const d = phi[Math.min(h - 1, y + 1) * w + x]
      out[i] = (l + r + u + d) / 4
    }
  phi.set(out)
}

const NB8 = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
] as const

/** air touching the channel (any of eight neighbours): where the next breakdown can happen */
export function isCandidate(f: Field, x: number, y: number): boolean {
  if (f.kind[y * f.w + x] !== KIND.air) return false
  for (const [dx, dy] of NB8) {
    const nx = x + dx
    const ny = y + dy
    if (nx >= 0 && ny >= 0 && nx < f.w && ny < f.h && f.kind[ny * f.w + nx] === KIND.channel)
      return true
  }
  return false
}

/** a candidate's time in the race: −ln(u)/φ^η, or Infinity if its field is nothing */
export function raceTime(phi: number, eta: number, u: number): number {
  const w = Math.max(0, phi) ** eta
  return w > 0 ? -Math.log(Math.max(u, 1e-12)) / w : Infinity
}

/** the race, run plainly: the candidate with the earliest time, for the step's random draws */
export function winner(f: Field, eta: number, step: number): number {
  let best = -1
  let bestT = Infinity
  for (let y = 0; y < f.h; y++)
    for (let x = 0; x < f.w; x++) {
      if (!isCandidate(f, x, y)) continue
      const i = y * f.w + x
      const t = Math.fround(raceTime(f.phi[i], eta, hash(i, step)))
      if (t < bestT || (t === bestT && i < best)) {
        bestT = t
        best = i
      }
    }
  return best
}

/** does this cell, once channel, touch the ground or a rod? Then the leader has arrived */
export function touchesGround(f: Field, i: number): boolean {
  const x = i % f.w
  const y = Math.floor(i / f.w)
  for (const [dx, dy] of NB8) {
    const nx = x + dx
    const ny = y + dy
    if (nx < 0 || ny < 0 || nx >= f.w || ny >= f.h) continue
    const k = f.kind[ny * f.w + nx]
    if (k === KIND.ground || k === KIND.rod) return true
  }
  return false
}

/**
 * The three shapes: η, and how many cells the leader grows a frame. ⚠️ First one rate for all, and
 * measured on the GPU a Wild bolt needs 2,334 cells to reach the ground against Forked's 586 and
 * Straight's 300 — six and a half seconds at six a frame. Each now takes a couple of seconds.
 */
export const SHAPES = {
  wild: ['Wild', 1, 20],
  forked: ['Forked', 2, 6],
  straight: ['Straight', 3.5, 3],
} as const
export type Shape = keyof typeof SHAPES

export type BoltFrame = {
  w: number
  h: number
  grid: readonly [number, number]
  eta: number
  step: number
  /** 0..1: the return stroke's flash, fading */
  flash: number
  /** 0..1: how much of the old channel is still glowing */
  fade: number
  rods: number
}

export function packBolt(p: BoltFrame, into = new ArrayBuffer(BOLT.bytes)) {
  const u = new Uint32Array(into)
  const f = new Float32Array(into)
  u[0] = p.w
  u[1] = p.h
  u[BOLT.grid / 4] = p.grid[0]
  u[BOLT.grid / 4 + 1] = p.grid[1]
  f[BOLT.eta / 4] = p.eta
  u[BOLT.step / 4] = p.step
  f[BOLT.flash / 4] = p.flash
  f[BOLT.fade / 4] = p.fade
  u[BOLT.rods / 4] = p.rods
  return into
}

/** the grid for a canvas: LONG cells along its longer side */
export function gridFor(w: number, h: number): [number, number] {
  return w >= h
    ? [LONG, Math.max(32, Math.round((LONG * h) / w))]
    : [Math.max(32, Math.round((LONG * w) / h)), LONG]
}
