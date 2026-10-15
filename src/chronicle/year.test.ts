import { describe, expect, it } from 'vitest'
import { daysCovered, firstDay, yearsBetween } from './year'

/** local midnight on a date, written the way the module writes its own boundaries */
const at = (y: number, m: number, d: number, h = 12) => new Date(y, m - 1, d, h).getTime()

describe('the years a record covers', () => {
  it('has nothing to say about a record that does not exist', () => {
    expect(yearsBetween(null, at(2026, 10, 14))).toEqual([])
    expect(firstDay(null)).toBe(null)
    expect(daysCovered(null, at(2026, 10, 14))).toBe(0)
  })

  it('is one window for somebody who started this year', () => {
    const got = yearsBetween(at(2026, 3, 2), at(2026, 10, 14))
    expect(got.map((s) => s.key)).toEqual(['2026'])
  })

  /** inclusive at BOTH ends — four years, not three */
  it('counts the first year and the current one', () => {
    const got = yearsBetween(at(2023, 11, 30), at(2026, 1, 2))
    expect(got.map((s) => s.key)).toEqual(['2026', '2025', '2024', '2023'])
  })

  it('reads newest first, the way the room lists anything over time', () => {
    const got = yearsBetween(at(2020, 6, 1), at(2026, 6, 1))
    expect(got[0].key).toBe('2026')
    expect(got[got.length - 1].key).toBe('2020')
  })

  /**
   * ⚠️ THE PROPERTY THAT MATTERS, and it is asked of the windows rather than of any boundary: the
   * set tiles the whole record exactly. Each window ends where the next begins, so a sitting
   * cannot fall between two of them and cannot be counted by both. The same shape as `overlapMs`'
   * own test, which asserts that a span's overlaps with a tiling set add up to its length rather
   * than checking a particular hour.
   */
  it('tiles without a gap or an overlap', () => {
    const got = yearsBetween(at(2019, 4, 4), at(2026, 10, 14))
    /* listed newest-first, so walk it backwards to go forwards in time */
    const ascending = [...got].reverse()
    for (let i = 1; i < ascending.length; i++) {
      expect(ascending[i].from).toBe(ascending[i - 1].to)
    }
  })

  it('covers the first instant recorded and the present moment', () => {
    const firstMs = at(2024, 7, 9, 3)
    const nowMs = at(2026, 2, 1, 23)
    const got = yearsBetween(firstMs, nowMs)
    const oldest = got[got.length - 1]
    const newest = got[0]
    expect(Date.parse(oldest.from)).toBeLessThanOrEqual(firstMs)
    expect(Date.parse(newest.to)).toBeGreaterThan(nowMs)
  })

  /**
   * ⚠️ LOCAL MIDNIGHT, NOT UTC. Written as a UTC instant the new year lands in the wrong place for
   * everybody west of Greenwich — so the boundary is asserted by reading it back as a local date,
   * which is the only reading that is the same in every zone this can run in.
   */
  it('starts each year at local midnight on the 1st of January', () => {
    for (const s of yearsBetween(at(2024, 5, 5), at(2026, 5, 5))) {
      const d = new Date(s.from)
      expect(d.getMonth()).toBe(0)
      expect(d.getDate()).toBe(1)
      expect(d.getHours()).toBe(0)
      expect(d.getMinutes()).toBe(0)
      expect(String(d.getFullYear())).toBe(s.key)
    }
  })
})

describe('how long a record has been going', () => {
  /** a record two hours old covers one day, not none */
  it('counts the day it started as a day', () => {
    expect(daysCovered(at(2026, 10, 14, 1), at(2026, 10, 14, 23))).toBe(1)
  })

  it('counts both ends', () => {
    expect(daysCovered(at(2026, 10, 1), at(2026, 10, 3))).toBe(3)
  })

  /** measured between local midnights, so the hour of day cannot shift the answer */
  it('does not care what time of day either end was', () => {
    const early = daysCovered(at(2026, 10, 1, 1), at(2026, 10, 10, 23))
    const late = daysCovered(at(2026, 10, 1, 23), at(2026, 10, 10, 1))
    expect(early).toBe(late)
    expect(early).toBe(10)
  })

  it('counts across a year end', () => {
    expect(daysCovered(at(2025, 12, 30), at(2026, 1, 2))).toBe(4)
  })
})
