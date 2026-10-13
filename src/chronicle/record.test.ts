import { describe, expect, it } from 'vitest'
import {
  amountIn,
  clockText,
  moodOf,
  moodWord,
  MOODS,
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
  amount: null,
  quality: null,
  ...over,
})

const acts: Activity[] = [
  {
    id: 'a1',
    name: 'Drawing',
    cat: 'free',
    colour: null,
    archived: false,
    auto: false,
    metric: null,
  },
  {
    id: 'a2',
    name: 'Dishes',
    cat: 'life',
    colour: null,
    archived: false,
    auto: false,
    metric: null,
  },
  {
    id: 'a3',
    name: 'Work',
    cat: 'locked',
    colour: null,
    archived: false,
    auto: false,
    metric: null,
  },
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

describe('a quantity, which does not split the way the minutes do', () => {
  /**
   * ⚠️ THE CLAIM IS ABOUT THE WORLD, NOT ABOUT THE FUNCTION: a session of writing that runs from
   * eleven at night to half past midnight is ninety minutes spread over two days and FOUR PAGES
   * ONCE. The minutes are asked about with `overlapMs` and the pages with `amountIn`, and the
   * test asserts that pairing rather than either one alone — because each was individually right
   * while the screen was wrong. The day list showed the pages on both days.
   *
   * ⚠️ AND IT SWEEPS A TILING RATHER THAN CHECKING TWO FIXTURES, the same shape as the overlap
   * test above it: over any set of windows that tile the range, the minutes sum to the session's
   * length and the quantity appears exactly once. A pair of hand-picked days would agree with a
   * rule that said "the first day wins" and with one that said "whichever day I looked at".
   */
  const night = entry({
    start: '2026-10-09T23:00:00.000Z',
    end: '2026-10-10T00:30:00.000Z',
    amount: 4,
  })

  /* the five UTC days around it, as a tiling — these are UTC rather than local on purpose, so the
     sweep is a tiling of instants and does not re-ask the local-midnight question dayBounds owns */
  const days = [8, 9, 10, 11, 12].map((d) => {
    const from = at(`2026-10-${String(d).padStart(2, '0')}T00:00:00.000Z`)
    return { from, to: from + 86_400_000 }
  })

  it('splits the minutes across the days it touches', () => {
    const mins = days.map((w) => overlapMs(night, w.from, w.to, NOW))
    expect(mins.filter((m) => m > 0)).toHaveLength(2)
    expect(mins.reduce((a, b) => a + b, 0)).toBe(90 * 60_000)
  })

  it('and gives the quantity to exactly one of them — the day it began', () => {
    const got = days.map((w) => amountIn(night, w.from, w.to))
    /* four pages, once, and on the ninth rather than the tenth */
    expect(got).toEqual([null, 4, null, null, null])
    expect(got.filter((x) => x != null).reduce((a, b) => a + b!, 0)).toBe(4)
  })

  it('and a session with no quantity has nothing to give', () => {
    const plain = entry({ start: '2026-10-09T23:00:00.000Z', end: '2026-10-10T00:30:00.000Z' })
    expect(days.map((w) => amountIn(plain, w.from, w.to))).toEqual([null, null, null, null, null])
  })

  /** ⚠️ a running session's quantity still belongs to the day it started, end or no end */
  it('and a running session still answers for the day it started', () => {
    const live = entry({ start: '2026-10-09T23:00:00.000Z', end: null, amount: 2 })
    expect(days.map((w) => amountIn(live, w.from, w.to))).toEqual([null, 2, null, null, null])
  })

  it('and an unreadable start gives nothing rather than a number on the wrong day', () => {
    const junk = entry({ start: 'not a date', amount: 9 })
    expect(days.map((w) => amountIn(junk, w.from, w.to))).toEqual([null, null, null, null, null])
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

describe('how a window went', () => {
  /**
   * ⚠️ THE PROPERTY, NOT THE NUMBERS. Every minute the server reports has to land in exactly one
   * bucket, so good + fine + rough + unrated is the whole window — always, for any input. A bucket
   * rule with a gap in it loses time SILENTLY, which is how a reading of your own month becomes
   * quietly wrong: forget that 3 is a rating and three hours of fine work simply stop existing.
   * Asserting particular totals would agree with a rule that dropped a bucket; asserting the
   * tiling cannot.
   */
  it('divides every minute into exactly one bucket, whatever the ratings are', () => {
    const windows: Record<string, number>[] = [
      { '1': 10, '2': 20, '3': 30, '4': 40, '5': 50, none: 60 },
      { '3': 7 },
      { none: 99 },
      { '5': 1, '1': 1 },
      {},
    ]
    for (const w of windows) {
      const m = moodOf(w)
      const whole = Object.values(w).reduce((a, b) => a + b, 0)
      expect(m.good + m.fine + m.rough + m.unrated).toBe(whole)
      expect(m.rated).toBe(m.good + m.fine + m.rough)
      expect(m.rated + m.unrated).toBe(whole)
    }
  })

  it('and puts 4 and 5 with the good, 3 on its own, 1 and 2 with the rough', () => {
    expect(moodOf({ '1': 1, '2': 2, '3': 4, '4': 8, '5': 16 })).toEqual({
      good: 24,
      fine: 4,
      rough: 3,
      unrated: 0,
      rated: 31,
    })
  })

  /** ⚠️ a window nobody rated is not an empty window — the hours were still spent */
  it('and an unrated window reports its hours as unrated rather than as nothing', () => {
    expect(moodOf({ none: 180 })).toEqual({
      good: 0,
      fine: 0,
      rough: 0,
      unrated: 180,
      rated: 0,
    })
  })

  it('and nothing at all is all zeroes rather than a throw', () => {
    const empty = { good: 0, fine: 0, rough: 0, unrated: 0, rated: 0 }
    expect(moodOf({})).toEqual(empty)
    expect(moodOf(null)).toEqual(empty)
    expect(moodOf(undefined)).toEqual(empty)
    /* and junk from somewhere else cannot make a total smaller */
    expect(moodOf({ '4': -5, '9': 100, none: 10 } as Record<string, number>)).toEqual({
      good: 0,
      fine: 0,
      rough: 0,
      unrated: 10,
      rated: 0,
    })
  })

  /**
   * ⚠️ THE ROW'S WORD AND THE AGGREGATE'S BUCKETS ARE THE SAME RULE, and this is what keeps them
   * so. A log row saying "good" beside a month that counts that session as fine is two answers to
   * one question, and it is the kind of disagreement nobody notices until they are counting on it.
   */
  it('and the word on a row agrees with the bucket in the total, for all five', () => {
    for (const [n] of MOODS) {
      const m = moodOf({ [String(n)]: 10 })
      const word = moodWord(n)
      expect(word).not.toBeNull()
      expect(m[word as 'good' | 'fine' | 'rough']).toBe(10)
    }
    expect(moodWord(null)).toBeNull()
  })
})
