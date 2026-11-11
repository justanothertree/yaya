/**
 * Tile pairs: tiles stacked in layers, cleared two at a time. A pair must match, and both tiles
 * must be free — nothing on top of them, and nothing beside them on at least one side. Clear the
 * board as fast as you can. Pure, so tiles.test.ts can lay and clear thousands of boards.
 *
 * ⚠️ EVERY DEAL CAN BE CLEARED. A random deal often cannot: the last pair can end up one on top
 * of the other. So a deal is made by clearing an empty layout first — take two places that are free
 * together, give them a pair, and repeat until it is empty — and clearing those pairs in that same
 * order always works. A shuffle is made the same way over the tiles that are left.
 *
 * A place is in half-tile units, so a tile can sit across two below it: x and y count half widths
 * and half heights, and a tile covers x..x+2 and y..y+2 on its layer z.
 */
import { rng } from './bricks'

export type Place = { x: number; y: number; z: number }
export type Layout = { id: string; name: string; places: Place[] }

/** a rectangle of tiles on a layer, starting at a half-unit corner */
const block = (z: number, x0: number, y0: number, w: number, h: number): Place[] => {
  const out: Place[] = []
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) out.push({ x: x0 + i * 2, y: y0 + j * 2, z })
  return out
}
export const LAYOUTS: Layout[] = [
  {
    id: 'pyramid',
    name: 'Pyramid',
    // 8 × 6, then 6 × 4, 4 × 2 and 2 × 1 stacked on it: 48 + 24 + 8 + 2 = 82 tiles
    places: [
      ...block(0, 0, 0, 8, 6),
      ...block(1, 2, 2, 6, 4),
      ...block(2, 4, 4, 4, 2),
      ...block(3, 6, 5, 2, 1),
    ],
  },
  {
    id: 'arches',
    name: 'Arches',
    places: [
      ...block(0, 0, 0, 10, 2),
      ...block(0, 0, 4, 2, 2),
      ...block(0, 16, 4, 2, 2),
      ...block(0, 0, 8, 10, 2),
      ...block(1, 2, 1, 8, 1),
      ...block(1, 2, 9, 8, 1),
      ...block(1, 5, 5, 4, 1),
      ...block(2, 7, 5, 2, 1),
    ],
  },
  {
    id: 'twin',
    name: 'Twin towers',
    places: [
      ...block(0, 0, 0, 4, 6),
      ...block(0, 10, 0, 4, 6),
      ...block(0, 8, 4, 1, 4),
      ...block(1, 1, 1, 3, 5),
      ...block(1, 11, 1, 3, 5),
      ...block(2, 2, 2, 2, 4),
      ...block(2, 12, 2, 2, 4),
      ...block(3, 3, 5, 1, 1),
      ...block(3, 13, 5, 1, 1),
    ],
  },
]

/** whether place b lies over place a: one layer up and overlapping it */
const covers = (b: Place, a: Place) =>
  b.z === a.z + 1 && Math.abs(b.x - a.x) < 2 && Math.abs(b.y - a.y) < 2
/** whether b sits against a's left or right edge on the same layer */
const leftOf = (b: Place, a: Place) => b.z === a.z && b.x === a.x - 2 && Math.abs(b.y - a.y) < 2
const rightOf = (b: Place, a: Place) => b.z === a.z && b.x === a.x + 2 && Math.abs(b.y - a.y) < 2

/** whether place i is free among the places still filled */
export function free(places: Place[], filled: boolean[], i: number): boolean {
  if (!filled[i]) return false
  const a = places[i]
  let left = false
  let right = false
  for (let j = 0; j < places.length; j++) {
    if (j === i || !filled[j]) continue
    const b = places[j]
    if (covers(b, a)) return false
    if (leftOf(b, a)) left = true
    if (rightOf(b, a)) right = true
  }
  return !(left && right)
}

/** 18 kinds of tile, four of each in a full set: a shape in a colour */
export const SHAPES = ['●', '▲', '■', '◆', '★', '♥'] as const
export const KINDS = 18
export const shapeOf = (k: number) => SHAPES[k % 6]
export const colourOf = (k: number) => Math.floor(k / 6) // 0, 1 or 2

/**
 * Deal kinds onto the filled places so they can all be cleared, by clearing first and dealing
 * after: pick two places free at the same moment, give them one pair, take them away, again until
 * none are left. Pairs of kinds come from `pool`, two of a kind at a time. Returns null if the layout
 * jams with places left (it can, with an odd shape), and the caller tries again.
 */
function clearFirst(
  places: Place[],
  filled: boolean[],
  pool: number[],
  rand: () => number,
): { kind: number[]; order: [number, number][] } | null {
  const kind = Array<number>(places.length).fill(-1)
  const order: [number, number][] = []
  const left = filled.slice()
  const pairs = pool.slice()
  for (let i = pairs.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[pairs[i], pairs[j]] = [pairs[j], pairs[i]]
  }
  let k = 0
  while (left.some(Boolean)) {
    // both from the tiles free at this moment: a pair is only ever taken when both are free
    // together, and a second tile chosen after the first had gone could be one the first covered
    const open = left.map((_, i) => i).filter((i) => free(places, left, i))
    if (open.length < 2) return null
    const a = open.splice(Math.floor(rand() * open.length), 1)[0]
    const b = open[Math.floor(rand() * open.length)]
    left[a] = left[b] = false
    kind[a] = kind[b] = pairs[k++]
    order.push([a, b])
  }
  // clearing the board from full, a pair at a time: this IS the order it can be played in
  return { kind, order }
}

export type Board = { layout: Layout; kind: number[]; filled: boolean[] }
/** a deal, and one order of clearing it — the order it was built in */
export function dealWithPlan(
  layout: Layout,
  seed: number,
): { board: Board; plan: [number, number][] } {
  const rand = rng(seed)
  const n = layout.places.length
  // the pairs: as even a spread of kinds as the board's size allows
  const pool = Array.from({ length: n / 2 }, (_, i) => i % KINDS)
  for (let tries = 0; tries < 500; tries++) {
    const made = clearFirst(layout.places, Array(n).fill(true), pool, rand)
    if (made)
      return { board: { layout, kind: made.kind, filled: Array(n).fill(true) }, plan: made.order }
  }
  throw new Error(`layout ${layout.id} cannot be dealt`)
}
export const deal = (layout: Layout, seed: number): Board => dealWithPlan(layout, seed).board

export const pairs = (b: Board): [number, number][] => {
  const open = b.filled.map((_, i) => i).filter((i) => free(b.layout.places, b.filled, i))
  const out: [number, number][] = []
  for (let i = 0; i < open.length; i++)
    for (let j = i + 1; j < open.length; j++)
      if (b.kind[open[i]] === b.kind[open[j]]) out.push([open[i], open[j]])
  return out
}
export function take(b: Board, i: number, j: number): Board {
  if (
    i === j ||
    b.kind[i] !== b.kind[j] ||
    !free(b.layout.places, b.filled, i) ||
    !free(b.layout.places, b.filled, j)
  )
    return b
  const filled = b.filled.slice()
  filled[i] = filled[j] = false
  return { ...b, filled }
}
export const cleared = (b: Board) => !b.filled.some(Boolean)

/** deal the tiles that are left afresh, onto the same places, so that they can all still be cleared — and how */
export function shuffleWithPlan(
  b: Board,
  seed: number,
): { board: Board; plan: [number, number][] } {
  const rand = rng(seed)
  const pool: number[] = []
  const seen = new Map<number, number>()
  b.filled.forEach((f, i) => f && seen.set(b.kind[i], (seen.get(b.kind[i]) ?? 0) + 1))
  for (const [k, n] of seen) for (let c = 0; c < n / 2; c++) pool.push(k)
  for (let tries = 0; tries < 500; tries++) {
    const made = clearFirst(b.layout.places, b.filled, pool, rand)
    if (made)
      return {
        board: { ...b, kind: made.kind.map((k, i) => (b.filled[i] ? k : b.kind[i])) },
        plan: made.order,
      }
  }
  return { board: b, plan: [] }
}
export const shuffle = (b: Board, seed: number): Board => shuffleWithPlan(b, seed).board

/* ---------------------------------------------------------------------------- what is kept */

export const TILES_KEY = 'lab_tiles_v1'
export const STYLES = ['ivory', 'jade', 'night'] as const
/** each hint or shuffle adds this much to the time */
export const PENALTY = 30
export type Saved = {
  layout: string
  style: (typeof STYLES)[number]
  /** light the tiles that can be taken */
  glow: boolean
  /** best times in seconds per layout, today's best and its day */
  best: Record<string, number>
  today: { day: number; seconds: number } | null
  cleared: number
}
export const EMPTY: Saved = {
  layout: 'pyramid',
  style: 'ivory',
  glow: false,
  best: {},
  today: null,
  cleared: 0,
}
const whole = (v: unknown, max = 1e7) =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < max ? v : 0
export function readSaved(text: string | null): Saved {
  let v: unknown
  try {
    v = JSON.parse(text ?? 'null')
  } catch {
    return EMPTY
  }
  if (typeof v !== 'object' || !v || Array.isArray(v)) return EMPTY
  const o = v as Record<string, unknown>
  const ids = LAYOUTS.map((l) => l.id)
  const best: Record<string, number> = {}
  const b = (typeof o.best === 'object' && o.best ? o.best : {}) as Record<string, unknown>
  for (const id of ids) if (whole(b[id])) best[id] = whole(b[id])
  const t = (typeof o.today === 'object' && o.today ? o.today : null) as Record<
    string,
    unknown
  > | null
  return {
    layout: ids.includes(o.layout as string) ? (o.layout as string) : EMPTY.layout,
    style: STYLES.includes(o.style as Saved['style']) ? (o.style as Saved['style']) : EMPTY.style,
    glow: typeof o.glow === 'boolean' ? o.glow : EMPTY.glow,
    best,
    today:
      t && whole(t.day, 2 ** 32) && whole(t.seconds)
        ? { day: whole(t.day, 2 ** 32), seconds: whole(t.seconds) }
        : null,
    cleared: whole(o.cleared),
  }
}
