import { describe, expect, it } from 'vitest'
import { mayRateSave, mustReseed } from './rateSheet'

/**
 * The rating sheet over a board that did not load.
 *
 * ⚠️ THE STALE FORM IS THE BUG, NOT THE FLAG. A sheet opened while the board's ratings had failed
 * to load fills its form from nothing. Save was held while the board stayed unloaded — and the
 * moment a Retry inside the sheet succeeded, Save came back on over that blank form, which would
 * write it as the rating (or, looking empty, delete the rating). Found in review, 28 Nov 2026.
 */
describe('the rating sheet and a board that did not load', () => {
  const blank = { fromLoadedBoard: false }
  const real = { fromLoadedBoard: true }

  it('a form filled while the board was unloaded cannot save, even after a Retry loads the board', () => {
    expect(mayRateSave(blank, false)).toBe(false)
    expect(mayRateSave(blank, true)).toBe(false)
  })

  it('such a form is filled again from the loaded board the moment it loads — and only then', () => {
    expect(mustReseed(blank, false)).toBe(true)
    expect(mustReseed(blank, true)).toBe(false)
  })

  it('a form filled from a loaded board saves, and stops while a later load has failed', () => {
    expect(mayRateSave(real, false)).toBe(true)
    expect(mayRateSave(real, true)).toBe(false)
  })

  it('a form filled from a loaded board is never filled again — what the person typed stays', () => {
    expect(mustReseed(real, false)).toBe(false)
    expect(mustReseed(real, true)).toBe(false)
  })
})
