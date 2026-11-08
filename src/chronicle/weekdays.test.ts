import { describe, expect, it, vi } from 'vitest'

/**
 * ⚠️ PINNED WEST OF GREENWICH, OR THE FIRST TEST CANNOT FAIL WHERE IT MATTERS. CI runs in UTC, and
 * in UTC `new Date('2026-11-03')` is local midnight on the right day — so the bug the weekday test
 * exists for (reading a bare date string as UTC) passes there and only bites on a phone in the
 * Americas, which is where every member is. `stubEnv` assigns `process.env.TZ`, Node re-reads the
 * zone on that assignment, and vitest gives each test file its own worker, so this reaches no
 * other file. Every other test here reads local days throughout and is the same in any zone.
 */
vi.stubEnv('TZ', 'America/Los_Angeles')
import type { Mark } from './goal'
import {
  EVERY_DAY,
  daysOf,
  dueOn,
  maskOf,
  maskOn,
  scheduledMarks,
  scheduledStreak,
  validMask,
  weekday,
  type Schedule,
} from './weekdays'

const SUN = 0
const TUE = 2
const THU = 4
const SAT = 6

describe('which weekday a calendar day is', () => {
  /* calendar facts, checked against a printed calendar rather than derived from the code */
  it('reads the local day, not the UTC one', () => {
    expect([weekday('2026-11-01'), weekday('2026-11-03'), weekday('2026-11-07')]).toEqual([
      SUN,
      TUE,
      SAT,
    ])
  })

  it('is right on the day the clocks go forward', () => {
    /* 8 March 2026 is a Sunday and is 23 hours long in the US */
    expect(weekday('2026-03-08')).toBe(SUN)
  })
})

describe('a mask of weekdays', () => {
  it('round-trips the days it holds, Sunday first', () => {
    expect(daysOf(maskOf([THU, TUE, TUE]))).toEqual([TUE, THU])
  })

  it('ignores anything that is not a weekday', () => {
    expect(maskOf([TUE, 7, -1, 2.5])).toBe(maskOf([TUE]))
  })

  it('has all seven days in EVERY_DAY', () => {
    expect(daysOf(EVERY_DAY)).toEqual([0, 1, 2, 3, 4, 5, 6])
  })

  it('refuses a goal for no days at all, and anything past Saturday', () => {
    expect([validMask(0), validMask(1), validMask(EVERY_DAY), validMask(128)]).toEqual([
      false,
      true,
      true,
      false,
    ])
  })
})

describe('the schedule in force on a day', () => {
  /* ⚠️ THREE ENTRIES IN NEITHER ORDER. With two in reverse order, "the first one that had
     started" and "the latest one that had started" pick the same entry on every day asked, so a
     reader taking the first passed — the fixture was holding the thing under test still. */
  const s: Schedule = [
    { from: '2026-11-01', days: maskOf([TUE, THU]) },
    { from: '2026-11-20', days: maskOf([SUN]) },
    { from: '2026-11-10', days: maskOf([SAT]) },
  ]

  it('is every day when nothing has been set — what a repeating day goal means today', () => {
    expect(maskOn([], '2026-11-03')).toBe(EVERY_DAY)
  })

  it('is the latest entry that had started by then, whatever order they arrive in', () => {
    expect([maskOn(s, '2026-11-05'), maskOn(s, '2026-11-12'), maskOn(s, '2026-11-25')]).toEqual([
      maskOf([TUE, THU]),
      maskOf([SAT]),
      maskOf([SUN]),
    ])
  })

  it('is every day before the first entry', () => {
    expect(maskOn(s, '2026-10-31')).toBe(EVERY_DAY)
  })

  it('makes a Tuesday goal due on Tuesday and not on Monday', () => {
    const tue: Schedule = [{ from: '2026-01-01', days: maskOf([TUE]) }]
    expect([dueOn(tue, '2026-11-02'), dueOn(tue, '2026-11-03')]).toEqual([false, true])
  })
})

/** a month of marks ending on `on`, oldest first, the shape marksOf gives */
const month = (pattern: (daysBack: number) => Mark, n = 31): Mark[] =>
  Array.from({ length: n }, (_, i) => pattern(n - 1 - i))

describe('a weekday goal judged over its history', () => {
  const on = '2026-11-07' // a Saturday

  it('is not missed on the days it is not for', () => {
    /* Saturday back to Sunday, all missed under "every day" — Tue/Thu leaves only those two */
    const marks = month(() => 'missed', 7)
    const s: Schedule = [{ from: '2026-01-01', days: maskOf([TUE, THU]) }]
    expect(scheduledMarks(marks, on, s)).toEqual([
      'off', // Sun 1
      'off', // Mon 2
      'missed', // Tue 3
      'off', // Wed 4
      'missed', // Thu 5
      'off', // Fri 6
      'off', // Sat 7
    ])
  })

  it('changes nothing at all for a goal with no schedule', () => {
    const marks = month((back) => (back === 0 ? 'now' : back % 3 ? 'met' : 'missed'))
    expect(scheduledMarks(marks, on, [])).toEqual(marks)
  })

  /**
   * ⚠️ EVAN'S RULE, ASKED OF EVERY DAY IT COULD BE BROKEN ON. A schedule change is an entry with a
   * start day; this sweeps that start across the whole month, with three different masks, and
   * asserts that every mark BEFORE the start is the mark it was before the change. A rule tested
   * at one boundary is a rule tested at one boundary.
   */
  it('never re-judges a day before the change, wherever the change starts', () => {
    const marks = month((back) => (back === 0 ? 'now' : back % 4 === 1 ? 'missed' : 'met'))
    const before: Schedule = [{ from: '2026-01-01', days: maskOf([1, 2, 3, 4, 5]) }]
    const was = scheduledMarks(marks, on, before)
    for (const days of [maskOf([TUE]), maskOf([SAT, SUN]), EVERY_DAY]) {
      for (let back = 0; back < marks.length; back++) {
        const d = new Date(2026, 10, 7 - back)
        const from = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
          d.getDate(),
        ).padStart(2, '0')}`
        const now = scheduledMarks(marks, on, [...before, { from, days }])
        const cut = marks.length - 1 - back // index of `from`
        expect(now.slice(0, cut)).toEqual(was.slice(0, cut))
      }
    }
  })
})

describe('the streak of a weekday goal', () => {
  it('counts the days it was for, stepping over the rest', () => {
    /* met four Tuesdays running, nothing on the days between — a streak of four, not of one */
    expect(scheduledStreak(['met', 'off', 'off', 'met', 'off', 'met', 'off', 'met'])).toBe(4)
  })

  it('is broken by a day it was for and missed', () => {
    expect(scheduledStreak(['met', 'off', 'missed', 'off', 'met', 'met'])).toBe(2)
  })

  it('is not broken by today, which is not over', () => {
    expect(scheduledStreak(['met', 'off', 'met', 'now'])).toBe(2)
  })

  it('does not count a met day the goal was not for', () => {
    /* scheduledMarks turns it into `off` — so a Monday swim cannot prop up a Tuesday streak */
    const s: Schedule = [{ from: '2026-01-01', days: maskOf([TUE]) }]
    const marks: Mark[] = ['missed', 'met', 'missed', 'met'] // Tue 3 .. Fri 6
    expect(scheduledStreak(scheduledMarks(marks, '2026-11-06', s))).toBe(0)
  })
})
