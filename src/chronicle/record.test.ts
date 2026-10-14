import { describe, expect, it } from 'vitest'
import {
  amountIn,
  clockText,
  metSession,
  moodOf,
  moodWord,
  MOODS,
  COLOURS,
  dayBounds,
  gapSince,
  sitting,
  lane,
  localMidnight,
  nowAt,
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
    session: null,
  },
  {
    id: 'a2',
    name: 'Dishes',
    cat: 'life',
    colour: null,
    archived: false,
    auto: false,
    metric: null,
    session: null,
  },
  {
    id: 'a3',
    name: 'Work',
    cat: 'locked',
    colour: null,
    archived: false,
    auto: false,
    metric: null,
    session: null,
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

describe('whether a sitting was long enough to be one', () => {
  const NOW_T = at('2026-10-12T12:00:00Z')
  const sit = (fromISO: string, toISO: string | null) => entry({ start: fromISO, end: toISO })

  it('says nothing at all when the activity asks for nothing', () => {
    expect(metSession(sit('2026-10-12T09:00:00Z', '2026-10-12T09:05:00Z'), null, NOW_T)).toBeNull()
    expect(metSession(sit('2026-10-12T09:00:00Z', '2026-10-12T09:05:00Z'), 0, NOW_T)).toBeNull()
  })

  it('and judges a finished sitting against the line', () => {
    expect(metSession(sit('2026-10-12T09:00:00Z', '2026-10-12T09:20:00Z'), 30, NOW_T)).toBe(false)
    expect(metSession(sit('2026-10-12T09:00:00Z', '2026-10-12T09:30:00Z'), 30, NOW_T)).toBe(true)
    expect(metSession(sit('2026-10-12T09:00:00Z', '2026-10-12T09:35:00Z'), 30, NOW_T)).toBe(true)
  })

  /**
   * ⚠️ THE ONE THAT MATTERS. Five minutes into a thirty-minute target you have not failed, you are
   * five minutes in — and `false` here would put a reproach on screen for the whole first half of
   * every sitting, which is the opposite of what a target like this is for. It stays silent until
   * you pass the line, then says yes, and can only say no once you have actually stopped.
   */
  it('and a sitting still running is never short — only not there yet', () => {
    const young = sit('2026-10-12T11:55:00Z', null) /* five minutes in */
    expect(metSession(young, 30, NOW_T)).toBeNull()
    const grown = sit('2026-10-12T11:00:00Z', null) /* an hour in */
    expect(metSession(grown, 30, NOW_T)).toBe(true)
    /* and the moment it stops at five minutes, it is short */
    expect(metSession(sit('2026-10-12T11:55:00Z', '2026-10-12T12:00:00Z'), 30, NOW_T)).toBe(false)
  })

  /**
   * ⚠️ THE WHOLE SPAN, NOT THE OVERLAP, which is what keeps one sitting from getting two verdicts.
   * A session from 23:00 to 00:30 is ninety minutes of work seen from either day — but only sixty
   * of them fall on the first day and thirty on the second, so an overlap-based version calls it
   * long enough on the evening you did it and too short the next morning. Same sitting, opposite
   * answers, decided by which day you happened to open.
   */
  it('and a sitting across midnight gets one verdict, not one per day', () => {
    /* ⚠️ BUILT FROM LOCAL MIDNIGHT, not from a Z time. The first version of this fixture ran
       23:00Z to 00:30Z and crossed UTC midnight — which in this machine's timezone is an evening
       entirely inside one local day, so it crossed nothing and the overlap-versus-whole-span
       distinction was never exercised. A perturbation caught it: swapping the whole span for a
       day overlap left this test green. The day a session is attributed to is a LOCAL question,
       so a fixture about midnight has to be built from the local one. */
    const mid = localMidnight('2026-10-13').getTime()
    const night = sit(
      new Date(mid - 60 * 60_000).toISOString(),
      new Date(mid + 30 * 60_000).toISOString(),
    )
    expect(metSession(night, 60, NOW_T)).toBe(true)
    expect(metSession(night, 90, NOW_T)).toBe(true)
    expect(metSession(night, 120, NOW_T)).toBe(false)
  })

  it('and a backwards or unreadable span is short rather than a throw', () => {
    expect(metSession(sit('2026-10-12T10:00:00Z', '2026-10-12T09:00:00Z'), 30, NOW_T)).toBe(false)
    expect(metSession(sit('not a date', '2026-10-12T09:00:00Z'), 30, NOW_T)).toBe(false)
  })
})

describe('a day laid out as a strip', () => {
  const DAY = dayBounds('2026-10-12')
  const W = DAY.toMs - DAY.fromMs
  const h = (n: number) => DAY.fromMs + n * 3_600_000
  const at9 = new Date(h(9)).toISOString()
  const at10 = new Date(h(10)).toISOString()
  const span = (start: string, end: string | null, activity = 'a1') => ({ start, end, activity })

  /**
   * ⚠️ THE WIDTH IS THE OVERLAP, AND THAT IS THE WHOLE CLAIM. Every block's width as a fraction of
   * the day must be exactly what `overlapMs` reports for the same span — otherwise the strip and
   * the minutes printed beside it in the log are two answers to one question, and the strip is the
   * one nobody can check by eye. Asserting a pixel would test the arithmetic twice; this tests
   * that the two readings agree.
   */
  it('gives every block the width its own overlap says, to the millisecond', () => {
    const spans = [
      span(at9, at10),
      span(new Date(h(14)).toISOString(), new Date(h(14.5)).toISOString()),
      /* starts on the day before and runs into this one */
      span(new Date(h(-2)).toISOString(), new Date(h(1)).toISOString()),
      /* starts on this day and runs into the next */
      span(new Date(h(23)).toISOString(), new Date(h(25)).toISOString()),
    ]
    const blocks = lane(spans, DAY.fromMs, DAY.toMs, h(12))
    expect(blocks).toHaveLength(4)
    blocks.forEach((b, i) => {
      expect((b.width / 100) * W).toBeCloseTo(overlapMs(spans[i], DAY.fromMs, DAY.toMs, h(12)), 6)
    })
  })

  it('and places a nine-to-ten session where nine to ten is', () => {
    const [b] = lane([span(at9, at10)], DAY.fromMs, DAY.toMs, h(12))
    expect(b.left).toBeCloseTo(37.5, 10) /* 9/24 */
    expect(b.width).toBeCloseTo(100 / 24, 10)
    expect(b.cut).toBe(false)
  })

  /**
   * ⚠️ A BLOCK MAY NEVER LEAVE THE STRIP. A span that starts before the day or ends after it is
   * clipped to the edge, not drawn hanging off one — and the flag says so, because a block pinned
   * to the right edge is otherwise indistinguishable from a session that happened to stop at
   * midnight.
   */
  it('and clips to the day at both ends, saying so', () => {
    const before = lane(
      [span(new Date(h(-2)).toISOString(), new Date(h(1)).toISOString())],
      DAY.fromMs,
      DAY.toMs,
      h(12),
    )[0]
    expect(before.left).toBe(0)
    expect(before.width).toBeCloseTo(100 / 24, 10)
    expect(before.cut).toBe(true)

    const after = lane(
      [span(new Date(h(23)).toISOString(), new Date(h(25)).toISOString())],
      DAY.fromMs,
      DAY.toMs,
      h(12),
    )[0]
    expect(after.left + after.width).toBeCloseTo(100, 10)
    expect(after.cut).toBe(true)
  })

  it('and never produces a block outside nought to a hundred', () => {
    const spans = [
      span(new Date(h(-30)).toISOString(), new Date(h(30)).toISOString()),
      span(new Date(h(23.9)).toISOString(), new Date(h(26)).toISOString()),
      span(new Date(h(-1)).toISOString(), new Date(h(0.1)).toISOString()),
    ]
    for (const b of lane(spans, DAY.fromMs, DAY.toMs, h(12))) {
      expect(b.left).toBeGreaterThanOrEqual(0)
      expect(b.width).toBeGreaterThan(0)
      expect(b.left + b.width).toBeLessThanOrEqual(100 + 1e-9)
    }
  })

  /** ⚠️ a running session reaches the clock it is handed and no further — not the end of the day */
  it('and a running session stops at now, not at midnight', () => {
    const [b] = lane([span(new Date(h(11)).toISOString(), null)], DAY.fromMs, DAY.toMs, h(12))
    expect(b.width).toBeCloseTo(100 / 24, 10)
    expect(b.left + b.width).toBeCloseTo(50, 10)
    expect(b.cut).toBe(false)
  })

  it('and a span that misses the day entirely draws nothing', () => {
    const miss = span(new Date(h(30)).toISOString(), new Date(h(31)).toISOString())
    expect(lane([miss], DAY.fromMs, DAY.toMs, h(12))).toEqual([])
    const junk = span('not a date', at10)
    expect(lane([junk], DAY.fromMs, DAY.toMs, h(12))).toEqual([])
    const backwards = span(at10, at9)
    expect(lane([backwards], DAY.fromMs, DAY.toMs, h(12))).toEqual([])
  })

  /**
   * ⚠️ NULL WHEN THE CLOCK IS NOT IN THIS DAY. A marker pinned to one end of every past day reads
   * as something that happened at midnight, and on a future day it would claim the day had
   * already begun.
   */
  it('and the now-marker only exists on the day that is now', () => {
    expect(nowAt(DAY.fromMs, DAY.toMs, h(6))).toBeCloseTo(25, 10)
    expect(nowAt(DAY.fromMs, DAY.toMs, h(-1))).toBeNull()
    expect(nowAt(DAY.fromMs, DAY.toMs, h(25))).toBeNull()
  })
})

describe('the colours an activity may be given', () => {
  /**
   * ⚠️ A TYPO HERE IS INVISIBLE RATHER THAN BROKEN. The colour is handed to `background:` on a
   * 9px dot, so "#3d9ae" or "3d9ae5" renders as nothing at all — no error, no warning, just an
   * activity that silently has no dot while its row says it has a colour. That is the same
   * write-without-read shape the room has been bitten by three times, so the list is checked
   * rather than trusted.
   */
  it('is all six-digit hex', () => {
    for (const c of COLOURS) expect(c, c).toMatch(/^#[0-9a-f]{6}$/)
  })

  it('offers no colour twice', () => {
    expect(new Set(COLOURS).size).toBe(COLOURS.length)
  })

  /**
   * ⚠️ MID-LUMINANCE, BECAUSE THE SITE HAS A NEAR-BLACK CARD AND A LIGHT THEME. A colour that is
   * nearly black vanishes on one and a colour that is nearly white vanishes on the other, and
   * nothing on screen would tell you which had happened. Measured as relative luminance rather
   * than by eye, against a band that both backgrounds sit outside.
   */
  it('is readable against a dark card and a light one', () => {
    const lum = (hex: string) => {
      const ch = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
      const lin = ch.map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
      return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]
    }
    for (const c of COLOURS) {
      expect(lum(c), `${c} is too dark for a dark card`).toBeGreaterThan(0.08)
      expect(lum(c), `${c} is too pale for a light page`).toBeLessThan(0.75)
    }
  })
})

describe('how long nothing has been recorded', () => {
  const t = (h: number, m = 0) => new Date(2026, 9, 13, h, m).toISOString()
  const now = new Date(2026, 9, 13, 21, 0).getTime() /* nine in the evening */
  const sat = (from: string, to: string | null, activity = 'a1') => ({
    activity,
    start: from,
    end: to,
  })

  /**
   * ⚠️ THE FACT A CLOCK CANNOT GIVE YOU. "The timer is stopped" is visible — the Start button is
   * right there. The useful half is that it is nine at night and nothing has been written down
   * since lunch, which is the hole `⏱ Fill a gap` exists to close.
   */
  it('counts from the end of the last thing that finished', () => {
    const g = gapSince([sat(t(9), t(10)), sat(t(12), t(13), 'a2')], now)
    expect(g).not.toBe(null)
    /* one in the afternoon to nine in the evening is eight hours */
    expect(g!.ms).toBe(8 * 3_600_000)
    expect(g!.activity).toBe('a2')
  })

  it('takes the latest end, not the last in the list', () => {
    const g = gapSince([sat(t(12), t(13), 'late'), sat(t(9), t(10), 'early')], now)
    expect(g!.activity).toBe('late')
  })

  /** there is no gap while you are in the middle of something */
  it('is nothing at all while a session is running', () => {
    expect(gapSince([sat(t(9), t(10)), sat(t(20), null)], now)).toBe(null)
  })

  it('is nothing when the day holds nothing yet', () => {
    expect(gapSince([], now)).toBe(null)
  })

  /**
   * ⚠️ A SESSION THAT HAS NOT ENDED YET IS NOT A GAP EITHER. An entry whose end is in the future
   * — a plan turned into time ahead of itself, or a clock that disagrees — would otherwise produce
   * a negative gap, which renders as "-14m since Gym".
   */
  it('ignores an end that has not happened yet', () => {
    const g = gapSince([sat(t(9), t(10), 'done'), sat(t(22), t(23), 'ahead')], now)
    expect(g!.activity).toBe('done')
    expect(g!.ms).toBe(11 * 3_600_000)
  })

  it('is zero at the moment something stops', () => {
    const g = gapSince([sat(t(20), t(21))], now)
    expect(g!.ms).toBe(0)
  })
})

describe('how far through a sitting is', () => {
  /**
   * ⚠️ THE TARGET ONLY EVER SPOKE AFTERWARDS. `metSession` marks a finished session SHORT, so the
   * room could say "you stopped early" and never "you are nearly there" — the wrong half, since
   * one is a verdict and the other is a reason to keep going.
   */
  it('says nothing when the activity has no intended length', () => {
    expect(sitting(20, null)).toBe(null)
    expect(sitting(20, 0)).toBe(null)
    expect(sitting(20, -5)).toBe(null)
  })

  it('is half way at half the length', () => {
    const s = sitting(15, 30)!
    expect(s.pct).toBeCloseTo(50, 6)
    expect(s.over).toBe(false)
    expect(s.left).toBe(15)
  })

  it('starts at nothing with nothing left off it', () => {
    const s = sitting(0, 30)!
    expect(s.pct).toBe(0)
    expect(s.over).toBe(false)
    expect(s.left).toBe(30)
  })

  it('is met exactly at the target, not a minute after', () => {
    const s = sitting(30, 30)!
    expect(s.over).toBe(true)
    expect(s.pct).toBe(100)
    expect(s.left).toBe(0)
  })

  /**
   * ⚠️ THE CLAMP IS ON THE BAR AND NOT ON THE FACT. A bar drawn past its own end is a rendering
   * fault; a sitting that ran long is an ordinary and good thing, so `over` has to survive where
   * `pct` stops.
   */
  it('stops the bar at the end and keeps saying it is past it', () => {
    const s = sitting(90, 30)!
    expect(s.pct).toBe(100)
    expect(s.over).toBe(true)
    expect(s.left).toBe(0)
  })

  it('never reports negative time left', () => {
    for (const mins of [31, 60, 1440]) expect(sitting(mins, 30)!.left).toBe(0)
  })
})
