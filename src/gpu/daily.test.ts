import { describe, expect, it } from 'vitest'
import { KEEP_DAYS, clock, dayNumber, keepBestOf } from './daily'

describe('the day', () => {
  it('is one number for a whole local day, and one more the next', () => {
    const a = dayNumber(new Date(2026, 10, 12, 0, 1))
    expect(dayNumber(new Date(2026, 10, 12, 23, 59))).toBe(a)
    expect(dayNumber(new Date(2026, 10, 13, 0, 1))).toBe(a + 1)
    // across the clocks going back and forward, still one a day
    expect(dayNumber(new Date(2026, 2, 30, 12)) - dayNumber(new Date(2026, 2, 29, 12))).toBe(1)
    expect(dayNumber(new Date(2026, 9, 26, 12)) - dayNumber(new Date(2026, 9, 25, 12))).toBe(1)
  })
})

describe('the clock', () => {
  it('reads minutes and two-figure seconds, whole seconds only', () => {
    expect(clock(0)).toBe('0:00')
    expect(clock(59)).toBe('0:59')
    expect(clock(61)).toBe('1:01')
    expect(clock(600)).toBe('10:00')
    expect(clock(61.9)).toBe('1:01')
  })
})

describe('keeping the best', () => {
  type B = { day: number; size: number; seconds: number }
  const same = (x: B, y: B) => x.day === y.day && x.size === y.size
  const better = (b: B, old: B) => b.seconds < old.seconds
  it('keeps a better finish for the same day and board, and not a worse one', () => {
    let k = keepBestOf<B>([], { day: 100, size: 5, seconds: 90 }, 100, same, better)
    k = keepBestOf(k, { day: 100, size: 5, seconds: 120 }, 100, same, better)
    expect(k).toEqual([{ day: 100, size: 5, seconds: 90 }])
    k = keepBestOf(k, { day: 100, size: 5, seconds: 60 }, 100, same, better)
    expect(k).toEqual([{ day: 100, size: 5, seconds: 60 }])
    // another board that day is its own best
    k = keepBestOf(k, { day: 100, size: 6, seconds: 200 }, 100, same, better)
    expect(k).toHaveLength(2)
  })
  it('forgets anything older than a fortnight', () => {
    const old = [{ day: 100 - KEEP_DAYS, size: 5, seconds: 10 }]
    expect(keepBestOf(old, { day: 100, size: 5, seconds: 50 }, 100, same, better)).toEqual([
      { day: 100, size: 5, seconds: 50 },
    ])
    expect(
      keepBestOf(
        [{ day: 101 - KEEP_DAYS, size: 5, seconds: 10 }],
        { day: 100, size: 5, seconds: 50 },
        100,
        same,
        better,
      ),
    ).toHaveLength(2)
  })
})
