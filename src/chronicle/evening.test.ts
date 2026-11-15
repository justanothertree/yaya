import { describe, expect, it } from 'vitest'
import {
  biggestStretch,
  EVENING,
  isEvening,
  nextEdge,
  readWrap,
  STRETCH_MIN_MS,
  unrated,
  writeWrap,
} from './evening'
import { dayBounds, type Entry } from './record'

/**
 * The evening wrap-up's three questions, each written as a day somebody had.
 *
 * Times are local wall-clock readings on one ordinary day (Tuesday 10 November 2026, no clock
 * change), built with `new Date(y, m, d, h, min)`, so "a gap from ten to one" means that in any
 * timezone the suite runs in. The window is that day's own `dayBounds`.
 */
const DAY = '2026-11-10'
const { fromMs, toMs } = dayBounds(DAY)
const t = (h: number, m = 0) => new Date(2026, 10, 10, h, m)
const iso = (h: number, m = 0) => t(h, m).toISOString()
const NINE_PM = t(21).getTime()

const ent = (
  id: string,
  from: [number, number?],
  to: [number, number?] | null,
  over: Partial<Entry> = {},
): Entry => ({
  id,
  activity: 'draw',
  start: iso(...from),
  end: to ? iso(...to) : null,
  notes: [],
  picture: null,
  amount: null,
  quality: null,
  ...over,
})

describe('when it is the evening', () => {
  it('starts at eight and runs to midnight', () => {
    expect(EVENING).toBe(20)
    expect(isEvening(t(19, 59).getTime())).toBe(false)
    expect(isEvening(t(20).getTime())).toBe(true)
    expect(isEvening(t(23, 59).getTime())).toBe(true)
  })

  it('is over by the small hours, so it is gone by morning', () => {
    expect(isEvening(new Date(2026, 10, 11, 0, 30).getTime())).toBe(false)
    expect(isEvening(new Date(2026, 10, 11, 7).getTime())).toBe(false)
  })
})

describe('the sittings to rate', () => {
  const acts = [
    { id: 'draw', auto: false },
    { id: 'gym', auto: false },
    { id: 'site', auto: true },
  ]

  it('asks about every finished, unrated sitting of the day, the earliest first', () => {
    const log = [
      ent('late', [18], [19]),
      ent('early', [9], [10], { activity: 'gym' }),
      ent('rated', [11], [12], { quality: 4 }),
    ]
    expect(unrated(log, acts, fromMs, toMs).map((e) => e.id)).toEqual(['early', 'late'])
  })

  it('does not ask about one still running, or one the site wrote', () => {
    const log = [ent('running', [20], null), ent('visit', [14], [15], { activity: 'site' })]
    expect(unrated(log, acts, fromMs, toMs)).toEqual([])
  })

  it('leaves last night’s to last night, even when it ran past midnight', () => {
    const lastNight: Entry = {
      ...ent('x', [0], [1]),
      start: new Date(2026, 10, 9, 23, 0).toISOString(),
    }
    expect(unrated([lastNight], acts, fromMs, toMs)).toEqual([])
  })

  it('stops asking about one you skipped', () => {
    const log = [ent('a', [9], [10]), ent('b', [11], [12])]
    expect(unrated(log, acts, fromMs, toMs, new Set(['a'])).map((e) => e.id)).toEqual(['b'])
  })
})

describe('the biggest stretch with nothing written down', () => {
  it('finds the longest gap between two sittings', () => {
    /* 9–10, then 13–14, then 15–16: the morning gap is three hours, the afternoon one is one */
    const log = [ent('a', [9], [10]), ent('b', [13], [14]), ent('c', [15], [16])]
    expect(biggestStretch(log, fromMs, toMs, NINE_PM)).toEqual({
      fromMs: t(10).getTime(),
      toMs: t(13).getTime(),
    })
  })

  it('measures from the end of everything covering a moment, not from each sitting', () => {
    /* 9–12 with a call 10–11 inside it: the gap after is from twelve, not from eleven */
    const log = [ent('work', [9], [12]), ent('call', [10], [11]), ent('gym', [15], [16])]
    expect(biggestStretch(log, fromMs, toMs, NINE_PM)).toEqual({
      fromMs: t(12).getTime(),
      toMs: t(15).getTime(),
    })
  })

  it('offers nothing before the first sitting or after the last', () => {
    /* the night before nine is sleep, and nine o'clock till now is the room's own hole line */
    expect(biggestStretch([ent('a', [9], [10])], fromMs, toMs, NINE_PM)).toBeNull()
    expect(biggestStretch([], fromMs, toMs, NINE_PM)).toBeNull()
  })

  it('calls a short pause a pause', () => {
    /* twenty minutes between two sittings is under the half hour */
    const log = [ent('a', [9], [10]), ent('b', [10, 20], [11])]
    expect(STRETCH_MIN_MS).toBe(30 * 60_000)
    expect(biggestStretch(log, fromMs, toMs, NINE_PM)).toBeNull()
    /* and exactly half an hour is a stretch */
    const half = [ent('a', [9], [10]), ent('b', [10, 30], [11])]
    expect(biggestStretch(half, fromMs, toMs, NINE_PM)).toEqual({
      fromMs: t(10).getTime(),
      toMs: t(10, 30).getTime(),
    })
  })

  it('counts the sitting still running up to now, and nothing after now', () => {
    /* 9–10, then one started at 12 and still going at 21:00, then nothing */
    const log = [ent('a', [9], [10]), ent('b', [12], null)]
    expect(biggestStretch(log, fromMs, toMs, NINE_PM)).toEqual({
      fromMs: t(10).getTime(),
      toMs: t(12).getTime(),
    })
  })

  it('takes a sitting from last night as covering this day only from midnight', () => {
    /* 22:00 yesterday to 01:00, then 05:00–06:00: the gap is one to five */
    const yest: Entry = { ...ent('y', [0], [1]), start: new Date(2026, 10, 9, 22).toISOString() }
    const log = [yest, ent('a', [5], [6])]
    expect(biggestStretch(log, fromMs, toMs, NINE_PM)).toEqual({
      fromMs: t(1).getTime(),
      toMs: t(5).getTime(),
    })
  })
})

describe('when the card next has to change, on a page nobody touches', () => {
  it('is eight tonight, any time before eight', () => {
    expect(nextEdge(t(7, 30).getTime())).toBe(t(20).getTime())
    expect(nextEdge(t(19, 59).getTime())).toBe(t(20).getTime())
    expect(nextEdge(new Date(2026, 10, 10, 0, 0).getTime())).toBe(t(20).getTime())
  })

  it('is midnight once it is eight, when the card has to go', () => {
    const midnight = new Date(2026, 10, 11).getTime()
    expect(nextEdge(t(20).getTime())).toBe(midnight)
    expect(nextEdge(t(23, 59).getTime())).toBe(midnight)
  })

  it('lands on eight and on midnight on the days the clocks change', () => {
    /* US clocks: back on 1 November 2026, forward on 14 March 2027 */
    for (const [y, m, d] of [
      [2026, 10, 1],
      [2027, 2, 14],
    ]) {
      const eight = new Date(nextEdge(new Date(y, m, d, 12).getTime()))
      expect([eight.getDate(), eight.getHours(), eight.getMinutes()]).toEqual([d, 20, 0])
      const mid = new Date(nextEdge(new Date(y, m, d, 21).getTime()))
      expect([mid.getDate(), mid.getHours(), mid.getMinutes()]).toEqual([d + 1, 0, 0])
    }
  })
})

describe('what the card remembers about an evening', () => {
  it('remembers a skip, and then another, for that date', () => {
    const one = writeWrap(null, DAY, { skip: 'a' })
    const two = writeWrap(one, DAY, { skip: 'b' })
    expect([...readWrap(two, DAY).skip]).toEqual(['a', 'b'])
    expect(readWrap(two, DAY).off).toBe(false)
  })

  it('remembers Not tonight alongside the skips', () => {
    const m = writeWrap(writeWrap(null, DAY, { skip: 'a' }), DAY, { off: true })
    expect(readWrap(m, DAY)).toEqual({ off: true, skip: new Set(['a']) })
    /* and a skip written after Not tonight does not undo it */
    const later = writeWrap(writeWrap(null, DAY, { off: true }), DAY, { skip: 'b' })
    expect(readWrap(later, DAY)).toEqual({ off: true, skip: new Set(['b']) })
  })

  it('forgets all of it the next day, and starts that day afresh', () => {
    const tonight = writeWrap(writeWrap(null, DAY, { off: true }), DAY, { skip: 'a' })
    expect(readWrap(tonight, '2026-11-11')).toEqual({ off: false, skip: new Set() })
    expect(readWrap(writeWrap(tonight, '2026-11-11', { skip: 'b' }), '2026-11-11')).toEqual({
      off: false,
      skip: new Set(['b']),
    })
  })

  it('reads anything it cannot understand as an evening with nothing remembered', () => {
    for (const raw of [null, '', 'not json', '[]', '42', '{"on":"2026-11-10","skip":"a"}'])
      expect(readWrap(raw, DAY).skip.size, String(raw)).toBe(0)
    expect(readWrap('{"on":"2026-11-10","off":"yes"}', DAY).off).toBe(false)
  })
})
