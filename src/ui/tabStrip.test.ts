/**
 * ⚠️ WRITTEN FROM THE STRIP'S SHAPE, NOT FROM THE FUNCTION'S SUM. Asserting that ArrowRight from
 * `i` gives `(i + 1) % n` is the modulo written twice and would agree with it however it was
 * wrong. What a strip actually promises is that walking one way visits every tab exactly once and
 * comes home, that the other way undoes it, and that a key it does not own is left for the page.
 */
import { describe, expect, it } from 'vitest'
import { tabKeyTarget } from './tabStrip'

/** the six strips, as they actually are: 3 questions, 4 viz tabs, 6 appearance tabs, 1 in solo */
const REAL_COUNTS = [1, 2, 3, 4, 6]

describe('tabKeyTarget', () => {
  it('walks right through every tab exactly once and comes home', () => {
    for (const count of [2, 3, 4, 5, 6, 7, 8, 9]) {
      for (let start = 0; start < count; start++) {
        const seen: number[] = []
        let at = start
        for (let step = 0; step < count; step++) {
          at = tabKeyTarget('ArrowRight', at, count)!
          seen.push(at)
        }
        expect(at, `${count} tabs from ${start}`).toBe(start)
        expect(new Set(seen).size, `${count} tabs from ${start}`).toBe(count)
      }
    }
  })

  it('walks left back to where right came from', () => {
    for (const count of [2, 3, 4, 6, 9]) {
      for (let from = 0; from < count; from++) {
        const right = tabKeyTarget('ArrowRight', from, count)!
        expect(tabKeyTarget('ArrowLeft', right, count)).toBe(from)
        const left = tabKeyTarget('ArrowLeft', from, count)!
        expect(tabKeyTarget('ArrowRight', left, count)).toBe(from)
      }
    }
  })

  it('never names a tab that is not on the strip', () => {
    for (const count of [2, 3, 4, 5, 6, 7, 8, 9]) {
      for (let from = 0; from < count; from++) {
        for (const key of ['ArrowRight', 'ArrowLeft', 'Home', 'End']) {
          const to = tabKeyTarget(key, from, count)!
          expect(to, `${key} from ${from} of ${count}`).toBeGreaterThanOrEqual(0)
          expect(to, `${key} from ${from} of ${count}`).toBeLessThan(count)
        }
      }
    }
  })

  it('sends Home and End to the ends, from the ends, without wrapping past them', () => {
    for (const count of [2, 3, 6]) {
      for (let from = 0; from < count; from++) {
        expect(tabKeyTarget('Home', from, count)).toBe(0)
        expect(tabKeyTarget('End', from, count)).toBe(count - 1)
      }
    }
  })

  /* the half that keeps App.tsx's section arrows working: an unclaimed key is left alone, and
     `moveTab` only stops the event when this answers with a tab */
  it('leaves keys the strip does not own to the page', () => {
    for (const key of ['ArrowUp', 'ArrowDown', 'Enter', ' ', 'Tab', 'Escape', 'a', 'PageDown']) {
      for (const count of REAL_COUNTS) {
        expect(tabKeyTarget(key, 0, count), key).toBeNull()
      }
    }
  })

  it('leaves every key alone when there is nowhere to move', () => {
    for (const key of ['ArrowRight', 'ArrowLeft', 'Home', 'End']) {
      expect(tabKeyTarget(key, 0, 1), key).toBeNull()
      expect(tabKeyTarget(key, 0, 0), key).toBeNull()
    }
  })
})
