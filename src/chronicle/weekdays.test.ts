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
import {
  inScope,
  marksOf,
  offOn,
  rowOf,
  streakFrom,
  streakKey,
  type Goal,
  type RowMark,
} from './goal'
import {
  EVERY_DAY,
  daysOf,
  daysText,
  dueOn,
  maskOf,
  maskOn,
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

/**
 * A goal the record answers for — thirty minutes a day of one activity — with every field away from
 * its default, so a rule reading the wrong one has somewhere to be wrong.
 */
const goal = (over: Partial<Goal> = {}): Goal => ({
  id: 'g',
  title: 'Swim',
  scope: 'day',
  anchor: null,
  every: 1,
  target: 30,
  unit: 'minutes',
  shared: true,
  visibility: 'friends',
  progress: 9,
  done: true,
  note: 'why',
  sort: 2,
  activity: 'swim',
  cat: null,
  counts: 'minutes',
  est: 5,
  priority: 1,
  ...over,
})

/** what the tally says, `back` windows before the day looked at: thirty minutes, or none */
const tally = (met: (back: number) => boolean, n = 31): Record<string, number> =>
  Object.fromEntries(Array.from({ length: n }, (_, b) => [streakKey('g', b), met(b) ? 30 : 0]))

/** a local date `back` days before 7 Nov 2026 */
const ago = (back: number): string => {
  const d = new Date(2026, 10, 7 - back)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

describe('a weekday goal judged over its history', () => {
  const on = '2026-11-07' // a Saturday

  it('is not missed on the days it is not for', () => {
    /* Saturday back to Sunday, nothing done — Tue/Thu leaves only those two as misses, and today,
       a Saturday, is off rather than "not yet" */
    const g = goal({ days: [{ from: '2026-01-01', days: maskOf([TUE, THU]) }] })
    expect(
      rowOf(
        g,
        tally(() => false),
        on,
        6,
      ),
    ).toEqual([
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
    const got = tally((b) => b % 3 !== 0 || b === 0)
    expect(rowOf(goal(), got, on)).toEqual(marksOf(goal(), got))
    expect(rowOf(goal({ days: [] }), got, on)).toEqual(marksOf(goal(), got))
  })

  /**
   * ⚠️ EVAN'S RULE, ASKED OF EVERY DAY IT COULD BE BROKEN ON. A schedule change is an entry with a
   * start day; this sweeps that start across the whole month, with three different masks, and
   * asserts that every window BEFORE the start is the verdict it was before the change. A rule
   * tested at one boundary is a rule tested at one boundary.
   */
  it('never re-judges a day before the change, wherever the change starts', () => {
    const got = tally((b) => b % 4 !== 1)
    const before: Schedule = [{ from: '2026-01-01', days: maskOf([1, 2, 3, 4, 5]) }]
    const was = rowOf(goal({ days: before }), got, on)
    for (const days of [maskOf([TUE]), maskOf([SAT, SUN]), EVERY_DAY]) {
      for (let back = 0; back <= 30; back++) {
        const now = rowOf(goal({ days: [...before, { from: ago(back), days }] }), got, on)
        const cut = 30 - back // the index of the change's own day
        expect(now.slice(0, cut)).toEqual(was.slice(0, cut))
      }
    }
  })
})

/**
 * ⚠️ §16f, ANSWERED: "Keep earned completions and their streak credit when a schedule edit makes a
 * completed day an off-day." The first version of this module did the opposite on purpose — a met
 * off-day was `off` — and its test was called "does not count a met day the goal was not for".
 */
describe('a completion is never erased by a schedule', () => {
  const on = '2026-11-07' // a Saturday

  it('keeps today met after an edit made today leaves today out', () => {
    /* met this morning under "every day", then changed to Tuesdays — from today */
    const g = goal({
      days: [
        { from: '2026-01-01', days: EVERY_DAY },
        { from: on, days: maskOf([TUE]) },
      ],
    })
    const row = rowOf(
      g,
      tally((b) => b <= 2),
      on,
    )
    expect(row.slice(-3)).toEqual(['met', 'met', 'met'])
    expect(streakFrom(row)).toBe(3)
  })

  it('draws a met day the schedule leaves out as met, and counts it', () => {
    /* Tue 3 .. Fri 6 under Tuesdays only: missed, met, missed, met */
    const g = goal({ days: [{ from: '2026-01-01', days: maskOf([TUE]) }] })
    const got = tally((b) => b === 0 || b === 2)
    const row = rowOf(g, got, '2026-11-06', 3)
    expect(row).toEqual(['missed', 'met', 'off', 'met'])
    expect(streakFrom(row)).toBe(2)
  })

  it('still lets a day it was for and missed break the run', () => {
    expect(streakFrom(['met', 'off', 'missed', 'off', 'met', 'met'])).toBe(2)
  })
})

describe('the streak of a weekday goal', () => {
  it('counts the days it was for, stepping over the rest', () => {
    /* met four Tuesdays running, nothing on the days between — a streak of four, not of one */
    expect(streakFrom(['met', 'off', 'off', 'met', 'off', 'met', 'off', 'met'])).toBe(4)
  })

  it('is not broken by today, which is not over', () => {
    expect(streakFrom(['met', 'off', 'met', 'now'])).toBe(2)
  })

  it('is not broken by today being off', () => {
    expect(streakFrom(['met', 'met', 'off'])).toBe(2)
  })
})

/**
 * ⚠️ §16g, ANSWERED: "Periods before a goal's creation are not applicable — neither successes nor
 * misses. Older activity records remain intact, but don't manufacture a retroactive goal streak."
 */
describe('the days before a goal existed', () => {
  const on = '2026-11-07'
  /** a moment on a local day, at a local hour */
  const at = (iso: string, h: number) =>
    new Date(`${iso}T${String(h).padStart(2, '0')}:00:00`).getTime()

  it('are not on the row at all — it starts on the day the goal was made', () => {
    const row = rowOf(
      goal({ made: at(ago(5), 9) }),
      tally(() => false),
      on,
    )
    expect(row).toEqual(['missed', 'missed', 'missed', 'missed', 'missed', 'now'])
  })

  it('cannot hand a goal made today the streak of what was done before it', () => {
    /* drawn every day for a month; the goal was made this afternoon */
    const g = goal({ made: at(on, 15) })
    const got = tally((b) => b > 0)
    expect([rowOf(g, got, on), streakFrom(rowOf(g, got, on))]).toEqual([['now'], 0])
    /* and the record is untouched: the same tally still reads thirty met days without the goal's date */
    expect(marksOf(g, got).filter((m) => m === 'met')).toHaveLength(30)
  })

  it('takes the creation day from the LOCAL clock, not from UTC', () => {
    /* 11:30pm on Wednesday 4 Nov in California is already Thursday in UTC */
    const g = goal({ made: Date.parse('2026-11-05T07:30:00Z') })
    expect(
      rowOf(
        g,
        tally(() => true),
        on,
      ),
    ).toHaveLength(4) // Wed 4 .. Sat 7
  })

  it('keeps the window it was made in, for a week and for a month', () => {
    const weekly = goal({ scope: 'week', made: at('2026-11-04', 10) })
    const monthly = goal({ scope: 'month', made: at('2026-11-20', 10) })
    expect([
      rowOf(
        weekly,
        tally(() => true),
        '2026-11-07',
      ),
      rowOf(
        weekly,
        tally(() => true),
        '2026-11-14',
      ),
      rowOf(
        monthly,
        tally(() => false),
        '2026-11-28',
      ),
      rowOf(
        monthly,
        tally(() => false),
        '2026-12-02',
      ),
    ]).toEqual([['met'], ['met', 'met'], ['now'], ['missed', 'now']])
  })

  it('changes nothing for a goal whose creation the reader did not send', () => {
    const got = tally((b) => b % 2 === 0)
    expect([
      rowOf(goal({ made: null }), got, on),
      rowOf(goal({ made: undefined }), got, on),
    ]).toEqual([marksOf(goal(), got), marksOf(goal(), got)])
  })
})

describe('which list a weekday goal is in', () => {
  const tue = goal({ days: [{ from: '2026-01-01', days: maskOf([TUE]) }] })

  it('is on Tuesday and off on Wednesday', () => {
    expect([
      inScope(tue, 'day', '2026-11-03'),
      inScope(tue, 'day', '2026-11-04'),
      offOn(tue, '2026-11-04'),
    ]).toEqual([true, false, true])
  })

  it('reads its schedule from the day being looked at, so Tomorrow can differ from Today', () => {
    /* Monday's Tomorrow tab is Tuesday's list */
    expect([inScope(tue, 'day', '2026-11-02'), inScope(tue, 'day', '2026-11-03')]).toEqual([
      false,
      true,
    ])
  })

  it('never puts a weekly or a monthly goal off, whatever days it carries', () => {
    const s: Schedule = [{ from: '2026-01-01', days: maskOf([TUE]) }]
    expect([
      offOn(goal({ scope: 'week', days: s }), '2026-11-04'),
      offOn(goal({ scope: 'month', days: s }), '2026-11-04'),
      offOn(goal({ every: null, anchor: '2026-11-04', days: s }), '2026-11-04'),
    ]).toEqual([false, false, false])
  })
})

describe('a schedule in the words on its chip', () => {
  it('names the common shapes and lists the rest Monday first', () => {
    expect([
      daysText(EVERY_DAY),
      daysText(maskOf([1, 2, 3, 4, 5])),
      daysText(maskOf([SAT, SUN])),
      daysText(maskOf([SUN, TUE, THU])),
      daysText(EVERY_DAY & ~(1 << SUN)),
    ]).toEqual(['every day', 'weekdays', 'weekends', 'Tue, Thu, Sun', 'not Sun'])
  })
})

/* typed, so a verdict the module stops producing is a compile error here rather than a silent pass */
const shapes: RowMark[] = ['met', 'missed', 'now', 'off']
void shapes
