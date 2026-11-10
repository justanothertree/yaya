import { describe, expect, it } from 'vitest'
import { followLastBar, growPlan, partAt, partLost, partsIn, takeTimeAt } from './arrange'

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

describe('where a moment of the song lands inside the take', () => {
  /* two-second bars, so every number below is readable as "bar N, half a bar in" */
  const BAR = 2

  it('is the same moment when the bars are in their original order', () => {
    /* plan [0, 1] is the identity: nothing has been moved, so song time IS take time */
    for (const at of [0, 0.5, 1.9, 2, 3.5]) {
      expect(takeTimeAt([0, 1], 2, at, BAR), `at ${at}`).toBeCloseTo(at, 6)
    }
  })

  it('reads the swapped bar, keeping how far into the bar you are', () => {
    /* plan [1, 0]: song bar 0 plays take bar 1, so half a bar into the song is half a bar
       into the take's SECOND bar — 1s into the song is 3s into the take */
    expect(takeTimeAt([1, 0], 2, 1, BAR)).toBeCloseTo(3, 6)
    expect(takeTimeAt([1, 0], 2, 0, BAR)).toBeCloseTo(2, 6)
    /* and the song's second bar plays the take's first */
    expect(takeTimeAt([1, 0], 2, 2.5, BAR)).toBeCloseTo(0.5, 6)
  })

  it('is nothing where the arrangement is silent', () => {
    expect(takeTimeAt([0, null], 2, 2.5, BAR)).toBeNull()
  })

  it('is nothing where the slot holds a part the take does not have', () => {
    /* the same bound the scheduler applies — see partAt */
    expect(takeTimeAt([3, 0], 2, 1, BAR)).toBeNull()
  })

  it('is nothing past the end of the plan, and for nonsense', () => {
    expect(takeTimeAt([0, 1], 2, 10, BAR)).toBeNull()
    expect(takeTimeAt(undefined, 2, 1, BAR)).toBeNull()
    expect(takeTimeAt([0], 1, Number.NaN, BAR)).toBeNull()
    expect(takeTimeAt([0], 1, 1, 0)).toBeNull()
    expect(takeTimeAt([0], 1, -1, BAR)).toBeNull()
  })

  /**
   * ⚠️ THE PROPERTY, rather than another worked example: whatever it answers must lie inside the
   * bar it named. A dropped `src * barLen` term passes every identity case above and fails this
   * one for every moved bar, which is the mistake worth guarding.
   */
  it('always lands inside the take-bar the plan chose', () => {
    const plan = [2, 0, 3, 1]
    for (let at = 0; at < 4 * BAR; at += 0.137) {
      const got = takeTimeAt(plan, 4, at, BAR)
      if (got === null) continue
      const src = plan[Math.floor(at / BAR)]!
      expect(got, `at ${at.toFixed(3)}`).toBeGreaterThanOrEqual(src * BAR)
      expect(got, `at ${at.toFixed(3)}`).toBeLessThan((src + 1) * BAR)
    }
  })
})

/**
 * A fill laid "on the last bar" of a two-bar loop is `[null, 0]`. The expectations are which bar
 * of the loop it sounds in — the thing the button's name promises — not the plan's arithmetic.
 */
describe('a fill on the last bar stays on the last bar', () => {
  const sounds = (plan: (number | null)[], bars: number) =>
    Array.from({ length: bars }, (_, b) => partAt(plan, b, 1) !== null)

  it('moves to bar four when a two-bar loop grows to four', () => {
    const next = followLastBar([null, 0], 4)!
    expect(sounds(next, 4)).toEqual([false, false, false, true])
  })

  it('and to bar two when a four-bar loop shrinks to two', () => {
    const next = followLastBar([null, null, null, 0], 2)!
    expect(sounds(next, 2)).toEqual([false, true])
  })

  it('without it, the fill sounds in the middle or not at all — which is what this fixes', () => {
    expect(sounds([null, 0], 4)).toEqual([false, true, false, false])
    expect(sounds([null, null, null, 0], 2)).toEqual([false, false])
  })

  it('leaves a fill somebody moved, and any other arrangement, where it is', () => {
    expect(followLastBar([0, null], 4)).toBe(null)
    expect(followLastBar([null, 0, null, 0], 8)).toBe(null)
    expect(followLastBar([null, null], 4)).toBe(null)
    expect(followLastBar(undefined, 4)).toBe(null)
  })

  it('does not move on a one-bar loop, so going back to two finds it again', () => {
    expect(followLastBar([null, 0], 1)).toBe(null)
    expect(sounds(followLastBar([null, 0], 3)!, 3)).toEqual([false, false, true])
  })
})

/**
 * Evan's call, 9 Nov 2026: growing a song extends the arrangement into the new bars.
 *
 * ⚠️ STATED AS WHAT EACH BAR OF THE SONG PLAYS, the way somebody listening would say it — "bars
 * five to eight play the first four again" — and read back through `partAt`, the function the
 * scheduler asks. A test that compared plans would be comparing the arithmetic with itself.
 */
describe('a song that grows carries its arrangement with it', () => {
  /* a four-part take, so a repeat and a reorder can be told apart */
  const heard = (plan: readonly (number | null)[], bars: number, parts = 4) =>
    Array.from({ length: bars }, (_, b) => partAt(plan, b, parts))

  it('plays its bars again in the bars it grew by, in the order they were put in', () => {
    /* two bars swapped round: part 2, then part 1 */
    expect(heard(growPlan([1, 0], 2, 4)!, 4)).toEqual([1, 0, 1, 0])
    /* four bars doubled: the whole of it twice */
    expect(heard(growPlan([3, null, 0, 2], 4, 8)!, 8)).toEqual([3, null, 0, 2, 3, null, 0, 2])
  })

  it('and a bar somebody silenced is silent again where it comes round', () => {
    expect(heard(growPlan([0, null], 2, 6)!, 6)).toEqual([0, null, 0, null, 0, null])
  })

  it('an uneven growth starts the phrase again from the top', () => {
    expect(heard(growPlan([2, 1, 0, 3], 4, 6)!, 6)).toEqual([2, 1, 0, 3, 2, 1])
  })

  /* without it — the reason this exists: everything past the old end is silence */
  it('without it, every bar the song grew by is silent', () => {
    expect(heard([1, 0], 4)).toEqual([1, 0, null, null])
  })

  it('shrinking and growing back gives the same song, not its first half twice', () => {
    /* an eight-bar arrangement, shortened to four (which never touches a plan) and grown again */
    const eight = [0, 1, 2, 3, 3, 2, 1, null]
    expect(growPlan(eight, 4, 8)).toBe(null)
    expect(heard(eight, 8)).toEqual([0, 1, 2, 3, 3, 2, 1, null])
    /* and grown past where it had been, the stored eight come back before anything repeats */
    expect(heard(growPlan(eight, 4, 10)!, 10)).toEqual([0, 1, 2, 3, 3, 2, 1, null, 0, 1])
  })

  /**
   * ⚠️ A FILE CAN HOLD A PLAN SHORTER THAN ITS SONG — a two-bar arrangement grown to four before
   * this existed, saved like that — and it has been HEARD with bars three and four silent. Growing
   * it again repeats what was heard, silence included, rather than filling those two with sound.
   */
  it('a plan shorter than its song repeats the silence it was heard with', () => {
    expect(heard([0, 1], 4)).toEqual([0, 1, null, null])
    expect(heard(growPlan([0, 1], 4, 8)!, 8)).toEqual([0, 1, null, null, 0, 1, null, null])
  })

  it('has nothing to do when there is no arrangement, no growth, or the plan already reaches', () => {
    expect(growPlan(undefined, 2, 4)).toBe(null)
    expect(growPlan([], 2, 4)).toBe(null)
    expect(growPlan([0, 1], 2, 2)).toBe(null)
    expect(growPlan([0, 1, 2, 3], 4, 2)).toBe(null)
    expect(growPlan([0, 1, 2, 3], 2, 4)).toBe(null)
    expect(growPlan([0, 1], 0, 4)).toBe(null)
    expect(growPlan([0, 1], 2, 4.5)).toBe(null)
  })
})
