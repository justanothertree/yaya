import { describe, expect, it } from 'vitest'
import { added } from './useFresh'

describe('what has just arrived', () => {
  it('is nothing on the first look, however much is there', () => {
    expect(added(null, ['a', 'b', 'c'])).toEqual([])
  })

  it('is exactly the ids that joined since the last look', () => {
    expect(added(new Set(['a', 'b']), ['a', 'b', 'c'])).toEqual(['c'])
    expect(added(new Set(['a']), ['c', 'a', 'd'])).toEqual(['c', 'd'])
  })

  it('is nothing when ids only leave, or nothing changes', () => {
    expect(added(new Set(['a', 'b']), ['a'])).toEqual([])
    expect(added(new Set(['a', 'b']), ['b', 'a'])).toEqual([])
  })
})
