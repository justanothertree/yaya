import { describe, expect, it } from 'vitest'
import { Holds, keySource } from './holds'

describe('holds', () => {
  it('an action is held while anything holds it, and let go only when the last thing lets go', () => {
    const h = new Holds<'left' | 'right'>()
    expect(h.press('left', 'key:z')).toBe(true)
    expect(h.press('left', 'pad:left:1')).toBe(false)
    expect(h.press('left', 'stage:4')).toBe(false)
    expect(h.release('left', 'pad:left:1')).toBe(false)
    expect(h.has('left')).toBe(true)
    expect(h.release('left', 'key:z')).toBe(false)
    expect(h.has('left')).toBe(true)
    expect(h.release('left', 'stage:4')).toBe(true)
    expect(h.has('left')).toBe(false)
  })
  it('two keys bound to one action: letting go of one leaves it held', () => {
    const h = new Holds<'left'>()
    h.press('left', 'key:a')
    h.press('left', 'key:arrowleft')
    h.release('left', 'key:a')
    expect(h.has('left')).toBe(true)
  })
  it('a release from something that was not holding changes nothing, and is not "the last"', () => {
    const h = new Holds<'left'>()
    h.press('left', 'key:z')
    expect(h.release('left', 'key:m')).toBe(false)
    expect(h.release('left', 'key:z')).toBe(true)
    expect(h.release('left', 'key:z')).toBe(false)
  })
  it('a source let go everywhere frees only what nothing else holds', () => {
    const h = new Holds<'left' | 'right'>()
    h.press('left', 'key:z')
    h.press('right', 'key:z')
    h.press('right', 'pad:right:2')
    expect(h.releaseSource('key:z')).toEqual(['left'])
    expect([h.has('left'), h.has('right')]).toEqual([false, true])
  })
  it('clear lets everything go', () => {
    const h = new Holds<'left' | 'right'>()
    h.press('left', 'a')
    h.press('right', 'b')
    h.clear()
    expect([h.has('left'), h.has('right')]).toEqual([false, false])
  })
  it('names a key by what it is, the same down and up, and Shift by its side', () => {
    expect(keySource({ key: 'Z', code: 'KeyZ' })).toBe(keySource({ key: 'z', code: 'KeyZ' }))
    expect(keySource({ key: 'Shift', code: 'ShiftLeft' })).not.toBe(
      keySource({ key: 'Shift', code: 'ShiftRight' }),
    )
  })
})
