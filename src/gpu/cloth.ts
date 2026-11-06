/**
 * The arithmetic of the Lab's cloth: the grid, its edges and their colouring, the uniform, and a
 * CPU copy of the whole solver. cloth-sim.wgsl runs the same steps in the same order, and the
 * colouring is what makes that comparison exact — see `phaseOf`.
 *
 * World: y up, x from -aspect to aspect, y from -1 to 1; z towards the viewer. Row 0 is the top.
 */

/** Hand-packed to match `struct Cloth` — cloth.test.ts lays the struct out from the shader. */
export const CLOTH = {
  f0: 0,
  f1: 16,
  f2: 32,
  f3: 48,
  cols: 64,
  rows: 68,
  phase: 72,
  tool: 76,
  spacing: 80,
  dt: 84,
  time: 88,
  wind: 92,
  aspect: 96,
  down: 100,
  pressed: 104,
  fabric: 108,
  step: 112,
  steps: 116,
  bytes: 128,
} as const

/** ⚠️ MIRRORED IN cloth-sim.wgsl; cloth.test.ts reads them back out of it. */
export const GRAVITY = 2.5
export const DAMP = 0.995
/** an edge pulled past this many times its length breaks */
export const TEAR = 2.4
export const GRAB_RADIUS = 0.07
export const FLOOR = -0.98
export const DIAGONAL_STIFF = 0.5
/** passes over every constraint, per step */
export const ITERS = 10
export const STEP = 1 / 60
export const FINGERS = 4

export type Grid = { cols: number; rows: number; spacing: number; left: number; top: number }
/**
 * How it hangs: a curtain from its whole top edge, or pegged on a line.
 *
 * ⚠️ THERE IS NO "TWO CORNERS", and it was tried: an iterative solver cannot hold a 64-wide sheet
 * from two points. Ten passes move a correction about ten particles, so the middle of the sheet
 * never learns it is held — it falls, and the edges at the pins stretch by a few percent a frame
 * until they tear, untouched (measured: 1.01 → 3.05 of their length in 30 steps). Pegs every
 * PEG_GAP columns keep every particle within reach of something holding it.
 */
export type Pins = 'curtain' | 'pegs'
export const PEG_GAP = 9
export type Tool = 'grab' | 'cut'

/** a cloth that fills most of the view, finer where there is a GPU to spare */
export function gridFor(aspect: number, touch: boolean): Grid {
  const cols = touch ? 44 : 64
  const width = Math.min(2 * aspect * 0.8, 2.4)
  const spacing = width / (cols - 1)
  const rows = Math.round(1.45 / spacing) + 1
  return { cols, rows, spacing, left: -width / 2, top: 0.85 }
}

/**
 * Four kinds of edge: across (H), down (V), and the two diagonals of each square (D1 ╲, D2 ╱),
 * which keep it from shearing flat like a trellis. Stored one after another in one flat list.
 */
export const KINDS = 4
export function edgeCounts(g: Grid): [number, number, number, number] {
  const q = (g.cols - 1) * (g.rows - 1)
  return [(g.cols - 1) * g.rows, g.cols * (g.rows - 1), q, q]
}

/**
 * The two particles edge `e` of `kind` joins, and the coordinate its colour is decided by.
 *
 * ⚠️ THE COLOURING IS THE WHOLE TRICK. Every edge in one phase is projected by its own thread at
 * the same moment, so two edges in a phase must never share a particle — or both threads move it
 * and one write is lost. Splitting each kind by the parity of one coordinate does it: the two H
 * edges that meet at a particle start at x and x−1, which are never both even. Eight phases, no
 * particle written twice in any of them — and so the parallel solve does what a sequential one
 * does in the same order, which is how the CPU copy below can check the GPU closely rather than
 * roughly. Measured over 120 steps of a pegged cloth: 6.6×10⁻⁷ apart, against 1.1×10⁻² for the
 * same CPU solver with its phases reversed — so the comparison can tell orders apart. (A gathered
 * curtain in the wind: 3.7×10⁻⁵ against 6.6×10⁻², the gap being the wind's sines in f32.)
 */
export function edgeEnds(g: Grid, kind: number, e: number): [number, number, number] {
  const c = g.cols
  if (kind === 0) {
    const x = e % (c - 1)
    const y = Math.floor(e / (c - 1))
    return [y * c + x, y * c + x + 1, x]
  }
  if (kind === 1) {
    const x = e % c
    const y = Math.floor(e / c)
    return [y * c + x, (y + 1) * c + x, y]
  }
  const x = e % (c - 1)
  const y = Math.floor(e / (c - 1))
  return kind === 2 ? [y * c + x, (y + 1) * c + x + 1, x] : [y * c + x + 1, (y + 1) * c + x, x]
}
export const restOf = (g: Grid, kind: number) => (kind < 2 ? g.spacing : g.spacing * Math.SQRT2)
export const stiffOf = (kind: number) => (kind < 2 ? 1 : DIAGONAL_STIFF)

/** phase p projects the edges of kind p >> 1 whose colour is p & 1 */
export const PHASES = KINDS * 2

/**
 * A curtain is GATHERED on its rail, as a real one is: hung in less width than it has, the spare
 * taken up in folds towards and away from you. Without them a sheet seen straight on is a flat
 * card with nothing for the light to catch, whatever the fabric.
 */
export const GATHER = 0.85
export const FOLD = 1.2

/** A fresh cloth: positions, and where each was last step. w is inverse mass; 0 is pinned. */
export function seedCloth(g: Grid, pins: Pins) {
  const n = g.cols * g.rows
  const pos = new Float32Array(n * 4)
  for (let y = 0; y < g.rows; y++)
    for (let x = 0; x < g.cols; x++) {
      const i = (y * g.cols + x) * 4
      const pinned = y === 0 && (pins === 'curtain' || x % PEG_GAP === 0 || x === g.cols - 1)
      const across = pins === 'curtain' ? GATHER : 1
      const fold = pins === 'curtain' ? FOLD * g.spacing * Math.sin((2 * Math.PI * x) / 8) : 0
      pos.set(
        [g.left * across + x * g.spacing * across, g.top - y * g.spacing, fold, pinned ? 0 : 1],
        i,
      )
    }
  return { pos, prev: pos.slice() }
}

/** the breeze at a point: mostly through the cloth, a little across, and never quite steady */
export function windAt(x: number, y: number, t: number, wind: number): [number, number] {
  const s = 0.6 + 0.4 * Math.sin(x * 3 + t * 1.7) * Math.cos(y * 2.3 - t * 1.1)
  return [0.35 * s * wind, 1.0 * s * wind]
}

const f32 = Math.fround

/**
 * One step of the solver on the CPU — no fingers, as the GPU does it with none down: integrate
 * every particle, then ITERS passes over the eight phases. Mutates its arrays.
 */
export function stepCloth(g: Grid, s: ClothState, time: number, wind: number, aspect: number) {
  integrateCloth(g, s, time, wind, aspect)
  for (let it = 0; it < ITERS; it++) for (let p = 0; p < PHASES; p++) relaxPhase(g, s, p)
}

export type ClothState = { pos: Float32Array; prev: Float32Array; broken: Uint32Array }

/** every particle moved on by its velocity, gravity and the wind — `integrate` in the shader */
export function integrateCloth(
  g: Grid,
  { pos, prev }: ClothState,
  time: number,
  wind: number,
  aspect: number,
) {
  const n = g.cols * g.rows
  const dt = f32(STEP)
  for (let i = 0; i < n; i++) {
    const o = i * 4
    if (pos[o + 3] === 0) {
      prev.set(pos.subarray(o, o + 4), o)
      continue
    }
    if (pos[o + 1] < FLOOR) {
      pos[o + 1] = FLOOR
      prev[o + 1] = FLOOR
    }
    const [wx, wz] = windAt(pos[o], pos[o + 1], time, wind)
    const next = [0, 1, 2].map(
      (k) => pos[o + k] + (pos[o + k] - prev[o + k]) * DAMP + [wx, -GRAVITY, wz][k] * dt * dt,
    )
    if (next[1] < FLOOR) {
      next[1] = FLOOR
      next[0] = (next[0] + pos[o]) * 0.5
    }
    next[0] = Math.max(-aspect, Math.min(aspect, next[0]))
    prev.set(pos.subarray(o, o + 4), o)
    pos.set(next, o)
  }
}

/** one coloured phase: every edge of kind p >> 1 and colour p & 1 — `relax` in the shader */
export function relaxPhase(g: Grid, { pos, broken }: ClothState, p: number) {
  const counts = edgeCounts(g)
  const kind = p >> 1
  let start = 0
  for (let k = 0; k < kind; k++) start += counts[k]
  for (let e = 0; e < counts[kind]; e++) {
    const [a, b, colour] = edgeEnds(g, kind, e)
    if ((colour & 1) !== (p & 1)) continue
    relaxEdge(pos, broken, start + e, a, b, restOf(g, kind), stiffOf(kind))
  }
}

function relaxEdge(
  pos: Float32Array,
  broken: Uint32Array,
  id: number,
  a: number,
  b: number,
  rest: number,
  stiff: number,
) {
  if (broken[id]) return
  const A = a * 4
  const B = b * 4
  const d = [pos[B] - pos[A], pos[B + 1] - pos[A + 1], pos[B + 2] - pos[A + 2]]
  const len = Math.hypot(d[0], d[1], d[2])
  if (len > rest * TEAR) {
    broken[id] = 1
    return
  }
  const wa = pos[A + 3]
  const wb = pos[B + 3]
  if (wa + wb === 0 || len < 1e-6) return
  const k = ((len - rest) / (len * (wa + wb))) * stiff
  for (let j = 0; j < 3; j++) {
    pos[A + j] += d[j] * k * wa
    pos[B + j] -= d[j] * k * wb
  }
  /* the floor is a constraint like any other, kept inside the loop */
  pos[A + 1] = Math.max(pos[A + 1], FLOOR)
  pos[B + 1] = Math.max(pos[B + 1], FLOOR)
}

/** whether segment ab crosses segment cd — the cut, in 2D, as the shader asks it */
export function segmentsCross(
  a: readonly [number, number],
  b: readonly [number, number],
  c: readonly [number, number],
  d: readonly [number, number],
) {
  const side = (
    p: readonly [number, number],
    q: readonly [number, number],
    r: readonly [number, number],
  ) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0])
  const d1 = side(c, d, a)
  const d2 = side(c, d, b)
  const d3 = side(a, b, c)
  const d4 = side(a, b, d)
  return d1 * d2 < 0 && d3 * d4 < 0
}

/** a point on the canvas, in the cloth's world */
export function toWorld(px: number, py: number, w: number, h: number): [number, number] {
  const aspect = w / h
  return [(px / w) * 2 * aspect - aspect, 1 - (py / h) * 2]
}

export const FABRICS = {
  gingham: 'Gingham',
  silk: 'Silk',
  stripes: 'Stripes',
  denim: 'Denim',
} as const
export type Fabric = keyof typeof FABRICS
export const FABRIC_IDS = Object.keys(FABRICS) as Fabric[]

export type Finger = {
  at: readonly [number, number]
  /** where it was last frame — a cut is the stroke between the two */
  was: readonly [number, number]
  down: boolean
  /** went down this frame: the frame that grabs */
  pressed: boolean
}

export type ClothParams = {
  g: Grid
  fingers: readonly Finger[]
  phase: number
  tool: Tool
  time: number
  wind: number
  aspect: number
  fabric: Fabric
  step: number
  steps: number
}

export function packCloth(p: ClothParams, into = new ArrayBuffer(CLOTH.bytes)) {
  const f = new Float32Array(into)
  const u = new Uint32Array(into)
  f.fill(0)
  let down = 0
  let pressed = 0
  p.fingers.slice(0, FINGERS).forEach((fg, i) => {
    f.set([...fg.at, ...fg.was], i * 4)
    if (fg.down) down |= 1 << i
    if (fg.pressed) pressed |= 1 << i
  })
  u[CLOTH.cols / 4] = p.g.cols
  u[CLOTH.rows / 4] = p.g.rows
  u[CLOTH.phase / 4] = p.phase
  u[CLOTH.tool / 4] = p.tool === 'cut' ? 1 : 0
  f[CLOTH.spacing / 4] = p.g.spacing
  f[CLOTH.dt / 4] = STEP
  f[CLOTH.time / 4] = p.time
  f[CLOTH.wind / 4] = p.wind
  f[CLOTH.aspect / 4] = p.aspect
  u[CLOTH.down / 4] = down
  u[CLOTH.pressed / 4] = pressed
  u[CLOTH.fabric / 4] = FABRIC_IDS.indexOf(p.fabric)
  u[CLOTH.step / 4] = p.step
  u[CLOTH.steps / 4] = p.steps
  return into
}
