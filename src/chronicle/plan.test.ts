import { describe, expect, it } from 'vitest'
import { against, dayAgainst, planOpens, saySpan, type Plan } from './plan'
import { dayBounds, type Entry } from './record'

const at = (iso: string) => new Date(iso).getTime()

const plan = (over: Partial<Plan> = {}): Plan => ({
  id: 'p1',
  activity: 'draw',
  start: '2026-10-12T09:00:00.000Z',
  end: '2026-10-12T10:00:00.000Z',
  note: null,
  ...over,
})

const entry = (over: Partial<Entry> = {}): Entry => ({
  id: 'e1',
  activity: 'draw',
  start: '2026-10-12T09:00:00.000Z',
  end: '2026-10-12T10:00:00.000Z',
  notes: [],
  picture: null,
  amount: null,
  quality: null,
  ...over,
})

/* a plain UTC day, so the sweep is about instants and does not re-ask what dayBounds owns */
const DAY = { from: at('2026-10-12T00:00:00Z'), to: at('2026-10-13T00:00:00Z') }
const NOON = at('2026-10-12T12:00:00Z')

describe('what a day was meant to be, against what it was', () => {
  /**
   * ⚠️ THE TEST THE OBVIOUS IMPLEMENTATION FAILS. Walking the plans and looking up each one's
   * actual minutes is the natural way to write this, and it can only ever report the first of the
   * two ways a day misses: something planned and not done. An afternoon that vanished into
   * something nobody planned comes back from that version reporting a day that went exactly to
   * plan. Both directions, or it is not a comparison.
   */
  it('shows both kinds of miss — planned and skipped, and done but never planned', () => {
    const plans = [plan({ activity: 'draw' })]
    const entries = [
      entry({ activity: 'email', start: '2026-10-12T14:00:00Z', end: '2026-10-12T16:00:00Z' }),
    ]
    const got = against(plans, entries, DAY.from, DAY.to, NOON)
    expect(got).toEqual([
      { activity: 'draw', planned: 60, did: 0 },
      { activity: 'email', planned: 0, did: 120 },
    ])
  })

  it('and puts the two numbers side by side when they are about the same activity', () => {
    const got = against([plan()], [entry({ end: '2026-10-12T09:35:00Z' })], DAY.from, DAY.to, NOON)
    expect(got).toEqual([{ activity: 'draw', planned: 60, did: 35 }])
  })

  /**
   * ⚠️ A PLAN IN THE FUTURE IS A FORECAST, NOT A FAILURE. Three hours blocked out for the evening
   * read as planned at breakfast — anything else would mean the readout only became true at
   * midnight, which is far too late for the one thing it is for.
   */
  it('and an evening still to come counts as planned, with nothing done yet', () => {
    const evening = plan({ start: '2026-10-12T19:00:00Z', end: '2026-10-12T22:00:00Z' })
    expect(against([evening], [], DAY.from, DAY.to, NOON)).toEqual([
      { activity: 'draw', planned: 180, did: 0 },
    ])
  })

  /**
   * ⚠️ BOTH SIDES SPLIT AT MIDNIGHT THE SAME WAY, because both go through `overlapMs`. A plan
   * from 23:00 to 01:00 is an hour of each day, exactly as the session would be — and the point of
   * asserting it is that the two columns are the same arithmetic asked twice, so they cannot drift
   * apart and report an evening as planned-but-not-done on one day and done-but-unplanned on the
   * next.
   */
  it('and a span across midnight is split identically on both sides', () => {
    const night = { start: '2026-10-12T23:00:00Z', end: '2026-10-13T01:00:00Z' }
    const p = [plan(night)]
    const e = [entry(night)]
    const first = against(p, e, DAY.from, DAY.to, NOON)
    const next = against(p, e, DAY.to, DAY.to + 86_400_000, at('2026-10-13T12:00:00Z'))
    expect(first).toEqual([{ activity: 'draw', planned: 60, did: 60 }])
    expect(next).toEqual([{ activity: 'draw', planned: 60, did: 60 }])
    /* and the two days together are the whole span, once each side */
    expect(first[0].planned + next[0].planned).toBe(120)
    expect(first[0].did + next[0].did).toBe(120)
  })

  it('and a day with neither is an empty list rather than a row of zeroes', () => {
    expect(against([], [], DAY.from, DAY.to, NOON)).toEqual([])
    expect(dayAgainst([], [], DAY.from, DAY.to, NOON)).toEqual({ planned: 0, did: 0 })
  })

  it('and the day as a whole adds up to its rows', () => {
    const plans = [
      plan(),
      plan({
        id: 'p2',
        activity: 'gym',
        start: '2026-10-12T07:00:00Z',
        end: '2026-10-12T08:00:00Z',
      }),
    ]
    const entries = [entry({ end: '2026-10-12T09:20:00Z' })]
    expect(dayAgainst(plans, entries, DAY.from, DAY.to, NOON)).toEqual({ planned: 120, did: 20 })
  })

  /** ⚠️ a running session has no end, so it counts to the clock it is handed and no further */
  it('and a running session counts up to now against its plan', () => {
    const live = entry({ start: '2026-10-12T11:30:00Z', end: null })
    expect(against([plan()], [live], DAY.from, DAY.to, NOON)).toEqual([
      { activity: 'draw', planned: 60, did: 30 },
    ])
  })
})

describe('where a new plan opens', () => {
  const HOUR = 3_600_000
  /* a real local day, because this one is about the day on screen rather than about instants */
  const local = dayBounds('2026-10-12')

  it('is an hour long, after the last thing already planned for that day', () => {
    const booked = [
      plan({
        start: new Date(local.fromMs + 9 * HOUR).toISOString(),
        end: new Date(local.fromMs + 11 * HOUR).toISOString(),
      }),
    ]
    const o = planOpens(booked, local.fromMs, local.toMs, local.fromMs + 8 * HOUR)
    expect(o.fromMs).toBe(local.fromMs + 11 * HOUR)
    expect(o.toMs - o.fromMs).toBe(HOUR)
  })

  it('and the next whole hour when today has nothing planned yet', () => {
    const now = local.fromMs + 9 * HOUR + 17 * 60_000
    const o = planOpens([], local.fromMs, local.toMs, now)
    expect(o.fromMs).toBe(local.fromMs + 10 * HOUR)
    expect(o.toMs - o.fromMs).toBe(HOUR)
  })

  /**
   * ⚠️ IT CANNOT RUN PAST THE DAY IT IS ON. A plan opening at 23:30 would end inside tomorrow, and
   * the day it was added from would then only half show it — the kind of default that teaches
   * somebody the feature is broken.
   */
  it('and never past midnight, however late the day already is', () => {
    const booked = [
      plan({
        start: new Date(local.toMs - 40 * 60_000).toISOString(),
        end: new Date(local.toMs - 10 * 60_000).toISOString(),
      }),
    ]
    const o = planOpens(booked, local.fromMs, local.toMs, local.fromMs + 23 * HOUR)
    expect(o.toMs).toBeLessThanOrEqual(local.toMs)
    expect(o.toMs).toBeGreaterThan(o.fromMs)
  })

  it('and a day that is not today opens in the morning', () => {
    const tomorrow = dayBounds('2026-10-13')
    const o = planOpens([], tomorrow.fromMs, tomorrow.toMs, local.fromMs + 14 * HOUR)
    expect(o.fromMs).toBe(tomorrow.fromMs + 9 * HOUR)
    expect(o.toMs - o.fromMs).toBe(HOUR)
  })
})

/**
 * ⚠️ THE WORDS ARE THE CALLER'S AND THE RULE IS THIS FUNCTION'S, which is why these pass clock
 * faces in as plain strings. `toLocaleTimeString` says something different in every locale, and
 * "may this meridiem be said once" is not a question about what a clock face looks like.
 */
describe('a planned span, as short as it can be said', () => {
  const sameDay = { before: false, after: false }

  it('says the meridiem once when both ends share it', () => {
    expect(saySpan('7:00 AM', '7:45 AM', sameDay)).toBe('7:00–7:45 AM')
  })

  it('and twice when they do not, because dropping one would move the hour', () => {
    expect(saySpan('11:30 AM', '1:00 PM', sameDay)).toBe('11:30 AM–1:00 PM')
  })

  /** a 24-hour locale has no meridiem to collapse, and must not lose a digit to the attempt */
  it('leaves a 24-hour clock alone', () => {
    expect(saySpan('07:00', '07:45', sameDay)).toBe('07:00–07:45')
    expect(saySpan('23:00', '01:00', sameDay)).toBe('23:00–01:00')
  })

  /**
   * ⚠️ THE ONE THIS WAS LIFTED OUT FOR. `chronicle_plans` allows a span of a full day, so 11:00
   * AM to 10:00 AM the next morning is legal — and collapsing that reads "11:00–10:00 AM", one
   * morning running backwards. When an end is in another day it is NAMED, and nothing collapses.
   */
  it('never collapses a span whose ends are in different days', () => {
    const out = saySpan('11:00 AM', '10:00 AM', { before: false, after: true }, () => 'Sat ')
    expect(out).toBe('11:00 AM–Sat 10:00 AM')
    expect(out).not.toContain('11:00–10:00 AM')
  })

  it('names the day at whichever end is not the day being read', () => {
    const dayOf = (w: 'from' | 'to') => (w === 'from' ? 'Fri ' : 'Sat ')
    expect(saySpan('11:00 PM', '1:00 AM', { before: false, after: true }, dayOf)).toBe(
      '11:00 PM–Sat 1:00 AM',
    )
    expect(saySpan('11:00 PM', '1:00 AM', { before: true, after: false }, dayOf)).toBe(
      'Fri 11:00 PM–1:00 AM',
    )
  })

  /** both ends outside is a sitting read from a day in the middle of it — rare, and legible */
  it('names both ends when neither is the day being read', () => {
    const dayOf = (w: 'from' | 'to') => (w === 'from' ? 'Thu ' : 'Sat ')
    expect(saySpan('11:00 PM', '1:00 AM', { before: true, after: true }, dayOf)).toBe(
      'Thu 11:00 PM–Sat 1:00 AM',
    )
  })

  it('defaults to the same day, so an ordinary call reads as it always did', () => {
    expect(saySpan('7:00 AM', '7:45 AM')).toBe('7:00–7:45 AM')
  })
})
