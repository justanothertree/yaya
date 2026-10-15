import { beforeEach, describe, expect, it } from 'vitest'
import {
  pvActivities,
  pvAddEntry,
  pvArchive,
  pvEmpty,
  pvExport,
  pvImport,
  pvSaveRoutine,
  pvAmount,
  pvEditEntry,
  pvEntries,
  pvFixRunning,
  pvGoals,
  pvMoods,
  pvPlanDid,
  pvPlanSave,
  pvQuality,
  pvSaveActivity,
  pvSaveGoal,
  pvStart,
  pvStop,
  pvTally,
  pvVisit,
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

  /**
   * ⚠️ THE DOUBLE HID A REAL BUG BY BEING KIND. chronicle_start checks `archived_at is null` and
   * this checked only that the id existed, so starting a put-away activity worked here and would
   * have raised 'no such activity' on the live site — which is exactly what the Routines list was
   * offering to do on a step whose activity had been archived. The message is the server's, and
   * it is the same for "not yours" and "put away" so that it cannot be used to tell them apart.
   */
  it('and refuses to start an activity that has been put away', () => {
    expect(pvStart(draw)).toBe(null)
    pvStop(null)
    expect(pvArchive(draw, true)).toBe(true)
    expect(pvStart(draw)).toEqual({ why: 'no such activity' })
    expect(pvStart('nobody-has-this')).toEqual({ why: 'no such activity' })
    expect(pvArchive(draw, false)).toBe(true)
    expect(pvStart(draw)).toBe(null)
    pvStop(null)
  })

  /**
   * ⚠️ A SITTING IS A SITTING AND NOT A HOLIDAY. ⏱ Fill a gap is two free-form datetime boxes, so
   * a span of days is a thing a person can type in half a second — and the double used to accept
   * it. Driven in the pane before this was fixed, a three-day gap took the week from 4h 58m to
   * 150h 43m and the room reported "148h 38m more than this", all of which the live site would
   * have refused outright.
   */
  it('and refuses a sitting longer than a day, the way chronicle_entry_add does', () => {
    /* exactly a day is a day — the bound is `> 24 hours`, not `>=` */
    expect(pvAddEntry(draw, h(1), h(25), null)).toBe(null)
    const aDayAndAMoment = new Date(Date.parse(h(1)) + 86_400_001).toISOString()
    expect(pvAddEntry(draw, h(1), aDayAndAMoment, null)).toEqual({
      why: 'that is more than a day',
    })
    expect(pvAddEntry(draw, h(1), h(26), null)).toEqual({ why: 'that is more than a day' })
  })

  /**
   * ⚠️ YOU CANNOT HAVE SPENT TIME ON A DAY YOU HAVE NOT LIVED. The room says so in words on a
   * future day, and then had two doors that wrote one anyway — ⏱ Fill a gap, and ✓ on tomorrow's
   * plan, which goes through pvPlanDid straight into pvAddEntry. Measured in the room before the
   * fix: pressing ✓ on a 7:00–7:45 plan for tomorrow logged "Gym 45m" twenty-five hours ahead and
   * counted it in the day's totals.
   *
   * ⚠️ THESE ASK ABOUT THE REAL CLOCK, not about the fixture's day, which is why they are written
   * from `Date.now()`. The fixture is anchored to a fixed date in the past on purpose — were it
   * ever moved to "today", every test above that adds a morning sitting would start failing in
   * the morning and passing in the evening.
   */
  it('and refuses a sitting that has not happened yet', () => {
    const from = new Date(Date.now() + 25 * 3_600_000).toISOString()
    const to = new Date(Date.now() + 25.75 * 3_600_000).toISOString()
    expect(pvAddEntry(draw, from, to, null)).toEqual({ why: 'that is in the future' })

    const soon = new Date(Date.now() + 60_000).toISOString()
    const sooner = new Date(Date.now() + 120_000).toISOString()
    expect(pvAddEntry(draw, soon, sooner, null)).toEqual({ why: 'that is in the future' })
  })

  /**
   * ⚠️ THE START, NOT THE END. A block you are in the middle of ends after now, and so does a
   * sitting logged by somebody whose clock is two minutes fast; neither is time nobody has spent.
   */
  it('and still takes a block that began before now and runs a little past it', () => {
    const from = new Date(Date.now() - 600_000).toISOString()
    const to = new Date(Date.now() + 300_000).toISOString()
    expect(pvAddEntry(draw, from, to, null)).toBe(null)
  })

  /** nothing already refused changed its answer: the day bound is still judged first */
  it('and answers a future span that is also too long about its length', () => {
    const from = new Date(Date.now() + 25 * 3_600_000).toISOString()
    const to = new Date(Date.now() + 50 * 3_600_000).toISOString()
    expect(pvAddEntry(draw, from, to, null)).toEqual({ why: 'that is more than a day' })
  })

  /** the order is part of the contract: backwards AND too long is answered about backwards */
  it('and judges a backwards span before a long one', () => {
    expect(pvAddEntry(draw, h(99), h(1), null)).toEqual({
      why: 'that span ends before it starts',
    })
  })

  /**
   * ⚠️ AND AN ARCHIVED ACTIVITY IS FINE HERE, which is the opposite of pvStart and is not an
   * inconsistency. chronicle_entry_add asks only `owner = auth.uid()`; chronicle_start also asks
   * `archived_at is null`. Writing down an hour you already spent on something you have since put
   * away is recording history. Pinned because the obvious tidy-up is to make the two match.
   */
  it('and still lets you write down time against an activity you have put away', () => {
    expect(pvArchive(draw, true)).toBe(true)
    expect(pvAddEntry(draw, h(1), h(2), null)).toBe(null)
    expect(pvStart(draw)).toEqual({ why: 'no such activity' })
    expect(pvArchive(draw, false)).toBe(true)
  })

  it('and refuses an edit with only one end, and one that runs over a day', () => {
    expect(pvAddEntry(draw, h(1), h(2), null)).toBe(null)
    const id = pvEntries(h(0), h(24))[0].id
    expect(pvEditEntry(id, '', h(2), null)).toEqual({ why: 'both ends, please' })
    expect(pvEditEntry(id, h(1), h(26), null)).toEqual({ why: 'that is more than a day' })
  })

  /** null is "no opinion" and goes through; the room cannot send a 6 and the store refuses one */
  it('and keeps a rating between 1 and 5', () => {
    expect(pvAddEntry(draw, h(1), h(2), null)).toBe(null)
    const id = pvEntries(h(0), h(24))[0].id
    expect(pvQuality(id, 0)).toBe(false)
    expect(pvQuality(id, 6)).toBe(false)
    expect(pvQuality(id, 5)).toBe(true)
    expect(pvQuality(id, null)).toBe(true)
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

describe('a visit recorded without being asked for', () => {
  beforeEach(() => pvEmpty())

  /**
   * ⚠️ THE ACTIVITY IS MADE, AND MARKED auto. That mark is what lets the room say "on the site"
   * beside it — "Paint 4h" meaning the room was open is a different claim from four hours of
   * painting, and the difference matters most when reading a week back.
   */
  it('makes the room an activity the first time, marked as written by the site', () => {
    pvVisit('Paint', 120)
    const acts = pvActivities()
    expect(acts).toHaveLength(1)
    expect(acts[0].name).toBe('Paint')
    expect(acts[0].auto).toBe(true)
    expect(acts[0].cat).toBe('free')
    /* and not a second one on the next visit */
    pvVisit('Paint', 120)
    expect(pvActivities()).toHaveLength(1)
  })

  /**
   * ⚠️ A REPORT CANNOT CLAIM MORE THAN TEN MINUTES, whatever the caller says. chronicle_visit
   * clamps to [30, 600] seconds, and that clamp is the safety net under every arithmetic mistake
   * the client could make about how long somebody has been looking at a page.
   */
  it('and clamps a wild report to ten minutes', () => {
    pvVisit('Paint', 86_400)
    const [e] = pvEntries(
      new Date(Date.now() - 86_400_000).toISOString(),
      new Date(Date.now() + 1000).toISOString(),
    )
    const mins = (Date.parse(e.end!) - Date.parse(e.start)) / 60_000
    expect(mins).toBeCloseTo(10, 1)
  })

  it('and refuses a report under half a minute by stretching it, never by shrinking below it', () => {
    pvVisit('Paint', 1)
    const [e] = pvEntries(
      new Date(Date.now() - 86_400_000).toISOString(),
      new Date(Date.now() + 1000).toISOString(),
    )
    expect((Date.parse(e.end!) - Date.parse(e.start)) / 1000).toBeCloseTo(30, 0)
  })

  /**
   * ⚠️ A RECENT VISIT IS EXTENDED, NOT ADDED TO, which is the whole reason the beat is two
   * minutes inside a three-minute slack — a beat any slower would split one sitting into separate
   * rows, and the client restarts its stretch after each beat because the extend ignores the
   * seconds it is given and simply moves the end to now.
   */
  it('and extends the sitting it is already in rather than starting another', () => {
    pvVisit('Paint', 120)
    const win = [
      new Date(Date.now() - 86_400_000).toISOString(),
      new Date(Date.now() + 1000).toISOString(),
    ] as const
    expect(pvEntries(win[0], win[1])).toHaveLength(1)
    pvVisit('Paint', 120)
    const after = pvEntries(win[0], win[1])
    expect(after).toHaveLength(1)
    expect(Date.parse(after[0].end!)).toBeGreaterThanOrEqual(Date.parse(after[0].start))
  })

  it('and a different room is a different activity', () => {
    pvVisit('Paint', 120)
    pvVisit('Instrument', 120)
    expect(
      pvActivities()
        .map((a) => a.name)
        .sort(),
    ).toEqual(['Instrument', 'Paint'])
  })

  it('and a nameless or absurd room is not recorded at all', () => {
    pvVisit('   ', 120)
    pvVisit('x'.repeat(41), 120)
    expect(pvActivities()).toEqual([])
  })
})

describe('the file you can take away', () => {
  /**
   * ⚠️ THE FILE SPEAKS THE SERVER'S VOCABULARY, NOT THE ROOM'S, and that is the whole hazard of
   * doubling an export. Everywhere else in this store an entry has `start`, a goal has `every`
   * and `done`, and an activity has `archived` — because those are the shapes the room reads.
   * `chronicle_export` writes the COLUMN names: started_at, repeat_every, done_at, archived_at.
   * A double that exported its own words would be internally consistent, would look right in the
   * pane, and would agree about a file no member will ever be sent.
   *
   * These key lists are the one place in this file where the server's contract is written down
   * rather than derived, because vitest cannot reach Postgres. They were taken from the function
   * itself and checked against a live call — see docs/2026-10-13-chronicle-export.sql, which now
   * carries the query that re-derives this from the live function and the table columns, so the
   * drift is one command away rather than a thing anybody has to notice.
   *
   * ⚠️ `shared` IS MISSING FROM goals ON PURPOSE, and this is the note that stops it being
   * "fixed". It is the only column on any chronicle table that the file does not carry, the
   * account id aside — checked by the query above on 15 Oct 2026. It stays out because
   * `chronicle_import` deliberately ignores it, so that a file somebody SENDS you cannot put
   * goals on your profile; exporting a flag nothing will read would only put a privacy fact into
   * a file that gets passed around. The file has no owner id either, so "this one is mine" is not
   * a question it can answer. The cost is that a restore leaves your goals private until you tick
   * them again, which is the direction this should fail in.
   *
   * The key equality below already catches it if the double ever grows the column, which was
   * proven rather than assumed: adding `shared: g.shared ?? false` to pvExport's goal object
   * turns two tests red — this one and the round trip that fills every field. So this is a
   * comment rather than a third test asserting the same thing.
   */
  const KEYS = {
    activities: [
      'id',
      'name',
      'cat',
      'colour',
      'archived_at',
      'created_at',
      'auto',
      'metric',
      'session_mins',
    ],
    entries: [
      'id',
      'activity',
      'started_at',
      'ended_at',
      'note',
      'amount',
      'quality',
      'created_at',
    ],
    goals: [
      'id',
      'title',
      'scope',
      'anchor',
      'repeat_every',
      'target',
      'unit',
      'progress',
      'done_at',
      'note',
      'sort',
      'activity',
      'cat',
      'counts',
      'est_mins',
      'priority',
      'created_at',
      'updated_at',
    ],
    routines: ['id', 'name', 'steps', 'created_at', 'updated_at'],
    plans: ['id', 'activity', 'starts_at', 'ends_at', 'note', 'created_at'],
  } as const

  /**
   * One row in every list, so the shape assertions have something to be about — and the sessions
   * written OUT OF ORDER on purpose.
   *
   * ⚠️ WITH THEM IN ORDER THE ORDERING TESTS BELOW WERE BLIND. Deleting the sort from pvExport
   * left all 26 tests green, because a list that arrives sorted is sorted whether or not anything
   * sorts it. A fixture that is tidy in the dimension under test pins that dimension flat, which
   * is the same way a life-scope window hid a wrong lower bound in chronicle_tally.
   */
  beforeEach(() => {
    pvAddEntry(draw, h(9), h(10), 'a note')
    pvAddEntry(draw, h(7), h(8), null)
    pvAddEntry(draw, h(13), h(14), null)
    goalOn({ target: 30, activity: draw })
    pvSaveRoutine('Morning', [{ activity: draw, mins: 20 }])
    pvPlanSave(draw, h(16), h(17), null)
    pvPlanSave(draw, h(14), h(15), null)
  })

  it('says what it is, so a reader can refuse a file that is not one', () => {
    const doc = pvExport()
    expect(doc.kind).toBe('chronicle')
    expect(doc.version).toBe(1)
    expect(typeof doc.at).toBe('string')
  })

  it('carries every list, under the column names the file uses', () => {
    const doc = pvExport() as Record<string, Array<Record<string, unknown>>>
    for (const [list, keys] of Object.entries(KEYS)) {
      expect(Array.isArray(doc[list]), list).toBe(true)
      expect(doc[list].length, list).toBeGreaterThan(0)
      for (const row of doc[list]) expect(Object.keys(row).sort(), list).toEqual([...keys].sort())
    }
  })

  it('never writes the account id into a file people pass between machines', () => {
    /* the double has no owner column at all, so this asserts the shape rather than a value —
       a row that grew one would be caught by the key lists above, and this says why that matters */
    const doc = pvExport() as Record<string, Array<Record<string, unknown>>>
    for (const list of Object.keys(KEYS))
      for (const row of doc[list]) expect(Object.keys(row), list).not.toContain('owner')
  })

  /**
   * ⚠️ EVERY LIST, BY ITS OWN KEY, because "the two calls matched" is not the claim. The first
   * version of this asserted that two exports were the same bytes, and deleting the sort from the
   * PLANS list left it green — two unsorted lists agree with each other perfectly. What the file
   * promises is an order, so each list is asked about its own.
   */
  it('orders every list by the key the file promises', () => {
    const doc = pvExport() as Record<string, Array<Record<string, string | number>>>
    const by = (rows: Array<Record<string, string | number>>, key: string, time = false) =>
      rows.map((r) => (time ? Date.parse(String(r[key])) : String(r[key])))
    const sorted = <T>(xs: T[]) => [...xs].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))

    expect(by(doc.activities, 'id')).toEqual(sorted(by(doc.activities, 'id')))
    expect(by(doc.entries, 'started_at', true)).toEqual(sorted(by(doc.entries, 'started_at', true)))
    expect(doc.goals.map((g) => Number(g.sort))).toEqual(
      sorted(doc.goals.map((g) => Number(g.sort))),
    )
    expect(by(doc.routines, 'id')).toEqual(sorted(by(doc.routines, 'id')))
    expect(by(doc.plans, 'starts_at', true)).toEqual(sorted(by(doc.plans, 'starts_at', true)))
  })

  /**
   * ⚠️ WITH A REAL GAP BETWEEN THE TWO CALLS. Taken back to back they land in the same
   * millisecond, so a field built from `new Date()` rather than a fixed moment compares equal and
   * the test says nothing — it passed against exactly that mistake until the wait was added.
   */
  it('gives the same bytes for an unchanged store, a moment later', () => {
    const first = JSON.stringify({ ...pvExport(), at: '' })
    const until = Date.now() + 3
    while (Date.now() < until) {
      /* a few milliseconds, deliberately: see above */
    }
    expect(JSON.stringify({ ...pvExport(), at: '' })).toBe(first)
  })

  it('exports an empty account as empty lists rather than as nothing', () => {
    pvEmpty()
    const doc = pvExport() as Record<string, unknown>
    for (const list of Object.keys(KEYS)) expect(doc[list], list).toEqual([])
    expect(doc.kind).toBe('chronicle')
  })
})

describe('putting a file back', () => {
  beforeEach(() => {
    pvAddEntry(draw, h(9), h(10), 'a note')
    pvAddEntry(draw, h(7), h(8), null)
    goalOn({ target: 30, activity: draw })
    pvSaveRoutine('Morning', [{ activity: draw, mins: 20 }])
    pvPlanSave(draw, h(14), h(15), null)
  })

  const rows = (doc: Record<string, unknown>) =>
    ['activities', 'entries', 'goals', 'routines', 'plans'].reduce(
      (n, k) => n + (Array.isArray(doc[k]) ? (doc[k] as unknown[]).length : 0),
      0,
    )

  it('refuses a file that is not one of ours', () => {
    expect(pvImport({ kind: 'songs', version: 1 })).toEqual({ why: 'not a chronicle file' })
    expect(pvImport({ version: 1 })).toEqual({ why: 'not a chronicle file' })
    expect(pvImport([])).toEqual({ why: 'not a chronicle file' })
    expect(pvImport(null)).toEqual({ why: 'not a chronicle file' })
    expect(pvImport('chronicle')).toEqual({ why: 'not a chronicle file' })
    expect(pvImport({ kind: 'chronicle', version: 2 })).toEqual({
      why: 'that file is from a newer version',
    })
  })

  /**
   * ⚠️ THE WHOLE POINT, STATED AS A ROUND TRIP. Save a copy, lose everything, put the copy back,
   * and the account must hold what it held — which is a claim about the export and the import
   * agreeing, and the only one that catches a field either of them forgets.
   */
  it('gives back exactly what was saved', () => {
    const before = pvExport()
    pvEmpty()
    expect(rows(pvExport())).toBe(0)

    const got = pvImport(before)
    expect('why' in got).toBe(false)
    expect(JSON.stringify({ ...pvExport(), at: '' })).toBe(JSON.stringify({ ...before, at: '' }))
  })

  it('adds what is missing and leaves what is there alone', () => {
    const file = pvExport()
    const got = pvImport(file)
    expect(got).toEqual({
      activities: 0,
      entries: 0,
      goals: 0,
      routines: 0,
      plans: 0,
      skipped: rows(file),
    })
    expect(JSON.stringify({ ...pvExport(), at: '' })).toBe(JSON.stringify({ ...file, at: '' }))
  })

  /**
   * ⚠️ A FILE CAN BE EDITED BY ANYBODY, so an import naming an id that already exists must skip
   * it rather than write to it. On the server that is `on conflict (id) do nothing` and it is the
   * reason a tampered file cannot reach somebody else's row; here it is the same rule, so the
   * harness cannot make an import look more powerful than it is.
   */
  it('never writes over a row that already exists', () => {
    const file = pvExport() as { activities: Array<Record<string, unknown>> }
    const was = file.activities[0].name
    file.activities[0].name = 'HACKED'
    pvImport(file)
    const after = pvExport() as { activities: Array<Record<string, unknown>> }
    expect(after.activities[0].name).toBe(was)
    expect(JSON.stringify(after)).not.toContain('HACKED')
  })

  it('drops a session pointing at an activity that is not yours', () => {
    const got = pvImport({
      kind: 'chronicle',
      version: 1,
      entries: [{ id: 'x1', activity: 'not-an-activity', started_at: h(9), ended_at: h(10) }],
    })
    expect(got).toMatchObject({ entries: 0, skipped: 1 })
  })

  it('drops a sitting that ends before it starts', () => {
    const got = pvImport({
      kind: 'chronicle',
      version: 1,
      entries: [{ id: 'x2', activity: draw, started_at: h(10), ended_at: h(9) }],
    })
    expect(got).toMatchObject({ entries: 0, skipped: 1 })
  })

  it('takes one sitting still running and refuses a second', () => {
    const got = pvImport({
      kind: 'chronicle',
      version: 1,
      entries: [
        { id: 'x3', activity: draw, started_at: h(11), ended_at: null },
        { id: 'x4', activity: draw, started_at: h(12), ended_at: null },
      ],
    })
    expect(got).toMatchObject({ entries: 1, skipped: 1 })
  })

  /**
   * ⚠️ A FILE WITH EVERY FIELD FILLED IN, because the round trip above proves only as much as its
   * fixture populates. Deleting `quality` from the put-back left all 34 tests green: the entries
   * it was built from had no rating, so a field that was null before and after said nothing. The
   * same way a tidy fixture hid a missing sort order, and a life-scope window hid a wrong bound in
   * chronicle_tally. Here every column carries a value that is not its default.
   *
   * ⚠️ THE TIMESTAMPS ARE THE EPOCH ON PURPOSE. The double keeps a BOOLEAN where the table keeps
   * a moment — `archived`, `done` — so it cannot give back the particular instant an activity was
   * archived; it gives back the stand-in it exports. That is a property of the harness, not of
   * chronicle_import, and the server's own round trip is checked in SQL instead. Using the
   * stand-in here keeps the test about the fields the double really does carry.
   */
  it('gives back a file with every field filled in, unchanged', () => {
    const EPOCH = new Date(0).toISOString()
    const act = '11111111-1111-4111-8111-111111111111'
    const file = {
      kind: 'chronicle',
      version: 1,
      at: '',
      activities: [
        {
          id: act,
          name: 'Reading',
          cat: 'life',
          colour: '#aabbcc',
          archived_at: EPOCH,
          created_at: EPOCH,
          auto: true,
          metric: 'pages',
          session_mins: 25,
        },
      ],
      entries: [
        {
          id: '22222222-2222-4222-8222-222222222222',
          activity: act,
          started_at: h(9),
          ended_at: h(10),
          note: 'a note',
          amount: 12.5,
          quality: 4,
          created_at: h(9),
        },
      ],
      goals: [
        {
          id: '33333333-3333-4333-8333-333333333333',
          title: 'Read more',
          scope: 'week',
          anchor: DAY,
          repeat_every: 1,
          target: 30,
          unit: 'pages',
          progress: 7,
          done_at: EPOCH,
          note: 'why it matters',
          sort: 3,
          activity: act,
          cat: null,
          counts: 'amount',
          est_mins: 45,
          priority: 2,
          created_at: EPOCH,
          updated_at: EPOCH,
        },
      ],
      routines: [
        {
          id: '44444444-4444-4444-8444-444444444444',
          name: 'Evening',
          steps: [{ activity: act, mins: 20 }],
          created_at: EPOCH,
          updated_at: EPOCH,
        },
      ],
      plans: [
        {
          id: '55555555-5555-4555-8555-555555555555',
          activity: act,
          starts_at: h(14),
          ends_at: h(15),
          note: 'planned',
          created_at: h(14),
        },
      ],
    }

    pvEmpty()
    const got = pvImport(file)
    expect(got).toEqual({
      activities: 1,
      entries: 1,
      goals: 1,
      routines: 1,
      plans: 1,
      skipped: 0,
    })
    expect(JSON.stringify({ ...pvExport(), at: '' })).toBe(JSON.stringify(file))
  })

  it('accounts for every row in the file, added or skipped', () => {
    const file = pvExport()
    pvEmpty()
    const got = pvImport(file) as Record<string, number>
    const added = got.activities + got.entries + got.goals + got.routines + got.plans
    expect(added + got.skipped).toBe(rows(file))
  })
})

describe('moving a session to another activity', () => {
  /* ⚠️ pvAddEntry answers null on success rather than the row, the same as its server
     counterpart returns void — so the id has to be read back off the day */
  const added = (activity: string, from: string, to: string): string => {
    pvAddEntry(activity, from, to, null)
    const mine = pvEntries(dayStart(), dayEnd()).filter(
      (e) => e.activity === activity && e.start === from,
    )
    return mine[mine.length - 1].id
  }

  /**
   * ⚠️ THE MISTAKE THIS IS FOR is pressing Start on the wrong activity, which is the likeliest one
   * a stopwatch allows. Until now the only remedy was deleting the session and typing it in again,
   * which loses the amount, the rating and the day it was recorded — so the test that matters is
   * that moving it KEEPS those.
   */
  it('keeps the amount and the rating that were already on it', () => {
    const id = added(gym, h(9), h(10))
    pvAmount(id, 12)
    pvQuality(id, 4)

    expect(pvEditEntry(id, h(9), h(10), null, draw)).toBe(null)

    const moved = pvEntries(dayStart(), dayEnd()).find((e) => e.id === id)
    expect(moved?.activity).toBe(draw)
    expect(moved?.amount).toBe(12)
    expect(moved?.quality).toBe(4)
  })

  it('leaves the activity alone when none is named', () => {
    const id = added(gym, h(9), h(10))
    expect(pvEditEntry(id, h(11), h(12), null)).toBe(null)
    const after = pvEntries(dayStart(), dayEnd()).find((e) => e.id === id)
    expect(after?.activity).toBe(gym)
    expect(after?.start).toBe(h(11))
  })

  /**
   * ⚠️ THE ONE THE FOREIGN KEY WOULD NOT CATCH. An activity id that is not yours is a real row, so
   * the database would accept the reference — leaving you with a session pointing into somebody
   * else's list, and your minutes landing in their totals from the other side. It is refused by
   * ownership, not by existence.
   */
  it('refuses an activity that is not yours, and does not move the session', () => {
    const id = added(gym, h(9), h(10))
    expect(pvEditEntry(id, h(9), h(10), null, 'somebody-elses-activity')).toEqual({
      why: 'that is not one of your activities',
    })
    expect(pvEntries(dayStart(), dayEnd()).find((e) => e.id === id)?.activity).toBe(gym)
  })

  it('still refuses a span that ends before it starts, whatever it is being moved to', () => {
    const id = added(gym, h(9), h(10))
    expect(pvEditEntry(id, h(10), h(9), null, draw)).toEqual({
      why: 'that span ends before it starts',
    })
    expect(pvEntries(dayStart(), dayEnd()).find((e) => e.id === id)?.activity).toBe(gym)
  })

  /** moving it moves its minutes with it — the totals are the reason any of this matters */
  it('moves the minutes to the activity it was moved to', () => {
    const id = added(gym, h(9), h(10))
    const was = pvTotals(dayStart(), dayEnd())
    expect(was.find((t) => t.activity === gym)?.mins).toBe(60)

    pvEditEntry(id, h(9), h(10), null, draw)

    const now = pvTotals(dayStart(), dayEnd())
    expect(now.find((t) => t.activity === gym)?.mins).toBe(0)
    expect(now.find((t) => t.activity === draw)?.mins).toBe(60)
  })
})

describe('the note on a session', () => {
  const added = (activity: string, from: string, to: string, note: string | null): string => {
    pvAddEntry(activity, from, to, note)
    const mine = pvEntries(dayStart(), dayEnd()).filter(
      (e) => e.activity === activity && e.start === from,
    )
    return mine[mine.length - 1].id
  }
  const noteOf = (id: string) => pvEntries(dayStart(), dayEnd()).find((e) => e.id === id)?.note

  /**
   * ⚠️ THE BUG THIS IS FOR WAS REAL AND SHIPPED. The room passed `null` as the note on every edit
   * and the server read null as "clear it", so opening a session's editor and pressing Save —
   * changing nothing — destroyed whatever you had written. Measured in the harness before the fix:
   * "drafted chapter three" became null with no other field touched. Null means LEAVE IT ALONE
   * now, which is also what makes the bundle somebody already has open stop losing notes.
   */
  it('survives an edit that does not mention it', () => {
    const id = added(draw, h(9), h(10), 'drafted chapter three')
    expect(pvEditEntry(id, h(11), h(12), null)).toBe(null)
    expect(noteOf(id)).toBe('drafted chapter three')
    /* and the edit still did what it was for */
    expect(pvEntries(dayStart(), dayEnd()).find((e) => e.id === id)?.start).toBe(h(11))
  })

  it('survives being moved to another activity', () => {
    const id = added(draw, h(9), h(10), 'drafted chapter three')
    pvEditEntry(id, h(9), h(10), null, gym)
    expect(noteOf(id)).toBe('drafted chapter three')
  })

  it('can be rewritten, and is trimmed', () => {
    const id = added(draw, h(9), h(10), 'first go')
    pvEditEntry(id, h(9), h(10), '  second go  ')
    expect(noteOf(id)).toBe('second go')
  })

  /** clearing one is still possible and now has to be asked for */
  it('is cleared by an empty box, and by one holding only spaces', () => {
    const id = added(draw, h(9), h(10), 'first go')
    pvEditEntry(id, h(9), h(10), '')
    expect(noteOf(id)).toBe(null)

    const other = added(gym, h(13), h(14), 'something')
    pvEditEntry(other, h(13), h(14), '    ')
    expect(noteOf(other)).toBe(null)
  })
})

describe('fields the room cannot write, and so used to erase', () => {
  /**
   * ⚠️ THE SAME SHAPE AS A SESSION'S NOTE, TWICE MORE — and both became reachable only when the
   * import shipped. An activity's `colour` and a goal's `note` are columns the room has never been
   * able to set: `saveActivity` passes null for the colour because there is no colour picker, and
   * `saveGoal` omits the note field entirely. Both save functions read that silence as "clear it",
   * which was harmless for as long as nothing could put a value there in the first place.
   *
   * chronicle_export carries both columns and chronicle_import puts them back, so a restored file
   * is now the one way either can hold anything — and the next ordinary edit in the room was
   * deleting it. Measured in a simulated session before the fix: "#aabbcc" and "because I keep
   * meaning to" both became NULL after a rename and a re-save.
   */
  it('keeps an activity colour through a rename that does not mention it', () => {
    const id = pvSaveActivity('Reading', 'free', '#aabbcc').id
    expect(pvActivities().find((a) => a.id === id)?.colour).toBe('#aabbcc')

    pvSaveActivity('Reading in the evening', 'life', null, id)

    const after = pvActivities().find((a) => a.id === id)
    expect(after?.colour).toBe('#aabbcc')
    /* and the rename still happened */
    expect(after?.name).toBe('Reading in the evening')
    expect(after?.cat).toBe('life')
  })

  it('clears an activity colour when that is asked for', () => {
    const id = pvSaveActivity('Reading', 'free', '#aabbcc').id
    pvSaveActivity('Reading', 'free', '', id)
    expect(pvActivities().find((a) => a.id === id)?.colour).toBe(null)
  })

  it('keeps a goal note through an edit that does not mention it', () => {
    const id = pvSaveGoal({
      title: 'Read more',
      scope: 'day',
      anchor: DAY,
      every: null,
      target: 30,
      unit: 'mins',
      note: 'because I keep meaning to',
    }).id

    /* the shape the room actually sends: no note field at all */
    pvSaveGoal({
      id,
      title: 'Read even more',
      scope: 'day',
      anchor: DAY,
      every: null,
      target: 45,
      unit: 'mins',
    })

    const after = pvGoals().find((g) => g.id === id)
    expect(after?.note).toBe('because I keep meaning to')
    expect(after?.title).toBe('Read even more')
    expect(after?.target).toBe(45)
  })

  it('clears a goal note when that is asked for', () => {
    const id = pvSaveGoal({
      title: 'Read more',
      scope: 'day',
      anchor: DAY,
      every: null,
      target: 30,
      unit: 'mins',
      note: 'because I keep meaning to',
    }).id
    pvSaveGoal({
      id,
      title: 'Read more',
      scope: 'day',
      anchor: DAY,
      every: null,
      target: 30,
      unit: 'mins',
      note: '  ',
    })
    expect(pvGoals().find((g) => g.id === id)?.note).toBe(null)
  })
})

describe('correcting the session you are in the middle of', () => {
  /**
   * ⚠️ UNTIL NOW IT COULD NOT BE CORRECTED AT ALL. The editor needs both ends of a span, so it was
   * offered only on finished sessions — a consequence of the editor's shape rather than a
   * decision — which left the two mistakes you notice WHILE WORKING with the same remedy: press
   * Stop. That ends the session at a moment you did not choose and leaves you starting a second
   * one, which is a worse record of the day than the one you were trying to fix.
   */
  /* ⚠️ a wide window, not the fixture's day: pvStart begins NOW, and the rest of this file works
     in a fixed day in the past, so the running sitting is not inside dayStart()..dayEnd() */
  const wide = (): string[] => [
    new Date(Date.now() - 2 * 86_400_000).toISOString(),
    new Date(Date.now() + 86_400_000).toISOString(),
  ]
  const running = () => pvEntries(wide()[0], wide()[1]).find((e) => e.end == null)

  beforeEach(() => {
    pvStart(draw)
    /* ⚠️ wound back half an hour, because pvEntries asks for OVERLAP greater than zero and a
       sitting begun a millisecond ago has none yet — it would be invisible to every reader in
       this file. Half an hour in is also the state the feature is for. */
    pvFixRunning(new Date(Date.now() - 30 * 60_000).toISOString(), null)
  })

  it('moves it to another activity without ending it', () => {
    expect(running()?.activity).toBe(draw)
    expect(pvFixRunning(null, gym)).toBe(null)
    expect(running()?.activity).toBe(gym)
    expect(running()?.end).toBe(null)
  })

  it('winds the start back without touching what it is', () => {
    const was = running()!.start
    const earlier = new Date(Date.parse(was) - 20 * 60_000).toISOString()
    expect(pvFixRunning(earlier, null)).toBe(null)
    expect(running()?.start).toBe(earlier)
    expect(running()?.activity).toBe(draw)
  })

  it('takes both at once', () => {
    const earlier = new Date(Date.now() - 45 * 60_000).toISOString()
    pvFixRunning(earlier, gym)
    expect(running()?.start).toBe(earlier)
    expect(running()?.activity).toBe(gym)
  })

  it('refuses a start in the future, one more than a day ago, and an activity that is not yours', () => {
    const was = running()!.start
    expect(pvFixRunning(new Date(Date.now() + 60_000).toISOString(), null)).toEqual({
      why: 'that is in the future',
    })
    expect(pvFixRunning(new Date(Date.now() - 25 * 3_600_000).toISOString(), null)).toEqual({
      why: 'that is more than a day ago',
    })
    expect(pvFixRunning(null, 'not-an-activity')).toEqual({
      why: 'that is not one of your activities',
    })
    /* and none of them moved it */
    expect(running()?.start).toBe(was)
    expect(running()?.activity).toBe(draw)
  })

  it('refuses when nothing is running', () => {
    pvStop(null)
    expect(running()).toBe(undefined)
    expect(pvFixRunning(new Date().toISOString(), gym)).toEqual({ why: 'nothing is running' })
  })

  it('leaves the finished sessions alone', () => {
    pvAddEntry(gym, h(9), h(10), 'earlier')
    const before = pvEntries(dayStart(), dayEnd())
    pvFixRunning(new Date(Date.now() - 10 * 60_000).toISOString(), gym)
    expect(pvEntries(dayStart(), dayEnd())).toEqual(before)
  })
})
