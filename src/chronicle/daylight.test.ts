import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { streakAsks, windowOf, type Goal } from './goal'
import { monthOf } from './month'
import { coveredMs, coveredPct, dayBounds, longRun } from './record'
import { weekOf } from './week'
import { daysCovered } from './year'

/**
 * ⚠️ THE DAYS THE CLOCKS CHANGE, WITH THE ANSWER WRITTEN DOWN. Measured on 10 Nov 2026: with
 * `dayBounds` broken to step a flat 24 hours, record.test.ts and month.test.ts still passed all 100
 * of their tests, in UTC and in New York alike. The test that names the change days accepts 23, 24
 * or 25 hours for EVERY date, and the one that fills a short day builds its span from `dayBounds`
 * itself, so neither can tell a right answer from a wrong one. And CI runs in UTC, where
 * `2026-03-08` is an ordinary 1440-minute day, so anything that did ask would pass there without
 * asking. This file pins a zone that has the changes and writes down which day is which length.
 * Assigning `process.env.TZ` inside a vitest worker moves `Date` to that zone (January's offset read
 * 300 in New York and 0 after switching to UTC), and `stubEnv` is how weekdays.test.ts already pins
 * its own.
 *
 * Two zones, because they change on different dates and at different hours: New York at 2am on the
 * second Sunday of March and the first of November, London at 1am on the last Sundays of March and
 * October. Every expectation is a calendar fact, never a sum the code also makes, and the next day
 * is found by UTC arithmetic on the date string, which shares nothing with Chronicle's local maths.
 */
const ZONES = [
  { tz: 'America/New_York', january: 300, short: '2026-03-08', long: '2026-11-01' },
  { tz: 'Europe/London', january: 0, short: '2026-03-29', long: '2026-10-25' },
] as const

/** a date string `n` calendar days on, by UTC arithmetic, so no local clock is involved */
const next = (iso: string, n = 1): string =>
  new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10) + n))
    .toISOString()
    .slice(0, 10)

/** a local wall-clock moment, by the runtime's own Date */
const at = (iso: string, hour: number): number =>
  new Date(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10), hour).getTime()

/** how long each day is, in minutes, as a calendar says rather than as the code works it out */
const lengthOf = (iso: string, short: string, long: string): number =>
  iso === short ? 23 * 60 : iso === long ? 25 * 60 : 24 * 60

const daily: Goal = {
  id: 'g-daily',
  title: 'a daily goal',
  scope: 'day',
  anchor: null,
  shared: false,
  visibility: 'private',
  every: 1,
  target: 30,
  unit: 'minutes',
  progress: 0,
  done: false,
  note: null,
  sort: 0,
  activity: 'act-1',
  cat: null,
  counts: 'minutes',
  est: null,
  priority: 0,
}

describe.each(ZONES)('in $tz', ({ tz, january, short, long }) => {
  beforeAll(() => {
    vi.stubEnv('TZ', tz)
  })
  afterAll(() => {
    vi.unstubAllEnvs()
  })

  it('is really in that zone, or every test below is about another one', () => {
    expect(new Date(2026, 0, 15).getTimezoneOffset()).toBe(january)
    expect(new Date(2026, 6, 15).getTimezoneOffset()).toBe(january - 60)
  })

  it('a day is 23 hours when the clocks go forward, 25 when they go back, and 24 either side', () => {
    const mins = (iso: string) => {
      const b = dayBounds(iso)
      return (b.toMs - b.fromMs) / 60_000
    }
    expect(mins(short)).toBe(23 * 60)
    expect(mins(long)).toBe(25 * 60)
    for (const iso of [next(short, -1), next(short), next(long, -1), next(long)]) {
      expect(mins(iso), iso).toBe(24 * 60)
    }
  })

  it('and the days tile: each begins at a local midnight, where the one before it ended', () => {
    for (const around of [short, long]) {
      for (let i = -2; i <= 2; i++) {
        const day = next(around, i)
        const b = dayBounds(day)
        expect(b.toMs, `${day} ends where the next day begins`).toBe(dayBounds(next(day)).fromMs)
        expect(b.fromMs, `${day} begins at its own midnight`).toBe(at(day, 0))
      }
    }
  })

  it('a whole short or long day recorded is all of it, and holds its real minutes', () => {
    for (const day of [short, long]) {
      const b = dayBounds(day)
      const all = {
        start: new Date(at(day, 0)).toISOString(),
        end: new Date(at(next(day), 0)).toISOString(),
      }
      expect(coveredPct([all], b.fromMs, b.toMs, b.toMs)).toBe(100)
      expect(coveredMs([all], b.fromMs, b.toMs, b.toMs) / 60_000).toBe(lengthOf(day, short, long))
    }
  })

  it('nine to five on either day is eight hours, and a share of that day rather than of 24 hours', () => {
    for (const day of [short, long]) {
      const b = dayBounds(day)
      const work = {
        start: new Date(at(day, 9)).toISOString(),
        end: new Date(at(day, 17)).toISOString(),
      }
      expect(coveredMs([work], b.fromMs, b.toMs, b.toMs)).toBe(8 * 3_600_000)
      expect(coveredPct([work], b.fromMs, b.toMs, b.toMs)).toBeCloseTo(
        (480 / lengthOf(day, short, long)) * 100,
        10,
      )
    }
  })

  it("a day's window is that day, and the week around a change is seven dates holding it once", () => {
    for (const day of [short, long]) {
      expect(windowOf('day', day)).toEqual({ from: day, to: next(day) })
      const w = windowOf('week', day)!
      expect(w.to).toBe(next(w.from, 7))
      const week = weekOf(day)
      expect(week).toEqual(Array.from({ length: 7 }, (_, i) => next(w.from, i)))
      expect(week.filter((d) => d === day)).toHaveLength(1)
    }
  })

  it('the month grid has every date once and in order, across the change', () => {
    for (const day of [short, long]) {
      const days = monthOf(day).map((d) => d.on)
      days.forEach((d, i) => {
        if (i > 0) expect(d, `after ${days[i - 1]}`).toBe(next(days[i - 1]))
      })
      expect(days.filter((d) => d === day)).toHaveLength(1)
      expect([28, 35, 42]).toContain(days.length)
    }
  })

  it("a daily goal's streak windows tile across the change, each exactly as long as its day", () => {
    for (const around of [short, long]) {
      const on = next(around, 3)
      const asks = streakAsks([daily], on, 7)
      expect(asks).toHaveLength(8)
      asks.forEach((a, i) => {
        const day = next(on, -i)
        expect([a.from_day, a.to_day], `window ${i}`).toEqual([day, next(day)])
        expect((Date.parse(a.to) - Date.parse(a.from)) / 60_000, day).toBe(
          lengthOf(day, short, long),
        )
        if (i > 0)
          expect(Date.parse(a.to), `${day} ends where ${next(day)} began`).toBe(
            Date.parse(asks[i - 1].from),
          )
      })
    }
  })

  it('a sitting begun the evening before the change was two days ago the morning after it', () => {
    for (const day of [short, long]) {
      const began = new Date(at(next(day, -1), 22)).toISOString()
      expect(longRun(began, at(next(day), 9))).toEqual({ startedOn: next(day, -1), daysAgo: 2 })
    }
  })

  it('a year of record counts every calendar day once, whatever the clocks did', () => {
    expect(daysCovered(at('2026-01-01', 12), at('2026-12-31', 12))).toBe(365)
    expect(daysCovered(at(next(short, -1), 23), at(next(short), 1))).toBe(3)
    expect(daysCovered(at(next(long, -1), 23), at(next(long), 1))).toBe(3)
  })
})
