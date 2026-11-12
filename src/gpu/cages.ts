/**
 * Cages: fill an n × n square so each row and each column holds 1 to n once, and the numbers in
 * each outlined cage make its target with its sum — added, multiplied, the difference of two, or
 * one divided by the other. A cage of one cell is simply given.
 *
 * Pure, so cages.test.ts can make and solve a few hundred puzzles without a page. Cells are
 * numbered row by row; a puzzle is the cages, and the answer it was made from, which is the only
 * one — every puzzle is checked to have exactly one.
 */
import { keepBestOf } from './daily'
import { rng } from './bricks'

export const SIZES = [4, 5, 6] as const
export type Size = (typeof SIZES)[number]
export type Op = '+' | '−' | '×' | '÷' | '='
export type Cage = { cells: number[]; op: Op; target: number }
export type Puzzle = { n: number; cages: Cage[]; answer: number[] }

const shuffle = <T>(xs: T[], rand: () => number) => {
  for (let i = xs.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1))
    ;[xs[i], xs[j]] = [xs[j], xs[i]]
  }
  return xs
}

/** a random Latin square: a shifted pattern with its rows, columns and numbers shuffled */
export function latin(n: number, rand: () => number): number[] {
  const rows = shuffle([...Array(n).keys()], rand)
  const cols = shuffle([...Array(n).keys()], rand)
  const syms = shuffle(
    [...Array(n).keys()].map((x) => x + 1),
    rand,
  )
  const out = new Array<number>(n * n)
  for (let r = 0; r < n; r++)
    for (let c = 0; c < n; c++) out[r * n + c] = syms[(rows[r] + cols[c]) % n]
  return out
}

/** split the square into connected cages of one to four cells, mostly two and three */
function carve(n: number, rand: () => number): number[][] {
  const owner = new Array<number>(n * n).fill(-1)
  const cages: number[][] = []
  const near = (i: number) =>
    [i - n, i + n, i % n ? i - 1 : -1, (i + 1) % n ? i + 1 : -1].filter((j) => j >= 0 && j < n * n)
  for (const start of shuffle([...Array(n * n).keys()], rand)) {
    if (owner[start] >= 0) continue
    const r = rand()
    const want = r < 0.08 ? 1 : r < 0.5 ? 2 : r < 0.88 ? 3 : 4
    const cage = [start]
    owner[start] = cages.length
    while (cage.length < want) {
      const free = cage.flatMap(near).filter((j) => owner[j] < 0)
      if (!free.length) break
      const j = free[Math.floor(rand() * free.length)]
      owner[j] = cages.length
      cage.push(j)
    }
    cages.push(cage.sort((a, b) => a - b))
  }
  // a cage that could not grow is left as a single given number; more than a few of those make
  // the puzzle a fill-in, so all but about one in three rows join a neighbouring cage that has room
  const keep = Math.ceil(n / 3)
  let singles = cages.filter((c) => c.length === 1).length
  for (const one of shuffle(
    cages.filter((c) => c.length === 1),
    rand,
  )) {
    if (singles <= keep) break
    // a cage beside it with room, or failing that another single beside it to pair with
    const beside = (c: number[]) => c !== one && near(one[0]).some((j) => c.includes(j))
    const host =
      cages.find((c) => c.length > 1 && c.length < 4 && beside(c)) ??
      cages.find((c) => c.length === 1 && beside(c))
    if (!host) continue
    if (host.length === 1) singles--
    host.push(one[0])
    host.sort((a, b) => a - b)
    cages.splice(cages.indexOf(one), 1)
    singles--
  }
  return cages
}

/** an operation for a cage, from what its cells hold */
function label(vals: number[], rand: () => number): { op: Op; target: number } {
  if (vals.length === 1) return { op: '=', target: vals[0] }
  const sum = vals.reduce((a, b) => a + b, 0)
  const prod = vals.reduce((a, b) => a * b, 1)
  if (vals.length === 2) {
    const [a, b] = [Math.max(...vals), Math.min(...vals)]
    const options: { op: Op; target: number }[] = [
      { op: '+', target: sum },
      { op: '×', target: prod },
      { op: '−', target: a - b },
    ]
    if (a % b === 0) options.push({ op: '÷', target: a / b }, { op: '÷', target: a / b })
    return options[Math.floor(rand() * options.length)]
  }
  return rand() < 0.5 ? { op: '+', target: sum } : { op: '×', target: prod }
}

/** whether a cage's numbers, all filled in, make its target */
export function fits(c: Cage, vals: number[]): boolean {
  if (c.op === '=') return vals[0] === c.target
  if (c.op === '+') return vals.reduce((a, b) => a + b, 0) === c.target
  if (c.op === '×') return vals.reduce((a, b) => a * b, 1) === c.target
  const [a, b] = [Math.max(...vals), Math.min(...vals)]
  return c.op === '−' ? a - b === c.target : a === b * c.target
}

/**
 * Every way to fill each cage that makes its target and repeats no number within a row or column
 * of the cage itself.
 */
function fillings(n: number, c: Cage): number[][] {
  const out: number[][] = []
  const k = c.cells.length
  const vals = new Array<number>(k)
  const go = (i: number) => {
    if (i === k) {
      if (fits(c, vals)) out.push(vals.slice())
      return
    }
    for (let v = 1; v <= n; v++) {
      let ok = true
      for (let j = 0; j < i; j++) {
        const same =
          Math.floor(c.cells[j] / n) === Math.floor(c.cells[i] / n) ||
          c.cells[j] % n === c.cells[i] % n
        if (same && vals[j] === v) ok = false
      }
      if (!ok) continue
      vals[i] = v
      go(i + 1)
    }
  }
  go(0)
  return out
}

/**
 * How many answers a set of cages has, counting no further than `limit`: cage by cage, always the
 * one with the fewest fillings still possible, against what the rows and columns already hold.
 */
export function count(n: number, cages: Cage[], limit = 2, grid?: number[]): number {
  const opts = cages.map((c) => fillings(n, c))
  const cells = grid ? grid.slice() : new Array<number>(n * n).fill(0)
  const rowHas = Array.from({ length: n }, () => new Array<boolean>(n + 1).fill(false))
  const colHas = Array.from({ length: n }, () => new Array<boolean>(n + 1).fill(false))
  const done = new Array<boolean>(cages.length).fill(false)
  const fitsNow = (ci: number, f: number[]) =>
    cages[ci].cells.every((cell, j) => {
      const v = f[j]
      if (cells[cell]) return cells[cell] === v
      return !rowHas[Math.floor(cell / n)][v] && !colHas[cell % n][v]
    })
  // a partly given grid: those numbers are already in their rows and columns
  if (grid)
    grid.forEach((v, i) => {
      if (v) {
        rowHas[Math.floor(i / n)][v] = true
        colHas[i % n][v] = true
      }
    })
  let found = 0
  const go = () => {
    let pick = -1
    let fs: number[][] = []
    for (let ci = 0; ci < cages.length; ci++) {
      if (done[ci]) continue
      const ok = opts[ci].filter((f) => fitsNow(ci, f))
      if (pick < 0 || ok.length < fs.length) {
        pick = ci
        fs = ok
        if (!ok.length) return
      }
    }
    if (pick < 0) {
      found++
      return
    }
    done[pick] = true
    const before = cages[pick].cells.map((cell) => cells[cell])
    for (const f of fs) {
      // cells already given keep their number; only the empty ones are placed and taken back
      cages[pick].cells.forEach((cell, j) => {
        if (!before[j]) {
          cells[cell] = f[j]
          rowHas[Math.floor(cell / n)][f[j]] = true
          colHas[cell % n][f[j]] = true
        }
      })
      go()
      cages[pick].cells.forEach((cell, j) => {
        if (!before[j]) {
          rowHas[Math.floor(cell / n)][f[j]] = false
          colHas[cell % n][f[j]] = false
          cells[cell] = 0
        }
      })
      if (found >= limit) break
    }
    done[pick] = false
  }
  go()
  return found
}

/**
 * A puzzle with exactly one answer: a Latin square, carved into cages and labelled, and labelled
 * again or carved again until the cages allow nothing else.
 */
export function make(n: number, seed: number): Puzzle {
  const rand = rng(seed)
  for (;;) {
    const answer = latin(n, rand)
    const shapes = carve(n, rand)
    // now and then a single is boxed in by full cages and cannot join any: carve again
    if (shapes.filter((c) => c.length === 1).length > Math.ceil(n / 3)) continue
    for (let tries = 0; tries < 12; tries++) {
      const cages = shapes.map((cells) => ({
        cells,
        ...label(
          cells.map((i) => answer[i]),
          rand,
        ),
      }))
      if (count(n, cages, 2) === 1) return { n, cages, answer }
    }
  }
}

/* --------------------------------------------------------------------------- playing */

/** cells that repeat a number in their row or column, or sit in a full cage that misses */
export function mistakes(p: Puzzle, grid: number[]): Set<number> {
  const n = p.n
  const out = new Set<number>()
  for (let i = 0; i < n * n; i++) {
    if (!grid[i]) continue
    for (let j = 0; j < n * n; j++)
      if (
        j !== i &&
        grid[j] === grid[i] &&
        (Math.floor(j / n) === Math.floor(i / n) || j % n === i % n)
      )
        out.add(i)
  }
  for (const c of p.cages) {
    const vals = c.cells.map((i) => grid[i])
    if (vals.every(Boolean) && !fits(c, vals)) c.cells.forEach((i) => out.add(i))
  }
  return out
}
export const solved = (p: Puzzle, grid: number[]) => grid.every((v, i) => v === p.answer[i])
/** the cage a cell is in, and whether the cell is where its label is written (its first cell) */
export const cageOf = (p: Puzzle, i: number) => p.cages.findIndex((c) => c.cells.includes(i))
export const labelText = (c: Cage) => (c.op === '=' ? String(c.target) : `${c.target}${c.op}`)

/* --------------------------------------------------------------------------- what is kept */

export const CAGES_KEY = 'lab_cages_v1'
export const LOOKS = ['paper', 'slate', 'sun'] as const
export type Best = { day: number; size: number; seconds: number }
export type Saved = {
  size: Size
  look: (typeof LOOKS)[number]
  /** mark repeats and cages that miss as you go */
  clashes: boolean
  bests: Best[]
  solvedCount: number
}
export const EMPTY: Saved = { size: 5, look: 'paper', clashes: true, bests: [], solvedCount: 0 }
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
          size: pick(SIZES, b.size, 5 as Size),
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
export const keepBest = (bests: Best[], b: Best, today: number): Best[] =>
  keepBestOf(
    bests,
    b,
    today,
    (x, y) => x.day === y.day && x.size === y.size,
    (x, old) => x.seconds < old.seconds,
  )
