import { describe, expect, it } from 'vitest'
import { bump, fresh, undo, undoTo, UNDO_DEPTH, type Tally } from './tally'

/** press a sequence of buttons the way the updater does — each from the value before it */
const press = (t: Tally, ...bys: number[]): Tally => bys.reduce(bump, t)

describe('counting reps on the sitting you are in', () => {
  it('adds every press, including three landing before a render', () => {
    /* the bug this module exists for: three +5 in one task wrote 5, because each computed from
       the number already on screen. Asked through the reducer the updater uses, they chain. */
    expect(press(fresh(0), 5, 5, 5).n).toBe(15)
  })

  it('starts an uncounted sitting at nothing, and counts from zero', () => {
    expect(press(fresh(null), 1).n).toBe(1)
  })

  it('never goes below zero', () => {
    expect(press(fresh(2), -1, -1, -1).n).toBe(0)
  })

  it('treats −1 on an uncounted sitting as nothing at all', () => {
    /* not a 0 — the server would store a 0 as "counted zero reps", which is a claim, and the
       sitting made none */
    expect(press(fresh(null), -1)).toEqual(fresh(null))
  })
})

describe('undoing a mis-tap', () => {
  it('takes back exactly the last press, whatever its size', () => {
    /* a +10 meant as a +1 is ten −1s without this, and one Undo with it */
    const t = press(fresh(12), 10)
    expect(undo(t).n).toBe(12)
  })

  it('walks back one press at a time', () => {
    const t = press(fresh(0), 5, 5, 1)
    expect([undo(t).n, undo(undo(t)).n, undo(undo(undo(t))).n]).toEqual([10, 5, 0])
  })

  it('puts back null, not 0, when the first press is undone', () => {
    /* the round trip has to close on the value that was there — see the note on `undo` */
    expect(undo(press(fresh(null), 1)).n).toBeNull()
  })

  it('does not remember a press that changed nothing', () => {
    /* otherwise the Undo after a −1 at zero would visibly do nothing, and need pressing twice */
    const t = press(fresh(3), 2, -1, -1, -1, -1, -1, -1)
    expect(t.n).toBe(0)
    expect(t.was).toEqual([3, 5, 4, 3, 2, 1])
    expect(undo(t).n).toBe(1)
  })

  it('does nothing when there is nothing to undo', () => {
    const t = fresh(7)
    expect(undo(t)).toBe(t)
    expect(undoTo(t)).toBeUndefined()
  })

  it('says what it would put back, so the button can say it too', () => {
    expect(undoTo(press(fresh(4), 5))).toBe(4)
    expect(undoTo(press(fresh(null), 5))).toBeNull()
  })

  it(`reaches back ${UNDO_DEPTH} presses and no further`, () => {
    /* asserted from the shape of the history, not by re-deriving the arithmetic: after
       UNDO_DEPTH + 5 presses of +1, undoing everything it holds lands on press five */
    let t = fresh(0)
    for (let i = 0; i < UNDO_DEPTH + 5; i++) t = bump(t, 1)
    expect(t.was).toHaveLength(UNDO_DEPTH)
    while (undoTo(t) !== undefined) t = undo(t)
    expect(t.n).toBe(5)
  })
})
