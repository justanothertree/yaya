import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { finished, reached, share, windowKey, type Goal } from './goal'
import { asOf, markAsks, markOpen, markWindow, type Marks } from './marks'

/* ⚠️ PINNED, because the point of half of these is a LOCAL day that is not the UTC one — and CI
   runs in UTC, where an evening in California and the next morning are the same date */
beforeAll(() => {
  vi.stubEnv('TZ', 'America/Los_Angeles')
})
afterAll(() => {
  vi.unstubAllEnvs()
})

/**
 * Every field away from its default, so a rule reading the wrong one has somewhere to be wrong —
 * above all the ROW's own `done` and `progress`, set to "done" and to a number, because those are
 * exactly the values that leak into every later window today.
 */
const goal = (over: Partial<Goal> = {}): Goal => ({
  id: 'g',
  title: 'a goal',
  scope: 'day',
  anchor: null,
  every: 1,
  target: null,
  unit: null,
  shared: true,
  visibility: 'friends',
  progress: 17,
  done: true,
  note: 'why',
  sort: 3,
  activity: null,
  cat: null,
  counts: 'minutes',
  est: 5,
  priority: 1,
  ...over,
})

describe('a repeating goal moved by hand, window by window', () => {
  const floss = goal({ id: 'floss' })
  const ticked: Marks = { [windowKey('floss', '2026-11-07')]: { progress: 0, done: true } }

  it('is ticked on the day it was ticked', () => {
    expect(finished(asOf(floss, ticked, '2026-11-07'), {}, '2026-11-07')).toBe(true)
  })

  it('is not ticked the next day — the reset the row could never perform', () => {
    expect(finished(asOf(floss, ticked, '2026-11-08'), {}, '2026-11-08')).toBe(false)
  })

  it("ignores the row's own flag, which is what leaks into every later day today", () => {
    /* the fixture's row says done: true — with no mark for the day, the day is untouched */
    expect(asOf(floss, {}, '2026-11-08').done).toBe(false)
  })

  it('keeps a weekly tick for the whole week and drops it on Sunday', () => {
    /* 1 Nov 2026 is a Sunday: the week of the 1st runs to the 7th, and the 8th starts the next */
    const weekly = goal({ id: 'w', scope: 'week' })
    const m: Marks = { [windowKey('w', '2026-11-01')]: { progress: 0, done: true } }
    expect([
      asOf(weekly, m, '2026-11-03').done,
      asOf(weekly, m, '2026-11-07').done,
      asOf(weekly, m, '2026-11-08').done,
    ]).toEqual([true, true, false])
  })

  it('counts a hand-moved quantity per window, from zero each time', () => {
    const stretch = goal({ id: 's', target: 20, unit: 'minutes', done: false })
    const m: Marks = { [windowKey('s', '2026-11-07')]: { progress: 12, done: false } }
    expect([
      reached(asOf(stretch, m, '2026-11-07'), {}, '2026-11-07'),
      reached(asOf(stretch, m, '2026-11-08'), {}, '2026-11-08'),
      share(asOf(stretch, m, '2026-11-08'), {}, '2026-11-08'),
    ]).toEqual([12, 0, 0])
  })
})

describe('goals that already had their one window', () => {
  it('leaves a one-off exactly as it was', () => {
    const once = goal({ every: null, anchor: '2026-11-07' })
    expect(asOf(once, {}, '2026-11-08')).toBe(once)
  })

  it('leaves a lifetime goal exactly as it was', () => {
    const life = goal({ scope: 'life', every: null, anchor: null })
    expect(asOf(life, {}, '2026-11-08')).toBe(life)
  })

  it('sends no window for either, so their writes keep going to the row', () => {
    expect([
      markWindow(goal({ every: null, anchor: '2026-11-07' }), '2026-11-07'),
      markWindow(goal({ scope: 'life', every: null, anchor: null }), '2026-11-07'),
    ]).toEqual([null, null])
  })

  it('sends the window start for a repeating goal, in local days', () => {
    expect([
      markWindow(goal(), '2026-11-07')?.from,
      markWindow(goal({ scope: 'week' }), '2026-11-07')?.from,
      markWindow(goal({ scope: 'month' }), '2026-11-07')?.from,
    ]).toEqual(['2026-11-07', '2026-11-01', '2026-11-01'])
  })
})

describe('the instants a mark is sent with', () => {
  it('are local midnights, which in California are 8am UTC in November', () => {
    const at = markWindow(goal(), '2026-11-07')
    expect([at?.starts, at?.ends]).toEqual(['2026-11-07T08:00:00.000Z', '2026-11-08T08:00:00.000Z'])
  })

  it('make the day the clocks go back twenty-five hours long', () => {
    /* 1 Nov 2026 is the first Sunday of November, when US daylight time ends */
    const at = markWindow(goal(), '2026-11-01')!
    expect((Date.parse(at.ends) - Date.parse(at.starts)) / 3_600_000).toBe(25)
  })
})

describe('a tick from before marks existed', () => {
  const floss = goal({ id: 'floss', done: false })
  /* 8pm on the 7th in California, which is already the 8th in UTC */
  const evening = Date.parse('2026-11-08T04:00:00Z')

  it('lights the LOCAL day it was made on, not the UTC one', () => {
    expect([
      asOf(floss, {}, '2026-11-07', { floss: evening }).done,
      asOf(floss, {}, '2026-11-08', { floss: evening }).done,
    ]).toEqual([true, false])
  })

  it('stops at the end of its window — a tick the next morning is not the night before', () => {
    /* 9am on the 8th in California: the day AFTER the window of the 7th, at its very edge */
    const morning = Date.parse('2026-11-08T17:00:00Z')
    expect(asOf(floss, {}, '2026-11-07', { floss: morning }).done).toBe(false)
  })

  it('lights a weekly goal for the week it was made in', () => {
    const w = goal({ id: 'w', scope: 'week', done: false })
    expect([
      asOf(w, {}, '2026-11-02', { w: evening }).done,
      asOf(w, {}, '2026-11-08', { w: evening }).done,
    ]).toEqual([true, false])
  })

  it('gives way to a mark, so unticking that day sticks', () => {
    const m: Marks = { [windowKey('floss', '2026-11-07')]: { progress: 0, done: false } }
    expect(asOf(floss, m, '2026-11-07', { floss: evening }).done).toBe(false)
  })

  it("never brings the row's count with it — nothing says which day that was", () => {
    const stretch = goal({ id: 's', target: 20, unit: 'minutes', progress: 15, done: false })
    expect(reached(asOf(stretch, {}, '2026-11-07', { s: evening }), {}, '2026-11-07')).toBe(0)
  })
})

describe('what the room asks for, and what it lets you tick', () => {
  it('asks once for a window two days share, and twice for two windows', () => {
    const asks = markAsks(
      [
        goal({ id: 'd' }),
        goal({ id: 'w', scope: 'week' }),
        goal({ id: 'once', every: null, anchor: '2026-11-04' }),
      ],
      ['2026-11-04', '2026-11-05'],
    )
    expect(asks.map((a) => a.key).sort()).toEqual([
      windowKey('d', '2026-11-04'),
      windowKey('d', '2026-11-05'),
      windowKey('w', '2026-11-01'),
    ])
  })

  it("refuses tomorrow's floss and allows this week's goal on any day of the week", () => {
    expect([
      markOpen(goal(), '2026-11-05', '2026-11-04'),
      markOpen(goal(), '2026-11-04', '2026-11-04'),
      markOpen(goal({ scope: 'week' }), '2026-11-05', '2026-11-04'),
      markOpen(goal({ every: null, anchor: '2026-11-05' }), '2026-11-05', '2026-11-04'),
    ]).toEqual([false, true, true, true])
  })
})
