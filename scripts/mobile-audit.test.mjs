import { describe, expect, it } from 'vitest'
import { needsAName } from './mobile-audit.js'

/**
 * The one rule in the sweep that is for a person rather than for a standard.
 *
 * `tooSmall` is WCAG 2.5.8 and settles itself: 24px, or not. `wordless` is a list somebody reads
 * and dismisses -- "is this icon a convention or an obscurity" is not a question the DOM can
 * answer -- so the whole value of it is being SHORT. Its own header says an empty list would mean
 * the rules had been widened until they said nothing, and the other half of that is true too: one
 * false positive per room and nobody reads it twice.
 *
 * ⚠️ IT REPORTED THE NAV ARROWS IN EVERY ROOM. `‹` and `›` are `aria-hidden` with `tabIndex={-1}`
 * on purpose -- touch swipes the strip, and the keyboard reaches the links by tabbing, which
 * scrolls them into view -- so they are not in the accessibility tree at all and a name on them
 * would be announced to nobody. Measured at 810 with the coarse-pointer rules applied: `wordless`
 * answered 1 in #home, #circuit, #chronicle and #profile, and it was that same button every time.
 *
 * The elements here are the smallest thing the rule actually touches: `textContent`,
 * `getAttribute` and `closest`. A real DOM would make this a different suite in a different
 * environment to test four string comparisons.
 */

/** A stand-in for one control, with an optional chain of ancestors for `closest`. */
const control = ({ text = '', attrs = {}, hiddenAncestor = false, siblingText = null } = {}) => {
  const el = {
    textContent: text,
    getAttribute: (k) => attrs[k] ?? null,
    closest: (sel) => (sel === '[aria-hidden="true"]' && hiddenAncestor ? {} : null),
    parentElement: null,
  }
  /* groupSays reads the parent's loose words and, failing that, the element before the parent */
  el.parentElement = {
    childNodes: siblingText ? [{ nodeType: 3, textContent: siblingText }] : [],
    children: [el, el],
    previousElementSibling: null,
  }
  if (attrs['aria-hidden'] === 'true')
    el.closest = (sel) => (sel === '[aria-hidden="true"]' ? el : null)
  return el
}

describe('needsAName', () => {
  it('names a glyph button whose only explanation is a tooltip', () => {
    /* the case the rule is for: ⠿ with title="Drag to move" and nothing else */
    expect(needsAName(control({ text: '⠿', attrs: { title: 'Drag to move' } }))).toBe(true)
  })

  it('leaves a control that says what it does', () => {
    expect(needsAName(control({ text: 'Save', attrs: { title: 'Save this' } }))).toBe(false)
    /* two letters is the bar, because "OK" and "No" are words and "✕" and "1" are not */
    expect(needsAName(control({ text: 'OK', attrs: { title: 'Confirm it' } }))).toBe(false)
  })

  it('leaves a control with an aria-label, which is the fix for this finding', () => {
    expect(
      needsAName(control({ text: '✕', attrs: { title: 'Close', 'aria-label': 'Close' } })),
    ).toBe(false)
  })

  it('leaves a glyph with no tooltip either, because then there is nothing to report', () => {
    /* not "fine" -- just not THIS list. A control with neither a word nor a title is either
       decoration or a different bug, and the rule says nothing it cannot support. */
    expect(needsAName(control({ text: '›' }))).toBe(false)
    expect(needsAName(control({ text: '›', attrs: { title: 'Go' } }))).toBe(false)
  })

  it('leaves an aria-hidden control, which is the false positive this rule had', () => {
    /* ⚠️ THE NAV ARROWS. Out of the accessibility tree on purpose, so a name on them would be
       announced to nobody, and the links they scroll to are reachable by tabbing. */
    expect(
      needsAName(control({ text: '›', attrs: { title: 'More', 'aria-hidden': 'true' } })),
    ).toBe(false)
  })

  it('leaves a control inside an aria-hidden group, for the same reason one level up', () => {
    expect(needsAName(control({ text: '›', attrs: { title: 'More' }, hiddenAncestor: true }))).toBe(
      false,
    )
  })

  it('leaves a control whose row carries the words for it', () => {
    /* one label governing one group: "Mirror" beside a row of folds explains the folds */
    expect(
      needsAName(control({ text: '⬓', attrs: { title: 'Mirror across' }, siblingText: 'Mirror' })),
    ).toBe(false)
  })
})
