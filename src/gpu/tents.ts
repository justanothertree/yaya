/**
 * Tents: a field of trees, and a tent to pitch beside each one — directly above, below, left or
 * right of its own tree, one tent to a tree — with no two tents touching, not even at a corner. The
 * numbers beside each row and under each column say how many tents are in it.
 *
 * Pure, so tents.test.ts can make and solve hundreds of fields without a page. A cell is
 * row * n + column.
 */
import { rng } from './bricks'

export const SIZES = [6, 8, 10] as const
export type Size = (typeof SIZES)[number]
export type Puzzle = {
  n: number
  trees: Set<number>
  rows: number[]
  cols: number[]
  /** the one answer: where the tents go */
  tents: Set<number>
}

const sides = (n: number, i: number) => {
  const r = Math.floor(i / n)
  const c = i % n
  const out: number[] = []
  if (r > 0) out.push(i - n)
  if (r < n - 1) out.push(i + n)
  if (c > 0) out.push(i - 1)
  if (c < n - 1) out.push(i + 1)
  return out
}
/** the eight cells round one */
export const around = (n: number, i: number) => {
  const r = Math.floor(i / n)
  const c = i % n
  const out: number[] = []
  for (let dr = -1; dr <= 1; dr++)
    for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue
      const rr = r + dr
      const cc = c + dc
      if (rr >= 0 && cc >= 0 && rr < n && cc < n) out.push(rr * n + cc)
    }
  return out
}

/**
 * Can every tree have a tent of its own beside it: a matching of trees to tents, found by trying
 * to give each tree a tent and moving others along to make room — the usual augmenting path
 */
export function paired(n: number, trees: Set<number>, tents: Set<number>): boolean {
  if (trees.size !== tents.size) return false
  const owner = new Map<number, number>()
  const give = (tree: number, seen: Set<number>): boolean => {
    for (const t of sides(n, tree)) {
      if (!tents.has(t) || seen.has(t)) continue
      seen.add(t)
      const other = owner.get(t)
      if (other === undefined || give(other, seen)) {
        owner.set(t, tree)
        return true
      }
    }
    return false
  }
  for (const tree of trees) if (!give(tree, new Set())) return false
  return true
}

/**
 * How many ways tents can be pitched for these trees and numbers, stopping at `limit`. The cells
 * that could hold a tent — beside a tree and not a tree — are decided in order, never letting two
 * tents touch, nor a row or column go over its number or be left unable to reach it; a finished
 * pitch must also give every tree a tent of its own. Refusing early a tree left with no empty side
 * was tried as well, and made no difference a clock could see: the numbers already prune that
 */
export function count(
  n: number,
  trees: Set<number>,
  rows: number[],
  cols: number[],
  limit = 2,
): { found: number; tents: Set<number> } {
  const cand = [...new Set([...trees].flatMap((t) => sides(n, t)))]
    .filter((i) => !trees.has(i))
    .sort((a, b) => a - b)
  const at = new Map(cand.map((c, k) => [c, k]))
  // what is still to come in each row and column, from each place in the order on
  const rowLeft = cand.map((_, k) =>
    cand
      .slice(k)
      .reduce(
        (m, c) => (m.set(Math.floor(c / n), (m.get(Math.floor(c / n)) ?? 0) + 1), m),
        new Map<number, number>(),
      ),
  )
  const colLeft = cand.map((_, k) =>
    cand
      .slice(k)
      .reduce((m, c) => (m.set(c % n, (m.get(c % n) ?? 0) + 1), m), new Map<number, number>()),
  )
  const inRow = [...rows].fill(0)
  const inCol = [...cols].fill(0)
  /** for each candidate, 1 tent, 0 not yet decided, -1 decided empty */
  const state = new Int8Array(cand.length)
  let found = 0
  let answer = new Set<number>()
  const go = (k: number) => {
    if (found >= limit) return
    // every row and column must still be able to reach its number from what is left
    const rl = rowLeft[k] ?? new Map()
    const cl = colLeft[k] ?? new Map()
    for (let r = 0; r < n; r++)
      if (inRow[r] > rows[r] || inRow[r] + (rl.get(r) ?? 0) < rows[r]) return
    for (let c = 0; c < n; c++)
      if (inCol[c] > cols[c] || inCol[c] + (cl.get(c) ?? 0) < cols[c]) return
    if (k === cand.length) {
      const tents = new Set(cand.filter((_, j) => state[j] === 1))
      if (paired(n, trees, tents)) {
        found++
        answer = tents
      }
      return
    }
    const cell = cand[k]
    const r = Math.floor(cell / n)
    const c = cell % n
    // a tent here, if nothing round it already holds one
    if (
      around(n, cell).every((a) => {
        const j = at.get(a)
        return j === undefined || state[j] !== 1
      })
    ) {
      state[k] = 1
      inRow[r]++
      inCol[c]++
      go(k + 1)
      inRow[r]--
      inCol[c]--
    }
    // or none
    state[k] = -1
    go(k + 1)
    state[k] = 0
  }
  go(0)
  return { found, tents: answer }
}

/**
 * A field with exactly one answer: tents scattered so none touch, a tree put beside each on a side
 * no tent or tree is using, and the numbers counted from them — kept only when the numbers and
 * trees allow nothing else.
 */
export function make(n: Size, seed: number): Puzzle {
  const rand = rng(seed)
  for (let i = 0; i < 8; i++) rand()
  const want = Math.round(n * n * 0.2)
  for (;;) {
    const tents = new Set<number>()
    const trees = new Set<number>()
    const order = Array.from({ length: n * n }, (_, i) => i)
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1))
      ;[order[i], order[j]] = [order[j], order[i]]
    }
    for (const i of order) {
      if (tents.size >= want) break
      if (tents.has(i) || trees.has(i)) continue
      if (around(n, i).some((a) => tents.has(a))) continue
      const free = sides(n, i).filter((s) => !tents.has(s) && !trees.has(s))
      if (!free.length) continue
      tents.add(i)
      trees.add(free[Math.floor(rand() * free.length)])
    }
    if (tents.size < want * 0.85) continue
    const rows = Array.from(
      { length: n },
      (_, r) => [...tents].filter((t) => Math.floor(t / n) === r).length,
    )
    const cols = Array.from({ length: n }, (_, c) => [...tents].filter((t) => t % n === c).length)
    if (count(n, trees, rows, cols, 2).found === 1) return { n, trees, rows, cols, tents }
  }
}

/* --------------------------------------------------------------------------- playing */

/** what the player has put in a cell: nothing, a tent, or grass (sure there is no tent) */
export type Mark = 0 | 1 | 2
/** tents touching another tent, at a side or a corner */
export function touching(p: Puzzle, marks: Mark[]): Set<number> {
  const out = new Set<number>()
  marks.forEach((m, i) => {
    if (m === 1 && around(p.n, i).some((a) => marks[a] === 1)) out.add(i)
  })
  return out
}
/** each row's and column's tents so far */
export function counts(p: Puzzle, marks: Mark[]) {
  const rows = new Array(p.n).fill(0)
  const cols = new Array(p.n).fill(0)
  marks.forEach((m, i) => {
    if (m === 1) {
      rows[Math.floor(i / p.n)]++
      cols[i % p.n]++
    }
  })
  return { rows, cols }
}
/** finished: the tents exactly where the one answer has them */
export const solved = (p: Puzzle, marks: Mark[]) =>
  marks.every((m, i) => (m === 1) === p.tents.has(i))
/** a cell to show for a hint: a tent wrongly placed first, then a tent still missing */
export function hint(p: Puzzle, marks: Mark[]): number {
  const wrong = marks.findIndex((m, i) => m === 1 && !p.tents.has(i))
  if (wrong >= 0) return wrong
  return [...p.tents].sort((a, b) => a - b).find((t) => marks[t] !== 1) ?? -1
}

/* --------------------------------------------------------------------------- what is kept */

export const TENTS_KEY = 'lab_tents_v1'
export const LOOKS = ['park', 'beach', 'night'] as const
export type Best = { day: number; size: number; seconds: number }
export type Saved = {
  size: Size
  look: (typeof LOOKS)[number]
  /** mark touching tents and rows or columns over their number as you go */
  clashes: boolean
  /** a tent placed puts grass round it where no tent can go */
  autoGrass: boolean
  bests: Best[]
  solvedCount: number
}
export const EMPTY: Saved = {
  size: 6,
  look: 'park',
  clashes: true,
  autoGrass: false,
  bests: [],
  solvedCount: 0,
}
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
    autoGrass: typeof o.autoGrass === 'boolean' ? o.autoGrass : EMPTY.autoGrass,
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
