/**
 * Island bridges: each circle is an island with a number on it, and the islands are to be joined by
 * bridges running straight across or down — never diagonally, never through another island, never
 * crossing another bridge, at most two between any pair — so that every island has exactly as many
 * bridges as its number and every island can be reached from every other.
 *
 * Pure, so bridges.test.ts can make and solve hundreds of puzzles without a page. The grid is n by
 * n; a cell is row * n + column.
 */
import { rng } from './bricks'

export const SIZES = [7, 9, 11] as const
export type Size = (typeof SIZES)[number]
export type Island = { r: number; c: number; need: number }
/** a pair of islands that can see each other along a row or a column, and the cells between them */
export type Edge = { a: number; b: number; across: boolean; between: number[] }
export type Puzzle = {
  n: number
  islands: Island[]
  edges: Edge[]
  /** for each edge, the edges that would cross it */
  crossing: number[][]
  /** bridges on each edge in the one answer */
  answer: number[]
}

/** every pair of islands with nothing between them in a row or a column */
export function edgesOf(n: number, islands: Island[]): Edge[] {
  const at = new Map(islands.map((s, k) => [s.r * n + s.c, k]))
  const out: Edge[] = []
  islands.forEach((s, a) => {
    for (const across of [true, false]) {
      const between: number[] = []
      for (let d = 1; ; d++) {
        const r = across ? s.r : s.r + d
        const c = across ? s.c + d : s.c
        if (r >= n || c >= n) break
        const b = at.get(r * n + c)
        if (b !== undefined) {
          if (between.length) out.push({ a, b, across, between })
          break
        }
        between.push(r * n + c)
      }
    }
  })
  return out
}
/** an across edge and a down edge cross where they share a cell between their islands */
export function crossingsOf(edges: Edge[]): number[][] {
  return edges.map((e, i) =>
    edges
      .map((f, j) =>
        f.across !== e.across && f.between.some((x) => e.between.includes(x)) ? j : -1,
      )
      .filter((j) => j >= 0 && j !== i),
  )
}

/* --------------------------------------------------------------------------- solving */

/**
 * How many answers a set of islands allows, stopping at `limit`. Each edge holds a range of bridge
 * counts, narrowed by every island's number and by the edges that would cross it until nothing more
 * follows; then the narrowest open edge is tried at each count. A group already finished on its own
 * cannot be part of an answer unless it is all of the islands.
 */
export function count(
  n: number,
  islands: Island[],
  limit = 2,
  budget = 200_000,
): { found: number; answer: number[]; spent: boolean; looked: number } {
  const edges = edgesOf(n, islands)
  const crossing = crossingsOf(edges)
  const touching: number[][] = islands.map(() => [])
  edges.forEach((e, k) => {
    touching[e.a].push(k)
    touching[e.b].push(k)
  })
  const m = edges.length
  let found = 0
  let answer: number[] = []
  let looked = 0

  const narrow = (lo: Int8Array, hi: Int8Array): boolean => {
    for (let changed = true; changed; ) {
      changed = false
      for (let k = 0; k < m; k++)
        if (hi[k] > 0 && crossing[k].some((j) => lo[j] > 0)) {
          if (lo[k] > 0) return false
          hi[k] = 0
          changed = true
        }
      for (let i = 0; i < islands.length; i++) {
        const need = islands[i].need
        let sumLo = 0
        let sumHi = 0
        for (const k of touching[i]) {
          sumLo += lo[k]
          sumHi += hi[k]
        }
        for (const k of touching[i]) {
          const l = Math.max(lo[k], need - (sumHi - hi[k]))
          const h = Math.min(hi[k], need - (sumLo - lo[k]))
          if (l > h) return false
          if (l !== lo[k] || h !== hi[k]) {
            sumLo += l - lo[k]
            sumHi += h - hi[k]
            lo[k] = l
            hi[k] = h
            changed = true
          }
        }
      }
    }
    return true
  }
  /** islands joined through the edges passing a test, as a group number for each */
  const groups = (use: (k: number) => boolean): number[] => {
    const g = islands.map((_, i) => i)
    const find = (x: number): number => (g[x] === x ? x : (g[x] = find(g[x])))
    edges.forEach((e, k) => {
      if (use(k)) g[find(e.a)] = find(e.b)
    })
    return islands.map((_, i) => find(i))
  }
  /**
   * No group finished on its own — every island in it full by the bridges already certain — unless it
   * is all of them. Also asking that the islands could still reach one another was tried: on sixty
   * made puzzles it saved not one position, and this check alone already refuses a split answer
   */
  const linked = (lo: Int8Array, hi: Int8Array): boolean => {
    const sure = groups((k) => lo[k] > 0)
    const open = new Set<number>()
    islands.forEach((_, i) => {
      if (touching[i].some((k) => lo[k] !== hi[k])) open.add(sure[i])
    })
    const all = new Set(sure)
    if (all.size === 1) return true
    for (const x of all) if (!open.has(x)) return false
    return true
  }
  const go = (lo: Int8Array, hi: Int8Array) => {
    if (found >= limit || ++looked > budget) return
    if (!narrow(lo, hi) || !linked(lo, hi)) return
    let pick = -1
    let width = 9
    for (let k = 0; k < m; k++) {
      const w = hi[k] - lo[k]
      if (w > 0 && w < width) {
        width = w
        pick = k
      }
    }
    if (pick < 0) {
      found++
      answer = [...lo]
      return
    }
    for (let v = hi[pick]; v >= lo[pick]; v--) {
      const l = lo.slice()
      const h = hi.slice()
      l[pick] = v
      h[pick] = v
      go(l, h)
    }
  }
  go(
    new Int8Array(m),
    Int8Array.from(edges, (e) => Math.min(2, islands[e.a].need, islands[e.b].need)),
  )
  return { found, answer, spent: looked > budget, looked }
}

/* --------------------------------------------------------------------------- making */

/** how many islands each size of grid is grown to */
export const ISLANDS: Record<Size, number> = { 7: 11, 9: 17, 11: 25 }

/**
 * Islands grown one at a time from a first one: a new island two or more cells away along a clear
 * row or column, joined to the one it grew from by one or two bridges; then a few more bridges laid
 * between islands that already see each other. Every island's number is its count of bridges.
 */
function grow(n: number, want: number, rand: () => number): Island[] | null {
  const isle = new Map<number, number>()
  const used = new Set<number>()
  const spots: { r: number; c: number }[] = []
  const links: [number, number, number][] = []
  const first = { r: Math.floor(rand() * n), c: Math.floor(rand() * n) }
  spots.push(first)
  isle.set(first.r * n + first.c, 0)
  const free = (r: number, c: number) =>
    r >= 0 && c >= 0 && r < n && c < n && !isle.has(r * n + c) && !used.has(r * n + c)
  const DIRS = [
    [0, 1],
    [0, -1],
    [1, 0],
    [-1, 0],
  ]
  for (let tries = 0; spots.length < want && tries < want * 60; tries++) {
    const from = Math.floor(rand() * spots.length)
    const [dr, dc] = DIRS[Math.floor(rand() * 4)]
    const d = 2 + Math.floor(rand() * Math.min(4, n - 2))
    const s = spots[from]
    const path: number[] = []
    let ok = true
    for (let k = 1; k < d && ok; k++) {
      if (!free(s.r + dr * k, s.c + dc * k)) ok = false
      path.push((s.r + dr * k) * n + s.c + dc * k)
    }
    const r = s.r + dr * d
    const c = s.c + dc * d
    if (!ok || !free(r, c)) continue
    // no island right beside another: they would read as one
    if (
      DIRS.some(
        ([a, b]) =>
          isle.has((r + a) * n + c + b) && r + a >= 0 && r + a < n && c + b >= 0 && c + b < n,
      )
    )
      continue
    for (const x of path) used.add(x)
    isle.set(r * n + c, spots.length)
    links.push([from, spots.length, rand() < 0.4 ? 2 : 1])
    spots.push({ r, c })
  }
  if (spots.length < want) return null
  const need = spots.map(() => 0)
  for (const [a, b, k] of links) {
    need[a] += k
    need[b] += k
  }
  // a few more bridges between islands that already see each other, where nothing is in the way
  const islands = spots.map((s, i) => ({ ...s, need: need[i] }))
  const edges = edgesOf(n, islands)
  const has = new Set(links.map(([a, b]) => `${Math.min(a, b)},${Math.max(a, b)}`))
  for (const e of edges) {
    if (has.has(`${Math.min(e.a, e.b)},${Math.max(e.a, e.b)}`)) continue
    if (e.between.some((x) => used.has(x)) || rand() > 0.35) continue
    const k = rand() < 0.3 ? 2 : 1
    for (const x of e.between) used.add(x)
    islands[e.a].need += k
    islands[e.b].need += k
  }
  return islands
}

/** a puzzle with exactly one answer, the same for everyone given the same seed */
export function make(n: Size, seed: number): Puzzle {
  const rand = rng(seed)
  for (let i = 0; i < 8; i++) rand()
  for (;;) {
    const islands = grow(n, ISLANDS[n], rand)
    if (!islands) continue
    const r = count(n, islands, 2)
    if (r.found !== 1 || r.spent) continue
    const edges = edgesOf(n, islands)
    return { n, islands, edges, crossing: crossingsOf(edges), answer: r.answer }
  }
}

/* --------------------------------------------------------------------------- playing */

/** the bridges on each island, by the player's bridges on each edge */
export const tally = (p: Puzzle, laid: number[]) =>
  p.islands.map((_, i) =>
    p.edges.reduce((s, e, k) => s + (e.a === i || e.b === i ? laid[k] : 0), 0),
  )
/** the edge between two islands, if they see each other */
export const edgeBetween = (p: Puzzle, a: number, b: number) =>
  p.edges.findIndex((e) => (e.a === a && e.b === b) || (e.a === b && e.b === a))
/** an edge's next count, 0 → 1 → 2 → 0, or null where a bridge already laid would be crossed */
export function cycle(p: Puzzle, laid: number[], k: number): number[] | null {
  const next = (laid[k] + 1) % 3
  if (next && p.crossing[k].some((j) => laid[j] > 0)) return null
  const out = [...laid]
  out[k] = next
  return out
}
/** finished: every island's number met, and every island reachable from every other */
export function solved(p: Puzzle, laid: number[]): boolean {
  const t = tally(p, laid)
  if (t.some((x, i) => x !== p.islands[i].need)) return false
  const seen = new Set([0])
  const todo = [0]
  while (todo.length) {
    const i = todo.pop()!
    p.edges.forEach((e, k) => {
      if (!laid[k] || (e.a !== i && e.b !== i)) return
      const o = e.a === i ? e.b : e.a
      if (!seen.has(o)) {
        seen.add(o)
        todo.push(o)
      }
    })
  }
  return seen.size === p.islands.length
}
/** the neighbour an island sees in a direction, or -1 */
export function neighbour(p: Puzzle, i: number, dr: number, dc: number): number {
  const s = p.islands[i]
  let best = -1
  let bd = Infinity
  p.islands.forEach((o, j) => {
    const d = dr ? (o.r - s.r) * dr : (o.c - s.c) * dc
    const inLine = dr ? o.c === s.c : o.r === s.r
    if (j !== i && inLine && d > 0 && d < bd) {
      bd = d
      best = j
    }
  })
  return best
}
/** the edge to lay from the answer next, for a hint: one where the player is short, or wrong */
export function hint(p: Puzzle, laid: number[]): number {
  const wrong = laid.findIndex((v, k) => v > p.answer[k])
  if (wrong >= 0) return wrong
  return laid.findIndex((v, k) => v < p.answer[k])
}

/* --------------------------------------------------------------------------- what is kept */

export const BRIDGES_KEY = 'lab_bridges_v1'
export const LOOKS = ['sea', 'map', 'night'] as const
export type Best = { day: number; size: number; seconds: number }
export type Saved = {
  size: Size
  look: (typeof LOOKS)[number]
  /** mark islands with too many bridges as you go */
  clashes: boolean
  bests: Best[]
  solvedCount: number
}
export const EMPTY: Saved = { size: 7, look: 'sea', clashes: true, bests: [], solvedCount: 0 }
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
          size: pick(SIZES, b.size, EMPTY.size),
          seconds: whole(b.seconds),
        }))
        .filter((b) => b.day > 0 && b.seconds > 0)
        .slice(-42)
    : []
  return {
    size: pick(SIZES, o.size, EMPTY.size),
    look: pick(LOOKS, o.look, EMPTY.look),
    clashes: typeof o.clashes === 'boolean' ? o.clashes : EMPTY.clashes,
    bests,
    solvedCount: whole(o.solvedCount),
  }
}
/** keep a finish if it beats what is there for that day and size, and only the last fortnight */
export function keepBest(bests: Best[], b: Best, today: number): Best[] {
  const same = (x: Best) => x.day === b.day && x.size === b.size
  const old = bests.find(same)
  const kept = !old || b.seconds < old.seconds ? [...bests.filter((x) => !same(x)), b] : bests
  return kept.filter((x) => x.day > today - 14)
}
