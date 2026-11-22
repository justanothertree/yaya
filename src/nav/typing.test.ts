import { describe, expect, it } from 'vitest'
import { isTypingTarget } from './typing'

/**
 * The browser reports `tagName` in UPPER case for HTML elements, so every case below is written
 * the way a real event's target would carry it, and a lower-case pair checks the comparison does
 * not depend on that.
 */
describe('isTypingTarget', () => {
  it('leaves a focused dropdown its own arrow keys', () => {
    // the regression: ArrowRight on a <select> walked the page to the next section
    expect(isTypingTarget({ tagName: 'SELECT' })).toBe(true)
  })

  it('leaves text fields and editable regions their keys', () => {
    expect(isTypingTarget({ tagName: 'INPUT' })).toBe(true)
    expect(isTypingTarget({ tagName: 'TEXTAREA' })).toBe(true)
    expect(isTypingTarget({ tagName: 'DIV', isContentEditable: true })).toBe(true)
  })

  it('gives the page the keys everywhere else, so the arrows still walk between sections', () => {
    expect(isTypingTarget({ tagName: 'BODY' })).toBe(false)
    expect(isTypingTarget({ tagName: 'BUTTON' })).toBe(false)
    expect(isTypingTarget({ tagName: 'A' })).toBe(false)
    expect(isTypingTarget({ tagName: 'DIV', isContentEditable: false })).toBe(false)
    expect(isTypingTarget(null)).toBe(false)
    expect(isTypingTarget({})).toBe(false)
  })

  it('does not depend on the case the tag name arrives in', () => {
    expect(isTypingTarget({ tagName: 'select' })).toBe(true)
    expect(isTypingTarget({ tagName: 'body' })).toBe(false)
  })
})
