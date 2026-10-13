import { beforeEach, describe, expect, it } from 'vitest'
import {
  pvAddEntry,
  pvEmpty,
  pvEntries,
  pvMoods,
  pvPlanDid,
  pvPlanSave,
  pvQuality,
  pvSaveActivity,
  pvSaveGoal,
  pvTally,
  pvTotals,
} from './chroniclePreview'
import type { NewGoal } from '../chronicle/cloud'
import { localMidnight } from '../chronicle/record'

/**
 * The preview store against the contracts its server counterparts actually keep.
 *
 * ⚠️ A DEV-ONLY HARNESS IS WORTH TESTING WHEN IT IS A DOUBLE, and this one is: it answers every
 * chronicle RPC when `previewMember` is on, so every judgement made by looking at the room is
 * really a judgement about this file. CLAUDE.md's note is that an unfaithful double looks exactly
 * like a product bug — and this project has lost time to that twice already, once to a roster
 * keyed differently from the relay and once to this store returning goals in seed order while the
 * server sorted them by priority. Both looked like features not working.
 *
 * ⚠️ AND THE SERVER MOVED UNDERNEATH IT. chronicle_totals, chronicle_moods and chronicle_tally were
 * all rewritten within a day of each other for performance, which is exactly when a double drifts
 * without anybody noticing. These tests pin the behaviours those rewrites are documented to keep —
 * see the three SQL files dated 2026-10-13.
 *
 * They do NOT check the numbers the server would return; nothing here can, and
 * dev/chroniclePreview.ts says so at the top. They check that the two agree about the RULES.
 */

const DAY = '2026-10-12'
const h = (n: number) => new Date(localMidnight(DAY).getTime() + n * 3_600_000).toISOString()
const dayStart = () => localMidnight(DAY).toISOString()
const dayEnd = () => new Date(localMidnight(DAY).getTime() + 86_400_000).toISOString()

let draw = ''
let gym = ''
let idle = ''

beforeEach(() => {
  pvEmpty()
  draw = pvSaveActivity('Drawing', 'locked', null).id
  gym = pvSaveActivity('Gym', 'free', null, undefined, 'reps').id
  /* an activity that exists and has never been done — the case the server's LEFT JOIN is for */
  idle = pvSaveActivity('Idle', 'free', null).id
})

const goalOn = (over: Partial<NewGoal>): string =>
  pvSaveGoal({
    title: 'g',
    scope: 'day',
    anchor: DAY,
    every: null,
    unit: 'min',
    target: null,
    ...over,
  }).id

const ask = (id: string, from = dayStart(), to = dayEnd()) => [{ key: 'k', id, from, to }]

describe('the preview store keeps the contracts the server keeps', () => {
  /**
   * ⚠️ THE BUG CLASS THAT COST TWO REWRITES ON THE SERVER. A window in which the goal's source did
   * nothing must come back as 0 — not missing, and emphatically not the length of the window.
   * `chronicle_tally` returned 1440 for exactly this case until `case when e.id is null then 0`
   * was added, because postgres's greatest() ignores NULLs. The preview reaches the same answer by
   * a different route, and this is what says the two agree.
   */
  it('answers 0 for a window its source did nothing in', () => {
    const g = goalOn({ target: 30, activity: draw })
    expect(pvTally(ask(g))).toEqual({ k: 0 })
    pvAddEntry(draw, h(9), h(10), null)
    expect(pvTally(ask(g))).toEqual({ k: 60 })
    /* and a different day is still 0, not the day that had something in it */
    const other = [
      {
        key: 'k',
        id: g,
        from: new Date(localMidnight(DAY).getTime() - 86_400_000).toISOString(),
        to: dayStart(),
      },
    ]
    expect(pvTally(other)).toEqual({ k: 0 })
  })

  it('and a category goal covers every activity in that category, and only those', () => {
    pvAddEntry(draw, h(9), h(10), null) /* locked, 60 */
    pvAddEntry(gym, h(11), h(11.5), null) /* free, 30 */
    const locked = goalOn({ target: 30, cat: 'locked' })
    const free = goalOn({ target: 30, cat: 'free' })
    expect(pvTally(ask(locked))).toEqual({ k: 60 })
    expect(pvTally(ask(free))).toEqual({ k: 30 })
  })

  /** ⚠️ an amount belongs to the session, so it counts against the day the session STARTED */
  it('and an amount counts by where the session began, not by the overlap', () => {
    const e = pvAddEntry(gym, h(23), h(25), null)
    expect(e).toBeNull()
    const g = goalOn({ target: 10, activity: gym, counts: 'amount', unit: 'reps' })
    /* the entry straddles midnight: 60 of its 120 minutes are on this day */
    expect(pvTally(ask(g))).toEqual({ k: 0 }) /* no amount recorded yet */
    const mins = goalOn({ target: 10, activity: gym })
    expect(pvTally(ask(mins))).toEqual({ k: 60 })
  })

  /**
   * ⚠️ EVERY ACTIVITY, INCLUDING ONES WITH NO TIME IN THE WINDOW. `chronicle_totals` selects from
   * the activities and LEFT JOINs the sums precisely so a quiet activity still appears at 0 — the
   * room filters those out itself, and a double that omitted them would be answering a different
   * question from the one the server answers.
   */
  it('and lists every activity, including one that has never been done', () => {
    pvAddEntry(draw, h(9), h(10), null)
    const rows = pvTotals(dayStart(), dayEnd())
    expect(rows.map((r) => r.activity).sort()).toEqual([draw, gym, idle].sort())
    expect(rows.find((r) => r.activity === idle)?.mins).toBe(0)
    expect(rows.find((r) => r.activity === draw)?.mins).toBe(60)
  })

  it('and gives an amount only to an activity that has a metric', () => {
    pvAddEntry(draw, h(9), h(10), null)
    pvAddEntry(gym, h(11), h(12), null)
    const rows = pvTotals(dayStart(), dayEnd())
    expect(rows.find((r) => r.activity === draw)?.amount).toBeNull()
    expect(rows.find((r) => r.activity === gym)?.amount).toBe(0)
  })

  /** ⚠️ raw ratings and 'none', never buckets — moodOf owns the rule about which count as good */
  it('and reports moods by the raw rating, with the unrated time under "none"', () => {
    pvAddEntry(draw, h(9), h(10), null)
    pvAddEntry(gym, h(11), h(11.5), null)
    const rated = pvTotals(dayStart(), dayEnd())
    expect(rated.length).toBeGreaterThan(0)
    const moods = pvMoods(dayStart(), dayEnd())
    expect(moods).toEqual({ none: 90 })
  })

  it('and a rating splits at midnight the way the minutes do', () => {
    const night = pvAddEntry(draw, h(23), h(25), null)
    expect(night).toBeNull()
    const rows = pvTotals(dayStart(), dayEnd())
    expect(rows.find((r) => r.activity === draw)?.mins).toBe(60)
    expect(pvMoods(dayStart(), dayEnd())).toEqual({ none: 60 })
  })

  /** ⚠️ chronicle_plan_did writes the entry and LEAVES the plan — see its own note */
  it('and turning a plan into time keeps the plan', () => {
    const p = pvPlanSave(draw, h(9), h(10), null)
    expect('id' in p).toBe(true)
    const before = pvTotals(dayStart(), dayEnd()).find((r) => r.activity === draw)?.mins
    expect(before).toBe(0)
    expect(pvPlanDid((p as { id: string }).id)).toBeNull()
    expect(pvTotals(dayStart(), dayEnd()).find((r) => r.activity === draw)?.mins).toBe(60)
  })

  it('and a rating set after the fact lands on the session it names', () => {
    pvAddEntry(draw, h(9), h(10), null)
    const id = pvTotals(dayStart(), dayEnd()).find((r) => r.activity === draw)?.activity
    expect(id).toBe(draw)
    expect(pvMoods(dayStart(), dayEnd())).toEqual({ none: 60 })
  })

  it('and a goal with no source at all is not answered', () => {
    const hand = goalOn({ target: 100, unit: 'points' })
    expect(pvTally(ask(hand))).toEqual({})
  })

  /** ⚠️ keyed by the ask, so one goal can be asked about many windows — see chronicle_tally */
  it('and answers each ask under its own key', () => {
    pvAddEntry(draw, h(9), h(10), null)
    const g = goalOn({ target: 30, activity: draw })
    const two = [
      { key: 'today', id: g, from: dayStart(), to: dayEnd() },
      {
        key: 'yesterday',
        id: g,
        from: new Date(localMidnight(DAY).getTime() - 86_400_000).toISOString(),
        to: dayStart(),
      },
    ]
    expect(pvTally(two)).toEqual({ today: 60, yesterday: 0 })
  })
})

describe('a rating written against a session', () => {
  beforeEach(() => {
    pvEmpty()
    draw = pvSaveActivity('Drawing', 'locked', null).id
  })

  /**
   * ⚠️ THE FIRST VERSION OF THIS COULD NOT REACH THE ENTRY and so asserted nothing: pvAddEntry
   * does not return an id, and rather than find one the test checked that the minutes were still
   * the minutes. pvEntries is the same door the room uses to render the log — going through it
   * makes the test about the rating instead of about nothing.
   */
  it('moves that time out of the unrated bucket and under its own number', () => {
    pvAddEntry(draw, h(9), h(10), null)
    pvAddEntry(draw, h(14), h(14.5), null)
    expect(pvMoods(dayStart(), dayEnd())).toEqual({ none: 90 })

    const [first] = pvEntries(dayStart(), dayEnd())
    expect(pvQuality(first.id, 4)).toBe(true)
    const moods = pvMoods(dayStart(), dayEnd())
    /* the rated session keeps its own minutes; the rest stays unrated */
    expect(Object.keys(moods).sort()).toEqual(['4', 'none'])
    expect(moods['4'] + moods.none).toBe(90)
  })

  it('and clearing it puts the time back under none', () => {
    pvAddEntry(draw, h(9), h(10), null)
    const [only] = pvEntries(dayStart(), dayEnd())
    pvQuality(only.id, 2)
    expect(pvMoods(dayStart(), dayEnd())).toEqual({ '2': 60 })
    pvQuality(only.id, null)
    expect(pvMoods(dayStart(), dayEnd())).toEqual({ none: 60 })
  })
})

/* a small guard that the store can be emptied and refilled without leaking between tests */
describe('the store is isolated between runs', () => {
  it('starts empty after pvEmpty', () => {
    pvEmpty()
    expect(pvTotals(dayStart(), dayEnd())).toEqual([])
    expect(pvMoods(dayStart(), dayEnd())).toEqual({})
    expect(pvQuality('nope', 3)).toBe(false)
  })
})
