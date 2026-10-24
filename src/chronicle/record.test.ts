import { describe, expect, it } from 'vitest'
import {
  blockAt,
  type Block,
  clockOfLocal,
  readLocal,
  writeLocal,
  COLOURS,
  MOODS,
  amountIn,
  clockText,
  countText,
  coveredMs,
  coveredPct,
  dayBounds,
  gapSince,
  lane,
  localMidnight,
  metSession,
  minsBetweenLocal,
  minutesByActivity,
  minutesByCat,
  moodOf,
  moodWord,
  nowAt,
  nudgeLocal,
  overlapMs,
  sitting,
  spanText,
  straddles,
  type Activity,
  type Entry,
  type Span,
} from './record'

const at = (iso: string) => new Date(iso).getTime()

const entry = (over: Partial<Entry> = {}): Entry => ({
  id: 'e1',
  activity: 'a1',
  start: '2026-10-12T09:00:00.000Z',
  end: '2026-10-12T10:00:00.000Z',
  note: null,
  notes: [],
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
    shared: false,
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
    shared: false,
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
    shared: false,
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

  /**
   * ⚠️ AND THE CLOCK TIMES ARE THE THIRD HALF OF THE SAME RULE. The minutes split and the
   * quantity does not; the times said the whole sitting on both days, so each row read "1h"
   * beside a two-hour range. Asserted over the days this session actually touches, because that
   * is the only question the log ever asks: it is handed the rows for a day and renders them.
   */
  it('marks the end of the sitting that is in another day, on each day it touches', () => {
    const touched = days.filter((w) => overlapMs(night, w.from, w.to, NOW) > 0)
    expect(touched).toHaveLength(2)
    /* the day it began: it started here, and it finished somewhere else */
    expect(straddles(night, touched[0].from, touched[0].to, NOW)).toEqual({
      before: false,
      after: true,
    })
    /* the day it ended: it began somewhere else, and it finished here */
    expect(straddles(night, touched[1].from, touched[1].to, NOW)).toEqual({
      before: true,
      after: false,
    })
  })

  it('and marks neither end of a sitting that began and ended inside the day', () => {
    const inside = entry({ start: '2026-10-09T09:00:00.000Z', end: '2026-10-09T10:30:00.000Z' })
    const d = days[1]
    expect(straddles(inside, d.from, d.to, NOW)).toEqual({ before: false, after: false })
  })

  /**
   * ⚠️ THE BOUNDARY, WHICH IS THE WHOLE OF WHY THIS IS A FUNCTION. A sitting that ends exactly at
   * midnight ends inside the day it belongs to — `overlapMs` gives it none of the next day, so
   * marking it would name a day it never reached. The same at the other end: one that starts
   * exactly at midnight starts here, not before.
   */
  it('counts a sitting that ends exactly at midnight as ending inside its own day', () => {
    const d = days[1]
    const toMidnight = entry({ start: '2026-10-09T22:00:00.000Z', end: '2026-10-10T00:00:00.000Z' })
    expect(straddles(toMidnight, d.from, d.to, NOW).after).toBe(false)
    const fromMidnight = entry({
      start: '2026-10-09T00:00:00.000Z',
      end: '2026-10-09T02:00:00.000Z',
    })
    expect(straddles(fromMidnight, d.from, d.to, NOW).before).toBe(false)
  })

  /** ⚠️ a timer left running overnight reaches to NOW, which is how the log can say so */
  it('marks a running sitting that began on an earlier day', () => {
    const live = entry({ start: '2026-10-09T23:00:00.000Z', end: null })
    const next = days[2]
    const now = at('2026-10-10T08:00:00.000Z')
    expect(straddles(live, next.from, next.to, now)).toEqual({ before: true, after: false })
  })

  /**
   * ⚠️ AND THIS IS THE ONE THAT ACTUALLY ASKS ABOUT `nowMs`. The case above asserts only
   * `before`, which is decided by the START — so it passed unchanged when the running sitting's
   * reach was perturbed to zero, and the parameter under test was never exercised by it. A
   * sitting still going is only reaching PAST a day when you are reading an earlier one.
   */
  it('says a running sitting runs past the day you are reading, when it still has not stopped', () => {
    const live = entry({ start: '2026-10-09T23:00:00.000Z', end: null })
    const began = days[1]
    const now = at('2026-10-10T08:00:00.000Z')
    expect(straddles(live, began.from, began.to, now)).toEqual({ before: false, after: true })
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

/**
 * ⚠️ THE CLAIMS ARE ABOUT NOTATION, NOT ABOUT A COMMA. `toLocaleString` follows the reader's
 * locale — the group separator is a space in France and a full stop in Germany — so a test
 * demanding "20,000" would be asserting the machine it ran on rather than the rule. Each of these
 * strips the punctuation and asks what is left, which is true everywhere.
 */
describe('a quantity, written the way somebody would write it', () => {
  /** the one this exists for: the seed titles a goal "20,000 reps" and the meter said 20000 */
  it('groups a four-figure count instead of running the digits together', () => {
    const out = countText(20000)
    expect(out).not.toBe('20000')
    expect(out.replace(/\D/g, '')).toBe('20000')
    expect(out.length).toBeGreaterThan('20000'.length)
  })

  it('leaves a small number exactly as it is', () => {
    expect(countText(3)).toBe('3')
    expect(countText(0)).toBe('0')
    expect(countText(999)).toBe('999')
  })

  /** ⚠️ a fraction is a real answer — 2.5 km is a thing somebody records */
  it('keeps a fraction somebody actually entered', () => {
    expect(countText(2.5)).toMatch(/^2\D5$/)
  })

  /**
   * ⚠️ TWO PLACES, NOT THE PLATFORM'S THREE. The same rule `Looking` kept by hand and the meter
   * keeps for minutes: a number that trails off reads as broken rather than as nearly done.
   */
  it('cuts a long fraction to two places', () => {
    const out = countText(1.23456)
    expect(out.replace(/^\d+\D/, '')).toBe('23')
  })

  it('and groups and rounds at the same time', () => {
    const out = countText(12345.678)
    expect(out.replace(/\D/g, '')).toBe('1234568')
  })
})

describe('how much of a window has anything on it', () => {
  const MIN = 60_000
  const HOUR = 3_600_000
  const DAY_START = Date.parse('2026-03-10T00:00:00Z')
  const DAY_END = DAY_START + 24 * HOUR
  const AFTER = DAY_END + HOUR
  const hh = (h: number, m = 0) => new Date(DAY_START + h * HOUR + m * MIN).toISOString()
  const span = (from: number, to: number | null): Span => ({
    start: hh(from),
    end: to == null ? null : hh(to),
  })

  /**
   * ⚠️ THE INDEPENDENT PATH, and the only reason the rest of this block is worth anything.
   *
   * It walks the window a minute at a time and asks each minute whether ANY span is over it — a
   * question with no sorting, no merging and no subtraction in it. `coveredMs` answers the same
   * question by clipping, sorting and merging. The two share the clock and nothing else, which is
   * what CLAUDE.md means by measuring through a path that shares no arithmetic: a test built from
   * the same sum as the code confirms the mistake, and the sum being replaced here was
   * `blocks.reduce((n, b) => n + b.width, 0)` — which a "test" could have agreed with exactly.
   */
  const byTheMinute = (spans: Span[], fromMs: number, toMs: number, nowMs: number): number => {
    let on = 0
    for (let t = fromMs; t < toMs; t += MIN) {
      const mid = t + MIN / 2
      const any = spans.some((s) => {
        const a = Date.parse(s.start)
        const b = s.end == null ? nowMs : Date.parse(s.end)
        return b > a && a <= mid && mid < b
      })
      if (any) on += MIN
    }
    return on
  }

  /**
   * The random days both sweeps below are built from — one generator, so the only thing that
   * differs between them is whether the ends land on a whole minute.
   */
  const roller = (start: number) => {
    let seed = start
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
    const snap = (t: number, whole: boolean) => (whole ? Math.round(t / MIN) * MIN : Math.round(t))
    return {
      /* ⚠️ the clock is snapped too when the day is: a tenth of these sessions are still
         RUNNING, so they are measured to this, and a fractional clock makes a fractional answer
         that the minute walk cannot match however the spans themselves are shaped */
      clock: (whole: boolean) => snap(DAY_START + rnd() * 24 * HOUR, whole),
      day: (whole: boolean): Span[] => {
        const out: Span[] = []
        for (let i = 0; i < 1 + Math.floor(rnd() * 7); i++) {
          /* deliberately allowed to start before the window and end after it */
          const a = snap(DAY_START - 3 * HOUR + rnd() * 30 * HOUR, whole)
          const len = snap(rnd() * 10 * HOUR, whole)
          out.push({
            start: new Date(a).toISOString(),
            end: rnd() < 0.1 ? null : new Date(a + len).toISOString(),
          })
        }
        return out
      },
    }
  }

  it('is the length of one session when there is only one', () => {
    expect(coveredMs([span(9, 17)], DAY_START, DAY_END, AFTER)).toBe(8 * HOUR)
  })

  it('is nothing at all on an empty window', () => {
    expect(coveredMs([], DAY_START, DAY_END, AFTER)).toBe(0)
    expect(coveredPct([], DAY_START, DAY_END, AFTER)).toBe(0)
  })

  /**
   * ⚠️ THE DAY THE OLD FIGURE GOT WRONG, kept as a case because it is an ordinary one rather than
   * a contrived one: a nine-to-five with a call in the middle of it and music over the whole lot.
   * The sum said 70.8% of the day. The day holds eight hours of it.
   */
  it('counts a minute once however many sessions are over it', () => {
    const day = [span(9, 17), span(11, 12), span(9, 17)]
    expect(coveredMs(day, DAY_START, DAY_END, AFTER)).toBe(8 * HOUR)
    expect(coveredPct(day, DAY_START, DAY_END, AFTER)).toBeCloseTo((8 / 24) * 100, 9)
  })

  /**
   * ⚠️ THE ONE THAT PROVES THE `b > hi` GUARD. 9–17 then 11–12 sort in that order, so the short
   * one is examined while the long one is being carried — assigning the end unconditionally would
   * shorten eight hours to two and report a figure SMALLER than the single session alone.
   */
  it('is not shortened by a session wholly inside another', () => {
    expect(coveredMs([span(9, 17), span(11, 12)], DAY_START, DAY_END, AFTER)).toBe(8 * HOUR)
    /* and the same pair the other way round, which is the order that never needed the guard */
    expect(coveredMs([span(11, 12), span(9, 17)], DAY_START, DAY_END, AFTER)).toBe(8 * HOUR)
  })

  it('joins two sessions that touch, and keeps a gap that is really there', () => {
    expect(coveredMs([span(9, 12), span(12, 15)], DAY_START, DAY_END, AFTER)).toBe(6 * HOUR)
    expect(coveredMs([span(9, 12), span(13, 15)], DAY_START, DAY_END, AFTER)).toBe(5 * HOUR)
  })

  /**
   * ⚠️ FOUR OVERLAPPING MORNING SITTINGS, which is the case the clamp turned from visibly broken
   * into confidently wrong: the sum reached 133%, the clamp made it exactly 100, and the month
   * grid printed "1,440 min recorded" about a day whose whole afternoon was empty.
   */
  it('cannot fill a day from a morning', () => {
    const morning = [span(0, 8), span(0, 8), span(0, 8), span(0, 8)]
    expect(coveredMs(morning, DAY_START, DAY_END, AFTER)).toBe(8 * HOUR)
    expect(coveredPct(morning, DAY_START, DAY_END, AFTER)).toBeCloseTo((8 / 24) * 100, 9)
  })

  /**
   * ⚠️ THE INVARIANT THE CLAMP WAS STANDING IN FOR. A union of stretches inside a window cannot
   * be longer than the window, for any set of spans at all — so there is nothing left to clamp,
   * and this says so over random data rather than over the three shapes above.
   */
  it('never exceeds the window it is measured over, over 400 random days', () => {
    const rolls = roller(20261016)
    for (let round = 0; round < 400; round++) {
      /**
       * ⚠️ SNAPPED TO THE MINUTE, AND THE FIRST RUN SAID WHY. Unsnapped, the walk reported
       * 6,480,000ms against 6,500,609 — a disagreement of 20,609, which is under one minute. That
       * is the WALK's limit and not the function's: it counts a minute if something is over the
       * middle of it, so a session ending twenty seconds into a minute cannot be measured by it.
       *
       * The cross-check is the valuable half of this sweep, so the data is shaped to let it be
       * exact rather than the comparison loosened to a tolerance — a tolerance of one minute per
       * boundary would have hidden a real error of the same size. Sub-minute ends are still swept
       * below, against the bound, which needs no second opinion to check.
       */
      const spans = rolls.day(true)
      const nowMs = rolls.clock(true)
      const got = coveredMs(spans, DAY_START, DAY_END, nowMs)
      expect(got).toBeGreaterThanOrEqual(0)
      expect(got).toBeLessThanOrEqual(DAY_END - DAY_START)
      expect(coveredPct(spans, DAY_START, DAY_END, nowMs)).toBeLessThanOrEqual(100)
      /* ⚠️ and against the independent walk — the claim this whole block rests on */
      expect(got).toBe(byTheMinute(spans, DAY_START, DAY_END, nowMs))
    }
  })

  /**
   * ⚠️ THE SAME SWEEP WITH SUB-MINUTE ENDS, asking only what can be asked without a second
   * opinion: a union of stretches inside a window is between nothing and the whole window, and is
   * never longer than the sum of the parts. Those hold at any precision.
   */
  it('stays inside its window and under the sum at any precision, over 400 more', () => {
    const rolls = roller(777000777)
    for (let round = 0; round < 400; round++) {
      const spans = rolls.day(false)
      const nowMs = rolls.clock(false)
      const got = coveredMs(spans, DAY_START, DAY_END, nowMs)
      const sum = spans.reduce((n, x) => n + overlapMs(x, DAY_START, DAY_END, nowMs), 0)
      expect(got).toBeGreaterThanOrEqual(0)
      expect(got).toBeLessThanOrEqual(DAY_END - DAY_START)
      expect(got).toBeLessThanOrEqual(sum)
      /* and a single span is worth exactly its own overlap, whatever the precision */
      for (const one of spans) {
        expect(coveredMs([one], DAY_START, DAY_END, nowMs)).toBe(
          overlapMs(one, DAY_START, DAY_END, nowMs),
        )
      }
    }
  })

  /**
   * ⚠️ THE UNION AND THE SUM, SIDE BY SIDE. They are the two questions this module now answers,
   * and the relation between them is the whole point: the union is never larger, and they agree
   * exactly when nothing overlaps. That second half is what stops the merge quietly swallowing
   * time that was never shared — a union that was always smaller would pass the first half alone.
   */
  it('is never more than the sum, and is exactly the sum when nothing overlaps', () => {
    const apart = [span(1, 2), span(5, 7), span(9, 10), span(20, 23)]
    const sum = apart.reduce((n, s) => n + overlapMs(s, DAY_START, DAY_END, AFTER), 0)
    expect(coveredMs(apart, DAY_START, DAY_END, AFTER)).toBe(sum)

    const shared = [...apart, span(6, 21)]
    const sum2 = shared.reduce((n, s) => n + overlapMs(s, DAY_START, DAY_END, AFTER), 0)
    expect(coveredMs(shared, DAY_START, DAY_END, AFTER)).toBeLessThan(sum2)
    expect(coveredMs(shared, DAY_START, DAY_END, AFTER)).toBe(
      byTheMinute(shared, DAY_START, DAY_END, AFTER),
    )
  })

  /**
   * ⚠️ MIDNIGHT, MEASURED THE WAY `overlapMs` IS — the sum of a span's coverage over windows that
   * tile a range is its length inside that range. A session from 23:00 to 01:00 is an hour of each
   * day, and the union has to keep that or the week grid's columns would stop adding up.
   */
  it('splits a session across midnight exactly as the sum does', () => {
    const across: Span = { start: hh(23), end: hh(25) }
    const a = coveredMs([across], DAY_START, DAY_END, AFTER)
    const b = coveredMs([across], DAY_END, DAY_END + 24 * HOUR, AFTER)
    expect(a).toBe(HOUR)
    expect(b).toBe(HOUR)
    expect(a + b).toBe(2 * HOUR)
  })

  it('measures a running session to the clock and no further', () => {
    const live = [span(9, null)]
    const nowMs = DAY_START + 11 * HOUR
    expect(coveredMs(live, DAY_START, DAY_END, nowMs)).toBe(2 * HOUR)
    /* and a second session finishing after the clock is still worth its whole self */
    expect(coveredMs([...live, span(13, 14)], DAY_START, DAY_END, nowMs)).toBe(3 * HOUR)
  })

  it('ignores a backwards session rather than subtracting it', () => {
    expect(coveredMs([{ start: hh(17), end: hh(9) }], DAY_START, DAY_END, AFTER)).toBe(0)
    expect(coveredMs([span(9, 10), { start: hh(17), end: hh(9) }], DAY_START, DAY_END, AFTER)).toBe(
      HOUR,
    )
  })

  it('ignores a session whose dates will not parse', () => {
    expect(coveredMs([{ start: 'not a date', end: hh(9) }], DAY_START, DAY_END, AFTER)).toBe(0)
  })

  /**
   * ⚠️ A DAY IS NOT ALWAYS 1440 MINUTES, which is the second thing the old figure got wrong:
   * `score.ts` divided by `DAY_MINS = 24 * 60`. `dayBounds` is already right — measured in New
   * York, 2026-03-08 is 1380 minutes and 2026-11-01 is 1500 — so taking the denominator from the
   * window makes a fully recorded short day read 100 rather than 95.8.
   */
  it('fills a short day to exactly full, and a long one too', () => {
    for (const on of ['2026-03-08', '2026-11-01', '2026-03-10']) {
      const b = dayBounds(on)
      const all: Span = {
        start: new Date(b.fromMs).toISOString(),
        end: new Date(b.toMs).toISOString(),
      }
      expect(coveredMs([all], b.fromMs, b.toMs, b.toMs + HOUR)).toBe(b.toMs - b.fromMs)
      expect(coveredPct([all], b.fromMs, b.toMs, b.toMs + HOUR)).toBe(100)
    }
  })

  it('has no opinion about a window with no width', () => {
    expect(coveredPct([span(9, 17)], DAY_START, DAY_START, AFTER)).toBe(0)
    expect(coveredMs([span(9, 17)], DAY_START, DAY_START, AFTER)).toBe(0)
  })
})

describe('nudging a datetime-local value', () => {
  it('moves by whole minutes and keeps the shape an input wants', () => {
    expect(nudgeLocal('2026-10-23T14:30', 15)).toBe('2026-10-23T14:45')
    expect(nudgeLocal('2026-10-23T14:30', -45)).toBe('2026-10-23T13:45')
  })

  it('carries across an hour, a day and a month', () => {
    expect(nudgeLocal('2026-10-23T23:50', 20)).toBe('2026-10-24T00:10')
    expect(nudgeLocal('2026-10-01T00:05', -10)).toBe('2026-09-30T23:55')
  })

  /**
   * ⚠️ THE HOUR THAT DOES NOT EXIST. On a US spring-forward 01:30 + 60 minutes is 03:30, because
   * 02:30 never happens, and this pins that behaviour.
   *
   * ⚠️ IT DOES NOT DISCRIMINATE BETWEEN THE TWO IMPLEMENTATIONS, and saying so is the point.
   * Perturbed to `setMinutes(getMinutes() + n)` it stays green — measured in America/New_York,
   * where both answer 03:30 — so this is a test of the BEHAVIOUR and not of the technique. An
   * earlier comment on `nudgeLocal` claimed the field version was broken; it is not, and the
   * perturbation is what said so rather than any amount of reading.
   *
   * Written against the runner's own zone so it means something wherever it runs: on a machine
   * with no spring-forward it collapses to "an hour later is an hour later", which is still
   * true and still worth asserting.
   */
  it('lands on the right side of a spring-forward', () => {
    const before = new Date(2026, 2, 8, 1, 30)
    const after = new Date(before.getTime() + 60 * 60_000)
    expect(nudgeLocal('2026-03-08T01:30', 60)).toBe(
      `2026-03-08T${String(after.getHours()).padStart(2, '0')}:${String(after.getMinutes()).padStart(2, '0')}`,
    )
    /* and the span is a real hour either way, which is the property that actually matters */
    expect(minsBetweenLocal('2026-03-08T01:30', nudgeLocal('2026-03-08T01:30', 60))).toBe(60)
  })

  /** the face the editor shows instead of two `datetime-local` boxes */
  it('reads a value back as a clock face, and says so when it cannot', () => {
    expect(clockOfLocal('2026-10-23T14:05')).toBe(
      new Date(2026, 9, 23, 14, 5).toLocaleTimeString(undefined, {
        hour: 'numeric',
        minute: '2-digit',
      }),
    )
    expect(clockOfLocal('')).toBe('—')
    expect(clockOfLocal('nope')).toBe('—')
  })

  /** ⚠️ a round trip, because the input hands back exactly what it was given and must survive it */
  it('writes back what it read', () => {
    for (const v of ['2026-01-01T00:00', '2026-12-31T23:59', '2026-06-15T09:07']) {
      expect(writeLocal(readLocal(v)!)).toBe(v)
    }
  })

  it('leaves nonsense alone rather than inventing a date', () => {
    expect(nudgeLocal('', 10)).toBe('')
    expect(nudgeLocal('not a date', 10)).toBe('not a date')
    expect(minsBetweenLocal('2026-10-23T14:30', '')).toBeNull()
  })

  /** ⚠️ not clamped — an end before a start is a thing to SAY, not to hide behind a zero */
  it('measures a backwards span as negative', () => {
    expect(minsBetweenLocal('2026-10-23T14:30', '2026-10-23T14:00')).toBe(-30)
    expect(minsBetweenLocal('2026-10-23T09:00', '2026-10-23T09:45')).toBe(45)
  })
})

describe('finding the block a tap meant', () => {
  const b = (id: string, left: number, width: number): Block => ({
    id,
    activity: 'a',
    left,
    width,
    cut: false,
  })
  /* 9am–10am and 2pm–2.30pm, as percentages of a day */
  const day = [b('morning', 37.5, 4.17), b('afternoon', 58.33, 2.08)]

  it('finds the one the tap landed inside', () => {
    expect(blockAt(day, 39)?.id).toBe('morning')
    expect(blockAt(day, 59)?.id).toBe('afternoon')
  })

  it('finds nothing in an empty stretch', () => {
    expect(blockAt(day, 10)).toBeNull()
    expect(blockAt(day, 50)).toBeNull()
    expect(blockAt(day, 95)).toBeNull()
  })

  /**
   * ⚠️ THE TOLERANCE IS THE WHOLE POINT. A half-hour block is 2% of a day, which at 240px is
   * five pixels — an exact containment test is a target nobody can hit. A percent either side is
   * about a quarter of an hour, which is roughly a fingertip.
   */
  it('forgives a tap just outside a thin block', () => {
    expect(blockAt(day, 37.0)?.id).toBe('morning')
    expect(blockAt(day, 42.3)?.id).toBe('morning')
    expect(blockAt(day, 35.5)).toBeNull()
  })

  /**
   * ⚠️ NEAREST, NOT FIRST, and the fixture is deliberately in the wrong order so that returning
   * `blocks[0]` cannot pass. With a tolerance two blocks can be in range at once, and taking
   * whichever came back from the server first makes the answer unpredictable to the person
   * tapping.
   */
  it('takes the nearer of two in range, whatever order they arrive in', () => {
    /* ⚠️ BOTH MUST BE IN RANGE AT ONCE OR THIS ASSERTS NOTHING. A first draft put them 2.5%
       apart, so the tolerance only ever admitted one and the test passed just as happily with
       `best === null` — "take the first" — in place of the distance comparison. The gap in the
       middle is 0.5%, so a tap in it is within 1% of both and only the nearer may win. */
    const pair = [b('below', 49.6, 1), b('above', 48, 1)]
    expect(blockAt(pair, 49.1)?.id).toBe('above') //  0.1 from above, 0.5 from below
    expect(blockAt(pair, 49.2)?.id).toBe('above') //  0.2 from above, 0.4 from below
    expect(blockAt(pair, 49.45)?.id).toBe('below') // 0.45 from above, 0.15 from below
    /* and reversing the array must not change either answer */
    expect(blockAt([...pair].reverse(), 49.1)?.id).toBe('above')
    expect(blockAt([...pair].reverse(), 49.45)?.id).toBe('below')
  })

  it('has nothing to find in an empty day', () => {
    expect(blockAt([], 50)).toBeNull()
  })
})
