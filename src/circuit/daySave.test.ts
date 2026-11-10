import { describe, expect, it } from 'vitest'
import { daySave } from './daySave'
import type { DayLog } from './types'

/**
 * ⚠️ EVERY FIELD SET TO SOMETHING OTHER THAN ITS DEFAULT (CLAUDE.md §2): a day with no photo and no
 * sessions is the fixture that would have passed the old autosave, which dropped both.
 */
const day: DayLog = {
  id: 'l-older-id',
  personId: 'pv-person',
  date: '2026-11-07',
  entries: [
    { eid: 'quad', val: 20 },
    { eid: 'plank', val: 90 },
  ],
  img: 'legacy-img',
  picture: 'pic-1',
  sessions: [{ eid: 'quad', val: 15 }],
}

describe('daySave', () => {
  it('replaces the numbers and keeps everything else the board has on that day', () => {
    const saved = daySave(day, 'pv-person', '2026-11-07', [{ eid: 'quad', val: 21 }])
    expect(saved).toEqual({
      id: 'l-older-id',
      personId: 'pv-person',
      date: '2026-11-07',
      entries: [{ eid: 'quad', val: 21 }],
      img: 'legacy-img',
      picture: 'pic-1',
      sessions: [{ eid: 'quad', val: 15 }],
    })
  })

  it('keeps the photo, which is what keeps a cleared day from being deleted', () => {
    expect(daySave(day, 'pv-person', '2026-11-07', []).picture).toBe('pic-1')
  })

  it("keeps the sessions' part, which is what the cell's line and its link are drawn from", () => {
    expect(daySave(day, 'pv-person', '2026-11-07', [{ eid: 'quad', val: 30 }]).sessions).toEqual([
      { eid: 'quad', val: 15 },
    ])
  })

  it('gives a new day the id the grid and the server both give it, and nothing else', () => {
    expect(daySave(undefined, 'p1', '2026-11-08', [{ eid: 'quad', val: 4 }])).toEqual({
      id: 'l-p1-2026-11-08',
      personId: 'p1',
      date: '2026-11-08',
      entries: [{ eid: 'quad', val: 4 }],
    })
  })

  it('does not change the day it was handed', () => {
    const before = JSON.stringify(day)
    daySave(day, 'pv-person', '2026-11-07', [])
    expect(JSON.stringify(day)).toBe(before)
  })
})
