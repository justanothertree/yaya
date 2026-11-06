/**
 * The arithmetic of the Lab's snowflake: Clifford Reiter's hexagonal model of snow crystal growth
 * (2005), on a lattice of hexagons the way the shader holds it.
 *
 * ⚠️ A SNOW CRYSTAL IS SIX-SIDED BECAUSE ICE IS, AND ITS ARMS ARE ALIKE BECAUSE THE AIR IS. Every
 * cell holds an amount of water. A cell that is ice (≥ 1), or touches ice, is RECEPTIVE: it keeps
 * what it has and gains γ more from the air each step. Every other cell's water diffuses — moves
 * part of the way (α) to its six neighbours' mean. So vapour flows towards the crystal, and the
 * crystal's tips, reaching furthest into the vapour, get the most: they grow faster, and branch.
 * How much vapour there is (β) and how fast the crystal takes it (γ) decide between plates,
 * stars and ferns — the same two things the weather decides for real ones. Nothing here is told to
 * be symmetric; it is symmetric because the lattice and the air are, and snowflake.test.ts checks
 * that it stays so.
 *
 * Cells are AXIAL coordinates (q, r): the six neighbours are (±1, 0), (0, ±1), (1, −1), (−1, 1).
 */

/** Hand-packed to match `struct Flake` — snowflake.test.ts lays the struct out from the shader. */
export const FLAKE = {
  size: 0,
  w: 8,
  radius: 12,
  alpha: 16,
  beta: 20,
  gamma: 24,
  breath: 28,
  finger: 32,
  reach: 40,
  sym: 44,
  bytes: 48,
} as const

/** cells each way of the lattice; the crystal grows from the middle one */
export const W = 401
/** past this hex distance from the middle, cells are the open air: held at β */
export const EDGE = 196

/** the six neighbours of a cell, in axial steps — mirrored in snowflake.wgsl */
export const NEIGHBOURS = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
  [1, -1],
  [-1, 1],
] as const

/** how many steps apart two cells are on the lattice */
export const hexDistance = (dq: number, dr: number) =>
  (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2

/** a sixth of a turn round the middle: (q, r) → (−r, q + r) */
export const rotate = (q: number, r: number): [number, number] => [0 - r, q + r]

/** where a cell's centre is drawn, in cells (x right, y down) */
export const cellToPlane = (q: number, r: number): [number, number] => [
  q + r / 2,
  (r * Math.sqrt(3)) / 2,
]
/** and back: the axial coordinates of a point of the plane, not yet rounded to a cell */
export const planeToCell = (x: number, y: number): [number, number] => {
  const r = (y * 2) / Math.sqrt(3)
  return [x - r / 2, r]
}

export type Weather = {
  name: string
  beta: number
  gamma: number
  alpha: number
  /** steps a second at Brisk: about what grows it to the edge of the air in forty seconds */
  pace: number
}

export function freshLattice(w: number, beta: number): Float32Array<ArrayBuffer> {
  const s = new Float32Array(w * w).fill(beta)
  const c = (w - 1) / 2
  s[c * w + c] = 1
  return s
}

/**
 * One step of Reiter's model over the lattice `s` (w × w, axial, the middle cell the origin),
 * cells past `edge` held at β. Mirrored in snowflake.wgsl's `grow`; `vapour` adds to the air
 * (not to ice) where somebody breathes, a cell at a time.
 */
export function stepFlake(
  s: Float32Array,
  w: number,
  edge: number,
  alpha: number,
  beta: number,
  gamma: number,
  vapour?: (q: number, r: number) => number,
): Float32Array<ArrayBuffer> {
  const c = (w - 1) / 2
  const frozen = (q: number, r: number) => q >= 0 && r >= 0 && q < w && r < w && s[r * w + q] >= 1
  const receptive = new Uint8Array(w * w)
  for (let r = 0; r < w; r++)
    for (let q = 0; q < w; q++) {
      let rec = frozen(q, r)
      for (const [dq, dr] of NEIGHBOURS) rec ||= frozen(q + dq, r + dr)
      receptive[r * w + q] = rec ? 1 : 0
    }
  const u = (q: number, r: number) => {
    if (q < 0 || r < 0 || q >= w || r >= w) return beta
    return receptive[r * w + q] ? 0 : s[r * w + q]
  }
  const out = new Float32Array(w * w)
  for (let r = 0; r < w; r++)
    for (let q = 0; q < w; q++) {
      const i = r * w + q
      if (hexDistance(q - c, r - c) > edge) {
        out[i] = beta
        continue
      }
      /* every cell's vapour diffuses — a receptive cell's counts as none, so vapour drawn into it
         from the air beside it stays, on top of what it keeps and the γ it gains. ⚠️ The first
         version left receptive cells out of the diffusion altogether, and with nothing drawing
         vapour into the ice, nothing was starved of it: every weather grew a plain hexagonal
         plate. The inflow is what makes the tips win, and the arms. */
      let mean = 0
      for (const [dq, dr] of NEIGHBOURS) mean += u(q + dq, r + dr)
      mean /= 6
      const kept = receptive[i] ? s[i] + gamma : 0
      const here = receptive[i] ? 0 : s[i] + (vapour ? vapour(q - c, r - c) : 0)
      out[i] = kept + here + (alpha / 2) * (mean - here)
    }
  return out
}

export type FlakeFrame = {
  w: number
  h: number
  weather: Weather
  /** 0..1, somebody blowing on the microphone */
  breath: number
  /** a finger breathing on it, in axial cells from the middle, and how hard; or null */
  finger: readonly [number, number] | null
  sym: boolean
}

/** how hard a finger breathes, in water a step at the middle of its breath */
export const FINGER_BREATH = 0.004

export function packFlake(p: FlakeFrame, into = new ArrayBuffer(FLAKE.bytes)) {
  const u = new Uint32Array(into)
  const f = new Float32Array(into)
  u[0] = p.w
  u[1] = p.h
  u[FLAKE.w / 4] = W
  f[FLAKE.radius / 4] = EDGE
  f[FLAKE.alpha / 4] = p.weather.alpha
  f[FLAKE.beta / 4] = p.weather.beta
  f[FLAKE.gamma / 4] = p.weather.gamma
  f[FLAKE.breath / 4] = p.breath
  f.set(p.finger ?? [0, 0], FLAKE.finger / 4)
  f[FLAKE.reach / 4] = p.finger ? FINGER_BREATH : 0
  u[FLAKE.sym / 4] = p.sym ? 1 : 0
  return into
}

/**
 * The breath on the microphone, 0..1, from its loudness (0..1, `readLevel`): quick to rise and
 * slow to fall, as a breath on a cold window lingers — and nothing at all below the hum of a
 * quiet room.
 */
export function breathFrom(prev: number, level: number, dt: number): number {
  const target = Math.min(1, Math.max(0, (level - 0.06) / 0.3))
  const tau = target > prev ? 0.08 : 0.9
  const next = prev + (target - prev) * (1 - Math.exp(-dt / tau))
  return next < 0.002 ? 0 : next
}

/**
 * How fast it grows: a multiple of each weather's own pace. ⚠️ First a fixed number of steps a
 * frame (20, 60, 150), which took no account of how differently the weathers grow — measured on
 * the full lattice, Feather filled its disc in 900 steps, a quarter of a second at 60 a frame, and
 * Fern needs several times as many. Each weather now has a pace, and all of them take about the
 * same time to grow.
 */
export const SPEEDS = {
  calm: ['Calm', 0.4],
  brisk: ['Brisk', 1],
  blizzard: ['Blizzard', 3],
} as const
export type Speed = keyof typeof SPEEDS

/**
 * Four weathers, found by growing crystals at a range of β and γ and keeping four that look
 * nothing alike (the sweep is in docs/LAB-HANDOFF.md): long ferny arms with side branches, a
 * classic star, broad sectored arms, and arms thick with feathery branches. Their paces come from
 * how many steps each took to reach 80 cells out on a 201-wide lattice (Fern 2,500, Star 1,700,
 * Sector 2,800, Feather 400), scaled to this one's 196.
 */
export const WEATHERS = {
  fern: { name: 'Fern', beta: 0.35, gamma: 0.0001, alpha: 1, pace: 150 },
  star: { name: 'Star', beta: 0.4, gamma: 0.001, alpha: 1, pace: 100 },
  sector: { name: 'Sector', beta: 0.3, gamma: 0.003, alpha: 1, pace: 160 },
  feather: { name: 'Feather', beta: 0.65, gamma: 0.001, alpha: 1, pace: 25 },
} satisfies Record<string, Weather>
export type WeatherId = keyof typeof WEATHERS

/**
 * Steps to run this frame, carrying the fraction over: a weather's pace times the speed, by the
 * frame's length. Returns the whole steps and what is left over for the next frame.
 */
export function stepsFor(pace: number, speed: number, dt: number, carry: number): [number, number] {
  const want = carry + pace * speed * dt
  const n = Math.floor(want)
  return [n, want - n]
}
