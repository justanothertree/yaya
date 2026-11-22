import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { dayBounds, lane, nowAt, overlapMs, spanText } from './record'
import { hours } from './week'

/**
 * ⚠️ A DAY IS DRAWN ON A CLOCK FACE, AND TWICE A YEAR IT IS NOT 24 HOURS LONG. The week grid and the
 * day strip draw hour lines at fixed places (`hours()` puts 9am at 9/24 of the column, the strip
 * puts 6, 12 and 18 at a quarter, a half and three quarters), while `lane` and `nowAt` placed a
 * session by the time ELAPSED since midnight over the day's real length. On a 24-hour day those
 * agree. On 8 March in New York, 9am is eight hours after midnight in a 23-hour day, so a sitting at
 * nine was drawn at 34.8% against a "9a" line at 37.5%: 39 minutes early. The gap is widest just
 * after the change, about 55 minutes at 3am, and closes towards midnight. On 1 November it runs the
 * other way, and everything after the change was drawn late. And the week grid's tooltip rebuilt a
 * block's minutes as `width% × 1440`, so a one-hour sitting read "1h 2m" on the short day and "57m"
 * on the long one (measured).
 *
 * Pinned to two zones with daylight saving, the way daylight.test.ts and weekdays.test.ts are, and
 * asked of the clock face itself: where 9am is on a dial of 24 hours is 9/24, whatever the clocks did.
 */
const ZONES = [
  { tz: 'America/New_York', short: '2026-03-08', long: '2026-11-01', skipped: 2 },
  { tz: 'Europe/London', short: '2026-03-29', long: '2026-10-25', skipped: 1 },
] as const

/** a local wall-clock moment, by the runtime's own Date */
const at = (iso: string, hour: number, min = 0): number =>
  new Date(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10), hour, min).getTime()

const sitting = (iso: string, from: [number, number], to: [number, number]) => ({
  activity: 'a',
  start: new Date(at(iso, ...from)).toISOString(),
  end: new Date(at(iso, ...to)).toISOString(),
})

/** where an hour of the clock sits on the dial, as the hour lines draw it */
const onDial = (h: number) => (h / 24) * 100

describe.each(ZONES)('in $tz', ({ tz, short, long, skipped }) => {
  beforeAll(() => {
    vi.stubEnv('TZ', tz)
  })
  afterAll(() => {
    vi.unstubAllEnvs()
  })

  it('a sitting at nine is drawn on the 9a line on both days the clocks change', () => {
    for (const day of [short, long]) {
      const { fromMs, toMs } = dayBounds(day)
      const [b] = lane([sitting(day, [9, 0], [10, 0])], fromMs, toMs, toMs)
      expect(b.left, `${day} starts at nine`).toBeCloseTo(onDial(9), 10)
      expect(b.width, `${day} is an hour of the dial`).toBeCloseTo(100 / 24, 10)
      /* the line the grid draws for 9am is the same number */
      expect(b.left).toBeCloseTo(hours()[9].top, 10)
    }
  })

  it('and one at eleven at night on the 11p line', () => {
    for (const day of [short, long]) {
      const { fromMs, toMs } = dayBounds(day)
      const [b] = lane([sitting(day, [23, 0], [23, 30])], fromMs, toMs, toMs)
      expect(b.left, day).toBeCloseTo(onDial(23), 10)
    }
  })

  it('keeps its real length beside its place, and says it as an hour', () => {
    for (const day of [short, long]) {
      const { fromMs, toMs } = dayBounds(day)
      const s = sitting(day, [9, 0], [10, 0])
      const [b] = lane([s], fromMs, toMs, toMs)
      expect(b.ms).toBe(3_600_000)
      expect(b.ms).toBe(overlapMs(s, fromMs, toMs, toMs))
      expect(spanText(b.ms)).toBe('1h')
    }
  })

  it('a sitting across the hour that is skipped spans its clock times, and is an hour long', () => {
    const { fromMs, toMs } = dayBounds(short)
    /* half an hour either side of the jump: on the clock it runs from h-½ to h+1½ */
    const [b] = lane([sitting(short, [skipped - 1, 30], [skipped + 1, 30])], fromMs, toMs, toMs)
    expect(b.left).toBeCloseTo(onDial(skipped - 0.5), 10)
    expect(b.width).toBeCloseTo(onDial(2), 10)
    expect(b.ms).toBe(3_600_000)
  })

  it('the clock marker at nine is on the 9a line too', () => {
    for (const day of [short, long]) {
      const { fromMs, toMs } = dayBounds(day)
      expect(nowAt(fromMs, toMs, at(day, 9)), day).toBeCloseTo(onDial(9), 10)
    }
  })

  it('and an ordinary day is drawn exactly as it always was', () => {
    const day = '2026-06-10'
    const { fromMs, toMs } = dayBounds(day)
    const s = sitting(day, [9, 15], [11, 0])
    const [b] = lane([s], fromMs, toMs, toMs)
    const width = toMs - fromMs
    expect(b.left).toBeCloseTo(((Date.parse(s.start) - fromMs) / width) * 100, 10)
    expect(b.width).toBeCloseTo((overlapMs(s, fromMs, toMs, toMs) / width) * 100, 10)
    expect(nowAt(fromMs, toMs, at(day, 18))).toBeCloseTo(75, 10)
  })
})
