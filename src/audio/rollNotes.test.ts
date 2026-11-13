import { describe, expect, it } from 'vitest'
import type { Note } from './noteEdit'
import { hits, isSame, roomAfter } from './rollNotes'

/**
 * The note editor's collision rules, pinned before they left PianoRoll.tsx (11 Nov 2026 split). Each
 * case is a thing you could do with two notes on a roll.
 */
const n = (midi: number, t: number, dur: number): Note => ({ midi, t, dur })

describe('two notes of the same pitch may not overlap', () => {
  const list = [n(60, 0, 1), n(60, 2, 1), n(64, 0.5, 1)]

  it('a note dragged over another of its pitch runs into it', () => {
    expect(hits(list, -1, n(60, 0.5, 1))).toBe(true)
    expect(hits(list, -1, n(60, 1.5, 1))).toBe(true)
  })

  it('end to start is touching, not overlapping', () => {
    expect(hits(list, -1, n(60, 1, 1))).toBe(false)
  })

  it('another pitch is never in the way, and a note does not run into itself', () => {
    expect(hits(list, -1, n(62, 0, 4))).toBe(false)
    expect(hits(list, 0, n(60, 0, 1.5))).toBe(false)
  })
})

describe('how long a note may grow', () => {
  const list = [n(60, 0, 1), n(60, 3, 1), n(60, 5, 1), n(67, 1, 1)]

  it('up to the start of the next note of its pitch', () => {
    expect(roomAfter(list, 0, list[0])).toBe(3)
    expect(roomAfter(list, 1, list[1])).toBe(2)
  })

  it('without limit when nothing of its pitch comes after it', () => {
    expect(roomAfter(list, 2, list[2])).toBe(Infinity)
    expect(roomAfter(list, 3, list[3])).toBe(Infinity)
  })
})

describe('which note is the selected one', () => {
  it('the same pitch at the same start, to within a rounding error', () => {
    expect(isSame(n(60, 1, 1), { midi: 60, t: 1 + 1e-9 })).toBe(true)
    expect(isSame(n(60, 1, 1), { midi: 60, t: 1.01 })).toBe(false)
    expect(isSame(n(60, 1, 1), { midi: 61, t: 1 })).toBe(false)
    expect(isSame(n(60, 1, 1), null)).toBe(false)
  })
})
