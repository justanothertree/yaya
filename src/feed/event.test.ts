import { describe, expect, it } from 'vitest'
import {
  dayKeyOf,
  eventKey,
  feedSentence,
  groupByDay,
  mergeEvents,
  FEED_SCOPES,
  type FeedEvent,
  type FeedKind,
  type FeedScope,
} from './event'

/**
 * ⚠️ EVERY KIND, LISTED ONCE. A kind added to `FeedKind` and forgotten here is the failure this
 * file is for — the feed does not crash on one, it draws an empty row, which reads as missing
 * data rather than missing code. The annotation makes the compiler object before the test can.
 */
const KINDS: FeedKind[] = ['sitting', 'circuit_log', 'rating', 'snake_score', 'snake_trophy']

/** a local instant, built from parts so the test never depends on the runner's timezone */
const local = (y: number, mo: number, d: number, h: number, mi: number): string =>
  new Date(y, mo - 1, d, h, mi, 0, 0).toISOString()

const ev = (p: Partial<FeedEvent> & Pick<FeedEvent, 'kind' | 'id' | 'at'>): FeedEvent => ({
  who: 'sam',
  name: 'Sam',
  detail: 'Something',
  score: null,
  ...p,
})

describe('eventKey', () => {
  /**
   * The collision this is actually for: four tables mint their own ids, and a kudos keyed on a
   * bare id would put somebody's words about a workout under somebody else's film.
   */
  it('separates two kinds that share an id', () => {
    const a = eventKey({ kind: 'rating', id: 'same-id' })
    const b = eventKey({ kind: 'circuit_log', id: 'same-id' })
    expect(a).not.toBe(b)
  })

  it('gives one event one key, every time it is asked', () => {
    const e = { kind: 'sitting' as const, id: 'x' }
    expect(eventKey(e)).toBe(eventKey({ ...e }))
  })
})

describe('mergeEvents', () => {
  it('puts the newest first, across sources', () => {
    const old = ev({ kind: 'rating', id: 'r1', at: local(2026, 10, 1, 9, 0) })
    const mid = ev({ kind: 'sitting', id: 's1', at: local(2026, 10, 5, 9, 0) })
    const now = ev({ kind: 'snake_score', id: 'k1', at: local(2026, 10, 9, 9, 0) })
    const got = mergeEvents([old], [now], [mid]).map((e) => e.id)
    expect(got).toEqual(['k1', 's1', 'r1'])
  })

  it('keeps one copy when the same row arrives twice', () => {
    const e = ev({ kind: 'rating', id: 'r1', at: local(2026, 10, 1, 9, 0) })
    expect(mergeEvents([e], [{ ...e }])).toHaveLength(1)
  })

  it('keeps the copy that was passed first', () => {
    const first = ev({ kind: 'rating', id: 'r1', at: local(2026, 10, 1, 9, 0), detail: 'fresh' })
    const second = ev({ kind: 'rating', id: 'r1', at: local(2026, 10, 1, 9, 0), detail: 'stale' })
    expect(mergeEvents([first], [second])[0].detail).toBe('fresh')
  })

  /**
   * ⚠️ THE PROPERTY IS "THE READER SEES THE SAME ORDER", not "the sort is stable". Two events can
   * honestly share an instant — a circuit log and a rating are both stamped at a date with no
   * clock — and if the tie goes to whichever room answered first, the feed reshuffles under
   * somebody's thumb on every refresh. So: same events, sources in a different order, same list.
   */
  it('orders events sharing an instant the same way whatever order the rooms answer in', () => {
    const at = local(2026, 10, 5, 0, 0)
    const a = ev({ kind: 'rating', id: 'r1', at })
    const b = ev({ kind: 'circuit_log', id: 'c1', at })
    const c = ev({ kind: 'snake_score', id: 'k1', at })
    const one = mergeEvents([a], [b], [c]).map(eventKey)
    const two = mergeEvents([c], [a], [b]).map(eventKey)
    const three = mergeEvents([b, c, a]).map(eventKey)
    expect(two).toEqual(one)
    expect(three).toEqual(one)
  })

  it('answers an empty feed with an empty list rather than throwing', () => {
    expect(mergeEvents()).toEqual([])
    expect(mergeEvents([], [])).toEqual([])
  })
})

describe('dayKeyOf / groupByDay', () => {
  /**
   * ⚠️ MEASURED AGAINST THE LOCAL CLOCK, NOT AGAINST A SLICE OF THE STRING. `iso.slice(0, 10)` is
   * right for most of the day and wrong either side of midnight, and wrong here means a sitting
   * you did last night filed under tomorrow. The question is asked the way a person would ask
   * it: two things I did last night are on the same day; one after midnight is not.
   */
  it('puts two events either side of midnight in different days', () => {
    const before = ev({ kind: 'sitting', id: 'a', at: local(2026, 10, 5, 23, 59) })
    const after = ev({ kind: 'sitting', id: 'b', at: local(2026, 10, 6, 0, 1) })
    expect(dayKeyOf(before.at)).not.toBe(dayKeyOf(after.at))
    expect(groupByDay(mergeEvents([before, after]))).toHaveLength(2)
  })

  /**
   * ⚠️ THE TWO TESTS EITHER SIDE OF THIS ONE CANNOT FAIL ON A UTC RUNNER, which is where CI runs.
   * They build their instants from local parts, so where local IS UTC a string slice and a local
   * read agree exactly and the bug is invisible — a test that stops testing precisely in the
   * place nobody watches. This one carries its own offset instead: `01:00+14:00` is the previous
   * day everywhere from UTC-12 to UTC+13, so the slice and the truth disagree on any runner this
   * project will ever see.
   *
   * ⚠️ AND IT IS CHECKED THROUGH `Intl`, WHICH SHARES NO ARITHMETIC WITH THE FUNCTION. `en-CA`
   * formats as YYYY-MM-DD in local time; `dayKeyOf` reaches for getFullYear/getMonth/getDate.
   * Comparing the function against a second copy of its own sum would agree with it, including
   * when it is wrong — CLAUDE.md §2.
   */
  it('reads the local day even when the instant carries a far-away offset', () => {
    const iso = '2026-10-06T01:00:00+14:00'
    const viaIntl = new Date(iso).toLocaleDateString('en-CA')
    expect(dayKeyOf(iso)).toBe(viaIntl)
    expect(dayKeyOf(iso)).not.toBe(iso.slice(0, 10))
  })

  it('keeps a whole local day in one bucket, late evening included', () => {
    const morning = ev({ kind: 'sitting', id: 'a', at: local(2026, 10, 5, 7, 15) })
    const night = ev({ kind: 'rating', id: 'b', at: local(2026, 10, 5, 23, 45) })
    const days = groupByDay(mergeEvents([morning, night]))
    expect(days).toHaveLength(1)
    expect(days[0][1]).toHaveLength(2)
  })

  it('hands back days newest first, and each day newest first', () => {
    const d5a = ev({ kind: 'rating', id: 'a', at: local(2026, 10, 5, 8, 0) })
    const d5b = ev({ kind: 'rating', id: 'b', at: local(2026, 10, 5, 20, 0) })
    const d6 = ev({ kind: 'rating', id: 'c', at: local(2026, 10, 6, 8, 0) })
    const days = groupByDay(mergeEvents([d5a, d6, d5b]))
    expect(days.map(([k]) => k)).toEqual([dayKeyOf(d6.at), dayKeyOf(d5a.at)])
    expect(days[1][1].map((e) => e.id)).toEqual(['b', 'a'])
  })
})

describe('feedSentence', () => {
  it('writes a sentence for every kind', () => {
    for (const kind of KINDS) {
      const line = feedSentence(ev({ kind, id: 'x', at: local(2026, 10, 5, 9, 0), score: 12 }))
      expect(line.length, kind).toBeGreaterThan(0)
      /* the raw token is a column value, never something to show somebody */
      expect(line, kind).not.toContain(kind)
    }
  })

  /** a sitting's duration is most of what it says, so the sentence has to carry it */
  it('says how long a sitting was', () => {
    const line = feedSentence(
      ev({
        kind: 'sitting',
        id: 's',
        at: local(2026, 10, 5, 9, 0),
        until: local(2026, 10, 5, 10, 30),
        detail: 'Guitar',
      }),
    )
    expect(line).toContain('Guitar')
    expect(line).toContain('1h 30m')
  })

  it('says the amount when the activity counted something', () => {
    const line = feedSentence(
      ev({
        kind: 'sitting',
        id: 's',
        at: local(2026, 10, 5, 9, 0),
        until: local(2026, 10, 5, 9, 30),
        detail: 'Reading',
        amount: 40,
        metric: 'pages',
      }),
    )
    expect(line).toContain('40 pages')
  })

  /**
   * An open sitting has no end — the chronicle refuses to hand one to a friend at all, and this
   * says so rather than rendering "NaN" if one ever reaches the feed by another road.
   */
  it('still writes a sentence for a sitting with no end', () => {
    const line = feedSentence(
      ev({ kind: 'sitting', id: 's', at: local(2026, 10, 5, 9, 0), detail: 'Walk' }),
    )
    expect(line).toContain('Walk')
    expect(line).not.toMatch(/NaN|Invalid/)
  })
})

/**
 * The scope strip.
 *
 * ⚠️ THE ORDER IS THE FEATURE, not presentation. `FeedRoom` starts on `you_and_friends` and the
 * server defaults to it too, so "the narrow one is first" is the statement that the quieter room
 * is the one you land in. Reversing the array would move everybody into a feed of the whole site
 * without a single line of the component changing, which is the kind of thing that wants a test
 * rather than a convention.
 */
describe('feed scopes', () => {
  it('offers exactly the two the server accepts', () => {
    expect(FEED_SCOPES.map((s) => s.id)).toEqual(['you_and_friends', 'all_members'])
  })

  it('puts the narrower one first, because that is the one people land in', () => {
    expect(FEED_SCOPES[0].id).toBe('you_and_friends')
  })

  it('names each one in words, never by its database value', () => {
    for (const s of FEED_SCOPES) {
      expect(s.label.trim()).not.toBe('')
      expect(s.label).not.toBe(s.id)
    }
  })

  it('has no duplicate ids, so a tab cannot shadow another', () => {
    const ids: FeedScope[] = FEED_SCOPES.map((s) => s.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
