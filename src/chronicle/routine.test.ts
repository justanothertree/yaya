import { describe, expect, it } from 'vitest'
import { readRoutine, type Step } from './routine'

/** every activity is startable unless this test says otherwise */
const allLive = () => true
const step = (activity: string, mins: number | null = null): Step => ({ activity, mins })

describe('how far down a routine you are', () => {
  it('has nothing to say about a routine with no steps', () => {
    const r = readRoutine([], {}, allLive)
    expect(r.states).toEqual([])
    expect(r.total).toBe(0)
    expect(r.done).toBe(0)
    expect(r.nextIndex).toBe(-1)
  })

  it('points at the first step when nothing has been done', () => {
    const r = readRoutine([step('a', 10), step('b', 30)], {}, allLive)
    expect(r.states).toEqual(['next', 'todo'])
    expect(r.nextIndex).toBe(0)
    expect(r.done).toBe(0)
  })

  /** the suggested length is the bar, and it is `>=` rather than `>` */
  it('counts a step done at exactly its suggested length, not a minute after', () => {
    expect(readRoutine([step('a', 10)], { a: 9 }, allLive).states).toEqual(['next'])
    expect(readRoutine([step('a', 10)], { a: 10 }, allLive).states).toEqual(['done'])
  })

  /**
   * ⚠️ A STEP WITH NO SUGGESTED LENGTH ASKS "DID YOU DO THIS", not "for how long" — so one minute
   * finishes it and nothing does not. Written as the claim rather than as `?? 1`, which is the
   * code's own sum.
   */
  it('finishes a step with no suggested length on the first minute', () => {
    expect(readRoutine([step('a')], {}, allLive).states).toEqual(['next'])
    expect(readRoutine([step('a')], { a: 1 }, allLive).states).toEqual(['done'])
  })

  /** out of order is allowed: the counter says how many, the arrow says which is next */
  it('counts every done step but points only at the first undone one', () => {
    const r = readRoutine([step('a', 10), step('b', 10), step('c', 10)], { a: 10, c: 10 }, allLive)
    expect(r.states).toEqual(['done', 'next', 'done'])
    expect(r.done).toBe(2)
    expect(r.total).toBe(3)
    expect(r.nextIndex).toBe(1)
  })

  it('has no next step once every one of them is done', () => {
    const r = readRoutine([step('a', 10), step('b', 10)], { a: 10, b: 99 }, allLive)
    expect(r.nextIndex).toBe(-1)
    expect(r.done).toBe(2)
    expect(r.total).toBe(2)
  })

  /**
   * ⚠️ THE ONE THIS MODULE EXISTS FOR. An archived activity cannot be started — chronicle_start
   * refuses one with an `archived_at` — so it can never gain a minute and can never be done. Read
   * as merely "not done yet" it sat at the front of the queue for ever, and the routine said
   * "2 of 3" for the rest of its life while offering a button that answered "no such activity".
   */
  it('does not let an archived step block the ones after it', () => {
    const steps = [step('a', 10), step('gone', 10), step('c', 10)]
    const r = readRoutine(steps, { a: 10 }, (id) => id !== 'gone')
    expect(r.states).toEqual(['done', 'gone', 'next'])
    expect(r.nextIndex).toBe(2)
  })

  it('and does not count it in the total, so the routine can still finish', () => {
    const steps = [step('a', 10), step('gone', 10)]
    const r = readRoutine(steps, { a: 10 }, (id) => id !== 'gone')
    expect(r.done).toBe(1)
    expect(r.total).toBe(1)
    expect(r.gone).toBe(1)
    expect(r.nextIndex).toBe(-1)
  })

  /** minutes against an archived activity are still minutes — it is unstartable, not undone */
  it('calls it gone even when it has minutes against it from before it was archived', () => {
    const r = readRoutine([step('gone', 10)], { gone: 60 }, () => false)
    expect(r.states).toEqual(['gone'])
    expect(r.done).toBe(0)
    expect(r.total).toBe(0)
  })

  it('treats a step naming an activity that is not there as gone, not as waiting', () => {
    const r = readRoutine([step('vanished')], {}, () => false)
    expect(r.states).toEqual(['gone'])
    expect(r.nextIndex).toBe(-1)
  })

  /**
   * ⚠️ THE INVARIANT THE TWO HALVES HAVE TO KEEP, asserted rather than assumed: the counter and
   * the arrow are computed from the same walk, so "all done" and "there is a next one" can never
   * both be true. These were two separate expressions inlined in JSX before this module existed.
   */
  it('never has a next step and a full count at the same time', () => {
    const shapes: Array<[Step[], Record<string, number>, (id: string) => boolean]> = [
      [[step('a', 10), step('b')], {}, allLive],
      [[step('a', 10), step('b')], { a: 10 }, allLive],
      [[step('a', 10), step('b')], { a: 10, b: 5 }, allLive],
      [[step('a'), step('x', 5)], { a: 2 }, (id) => id !== 'x'],
      [[step('x'), step('y')], {}, () => false],
    ]
    for (const [steps, mins, live] of shapes) {
      const r = readRoutine(steps, mins, live)
      expect(r.done + (r.nextIndex < 0 ? 0 : 1)).toBeLessThanOrEqual(r.total)
      if (r.done === r.total) expect(r.nextIndex).toBe(-1)
      if (r.nextIndex >= 0) expect(r.states[r.nextIndex]).toBe('next')
      expect(r.states.filter((s) => s === 'next').length).toBeLessThanOrEqual(1)
      expect(r.states.length).toBe(steps.length)
      expect(r.total + r.gone).toBe(steps.length)
    }
  })
})
