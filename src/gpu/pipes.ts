/**
 * Pipes: a square of pipe tiles, each turned out of true. Turn them until water from the source
 * reaches every tile, with no pipe left open to nothing. The pipes were laid as a single tree from
 * the source, so a finished board has every tile on it and no loops; any arrangement that does
 * that counts, not only the one it was made from.
 *
 * Pure, so pipes.test.ts can make and solve a few thousand boards without a page. A tile is the
 * set of sides it opens on, as bits: north 1, east 2, south 4, west 8.
 */
import { rng } from './bricks'

export const N = 1
export const E = 2
export const S = 4
export const W = 8
const SIDES = [N, E, S, W] as const
const STEP: Record<number, [number, number]> = {
  [N]: [0, -1],
  [E]: [1, 0],
  [S]: [0, 1],
  [W]: [-1, 0],
}
const OPPOSITE: Record<number, number> = { [N]: S, [E]: W, [S]: N, [W]: E }

/** a tile turned a quarter clockwise k times: north becomes east, east south, and so on */
export const turn = (t: number, k = 1) => {
  const q = ((k % 4) + 4) % 4
  return ((t << q) | (t >> (4 - q))) & 15
}
export const SIZES = [5, 7, 9] as const
export type Size = (typeof SIZES)[number]
export type Board = {
  n: number
  wrap: boolean
  /** the tiles as laid, and as they are now */
  solution: number[]
  tiles: number[]
  source: number
}

/** the square next to `i` through `side`, or -1 off the edge of a board that does not wrap */
export function across(n: number, wrap: boolean, i: number, side: number): number {
  const [dx, dy] = STEP[side]
  let x = (i % n) + dx
  let y = Math.floor(i / n) + dy
  if (wrap) {
    x = (x + n) % n
    y = (y + n) % n
  } else if (x < 0 || y < 0 || x >= n || y >= n) return -1
  return y * n + x
}

/**
 * Lay a board: a random tree over every square, grown from the source in the middle, then every
 * tile turned at random. Growing by random walk rather than depth-first gives the bushier trees,
 * with more forks and fewer long corridors, that make the better puzzles.
 */
export function make(seed: number, n: number, wrap = false): Board {
  const rand = rng(seed)
  const source = Math.floor(n / 2) * n + Math.floor(n / 2)
  const solution = new Array<number>(n * n).fill(0)
  const inTree = new Uint8Array(n * n)
  inTree[source] = 1
  // Wilson's algorithm: loop-erased random walks, which give every spanning tree an equal chance
  const next = new Int32Array(n * n).fill(-1)
  for (let start = 0; start < n * n; start++) {
    let u = start
    while (!inTree[u]) {
      const options = SIDES.filter((s) => across(n, wrap, u, s) >= 0)
      const side = options[Math.floor(rand() * options.length)]
      next[u] = side
      u = across(n, wrap, u, side)
    }
    u = start
    while (!inTree[u]) {
      const side = next[u]
      const v = across(n, wrap, u, side)
      solution[u] |= side
      solution[v] |= OPPOSITE[side]
      inTree[u] = 1
      u = v
    }
  }
  // turn every tile out of true; a tile that turns into itself (a straight, a cross) is fine
  let tiles = solution.map((t) => turn(t, Math.floor(rand() * 4)))
  // never hand out a board that is solved already
  if (solved({ n, wrap, solution, tiles, source }))
    tiles = tiles.map((t, i) => (i === 0 ? turn(t, 1) : t))
  return { n, wrap, solution, tiles, source }
}

/** every square the water reaches from the source, through sides that open onto each other */
export function reached(b: Board): Set<number> {
  const seen = new Set<number>([b.source])
  const stack = [b.source]
  while (stack.length) {
    const i = stack.pop()!
    for (const side of SIDES) {
      if (!(b.tiles[i] & side)) continue
      const j = across(b.n, b.wrap, i, side)
      if (j < 0 || seen.has(j) || !(b.tiles[j] & OPPOSITE[side])) continue
      seen.add(j)
      stack.push(j)
    }
  }
  return seen
}
/** the pipe ends that open onto nothing: the edge, or a tile that does not open back */
export function openEnds(b: Board): number {
  let open = 0
  for (let i = 0; i < b.tiles.length; i++)
    for (const side of SIDES) {
      if (!(b.tiles[i] & side)) continue
      const j = across(b.n, b.wrap, i, side)
      if (j < 0 || !(b.tiles[j] & OPPOSITE[side])) open++
    }
  return open
}
export const solved = (b: Board) => openEnds(b) === 0 && reached(b).size === b.tiles.length

/** turn one tile, clockwise by default */
export function rotate(b: Board, i: number, k = 1): Board {
  if (i < 0 || i >= b.tiles.length) return b
  return { ...b, tiles: b.tiles.map((t, j) => (j === i ? turn(t, k) : t)) }
}
/**
 * Par: the fewest turns that bring every tile back to how it was laid, counting a turn either way
 * as one and a tile that looks the same turned (a straight half round) as already there.
 */
export function par(b: Board): number {
  let total = 0
  for (let i = 0; i < b.tiles.length; i++) {
    let best = 4
    for (let k = 0; k < 4; k++)
      if (turn(b.tiles[i], k) === b.solution[i]) best = Math.min(best, k, 4 - k)
    total += best === 4 ? 0 : best
  }
  return total
}

/* --------------------------------------------------------------------------- what is kept */

export const PIPES_KEY = 'lab_pipes_v1'
export const LOOKS = ['water', 'lava', 'neon'] as const
export type Best = { day: number; size: number; wrap: boolean; seconds: number; turns: number }
export type Saved = {
  size: Size
  wrap: boolean
  look: (typeof LOOKS)[number]
  /** your best on each day's board, by size and wrapping; only the last fortnight is kept */
  bests: Best[]
  solvedCount: number
}
export const EMPTY: Saved = { size: 7, wrap: false, look: 'water', bests: [], solvedCount: 0 }
const whole = (v: unknown) =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 && v < 1e9 ? v : 0
export function readSaved(text: string | null): Saved {
  let v: unknown
  try {
    v = JSON.parse(text ?? 'null')
  } catch {
    return EMPTY
  }
  if (typeof v !== 'object' || !v || Array.isArray(v)) return EMPTY
  const o = v as Record<string, unknown>
  const pick = <T>(list: readonly T[], x: unknown, d: T): T =>
    list.includes(x as T) ? (x as T) : d
  const bests = Array.isArray(o.bests)
    ? o.bests
        .filter((b): b is Record<string, unknown> => typeof b === 'object' && b !== null)
        .map((b) => ({
          day: whole(b.day),
          size: pick(SIZES, b.size, 7 as Size),
          wrap: b.wrap === true,
          seconds: whole(b.seconds),
          turns: whole(b.turns),
        }))
        .filter((b) => b.day > 0 && b.seconds > 0)
        .slice(-42)
    : []
  return {
    size: pick(SIZES, o.size, EMPTY.size),
    wrap: typeof o.wrap === 'boolean' ? o.wrap : EMPTY.wrap,
    look: pick(LOOKS, o.look, EMPTY.look),
    bests,
    solvedCount: whole(o.solvedCount),
  }
}
/** keep a finish if it beats what is there for that day and board, and only recent days */
export function keepBest(bests: Best[], b: Best, today: number): Best[] {
  const same = (x: Best) => x.day === b.day && x.size === b.size && x.wrap === b.wrap
  const old = bests.find(same)
  const better =
    !old || b.seconds < old.seconds || (b.seconds === old.seconds && b.turns < old.turns)
  const kept = better ? [...bests.filter((x) => !same(x)), b] : bests
  return kept.filter((x) => x.day > today - 14)
}
