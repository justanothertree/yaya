import { describe, expect, it } from 'vitest'
import { openEditor } from './openEditor'

/**
 * Found splitting the room, 11 Nov 2026: after Clear all — or deleting the layer whose notes were
 * open — Undo stayed disabled with "The note editor has its own undo while it is open", about an
 * editor that was no longer anywhere on screen. The id of the open layer outlived the layer.
 */
describe('which layer’s notes are open', () => {
  const layers = [{ id: 'a' }, { id: 'b' }]

  it('stays open while its layer is there', () => {
    expect(openEditor('b', layers)).toBe('b')
  })

  it('is closed once its layer has gone — Clear all, a delete, a peer removing it', () => {
    expect(openEditor('c', layers)).toBeNull()
    expect(openEditor('a', [])).toBeNull()
  })

  it('and nothing open stays nothing open', () => {
    expect(openEditor(null, layers)).toBeNull()
  })
})
