import { describe, expect, it } from 'vitest'
import { recentFirst, tilesFor, usualFirst, type Sat } from './nowTiles'
import { dayBounds, type Activity } from './record'
/* the project's own local-date formatter, rather than a fourth copy of the same three lines */
import { localISO } from '../circuit/dates'

const act = (over: Partial<Activity> & { id: string; name: string }): Activity => ({
  cat: 'free',
  colour: null,
  shared: false,
  visibility: 'private',
  archived: false,
  auto: false,
  metric: null,
  session: null,
  ...over,
})

const NOW = Date.parse('2026-10-16T18:00:00.000Z')
/**
 * ⚠️ THE WINDOW IS THE DAY `NOW` FALLS IN, taken from `dayBounds` rather than typed in, so these
 * fixtures mean the same thing in any timezone the suite runs in. Every sitting below is minutes
 * before NOW and well inside it; the ones that deliberately are not have their own test.
 */
const DAY = dayBounds(localISO(new Date(NOW)))
const ago = (mins: number) => new Date(NOW - mins * 60_000).toISOString()
const sat = (activity: string, fromMins: number, toMins: number | null): Sat => ({
  activity,
  start: ago(fromMins),
  end: toMins === null ? null : ago(toMins),
})

describe('the buttons the switch row offers', () => {
  const draw = act({ id: 'd', name: 'Drawing' })
  const gym = act({ id: 'g', name: 'Gym' })
  const dishes = act({ id: 'h', name: 'Dishes' })

  it('offers every activity, even one with no time against it', () => {
    expect(tilesFor([draw, gym, dishes], [], DAY.fromMs, DAY.toMs, NOW).map((a) => a.id)).toEqual([
      'h',
      'd',
      'g',
    ])
  })

  /**
   * ⚠️ THE ORDER IS THE ERGONOMICS. The two or three things somebody actually does should be
   * under the thumb without reading, so the claim is about MINUTES rather than about the order
   * the server happened to send.
   */
  it('puts the most-used first', () => {
    const log = [sat('g', 120, 60), sat('d', 30, 20)]
    expect(tilesFor([draw, gym, dishes], log, DAY.fromMs, DAY.toMs, NOW).map((a) => a.id)).toEqual([
      'g',
      'd',
      'h',
    ])
  })

  /** ⚠️ and the one you are IN counts to now, or it sits wherever it was this morning */
  it('counts the sitting that has not ended yet', () => {
    /* drawing has 10 recorded minutes; gym has been running for 40 and must overtake it */
    const log = [sat('d', 60, 50), sat('g', 40, null)]
    expect(tilesFor([draw, gym], log, DAY.fromMs, DAY.toMs, NOW).map((a) => a.id)).toEqual([
      'g',
      'd',
    ])
  })

  it('breaks a tie by name, so an untouched screen does not shuffle between loads', () => {
    const z = act({ id: 'z', name: 'Admin' })
    expect(tilesFor([draw, gym, z], [], DAY.fromMs, DAY.toMs, NOW).map((a) => a.name)).toEqual([
      'Admin',
      'Drawing',
      'Gym',
    ])
  })

  /**
   * ⚠️ BOTH EXCLUSIONS, for reasons that differ. `chronicle_start` refuses an activity with an
   * `archived_at`, so a tile for one is a button whose only answer is an error; an `auto`
   * activity is written by the room rather than started by a person.
   */
  it('leaves out an archived activity, which cannot be started at all', () => {
    const gone = act({ id: 'x', name: 'Guitar', archived: true })
    expect(tilesFor([draw, gone], [], DAY.fromMs, DAY.toMs, NOW).map((a) => a.id)).toEqual(['d'])
  })

  it('leaves out an auto activity, which the room writes rather than you', () => {
    const auto = act({ id: 'c', name: 'Chronicle', auto: true })
    expect(tilesFor([draw, auto], [], DAY.fromMs, DAY.toMs, NOW).map((a) => a.id)).toEqual(['d'])
  })

  /** ⚠️ even with minutes against it — an archived activity keeps its history and stays unstartable */
  it('and leaves an archived one out however much time it has', () => {
    const gone = act({ id: 'x', name: 'Guitar', archived: true })
    expect(
      tilesFor([draw, gone], [sat('x', 300, 0)], DAY.fromMs, DAY.toMs, NOW).map((a) => a.id),
    ).toEqual(['d'])
  })

  /** a log naming something that is not an activity any more must not throw or invent a tile */
  it('ignores a sitting whose activity is gone', () => {
    expect(
      tilesFor([draw], [sat('vanished', 60, 0)], DAY.fromMs, DAY.toMs, NOW).map((a) => a.id),
    ).toEqual(['d'])
  })

  it('survives a sitting with an unparseable date rather than sorting by NaN', () => {
    const junk: Sat = { activity: 'd', start: 'not a date', end: null }
    expect(
      tilesFor([draw, gym], [junk, sat('g', 30, 0)], DAY.fromMs, DAY.toMs, NOW).map((a) => a.id),
    ).toEqual(['g', 'd'])
  })

  /**
   * ⚠️ THE CLAIM IN THE HEADING IS "TODAY", AND IT USED NOT TO BE. `tilesFor` summed `to - from`
   * for every sitting it was handed, which is minutes today only while the caller's log holds
   * exactly today — and `entriesBetween` deliberately returns a sitting that straddles midnight,
   * because `record.ts` says such a sitting "belongs to two days, one hour each". Both hours were
   * counted here.
   *
   * The expectation is written from the DAY rather than from the function's sum: a night shift
   * holds seven hours of today and the other sitting holds seven and a half, so the other one
   * belongs first. Before the fix this answered Night shift, because eight beats seven and a half.
   */
  it('weighs a sitting across midnight by its share of today, not its whole length', () => {
    const night = act({ id: 'n', name: 'Night shift' })
    const office = act({ id: 'o', name: 'Office' })
    const H = 3_600_000
    const log: Sat[] = [
      /* 23:00 yesterday → 07:00 today: eight hours long, seven of them today */
      {
        activity: 'n',
        start: new Date(DAY.fromMs - H).toISOString(),
        end: new Date(DAY.fromMs + 7 * H).toISOString(),
      },
      /* 09:00 → 16:30 today: seven and a half, all of it today */
      {
        activity: 'o',
        start: new Date(DAY.fromMs + 9 * H).toISOString(),
        end: new Date(DAY.fromMs + 16.5 * H).toISOString(),
      },
    ]
    expect(tilesFor([night, office], log, DAY.fromMs, DAY.toMs, DAY.toMs).map((a) => a.id)).toEqual(
      ['o', 'n'],
    )
  })

  /**
   * ⚠️ AND THE OTHER SIDE OF MIDNIGHT, so the fix is not just "subtract something". The same
   * sitting read from YESTERDAY's window is worth the hour before midnight and no more — which
   * is what stops the two days double-counting it between them.
   */
  it('gives yesterday only the part of that sitting that fell in yesterday', () => {
    const night = act({ id: 'n', name: 'Night shift' })
    const H = 3_600_000
    const before = { fromMs: DAY.fromMs - 24 * H, toMs: DAY.fromMs }
    const log: Sat[] = [
      {
        activity: 'n',
        start: new Date(DAY.fromMs - H).toISOString(),
        end: new Date(DAY.fromMs + 7 * H).toISOString(),
      },
    ]
    /* an activity with nothing in the window still appears — it is a button, not a total */
    const quiet = act({ id: 'q', name: 'Aardvark' })
    const order = tilesFor([night, quiet], log, before.fromMs, before.toMs, DAY.toMs)
    /* one hour beats nothing, even though "Aardvark" sorts first by name */
    expect(order.map((a) => a.id)).toEqual(['n', 'q'])
  })

  /**
   * ⚠️ THE OTHER END, AND THIS TEST EXISTS BECAUSE A PERTURBATION SURVIVED WITHOUT IT. Clamping
   * only the START — `Math.max(Date.parse(e.start), fromMs)`, which looks like the whole fix —
   * passed all thirteen of the cases above. None of them had a sitting whose END falls outside
   * the window, so the missing clamp had nothing to bite on, and the suite read as a wide one.
   *
   * Here it decides the order: a sitting from 22:00 running four hours into tomorrow holds two
   * hours of TODAY, which is less than a three-hour afternoon — but four is more than three.
   */
  it('weighs a sitting that runs past the end of the window by its share too', () => {
    const late = act({ id: 'l', name: 'Late' })
    const noon = act({ id: 'n', name: 'Noon' })
    const H = 3_600_000
    const log: Sat[] = [
      /* 22:00 today → 02:00 tomorrow: four hours long, two of them today */
      {
        activity: 'l',
        start: new Date(DAY.fromMs + 22 * H).toISOString(),
        end: new Date(DAY.toMs + 2 * H).toISOString(),
      },
      /* 09:00 → 12:00 today: three hours, all of them today */
      {
        activity: 'n',
        start: new Date(DAY.fromMs + 9 * H).toISOString(),
        end: new Date(DAY.fromMs + 12 * H).toISOString(),
      },
    ]
    const nowMs = DAY.toMs + 3 * H
    expect(tilesFor([late, noon], log, DAY.fromMs, DAY.toMs, nowMs).map((a) => a.id)).toEqual([
      'n',
      'l',
    ])
  })

  /**
   * ⚠️ A SITTING WHOLLY OUTSIDE THE WINDOW IS WORTH NOTHING, which is the half that a clamp on
   * the start alone would miss. Here the name tie-break is what decides, and it only gets to
   * decide if both activities really are on zero.
   */
  it('ignores a sitting that does not touch the window at all', () => {
    const a1 = act({ id: 'z', name: 'Zebra' })
    const a2 = act({ id: 'a', name: 'Aardvark' })
    const H = 3_600_000
    const log: Sat[] = [
      /* all of it yesterday, hours before this window opens */
      {
        activity: 'z',
        start: new Date(DAY.fromMs - 10 * H).toISOString(),
        end: new Date(DAY.fromMs - 2 * H).toISOString(),
      },
    ]
    expect(tilesFor([a1, a2], log, DAY.fromMs, DAY.toMs, DAY.toMs).map((a) => a.id)).toEqual([
      'a',
      'z',
    ])
  })

  /**
   * ⚠️ THE RUNNING SITTING STILL REACHES TO NOW AND NO FURTHER. This is the one the old code got
   * right and the fix had to keep: `overlapMs` measures an open sitting to `nowMs`, so a timer
   * left going does not claim the rest of the day.
   */
  it('measures the one still going to the clock, not to the end of the day', () => {
    const live = act({ id: 'l', name: 'Live' })
    const done = act({ id: 'd', name: 'Done' })
    const H = 3_600_000
    const nowMs = DAY.fromMs + 10 * H
    const log: Sat[] = [
      /* open since 09:00, so one hour so far — not the fourteen left in the day */
      { activity: 'l', start: new Date(DAY.fromMs + 9 * H).toISOString(), end: null },
      /* two hours, finished */
      {
        activity: 'd',
        start: new Date(DAY.fromMs + 2 * H).toISOString(),
        end: new Date(DAY.fromMs + 4 * H).toISOString(),
      },
    ]
    expect(tilesFor([live, done], log, DAY.fromMs, DAY.toMs, nowMs).map((a) => a.id)).toEqual([
      'd',
      'l',
    ])
  })
})

/**
 * The chips under ▶ Start something: what you started last, then everything else by name.
 *
 * ⚠️ THE FIXTURE STARTS THE BUSIEST ONE FIRST AND A SHORT ONE LAST, so "recent" and "most minutes"
 * give different answers — a fixture where they agreed would pass with `tilesFor` in its place.
 *
 * ⚠️ AND NEITHER ANSWER IS ALPHABETICAL. The first version expected Art, Bass, Cooking — the
 * names' own order — so with the recency sort deleted outright, two of these stayed green. Found by
 * making them fail before believing them (CLAUDE.md §2); the last-started is never the first name.
 */
describe('the most recently started first', () => {
  const acts = [
    act({ id: 'a', name: 'Art' }),
    act({ id: 'b', name: 'Bass' }),
    act({ id: 'c', name: 'Cooking' }),
    act({ id: 'd', name: 'Drift', auto: true }),
    act({ id: 'e', name: 'Embroidery', archived: true }),
  ]

  it('puts the last thing started first, even when something else ran longer', () => {
    /* Bass ran two hours this morning; Cooking ran five minutes just now */
    const log = [sat('b', 300, 180), sat('c', 10, 5)]
    expect(tilesFor(acts, log, DAY.fromMs, DAY.toMs, NOW)[0].id).toBe('b')
    expect(recentFirst(acts, log).map((a) => a.id)).toEqual(['c', 'b', 'a'])
  })

  it('reads a sitting by when it started, and the latest start of each wins', () => {
    /* Bass started first AND last; Cooking in between */
    const log = [sat('b', 200, 190), sat('c', 100, 90), sat('b', 50, null)]
    expect(recentFirst(acts, log).map((a) => a.id)).toEqual(['b', 'c', 'a'])
  })

  it('falls back to the names when nothing has run, and never offers auto or archived', () => {
    expect(recentFirst(acts, []).map((a) => a.id)).toEqual(['a', 'b', 'c'])
    const log = [sat('d', 5, 1), sat('e', 4, 2)]
    expect(recentFirst(acts, log).map((a) => a.id)).toEqual(['a', 'b', 'c'])
  })

  it('ignores a start it cannot read rather than sorting it to the front', () => {
    const log: Sat[] = [{ activity: 'c', start: 'not a date', end: null }, sat('b', 30, 20)]
    expect(recentFirst(acts, log).map((a) => a.id)).toEqual(['b', 'a', 'c'])
  })
})

/**
 * What you usually start around now, first.
 *
 * ⚠️ FOUR WEEKS OF A LIFE, ON THE LOCAL CLOCK, and every expectation is what that life would ask
 * for at the moment named: Gym at seven on weekdays, Drawing at nine every evening, Guitar at half
 * past seven on Saturdays, Reading at ten to midnight, and one stray morning of Dishes. Writing
 * and Dishes were started most recently, so plain recency would put them first; each test below
 * says which habit should beat that, or why none does. Built with `new Date(y, m, d, h, min)`, so
 * the fixture means the same wall-clock times in whatever timezone the suite runs in.
 */
describe('what you usually start around now', () => {
  const gym = act({ id: 'gym', name: 'Gym' })
  const draw = act({ id: 'draw', name: 'Drawing' })
  const guitar = act({ id: 'guitar', name: 'Guitar' })
  const read = act({ id: 'read', name: 'Reading' })
  const write = act({ id: 'write', name: 'Writing' })
  const dishes = act({ id: 'dishes', name: 'Dishes' })
  const gone = act({ id: 'gone', name: 'Archery', archived: true })
  const site = act({ id: 'site', name: 'The site', auto: true })
  const acts = [gym, draw, guitar, read, write, dishes, gone, site]

  const at = (d: Date, h: number, m = 0) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m).toISOString()
  const start = (activity: string, iso: string): Sat => ({ activity, start: iso, end: iso })

  /* the 28 days before Saturday 14 November 2026 */
  const past: Sat[] = []
  for (let i = 28; i >= 1; i--) {
    const d = new Date(2026, 10, 14 - i)
    const dow = d.getDay()
    if (dow >= 1 && dow <= 5) past.push(start('gym', at(d, 7)))
    if (dow === 6) past.push(start('guitar', at(d, 7, 30)))
    past.push(start('draw', at(d, 21)))
    past.push(start('read', at(d, 23, 50)))
    /* archived and the site's own, at exactly seven every day: never offered however strong */
    past.push(start('gone', at(d, 7)), start('site', at(d, 7)))
  }
  /* one Wednesday morning of Dishes, the stray */
  past.push(start('dishes', at(new Date(2026, 10, 11), 7, 15)))
  /* what plain recency would put first: Writing on Friday afternoon, Dishes at Friday lunch */
  const lately = [
    start('write', at(new Date(2026, 10, 13), 15)),
    start('dishes', at(new Date(2026, 10, 13), 12)),
  ]
  const order = (when: Date) => usualFirst(acts, past, lately, when.getTime()).map((a) => a.id)

  it('puts the weekday habit first on a weekday morning, ahead of what ran last', () => {
    /* Monday 16 November, 07:10 */
    expect(order(new Date(2026, 10, 16, 7, 10)).slice(0, 3)).toEqual(['gym', 'guitar', 'write'])
  })

  it('puts this weekday’s habit before one that happens on the other five', () => {
    /* Saturday 14 November, 07:30: Guitar is Saturday's, Gym is every other morning's */
    expect(order(new Date(2026, 10, 14, 7, 30)).slice(0, 2)).toEqual(['guitar', 'gym'])
  })

  it('puts the evening habit first in the evening', () => {
    expect(order(new Date(2026, 10, 16, 21, 5))[0]).toBe('draw')
  })

  it('counts ten to midnight as twenty minutes from ten past', () => {
    expect(order(new Date(2026, 10, 17, 0, 10))[0]).toBe('read')
  })

  it('does not make a routine out of one stray morning', () => {
    /* Wednesday 18 November, 07:15 — the stray Dishes was a Wednesday at exactly this time */
    const o = order(new Date(2026, 10, 18, 7, 15))
    expect(o.slice(0, 2)).toEqual(['gym', 'guitar'])
    /* and Dishes keeps its place by recency, behind Writing, started later on Friday */
    expect(o.indexOf('dishes')).toBeGreaterThan(o.indexOf('write'))
  })

  it('is exactly the recency order with no history, and with nothing near the time', () => {
    const now = new Date(2026, 10, 16, 14, 0).getTime()
    expect(usualFirst(acts, [], lately, now)).toEqual(recentFirst(acts, lately))
    /* two in the afternoon is more than ninety minutes from every habit above */
    expect(usualFirst(acts, past, lately, now)).toEqual(recentFirst(acts, lately))
  })

  it('never offers an archived activity or the site’s own, however regular', () => {
    const o = order(new Date(2026, 10, 16, 7, 0))
    expect(o).not.toContain('gone')
    expect(o).not.toContain('site')
    expect(o).toHaveLength(6)
  })
})
