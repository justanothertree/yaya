/**
 * The arithmetic of the Lab's marble maze: thousands of marbles rolling round a board you tilt,
 * off walls you draw, into holes you dig.
 *
 * ⚠️ EVERY MARBLE NEEDS ITS NEIGHBOURS, SO THEY ARE SORTED INTO CELLS FIRST — A COUNTING SORT. To
 * keep marbles from passing through each other each one must see the few beside it, and asking all
 * of them is n² — 16 million questions at 4,096 marbles. Instead the board is cut into cells a
 * marble across and the marbles are sorted by cell every step, on the GPU, in four passes: COUNT
 * how many land in each cell (atomicAdd), SCAN those counts into where each cell's run starts (a
 * prefix sum in one workgroup's memory), SCATTER each marble into its cell's run (atomicAdd on a
 * cursor), then every marble reads only the nine cells round it. `hashSort` here is the same sort,
 * and marbles.test.ts checks that every marble lands exactly once, grouped by cell.
 *
 * ⚠️ AND THEY MOVE BY POSITION, NOT FORCE. Position-based dynamics: each marble guesses where it
 * will be, the guesses are pushed out of walls and out of each other, and the velocity is whatever
 * that move turned out to be. A push between two marbles is gathered by each from the other, half
 * each — never scattered — so the step does not depend on which thread runs first, and the GPU's
 * answer can be held to this file's.
 */

/** Hand-packed to match `struct Maze` — marbles.test.ts lays the struct out from the shader. */
export const MAZE = {
  size: 0,
  board: 8,
  cells: 16,
  gravity: 24,
  count: 32,
  dt: 36,
  radius: 40,
  dabs: 44,
  bytes: 48,
} as const

/** the board's longer side, in field cells */
export const LONG = 240
/** a marble's radius, in field cells */
export const RADIUS = 1.6
/** the hash grid's cell is a marble across */
export const HASH = RADIUS * 2
export const MAX_MARBLES = 4096
/** how far the distance field is worked out from the walls: further than a marble ever needs */
export const DMAX = 8
/** gravity at full tilt, cells a second² */
export const G = 260
export const STEPS = 3
export const KIND = { open: 0, wall: 1, hole: 2 } as const

type V2 = [number, number]

export type Board = { w: number; h: number; kind: Uint8Array }

/**
 * How far each place is from the edge of the walls, cells, capped at DMAX: positive in the open,
 * NEGATIVE inside a wall — the 1/√2 chamfer the shader runs, twice, once from each side.
 * ⚠️ First the distance outside the walls only, 0 everywhere inside one: a marble shoved into a wall
 * by the crowd behind it found no slope there to climb out on, and with the edge of the board the
 * same, the first probe watched marbles leave the board altogether. Inside, the field now falls
 * below zero and its slope points out.
 */
export function distanceField(b: Board): Float32Array {
  const chamfer = (seed: (k: number) => boolean) => {
    const d = new Float32Array(b.w * b.h)
    for (let i = 0; i < d.length; i++) d[i] = seed(b.kind[i]) ? 0 : DMAX
    for (let pass = 0; pass < DMAX; pass++) {
      const next = new Float32Array(d)
      for (let y = 0; y < b.h; y++)
        for (let x = 0; x < b.w; x++) {
          let m = d[y * b.w + x]
          for (let dy = -1; dy <= 1; dy++)
            for (let dx = -1; dx <= 1; dx++) {
              const nx = x + dx
              const ny = y + dy
              if ((!dx && !dy) || nx < 0 || ny < 0 || nx >= b.w || ny >= b.h) continue
              m = Math.min(m, d[ny * b.w + nx] + (dx && dy ? Math.SQRT2 : 1))
            }
          next[y * b.w + x] = m
        }
      d.set(next)
    }
    return d
  }
  const outside = chamfer((k) => k === KIND.wall)
  const inside = chamfer((k) => k !== KIND.wall)
  return outside.map((o, i) => o - inside[i])
}

/** the most a marble is pushed in a step, and the fastest it may go: slower than a radius a step */
export const MAX_PUSH = RADIUS
export const MAX_SPEED = 250

/** the field read between cells, and which way it rises — mirrored in marbles.wgsl */
export function sampleField(
  d: Float32Array,
  w: number,
  h: number,
  x: number,
  y: number,
): { d: number; n: V2 } {
  const at = (i: number, j: number) =>
    d[Math.min(h - 1, Math.max(0, j)) * w + Math.min(w - 1, Math.max(0, i))]
  const fx = x - 0.5
  const fy = y - 0.5
  const x0 = Math.floor(fx)
  const y0 = Math.floor(fy)
  const tx = fx - x0
  const ty = fy - y0
  const v =
    (at(x0, y0) * (1 - tx) + at(x0 + 1, y0) * tx) * (1 - ty) +
    (at(x0, y0 + 1) * (1 - tx) + at(x0 + 1, y0 + 1) * tx) * ty
  const gx = (at(x0 + 1, y0) - at(x0, y0)) * (1 - ty) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * ty
  const gy = (at(x0, y0 + 1) - at(x0, y0)) * (1 - tx) + (at(x0 + 1, y0 + 1) - at(x0 + 1, y0)) * tx
  const l = Math.hypot(gx, gy)
  return { d: v, n: l > 1e-6 ? [gx / l, gy / l] : [0, 0] }
}

/** the hash cell a point falls in */
export const hashCell = (x: number, y: number, cols: number, rows: number) =>
  Math.min(rows - 1, Math.max(0, Math.floor(y / HASH))) * cols +
  Math.min(cols - 1, Math.max(0, Math.floor(x / HASH)))

/**
 * The counting sort, as the GPU does it: count per cell, scan into starts, scatter. Returns the
 * marbles in cell order and where each cell's run starts (cells + 1 entries).
 */
export function hashSort(
  xs: ArrayLike<number>,
  ys: ArrayLike<number>,
  alive: ArrayLike<boolean>,
  cols: number,
  rows: number,
) {
  const counts = new Uint32Array(cols * rows)
  const cellOf = new Int32Array(xs.length).fill(-1)
  for (let i = 0; i < xs.length; i++) {
    if (!alive[i]) continue
    cellOf[i] = hashCell(xs[i], ys[i], cols, rows)
    counts[cellOf[i]]++
  }
  const start = new Uint32Array(cols * rows + 1)
  for (let c = 0; c < cols * rows; c++) start[c + 1] = start[c] + counts[c]
  const cursor = start.slice(0, cols * rows)
  const order = new Uint32Array(start[cols * rows])
  for (let i = 0; i < xs.length; i++) if (cellOf[i] >= 0) order[cursor[cellOf[i]]++] = i
  return { order, start }
}

export type Marbles = {
  x: Float32Array
  y: Float32Array
  vx: Float32Array
  vy: Float32Array
  alive: boolean[]
}

/**
 * One step for every marble — mirrored, pass for pass, in marbles.wgsl: guess (gravity), keep out
 * of the walls, keep apart (each gathering half of every overlap from its neighbours), and the
 * velocity from the move. Marbles over a hole fall in. Returns how many fell in.
 */
export function stepMarbles(m: Marbles, b: Board, d: Float32Array, g: V2, dt: number): number {
  const n = m.x.length
  const px = new Float32Array(n)
  const py = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    if (!m.alive[i]) continue
    // a little rolling friction, then gravity
    const vx = (m.vx[i] + g[0] * dt) * 0.999
    const vy = (m.vy[i] + g[1] * dt) * 0.999
    let x = m.x[i] + vx * dt
    let y = m.y[i] + vy * dt
    const s = sampleField(d, b.w, b.h, x, y)
    if (s.d < RADIUS) {
      x += s.n[0] * (RADIUS - s.d)
      y += s.n[1] * (RADIUS - s.d)
    }
    px[i] = x
    py[i] = y
  }
  const cols = Math.ceil(b.w / HASH)
  const rows = Math.ceil(b.h / HASH)
  const { order, start } = hashSort(px, py, m.alive, cols, rows)
  let fell = 0
  for (let i = 0; i < n; i++) {
    if (!m.alive[i]) continue
    let cx = 0
    let cy = 0
    const hx = Math.floor(px[i] / HASH)
    const hy = Math.floor(py[i] / HASH)
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const qx = hx + dx
        const qy = hy + dy
        if (qx < 0 || qy < 0 || qx >= cols || qy >= rows) continue
        const c = qy * cols + qx
        for (let k = start[c]; k < start[c + 1]; k++) {
          const j = order[k]
          if (j === i) continue
          const ex = px[i] - px[j]
          const ey = py[i] - py[j]
          const dist = Math.hypot(ex, ey)
          if (dist >= 2 * RADIUS || dist < 1e-6) continue
          const push = (2 * RADIUS - dist) * 0.5
          cx += (ex / dist) * push
          cy += (ey / dist) * push
        }
      }
    const pl = Math.hypot(cx, cy)
    if (pl > MAX_PUSH) {
      cx *= MAX_PUSH / pl
      cy *= MAX_PUSH / pl
    }
    let nx = px[i] + cx
    let ny = py[i] + cy
    /* the neighbours may have pushed it into a wall: out again, last, so nothing ends inside one */
    const s = sampleField(d, b.w, b.h, nx, ny)
    if (s.d < RADIUS) {
      nx += s.n[0] * (RADIUS - s.d)
      ny += s.n[1] * (RADIUS - s.d)
    }
    /* and whatever the crowd does — a board can be poured fuller than it holds — never off the board */
    nx = Math.min(b.w - 1 - RADIUS, Math.max(1 + RADIUS, nx))
    ny = Math.min(b.h - 1 - RADIUS, Math.max(1 + RADIUS, ny))
    let vx = (nx - m.x[i]) / dt
    let vy = (ny - m.y[i]) / dt
    const sp = Math.hypot(vx, vy)
    if (sp > MAX_SPEED) {
      vx *= MAX_SPEED / sp
      vy *= MAX_SPEED / sp
    }
    m.vx[i] = vx
    m.vy[i] = vy
    m.x[i] = nx
    m.y[i] = ny
    const cell = Math.floor(ny) * b.w + Math.floor(nx)
    if (b.kind[cell] === KIND.hole) {
      m.alive[i] = false
      fell++
    }
  }
  return fell
}

/** the board for a canvas: LONG cells along its longer side */
export const boardFor = (w: number, h: number): [number, number] =>
  w >= h
    ? [LONG, Math.max(40, Math.round((LONG * h) / w))]
    : [Math.max(40, Math.round((LONG * w) / h)), LONG]

/**
 * A maze to start on: a border, passages carved by a depth-first walk over a coarse grid, and a
 * hole in a few dead ends. Seeded, so the same board comes back.
 */
export function mazeFor(w: number, h: number, seed: number): Uint8Array {
  const kind = new Uint8Array(w * h).fill(KIND.wall)
  const step = 24
  const cw = Math.max(2, Math.floor((w - 4) / step))
  const ch = Math.max(2, Math.floor((h - 4) / step))
  const ox = Math.floor((w - cw * step) / 2)
  const oy = Math.floor((h - ch * step) / 2)
  let s = seed >>> 0
  const rand = () => (s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296
  const seen = new Uint8Array(cw * ch)
  const carve = (x0: number, y0: number, x1: number, y1: number) => {
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++)
      for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++)
        if (x >= 0 && y >= 0 && x < w && y < h) kind[y * w + x] = KIND.open
  }
  const centre = (c: number, r: number): V2 => [ox + c * step + step / 2, oy + r * step + step / 2]
  const room = (c: number, r: number) => {
    const [x, y] = centre(c, r)
    carve(x - 8, y - 8, x + 8, y + 8)
  }
  const stack: V2[] = [[0, 0]]
  seen[0] = 1
  room(0, 0)
  const ends: V2[] = []
  while (stack.length) {
    const [c, r] = stack[stack.length - 1]
    const next = (
      [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as V2[]
    )
      .map(([dc, dr]) => [c + dc, r + dr] as V2)
      .filter(([nc, nr]) => nc >= 0 && nr >= 0 && nc < cw && nr < ch && !seen[nr * cw + nc])
    if (!next.length) {
      ends.push(stack.pop()!)
      continue
    }
    const [nc, nr] = next[Math.floor(rand() * next.length)]
    seen[nr * cw + nc] = 1
    const [ax, ay] = centre(c, r)
    const [bx, by] = centre(nc, nr)
    carve(ax - 8, ay - 8, bx + 8, by + 8)
    room(nc, nr)
    stack.push([nc, nr])
  }
  // a hole in a few of the dead ends far from the start
  ends
    .filter(([c, r]) => c + r > 2)
    .slice(0, 4)
    .forEach(([c, r]) => {
      const [x, y] = centre(c, r)
      for (let dy = -4; dy <= 4; dy++)
        for (let dx = -4; dx <= 4; dx++)
          if (dx * dx + dy * dy <= 16) kind[(y + dy) * w + x + dx] = KIND.hole
    })
  // and the edge of the board is always wall
  for (let x = 0; x < w; x++) kind[x] = kind[(h - 1) * w + x] = KIND.wall
  for (let y = 0; y < h; y++) kind[y * w] = kind[y * w + w - 1] = KIND.wall
  return kind
}

/** the middle of the first room, where marbles are poured to start */
export function startOf(w: number, h: number): V2 {
  const step = 24
  const cw = Math.max(2, Math.floor((w - 4) / step))
  const ch = Math.max(2, Math.floor((h - 4) / step))
  return [Math.floor((w - cw * step) / 2) + step / 2, Math.floor((h - ch * step) / 2) + step / 2]
}

export const TOOLS = {
  tilt: '🖐 Tilt',
  wall: '✏️ Wall',
  hole: '🕳 Hole',
  erase: '🧽 Erase',
  pour: '⚪ Pour',
} as const
export type Tool = keyof typeof TOOLS
