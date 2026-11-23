import { describe, expect, it } from 'vitest'
import { withWords } from './tour'

describe('who is on your toy, in words (withWords)', () => {
  it('says nothing about nobody', () => {
    expect(withWords([])).toBe('')
  })
  it('names one, two and three people in full', () => {
    expect(withWords(['Ann'])).toBe('with Ann')
    expect(withWords(['Ann', 'Bo'])).toBe('with Ann and Bo')
    expect(withWords(['Ann', 'Bo', 'Cy'])).toBe('with Ann, Bo and Cy')
  })
  it('past three, names two and counts the rest — and the count is the rest, not the total', () => {
    expect(withWords(['Ann', 'Bo', 'Cy', 'Dee'])).toBe('with Ann, Bo and 2 more')
    const twelve = Array.from({ length: 11 }, (_, i) => `P${i}`)
    expect(withWords(twelve)).toBe('with P0, P1 and 9 more')
    /* every name the sentence says plus the number it gives is everybody on the toy */
    for (let n = 4; n <= 11; n++) {
      const names = Array.from({ length: n }, (_, i) => `P${i}`)
      const said = withWords(names)
      const more = Number(/and (\d+) more$/.exec(said)?.[1])
      expect(2 + more).toBe(n)
    }
  })
})
