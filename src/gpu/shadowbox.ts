/**
 * The arithmetic of the Lab's shadow box: blocks stacked in a small box, seen by the shadows they
 * throw. A lamp in front throws their outline onto the back wall, a lamp on the right throws it onto
 * the left wall, and a lamp overhead marks the floor they stand on. One player builds and hides it;
 * the other sees only the shadows and has to build something that throws the same ones — not
 * necessarily the same blocks, since many stacks throw one set of shadows. Or play the puzzles,
 * which ask for it in as few blocks as possible.
 *
 * ⚠️ THE GPU CASTS AND DRAWS; THE JUDGE IS HERE. A build is a height for each of the 5 × 5 floor
 * cells. With the lamps square to the walls, a wall's shadow is a profile: the tallest stack in each
 * column (the back wall), in each row (the left wall), and which cells are built on at all (the
 * floor). `shadowsOf` computes them; the shader casts them by tracing light through the blocks, and
 * shadowbox.test.ts holds the two to each other.
 */

export const N = 5
export const TALL = 4
export const CELLS = N * N

/** heights, row by row: cell (x, z) is at z * N + x; x runs left to right, z from front to back */
export type Build = number[]
export const at = (x: number, z: number) => z * N + x
export const emptyBuild = (): Build => new Array<number>(CELLS).fill(0)

/** which shadows a clue shows */
export type Show = { front: boolean; side: boolean; top: boolean }
export const ALL: Show = { front: true, side: true, top: true }

export type Shadows = {
  /** the back wall: for each column x, the tallest stack in it */
  front: number[]
  /** the left wall: for each row z, the tallest stack in it */
  side: number[]
  /** the floor: whether anything stands on each cell */
  top: boolean[]
}

export function shadowsOf(b: Build): Shadows {
  const front = new Array<number>(N).fill(0)
  const side = new Array<number>(N).fill(0)
  for (let z = 0; z < N; z++)
    for (let x = 0; x < N; x++) {
      const h = b[at(x, z)]
      front[x] = Math.max(front[x], h)
      side[z] = Math.max(side[z], h)
    }
  return { front, side, top: b.map((h) => h > 0) }
}

/** whether a build throws the shadows a clue shows */
export function matches(b: Build, clue: Shadows, show: Show) {
  const s = shadowsOf(b)
  const same = (a: readonly unknown[], c: readonly unknown[]) => a.every((v, i) => v === c[i])
  return (
    (!show.front || same(s.front, clue.front)) &&
    (!show.side || same(s.side, clue.side)) &&
    (!show.top || same(s.top, clue.top))
  )
}

export const blocks = (b: Build) => b.reduce((a, h) => a + h, 0)

/** a stack raised or lowered by one, kept between 0 and TALL */
export function nudge(b: Build, i: number, by: number): Build {
  const out = b.slice()
  out[i] = Math.max(0, Math.min(TALL, out[i] + by))
  return out
}

/**
 * Few blocks that throw a clue's shadows: what the puzzles call par. Without the floor's shadow it is
 * exactly the fewest — for each height, one stack does for a column and a row that both need it, so
 * a height needs as many stacks as the larger of its columns and its rows. With the floor's, every
 * marked cell needs a block and a stack can only stand where the floor says; it is found greedily the
 * same way, and the tests check it against a full search on small cases.
 */
export function fewest(clue: Shadows, show: Show): Build {
  const b = emptyBuild()
  const can = (x: number, z: number) => !show.top || clue.top[at(x, z)]
  const cap = (x: number, z: number) =>
    Math.min(show.front ? clue.front[x] : TALL, show.side ? clue.side[z] : TALL)
  if (show.top) for (let i = 0; i < CELLS; i++) if (clue.top[i]) b[i] = 1
  for (let v = TALL; v >= 1; v--) {
    const cols = show.front ? [...Array(N).keys()].filter((x) => clue.front[x] === v) : []
    const rows = show.side ? [...Array(N).keys()].filter((z) => clue.side[z] === v) : []
    const colDone = (x: number) => [...Array(N).keys()].some((z) => b[at(x, z)] >= v)
    const rowDone = (z: number) => [...Array(N).keys()].some((x) => b[at(x, z)] >= v)
    // first a stack wherever one column and one row both need this height (a greedy matching)
    for (const x of cols)
      for (const z of rows)
        if (!colDone(x) && !rowDone(z) && can(x, z) && cap(x, z) >= v) b[at(x, z)] = v
    // then each column or row still short, at any cell that may stand that tall
    for (const x of cols)
      if (!colDone(x)) {
        const z = [...Array(N).keys()].find((zz) => can(x, zz) && cap(x, zz) >= v)
        if (z !== undefined) b[at(x, z)] = v
      }
    for (const z of rows)
      if (!rowDone(z)) {
        const x = [...Array(N).keys()].find((xx) => can(xx, z) && cap(xx, z) >= v)
        if (x !== undefined) b[at(x, z)] = v
      }
  }
  return b
}

/** the puzzles: hidden builds and which of their shadows are shown; par is `fewest` of them */
export const PUZZLES: { name: string; hint: string; hidden: Build; show: Show }[] = [
  {
    name: 'A step',
    hint: 'Two shadows and the floor. Every lit cell of the floor needs at least one block.',
    hidden: [0, 0, 0, 0, 0, 0, 1, 2, 3, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    show: ALL,
  },
  {
    name: 'Corner',
    hint: 'The back wall says how tall each column is somewhere; the left wall, each row.',
    hidden: [2, 0, 0, 0, 0, 2, 0, 0, 0, 0, 3, 2, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
    show: ALL,
  },
  {
    name: 'Two towers',
    hint: 'No floor this time: only the walls. Can one stack do for a column and a row at once?',
    hidden: [0, 0, 0, 0, 0, 0, 4, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0, 0, 0, 0],
    show: { front: true, side: true, top: false },
  },
  {
    name: 'Stairs',
    hint: 'Walls only. Find the fewest blocks: par is the least it can be done in.',
    hidden: [1, 0, 0, 0, 0, 1, 2, 0, 0, 0, 1, 2, 3, 0, 0, 1, 2, 3, 4, 0, 0, 0, 0, 0, 0],
    show: { front: true, side: true, top: false },
  },
  {
    name: 'The ring',
    hint: 'All three shadows, and the floor is a ring. Tall where it must be, low everywhere else.',
    hidden: [0, 0, 0, 0, 0, 0, 1, 3, 1, 0, 0, 2, 0, 1, 0, 0, 1, 1, 4, 0, 0, 0, 0, 0, 0],
    show: ALL,
  },
  {
    name: 'Skyline',
    hint: 'Walls only, every column and row different. Par is tight.',
    hidden: [1, 0, 0, 2, 0, 0, 0, 3, 0, 0, 4, 0, 0, 0, 1, 0, 2, 0, 0, 0, 0, 0, 0, 0, 3],
    show: { front: true, side: true, top: false },
  },
]

/* ---------------------------------------------------------------- a build as a file ----------- */

export const SHADOWBOX_KEY = 'lab_shadowbox_v1'
export const FILE_LIMIT = 4_000

/** a build from a file, or why not: 25 whole numbers from 0 to TALL, nothing else read */
export function readBuild(text: unknown): { build: Build; show: Show } | string {
  if (typeof text !== 'string' || text.length > FILE_LIMIT)
    return 'That file is too big to be a box.'
  let v: unknown
  try {
    v = JSON.parse(text)
  } catch {
    return 'That file is not a box (it is not JSON).'
  }
  const o = (v ?? {}) as Record<string, unknown>
  const b = o.build
  if (
    !Array.isArray(b) ||
    b.length !== CELLS ||
    !b.every((h) => typeof h === 'number' && Number.isInteger(h) && h >= 0 && h <= TALL)
  )
    return `A box is ${CELLS} stacks of 0 to ${TALL} blocks.`
  if (blocks(b as Build) === 0) return 'That box is empty.'
  const s = (o.show ?? {}) as Record<string, unknown>
  const flag = (k: string) => (typeof s[k] === 'boolean' ? (s[k] as boolean) : true)
  const show = { front: flag('front'), side: flag('side'), top: flag('top') }
  if (!show.front && !show.side && !show.top) return 'A box has to show at least one shadow.'
  return { build: [...(b as Build)], show }
}

/* ---------------------------------------------------------------- for the GPU ---------------- */

/** Hand-packed to match `struct Box` — shadowbox.test.ts lays the struct out from the shader. */
export const BOX = {
  size: 0,
  show: 8,
  mine: 12,
  time: 16,
  yaw: 20,
  hidden: 24,
  bytes: 32,
} as const

/** the camera's turn round the box (radians) and the flags the shader draws by */
export function packBox(
  p: {
    w: number
    h: number
    show: Show
    mine: boolean
    hidden: boolean
    time: number
    yaw: number
  },
  into = new ArrayBuffer(BOX.bytes),
) {
  const u = new Uint32Array(into)
  const f = new Float32Array(into)
  u.set([p.w, p.h, (p.show.front ? 1 : 0) | (p.show.side ? 2 : 0) | (p.show.top ? 4 : 0)], 0)
  u[BOX.mine / 4] = p.mine ? 1 : 0
  f[BOX.time / 4] = p.time
  f[BOX.yaw / 4] = p.yaw
  u[BOX.hidden / 4] = p.hidden ? 1 : 0
  return into
}

type V3 = [number, number, number]
const norm = (v: V3): V3 => {
  const l = Math.hypot(...v)
  return [v[0] / l, v[1] / l, v[2] / l]
}
const crossV = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]

/** the ray through a pixel: the shader's orthographic camera, line for line */
export function cameraRay(size: [number, number], yaw: number, px: [number, number]) {
  const m = Math.min(size[0], size[1])
  const uv = [(px[0] - size[0] / 2) / m, (px[1] - size[1] / 2) / m]
  const back = norm([Math.sin(yaw), 0.85, -Math.cos(yaw)])
  const right = norm(crossV(back, [0, 1, 0]))
  const up = crossV(right, back)
  const focus: V3 = [2.4, 1.3, 2.6]
  const o = [0, 1, 2].map(
    (k) => focus[k] + (right[k] * uv[0] - up[k] * uv[1]) * 8.6 + back[k] * 30,
  ) as V3
  return { o, d: back.map((v) => -v) as V3 }
}

/** what a ray meets behind the blocks: the back wall, the left wall or the floor (the shader's planes) */
export function wallHit(o: V3, d: V3): { kind: 'back' | 'left' | 'floor'; p: V3 } | null {
  let best: { kind: 'back' | 'left' | 'floor'; p: V3; t: number } | null = null
  const tryPlane = (kind: 'back' | 'left' | 'floor', t: number, ok: (p: V3) => boolean) => {
    if (t <= 0 || (best && t >= best.t)) return
    const p = [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t] as V3
    if (ok(p)) best = { kind, p, t }
  }
  tryPlane(
    'back',
    (N - o[2]) / d[2],
    (p) => p[0] >= 0 && p[0] <= N + 0.15 && p[1] >= 0 && p[1] <= TALL + 0.6,
  )
  tryPlane(
    'left',
    (0 - o[0]) / d[0],
    (p) => p[2] >= 0 && p[2] <= N && p[1] >= 0 && p[1] <= TALL + 0.6,
  )
  tryPlane('floor', (0 - o[1]) / d[1], (p) => p[0] >= 0 && p[0] <= N && p[2] >= 0 && p[2] <= N)
  const b = best as { kind: 'back' | 'left' | 'floor'; p: V3 } | null
  return b && { kind: b.kind, p: b.p }
}

/** whether a point on a wall or the floor is in a build's shadow, by the profiles */
export function inShadow(s: Shadows, kind: 'back' | 'left' | 'floor', p: V3) {
  if (kind === 'back') return (s.front[Math.floor(p[0])] ?? 0) > p[1] + 1e-3
  if (kind === 'left') return (s.side[Math.floor(p[2])] ?? 0) > p[1] + 1e-3
  return s.top[at(Math.floor(p[0]), Math.floor(p[2]))] ?? false
}

/**
 * The first block face a ray meets: the shader's `trace_blocks`, line for line — a walk over the
 * floor's columns, checking the ray's height in each. Returns the ray distance and the face's normal.
 */
export function traceBlocks(b: Build, o: V3, d: V3): { t: number; n: V3 } | null {
  const inv = d.map((v) => 1 / (Math.abs(v) < 1e-6 ? 1e-6 : v)) as V3
  const lo = [0, 0, 0].map((v, k) => (v - o[k]) * inv[k])
  const hi = [N, TALL, N].map((v, k) => (v - o[k]) * inv[k])
  const tn = lo.map((v, k) => Math.min(v, hi[k]))
  const tf = lo.map((v, k) => Math.max(v, hi[k]))
  const enter = Math.max(...tn)
  const leave = Math.min(...tf)
  if (enter > leave || leave < 0) return null
  let t = Math.max(enter, 0) + 1e-4
  let cx = Math.floor(o[0] + d[0] * t)
  let cz = Math.floor(o[2] + d[2] * t)
  const sx = d[0] > 0 ? 1 : -1
  const sz = d[2] > 0 ? 1 : -1
  let n: V3 = [0, 1, 0]
  if (enter === tn[0]) n = [-sx, 0, 0]
  else if (enter === tn[2]) n = [0, 0, -sz]
  for (let k = 0; k < 16; k++) {
    if (cx < 0 || cz < 0 || cx >= N || cz >= N) break
    const h = b[at(cx, cz)]
    const tx = ((d[0] > 0 ? cx + 1 : cx) - o[0]) * inv[0]
    const tz = ((d[2] > 0 ? cz + 1 : cz) - o[2]) * inv[2]
    const out = Math.min(tx, tz)
    if (o[1] + d[1] * t <= h) return { t, n }
    if (o[1] + d[1] * out <= h) return { t: (h - o[1]) / d[1], n: [0, 1, 0] }
    t = out + 1e-4
    if (tx < tz) {
      cx += sx
      n = [-sx, 0, 0]
    } else {
      cz += sz
      n = [0, 0, -sz]
    }
  }
  return null
}

/** the stack a tap on the stage lands on: the block it hits, else the floor cell; −1 for neither */
export function pickCell(b: Build, size: [number, number], yaw: number, px: [number, number]) {
  const { o, d } = cameraRay(size, yaw, px)
  const hit = traceBlocks(b, o, d)
  if (hit) {
    const p = [0, 1, 2].map((k) => o[k] + d[k] * hit.t - hit.n[k] * 0.01)
    return at(Math.floor(p[0]), Math.floor(p[2]))
  }
  const w = wallHit(o, d)
  if (w && w.kind === 'floor') {
    const x = Math.floor(w.p[0])
    const z = Math.floor(w.p[2])
    if (x >= 0 && z >= 0 && x < N && z < N) return at(x, z)
  }
  return -1
}
