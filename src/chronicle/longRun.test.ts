import { describe, expect, it, vi } from 'vitest'
import { LONG_RUN_HOURS, longRun } from './record'

/**
 * ⚠️ PINNED TO A ZONE WITH DAYLIGHT SAVING, or the calendar-day test cannot fail where it runs. CI
 * is in UTC, where every day is 24 hours and dividing by 24 and rounding agree; the difference
 * only exists on the day the clocks change, in a zone that changes them — which is every member.
 * The same pin, for the same reason, as weekdays.test.ts.
 */
vi.stubEnv('TZ', 'America/New_York')

/* local wall-clock times, built from parts the way the room builds them */
const at = (y: number, m: number, d: number, h: number, min = 0) =>
  new Date(y, m - 1, d, h, min).getTime()
const iso = (ms: number) => new Date(ms).toISOString()

describe('saying when a long sitting began', () => {
  it('says nothing about an ordinary afternoon', () => {
    expect(longRun(iso(at(2026, 11, 7, 13)), at(2026, 11, 7, 16, 59))).toBeNull()
  })

  it(`speaks once a sitting started today has run ${LONG_RUN_HOURS} hours`, () => {
    /* asserted from the clock, not from the constant: 9:00 to 13:00 is four hours */
    expect(LONG_RUN_HOURS).toBe(4)
    expect(longRun(iso(at(2026, 11, 7, 9)), at(2026, 11, 7, 13))).toEqual({
      startedOn: '2026-11-07',
      daysAgo: 0,
    })
  })

  it('always gives a date to a sitting that began on an earlier day, however short', () => {
    /* two hours from 11pm crosses midnight, and "since 11:00 PM" alone would read as tonight */
    expect(longRun(iso(at(2026, 11, 6, 23)), at(2026, 11, 7, 1))).toEqual({
      startedOn: '2026-11-06',
      daysAgo: 1,
    })
  })

  it('counts calendar days, not 24-hour blocks', () => {
    /* forty hours from 10pm Thursday is Saturday 2pm — two days ago, not one and two-thirds */
    expect(longRun(iso(at(2026, 11, 5, 22)), at(2026, 11, 7, 14))?.daysAgo).toBe(2)
  })

  it('counts across the 23-hour day as one day', () => {
    /* 8 March 2026 is 23 hours long in New York, so midnight to midnight across it is 23h —
       the day the gap has to be ROUNDED rather than divided and floored */
    expect(longRun(iso(at(2026, 3, 8, 1)), at(2026, 3, 9, 10))?.daysAgo).toBe(1)
  })

  it('counts across the 25-hour day as one day', () => {
    /* and 1 November 2026 is 25 hours long — midnight to midnight across it is 25h */
    expect(longRun(iso(at(2026, 11, 1, 1)), at(2026, 11, 2, 10))?.daysAgo).toBe(1)
  })

  it('says nothing about a start it cannot read', () => {
    expect(longRun('not a date', at(2026, 11, 7, 12))).toBeNull()
  })

  it('says nothing about a start in the future, even on a later day', () => {
    /* a clock that is wrong somewhere must not produce "since tomorrow" */
    expect(longRun(iso(at(2026, 11, 8, 9)), at(2026, 11, 7, 12))).toBeNull()
  })
})
