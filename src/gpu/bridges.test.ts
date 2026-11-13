import { describe, expect, it } from 'vitest'
import { rng } from './bricks'
import {
  EMPTY,
  ISLANDS,
  SIZES,
  count,
  crossingsOf,
  cycle,
  edgeBetween,
  edgesOf,
  hint,
  keepBest,
  make,
  neighbour,
  readSaved,
  solved,
  tally,
  type Island,
  type Puzzle,
  type Saved,
} from './bridges'

const isl = (r: number, c: number, need = 1): Island => ({ r, c, need })
/** a puzzle built by hand around a set of islands, with no answer filled in */
function by(n: number, islands: Island[]): Puzzle {
  const edges = edgesOf(n, islands)
  return { n, islands, edges, crossing: crossingsOf(edges), answer: edges.map(() => 0) }
}

/**
 * Every way of laying 0, 1 or 2 bridges on every edge, tried one by one: no narrowing, no pruning,
 * nothing shared with the solver but the list of edges.
 */
function brute(n: number, islands: Island[]): number {
  const p = by(n, islands)
  const m = p.edges.length
  let found = 0
  const laid = new Array(m).fill(0)
  const rec = (k: number) => {
    if (k === m) {
      for (let j = 0; j < m; j++) if (laid[j] && p.crossing[j].some((q) => laid[q])) return
      if (solved(p, laid)) found++
      return
    }
    for (let x = 0; x <= 2; x++) {
      laid[k] = x
      rec(k + 1)
    }
  }
  rec(0)
  return found
}

describe('the edges', () => {
  it('join only islands with nothing between them, and none side by side', () => {
    // three in a row with gaps, and one right beside the first
    const islands = [isl(0, 0), isl(0, 2), isl(0, 4), isl(1, 0)]
    const p = by(5, islands)
    expect(p.edges.map((e) => [e.a, e.b])).toEqual([
      [0, 1],
      [1, 2],
    ])
    expect(edgeBetween(p, 0, 2)).toBe(-1)
    expect(edgeBetween(p, 2, 1)).toBe(1)
  })
  it('see where an across bridge and a down bridge would cross', () => {
    // a plus: left to right through the middle, top to bottom through the middle
    const p = by(5, [isl(2, 0), isl(2, 4), isl(0, 2), isl(4, 2)])
    expect(p.edges).toHaveLength(2)
    expect(p.crossing).toEqual([[1], [0]])
    // moved a column over, the down bridge misses the across one's end
    const q = by(5, [isl(2, 0), isl(2, 2), isl(0, 3), isl(4, 3)])
    expect(q.crossing).toEqual([[], []])
  })
})

describe('the solver', () => {
  it('counts the same answers as trying every way, on four hundred small sets', () => {
    const r = rng(4242)
    for (let i = 0; i < 8; i++) r()
    let checked = 0
    const seen = [0, 0, 0]
    for (let t = 0; t < 40000 && checked < 400; t++) {
      const k = 4 + Math.floor(r() * 4)
      const used = new Set<number>()
      const islands: Island[] = []
      while (islands.length < k) {
        const c = Math.floor(r() * 25)
        if (used.has(c)) continue
        used.add(c)
        islands.push(isl(Math.floor(c / 5), c % 5, 0))
      }
      // numbers from bridges laid at random, so a set has an answer whenever it is joined up
      const p = by(5, islands)
      if (p.edges.length > 10) continue
      const laid = p.edges.map(() => 0)
      p.edges.forEach((_, j) => {
        if (!p.crossing[j].some((q) => laid[q])) laid[j] = Math.floor(r() * 3)
      })
      tally(p, laid).forEach((x, i) => (islands[i].need = x))
      if (islands.some((x) => !x.need)) continue
      checked++
      const b = brute(5, islands)
      seen[Math.min(b, 2)]++
      expect(count(5, islands, 9).found).toBe(Math.min(b, 9))
    }
    expect(checked).toBe(400)
    // and the sets themselves are worth asking: some with no answer, some with one, some with more
    expect(seen.every((x) => x > 0)).toBe(true)
  }, 60_000)
  it('says when a puzzle has two answers, and gives back the one when there is one', () => {
    // a square of four islands each wanting two: one bridge on every side, or two on each of a pair
    // of opposite sides — which leaves two halves apart — so only the ring is an answer
    const ring = [isl(0, 0, 2), isl(0, 2, 2), isl(2, 0, 2), isl(2, 2, 2)]
    const r = count(3, ring)
    expect(r.found).toBe(1)
    expect(r.answer).toEqual([1, 1, 1, 1])
    // wanting one each, the only ways are two separate pairs: none is joined up, so no answer
    expect(
      count(
        3,
        ring.map((s) => ({ ...s, need: 1 })),
      ).found,
    ).toBe(0)
    // a middle island wanting three, with one bridge to spare for each of its three neighbours
    const t = [isl(0, 0, 1), isl(0, 2, 3), isl(0, 4, 1), isl(2, 2, 1)]
    expect(count(5, t).found).toBe(1)
    // the same square wanting three each: one and two bridges by turns around the ring, starting
    // either way, so two answers — and the solver stops at two when asked to
    const three = ring.map((s) => ({ ...s, need: 3 }))
    expect(brute(3, three)).toBe(2)
    expect(count(3, three).found).toBe(2)
    expect(count(3, three, 1).found).toBe(1)
  })
})

describe('a made puzzle', () => {
  it('has one answer, numbers from one to eight, no islands side by side, and the same islands for the same seed', () => {
    for (const n of SIZES)
      for (let s = 1; s <= 6; s++) {
        const p = make(n, s * 7919)
        expect(p.islands).toHaveLength(ISLANDS[n])
        expect(solved(p, p.answer)).toBe(true)
        expect(count(n, p.islands, 2).found).toBe(1)
        for (const x of p.islands) {
          expect(x.need).toBeGreaterThanOrEqual(1)
          expect(x.need).toBeLessThanOrEqual(8)
          for (const y of p.islands)
            expect(Math.abs(x.r - y.r) + Math.abs(x.c - y.c) === 1).toBe(false)
        }
        expect(make(n, s * 7919).islands).toEqual(p.islands)
      }
    expect(make(9, 1).islands).not.toEqual(make(9, 2).islands)
  })
  it('is worked out by narrowing, with hardly a guess', () => {
    // measured on sixty made puzzles: nine positions at most; without the narrowing from above or
    // from below, 472 and 111
    let worst = 0
    for (const n of SIZES)
      for (let s = 1; s <= 10; s++)
        worst = Math.max(worst, count(n, make(n, s * 104729).islands).looked)
    expect(worst).toBeLessThanOrEqual(20)
  })
})

describe('playing', () => {
  const p = make(7, 99)
  it('lays one bridge, then two, then none, and never one across another', () => {
    const k = p.answer.findIndex((v) => v > 0)
    let laid = p.edges.map(() => 0)
    laid = cycle(p, laid, k)!
    expect(laid[k]).toBe(1)
    laid = cycle(p, laid, k)!
    expect(laid[k]).toBe(2)
    laid = cycle(p, laid, k)!
    expect(laid[k]).toBe(0)
    const plus = by(5, [isl(2, 0), isl(2, 4), isl(0, 2), isl(4, 2)])
    const one = cycle(plus, [0, 0], 0)!
    expect(cycle(plus, one, 1)).toBeNull()
    // taking a bridge away is always allowed
    expect(cycle(plus, [2, 0], 0)).toEqual([0, 0])
  })
  it('is finished only when every number is met and every island joined', () => {
    expect(solved(p, p.answer)).toBe(true)
    expect(
      solved(
        p,
        p.answer.map((v, k) => (k === 0 ? (v + 1) % 3 : v)),
      ),
    ).toBe(false)
    // two pairs, each pair's numbers met, but not joined to each other
    const pairs = by(5, [isl(0, 0), isl(0, 2), isl(3, 0), isl(3, 2)])
    const laid = pairs.edges.map((e) => (e.across ? 1 : 0))
    expect(tally(pairs, laid)).toEqual([1, 1, 1, 1])
    expect(solved(pairs, laid)).toBe(false)
  })
  it('finds the neighbour in each direction, and hints a wrong bridge before a missing one', () => {
    const q = by(5, [isl(2, 2), isl(2, 0), isl(2, 4), isl(0, 2), isl(4, 2)])
    expect(neighbour(q, 0, 0, -1)).toBe(1)
    expect(neighbour(q, 0, -1, 0)).toBe(3)
    expect(neighbour(q, 0, 1, 0)).toBe(4)
    expect(neighbour(q, 1, 0, -1)).toBe(-1)
    // the nearest of two in line
    expect(neighbour(q, 1, 0, 1)).toBe(0)
    const laid = p.answer.map(() => 0)
    const extra = p.answer.findIndex((v) => v < 2)
    laid[extra] = p.answer[extra] + 1
    expect(hint(p, laid)).toBe(extra)
    const short = p.answer.findIndex((v) => v > 0)
    expect(
      hint(
        p,
        p.answer.map((v, k) => (k === short ? 0 : v)),
      ),
    ).toBe(short)
    expect(hint(p, p.answer)).toBe(-1)
  })
})

describe('what is kept', () => {
  it('round-trips every field that is not a default', () => {
    const s: Saved = {
      size: 11,
      look: 'night',
      clashes: false,
      bests: [{ day: 20400, size: 9, seconds: 211 }],
      solvedCount: 12,
    }
    for (const k of Object.keys(s) as (keyof Saved)[]) expect(s[k]).not.toEqual(EMPTY[k])
    expect(readSaved(JSON.stringify(s))).toEqual(s)
    expect(readSaved('{"size":13,"look":"gold","clashes":"no"}')).toEqual(EMPTY)
  })
  it('keeps the better time for a day and size, and only the last fortnight', () => {
    const old = [
      { day: 100, size: 7, seconds: 90 },
      { day: 80, size: 7, seconds: 50 },
    ]
    expect(keepBest(old, { day: 100, size: 7, seconds: 60 }, 100)).toEqual([
      { day: 100, size: 7, seconds: 60 },
    ])
    expect(keepBest(old, { day: 100, size: 7, seconds: 120 }, 100)).toEqual([old[0]])
    expect(keepBest(old, { day: 100, size: 9, seconds: 70 }, 100)).toHaveLength(2)
  })
})
