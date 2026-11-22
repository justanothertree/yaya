import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { dayBounds, endOfNextDay } from './record'

/**
 * The end of tomorrow, on the eve of each change, in two zones that have them (pinned the way
 * weekdays.test.ts and daylight.test.ts are). The answer is the midnight after tomorrow, read from
 * the runtime's own Date; the next day is found by UTC arithmetic on the date string.
 */
const ZONES = [
  { tz: 'America/New_York', short: '2026-03-08', long: '2026-11-01' },
  { tz: 'Europe/London', short: '2026-03-29', long: '2026-10-25' },
] as const

const next = (iso: string, n = 1): string =>
  new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10) + n))
    .toISOString()
    .slice(0, 10)

const midnightOf = (iso: string): number =>
  new Date(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)).getTime()

describe.each(ZONES)('in $tz', ({ tz, short, long }) => {
  beforeAll(() => {
    vi.stubEnv('TZ', tz)
  })
  afterAll(() => {
    vi.unstubAllEnvs()
  })

  it('the end of tomorrow is the midnight after it, on the eve of either change', () => {
    for (const tomorrow of [short, long]) {
      const today = next(tomorrow, -1)
      expect(endOfNextDay(dayBounds(today).toMs), today).toBe(midnightOf(next(tomorrow)))
    }
  })

  it('which 24 hours on is not: an hour short before the long day, an hour over before the short', () => {
    const plus24 = (today: string) => dayBounds(today).toMs + 86_400_000
    expect(midnightOf(next(long)) - plus24(next(long, -1))).toBe(3_600_000)
    expect(midnightOf(next(short)) - plus24(next(short, -1))).toBe(-3_600_000)
  })

  it('and on an ordinary evening the two agree', () => {
    const today = '2026-06-10'
    expect(endOfNextDay(dayBounds(today).toMs)).toBe(dayBounds(today).toMs + 86_400_000)
  })
})
