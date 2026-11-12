import { describe, expect, it } from 'vitest'
import { rng } from './bricks'
import {
  EMPTY,
  dark,
  keepBest,
  make,
  press,
  reach,
  readSaved,
  solve,
  type Pattern,
  type Saved,
} from './lamps'

/** the fewest presses by trying every set of presses there is: 512 on 3 × 3, 65,536 on 4 × 4 */
function brute(lit: boolean[], n: number, pattern: Pattern): number | null {
  let best: number | null = null
  for (let mask = 0; mask < 1 << (n * n); mask++) {
    let b = lit
    let k = 0
    for (let i = 0; i < n * n; i++)
      if ((mask >> i) & 1) {
        b = press(b, n, i, pattern)
        k++
      }
    if (dark(b) && (best === null || k < best)) best = k
  }
  return best
}

describe('a press', () => {
  it('switches the lamp and its four neighbours, or its four corners', () => {
    expect(reach(5, 12, 'plus').sort((a, b) => a - b)).toEqual([7, 11, 12, 13, 17])
    expect(reach(5, 12, 'cross').sort((a, b) => a - b)).toEqual([6, 8, 12, 16, 18])
    expect(reach(5, 0, 'plus').sort((a, b) => a - b)).toEqual([0, 1, 5])
    expect(reach(5, 0, 'cross').sort((a, b) => a - b)).toEqual([0, 6])
    // and twice is nothing at all
    const lit = make(5, 'plus', 3)
    expect(press(press(lit, 5, 7, 'plus'), 5, 7, 'plus')).toEqual(lit)
  })
})

describe('the solver', () => {
  it('finds the fewest presses, as trying every set of presses does', () => {
    // four by four with the plus has sixteen ways to clear every board it can clear, so this is
    // also the check that the shortest of several is the one chosen
    for (const pattern of ['plus', 'cross'] as const)
      for (const n of [3, 4])
        for (let s = 1; s <= 12; s++) {
          const r = rng(s * 7 + n)
          // half the boards lit at random, which on four by four can rarely be cleared at all; half
          // pressed from dark, which always can — the ones with several ways to clear. Pressing a
          // random board would not do: pressing never changes whether a board can be cleared
          let lit = Array.from({ length: n * n }, () => s % 2 === 1 && r() < 0.5)
          if (s % 2 === 0)
            for (let k = 0; k < n * n; k++) if (r() < 0.5) lit = press(lit, n, k, pattern)
          const want = brute(lit, n, pattern)
          const got = solve(lit, n, pattern)
          if (want === null) expect(got).toBeNull()
          else {
            expect(got).not.toBeNull()
            expect(got!.length).toBe(want)
            // and those presses really do switch everything off
            expect(dark(got!.reduce((b, i) => press(b, n, i, pattern), lit))).toBe(true)
          }
        }
  })
  it('says when a board cannot be cleared at all', () => {
    // on four by four with the plus, a single lit corner cannot be put out by any presses
    const one = new Array(16).fill(false)
    one[0] = true
    expect(brute(one, 4, 'plus')).toBeNull()
    expect(solve(one, 4, 'plus')).toBeNull()
  })
})

describe('a board', () => {
  it('can always be cleared, asks for enough presses, and is the same for the same seed', () => {
    for (const pattern of ['plus', 'cross'] as const)
      for (const n of [4, 5, 6, 7])
        for (let s = 1; s <= 6; s++) {
          const lit = make(n, pattern, s)
          const sol = solve(lit, n, pattern)
          expect(sol).not.toBeNull()
          expect(sol!.length).toBeGreaterThanOrEqual(Math.round(Math.round(n * n * 0.4) * 0.6))
          expect(lit.some(Boolean)).toBe(true)
        }
    expect(make(6, 'cross', 9)).toEqual(make(6, 'cross', 9))
  })
})

describe('what is kept', () => {
  it('round-trips every field that is not a default', () => {
    const s: Saved = {
      size: 7,
      pattern: 'cross',
      look: 'neon',
      bests: [{ day: 20400, size: 4, pattern: 'cross', presses: 9, par: 7 }],
      solvedCount: 6,
    }
    for (const k of Object.keys(s) as (keyof Saved)[]) expect(s[k]).not.toEqual(EMPTY[k])
    expect(readSaved(JSON.stringify(s))).toEqual(s)
    expect(readSaved('{"size":3,"pattern":"star"}')).toEqual(EMPTY)
  })
  it('keeps the fewer presses for a day and board, and only the last fortnight', () => {
    const b = (day: number, presses: number) => ({
      day,
      size: 5,
      pattern: 'plus' as const,
      presses,
      par: 5,
    })
    let k = keepBest([], b(100, 9), 100)
    k = keepBest(k, b(100, 12), 100)
    expect(k).toEqual([b(100, 9)])
    k = keepBest(k, b(100, 7), 100)
    expect(k).toEqual([b(100, 7)])
    expect(keepBest(k, b(120, 6), 120)).toEqual([b(120, 6)])
  })
})
