import { describe, expect, it } from 'vitest'
import { NUDGE_GAP_MS, coalesce, nudgeTopic, readNudge } from './nudge'

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

/** a clock the test turns by hand: what is due runs when the hand passes it */
function handClock() {
  let now = 0
  let jobs: { at: number; f: () => void; id: number }[] = []
  let ids = 0
  return {
    clock: {
      now: () => now,
      set: (f: () => void, ms: number) => {
        jobs.push({ at: now + ms, f, id: ++ids })
        return ids
      },
      clear: (t: unknown) => {
        jobs = jobs.filter((j) => j.id !== t)
      },
    },
    to(t: number) {
      for (;;) {
        const due = jobs.filter((j) => j.at <= t).sort((a, b) => a.at - b.at)[0]
        if (!due) break
        jobs = jobs.filter((j) => j !== due)
        now = due.at
        due.f()
      }
      now = t
    },
  }
}

describe('the nudge’s gap', () => {
  it('is a second: a page sends, and looks because of what it hears, at most once in one', () => {
    expect(NUDGE_GAP_MS).toBe(1000)
  })

  it('lets a flood through as one at once and one more at the end of the gap, the last value last', () => {
    const h = handClock()
    const got: { t: number; v: number }[] = []
    const g = coalesce<number>((v) => got.push({ t: h.clock.now(), v }), 1000, h.clock)
    // a hundred nudges in half a second, from a page that is misbehaving or a friend that is
    for (let i = 0; i < 100; i++) {
      h.to(i * 5)
      g.call(i)
    }
    h.to(5000)
    expect(got).toEqual([
      { t: 0, v: 0 },
      { t: 1000, v: 99 },
    ])
  })

  it('never delays one that comes after a quiet gap, and never drops the last of a burst', () => {
    const h = handClock()
    const got: number[] = []
    const g = coalesce<number>((v) => got.push(v), 1000, h.clock)
    g.call(1)
    h.to(1500)
    g.call(2) // a gap since the last: at once
    expect(got).toEqual([1, 2])
    h.to(1600)
    g.call(3)
    h.to(1700)
    g.call(4)
    expect(got).toEqual([1, 2])
    h.to(2500) // the gap after 2 is up: the last of the burst goes
    expect(got).toEqual([1, 2, 4])
  })

  it('says nothing more once the page has let the match go', () => {
    const h = handClock()
    const got: number[] = []
    const g = coalesce<number>((v) => got.push(v), 1000, h.clock)
    g.call(1)
    g.call(2)
    g.cancel()
    h.to(5000)
    expect(got).toEqual([1])
  })
})
