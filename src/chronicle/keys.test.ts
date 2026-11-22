import { describe, expect, it } from 'vitest'
import { CHRONICLE_KEYS, chronicleKey, type KeyPress, type KeyRoom } from './keys'

const idle: KeyRoom = { running: false, chips: 3, blocked: false }
const busy: KeyRoom = { running: true, chips: 3, blocked: false }
const press = (key: string, over: Partial<KeyPress> = {}): KeyPress => ({
  key,
  target: { tagName: 'BODY' },
  ...over,
})

describe('Chronicle’s keys', () => {
  it('S starts something when nothing is running, and stops what is', () => {
    expect(chronicleKey(press('s'), idle)).toEqual({ do: 'start' })
    expect(chronicleKey(press('s'), busy)).toEqual({ do: 'stop' })
    /* with Shift held, as somebody with Caps Lock on would send it */
    expect(chronicleKey(press('S'), busy)).toEqual({ do: 'stop' })
  })

  it('1, 2 and 3 start that chip, and only one that is there', () => {
    expect(chronicleKey(press('1'), idle)).toEqual({ do: 'chip', n: 1 })
    expect(chronicleKey(press('3'), idle)).toEqual({ do: 'chip', n: 3 })
    expect(chronicleKey(press('3'), { ...idle, chips: 2 })).toBeNull()
    expect(chronicleKey(press('4'), idle)).toBeNull()
    expect(chronicleKey(press('0'), idle)).toBeNull()
  })

  it('leaves the numbers alone while something runs, since no chips are drawn then', () => {
    expect(chronicleKey(press('1'), busy)).toBeNull()
  })

  it('N writes a note either way', () => {
    expect(chronicleKey(press('n'), idle)).toEqual({ do: 'note' })
    expect(chronicleKey(press('N'), busy)).toEqual({ do: 'note' })
  })

  it('never takes a key from somebody typing', () => {
    for (const tagName of ['INPUT', 'TEXTAREA', 'SELECT', 'input', 'textarea'])
      expect(chronicleKey(press('s', { target: { tagName } }), busy), tagName).toBeNull()
    expect(
      chronicleKey(press('n', { target: { tagName: 'DIV', isContentEditable: true } }), idle),
    ).toBeNull()
  })

  it('leaves every key held with Ctrl, ⌘ or Alt to the browser', () => {
    /* Ctrl+S saves the page, ⌘N opens a window, Alt+1 is a tab on some systems */
    expect(chronicleKey(press('s', { ctrlKey: true }), busy)).toBeNull()
    expect(chronicleKey(press('n', { metaKey: true }), idle)).toBeNull()
    expect(chronicleKey(press('1', { altKey: true }), idle)).toBeNull()
  })

  it('ignores a held key repeating, a key already answered, and everything while blocked', () => {
    expect(chronicleKey(press('s', { repeat: true }), busy)).toBeNull()
    expect(chronicleKey(press('s', { defaultPrevented: true }), busy)).toBeNull()
    expect(chronicleKey(press('s'), { ...busy, blocked: true })).toBeNull()
    expect(chronicleKey(press('1'), { ...idle, blocked: true })).toBeNull()
  })

  it('keeps Space, the arrows and ? for the page', () => {
    for (const key of [' ', 'ArrowLeft', 'ArrowDown', '?', 'Enter', 'Escape'])
      expect(chronicleKey(press(key), busy), JSON.stringify(key)).toBeNull()
  })

  it('lists, for the ? overlay, exactly the keys it answers', () => {
    const listed = CHRONICLE_KEYS.flatMap(([k]) => k.split(' '))
    expect(listed).toEqual(['S', '1', '2', '3', 'N'])
    for (const k of listed)
      expect(chronicleKey(press(k), idle) ?? chronicleKey(press(k), busy), k).not.toBeNull()
  })
})
