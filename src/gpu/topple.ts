/**
 * The arithmetic of the Lab's topple: dominoes. Draw a line and dominoes stand along it; paint their
 * faces; push one, and the run goes. A domino's face only shows once it is down, so a field of plain
 * standing tiles becomes a picture as it falls. The puzzles ask one push to ring bells — all of them,
 * two at the same moment, or in order.
 *
 * ⚠️ THE GPU DRAWS THE FALL; THE CASCADE IS HERE. Each domino falls about its base edge, forward along
 * its own axis. `cascade` works out, from one push, when each domino starts to fall, which way, and
 * how far over it ends up — event by event, so it is exact and the same every time — and the shader
 * only turns each domino by the angle its own start time says it has reached. topple.test.ts plays
 * the rules: a run carries, a gap too wide stops it, a domino turned side-on stops it, two in front
 * make a fork, and the bells.
 */

export type V2 = [number, number]
/** the table, in domino heights: x across, z away from you */
export const W = 24
export const D = 15
/** a domino: its height (it falls this far), its width across, its thickness */
export const TALL = 1
export const WIDE = 0.5
export const THICK = 0.16
/** how far apart dominoes stand along a drawn line */
export const SPACING = 0.6
/** the closest two dominoes may stand, centre to centre */
export const NEAREST = 0.32
/** a domino takes this long to fall flat when nothing is in the way */
export const FALL = 0.22
/** a domino hit nearly side-on does not fall: the push must be this square to its axis */
export const SQUARE = 0.45
export const MAX_DOMINOES = 600

export type Domino = {
  x: number
  z: number
  /** which way its axis points (radians, 0 along +x): it falls along this axis, either way */
  a: number
  /** the colour of its face, 0..COLOURS-1 */
  c: number
}
export type Bell = { x: number; z: number }
export type Wall = [number, number, number, number]

export type Layout = { dominoes: Domino[]; bells: Bell[]; walls: Wall[] }

export const COLOURS = 8

const axisOf = (d: Domino): V2 => [Math.cos(d.a), Math.sin(d.a)]

/** whether a point is inside a wall or off the table */
export function blocked(l: Pick<Layout, 'walls'>, x: number, z: number) {
  if (x < 0.3 || z < 0.3 || x > W - 0.3 || z > D - 0.3) return true
  return l.walls.some(
    ([x0, z0, x1, z1]) => x > x0 - 0.2 && x < x1 + 0.2 && z > z0 - 0.2 && z < z1 + 0.2,
  )
}

/** a drawn line rounded off: corner cutting, twice, so a hand-drawn corner becomes a bend */
export function smooth(line: readonly V2[], rounds = 2): V2[] {
  let pts = line.map((p) => [p[0], p[1]] as V2)
  for (let r = 0; r < rounds && pts.length > 2; r++) {
    const out: V2[] = [pts[0]]
    for (let i = 0; i < pts.length - 1; i++) {
      const [ax, az] = pts[i]
      const [bx, bz] = pts[i + 1]
      out.push(
        [ax * 0.75 + bx * 0.25, az * 0.75 + bz * 0.25],
        [ax * 0.25 + bx * 0.75, az * 0.25 + bz * 0.75],
      )
    }
    out.push(pts[pts.length - 1])
    pts = out
  }
  return pts
}

/** points every `spacing` along a line, by distance along it */
export function resample(line: readonly V2[], spacing: number): V2[] {
  const out: V2[] = []
  if (!line.length) return out
  out.push([line[0][0], line[0][1]])
  let need = spacing
  for (let i = 1; i < line.length; i++) {
    let [ax, az] = line[i - 1]
    const [bx, bz] = line[i]
    let len = Math.hypot(bx - ax, bz - az)
    while (len >= need) {
      const t = need / len
      ax += (bx - ax) * t
      az += (bz - az) * t
      out.push([ax, az])
      len -= need
      need = spacing
    }
    need -= len
  }
  // the line's own end, unless a point already sits nearly on it: a line drawn to a bell should end
  // at the bell, not up to a spacing short of it because the length did not divide evenly
  const end = line[line.length - 1]
  const last = out[out.length - 1]
  if (Math.hypot(end[0] - last[0], end[1] - last[1]) >= spacing * 0.5) out.push([end[0], end[1]])
  return out
}

/**
 * Dominoes stood along a drawn line: the line rounded off, a domino every SPACING along it, each
 * facing along the line where it stands (the way from the point before to the point after, so a curve
 * turns a little at every domino rather than all at once at a corner), none where one already stands
 * (closer than NEAREST), in a wall or off the table, and no more than the table holds. Returns the new
 * dominoes only.
 */
export function standAlong(
  l: Layout,
  line: readonly V2[],
  colour: number,
  spacing = SPACING,
): Domino[] {
  const out: Domino[] = []
  const pts = resample(smooth(line), spacing)
  if (pts.length < 2) return out
  const room = MAX_DOMINOES - l.dominoes.length
  for (let i = 0; i < pts.length && out.length < room; i++) {
    const [x, z] = pts[i]
    const prev = pts[Math.max(0, i - 1)]
    const next = pts[Math.min(pts.length - 1, i + 1)]
    const a = Math.atan2(next[1] - prev[1], next[0] - prev[0])
    const near = (d: Domino) => Math.hypot(d.x - x, d.z - z) < NEAREST
    if (!blocked(l, x, z) && !l.dominoes.some(near) && !out.some(near))
      out.push({ x: +x.toFixed(3), z: +z.toFixed(3), a: +a.toFixed(4), c: colour })
  }
  return out
}

export type Fall = {
  /** when it starts to fall, seconds after the push; −1 if it never does */
  t: number
  /** +1 forward along its axis, −1 backward */
  dir: number
  /** how far over it ends: π/2 is flat; less if it ends leaning on a domino that stood */
  rest: number
}
export type Cascade = { falls: Fall[]; bells: number[]; end: number }

/** how long a domino takes to tip far enough to touch something `ahead` in front of it */
export function tipTime(ahead: number) {
  const angle = Math.asin(Math.min(1, Math.max(0, ahead / TALL)))
  // a falling domino speeds up: most of its time goes in the first few degrees
  return FALL * Math.sqrt(angle / (Math.PI / 2))
}

/**
 * The whole run from one push: domino `first` pushed so that it falls `dir` along its axis. Each
 * falling domino strikes every standing domino in the strip it sweeps — ahead of it by less than its
 * own height, and overlapping it across — at the time it has tipped far enough to reach it. One hit
 * square enough to the struck domino's axis knocks it over, away from the striker; one nearly
 * side-on does not. Bells ring when the top of a falling domino sweeps over them. Events are taken
 * in time order, so a domino struck twice falls at the first.
 */
export function cascade(l: Layout, first: number, dir = 1): Cascade {
  const n = l.dominoes.length
  const falls: Fall[] = l.dominoes.map(() => ({ t: -1, dir: 0, rest: Math.PI / 2 }))
  const bells = l.bells.map(() => -1)
  if (first < 0 || first >= n) return { falls, bells, end: 0 }
  // a small priority queue of pending knocks: [time, domino, dir]
  const queue: [number, number, number][] = [[0, first, dir]]
  let end = 0
  while (queue.length) {
    queue.sort((p, q) => p[0] - q[0])
    const [t, i, s] = queue.shift()!
    if (falls[i].t >= 0) continue
    falls[i] = { t, dir: s, rest: Math.PI / 2 }
    const d = l.dominoes[i]
    const [ux, uz] = axisOf(d)
    const fx = ux * s
    const fz = uz * s
    let leanOn = Infinity
    for (let j = 0; j < n; j++) {
      if (j === i || falls[j].t >= 0) continue
      const e = l.dominoes[j]
      const ahead = (e.x - d.x) * fx + (e.z - d.z) * fz
      const across = Math.abs(-(e.x - d.x) * fz + (e.z - d.z) * fx)
      if (ahead <= THICK * 0.5 || ahead >= TALL - THICK * 0.5) continue
      if (across >= WIDE * 0.9) continue
      const [vx, vz] = axisOf(e)
      const square = vx * fx + vz * fz
      const when = t + tipTime(ahead)
      if (Math.abs(square) < SQUARE) {
        // struck side-on: it stands, and the striker ends leaning on it
        leanOn = Math.min(leanOn, ahead)
        continue
      }
      queue.push([when, j, square > 0 ? 1 : -1])
    }
    if (leanOn < Infinity) falls[i].rest = Math.asin(Math.min(1, leanOn / TALL))
    // the bells its top sweeps over: in front of it, within its reach and its width
    l.bells.forEach((b, k) => {
      if (bells[k] >= 0) return
      const ahead = (b.x - d.x) * fx + (b.z - d.z) * fz
      const across = Math.abs(-(b.x - d.x) * fz + (b.z - d.z) * fx)
      const reach = TALL * Math.sin(falls[i].rest)
      if (ahead > 0 && ahead <= reach + 0.15 && across < WIDE * 0.8)
        bells[k] = t + tipTime(Math.min(ahead, TALL))
    })
    end = Math.max(end, t + FALL)
  }
  return { falls, bells, end }
}

/** the domino nearest p, within `reach`, or −1 */
export function dominoAt(l: Layout, p: V2, reach = 0.4) {
  let best = -1
  let d = reach
  l.dominoes.forEach((e, k) => {
    const q = Math.hypot(e.x - p[0], e.z - p[1])
    if (q < d) {
      d = q
      best = k
    }
  })
  return best
}

/* ---------------------------------------------------------------- the puzzles ----------------- */

export type Goal = 'all' | 'together' | 'order'
export type Puzzle = {
  name: string
  hint: string
  goal: Goal
  /** dominoes allowed */
  budget: number
  bells: Bell[]
  walls: Wall[]
  /** where the push is: the first domino must stand in this disc, and is pushed toward `toward` */
  start: { x: number; z: number; toward: number }
  /** a solution, as lines drawn from the start: the tests stand dominoes along them and push */
  solution: V2[][]
}

/** whether a cascade solves a puzzle */
export function solved(p: Puzzle, c: Cascade) {
  if (c.bells.some((t) => t < 0)) return false
  if (p.goal === 'together') return Math.max(...c.bells) - Math.min(...c.bells) <= 0.125
  if (p.goal === 'order') return c.bells.every((t, k) => k === 0 || t > c.bells[k - 1])
  return true
}

/** the domino a puzzle's push knocks: the nearest to the start, and which way it is pushed */
export function pushOf(p: Puzzle, l: Layout): { first: number; dir: number } | null {
  const k = dominoAt(l, [p.start.x, p.start.z], 0.6)
  if (k < 0) return null
  const d = l.dominoes[k]
  const want = p.start.toward
  return { first: k, dir: Math.cos(d.a - want) >= 0 ? 1 : -1 }
}

export const PUZZLES: Puzzle[] = [
  {
    name: 'First run',
    hint: 'Draw a line of dominoes from the arrow to the bell. Then push.',
    goal: 'all',
    budget: 30,
    bells: [{ x: 18, z: 7.5 }],
    walls: [],
    start: { x: 4, z: 7.5, toward: 0 },
    solution: [
      [
        [4, 7.5],
        [17.6, 7.5],
      ],
    ],
  },
  {
    name: 'Round the wall',
    hint: 'A line can bend. A domino hit side-on will not fall, so bend gently.',
    goal: 'all',
    budget: 40,
    bells: [{ x: 19, z: 11 }],
    walls: [[10, 3, 11, 13]],
    start: { x: 4, z: 7.5, toward: 0 },
    solution: [
      [
        [4, 7.5],
        [7, 7.5],
        [8.5, 13.6],
        [12.5, 14],
        [16, 12],
        [18.6, 11],
      ],
    ],
  },
  {
    name: 'Fork',
    hint: 'Two bells, one push. Two dominoes side by side in front of one are both knocked down.',
    goal: 'all',
    budget: 50,
    bells: [
      { x: 19, z: 3 },
      { x: 19, z: 12 },
    ],
    walls: [],
    start: { x: 4, z: 7.5, toward: 0 },
    solution: [
      [
        [4, 7.5],
        [9, 7.5],
      ],
      [
        [9.6, 7.3],
        [13, 4],
        [18.6, 3],
      ],
      [
        [9.6, 7.7],
        [13, 11],
        [18.6, 12],
      ],
    ],
  },
  {
    name: 'Duet',
    hint: 'Two bells that must ring together, within an eighth of a second: the two runs have to take the same time, so the short one has to wander.',
    goal: 'together',
    budget: 70,
    bells: [
      { x: 19, z: 3 },
      { x: 11.96, z: 12.75 },
    ],
    walls: [],
    start: { x: 4, z: 7.5, toward: 0 },
    // the second branch meanders: a straight one would ring its bell 0.38 s early
    solution: [
      [
        [4, 7.5],
        [7, 7.5],
      ],
      [
        [7.6, 7.3],
        [11, 4.2],
        [18.6, 3.1],
      ],
      [
        [7.6, 7.7],
        [8.02, 8.12],
        [8.4, 8.33],
        [8.83, 8.37],
        [9.36, 8.37],
        [9.78, 8.49],
        [10.11, 8.77],
        [10.31, 9.15],
        [10.35, 9.57],
        [10.23, 9.98],
        [9.96, 10.32],
        [9.58, 10.52],
        [9.15, 10.56],
        [8.62, 10.56],
        [8.2, 10.69],
        [7.87, 10.96],
        [7.67, 11.34],
        [7.63, 11.77],
        [7.75, 12.18],
        [8.02, 12.51],
        [8.4, 12.71],
        [8.83, 12.75],
        [11.56, 12.75],
      ],
    ],
  },
  {
    name: 'Chimes',
    hint: 'Ring them left, middle, right — and the push goes the wrong way.',
    goal: 'order',
    budget: 60,
    bells: [
      { x: 3.6, z: 7.5 },
      { x: 12, z: 13 },
      { x: 20, z: 13 },
    ],
    walls: [],
    start: { x: 12, z: 7.5, toward: Math.PI },
    solution: [
      [
        [12, 7.5],
        [5, 7.5],
        [4.39, 7.57],
        [3.81, 7.77],
        [3.29, 8.1],
        [2.85, 8.54],
        [2.52, 9.06],
        [2.32, 9.64],
        [2.25, 10.25],
        [2.32, 10.86],
        [2.52, 11.44],
        [2.85, 11.96],
        [3.29, 12.4],
        [3.81, 12.73],
        [4.39, 12.93],
        [5, 13],
        [20.4, 13],
      ],
    ],
  },
]

/** a puzzle's table, with a solution's lines stood along it (for the tests and 💡) */
export function solve(p: Puzzle): Layout {
  const l: Layout = { dominoes: [], bells: p.bells, walls: p.walls }
  for (const line of p.solution) l.dominoes.push(...standAlong(l, line, 0))
  return l
}

/**
 * A picture to knock down: a spiral of dominoes from the middle of the table outward, turns 0.75
 * apart (wider than a domino's reach across, so a turn never knocks the next one), their faces
 * painted with a heart on white. Pushing the first, in the middle, brings down the lot.
 */
export function spiral(): Domino[] {
  const cx = W / 2
  const cz = D / 2
  const line: V2[] = []
  for (let a = 0; a < Math.PI * 2 * 9; a += 0.05) {
    const r = 1.1 + (0.75 * a) / (Math.PI * 2)
    if (r > D / 2 - 0.6) break
    line.push([cx + r * Math.cos(a), cz + r * Math.sin(a)])
  }
  const l: Layout = { dominoes: [], bells: [], walls: [] }
  const out = standAlong(l, line, 7)
  // the heart: (x² + y² − 1)³ − x²·y³ ≤ 0, in a frame the size of the spiral, point down
  for (const d of out) {
    const x = (d.x - cx) / 3.6
    const y = (d.z - cz + 0.4) / 3.6
    const q = x * x + y * y - 1
    if (q * q * q - x * x * y * y * y <= 0) d.c = 0
  }
  return out
}

/* ---------------------------------------------------------------- a layout as a file ---------- */

export const TOPPLE_KEY = 'lab_topple_v1'
export const FILE_LIMIT = 60_000

/** a layout from a file, or why not: numbers only, on the table, out of the walls, bounded */
export function readLayout(text: unknown): Layout | string {
  if (typeof text !== 'string' || text.length > FILE_LIMIT)
    return 'That file is too big to be a table of dominoes.'
  let v: unknown
  try {
    v = JSON.parse(text)
  } catch {
    return 'That file is not dominoes (it is not JSON).'
  }
  const o = (v ?? {}) as Record<string, unknown>
  const fin = (n: unknown) => typeof n === 'number' && Number.isFinite(n)
  const dominoes = o.dominoes
  if (
    !Array.isArray(dominoes) ||
    dominoes.length > MAX_DOMINOES ||
    !dominoes.every((d) => {
      const e = d as Record<string, unknown>
      return (
        d &&
        typeof d === 'object' &&
        fin(e.x) &&
        fin(e.z) &&
        fin(e.a) &&
        Number.isInteger(e.c) &&
        (e.c as number) >= 0 &&
        (e.c as number) < COLOURS &&
        (e.x as number) >= 0 &&
        (e.x as number) <= W &&
        (e.z as number) >= 0 &&
        (e.z as number) <= D
      )
    })
  )
    return `A table holds up to ${MAX_DOMINOES} dominoes, each on the table with a colour.`
  const bells = Array.isArray(o.bells) ? o.bells : []
  if (
    bells.length > 12 ||
    !bells.every((b) => {
      const e = b as Record<string, unknown>
      return (
        b &&
        fin(e.x) &&
        fin(e.z) &&
        (e.x as number) >= 0 &&
        (e.x as number) <= W &&
        (e.z as number) >= 0 &&
        (e.z as number) <= D
      )
    })
  )
    return 'That file’s bells are off the table, or too many.'
  return {
    dominoes: (dominoes as Domino[]).map((d) => ({ x: d.x, z: d.z, a: d.a, c: d.c })),
    bells: (bells as Bell[]).map((b) => ({ x: b.x, z: b.z })),
    walls: [],
  }
}

/* ---------------------------------------------------------------- for the GPU ---------------- */

/** each domino as two vec4: (x, z, axis angle, colour) and (start time, direction, rest angle, 0) */
export function packDominoes(
  l: Layout,
  c: Cascade | null,
  into = new Float32Array(MAX_DOMINOES * 8),
) {
  into.fill(0)
  l.dominoes.slice(0, MAX_DOMINOES).forEach((d, k) => {
    const f = c?.falls[k]
    into.set(
      [d.x, d.z, d.a, d.c, f && f.t >= 0 ? f.t : -1, f?.dir ?? 1, f?.rest ?? Math.PI / 2, 0],
      k * 8,
    )
  })
  return into
}

/** Hand-packed to match `struct Table` — topple.test.ts lays the struct out from the shader. */
export const TABLE = {
  size: 0,
  count: 8,
  bells: 12,
  time: 16,
  walls: 20,
  rung: 24,
  preview: 28,
  bytes: 32,
} as const

/**
 * Where a point of the stage is on the table: the table seen from above and in front, tilted by
 * PITCH, as big as fits. The shader's `camera`, line for line, run backwards onto the floor.
 */
export const PITCH = 0.95
export function floorAt(size: [number, number], p: V2): V2 {
  const s = viewScale(size)
  const ux = (p[0] - size[0] / 2) / s
  const uy = (size[1] / 2 - p[1]) / s
  // the screen's up is the table's away, foreshortened by the tilt
  return [W / 2 + ux, D / 2 + uy / Math.sin(PITCH)]
}
/** pixels per table unit: the table and a margin, as big as fits the stage */
export function viewScale(size: [number, number]) {
  return Math.min(size[0] / (W + 1), size[1] / ((D + 1) * Math.sin(PITCH) + TALL * Math.cos(PITCH)))
}

/** the marks on the floor: [0] the push (x, z, toward, shown), then up to 12 bells, then up to 8 walls */
export const MARKS = 1 + 12 + 8
export const MAX_PREVIEW = 256
export function packMarks(
  start: { x: number; z: number; toward: number } | null,
  bells: readonly Bell[],
  walls: readonly Wall[],
  into = new Float32Array(MARKS * 4),
) {
  into.fill(0)
  if (start) into.set([start.x, start.z, start.toward, 1], 0)
  bells.slice(0, 12).forEach((b, k) => into.set([b.x, b.z, 0, 0], (1 + k) * 4))
  walls.slice(0, 8).forEach((w, k) => into.set(w, (13 + k) * 4))
  return into
}

export function packTable(
  p: {
    w: number
    h: number
    count: number
    bells: number
    time: number
    walls: number
    rung: number
    preview: number
  },
  into = new ArrayBuffer(TABLE.bytes),
) {
  const u = new Uint32Array(into)
  const f = new Float32Array(into)
  u.set([p.w, p.h, p.count, p.bells], 0)
  f[TABLE.time / 4] = p.time
  u.set([p.walls, p.rung, p.preview], TABLE.walls / 4)
  return into
}

/** fewest dominoes kept per puzzle, by name */
export type Best = Record<string, number>
/**
 * What Topple keeps: the puzzle it was on, the fewest dominoes per puzzle, and the free layout.
 * Moved here unchanged from ToppleDemo so the Lab's share card reads it the toy's own way.
 */
export function readSaved(text: string | null): { puzzle: number; best: Best; free: Layout } {
  const empty: Layout = { dominoes: [], bells: [], walls: [] }
  try {
    const v = JSON.parse(text ?? 'null') as {
      puzzle?: unknown
      best?: Record<string, unknown>
      free?: unknown
    } | null
    const puzzle =
      typeof v?.puzzle === 'number' &&
      Number.isInteger(v.puzzle) &&
      v.puzzle >= 0 &&
      v.puzzle < PUZZLES.length
        ? v.puzzle
        : 0
    const best: Best = {}
    for (const p of PUZZLES) {
      const n = v?.best?.[p.name]
      if (typeof n === 'number' && Number.isInteger(n) && n > 0) best[p.name] = n
    }
    const free = readLayout(JSON.stringify(v?.free ?? empty))
    return { puzzle, best, free: typeof free === 'string' ? empty : free }
  } catch {
    return { puzzle: 0, best: {}, free: empty }
  }
}
