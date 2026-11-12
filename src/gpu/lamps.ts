/**
 * Lamps: a square of lamps, some lit. Press one and it switches, and so do its neighbours — the four
 * beside it, or in the cross pattern the four on its corners. Switch them all off, in as few
 * presses as you can.
 *
 * Pure, so lamps.test.ts can solve thousands of boards without a page. Pressing is adding modulo
 * two, so a board is solved by Gaussian elimination over GF(2): the presses that clear it are a
 * solution of one linear system, and when that system has more than one solution (a 5 × 5 board
 * has four) the fewest presses are found by trying every one.
 */
import { keepBestOf } from './daily'
import { rng } from './bricks'

export const SIZES = [4, 5, 6, 7] as const
export type Size = (typeof SIZES)[number]
export const PATTERNS = ['plus', 'cross'] as const
export type Pattern = (typeof PATTERNS)[number]

/** the lamps a press at `i` switches: itself and its neighbours of the pattern */
export function reach(n: number, i: number, pattern: Pattern): number[] {
  const r = Math.floor(i / n)
  const c = i % n
  const steps =
    pattern === 'plus'
      ? [
          [0, 0],
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]
      : [
          [0, 0],
          [1, 1],
          [1, -1],
          [-1, 1],
          [-1, -1],
        ]
  return steps
    .map(([dr, dc]) => [r + dr, c + dc])
    .filter(([rr, cc]) => rr >= 0 && cc >= 0 && rr < n && cc < n)
    .map(([rr, cc]) => rr * n + cc)
}
export function press(lit: boolean[], n: number, i: number, pattern: Pattern): boolean[] {
  const out = lit.slice()
  for (const j of reach(n, i, pattern)) out[j] = !out[j]
  return out
}
export const dark = (lit: boolean[]) => lit.every((x) => !x)

/**
 * The fewest presses that switch every lamp off, or null when no set of presses can. Solved as
 * A·x = b over GF(2), where column j of A is the lamps press j switches.
 */
export function solve(lit: boolean[], n: number, pattern: Pattern): number[] | null {
  const N = n * n
  // each row is an equation for one lamp: which presses switch it, then whether it is lit now
  const rows = Array.from({ length: N }, (_, lamp) => {
    const row = new Uint8Array(N + 1)
    for (let p = 0; p < N; p++) if (reach(n, p, pattern).includes(lamp)) row[p] = 1
    row[N] = lit[lamp] ? 1 : 0
    return row
  })
  const pivotCol: number[] = []
  let r = 0
  for (let c = 0; c < N && r < N; c++) {
    const p = rows.findIndex((row, k) => k >= r && row[c])
    if (p < 0) continue
    ;[rows[r], rows[p]] = [rows[p], rows[r]]
    // clearing below is enough: the solving afterwards runs from the last row up
    for (let k = r + 1; k < N; k++)
      if (rows[k][c]) for (let j = c; j <= N; j++) rows[k][j] ^= rows[r][j]
    pivotCol.push(c)
    r++
  }
  // a row of nothing that must equal one: no solution
  for (let k = r; k < N; k++) if (rows[k][N]) return null
  const free = [...Array(N).keys()].filter((c) => !pivotCol.includes(c))
  let best: number[] | null = null
  // every choice of the free presses gives one solution; the fewest presses wins
  for (let mask = 0; mask < 1 << free.length; mask++) {
    const x = new Uint8Array(N)
    free.forEach((c, k) => (x[c] = (mask >> k) & 1))
    for (let k = r - 1; k >= 0; k--) {
      const c = pivotCol[k]
      let v = rows[k][N]
      for (let j = c + 1; j < N; j++) if (rows[k][j]) v ^= x[j]
      x[c] = v
    }
    const presses = [...x.keys()].filter((j) => x[j])
    if (!best || presses.length < best.length) best = presses
  }
  return best
}

/**
 * A board: switched from dark by a scatter of presses, so it can always be cleared, and never by
 * fewer presses than it is fair to ask for.
 */
export function make(n: number, pattern: Pattern, seed: number): boolean[] {
  const rand = rng(seed)
  const want = Math.round(n * n * 0.4)
  for (;;) {
    let lit = new Array<boolean>(n * n).fill(false)
    for (let k = 0; k < want; k++) lit = press(lit, n, Math.floor(rand() * n * n), pattern)
    const s = solve(lit, n, pattern)
    if (s && s.length >= Math.round(want * 0.6)) return lit
  }
}

/* --------------------------------------------------------------------------- what is kept */

export const LAMPS_KEY = 'lab_lamps_v1'
export const LOOKS = ['bulbs', 'lanterns', 'neon'] as const
export type Best = { day: number; size: number; pattern: Pattern; presses: number; par: number }
export type Saved = {
  size: Size
  pattern: Pattern
  look: (typeof LOOKS)[number]
  bests: Best[]
  solvedCount: number
}
export const EMPTY: Saved = { size: 5, pattern: 'plus', look: 'bulbs', bests: [], solvedCount: 0 }
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
          pattern: pick(PATTERNS, b.pattern, 'plus' as Pattern),
          presses: whole(b.presses),
          par: whole(b.par),
        }))
        .filter((b) => b.day > 0 && b.presses > 0)
        .slice(-56)
    : []
  return {
    size: pick(SIZES, o.size, EMPTY.size),
    pattern: pick(PATTERNS, o.pattern, EMPTY.pattern),
    look: pick(LOOKS, o.look, EMPTY.look),
    bests,
    solvedCount: whole(o.solvedCount),
  }
}
/** keep a finish if it took fewer presses than what is there for that day and board */
export const keepBest = (bests: Best[], b: Best, today: number): Best[] =>
  keepBestOf(
    bests,
    b,
    today,
    (x, y) => x.day === y.day && x.size === y.size && x.pattern === y.pattern,
    (x, old) => x.presses < old.presses,
  )
