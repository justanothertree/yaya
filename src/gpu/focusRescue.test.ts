import { describe, expect, it } from 'vitest'
import { hintsOf, nextUsable } from './focusRescue'

describe('where the focus goes when its control is gone', () => {
  const still = (gone: string[]) => (x: string) => !gone.includes(x)
  it('goes forward to the next control still there', () => {
    // a hand of cards, the second played: the third takes the focus
    expect(nextUsable(['a', 'b', 'c', 'd'], 1, still(['b']))).toBe('c')
    // and past any others that went with it
    expect(nextUsable(['a', 'b', 'c', 'd'], 1, still(['b', 'c']))).toBe('d')
  })
  it('goes back when nothing after it is left', () => {
    expect(nextUsable(['a', 'b', 'c'], 2, still(['c']))).toBe('b')
    expect(nextUsable(['a', 'b', 'c'], 2, still(['b', 'c']))).toBe('a')
  })
  it('gives up when nothing is left, and copes with a control it never saw', () => {
    expect(nextUsable(['a', 'b'], 0, still(['a', 'b']))).toBeNull()
    // not in the list: from the start
    expect(nextUsable(['a', 'b'], -1, still([]))).toBe('a')
    expect(nextUsable([], 0, still([]))).toBeNull()
  })
  it('reads the hints a control gives, in the order written', () => {
    expect(hintsOf('.a:not(:disabled) || .b ||  .c ')).toEqual(['.a:not(:disabled)', '.b', '.c'])
    expect(hintsOf(null)).toEqual([])
    expect(hintsOf('  ')).toEqual([])
  })
})
