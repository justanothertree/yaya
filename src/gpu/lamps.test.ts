import { describe, expect, it } from 'vitest'
import { daySeed, daySeedOf, rng } from './bricks'
import { dayNumber } from './daily'
import {
  EMPTY,
  dark,
  seedFor,
  verifyLamps,
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
      bests: [
        {
          day: 20400,
          size: 4,
          pattern: 'cross',
          presses: 9,
          par: 7,
          actions: [3, -1, 3, 5, 9, 2, 0, 1, 15],
        },
      ],
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

describe('a day’s board, from the date alone', () => {
  it('the seed from a date is the seed the game has always used for today', () => {
    // what LampsDemo computed before the seed moved here
    const old = (size: number, pattern: Pattern) =>
      (daySeed(new Date()) ^ (size * 7919) ^ (pattern === 'cross' ? 0x2545f491 : 0)) >>> 0
    for (const size of [4, 5, 6, 7])
      for (const pattern of ['plus', 'cross'] as const)
        expect(seedFor(dayNumber(), size, pattern)).toBe(old(size, pattern))
  })
  it('a day number names the same calendar date in every time zone', () => {
    expect(daySeedOf(2026, 11, 14)).toBe(daySeed(new Date(2026, 10, 14, 23, 59)))
    expect(seedFor(dayNumber(new Date(2026, 10, 14, 0, 5)), 5, 'plus')).toBe(
      seedFor(dayNumber(new Date(2026, 10, 14, 23, 55)), 5, 'plus'),
    )
  })
})

describe('checking a solve from its replay', () => {
  const today = dayNumber(new Date(2026, 10, 14, 12))
  const board = (day: number, size: number, pattern: Pattern) =>
    make(size, pattern, seedFor(day, size, pattern))
  const shortest = (day: number, size: number, pattern: Pattern) =>
    solve(board(day, size, pattern), size, pattern)!
  it('a real solve checks out, at its own count and the board’s par', () => {
    const way = shortest(today, 5, 'plus')
    expect(verifyLamps({ day: today, size: 5, pattern: 'plus', actions: way }, today)).toEqual({
      ok: true,
      presses: way.length,
      par: way.length,
    })
  })
  it('an undo counts as a press, as it does in the game', () => {
    const way = shortest(today, 6, 'cross')
    const actions = [way[0], -1, ...way]
    expect(verifyLamps({ day: today, size: 6, pattern: 'cross', actions }, today)).toMatchObject({
      ok: true,
      presses: way.length + 2,
    })
  })
  it('yesterday’s and tomorrow’s boards are allowed for the time zones, nothing further', () => {
    for (const d of [today - 1, today + 1]) {
      const way = shortest(d, 4, 'plus')
      expect(verifyLamps({ day: d, size: 4, pattern: 'plus', actions: way }, today).ok).toBe(true)
    }
    const old = shortest(today - 2, 4, 'plus')
    expect(verifyLamps({ day: today - 2, size: 4, pattern: 'plus', actions: old }, today)).toEqual({
      ok: false,
      why: 'day',
    })
  })
  it('refuses a replay that does not clear the board it names', () => {
    const way = shortest(today, 5, 'plus')
    const r = (actions: number[], over: Partial<{ size: number; pattern: string }> = {}) =>
      verifyLamps({ day: today, size: 5, pattern: 'plus', actions, ...over }, today)
    expect(r(way.slice(1))).toEqual({ ok: false, why: 'not-dark' })
    // the right presses for a different board
    expect(r(way, { pattern: 'cross' }).ok).toBe(false)
    // pressing on after the board went dark is not a finish the game would record
    expect(r([...way, 0, 0])).toEqual({ ok: false, why: 'after-dark' })
    expect(r([-1, ...way])).toEqual({ ok: false, why: 'actions' })
    expect(r([25, ...way])).toEqual({ ok: false, why: 'actions' })
    expect(r([1.5, ...way])).toEqual({ ok: false, why: 'actions' })
    expect(r([])).toEqual({ ok: false, why: 'actions' })
    expect(r(way, { size: 3 })).toEqual({ ok: false, why: 'board' })
    expect(r(way, { pattern: 'star' })).toEqual({ ok: false, why: 'board' })
  })
})
