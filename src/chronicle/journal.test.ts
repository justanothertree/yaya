import { describe, expect, it } from 'vitest'
import { aboutDay, byDay, dayLogNotes, journalRows, matching } from './journal'
import type { Activity, Entry } from './record'

/* local times, built the way the room builds them, so a day boundary is a day boundary here */
const at = (iso: string, hh: number, mm = 0) => {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(y, m - 1, d, hh, mm).toISOString()
}
const ms = (iso: string, hh = 0) => Date.parse(at(iso, hh))

/**
 * Every field set to something other than its default, so a rule reading the wrong one has
 * somewhere to be wrong — the sitting starts on a different day from its notes, and has an
 * amount, a rating and a picture nothing here should look at.
 */
const sitting = (over: Partial<Entry> = {}): Entry => ({
  id: 'e1',
  activity: 'a-gym',
  start: at('2026-11-02', 23, 0),
  end: at('2026-11-03', 1, 0),
  notes: [],
  picture: 'pic-1',
  amount: 40,
  quality: 4,
  ...over,
})

const gym: Activity = {
  id: 'a-gym',
  name: 'Gym',
  cat: 'life',
  colour: '#3a7',
  archived: false,
  auto: false,
  metric: 'reps',
  shared: false,
  visibility: 'private',
  session: 45,
}

describe('every note, as one list', () => {
  it('lists a note under the day it was written, and opens it on the day its sitting began', () => {
    /* the sitting began at 23:00 on the 2nd; the note was written at 00:30 on the 3rd */
    const e = sitting({
      notes: [{ id: 'n1', at: at('2026-11-03', 0, 30), body: 'left knee again' }],
    })
    const [row] = journalRows([e], ms('2026-11-01'), ms('2026-11-05'))
    expect([row.day, row.sat]).toEqual(['2026-11-03', '2026-11-02'])
  })

  it('opens a note added days later on the day the sitting happened', () => {
    /* a Monday session written about on Thursday — Thursday's log does not contain it */
    const e = sitting({
      start: at('2026-11-02', 9),
      end: at('2026-11-02', 10),
      notes: [{ id: 'n1', at: at('2026-11-05', 20), body: 'thinking about it since' }],
    })
    const [row] = journalRows([e], ms('2026-11-01'), ms('2026-11-07'))
    expect([row.day, row.sat]).toEqual(['2026-11-05', '2026-11-02'])
  })

  it('leaves out a note written before the window, on a sitting that overlaps it', () => {
    /* the sitting straddles the window's start and carries a note from before it opened */
    const e = sitting({
      start: at('2026-10-31', 22),
      end: at('2026-11-01', 2),
      notes: [
        { id: 'old', at: at('2026-10-31', 23), body: 'from last month' },
        { id: 'new', at: at('2026-11-01', 1), body: 'from this one' },
      ],
    })
    expect(journalRows([e], ms('2026-11-01'), ms('2026-12-01')).map((r) => r.id)).toEqual(['new'])
  })

  it('treats the window as half-open, like every other window here', () => {
    const e = sitting({
      notes: [
        { id: 'at-start', at: at('2026-11-01', 0), body: 'a' },
        { id: 'at-end', at: at('2026-11-02', 0), body: 'b' },
      ],
    })
    expect(journalRows([e], ms('2026-11-01'), ms('2026-11-02')).map((r) => r.id)).toEqual([
      'at-start',
    ])
  })

  it('puts the newest first, across sittings', () => {
    const a = sitting({ id: 'e1', notes: [{ id: 'n1', at: at('2026-11-02', 9), body: 'a' }] })
    const b = sitting({ id: 'e2', notes: [{ id: 'n2', at: at('2026-11-03', 9), body: 'b' }] })
    expect(journalRows([a, b], ms('2026-11-01'), ms('2026-11-05')).map((r) => r.id)).toEqual([
      'n2',
      'n1',
    ])
  })

  it('lists a note once even when its sitting arrives twice', () => {
    /* two fetched windows joined can both carry a sitting that straddles their seam */
    const e = sitting({ notes: [{ id: 'n1', at: at('2026-11-03', 0, 30), body: 'once' }] })
    expect(journalRows([e, e], ms('2026-11-01'), ms('2026-11-05'))).toHaveLength(1)
  })

  it('groups by the day written, newest day first', () => {
    const e = sitting({
      notes: [
        { id: 'n1', at: at('2026-11-02', 23, 30), body: 'a' },
        { id: 'n2', at: at('2026-11-03', 0, 30), body: 'b' },
        { id: 'n3', at: at('2026-11-03', 8), body: 'c' },
      ],
    })
    const days = byDay(journalRows([e], ms('2026-11-01'), ms('2026-11-05')))
    expect(days.map(([d, rs]) => [d, rs.map((r) => r.id)])).toEqual([
      ['2026-11-03', ['n3', 'n2']],
      ['2026-11-02', ['n1']],
    ])
  })
})

describe('searching what you wrote', () => {
  const rows = journalRows(
    [
      sitting({
        notes: [
          { id: 'n1', at: at('2026-11-03', 8), body: 'Left knee again' },
          { id: 'n2', at: at('2026-11-03', 9), body: 'felt strong' },
        ],
      }),
      sitting({
        id: 'e2',
        activity: 'a-draw',
        notes: [{ id: 'n3', at: at('2026-11-03', 10), body: 'the hands, finally' }],
      }),
    ],
    ms('2026-11-01'),
    ms('2026-11-05'),
  )

  it('finds words regardless of case', () => {
    expect(matching(rows, 'KNEE', [gym]).map((r) => r.id)).toEqual(['n1'])
  })

  it('finds notes by the name of what they were written about, which they rarely say', () => {
    expect(matching(rows, 'gym', [gym]).map((r) => r.id)).toEqual(['n2', 'n1'])
  })

  it('keeps everything for an empty or blank search', () => {
    expect(matching(rows, '   ', [gym])).toHaveLength(3)
  })
})

describe('notes with no session', () => {
  /* local noon of a local date, so the fixtures mean the same day in any zone the suite runs in */
  const noon = (iso: string) => new Date(`${iso}T12:00:00`).toISOString()
  const dayStart = (iso: string) => new Date(`${iso}T00:00:00`).getTime()

  it('lists a day note under the day it is about, even when written on another', () => {
    const rows = journalRows([], dayStart('2026-11-01'), dayStart('2026-11-08'), [
      {
        id: 'd1',
        on: '2026-11-03',
        at: noon('2026-11-05'),
        body: 'about Tuesday, written Thursday',
      },
    ])
    expect(rows.map((r) => [r.day, r.entry, r.sat])).toEqual([['2026-11-03', null, null]])
  })

  it('keeps the days in order when a note about one day is written on a later one', () => {
    const rows = journalRows([], dayStart('2026-11-01'), dayStart('2026-11-08'), [
      { id: 'late', on: '2026-11-03', at: noon('2026-11-06'), body: 'about the 3rd' },
      { id: 'mid', on: '2026-11-05', at: noon('2026-11-05'), body: 'about the 5th' },
    ])
    /* sorted by moment alone, the 3rd's note (written on the 6th) would come first and open a
       "3rd" group above the 5th's */
    expect(byDay(rows).map(([d]) => d)).toEqual(['2026-11-05', '2026-11-03'])
  })

  it('stops at the end of the window by date, like everything else', () => {
    const rows = journalRows([], dayStart('2026-11-01'), dayStart('2026-11-08'), [
      { id: 'in', on: '2026-11-07', at: noon('2026-11-07'), body: 'last day in' },
      { id: 'out', on: '2026-11-08', at: noon('2026-11-08'), body: 'first day out' },
    ])
    expect(rows.map((r) => r.id)).toEqual(['in'])
  })

  it('is found by its words, and a search for an activity does not trip over it', () => {
    const rows = journalRows([], dayStart('2026-11-01'), dayStart('2026-11-08'), [
      { id: 'd', on: '2026-11-02', at: noon('2026-11-02'), body: 'left knee again' },
    ])
    expect([matching(rows, 'knee', []).length, matching(rows, 'gym', []).length]).toEqual([1, 0])
  })
})

/**
 * ⚠️ §15a, ANSWERED: "a genuine timestamp and no duration. Don't invent a time where only a date
 * is known." Each case below is a note whose two facts — written when, about which day — either
 * agree or do not.
 */
describe("a note with no session, in one day's log", () => {
  const note = (id: string, on: string, writtenOn: string, hh: number, mm = 0) => ({
    id,
    on,
    at: at(writtenOn, hh, mm),
    body: `note ${id}`,
  })

  it('has its time when it was written during the day it is about', () => {
    const rows = dayLogNotes(
      [note('a', '2026-11-03', '2026-11-03', 8, 14)],
      '2026-11-03',
      ms('2026-11-03'),
      ms('2026-11-04'),
    )
    expect(rows.map((r) => [r.n.id, r.timed, r.at])).toEqual([
      ['a', true, Date.parse(at('2026-11-03', 8, 14))],
    ])
  })

  it('has NO time when it was written on another day, and goes to the head of the day', () => {
    const rows = dayLogNotes(
      [
        note('later', '2026-11-03', '2026-11-05', 8, 14),
        note('before', '2026-11-03', '2026-11-02', 23, 50),
      ],
      '2026-11-03',
      ms('2026-11-03'),
      ms('2026-11-04'),
    )
    expect(rows.map((r) => [r.n.id, r.timed, r.at])).toEqual([
      ['later', false, Infinity],
      ['before', false, Infinity],
    ])
  })

  it('belongs to the day it is ABOUT, not the day it was written', () => {
    const notes = [note('about-tue', '2026-11-03', '2026-11-05', 9)]
    expect([
      dayLogNotes(notes, '2026-11-05', ms('2026-11-05'), ms('2026-11-06')).length,
      dayLogNotes(notes, '2026-11-03', ms('2026-11-03'), ms('2026-11-04')).length,
    ]).toEqual([0, 1])
  })

  it('counts the first instant of the day in and the first of the next out', () => {
    const rows = dayLogNotes(
      [
        { id: 'first', on: '2026-11-03', at: new Date(ms('2026-11-03')).toISOString(), body: '' },
        { id: 'next', on: '2026-11-03', at: new Date(ms('2026-11-04')).toISOString(), body: '' },
      ],
      '2026-11-03',
      ms('2026-11-03'),
      ms('2026-11-04'),
    )
    expect(rows.map((r) => [r.n.id, r.timed])).toEqual([
      ['first', true],
      ['next', false],
    ])
  })

  it('reads an unreadable moment as no time at all, never as midnight', () => {
    const rows = dayLogNotes(
      [{ id: 'x', on: '2026-11-03', at: 'not a date', body: '' }],
      '2026-11-03',
      ms('2026-11-03'),
      ms('2026-11-04'),
    )
    expect(rows.map((r) => [r.timed, r.at])).toEqual([[false, Infinity]])
  })
})

describe('the day the Journal box is writing about', () => {
  it('is named today, yesterday, or by its date', () => {
    expect([aboutDay('2026-11-08', '2026-11-08'), aboutDay('2026-11-07', '2026-11-08')]).toEqual([
      'today',
      'yesterday',
    ])
    expect(aboutDay('2026-11-03', '2026-11-08')).toMatch(/3/)
    expect(aboutDay('2026-11-03', '2026-11-08')).not.toMatch(/today|yesterday/)
  })

  it('knows yesterday across a month and a year', () => {
    expect([aboutDay('2026-10-31', '2026-11-01'), aboutDay('2026-12-31', '2027-01-01')]).toEqual([
      'yesterday',
      'yesterday',
    ])
  })
})
