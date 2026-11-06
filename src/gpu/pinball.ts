/**
 * The arithmetic of the Lab's pinball workshop: build a table, then play it. The frame of the table
 * is fixed — its walls, the plunger lane on the right, the slopes down to two flippers and the drain
 * between them — and everything inside it is yours: walls you draw, bumpers that kick, targets that
 * light (light them all for a bonus). Then three balls, a plunger and the flippers.
 *
 * ⚠️ THE GPU DRAWS AND BAKES; THE GAME IS HERE. Whenever the table changes the GPU bakes its distance
 * field, which every frame's glow is read from (`bake` in pinball.wgsl, `distanceAt` here); the ball,
 * the flippers, the score and the rules are CPU and deterministic, and pinball.test.ts plays them.
 */

export type V2 = [number, number]
/** the table, in units, y up */
export const W = 10
export const H = 18
export const BALL_R = 0.24
export const G = 11
/** physics steps a second: small enough that the quickest thing, a flipper's tip, moves less than a
 *  ball's radius in one */
export const HZ = 960
/** no ball moves faster than this, so no step can carry it through a wall */
export const MAX_SPEED = 32
export const WALL_R = 0.1
export const BOUNCE = 0.55

/** the flippers: pivots, length, thickness, rest and raised angles, how fast they swing */
export const FLIP = {
  left: [2.55, 2.0] as V2,
  right: [6.65, 2.0] as V2,
  length: 1.75,
  r: 0.2,
  rest: -0.5,
  up: 0.5,
  /** radians a second, going up and coming down */
  swing: 28,
  fall: 18,
}

/** the plunger lane: the ball waits here, and a full pull sends it this fast */
export const LANE_X = 9.2
export const PLUNGE_AT: V2 = [9.6, 0.6]
export const PLUNGE_SPEED = 26

export const BUMPER_R = 0.55
export const BUMPER_KICK = 13
export const TARGET_R = 0.22
export const SCORE = { bumper: 100, target: 250, bonus: 2000, wall: 10 }
export const BALLS = 3

type Seg = [number, number, number, number]
/** the orbit at the top right: a quarter circle the plunger's ball follows round into the table */
const ORBIT: [number, number][] = Array.from({ length: 9 }, (_, k) => {
  const a = (k / 8) * (Math.PI / 2)
  return [+(7.4 + Math.cos(a) * 2.6).toFixed(3), +(14.4 + Math.sin(a) * 2.6).toFixed(3)]
})

/** the fixed frame: outer walls, the top and its orbit, the lane, the slopes to the flippers */
export const FRAME: Seg[] = [
  [0, 3.3, 0, 15],
  [0, 15, 1, 16.6],
  [1, 16.6, 3, 17.3],
  [3, 17.3, ORBIT[8][0], ORBIT[8][1]],
  ...ORBIT.slice(1).map((p, k): Seg => [ORBIT[k][0], ORBIT[k][1], p[0], p[1]]),
  [10, ORBIT[0][1], 10, 0],
  [LANE_X, 0, LANE_X, 14.4],
  [9.2, 0.3, 10, 0.3],
  [0, 3.3, 2.4, 2.1],
  [LANE_X, 3.3, 6.8, 2.1],
]

/** what you build: walls as strokes (polylines), bumpers and targets as points */
export type Table = {
  name: string
  walls: V2[][]
  bumpers: V2[]
  targets: V2[]
}

export const LIMITS = { strokes: 24, points: 24, segments: 160, bumpers: 12, targets: 16 }

/** where you may build: inside the frame, out of the lane and the orbit (or the plunger could never
 *  get a ball in), and clear of the flippers and the drain */
export function buildable([x, y]: V2) {
  const inOrbit = x > 7.4 && y > 14.4 && Math.hypot(x - 7.4, y - 14.4) > 1.5
  return x > 0.4 && x < LANE_X - 0.4 && y > 3.9 && y < 16.6 && !inOrbit
}

export const DEFAULT_TABLE: Table = {
  name: 'Workshop',
  walls: [
    [
      [1.0, 6.5],
      [1.0, 4.6],
      [2.2, 4.0],
    ],
    [
      [8.2, 6.5],
      [8.2, 4.6],
      [7.0, 4.0],
    ],
    [
      [3.2, 14.6],
      [4.6, 15.6],
      [6.0, 14.6],
    ],
  ],
  bumpers: [
    [3.2, 11.8],
    [6.0, 11.8],
    [4.6, 13.4],
  ],
  targets: [
    [2.2, 8.6],
    [3.4, 9.0],
    [5.8, 9.0],
    [7.0, 8.6],
  ],
}

const segCache = new WeakMap<Table, Seg[]>()
/** every segment of a table: the frame and its strokes (a table is never changed in place, only
 *  replaced, so its list is worked out once — `step` asks for it 960 times a second) */
export function segmentsOf(t: Table): Seg[] {
  const hit = segCache.get(t)
  if (hit) return hit
  const out: Seg[] = [...FRAME]
  for (const s of t.walls)
    for (let k = 1; k < s.length; k++) out.push([s[k - 1][0], s[k - 1][1], s[k][0], s[k][1]])
  segCache.set(t, out)
  return out
}

function nearest(s: Seg, x: number, y: number): V2 {
  const dx = s[2] - s[0]
  const dy = s[3] - s[1]
  const t = Math.max(0, Math.min(1, ((x - s[0]) * dx + (y - s[1]) * dy) / (dx * dx + dy * dy || 1)))
  return [s[0] + dx * t, s[1] + dy * t]
}

/** the distance from p to the nearest wall, bumper or target of a table: the field the GPU bakes */
export function distanceAt(t: Table, p: V2) {
  let d = Infinity
  for (const s of segmentsOf(t)) {
    const [nx, ny] = nearest(s, p[0], p[1])
    d = Math.min(d, Math.hypot(p[0] - nx, p[1] - ny) - WALL_R)
  }
  for (const b of t.bumpers) d = Math.min(d, Math.hypot(p[0] - b[0], p[1] - b[1]) - BUMPER_R)
  for (const b of t.targets) d = Math.min(d, Math.hypot(p[0] - b[0], p[1] - b[1]) - TARGET_R)
  return d
}

/* ---------------------------------------------------------------- the flippers ---------------- */

export type Flippers = { left: number; right: number; leftV: number; rightV: number }
export const restFlippers = (): Flippers => ({
  left: FLIP.rest,
  right: FLIP.rest,
  leftV: 0,
  rightV: 0,
})

/** the flippers after dt with the buttons as held: swinging up fast, falling back slower, stopping at
 *  their ends (an angle and its angular speed, so the ball can be struck by the moving surface) */
export function swing(f: Flippers, held: { left: boolean; right: boolean }, dt: number) {
  for (const side of ['left', 'right'] as const) {
    const up = held[side]
    const was = f[side]
    const to = up ? FLIP.up : FLIP.rest
    const rate = up ? FLIP.swing : FLIP.fall
    const next = was + Math.sign(to - was) * Math.min(Math.abs(to - was), rate * dt)
    f[side] = next
    f[side === 'left' ? 'leftV' : 'rightV'] = (next - was) / dt
  }
}

/** a flipper as a segment: its pivot, its tip, and how fast it is turning (counter-clockwise +) */
export function flipperSeg(f: Flippers, side: 'left' | 'right'): { a: V2; b: V2; omega: number } {
  const p = side === 'left' ? FLIP.left : FLIP.right
  // the left flipper points right from its pivot and turns up counter-clockwise; the right one is
  // its mirror image, pointing left and turning up clockwise
  const angle = side === 'left' ? f.left : Math.PI - f.right
  const omega = side === 'left' ? f.leftV : -f.rightV
  return {
    a: p,
    b: [p[0] + Math.cos(angle) * FLIP.length, p[1] + Math.sin(angle) * FLIP.length],
    omega,
  }
}

/* ---------------------------------------------------------------- the ball --------------------- */

export type Ball = { x: number; y: number; vx: number; vy: number }
export type Game = {
  ball: Ball
  /** waiting in the lane for the plunger */
  waiting: boolean
  balls: number
  score: number
  lit: boolean[]
  over: boolean
  /** what the last step hit, for sound and light: bumper k, target k, a flipper, or nothing */
  hits: { kind: 'bumper' | 'target' | 'bonus' | 'flipper' | 'drain'; k: number }[]
  /** how long each bumper has been lit after a hit, seconds left */
  flash: number[]
}

export const newGame = (t: Table): Game => ({
  ball: { x: PLUNGE_AT[0], y: PLUNGE_AT[1], vx: 0, vy: 0 },
  waiting: true,
  balls: BALLS,
  score: 0,
  lit: t.targets.map(() => false),
  over: false,
  hits: [],
  flash: t.bumpers.map(() => 0),
})

/** the plunger let go at `pull` (0..1) */
export function plunge(g: Game, pull: number) {
  if (!g.waiting || g.over) return
  g.waiting = false
  g.ball.vx = 0
  g.ball.vy = Math.max(0.35, Math.min(1, pull)) * PLUNGE_SPEED
}

function bounceOff(b: Ball, nx: number, ny: number, at: V2, lo: number, surface: V2, e: number) {
  b.x = at[0] + nx * lo
  b.y = at[1] + ny * lo
  const rvx = b.vx - surface[0]
  const rvy = b.vy - surface[1]
  const vn = rvx * nx + rvy * ny
  if (vn < 0) {
    b.vx -= (1 + e) * vn * nx
    b.vy -= (1 + e) * vn * ny
    return true
  }
  return false
}

/**
 * One step of the game: the flippers swing, the ball falls and rolls, strikes walls, flippers,
 * bumpers (which kick it away) and targets (which light, and all lit pay the bonus and go out), and
 * drains between the flippers — the next ball to the lane, or the game over.
 */
export function step(
  g: Game,
  t: Table,
  f: Flippers,
  held: { left: boolean; right: boolean },
  dt = 1 / HZ,
) {
  g.hits = []
  swing(f, held, dt)
  for (let k = 0; k < g.flash.length; k++) g.flash[k] = Math.max(0, g.flash[k] - dt)
  if (g.over || g.waiting) return
  const b = g.ball
  b.vy -= G * dt
  const sp = Math.hypot(b.vx, b.vy)
  if (sp > MAX_SPEED) {
    b.vx *= MAX_SPEED / sp
    b.vy *= MAX_SPEED / sp
  }
  b.x += b.vx * dt
  b.y += b.vy * dt
  for (const s of segmentsOf(t)) {
    const n = nearest(s, b.x, b.y)
    const dx = b.x - n[0]
    const dy = b.y - n[1]
    const d = Math.hypot(dx, dy)
    const lo = BALL_R + WALL_R
    if (d < lo && d > 1e-9) bounceOff(b, dx / d, dy / d, n, lo, [0, 0], BOUNCE)
  }
  for (const side of ['left', 'right'] as const) {
    const fs = flipperSeg(f, side)
    const n = nearest([fs.a[0], fs.a[1], fs.b[0], fs.b[1]], b.x, b.y)
    const dx = b.x - n[0]
    const dy = b.y - n[1]
    const d = Math.hypot(dx, dy)
    const lo = BALL_R + FLIP.r
    if (d < lo && d > 1e-9) {
      // the flipper's surface moves where the ball touches it: ω × r
      const rx = n[0] - fs.a[0]
      const ry = n[1] - fs.a[1]
      const surface: V2 = [-fs.omega * ry, fs.omega * rx]
      if (bounceOff(b, dx / d, dy / d, n, lo, surface, 0.3) && Math.abs(fs.omega) > 1)
        g.hits.push({ kind: 'flipper', k: side === 'left' ? 0 : 1 })
    }
  }
  t.bumpers.forEach((p, k) => {
    const dx = b.x - p[0]
    const dy = b.y - p[1]
    const d = Math.hypot(dx, dy)
    const lo = BALL_R + BUMPER_R
    if (d < lo && d > 1e-9) {
      const nx = dx / d
      const ny = dy / d
      b.x = p[0] + nx * lo
      b.y = p[1] + ny * lo
      // a bumper does not just bounce the ball: it kicks it away at a fixed speed
      const vn = b.vx * nx + b.vy * ny
      if (vn < BUMPER_KICK) {
        b.vx += (BUMPER_KICK - vn) * nx
        b.vy += (BUMPER_KICK - vn) * ny
      }
      g.score += SCORE.bumper
      g.flash[k] = 0.15
      g.hits.push({ kind: 'bumper', k })
    }
  })
  t.targets.forEach((p, k) => {
    const dx = b.x - p[0]
    const dy = b.y - p[1]
    const d = Math.hypot(dx, dy)
    const lo = BALL_R + TARGET_R
    if (d < lo && d > 1e-9) {
      bounceOff(b, dx / d, dy / d, p, lo, [0, 0], BOUNCE)
      if (!g.lit[k]) {
        g.lit[k] = true
        g.score += SCORE.target
        g.hits.push({ kind: 'target', k })
        if (g.lit.every(Boolean)) {
          g.score += SCORE.bonus
          g.lit = g.lit.map(() => false)
          g.hits.push({ kind: 'bonus', k })
        }
      }
    }
  })
  // a weak pull that falls back down the lane is caught by the plunger, ready to go again
  if (b.x > LANE_X && b.y < 1.0 && b.vy <= 0) {
    g.waiting = true
    Object.assign(b, { x: PLUNGE_AT[0], y: PLUNGE_AT[1], vx: 0, vy: 0 })
    return
  }
  // drained: below the flippers, or out of the table altogether (which no step should allow)
  if (b.y < -BALL_R * 2 || b.x < -1 || b.x > W + 1 || b.y > H + 1) {
    g.hits.push({ kind: 'drain', k: 0 })
    g.balls--
    if (g.balls <= 0) g.over = true
    else g.waiting = true
    Object.assign(b, { x: PLUNGE_AT[0], y: PLUNGE_AT[1], vx: 0, vy: 0 })
  }
}

/* ---------------------------------------------------------------- building --------------------- */

/** a stroke as drawn, thinned to a point every `gap` units and kept to what is buildable */
export function thin(points: readonly V2[], gap = 0.45): V2[] {
  const out: V2[] = []
  for (const p of points) {
    if (!buildable(p)) continue
    const last = out[out.length - 1]
    if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) >= gap) out.push([p[0], p[1]])
  }
  return out.slice(0, LIMITS.points)
}

const segCount = (t: Table) => t.walls.reduce((a, s) => a + Math.max(0, s.length - 1), 0)

/** a part added, or why not */
export function addPart(
  t: Table,
  kind: 'wall' | 'bumper' | 'target',
  at: V2 | V2[],
): { table: Table; why?: string } {
  if (kind === 'wall') {
    const s = thin(at as V2[])
    if (s.length < 2) return { table: t, why: 'Draw a wall inside the table, above the flippers.' }
    if (t.walls.length >= LIMITS.strokes || segCount(t) + s.length - 1 > LIMITS.segments)
      return { table: t, why: 'This table has as many walls as it can hold.' }
    return { table: { ...t, walls: [...t.walls, s] } }
  }
  const p = at as V2
  if (!buildable(p))
    return {
      table: t,
      why: 'Parts go inside the table — not in the lane, nor down by the flippers.',
    }
  const list = kind === 'bumper' ? t.bumpers : t.targets
  if (list.length >= (kind === 'bumper' ? LIMITS.bumpers : LIMITS.targets))
    return {
      table: t,
      why: `A table holds ${kind === 'bumper' ? LIMITS.bumpers : LIMITS.targets} ${kind}s at most.`,
    }
  const next: V2 = [+p[0].toFixed(2), +p[1].toFixed(2)]
  return {
    table:
      kind === 'bumper'
        ? { ...t, bumpers: [...t.bumpers, next] }
        : { ...t, targets: [...t.targets, next] },
  }
}

/** the part nearest p within `reach`, taken away */
export function erase(t: Table, p: V2, reach = 0.6): Table {
  const d = (q: V2) => Math.hypot(q[0] - p[0], q[1] - p[1])
  let best = { kind: '', k: -1, d: reach }
  t.bumpers.forEach((q, k) => d(q) < best.d && (best = { kind: 'bumper', k, d: d(q) }))
  t.targets.forEach((q, k) => d(q) < best.d && (best = { kind: 'target', k, d: d(q) }))
  t.walls.forEach((s, k) => {
    for (let i = 1; i < s.length; i++) {
      const n = nearest([s[i - 1][0], s[i - 1][1], s[i][0], s[i][1]], p[0], p[1])
      const e = Math.hypot(n[0] - p[0], n[1] - p[1])
      if (e < best.d) best = { kind: 'wall', k, d: e }
    }
  })
  if (best.kind === 'bumper') return { ...t, bumpers: t.bumpers.filter((_, k) => k !== best.k) }
  if (best.kind === 'target') return { ...t, targets: t.targets.filter((_, k) => k !== best.k) }
  if (best.kind === 'wall') return { ...t, walls: t.walls.filter((_, k) => k !== best.k) }
  return t
}

/* ---------------------------------------------------------------- a table as a file ----------- */

export const PINBALL_KEY = 'lab_pinball_v1'
export const FILE_LIMIT = 50_000

const point = (v: unknown): v is V2 =>
  Array.isArray(v) &&
  v.length === 2 &&
  v.every((n) => typeof n === 'number' && Number.isFinite(n)) &&
  buildable(v as V2)

/** a table from a file, or why not: data only, every part where a part may go, every count bounded */
export function readTable(text: unknown): Table | string {
  if (typeof text !== 'string' || text.length > FILE_LIMIT)
    return 'That file is too big to be a table.'
  let v: unknown
  try {
    v = JSON.parse(text)
  } catch {
    return 'That file is not a table (it is not JSON).'
  }
  if (!v || typeof v !== 'object') return 'That file is not a table.'
  const o = v as Record<string, unknown>
  if (typeof o.name !== 'string' || o.name.length > 40)
    return 'A table needs a name of up to 40 letters.'
  if (
    !Array.isArray(o.walls) ||
    o.walls.length > LIMITS.strokes ||
    !o.walls.every(
      (s) => Array.isArray(s) && s.length >= 2 && s.length <= LIMITS.points && s.every(point),
    )
  )
    return 'That table’s walls are off the table, or too many.'
  if (!Array.isArray(o.bumpers) || o.bumpers.length > LIMITS.bumpers || !o.bumpers.every(point))
    return `A table holds up to ${LIMITS.bumpers} bumpers, all on the table.`
  if (!Array.isArray(o.targets) || o.targets.length > LIMITS.targets || !o.targets.every(point))
    return `A table holds up to ${LIMITS.targets} targets, all on the table.`
  const t: Table = {
    name: o.name,
    walls: (o.walls as V2[][]).map((s) => s.map((p) => [p[0], p[1]] as V2)),
    bumpers: (o.bumpers as V2[]).map((p) => [p[0], p[1]] as V2),
    targets: (o.targets as V2[]).map((p) => [p[0], p[1]] as V2),
  }
  if (segCount(t) > LIMITS.segments) return 'That table has more wall than this toy can hold.'
  return t
}

/* ---------------------------------------------------------------- for the GPU ---------------- */

/** the baked field: 16 texels a unit */
export const FIELD: V2 = [W * 16, H * 16]
export const MAX_SEGS = FRAME.length + LIMITS.segments
export const MAX_ITEMS = LIMITS.bumpers + LIMITS.targets
export const TRAIL = 32

/** Hand-packed to match `struct Table` — pinball.test.ts lays the struct out from the shader. */
export const PIN = {
  size: 0,
  field: 8,
  ball: 16,
  pull: 24,
  flipL: 32,
  flipR: 48,
  segs: 64,
  items: 68,
  time: 72,
  building: 76,
  bytes: 80,
} as const

export function packPin(
  p: {
    w: number
    h: number
    ball: V2
    pull: number
    flippers: Flippers
    segs: number
    items: number
    time: number
    building: boolean
  },
  into = new ArrayBuffer(PIN.bytes),
) {
  const u = new Uint32Array(into)
  const f = new Float32Array(into)
  u.set([p.w, p.h, FIELD[0], FIELD[1]], 0)
  f.set([...p.ball, p.pull, 0], PIN.ball / 4)
  const l = flipperSeg(p.flippers, 'left')
  const r = flipperSeg(p.flippers, 'right')
  f.set([...l.a, ...l.b, ...r.a, ...r.b], PIN.flipL / 4)
  u[PIN.segs / 4] = Math.min(p.segs, MAX_SEGS)
  u[PIN.items / 4] = Math.min(p.items, MAX_ITEMS)
  f[PIN.time / 4] = p.time
  u[PIN.building / 4] = p.building ? 1 : 0
  return into
}

/** bumpers then targets as (x, y, kind, glow): a bumper glows while it flashes, a target while lit */
export function itemsOf(t: Table, g: Pick<Game, 'flash' | 'lit'> | null) {
  return [
    ...t.bumpers.map((b, k) => [b[0], b[1], 0, g ? Math.min(1, (g.flash[k] ?? 0) / 0.15) : 0]),
    ...t.targets.map((b, k) => [b[0], b[1], 1, g?.lit[k] ? 1 : 0]),
  ].flat()
}

/**
 * Where a point of a stage `size` big is on the table: the table upright, as big as fits with half a
 * unit round it, y up. The shader's `to_table`, line for line.
 */
export function tableFit(size: V2, p: V2): V2 {
  const s = Math.min(size[0] / (W + 1), size[1] / (H + 1))
  const o: V2 = [(size[0] - W * s) / 2, (size[1] - H * s) / 2]
  return [(p[0] - o[0]) / s, H - (p[1] - o[1]) / s]
}
