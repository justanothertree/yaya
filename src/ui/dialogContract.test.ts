import { describe, expect, it } from 'vitest'
import { focusIsLoose, tabTarget } from './dialogContract'

/**
 * The two decisions a trapped dialog makes, asked directly.
 *
 * Both lived inside an effect inside `circuit/ui/Modal.tsx` until now, where nothing could reach
 * them — and both have edges that a careful reading walks straight past: a dialog with ONE
 * focusable thing in it, focus that has escaped the subtree entirely, and an `activeElement` of
 * `body` because React detached the node before the cleanup ran.
 *
 * The elements are strings. Neither function does anything to an element but compare it, so a
 * string is a faithful stand-in and the suite stays in node, where it is 200ms rather than a DOM.
 */

const LIST = ['close', 'name', 'note', 'save'] as const
type Item = (typeof LIST)[number]

describe('tabTarget', () => {
  it('wraps forward off the end and backward off the front', () => {
    expect(tabTarget(LIST, 'save', false, true)).toBe('close')
    expect(tabTarget(LIST, 'close', true, true)).toBe('save')
  })

  it('leaves the browser alone in the middle, which is most of the time', () => {
    /* null means "do not preventDefault": a trap that moved focus by hand on every Tab would
       also have to reimplement DOM order, and this one does not. */
    for (const from of ['close', 'name', 'note'] as Item[])
      expect(tabTarget(LIST, from, false, true)).toBeNull()
    for (const from of ['name', 'note', 'save'] as Item[])
      expect(tabTarget(LIST, from, true, true)).toBeNull()
  })

  it('pulls focus back in from outside the dialog, in both directions', () => {
    /* ⚠️ THE CASE THE TRAP EXISTS FOR. Focus can be outside the subtree without any Tab of ours:
       a click on the page behind, a programmatic focus, a browser-chrome round trip. Wherever it
       went, the next Tab comes back to an end of this list rather than continuing underneath. */
    expect(tabTarget(LIST, null, false, false)).toBe('close')
    expect(tabTarget(LIST, null, true, false)).toBe('save')
    /* and it does not matter what `active` says when it is not in here */
    expect(tabTarget(LIST, 'name', false, false)).toBe('close')
    expect(tabTarget(LIST, 'name', true, false)).toBe('save')
  })

  it('holds the key when the dialog has nothing to focus', () => {
    /* `false`, not null: the caller swallows the key. Letting it through would hand focus to the
       page behind an `aria-modal` overlay, which is the one thing the trap must not do. */
    expect(tabTarget([], null, false, true)).toBe(false)
    expect(tabTarget([], 'gone', true, true)).toBe(false)
  })

  it('keeps a one-control dialog on its one control', () => {
    /* first === last, so both branches fire. A dialog that is only a Close button is the common
       shape of a message box, and the trap has to be a loop of one rather than a no-op. */
    expect(tabTarget(['close'], 'close', false, true)).toBe('close')
    expect(tabTarget(['close'], 'close', true, true)).toBe('close')
  })

  it('never names anything outside the list, from anywhere, in either direction', () => {
    /* the invariant rather than a case: whatever it answers is somewhere a Tab is allowed to
       land. Swept over every starting point including outside-the-dialog and a stale element. */
    const froms: (Item | null | 'stale')[] = [...LIST, null, 'stale']
    for (const inside of [true, false])
      for (const shift of [true, false])
        for (const from of froms) {
          const to = tabTarget(LIST, from as Item | null, shift, inside)
          if (to === null || to === false) continue
          expect(LIST).toContain(to)
        }
  })

  it('walks a closed loop through the whole dialog and back', () => {
    /* following its answers from the last control has to come home, or the trap leaks. Four
       controls, four forward Tabs: save -> close -> name -> note -> save, with the middle three
       handled by the browser (null) and only the wrap decided here. */
    let at: Item = 'save'
    const seen: Item[] = [at]
    for (let i = 0; i < LIST.length; i++) {
      const to: Item | null | false = tabTarget<Item>(LIST, at, false, true)
      at = to ? to : LIST[(LIST.indexOf(at) + 1) % LIST.length]
      seen.push(at)
    }
    expect(seen).toEqual(['save', 'close', 'name', 'note', 'save'])
  })
})

describe('focusIsLoose', () => {
  const body = 'BODY'

  it('restores when the browser has dropped focus to the body', () => {
    /* ⚠️ MEASURED IN MODAL: closing with Escape left focus on BODY, because React had already
       detached the dialog by the time the cleanup ran. Asking only "is it still in the box" is
       false exactly here, which is when a restore matters most. */
    expect(focusIsLoose(body as unknown as Element, body as unknown as Element, false)).toBe(true)
  })

  it('restores when there is no active element at all', () => {
    expect(focusIsLoose(null, body as unknown as Element, false)).toBe(true)
  })

  it('restores when focus is still inside the subtree being torn down', () => {
    expect(focusIsLoose('save' as unknown as Element, body as unknown as Element, true)).toBe(true)
  })

  it('leaves focus alone when something else has legitimately taken it', () => {
    /* the one case that must answer false: a dialog that yanks focus back from whatever opened
       next is worse than one that never restored it. */
    expect(focusIsLoose('search' as unknown as Element, body as unknown as Element, false)).toBe(
      false,
    )
  })
})
