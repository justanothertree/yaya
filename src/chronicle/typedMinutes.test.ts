import { describe, expect, it } from 'vitest'
import { typedMinutes } from './record'

/**
 * Minutes typed into a box — a sitting's length, a goal's estimate, a routine step — read the one
 * way all three boxes read them: a positive number, rounded to a whole minute, or no answer at all.
 * Blank and nonsense are "no opinion", never zero.
 */
describe('minutes typed into a box', () => {
  it('reads a positive number, rounded to the minute', () => {
    expect(typedMinutes('30')).toBe(30)
    expect(typedMinutes(' 45 ')).toBe(45)
    expect(typedMinutes('12.4')).toBe(12)
    expect(typedMinutes('12.5')).toBe(13)
  })

  it('and reads blank, nonsense, zero and negatives as no answer', () => {
    for (const typed of ['', '   ', 'soon', '0', '-5', 'Infinity', 'NaN']) {
      expect(typedMinutes(typed), JSON.stringify(typed)).toBeNull()
    }
  })
})
