import { describe, expect, it } from 'vitest'
import type { Putback } from './cloud'
import { putBackSays } from './putBackCopy'

const none: Putback = {
  activities: 0,
  entries: 0,
  goals: 0,
  routines: 0,
  plans: 0,
  marks: 0,
  schedules: 0,
  notes: 0,
  sets: 0,
  links: 0,
  skipped: 0,
}

describe('what putting a file back says', () => {
  it('tells an empty file from one that was already here', () => {
    expect(putBackSays(none)).toEqual({ text: 'There was nothing in that file', added: 0 })
    expect(putBackSays({ ...none, skipped: 4 })).toEqual({
      text: 'Everything in that file was already here',
      added: 0,
    })
  })

  it('counts a file that put back only sets or links as having added something', () => {
    /* the case the inline sum got wrong: one set back, the rest already here */
    expect(putBackSays({ ...none, sets: 1, skipped: 3 })).toEqual({
      text: 'Added 1 — 0 sessions, 0 activities, 0 goals, 1 sets.',
      added: 1,
    })
    expect(putBackSays({ ...none, links: 2, skipped: 1 }).text).toBe(
      'Added 2 — 0 sessions, 0 activities, 0 goals, 2 linked exercises.',
    )
  })

  it('counts every kind it names, and a schedule only through its goal', () => {
    const got = {
      activities: 1,
      entries: 2,
      goals: 3,
      routines: 4,
      plans: 5,
      marks: 6,
      schedules: 70,
      notes: 8,
      sets: 9,
      links: 10,
      skipped: 11,
    }
    expect(putBackSays(got)).toEqual({
      text: 'Added 48 — 2 sessions, 1 activities, 3 goals, 6 check-offs, 8 notes, 9 sets, 10 linked exercises.',
      added: 48,
    })
  })
})
