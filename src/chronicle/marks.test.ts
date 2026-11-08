import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { finished, reached, share, windowKey, type Goal } from './goal'
import { localISO } from '../circuit/dates'
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

/**
 * ⚠️ THE DAILY RESET MUST NOT LEAK INTO THE LONGER SCOPES, asked of each separately. A daily goal
 * is unticked every morning because its window ends every midnight; a weekly or monthly goal's
 * window does not, and the one bug that would look exactly like the fix working is a mark keyed
 * on the DAY rather than on the goal's own window — every scope would then reset at midnight.
 */
describe('daily, weekly and monthly goals, ticked on the same Wednesday', () => {
  const daily = goal({ id: 'd' })
  const weekly = goal({ id: 'w', scope: 'week' })
  const monthly = goal({ id: 'm', scope: 'month' })
  /* each mark sits at its own goal's window for Wed 4 Nov — the shape the writer is sent */
  const on = '2026-11-04'
  const m: Marks = Object.fromEntries(
    [daily, weekly, monthly].map((g) => [
      windowKey(g.id, markWindow(g, on)!.from),
      { progress: 0, done: true },
    ]),
  )
  const doneOn = (g: Goal, d: string) => asOf(g, m, d).done

  it('keys each on its own window, not on the day it was ticked', () => {
    expect([daily, weekly, monthly].map((g) => markWindow(g, on)!.from)).toEqual([
      '2026-11-04',
      '2026-11-01',
      '2026-11-01',
    ])
  })

  it('resets only the daily one the next morning', () => {
    expect([daily, weekly, monthly].map((g) => doneOn(g, '2026-11-05'))).toEqual([
      false,
      true,
      true,
    ])
  })

  it('keeps the weekly one to Saturday and drops it on Sunday, with the monthly one still ticked', () => {
    expect([
      doneOn(weekly, '2026-11-07'),
      doneOn(weekly, '2026-11-08'),
      doneOn(monthly, '2026-11-08'),
    ]).toEqual([true, false, true])
  })

  it('keeps the monthly one to the 30th and drops it on the 1st', () => {
    expect([doneOn(monthly, '2026-11-30'), doneOn(monthly, '2026-12-01')]).toEqual([true, false])
  })

  it('opens a new month across a new year', () => {
    expect(markWindow(monthly, '2026-12-31')!.from).toBe('2026-12-01')
    expect(markWindow(monthly, '2027-01-01')!.from).toBe('2027-01-01')
  })

  it('adds a monthly count up across the month rather than starting each day at zero', () => {
    const pages = goal({ id: 'p', scope: 'month', target: 300, unit: 'pages', done: false })
    const counted: Marks = { [windowKey('p', '2026-11-01')]: { progress: 120, done: false } }
    expect([
      reached(asOf(pages, counted, '2026-11-02'), {}, '2026-11-02'),
      reached(asOf(pages, counted, '2026-11-29'), {}, '2026-11-29'),
      reached(asOf(pages, counted, '2026-12-01'), {}, '2026-12-01'),
    ]).toEqual([120, 120, 0])
  })

  it('stays ticked through an edit to its title or its target, which are not its window', () => {
    const edited = { ...weekly, title: 'renamed', target: 3, unit: 'times' }
    /* a target turns a tick-box into a count; the mark's count is 0, so it is no longer FINISHED,
       but the tick itself is still there to be read — nothing the edit did erased it */
    expect([
      asOf({ ...weekly, title: 'renamed' }, m, '2026-11-05').done,
      asOf(edited, m, '2026-11-05').done,
    ]).toEqual([true, true])
  })

  it('asks for two monthly windows on the last day of a month, and one on any other', () => {
    const keys = (d: string, t: string) => markAsks([monthly], [d, t]).map((a) => a.from)
    expect([keys('2026-11-29', '2026-11-30'), keys('2026-11-30', '2026-12-01')]).toEqual([
      ['2026-11-01'],
      ['2026-11-01', '2026-12-01'],
    ])
  })

  it('lets this month be ticked on its last day and next month only once it has begun', () => {
    expect([
      markOpen(monthly, '2026-11-30', '2026-11-30'),
      markOpen(monthly, '2026-12-01', '2026-11-30'),
      markOpen(weekly, '2026-11-08', '2026-11-07'),
    ]).toEqual([true, false, false])
  })
})

describe('the instants a weekly or monthly mark is sent with', () => {
  it('make the week the clocks go back 169 hours long, from a Sunday midnight in daylight time', () => {
    const at = markWindow(goal({ scope: 'week' }), '2026-11-04')!
    expect([at.starts, at.ends, (Date.parse(at.ends) - Date.parse(at.starts)) / 3_600_000]).toEqual(
      ['2026-11-01T07:00:00.000Z', '2026-11-08T08:00:00.000Z', 169],
    )
  })

  it('make March, when the clocks go forward, an hour short of 31 days', () => {
    const at = markWindow(goal({ scope: 'month' }), '2027-03-20')!
    expect([at.starts, at.ends, (Date.parse(at.ends) - Date.parse(at.starts)) / 3_600_000]).toEqual(
      ['2027-03-01T08:00:00.000Z', '2027-04-01T07:00:00.000Z', 31 * 24 - 1],
    )
  })

  it('files a Saturday-night tick under the week that is ending, though UTC is already Sunday', () => {
    /* 11:30pm on Saturday 7 Nov in California is 7:30am on Sunday the 8th in UTC */
    const local = localISO(new Date('2026-11-08T07:30:00Z'))
    expect([local, markWindow(goal({ scope: 'week' }), local)!.from]).toEqual([
      '2026-11-07',
      '2026-11-01',
    ])
  })

  it('lights a monthly goal for the month an old tick was made in, through its last evening', () => {
    /* 10pm on 30 Nov in California is 6am on 1 Dec in UTC */
    const lastEvening = Date.parse('2026-12-01T06:00:00Z')
    const m = goal({ id: 'm', scope: 'month', done: false })
    expect([
      asOf(m, {}, '2026-11-02', { m: lastEvening }).done,
      asOf(m, {}, '2026-12-01', { m: lastEvening }).done,
    ]).toEqual([true, false])
  })
})
