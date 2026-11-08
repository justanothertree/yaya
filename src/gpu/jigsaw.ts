/**
 * The arithmetic of the Lab's jigsaw: how a picture is cut, which piece owns a point, how pieces are
 * picked up, how they join, and how a puzzle in progress is kept. Pure, so jigsaw.test.ts can ask it
 * questions without a GPU.
 *
 * ⚠️ ONE RULE CUTS EVERY PIECE, AND THE SHADER KEEPS IT TOO. Every internal edge has one knob: a
 * circle, in BOARD units, that belongs to the piece on one side of the edge and bulges into the
 * piece on the other. A point belongs to the owner of any knob it is inside; otherwise to the cell
 * it is in (`owner`). So a tab on one piece and the hole in its neighbour are the same circle, and
 * they cannot fail to fit. The `pieces` pass in jigsaw.wgsl asks the same question per pixel, so a
 * piece is picked up exactly where it is drawn.
 */

export type V2 = [number, number]

/** one knob: a circle in board units (a cell is 1×1), and the piece it belongs to */
export type Knob = { x: number; y: number; r: number; owner: number }

export type Cuts = {
  cols: number
  rows: number
  /** between (c, r) and (c+1, r), at index r·(cols−1)+c */
  across: Knob[]
  /** between (c, r) and (c, r+1), at index r·cols+c */
  down: Knob[]
}

/** a small repeatable generator, so a seed is a puzzle */
export function rng(seed: number) {
  let a = seed >>> 0 || 1
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * A knob's circle sits 0.13–0.14 of a cell past the edge with a radius of 0.16–0.17, so it crosses
 * the edge by a sliver: the crossing is the knob's neck (about a seventh of a cell wide) and the rest
 * is its round head, reaching about 0.3 past the edge. Its place along the edge wanders by up to a
 * twentieth, so no two holes are quite alike.
 * ⚠️ THE SIZES ARE SET BY WHAT MUST NOT TOUCH: two knobs meeting near a cell's corner. A first cut
 * at radius 0.2 and 0.18 out did touch (0.40 apart against 0.42 of radii, measured), which made a
 * point's owner depend on which knob was asked first — and cut one piece into three.
 */
export function cut(cols: number, rows: number, seed: number): Cuts {
  const rand = rng(seed)
  const knob = (ax: number, ay: number, horizontal: boolean, a: number, b: number): Knob => {
    const out = rand() < 0.5 ? 1 : -1
    const d = 0.13 + rand() * 0.01
    const r = 0.16 + rand() * 0.01
    const along = (rand() - 0.5) * 0.1
    // out = +1: the knob bulges toward +x (or +y) — it belongs to the piece on the − side
    return horizontal
      ? { x: ax + out * d, y: ay + along, r, owner: out > 0 ? a : b }
      : { x: ax + along, y: ay + out * d, r, owner: out > 0 ? a : b }
  }
  const across: Knob[] = []
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols - 1; c++)
      across.push(knob(c + 1, r + 0.5, true, r * cols + c, r * cols + c + 1))
  const down: Knob[] = []
  for (let r = 0; r < rows - 1; r++)
    for (let c = 0; c < cols; c++)
      down.push(knob(c + 0.5, r + 1, false, r * cols + c, (r + 1) * cols + c))
  return { cols, rows, across, down }
}

const inside = (k: Knob, x: number, y: number) => (x - k.x) ** 2 + (y - k.y) ** 2 < k.r * k.r

/** the piece a point of the BOARD belongs to (as cut), or −1 off the board */
export function owner(cuts: Cuts, x: number, y: number): number {
  const { cols, rows } = cuts
  if (!(x >= 0 && y >= 0 && x < cols && y < rows)) return -1
  const c = Math.floor(x)
  const r = Math.floor(y)
  // only the knobs of this cell's own four edges can reach into it
  if (c > 0 && inside(cuts.across[r * (cols - 1) + c - 1], x, y))
    return cuts.across[r * (cols - 1) + c - 1].owner
  if (c < cols - 1 && inside(cuts.across[r * (cols - 1) + c], x, y))
    return cuts.across[r * (cols - 1) + c].owner
  if (r > 0 && inside(cuts.down[(r - 1) * cols + c], x, y))
    return cuts.down[(r - 1) * cols + c].owner
  if (r < rows - 1 && inside(cuts.down[r * cols + c], x, y)) return cuts.down[r * cols + c].owner
  return r * cols + c
}

/** how far past its own cell a piece can reach: a knob's far side (at most 0.31), and a little more */
export const REACH = 0.34

/* ---------------------------------------------------------------- sizes and pictures ---------- */

/** the piece counts on offer — the cut is nearest that count for the picture's shape */
export const SIZES = [12, 24, 48, 96, 150] as const
export type Size = (typeof SIZES)[number]

/** columns and rows for about `n` square pieces on a picture `aspect` wide to 1 tall */
export function grid(n: number, aspect: number): { cols: number; rows: number } {
  const a = Math.min(4, Math.max(0.25, aspect || 1))
  const cols = Math.max(2, Math.round(Math.sqrt(n * a)))
  const rows = Math.max(2, Math.round(n / cols))
  return { cols, rows }
}

export const PICTURES = [
  { id: 'dusk', name: 'Hills at dusk' },
  { id: 'quilt', name: 'Patchwork quilt' },
  { id: 'garden', name: 'Flower garden' },
  { id: 'city', name: 'City at night' },
  { id: 'marble', name: 'Marbled paper' },
  { id: 'reef', name: 'Coral reef' },
] as const
export type PictureId = (typeof PICTURES)[number]['id']
/** the built-in pictures are painted 4 : 3 */
export const PICTURE_ASPECT = 4 / 3

/* ---------------------------------------------------------------- the table ------------------- */

/**
 * The table: the board (0..cols × 0..rows) in the middle, and room round it for every piece, each
 * in a slot a little bigger than a piece so none starts under another. `aspect` is the stage's, so
 * the table fills it rather than leaving bands; the board is never cut to make room.
 */
export const SLOT = 1.7

export type Table = { x0: number; y0: number; x1: number; y1: number; slots: V2[] }

export function table(cols: number, rows: number, aspect: number): Table {
  const a = Math.min(3, Math.max(0.4, aspect || 1))
  const n = cols * rows
  for (let m = 1; ; m += 0.25) {
    let mx = m
    let my = m
    // widen whichever way the stage is longer, so the table's shape follows it
    const w = cols + 2 * mx
    const h = rows + 2 * my
    if (w / h < a) mx += (a * h - w) / 2
    else my += (w / a - h) / 2
    const t = { x0: -mx, y0: -my, x1: cols + mx, y1: rows + my }
    // a slot is where a piece's cell starts: the whole piece, knobs and all, on the table, off the
    // board and its frame, and SLOT apart so no two dealt pieces touch
    const slots: V2[] = []
    for (let y = t.y0 + REACH; y + 1 + REACH <= t.y1 + 1e-9; y += SLOT)
      for (let x = t.x0 + REACH; x + 1 + REACH <= t.x1 + 1e-9; x += SLOT) {
        const clear =
          x + 1 + REACH < -0.2 ||
          x - REACH > cols + 0.2 ||
          y + 1 + REACH < -0.2 ||
          y - REACH > rows + 0.2
        if (clear) slots.push([x, y])
      }
    if (slots.length >= n) return { ...t, slots }
  }
}

/* ---------------------------------------------------------------- a puzzle in play ------------ */

export type Piece = {
  /** where the piece's cell is now (its top-left, in board units); home is (col, row) */
  x: number
  y: number
  /** pieces joined together share a group, and move as one */
  group: number
}

export type Puzzle = {
  cuts: Cuts
  pieces: Piece[]
  /** draw order, bottom first: piece indices */
  order: number[]
  /** groups that are in their place on the board — fixed there */
  placed: Set<number>
}

export const home = (cuts: Cuts, k: number): V2 => [k % cuts.cols, Math.floor(k / cuts.cols)]

/** a fresh puzzle: every piece alone, in a shuffled slot round the board */
export function deal(cuts: Cuts, t: Table, seed: number): Puzzle {
  const n = cuts.cols * cuts.rows
  const rand = rng(seed ^ 0x9e3779b9)
  const slots = t.slots.slice()
  for (let i = slots.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[slots[i], slots[j]] = [slots[j], slots[i]]
  }
  const pieces = Array.from({ length: n }, (_, k) => ({ x: slots[k][0], y: slots[k][1], group: k }))
  return { cuts, pieces, order: Array.from({ length: n }, (_, k) => k), placed: new Set() }
}

/** the piece under a point of the table — the topmost whose cut shape holds it — or −1 */
export function hit(p: Puzzle, x: number, y: number): number {
  for (let i = p.order.length - 1; i >= 0; i--) {
    const k = p.order[i]
    const piece = p.pieces[k]
    const [hc, hr] = home(p.cuts, k)
    // the point as it would be if this piece were at home, asked of the cut
    if (owner(p.cuts, x - piece.x + hc, y - piece.y + hr) === k) return k
  }
  return -1
}

export const members = (p: Puzzle, group: number) =>
  p.pieces.flatMap((q, k) => (q.group === group ? [k] : []))

/** lift a group to the top of the pile, keeping its pieces in their own order */
export function raise(p: Puzzle, group: number) {
  const mine = p.order.filter((k) => p.pieces[k].group === group)
  p.order = [...p.order.filter((k) => p.pieces[k].group !== group), ...mine]
}

/** move a group by (dx, dy) — refused for a group already in its place */
export function move(p: Puzzle, group: number, dx: number, dy: number) {
  if (p.placed.has(group)) return
  for (const q of p.pieces)
    if (q.group === group) {
      q.x += dx
      q.y += dy
    }
}

/** how close (in cells) a piece must be laid to its neighbour, or to its place, to take hold */
export const SNAP = 0.28

export type Settled = { joined: number; placed: boolean }

/**
 * A group has been let go: join it to every neighbour it was laid close enough to — as many times
 * as joining brings new neighbours near — and fix it on the board if it is close enough to its place.
 */
export function settle(p: Puzzle, group: number): Settled {
  const { cols, rows } = p.cuts
  let joined = 0
  for (let again = true; again; ) {
    again = false
    for (const k of members(p, group)) {
      const [hc, hr] = home(p.cuts, k)
      for (const [dc, dr] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const c = hc + dc
        const r = hr + dr
        if (c < 0 || r < 0 || c >= cols || r >= rows) continue
        const n = r * cols + c
        const other = p.pieces[n].group
        if (other === group) continue
        // where the neighbour is, against where it belongs relative to this piece
        const ex = p.pieces[n].x - p.pieces[k].x - dc
        const ey = p.pieces[n].y - p.pieces[k].y - dr
        if (Math.hypot(ex, ey) >= SNAP) continue
        // the loose side moves: a group in place stays where it is
        if (p.placed.has(other)) {
          move(p, group, ex, ey)
          absorb(p, group, other)
          group = other
        } else {
          move(p, other, -ex, -ey)
          absorb(p, other, group)
        }
        joined++
        again = true
        break
      }
      if (again) break
    }
  }
  let placed = p.placed.has(group)
  if (!placed) {
    const k = members(p, group)[0]
    const [hc, hr] = home(p.cuts, k)
    const ex = hc - p.pieces[k].x
    const ey = hr - p.pieces[k].y
    if (Math.hypot(ex, ey) < SNAP) {
      move(p, group, ex, ey)
      p.placed.add(group)
      placed = true
    }
  }
  return { joined, placed }
}

/** every piece of `from` joins `into` */
function absorb(p: Puzzle, from: number, into: number) {
  for (const q of p.pieces) if (q.group === from) q.group = into
}

export const done = (p: Puzzle) => p.pieces.every((q) => p.placed.has(q.group))
export const placedCount = (p: Puzzle) => p.pieces.filter((q) => p.placed.has(q.group)).length

export const isEdge = (cuts: Cuts, k: number) => {
  const [c, r] = home(cuts, k)
  return c === 0 || r === 0 || c === cuts.cols - 1 || r === cuts.rows - 1
}

/**
 * Sort the loose pieces into the slots: the edge pieces first, nearest the board, so the frame can
 * be built from them. Joined groups and placed pieces are left where they are.
 */
export function tidy(p: Puzzle, t: Table) {
  const { cols, rows } = p.cuts
  const loose = p.pieces.flatMap((q, k) =>
    members(p, q.group).length === 1 && !p.placed.has(q.group) ? [k] : [],
  )
  const near = (s: V2) => Math.max(-s[0], s[0] + 1 - cols, -s[1], s[1] + 1 - rows, 0) // distance out from the board
  // slots not already covered by a joined group or a placed piece
  const taken = (s: V2) =>
    p.pieces.some(
      (q) =>
        (members(p, q.group).length > 1 || p.placed.has(q.group)) &&
        Math.abs(q.x - s[0]) < 1 &&
        Math.abs(q.y - s[1]) < 1,
    )
  const slots = t.slots.filter((s) => !taken(s)).sort((a, b) => near(a) - near(b))
  const sorted = loose
    .slice()
    .sort((a, b) => Number(isEdge(p.cuts, b)) - Number(isEdge(p.cuts, a)) || a - b)
  sorted.forEach((k, i) => {
    const s = slots[i % slots.length]
    p.pieces[k].x = s[0]
    p.pieces[k].y = s[1]
  })
}

/* ---------------------------------------------------------------- the view -------------------- */

/** the table fitted to a stage: its scale in pixels a cell, and where (0, 0) of the board lands */
export function fit(t: Table, size: V2) {
  const s = Math.min(size[0] / (t.x1 - t.x0), size[1] / (t.y1 - t.y0))
  const ox = (size[0] - (t.x1 - t.x0) * s) / 2 - t.x0 * s
  const oy = (size[1] - (t.y1 - t.y0) * s) / 2 - t.y0 * s
  return { s, ox, oy }
}
export const toTable = (f: ReturnType<typeof fit>, p: V2): V2 => [
  (p[0] - f.ox) / f.s,
  (p[1] - f.oy) / f.s,
]

/* ---------------------------------------------------------------- kept in this browser -------- */

export const JIGSAW_KEY = 'lab_jigsaw_v1'

export type Saved = {
  picture: PictureId
  size: Size
  seed: number
  /** the table's shape, so a reload deals onto the same table */
  aspect: number
  pieces: [number, number, number][]
  placed: number[]
  seconds: number
  /** pieces put in place by 🪄 — a puzzle finished with any is not kept as a best */
  hints: number
}

/** a kept puzzle, or null when it is not one (every count, range and name checked) */
export function readSaved(text: string | null): Saved | null {
  try {
    const v = JSON.parse(text ?? 'null') as Record<string, unknown> | null
    if (!v || typeof v !== 'object') return null
    const picture = PICTURES.find((q) => q.id === v.picture)?.id
    const size = SIZES.find((n) => n === v.size)
    const seed = v.seed
    const aspect = v.aspect
    const seconds = v.seconds
    if (!picture || !size) return null
    if (typeof seed !== 'number' || !Number.isInteger(seed) || seed < 0 || seed > 2 ** 32)
      return null
    if (typeof aspect !== 'number' || !(aspect >= 0.4 && aspect <= 3)) return null
    if (typeof seconds !== 'number' || !(seconds >= 0 && seconds < 360000)) return null
    const hints = v.hints
    const { cols, rows } = grid(size, PICTURE_ASPECT)
    const n = cols * rows
    const t = table(cols, rows, aspect)
    const fin = (x: unknown, lo: number, hi: number) =>
      typeof x === 'number' && Number.isFinite(x) && x >= lo && x <= hi
    if (typeof hints !== 'number' || !Number.isInteger(hints) || !fin(hints, 0, n)) return null
    if (!Array.isArray(v.pieces) || v.pieces.length !== n) return null
    const pieces: [number, number, number][] = []
    for (const q of v.pieces) {
      if (!Array.isArray(q) || q.length !== 3) return null
      if (!fin(q[0], t.x0 - 2, t.x1 + 2) || !fin(q[1], t.y0 - 2, t.y1 + 2)) return null
      if (!Number.isInteger(q[2]) || !fin(q[2], 0, n - 1)) return null
      pieces.push([q[0], q[1], q[2]])
    }
    if (!Array.isArray(v.placed) || v.placed.length > n) return null
    const placed: number[] = []
    for (const g of v.placed) {
      if (!Number.isInteger(g) || !fin(g, 0, n - 1)) return null
      placed.push(g as number)
    }
    return { picture, size, seed, aspect, pieces, placed, seconds, hints }
  } catch {
    return null
  }
}

/** a puzzle as it can be kept — positions rounded, so the store stays small */
export function toSaved(
  p: Puzzle,
  head: {
    picture: PictureId
    size: Size
    seed: number
    aspect: number
    seconds: number
    hints: number
  },
): Saved {
  const r = (x: number) => Math.round(x * 1000) / 1000
  return {
    ...head,
    seconds: Math.floor(head.seconds),
    pieces: p.pieces.map((q) => [r(q.x), r(q.y), q.group]),
    placed: [...p.placed],
  }
}

/** a kept puzzle back in play, on the cut its seed makes */
export function fromSaved(s: Saved): Puzzle {
  const { cols, rows } = grid(s.size, PICTURE_ASPECT)
  const cuts = cut(cols, rows, s.seed)
  const placed = new Set(s.placed)
  // a piece in a placed group is at home whatever the store says: "placed" is the claim that counts
  const pieces = s.pieces.map(([x, y, group], k) => {
    const [hc, hr] = home(cuts, k)
    return placed.has(group) ? { x: hc, y: hr, group } : { x, y, group }
  })
  // placed pieces at the bottom of the pile, so a loose one is never drawn under the board
  const order = pieces.map((_, k) => k)
  order.sort((a, b) => Number(placed.has(pieces[b].group)) - Number(placed.has(pieces[a].group)))
  return { cuts, pieces, order, placed }
}

/** one more piece put in its place for somebody who asked: the loose piece nearest the board's
 * first unfilled cell, laid at home and settled there, so it joins whatever is already round it.
 * Returns the piece, or −1 when there is nothing left to place. */
export function hint(p: Puzzle): number {
  const k = p.pieces.findIndex((q) => !p.placed.has(q.group))
  if (k < 0) return -1
  // the whole group comes with it: a group moves as one, and is laid where its piece belongs
  const [hc, hr] = home(p.cuts, k)
  const q = p.pieces[k]
  move(p, q.group, hc - q.x, hr - q.y)
  raise(p, q.group)
  settle(p, q.group)
  return k
}

/* ---------------------------------------------------------------- for the GPU ----------------- */

/** pieces the buffers are made for: the largest size's cut (14 × 11 = 154) with room to spare */
export const MAX_PIECES = 256

/** every knob as (x, y, r, owner) — the shader's `across` and `down` are these, in this order */
export function packKnobs(c: Cuts): {
  across: Float32Array<ArrayBuffer>
  down: Float32Array<ArrayBuffer>
} {
  const pack = (ks: Knob[]) => Float32Array.from(ks.flatMap((k) => [k.x, k.y, k.r, k.owner]))
  return { across: pack(c.across), down: pack(c.down) }
}

/** each piece as (x, y, group, placed?) by its index, and the draw order bottom first */
export function packPieces(p: Puzzle): {
  pieces: Float32Array<ArrayBuffer>
  order: Uint32Array<ArrayBuffer>
} {
  const pieces = new Float32Array(p.pieces.length * 4)
  p.pieces.forEach((q, k) => {
    pieces.set([q.x, q.y, q.group, p.placed.has(q.group) ? 1 : 0], k * 4)
  })
  return { pieces, order: Uint32Array.from(p.order) }
}

/** best times, by picture and size: "dusk:48" → seconds */
export type Bests = Record<string, number>
export function readBests(text: string | null): Bests {
  try {
    const v = JSON.parse(text ?? '{}') as Record<string, unknown>
    const out: Bests = {}
    for (const p of PICTURES)
      for (const n of SIZES) {
        const t = v?.[`${p.id}:${n}`]
        if (typeof t === 'number' && Number.isInteger(t) && t > 0 && t < 360000)
          out[`${p.id}:${n}`] = t
      }
    return out
  } catch {
    return {}
  }
}
export const JIGSAW_BESTS_KEY = 'lab_jigsaw_bests_v1'

/** a picture of your own: read only if it is an image, and not absurdly large */
export const OWN_PICTURE_LIMIT = 25 * 1024 * 1024
export const OWN_PICTURE_SIDE = 2048

export const clock = (s: number) => {
  const t = Math.floor(s)
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`
}
