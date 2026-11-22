import { describe, expect, it } from 'vitest'
import { rng } from './bricks'
import {
  EMPTY,
  SIZES,
  around,
  count,
  counts,
  hint,
  keepBest,
  make,
  paired,
  readSaved,
  solved,
  touching,
  type Mark,
  type Puzzle,
  type Saved,
} from './tents'

/**
 * Every set of cells that could hold tents, tried one by one, each checked against the rules from
 * scratch — numbers, no touching, and a tent for each tree found by trying every way of handing
 * the tents out: nothing shared with the solver but the rules
 */
function brute(n: number, trees: Set<number>, rows: number[], cols: number[]): number {
  const free = Array.from({ length: n * n }, (_, i) => i).filter((i) => !trees.has(i))
  const near = (a: number, b: number) =>
    Math.abs(Math.floor(a / n) - Math.floor(b / n)) + Math.abs((a % n) - (b % n)) === 1
  const treeList = [...trees]
  const want = rows.reduce((s, v) => s + v, 0)
  let found = 0
  const pick: number[] = []
  const handOut = (k: number, used: Set<number>): boolean =>
    k === treeList.length ||
    pick.some((t) => {
      if (used.has(t) || !near(t, treeList[k])) return false
      used.add(t)
      const ok = handOut(k + 1, used)
      used.delete(t)
      return ok
    })
  const rec = (k: number) => {
    if (pick.length > want) return
    if (k === free.length) {
      if (pick.length !== want) return
      for (let r = 0; r < n; r++)
        if (pick.filter((t) => Math.floor(t / n) === r).length !== rows[r]) return
      for (let c = 0; c < n; c++) if (pick.filter((t) => t % n === c).length !== cols[c]) return
      for (const a of pick)
        for (const b of pick)
          if (
            a < b &&
            Math.abs(Math.floor(a / n) - Math.floor(b / n)) <= 1 &&
            Math.abs((a % n) - (b % n)) <= 1
          )
            return
      if (handOut(0, new Set())) found++
      return
    }
    pick.push(free[k])
    rec(k + 1)
    pick.pop()
    rec(k + 1)
  }
  rec(0)
  return found
}

describe('the solver', () => {
  it('counts the same answers as trying every set of cells, on hundreds of small fields', () => {
    const r = rng(777)
    for (let i = 0; i < 8; i++) r()
    const n = 4
    const seen = [0, 0, 0]
    for (let t = 0; t < 300; t++) {
      // trees at random, and numbers from tents laid at random beside some of them, so a field
      // has an answer whenever the tents happen to suit the trees
      const trees = new Set<number>()
      while (trees.size < 2 + Math.floor(r() * 3)) trees.add(Math.floor(r() * n * n))
      const tents = new Set<number>()
      for (const tree of trees) {
        const opts = [
          tree - n,
          tree + n,
          tree % n ? tree - 1 : -1,
          tree % n < n - 1 ? tree + 1 : -1,
        ].filter((x) => x >= 0 && x < n * n && !trees.has(x) && !tents.has(x))
        if (opts.length) tents.add(opts[Math.floor(r() * opts.length)])
      }
      const rows = Array.from(
        { length: n },
        (_, k) => [...tents].filter((x) => Math.floor(x / n) === k).length,
      )
      const cols = Array.from({ length: n }, (_, k) => [...tents].filter((x) => x % n === k).length)
      const b = brute(n, trees, rows, cols)
      seen[Math.min(2, b)]++
      expect(count(n, trees, rows, cols, 9).found).toBe(Math.min(b, 9))
    }
    // the fields themselves are worth asking about: some with no answer, some one, some more
    expect(seen.every((x) => x > 0)).toBe(true)
  }, 60_000)
  it('pairs every tree with a tent of its own, or says it cannot', () => {
    // two trees side by side above two tents: each has its own
    expect(paired(4, new Set([0, 1]), new Set([4, 5]))).toBe(true)
    // two trees whose only tent is the one between them
    expect(paired(4, new Set([0, 2]), new Set([1, 7]))).toBe(false)
    // a tent that must move along to make room: the first tree takes the corner, and the second,
    // whose only tent that is, takes it back by handing the first the other one
    expect(paired(4, new Set([1, 4]), new Set([0, 2]))).toBe(true)
    // as many tents as trees, or no
    expect(paired(4, new Set([0]), new Set([1, 4]))).toBe(false)
  })
})

describe('a made field', () => {
  it('has one answer, no tents touching, a tent beside each tree, and the same field for a seed', () => {
    for (const n of SIZES)
      for (let s = 1; s <= 6; s++) {
        const p = make(n, s * 101)
        expect(count(n, p.trees, p.rows, p.cols, 2).found).toBe(1)
        expect(p.tents.size).toBe(p.trees.size)
        expect(paired(n, p.trees, p.tents)).toBe(true)
        for (const t of p.tents) expect(around(n, t).some((a) => p.tents.has(a))).toBe(false)
        expect(p.rows.reduce((a, b) => a + b, 0)).toBe(p.tents.size)
        expect(make(n, s * 101).trees).toEqual(p.trees)
      }
    expect(make(8, 1).trees).not.toEqual(make(8, 2).trees)
  })
})

describe('playing', () => {
  const p: Puzzle = make(6, 5)
  const answer = (): Mark[] => Array.from({ length: 36 }, (_, i) => (p.tents.has(i) ? 1 : 0))
  it('is finished by the answer and not by anything short of it or over it, grass or no grass', () => {
    expect(solved(p, answer())).toBe(true)
    const withGrass = answer().map((m) => (m ? m : 2)) as Mark[]
    expect(solved(p, withGrass)).toBe(true)
    const short = answer()
    short[[...p.tents][0]] = 0
    expect(solved(p, short)).toBe(false)
    // nor by the answer and a tent more
    const over = answer()
    over[Array.from({ length: 36 }, (_, i) => i).find((i) => !p.tents.has(i) && !p.trees.has(i))!] =
      1
    expect(solved(p, over)).toBe(false)
  })
  it('marks tents that touch, even at a corner, and counts each row and column', () => {
    const marks = new Array<Mark>(36).fill(0)
    marks[0] = 1
    marks[7] = 1
    marks[20] = 1
    expect([...touching(p, marks)].sort((a, b) => a - b)).toEqual([0, 7])
    expect(counts(p, marks).rows.slice(0, 4)).toEqual([1, 1, 0, 1])
    expect(counts(p, marks).cols.slice(0, 3)).toEqual([1, 1, 1])
  })
  it('hints a wrong tent first, then one still missing', () => {
    const marks = answer()
    const wrong = Array.from({ length: 36 }, (_, i) => i).find(
      (i) => !p.tents.has(i) && !p.trees.has(i),
    )!
    marks[wrong] = 1
    expect(hint(p, marks)).toBe(wrong)
    const missing = answer()
    const gone = [...p.tents][1]
    missing[gone] = 0
    expect(hint(p, missing)).toBe(gone)
    expect(hint(p, answer())).toBe(-1)
  })
})

describe('what is kept', () => {
  it('round-trips every field that is not a default', () => {
    const s: Saved = {
      size: 10,
      look: 'night',
      clashes: false,
      autoGrass: true,
      bests: [{ day: 20400, size: 8, seconds: 95 }],
      solvedCount: 4,
    }
    for (const k of Object.keys(s) as (keyof Saved)[]) expect(s[k]).not.toEqual(EMPTY[k])
    expect(readSaved(JSON.stringify(s))).toEqual(s)
    expect(readSaved('{"size":12,"look":"gold","clashes":"no","autoGrass":1}')).toEqual(EMPTY)
  })
  it('keeps the better time for a day and size, and only the last fortnight', () => {
    const old = [
      { day: 100, size: 6, seconds: 90 },
      { day: 80, size: 6, seconds: 50 },
    ]
    expect(keepBest(old, { day: 100, size: 6, seconds: 60 }, 100)).toEqual([
      { day: 100, size: 6, seconds: 60 },
    ])
    expect(keepBest(old, { day: 100, size: 6, seconds: 120 }, 100)).toEqual([old[0]])
  })
})
