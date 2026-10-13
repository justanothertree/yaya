import { describe, expect, it } from 'vitest'
import {
  clockText,
  dayBounds,
  minutesByActivity,
  minutesByCat,
  overlapMs,
  spanText,
  type Activity,
  type Entry,
} from './record'

const at = (iso: string) => new Date(iso).getTime()

const entry = (over: Partial<Entry> = {}): Entry => ({
  id: 'e1',
  activity: 'a1',
  start: '2026-10-12T09:00:00.000Z',
  end: '2026-10-12T10:00:00.000Z',
  note: null,
  ...over,
})

const acts: Activity[] = [
  { id: 'a1', name: 'Drawing', cat: 'free', colour: null, archived: false, auto: false },
  { id: 'a2', name: 'Dishes', cat: 'life', colour: null, archived: false, auto: false },
  { id: 'a3', name: 'Work', cat: 'locked', colour: null, archived: false, auto: false },
]

const NOW = at('2026-10-12T12:00:00.000Z')

describe('how much of a span falls inside a window', () => {
  it('is the whole thing when it fits, and nothing when it is elsewhere', () => {
    const e = entry()
    expect(overlapMs(e, at('2026-10-12T00:00:00Z'), at('2026-10-13T00:00:00Z'), NOW)).toBe(
      3_600_000,
    )
    expect(overlapMs(e, at('2026-10-13T00:00:00Z'), at('2026-10-14T00:00:00Z'), NOW)).toBe(0)
    expect(overlapMs(e, at('2026-10-11T00:00:00Z'), at('2026-10-12T00:00:00Z'), NOW)).toBe(0)
  })

  /**
   * ⚠️ THE PROPERTY THE WHOLE MODULE RESTS ON, and it is not a particular number of hours. Split
   * any range into windows that tile it and the overlaps must sum to exactly the span's length
   * inside that range — no more, which is double counting, and no less, which is a night's work
   * going missing. A session from 23:00 to 01:00 is the case: attributed to the day it started it
   * vanishes from tomorrow, attributed to both in full it makes eight hours of logging report
   * sixteen.
   */
  it('and the overlaps across tiling windows sum to the length, never twice and never none', () => {
    const across = entry({ start: '2026-10-11T23:00:00Z', end: '2026-10-12T01:00:00Z' })
    const day1 = overlapMs(across, at('2026-10-11T00:00:00Z'), at('2026-10-12T00:00:00Z'), NOW)
    const day2 = overlapMs(across, at('2026-10-12T00:00:00Z'), at('2026-10-13T00:00:00Z'), NOW)
    expect(day1 + day2).toBe(2 * 3_600_000)
    expect(day1).toBe(3_600_000)
    expect(day2).toBe(3_600_000)

    /* and the same with hourly windows over a long session, which is the general case */
    const long = entry({ start: '2026-10-12T08:20:00Z', end: '2026-10-12T14:50:00Z' })
    let sum = 0
    for (let h = 0; h < 24; h++) {
      const from = at('2026-10-12T00:00:00Z') + h * 3_600_000
      sum += overlapMs(long, from, from + 3_600_000, NOW)
    }
    expect(sum).toBe(at('2026-10-12T14:50:00Z') - at('2026-10-12T08:20:00Z'))
  })

  /** ⚠️ a running timer is measured to the clock it is handed, and no further */
  it('and a running timer counts up to now and stops there', () => {
    const live = entry({ start: '2026-10-12T11:30:00Z', end: null })
    expect(overlapMs(live, at('2026-10-12T00:00:00Z'), at('2026-10-13T00:00:00Z'), NOW)).toBe(
      30 * 60_000,
    )
    /* and not into a window that has not happened */
    expect(overlapMs(live, at('2026-10-12T13:00:00Z'), at('2026-10-12T14:00:00Z'), NOW)).toBe(0)
  })

  it('and a backwards or unreadable span contributes nothing rather than a negative', () => {
    const back = entry({ start: '2026-10-12T10:00:00Z', end: '2026-10-12T09:00:00Z' })
    expect(overlapMs(back, at('2026-10-12T00:00:00Z'), at('2026-10-13T00:00:00Z'), NOW)).toBe(0)
    const junk = entry({ start: 'not a date' })
    expect(overlapMs(junk, at('2026-10-12T00:00:00Z'), at('2026-10-13T00:00:00Z'), NOW)).toBe(0)
    const openJunk = entry({ start: '2026-10-12T09:00:00Z', end: 'also not a date' })
    /* an unreadable END falls back to the clock rather than discarding a real session */
    expect(
      overlapMs(openJunk, at('2026-10-12T00:00:00Z'), at('2026-10-13T00:00:00Z'), NOW),
    ).toBeGreaterThan(0)
  })
})

describe('what a day adds up to', () => {
  const day = dayBounds('2026-10-12')
  const entries: Entry[] = [
    entry({ id: '1', activity: 'a1', start: '2026-10-12T09:00:00Z', end: '2026-10-12T10:00:00Z' }),
    entry({ id: '2', activity: 'a1', start: '2026-10-12T10:30:00Z', end: '2026-10-12T11:00:00Z' }),
    entry({ id: '3', activity: 'a2', start: '2026-10-12T11:00:00Z', end: '2026-10-12T11:15:00Z' }),
  ]

  it('groups the same activity together', () => {
    const by = minutesByActivity(entries, day.fromMs, day.toMs, NOW)
    expect(by.a1).toBe(90)
    expect(by.a2).toBe(15)
    expect(by.a3).toBeUndefined()
  })

  /** ⚠️ the three categories are the reading the whole thing exists for */
  it('and rolls up into the three categories', () => {
    const by = minutesByCat(entries, acts, day.fromMs, day.toMs, NOW)
    expect(by.free).toBe(90)
    expect(by.life).toBe(15)
    expect(by.locked).toBeUndefined()
  })

  /**
   * ⚠️ AND THE TWO ROLLUPS CANNOT DISAGREE. Minutes by activity and minutes by category are two
   * views of one number, so their totals must match — if they ever differ, one of them is
   * dropping or double-counting an entry and a day's total depends on which panel you looked at.
   */
  it('and the two rollups always total the same', () => {
    const a = minutesByActivity(entries, day.fromMs, day.toMs, NOW)
    const c = minutesByCat(entries, acts, day.fromMs, day.toMs, NOW)
    const sum = (o: Record<string, number>) => Object.values(o).reduce((n, v) => n + v, 0)
    expect(sum(a)).toBeCloseTo(sum(c), 9)
  })

  it('and an entry for an activity nobody knows about still counts somewhere', () => {
    const orphan = [
      entry({ activity: 'gone', start: '2026-10-12T09:00:00Z', end: '2026-10-12T09:30:00Z' }),
    ]
    const c = minutesByCat(orphan, acts, day.fromMs, day.toMs, NOW)
    /* ⚠️ half an hour that happened does not stop having happened because its activity was
       deleted — losing it silently would make a day's total quietly wrong */
    expect(Object.values(c).reduce((n, v) => n + v, 0)).toBe(30)
  })
})

describe('a day, in local time', () => {
  /**
   * ⚠️ BUILT FROM LOCAL PARTS, NOT PARSED. `new Date('2026-10-12')` is UTC midnight, which is the
   * 11th at 8pm in New York — so a day built that way starts four hours early and a late-evening
   * session lands on the wrong date. The same trap circuit/dates.ts opens with a warning about.
   */
  it('starts at local midnight and is exactly one day long', () => {
    for (const iso of ['2026-10-12', '2026-03-08', '2026-11-01', '2028-02-29']) {
      const { fromMs, toMs } = dayBounds(iso)
      const from = new Date(fromMs)
      expect(from.getHours(), `${iso} starts at local midnight`).toBe(0)
      expect(from.getDate(), `${iso} is the right date`).toBe(Number(iso.slice(8)))
      const hours = (toMs - fromMs) / 3_600_000
      /* ⚠️ 23 or 25 on the two days the clocks move, which is correct rather than a bug — a
         spring-forward day really is 23 hours long, and a window that insisted on 24 would spill
         an hour into the next day */
      expect([23, 24, 25], `${iso} is a real day long`).toContain(hours)
    }
  })
})

describe('saying a length out loud', () => {
  it('never says a leading zero hour or bare minutes over an hour', () => {
    expect(spanText(0)).toBe('0m')
    expect(spanText(7_000)).toBe('7s')
    expect(spanText(7 * 60_000)).toBe('7m')
    expect(spanText(59 * 60_000)).toBe('59m')
    expect(spanText(60 * 60_000)).toBe('1h')
    expect(spanText(83 * 60_000)).toBe('1h 23m')
    expect(spanText(-5)).toBe('0m')
  })

  it('and a running clock shows seconds, because it has to be visibly moving', () => {
    expect(clockText(0)).toBe('0:00')
    expect(clockText(9_000)).toBe('0:09')
    expect(clockText(70_000)).toBe('1:10')
    expect(clockText(3_661_000)).toBe('1:01:01')
  })
})
