import { describe, expect, it } from 'vitest'
import { cellChanges, sessionsIn, withConverted, withSessions } from './sessions'
import type { DayLog } from './types'

/** every field away from its default — a picture on the row, two exercises, a value with a fraction */
const log = (over: Partial<DayLog> = {}): DayLog => ({
  id: 'l-p1-2026-11-07',
  personId: 'p1',
  date: '2026-11-07',
  entries: [
    { eid: 'quad', val: 8 },
    { eid: 'bench', val: 2.5 },
  ],
  picture: 'pic-1',
  ...over,
})

describe('the board with sessions in it', () => {
  it('adds a day sessions to the cells it shares, and keeps the session part beside them', () => {
    const [l] = withSessions(
      [log()],
      [
        { person: 'p1', exercise: 'quad', on: '2026-11-07', value: 12 },
        { person: 'p1', exercise: 'plank', on: '2026-11-07', value: 30 },
      ],
    )
    expect(l.entries).toEqual([
      { eid: 'quad', val: 20 },
      { eid: 'bench', val: 2.5 },
      { eid: 'plank', val: 30 },
    ])
    expect([sessionsIn(l, 'quad'), sessionsIn(l, 'bench'), sessionsIn(l, 'plank')]).toEqual([
      12, 0, 30,
    ])
    expect(l.picture).toBe('pic-1')
  })

  it('makes the row a day with only sessions needs, with the id the grid would give it', () => {
    const out = withSessions(
      [log()],
      [{ person: 'p2', exercise: 'quad', on: '2026-11-06', value: 5 }],
    )
    expect(out.find((l) => l.personId === 'p2')).toEqual({
      id: 'l-p2-2026-11-06',
      personId: 'p2',
      date: '2026-11-06',
      entries: [{ eid: 'quad', val: 5 }],
      sessions: [{ eid: 'quad', val: 5 }],
    })
  })

  /* ⚠️ two rows for a day are allowed; the sessions go into ONE, or the board would show them twice */
  it('adds a day sessions to its first row only', () => {
    const out = withSessions(
      [log({ id: 'b-row' }), log({ id: 'a-row', entries: [{ eid: 'quad', val: 1 }] })],
      [{ person: 'p1', exercise: 'quad', on: '2026-11-07', value: 12 }],
    )
    expect(out.map((l) => [l.id, l.entries.find((e) => e.eid === 'quad')?.val])).toEqual([
      ['b-row', 8],
      ['a-row', 13],
    ])
  })

  it('leaves the board as it was when there are no sessions', () => {
    const logs = [log()]
    expect(withSessions(logs, [])).toEqual(logs)
  })
})

describe('what a save sends', () => {
  const seen = withSessions(
    [log()],
    [{ person: 'p1', exercise: 'quad', on: '2026-11-07', value: 12 }],
  )[0]

  it('sends a total, with the sessions and the manual part the screen saw under it', () => {
    /* 20 on screen (8 typed + 12 from sessions), typed as 25 */
    const next = {
      ...seen,
      entries: [
        { eid: 'quad', val: 25 },
        { eid: 'bench', val: 2.5 },
      ],
    }
    expect(cellChanges(seen, next)).toEqual([
      { eid: 'quad', total: 25, seenSessions: 12, seenManual: 8 },
    ])
  })

  it('sends nothing for a cell that did not move — saving 20 again is not 28', () => {
    expect(cellChanges(seen, { ...seen })).toEqual([])
  })

  it('sends a cleared cell as a total of 0, for the server to refuse if sessions hold it', () => {
    const next = { ...seen, entries: [{ eid: 'bench', val: 2.5 }] }
    expect(cellChanges(seen, next)).toEqual([
      { eid: 'quad', total: 0, seenSessions: 12, seenManual: 8 },
    ])
  })

  it('sends a new cell as having had nothing under it', () => {
    const next = { ...seen, entries: [...seen.entries, { eid: 'row', val: 3 }] }
    expect(cellChanges(seen, next)).toEqual([
      { eid: 'row', total: 3, seenSessions: 0, seenManual: 0 },
    ])
  })
})

describe('a converted person, read from sets', () => {
  const logs = [
    log({ id: 'a', entries: [{ eid: 'quad', val: 7 }] }),
    log({
      id: 'b',
      entries: [
        { eid: 'quad', val: 3 },
        { eid: '__total__', val: 50 },
      ],
    }),
    log({ id: 'other', personId: 'p2', entries: [{ eid: 'quad', val: 9 }] }),
  ]
  const typed = [{ person: 'p1', exercise: 'quad', on: '2026-11-07', value: 10 }]

  it('reads the typed part from sets, never also from the logs still holding the originals', () => {
    const out = withConverted(logs, new Set(['p1']), typed)
    const quad = out
      .filter((l) => l.personId === 'p1')
      .flatMap((l) => l.entries)
      .filter((e) => e.eid === 'quad')
      .reduce((n, e) => n + e.val, 0)
    expect(quad).toBe(10)
  })

  it('keeps an imported total read in place, since it was never a cell', () => {
    const out = withConverted(logs, new Set(['p1']), typed)
    expect(out.flatMap((l) => l.entries).filter((e) => e.eid === '__total__')).toEqual([
      { eid: '__total__', val: 50 },
    ])
  })

  it('does not call the typed part sessions', () => {
    const out = withConverted(logs, new Set(['p1']), typed)
    expect(out.filter((l) => l.personId === 'p1').every((l) => !l.sessions)).toBe(true)
  })

  it('leaves everybody not converted exactly as they were', () => {
    expect(withConverted(logs, new Set(['p1']), typed).find((l) => l.id === 'other')).toEqual(
      logs[2],
    )
    expect(withConverted(logs, new Set(), typed)).toEqual(logs)
  })
})
