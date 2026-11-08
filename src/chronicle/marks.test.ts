import { describe, expect, it } from 'vitest'
import { finished, reached, share, windowKey, type Goal } from './goal'
import { asOf, markWindow, type Marks } from './marks'

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
      markWindow(goal(), '2026-11-07'),
      markWindow(goal({ scope: 'week' }), '2026-11-07'),
      markWindow(goal({ scope: 'month' }), '2026-11-07'),
    ]).toEqual(['2026-11-07', '2026-11-01', '2026-11-01'])
  })
})
