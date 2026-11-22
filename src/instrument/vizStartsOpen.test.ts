import { describe, expect, it } from 'vitest'
import { vizStartsOpen } from './vizStartsOpen'

/** Evan, 12 Nov 2026: start the visualiser closed on phones (flow map item 7). */
describe('whether the visuals start open', () => {
  it('a phone with no choice made starts closed; a bigger screen starts open', () => {
    expect(vizStartsOpen(null, true)).toBe(false)
    expect(vizStartsOpen(null, false)).toBe(true)
  })

  it('a choice somebody made is theirs, on any screen', () => {
    expect(vizStartsOpen('1', true)).toBe(true)
    expect(vizStartsOpen('0', false)).toBe(false)
    expect(vizStartsOpen('0', true)).toBe(false)
    expect(vizStartsOpen('1', false)).toBe(true)
  })
})
