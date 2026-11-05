import { describe, expect, it } from 'vitest'
import { partAt, partLost, partsIn } from './arrange'

/**
 * The arrangement's bound, which the scheduler had and the picture did not.
 *
 * ⚠️ WRITTEN FROM SECONDS AND BEATS, NEVER FROM THE FORMULA. `partsIn` is one line and a test
 * that re-derives it is a second copy of it — green whatever either says. So every expectation
 * here is built the way a musician would state it: four beats to a bar at 120 means a bar is two
 * seconds, so a four-second take is two bars. If the formula changes, these have to be argued
 * with rather than updated.
 */

const BPB = 4
/** a bar, in seconds, from the tempo — the arithmetic the claims are stated in */
const bar = (bpm: number) => (60 / bpm) * BPB

describe('how many parts a take holds', () => {
  it('is its length in bars, at this tempo', () => {
    /* 120bpm, four beats a bar: a bar is two seconds */
    expect(bar(120)).toBe(2)
    expect(partsIn(2 * bar(120), 120, BPB)).toBe(2)
    expect(partsIn(4 * bar(120), 120, BPB)).toBe(4)
  })

  it('and the SAME take holds fewer of them slower and more of them faster', () => {
    /* the whole bug in one assertion: these two numbers describe one unchanged recording */
    const len = 4
    expect(partsIn(len, 120, BPB), 'four seconds is two bars at 120').toBe(2)
    expect(partsIn(len, 60, BPB), 'four seconds is one bar at 60').toBe(1)
    expect(partsIn(len, 240, BPB), 'four seconds is four bars at 240').toBe(4)
  })

  it('is never zero, however short the take', () => {
    for (const len of [0, -5, 0.001, Number.NaN]) {
      expect(partsIn(len, 120, BPB), `len ${len}`).toBeGreaterThanOrEqual(1)
    }
  })

  it('and survives a tempo nobody should be able to ask for', () => {
    for (const bpm of [0, -40, Number.NaN, Number.POSITIVE_INFINITY]) {
      const n = partsIn(4, bpm, BPB)
      expect(Number.isInteger(n), `bpm ${bpm} gave ${n}`).toBe(true)
      expect(n).toBeGreaterThanOrEqual(1)
    }
  })
})

describe('what sounds in a bar', () => {
  it('is the part the plan names', () => {
    expect(partAt([2, 0, 1], 0, 3)).toBe(2)
    expect(partAt([2, 0, 1], 2, 3)).toBe(1)
  })

  it('is nothing where the plan says nothing', () => {
    expect(partAt([0, null, 1], 1, 3)).toBeNull()
  })

  it('is nothing in a bar past the end of the plan', () => {
    /* a plan is an order, not a mask: an absent entry is silence, where an absent `play` plays */
    expect(partAt([0, 1], 5, 2)).toBeNull()
  })

  it('is NOTHING for a part the take no longer has — the bug this module exists for', () => {
    /* arranged when the take held two parts; the tempo then halved and it holds one */
    const plan = [0, 1, 0, 1]
    const fast = partsIn(4, 120, BPB)
    const slow = partsIn(4, 60, BPB)
    expect([fast, slow]).toEqual([2, 1])
    expect(partAt(plan, 1, fast), 'part 2 sounds while the take has two').toBe(1)
    expect(partAt(plan, 1, slow), 'and sounds nothing once it has one').toBeNull()
  })

  it('and never hands back a part index the take does not have', () => {
    /* swept rather than sampled: every plan value against every plausible part count */
    for (let parts = 1; parts <= 8; parts++) {
      for (const src of [-3, -1, 0, 1, 3, 7, 8, 900, 2.7, Number.NaN, null, undefined]) {
        const got = partAt([src as number | null], 0, parts)
        if (got === null) continue
        expect(Number.isInteger(got), `${src} with ${parts} parts gave ${got}`).toBe(true)
        expect(got, `${src} with ${parts} parts`).toBeGreaterThanOrEqual(0)
        expect(got, `${src} with ${parts} parts`).toBeLessThan(parts)
      }
    }
  })

  it('answers nothing at all when the layer has never been arranged', () => {
    expect(partAt(undefined, 0, 4)).toBeNull()
  })
})

describe('a slot holding a part the take has lost', () => {
  /**
   * ⚠️ WHY THIS IS NOT JUST `partAt(...) === null`. Both are silent, and that is exactly why the
   * display needs to tell them apart: one is a bar somebody switched off and the other is a bar
   * whose part walked away under them. Drawn the same, the second one reads as an ordinary empty
   * slot and the arrangement is quietly lost the next time they look at it.
   */
  it('says so, where an empty slot does not', () => {
    expect(partLost([0, 1], 1, 1), 'part 2 of a one-part take is lost').toBe(true)
    expect(partLost([0, null], 1, 2), 'a slot switched off is not lost').toBe(false)
    expect(partLost([0, 1], 1, 2), 'a part that exists is not lost').toBe(false)
  })

  it('and is false where there is no plan or no entry', () => {
    expect(partLost(undefined, 0, 1)).toBe(false)
    expect(partLost([0], 3, 1)).toBe(false)
  })

  it('and every lost slot is a silent one', () => {
    /* the two must never disagree: if it is lost it cannot also be sounding */
    for (let parts = 1; parts <= 6; parts++) {
      for (const src of [0, 1, 2, 5, 900, null]) {
        if (partLost([src], 0, parts)) {
          expect(partAt([src], 0, parts), `${src} with ${parts} parts`).toBeNull()
        }
      }
    }
  })
})
