import { describe, expect, it } from 'vitest'
import { gridKey } from './gridKeys'

/** A block's own cell, as the browser reports it: a plain element, tag name in upper case. */
const cell = { tagName: 'DIV' }

describe('gridKey', () => {
  it('leaves a dropdown inside a block its own keys', () => {
    // the regression: the old inline test knew INPUT and TEXTAREA but not SELECT, so an arrow
    // walked the selection to the next block and Backspace deleted the block
    const select = { tagName: 'SELECT' }
    expect(gridKey({ key: 'ArrowRight', target: select })).toBeNull()
    expect(gridKey({ key: 'ArrowDown', target: select })).toBeNull()
    expect(gridKey({ key: 'Backspace', target: select })).toBeNull()
    expect(gridKey({ key: 'Delete', target: select })).toBeNull()
  })

  it('leaves a text field its keys, so a typo in the guestbook does not delete the guestbook', () => {
    expect(gridKey({ key: 'Backspace', target: { tagName: 'INPUT' } })).toBeNull()
    expect(gridKey({ key: 'ArrowLeft', target: { tagName: 'TEXTAREA' } })).toBeNull()
    expect(gridKey({ key: 'Delete', target: { tagName: 'P', isContentEditable: true } })).toBeNull()
  })

  it('walks the selection one block along the saved order, all four arrows alike', () => {
    expect(gridKey({ key: 'ArrowLeft', target: cell })).toEqual({
      kind: 'step',
      step: -1,
      move: false,
    })
    expect(gridKey({ key: 'ArrowUp', target: cell })).toEqual({
      kind: 'step',
      step: -1,
      move: false,
    })
    expect(gridKey({ key: 'ArrowRight', target: cell })).toEqual({
      kind: 'step',
      step: 1,
      move: false,
    })
    expect(gridKey({ key: 'ArrowDown', target: cell })).toEqual({
      kind: 'step',
      step: 1,
      move: false,
    })
  })

  it('moves the block itself with Shift', () => {
    expect(gridKey({ key: 'ArrowRight', shiftKey: true, target: cell })).toEqual({
      kind: 'step',
      step: 1,
      move: true,
    })
  })

  it('removes the selected block on Delete or Backspace', () => {
    expect(gridKey({ key: 'Delete', target: cell })).toEqual({ kind: 'remove' })
    expect(gridKey({ key: 'Backspace', target: cell })).toEqual({ kind: 'remove' })
  })

  it("leaves Alt to the browser's Back and Forward, and Ctrl/Cmd to their shortcuts", () => {
    expect(gridKey({ key: 'ArrowLeft', altKey: true, target: cell })).toBeNull()
    expect(gridKey({ key: 'ArrowRight', ctrlKey: true, target: cell })).toBeNull()
    expect(gridKey({ key: 'Backspace', metaKey: true, target: cell })).toBeNull()
  })

  it('ignores every other key', () => {
    expect(gridKey({ key: 'Enter', target: cell })).toBeNull()
    expect(gridKey({ key: 'a', target: cell })).toBeNull()
  })
})
