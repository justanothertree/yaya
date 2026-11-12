import { describe, expect, it } from 'vitest'
import { rng } from './bricks'
import {
  EMPTY,
  count,
  fits,
  keepBest,
  latin,
  make,
  mistakes,
  readSaved,
  solved,
  type Cage,
  type Saved,
} from './cages'

const isLatin = (n: number, g: number[]) => {
  for (let k = 0; k < n; k++) {
    const row = new Set(g.slice(k * n, k * n + n))
    const col = new Set(Array.from({ length: n }, (_, r) => g[r * n + k]))
    if (row.size !== n || col.size !== n) return false
  }
  return g.every((v) => v >= 1 && v <= n)
}
/** every Latin square of a size, by brute force: 576 of them at four */
function allLatin(n: number): number[][] {
  const out: number[][] = []
  const g = new Array<number>(n * n).fill(0)
  const go = (i: number) => {
    if (i === n * n) {
      out.push(g.slice())
      return
    }
    const r = Math.floor(i / n)
    const c = i % n
    for (let v = 1; v <= n; v++) {
      let ok = true
      for (let k = 0; k < c; k++) if (g[r * n + k] === v) ok = false
      for (let k = 0; k < r; k++) if (g[k * n + c] === v) ok = false
      if (!ok) continue
      g[i] = v
      go(i + 1)
    }
    g[i] = 0
  }
  go(0)
  return out
}

describe('a puzzle', () => {
  it('is made from a Latin square', () => {
    for (const n of [4, 5, 6])
      for (let s = 1; s < 20; s++) expect(isLatin(n, latin(n, rng(s)))).toBe(true)
    expect(latin(5, rng(3))).not.toEqual(latin(5, rng(4)))
  })
  it('is carved into connected cages of one to four cells, covering every cell once', () => {
    for (const n of [4, 5, 6])
      for (let s = 1; s <= 25; s++) {
        const p = make(n, s)
        const all = p.cages.flatMap((c) => c.cells).sort((a, b) => a - b)
        expect(all).toEqual([...Array(n * n).keys()])
        for (const c of p.cages) {
          expect(c.cells.length).toBeGreaterThanOrEqual(1)
          expect(c.cells.length).toBeLessThanOrEqual(4)
          // connected: every cell reaches every other through its cage-mates
          const seen = new Set([c.cells[0]])
          const stack = [c.cells[0]]
          while (stack.length) {
            const i = stack.pop()!
            for (const j of c.cells)
              if (
                !seen.has(j) &&
                Math.abs(Math.floor(i / n) - Math.floor(j / n)) + Math.abs((i % n) - (j % n)) === 1
              ) {
                seen.add(j)
                stack.push(j)
              }
          }
          expect(seen.size).toBe(c.cells.length)
        }
        // a few cages are single given numbers, never most of them
        expect(p.cages.filter((c) => c.cells.length === 1).length).toBeLessThanOrEqual(
          Math.ceil(n / 3),
        )
      }
  })
  it('labels each cage with what its own answer makes', () => {
    for (const n of [4, 5, 6])
      for (let s = 1; s <= 25; s++) {
        const p = make(n, s * 3)
        for (const c of p.cages) {
          expect(
            fits(
              c,
              c.cells.map((i) => p.answer[i]),
            ),
          ).toBe(true)
          expect(Number.isInteger(c.target)).toBe(true)
          if (c.op === '−' || c.op === '÷') expect(c.cells).toHaveLength(2)
          if (c.op === '=') expect(c.cells).toHaveLength(1)
        }
      }
  })
  it('has exactly one answer, and the same seed makes the same puzzle', () => {
    for (const n of [4, 5, 6])
      for (let s = 1; s <= 15; s++) {
        const p = make(n, s * 11)
        expect(count(n, p.cages, 5)).toBe(1)
        expect(isLatin(n, p.answer)).toBe(true)
      }
    expect(make(6, 42)).toEqual(make(6, 42))
  })
})

describe('a cage', () => {
  it('takes a difference or a quotient either way round', () => {
    const two = (op: Cage['op'], target: number): Cage => ({ cells: [0, 1], op, target })
    expect(fits(two('−', 2), [5, 3])).toBe(true)
    expect(fits(two('−', 2), [3, 5])).toBe(true)
    expect(fits(two('−', 2), [3, 4])).toBe(false)
    expect(fits(two('÷', 3), [6, 2])).toBe(true)
    expect(fits(two('÷', 3), [2, 6])).toBe(true)
    expect(fits(two('÷', 3), [3, 6])).toBe(false)
    expect(fits({ cells: [0, 1, 2], op: '×', target: 24 }, [2, 3, 4])).toBe(true)
    expect(fits({ cells: [0, 1, 2], op: '+', target: 9 }, [2, 3, 4])).toBe(true)
    expect(fits({ cells: [0], op: '=', target: 3 }, [3])).toBe(true)
  })
})

describe('the counter', () => {
  it('agrees with trying every Latin square there is, unique or not', () => {
    const squares = allLatin(4)
    expect(squares).toHaveLength(576)
    const brute = (cages: Cage[]) =>
      squares.filter((g) =>
        cages.every((c) =>
          fits(
            c,
            c.cells.map((i) => g[i]),
          ),
        ),
      ).length
    for (let s = 1; s <= 30; s++) {
      const p = make(4, s * 13)
      // loosen it: every cage becomes a sum, which usually lets several answers through
      const loose = p.cages.map((c) =>
        c.cells.length === 1
          ? c
          : { ...c, op: '+' as const, target: c.cells.reduce((t, i) => t + p.answer[i], 0) },
      )
      expect(count(4, p.cages, 1000)).toBe(brute(p.cages))
      expect(count(4, loose, 1000)).toBe(brute(loose))
    }
    // sums alone are nearly always enough on four; dominoes that each make five are not
    const fives: Cage[] = [0, 2, 4, 6, 8, 10, 12, 14].map((i) => ({
      cells: [i, i + 1],
      op: '+',
      target: 5,
    }))
    const many = brute(fives)
    expect(many).toBeGreaterThan(10)
    expect(count(4, fives, 10_000)).toBe(many)
    // and it stops at its limit
    expect(count(4, fives, 2)).toBe(2)
  })
  it('counts from a part-filled grid, and stops at its limit', () => {
    const p = make(5, 9)
    const half = p.answer.map((v, i) => (i % 2 ? v : 0))
    expect(count(5, p.cages, 2, half)).toBe(1)
    const wrong = half.slice()
    wrong[1] = (p.answer[1] % 5) + 1
    expect(count(5, p.cages, 2, wrong)).toBe(0)
    const loose = p.cages.map((c) => ({
      cells: c.cells,
      op: '+' as const,
      target: c.cells.reduce((t, i) => t + p.answer[i], 0),
    }))
    expect(count(5, loose, 3)).toBeLessThanOrEqual(3)
  })
})

describe('playing', () => {
  it('marks repeats in a row or column, and a full cage that misses', () => {
    const p = make(4, 5)
    expect(mistakes(p, p.answer).size).toBe(0)
    expect(solved(p, p.answer)).toBe(true)
    const g = new Array(16).fill(0)
    g[0] = 2
    g[3] = 2
    expect([...mistakes(p, g)].sort()).toEqual([0, 3])
    const down = new Array(16).fill(0)
    down[1] = 3
    down[13] = 3
    expect([...mistakes(p, down)].sort((a, b) => a - b)).toEqual([1, 13])
    // a cage filled with a wrong but repeat-free set
    const c = p.cages.find((x) => x.cells.length === 2 && x.op !== '=')!
    const bad = new Array(16).fill(0)
    const vals = c.cells.map((i) => p.answer[i])
    const alt = [1, 2, 3, 4]
      .flatMap((a) => [1, 2, 3, 4].map((b) => [a, b]))
      .find(([a, b]) => a !== b && !fits(c, [a, b]) && (a !== vals[0] || b !== vals[1]))!
    c.cells.forEach((i, j) => (bad[i] = alt[j]))
    expect(mistakes(p, bad)).toEqual(new Set(c.cells))
  })
})

describe('what is kept', () => {
  it('round-trips every field that is not a default', () => {
    const s: Saved = {
      size: 6,
      look: 'sun',
      clashes: false,
      bests: [{ day: 20400, size: 4, seconds: 75 }],
      solvedCount: 12,
    }
    for (const k of Object.keys(s) as (keyof Saved)[]) expect(s[k]).not.toEqual(EMPTY[k])
    expect(readSaved(JSON.stringify(s))).toEqual(s)
    expect(readSaved('{"size":9,"clashes":"no"}')).toEqual(EMPTY)
  })
  it('keeps the better time for a day, and only the last fortnight', () => {
    let b = keepBest([], { day: 100, size: 5, seconds: 90 }, 100)
    b = keepBest(b, { day: 100, size: 5, seconds: 120 }, 100)
    expect(b).toEqual([{ day: 100, size: 5, seconds: 90 }])
    b = keepBest(b, { day: 100, size: 5, seconds: 60 }, 100)
    b = keepBest(b, { day: 100, size: 6, seconds: 200 }, 100)
    expect(b).toHaveLength(2)
    expect(keepBest(b, { day: 120, size: 4, seconds: 30 }, 120)).toEqual([
      { day: 120, size: 4, seconds: 30 },
    ])
  })
})
