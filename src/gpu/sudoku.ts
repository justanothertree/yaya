/**
 * Sudoku: fill the grid so every row, column and three-by-three box holds 1 to 9 once each. Pure —
 * making puzzles, proving each has one answer, grading them by the reasoning they need, and the
 * hint — so sudoku.test.ts can make and solve hundreds without a page.
 *
 * Cells are 0–80, row by row; 0 is an empty cell. A candidate set is a 9-bit mask, bit d−1 for
 * digit d.
 */
import { rng } from './bricks'
import { whole } from './kept'

export type Grid = number[]
const ALL = 0x1ff
const bit = (d: number) => 1 << (d - 1)
const count = (m: number) => {
  let n = 0
  while (m) {
    m &= m - 1
    n++
  }
  return n
}
const only = (m: number) => Math.log2(m) + 1
export const rowOf = (i: number) => Math.floor(i / 9)
export const colOf = (i: number) => i % 9
export const boxOf = (i: number) => Math.floor(rowOf(i) / 3) * 3 + Math.floor(colOf(i) / 3)
/** the 27 houses: nine rows, nine columns, nine boxes, as lists of cells */
export const HOUSES: number[][] = [
  ...Array.from({ length: 9 }, (_, r) => Array.from({ length: 9 }, (_, c) => r * 9 + c)),
  ...Array.from({ length: 9 }, (_, c) => Array.from({ length: 9 }, (_, r) => r * 9 + c)),
  ...Array.from({ length: 9 }, (_, b) =>
    Array.from(
      { length: 9 },
      (_, k) => (Math.floor(b / 3) * 3 + Math.floor(k / 3)) * 9 + (b % 3) * 3 + (k % 3),
    ),
  ),
]
/** every cell that shares a house with cell i */
export const PEERS: number[][] = Array.from({ length: 81 }, (_, i) =>
  [...new Set(HOUSES.filter((h) => h.includes(i)).flat())].filter((j) => j !== i),
)

/** the cells that break a rule: a digit appearing twice in a house */
export function clashes(g: Grid): Set<number> {
  const bad = new Set<number>()
  for (const h of HOUSES) {
    const seen = new Map<number, number>()
    for (const i of h) {
      if (!g[i]) continue
      if (seen.has(g[i])) {
        bad.add(i)
        bad.add(seen.get(g[i])!)
      } else seen.set(g[i], i)
    }
  }
  return bad
}

/** how many answers a grid has, stopping at `cap` — the uniqueness check */
export function answers(g: Grid, cap = 2): number {
  const cells = g.slice()
  const cand = (i: number) => {
    let m = ALL
    for (const j of PEERS[i]) if (cells[j]) m &= ~bit(cells[j])
    return m
  }
  let found = 0
  const go = (): boolean => {
    // the empty cell with fewest candidates first
    let best = -1
    let bm = 0
    let bn = 10
    for (let i = 0; i < 81; i++) {
      if (cells[i]) continue
      const m = cand(i)
      const n = count(m)
      if (n === 0) return false
      if (n < bn) {
        bn = n
        bm = m
        best = i
        if (n === 1) break
      }
    }
    if (best < 0) return ++found >= cap
    for (let d = 1; d <= 9; d++)
      if (bm & bit(d)) {
        cells[best] = d
        if (go()) return true
        cells[best] = 0
      }
    return false
  }
  go()
  return found
}

/** a whole solved grid, at random */
function full(rand: () => number): Grid {
  const g = Array(81).fill(0)
  const go = (i: number): boolean => {
    if (i === 81) return true
    const digits = [1, 2, 3, 4, 5, 6, 7, 8, 9].sort(() => rand() - 0.5)
    for (const d of digits) {
      if (PEERS[i].some((j) => g[j] === d)) continue
      g[i] = d
      if (go(i + 1)) return true
    }
    g[i] = 0
    return false
  }
  go(0)
  return g
}

/* ---------------------------------------------------------------------------- reasoning */

export type Step = { cell: number; digit: number; why: string; level: number }
/**
 * Solve the way a person does, a step at a time, using the easiest reasoning that works, and
 * report the hardest needed. Level 1: a cell with one candidate left, or a digit with one place
 * left in a house. Level 2: those, plus a digit confined to one row or column inside a box (and
 * the reverse), and two cells in a house sharing the same two candidates. Level 3: also two
 * digits confined to the same two cells, and the X-wing. A puzzle these do not finish is graded 4.
 */
export function reason(g: Grid): { solved: boolean; level: number; steps: Step[] } {
  const cells = g.slice()
  const cand = Array<number>(81).fill(0)
  for (let i = 0; i < 81; i++) {
    if (cells[i]) continue
    let m = ALL
    for (const j of PEERS[i]) if (cells[j]) m &= ~bit(cells[j])
    cand[i] = m
  }
  const place = (i: number, d: number) => {
    cells[i] = d
    cand[i] = 0
    for (const j of PEERS[i]) cand[j] &= ~bit(d)
  }
  const steps: Step[] = []
  let level = 1
  const names = ['row', 'column', 'box']
  for (let guard = 0; guard < 500; guard++) {
    if (cells.every(Boolean)) return { solved: true, level, steps }
    let moved = false
    // a cell with one candidate
    for (let i = 0; i < 81 && !moved; i++)
      if (!cells[i] && count(cand[i]) === 1) {
        const d = only(cand[i])
        steps.push({
          cell: i,
          digit: d,
          why: `only ${d} fits here — every other digit is already in its row, column or box`,
          level: 1,
        })
        place(i, d)
        moved = true
      }
    // a digit with one place in a house
    for (let h = 0; h < 27 && !moved; h++)
      for (let d = 1; d <= 9 && !moved; d++) {
        const spots = HOUSES[h].filter((i) => !cells[i] && cand[i] & bit(d))
        if (spots.length === 1 && !HOUSES[h].some((i) => cells[i] === d)) {
          steps.push({
            cell: spots[0],
            digit: d,
            why: `this is the only place left for ${d} in its ${names[Math.floor(h / 9)]}`,
            level: 1,
          })
          place(spots[0], d)
          moved = true
        }
      }
    if (moved) continue
    // level 2: eliminations, then go round again for the singles they open up
    let cut = false
    for (let b = 18; b < 27; b++)
      for (let d = 1; d <= 9; d++) {
        const spots = HOUSES[b].filter((i) => !cells[i] && cand[i] & bit(d))
        if (spots.length < 2) continue
        for (const line of [rowOf, colOf]) {
          const k = line(spots[0])
          if (!spots.every((i) => line(i) === k)) continue
          // pointing: within this box the digit is on one line, so the rest of that line cannot have it
          for (let j = 0; j < 81; j++)
            if (line(j) === k && boxOf(j) !== b - 18 && !cells[j] && cand[j] & bit(d)) {
              cand[j] &= ~bit(d)
              cut = true
            }
        }
      }
    for (let h = 0; h < 18; h++)
      for (let d = 1; d <= 9; d++) {
        const spots = HOUSES[h].filter((i) => !cells[i] && cand[i] & bit(d))
        if (spots.length < 2 || !spots.every((i) => boxOf(i) === boxOf(spots[0]))) continue
        // claiming: within this line the digit is in one box, so the rest of that box cannot have it
        for (const j of HOUSES[18 + boxOf(spots[0])])
          if (!HOUSES[h].includes(j) && !cells[j] && cand[j] & bit(d)) {
            cand[j] &= ~bit(d)
            cut = true
          }
      }
    for (const h of HOUSES) {
      const pairs = h.filter((i) => !cells[i] && count(cand[i]) === 2)
      for (let a = 0; a < pairs.length; a++)
        for (let c = a + 1; c < pairs.length; c++)
          if (cand[pairs[a]] === cand[pairs[c]])
            for (const j of h)
              if (j !== pairs[a] && j !== pairs[c] && !cells[j] && cand[j] & cand[pairs[a]]) {
                cand[j] &= ~cand[pairs[a]]
                cut = true
              }
    }
    if (cut) {
      level = Math.max(level, 2)
      continue
    }
    // level 3: hidden pairs and the X-wing
    for (const h of HOUSES) {
      const where = (d: number) => h.filter((i) => !cells[i] && cand[i] & bit(d))
      for (let d1 = 1; d1 <= 9; d1++)
        for (let d2 = d1 + 1; d2 <= 9; d2++) {
          const a = where(d1)
          const b = where(d2)
          if (a.length === 2 && b.length === 2 && a[0] === b[0] && a[1] === b[1]) {
            const keep = bit(d1) | bit(d2)
            for (const i of a)
              if (cand[i] & ~keep) {
                cand[i] &= keep
                cut = true
              }
          }
        }
    }
    for (let d = 1; d <= 9; d++)
      for (const [lines, cross] of [
        [rowOf, colOf],
        [colOf, rowOf],
      ] as [(i: number) => number, (i: number) => number][]) {
        const spots = (k: number) =>
          Array.from({ length: 81 }, (_, i) => i).filter(
            (i) => lines(i) === k && !cells[i] && cand[i] & bit(d),
          )
        for (let k1 = 0; k1 < 9; k1++)
          for (let k2 = k1 + 1; k2 < 9; k2++) {
            const a = spots(k1)
            const b = spots(k2)
            if (
              a.length !== 2 ||
              b.length !== 2 ||
              cross(a[0]) !== cross(b[0]) ||
              cross(a[1]) !== cross(b[1])
            )
              continue
            const xs = [cross(a[0]), cross(a[1])]
            for (let j = 0; j < 81; j++)
              if (
                xs.includes(cross(j)) &&
                lines(j) !== k1 &&
                lines(j) !== k2 &&
                !cells[j] &&
                cand[j] & bit(d)
              ) {
                cand[j] &= ~bit(d)
                cut = true
              }
          }
      }
    if (cut) {
      level = Math.max(level, 3)
      continue
    }
    return { solved: false, level: 4, steps }
  }
  return { solved: false, level: 4, steps }
}

/* ---------------------------------------------------------------------------- making puzzles */

export const LEVELS = ['gentle', 'steady', 'tricky'] as const
export type Level = (typeof LEVELS)[number]
const WANT: Record<Level, number> = { gentle: 1, steady: 2, tricky: 3 }

/**
 * A puzzle with one answer that needs exactly the reasoning its level names: clues are taken away
 * one at a time, in a random order, keeping each removal only while the answer stays unique and
 * the reasoning needed stays at or under the level; a puzzle that ends up easier than asked is
 * made again.
 */
export function make(level: Level, seed: number): { puzzle: Grid; answer: Grid; level: number } {
  const rand = rng(seed)
  const want = WANT[level]
  let best: { puzzle: Grid; answer: Grid; level: number } | null = null
  // ⚠️ up to thirty tries, keeping the hardest that is still within the level: puzzles that need
  // the third kind of reasoning are rare when clues are taken away at random. Each removal asks
  // the cheap question first — is the answer still unique — and only then reasons it through;
  // the other way round, a tricky puzzle took 6.8 s to make, and 213 ms this way
  for (let tries = 0; tries < 30; tries++) {
    const answer = full(rand)
    const puzzle = answer.slice()
    const order = Array.from({ length: 81 }, (_, i) => i).sort(() => rand() - 0.5)
    for (const i of order) {
      const keep = puzzle[i]
      puzzle[i] = 0
      // the answer count first: it is the cheap check, and late in the digging it fails most often
      if (answers(puzzle) !== 1) {
        puzzle[i] = keep
        continue
      }
      const r = reason(puzzle)
      if (!r.solved || r.level > want) puzzle[i] = keep
    }
    const got = reason(puzzle).level
    if (!best || got > best.level) best = { puzzle, answer, level: got }
    if (got === want) break
  }
  return best!
}

/** the next cell reasoning can fill in this grid, and why — the hint */
export function hint(g: Grid): Step | null {
  return reason(g).steps[0] ?? null
}

/* ---------------------------------------------------------------------------- what is kept */

export const SUDOKU_KEY = 'lab_sudoku_v1'
export const THEMES = ['paper', 'night', 'mint'] as const
export const PENALTY = 30
export type Saved = {
  level: Level
  theme: (typeof THEMES)[number]
  /** show clashing digits in red as soon as they are written */
  clashes: boolean
  best: Partial<Record<Level, number>>
  today: { day: number; seconds: number } | null
  solved: number
}
export const EMPTY: Saved = {
  level: 'steady',
  theme: 'paper',
  clashes: true,
  best: {},
  today: null,
  solved: 0,
}
export function readSaved(text: string | null): Saved {
  let v: unknown
  try {
    v = JSON.parse(text ?? 'null')
  } catch {
    return EMPTY
  }
  if (typeof v !== 'object' || !v || Array.isArray(v)) return EMPTY
  const o = v as Record<string, unknown>
  const best: Saved['best'] = {}
  const b = (typeof o.best === 'object' && o.best ? o.best : {}) as Record<string, unknown>
  for (const l of LEVELS) if (whole(b[l], 1e7)) best[l] = whole(b[l], 1e7)
  const t = (typeof o.today === 'object' && o.today ? o.today : null) as Record<
    string,
    unknown
  > | null
  return {
    level: LEVELS.includes(o.level as Level) ? (o.level as Level) : EMPTY.level,
    theme: THEMES.includes(o.theme as Saved['theme']) ? (o.theme as Saved['theme']) : EMPTY.theme,
    clashes: typeof o.clashes === 'boolean' ? o.clashes : EMPTY.clashes,
    best,
    today:
      t && whole(t.day, 2 ** 32) && whole(t.seconds, 1e7)
        ? { day: whole(t.day, 2 ** 32), seconds: whole(t.seconds, 1e7) }
        : null,
    solved: whole(o.solved, 1e7),
  }
}
