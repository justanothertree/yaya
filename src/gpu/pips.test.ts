import { describe, expect, it } from 'vitest'
import { PIPS } from './pips'

describe('the pips on a face', () => {
  it('number the face, nought to six, on a three-by-three', () => {
    for (let f = 0; f <= 6; f++) {
      expect(PIPS[f]).toHaveLength(f)
      expect(new Set(PIPS[f]).size).toBe(f)
      for (const k of PIPS[f]) expect(k >= 0 && k < 9).toBe(true)
    }
  })
  it('look the same turned upside down, as a die and a domino do', () => {
    for (let f = 0; f <= 6; f++)
      expect([...PIPS[f]].map((k) => 8 - k).sort()).toEqual([...PIPS[f]].sort())
    // odd faces have the middle pip, even ones do not
    for (let f = 1; f <= 6; f++) expect(PIPS[f].includes(4)).toBe(f % 2 === 1)
  })
})
