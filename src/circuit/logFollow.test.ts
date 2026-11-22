import { describe, expect, it } from 'vitest'
import { atBottom, newMessagesLabel, NEAR_BOTTOM, shouldJump, unseenAfter } from './logFollow'

const m = (id: string, mine = false) => ({ id, mine })

describe('a message arrives while you are reading', () => {
  it('follows the conversation only for a reader who is at the bottom', () => {
    expect(shouldJump({ pinned: true, lastIsMine: false, roomChanged: false })).toBe(true)
    // the whole feature: scrolled up, somebody else speaks, and the page stays where it is
    expect(shouldJump({ pinned: false, lastIsMine: false, roomChanged: false })).toBe(false)
  })

  it('still jumps for your own message, and for a different conversation', () => {
    expect(shouldJump({ pinned: false, lastIsMine: true, roomChanged: false })).toBe(true)
    expect(shouldJump({ pinned: false, lastIsMine: false, roomChanged: true })).toBe(true)
  })

  it('calls it the bottom within a thumb of the end, and not beyond', () => {
    // a 1000px log in a 400px box: the very end is scrollTop 600
    expect(atBottom(1000, 600, 400)).toBe(true)
    expect(atBottom(1000, 600 - (NEAR_BOTTOM - 1), 400)).toBe(true)
    expect(atBottom(1000, 600 - NEAR_BOTTOM, 400)).toBe(false)
    expect(atBottom(1000, 0, 400)).toBe(false)
  })
})

describe('how many are new', () => {
  const log = [m('a'), m('b'), m('c'), m('d')]

  it("counts other people's messages after the last one you saw", () => {
    expect(unseenAfter(log, 'b')).toBe(2)
    expect(unseenAfter(log, 'd')).toBe(0)
  })

  it('does not count your own', () => {
    expect(unseenAfter([m('a'), m('b', true), m('c'), m('d', true)], 'a')).toBe(1)
  })

  it('says nothing is new when there is no mark, rather than that everything is', () => {
    // a conversation just opened, and a mark left over from another room
    expect(unseenAfter(log, null)).toBe(0)
    expect(unseenAfter(log, 'from-another-room')).toBe(0)
  })

  it('survives older messages being put on the front, which a count would not', () => {
    // the mark is the 2nd of 4; with two older ones prepended it is the 4th of 6 and the
    // answer is the same two
    expect(unseenAfter([m('y'), m('z'), ...log], 'b')).toBe(2)
  })

  it('has one message and several', () => {
    expect(newMessagesLabel(1)).toBe('1 new message')
    expect(newMessagesLabel(3)).toBe('3 new messages')
  })
})
