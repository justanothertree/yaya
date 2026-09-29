import { describe, expect, it } from 'vitest'
import { CAP, emptyHistory, noteEdit, stepBack, stepOn } from './edits'

/**
 * Undo and redo, which this repository has already shipped wrong once.
 *
 * ⚠️ THE BUG TO STAY DEAD: the paint room built its stack inside a React state updater, and
 * React double-invokes those in StrictMode — so one press pushed the same stroke twice. "Draw
 * one line, undo, redo" gave two lines. These functions are pure and take the history as an
 * argument for exactly that reason: the stack can be stepped through here, where nothing
 * invokes anything twice, and the component's only job is to call each of them once.
 */

/** the editor's own shape: a step is a slice of the document, tagged with which slice */
type Step = { k: 'ground' | 'zone'; v: string }

const g = (v: string): Step => ({ k: 'ground', v })

describe('stepping back and forward', () => {
  it('has nothing to undo when nothing has happened', () => {
    expect(stepBack(emptyHistory<Step>(), g('now'))).toBeNull()
    expect(stepOn(emptyHistory<Step>(), g('now'))).toBeNull()
  })

  it('gives back what was there before', () => {
    const h = noteEdit(emptyHistory<Step>(), g('first'))
    const back = stepBack(h, g('second'))!
    expect(back.to).toEqual(g('first'))
  })

  /**
   * ⚠️ AND REDO PUTS BACK WHAT UNDO TOOK AWAY, which is the half the ground shipped without.
   * An undo you cannot take back is a delete with a friendly name.
   */
  it('and redo puts back exactly what undo took', () => {
    const h = noteEdit(emptyHistory<Step>(), g('first'))
    const back = stepBack(h, g('second'))!
    const on = stepOn(back.h, back.to)!
    expect(on.to).toEqual(g('second'))
  })

  /**
   * ⚠️ ONE PRESS, ONE STEP — the shape of the bug that shipped. Called twice with the same
   * history, as a double-invoked updater would, these return the same answer rather than
   * advancing twice; and a real sequence of presses walks back one at a time.
   */
  it('and one press moves exactly one step, however many times it is asked', () => {
    let h = emptyHistory<Step>()
    for (const v of ['a', 'b', 'c']) h = noteEdit(h, g(v))
    /* asking twice from the same history is not two undos */
    const once = stepBack(h, g('d'))!
    const again = stepBack(h, g('d'))!
    expect(again.to).toEqual(once.to)
    expect(again.h.past).toEqual(once.h.past)
  })

  it('and walks all the way back in order', () => {
    let h = emptyHistory<Step>()
    for (const v of ['a', 'b', 'c']) h = noteEdit(h, g(v))
    let now = g('d')
    const seen: string[] = []
    for (;;) {
      const back = stepBack(h, now)
      if (!back) break
      h = back.h
      now = back.to
      seen.push(now.v)
    }
    expect(seen).toEqual(['c', 'b', 'a'])
  })

  /**
   * ⚠️ A NEW EDIT ENDS THE BRANCH, which is the rule that makes redo safe. A future that
   * survives an edit puts back something you have since changed your mind about.
   */
  it('and a new edit throws away the future', () => {
    let h = noteEdit(emptyHistory<Step>(), g('first'))
    const back = stepBack(h, g('second'))!
    h = back.h
    expect(h.future).toHaveLength(1)
    h = noteEdit(h, g('a different second'))
    expect(h.future, 'the branch survived an edit').toHaveLength(0)
    expect(stepOn(h, g('now'))).toBeNull()
  })

  /**
   * ⚠️ BOUNDED, BECAUSE A STEP CAN BE BIG. A zone step copies 23,040 cells, so an unbounded
   * stack is a megabyte for every forty-odd strokes of no-walk paint.
   */
  it('and never remembers more than it said it would', () => {
    let h = emptyHistory<Step>()
    for (let i = 0; i < CAP * 3; i++) h = noteEdit(h, g(`step ${i}`))
    expect(h.past).toHaveLength(CAP)
    expect(h.past[h.past.length - 1].v, 'it keeps the most recent').toBe(`step ${CAP * 3 - 1}`)
    expect(h.past[0].v, 'and drops the oldest').toBe(`step ${CAP * 2}`)
  })

  /** ⚠️ and the parts do not have to be the same part — one stack, whatever you just did */
  it('and undoes whatever you did last, not whatever it has most of', () => {
    let h = emptyHistory<Step>()
    h = noteEdit(h, { k: 'ground', v: 'lines' })
    h = noteEdit(h, { k: 'zone', v: 'cells' })
    const back = stepBack(h, { k: 'zone', v: 'more cells' })!
    expect(back.to.k, 'the zone was last, so the zone comes back').toBe('zone')
    const next = stepBack(back.h, back.to)!
    expect(next.to.k).toBe('ground')
  })

  it('and never mutates the history it was handed', () => {
    const h = noteEdit(emptyHistory<Step>(), g('first'))
    const before = JSON.stringify(h)
    stepBack(h, g('second'))
    noteEdit(h, g('another'))
    expect(JSON.stringify(h), 'something wrote through its argument').toBe(before)
  })
})
