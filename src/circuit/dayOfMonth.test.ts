import { describe, expect, it } from 'vitest'
import { dayOfMonth } from './dates'

/** The Circuit's month views name each day as `YYYY-MM-DD` from a `YYYY-MM` and a day number. */
describe('a day of a month', () => {
  it('pads the day to two digits', () => {
    expect(dayOfMonth('2026-11', 1)).toBe('2026-11-01')
    expect(dayOfMonth('2026-11', 30)).toBe('2026-11-30')
  })

  it('is the same string a calendar date spells, for every day of a leap February', () => {
    for (let d = 1; d <= 29; d++) {
      const expected = new Date(Date.UTC(2028, 1, d)).toISOString().slice(0, 10)
      expect(dayOfMonth('2028-02', d)).toBe(expected)
    }
  })
})
