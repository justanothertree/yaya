import { describe, expect, it } from 'vitest'
import { nudgeTopic, readNudge } from './nudge'

describe('the nudge on an open match', () => {
  it('is on the match’s own topic, which the policy reads back', () => {
    const id = '11111111-2222-4333-8444-555555555555'
    expect(nudgeTopic(id)).toBe(`labmatch:${id}`)
    // the shape lab_match_topic_member accepts, and no other
    expect(nudgeTopic(id)).toMatch(
      /^labmatch:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    )
  })

  it('carries a seq and nothing else; anything else is not a nudge', () => {
    expect(readNudge({ seq: 0 })).toBe(0)
    expect(readNudge({ seq: 12 })).toBe(12)
    for (const bad of [
      null,
      3,
      'x',
      {},
      { seq: -1 },
      { seq: 1.5 },
      { seq: '3' },
      { seq: 3, move: 'e4' },
    ])
      expect(readNudge(bad), JSON.stringify(bad)).toBeNull()
  })
})
