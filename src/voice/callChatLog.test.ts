import { describe, expect, it } from 'vitest'
import {
  CHAT_BURST,
  CHAT_REFILL_MS,
  KEEP,
  MAX_TEXT,
  appendCapped,
  nextSeen,
  readChatName,
  readChatText,
  roomChange,
  senderGate,
  unseenOf,
} from './callChatLog'
import type { Msg } from '../circuit/chatRooms'

/**
 * ⚠️ THIS ASKS THE DECISIONS, NOT THE STORE AROUND THEM. `callChatStore.ts` is a module-level
 * singleton that wires itself on first subscribe and hands state out through
 * `useSyncExternalStore`; there is no DOM in this test environment and no React renderer in the
 * project, so every rule inside it used to be unreachable. They were moved to `callChatLog.ts`
 * for that reason, and the store now does nothing but call them — which is the point of the move
 * rather than a way around it.
 */

const line = (over: Partial<Msg> = {}): Msg => ({
  id: 'x',
  room_id: 'call',
  author_user_id: 'them',
  author_name: 'Them',
  author_username: null,
  mine: false,
  body: 'hello',
  created_at: '2026-11-21T12:00:00.000Z',
  ...over,
})

describe('what counts as a line of a call’s chat', () => {
  it('takes a chat message with text in it', () => {
    expect(readChatText({ kind: 'chat', body: { text: 'hello' } })).toBe('hello')
  })

  it('ignores a message that is not chat, whatever its body says', () => {
    /* the channel carries pointers and presence on the same wire */
    expect(readChatText({ kind: 'pointer', body: { text: 'hello' } })).toBeNull()
    expect(readChatText({ kind: 'presence', body: { text: 'hello' } })).toBeNull()
    expect(readChatText(null)).toBeNull()
    expect(readChatText({ body: { text: 'hello' } })).toBeNull()
  })

  it('ignores an empty one, and one that is only spaces', () => {
    expect(readChatText({ kind: 'chat', body: { text: '' } })).toBeNull()
    expect(readChatText({ kind: 'chat', body: { text: '   \n\t ' } })).toBeNull()
  })

  it('ignores a body that is not a string, because the sender’s client can be rewritten', () => {
    for (const text of [42, null, undefined, { a: 1 }, ['a'], true])
      expect(readChatText({ kind: 'chat', body: { text } })).toBeNull()
    expect(readChatText({ kind: 'chat', body: null })).toBeNull()
  })

  it('trims, and bounds a very long line to MAX_TEXT', () => {
    expect(readChatText({ kind: 'chat', body: { text: '  hi  ' } })).toBe('hi')
    const long = 'a'.repeat(MAX_TEXT + 500)
    expect(readChatText({ kind: 'chat', body: { text: long } })).toHaveLength(MAX_TEXT)
  })

  it('bounds a name and never leaves it blank', () => {
    expect(readChatName('Robin')).toBe('Robin')
    expect(readChatName('')).toBe('Someone')
    expect(readChatName(null)).toBe('Someone')
    expect(readChatName('n'.repeat(90))).toHaveLength(40)
  })
})

describe('how many lines a call keeps', () => {
  it('keeps 300', () => {
    expect(KEEP).toBe(300)
  })

  it('holds everything until the cap', () => {
    let msgs: Msg[] = []
    for (let i = 0; i < KEEP; i++) msgs = appendCapped(msgs, line({ id: String(i) }))
    expect(msgs).toHaveLength(KEEP)
    expect(msgs[0].id).toBe('0')
    expect(msgs[KEEP - 1].id).toBe(String(KEEP - 1))
  })

  it('drops the OLDEST once it is full, and stays at the cap', () => {
    /* the shape rather than the sum: after n > KEEP pushes the window is the last KEEP ids */
    let msgs: Msg[] = []
    for (let i = 0; i < KEEP + 50; i++) msgs = appendCapped(msgs, line({ id: String(i) }))
    expect(msgs).toHaveLength(KEEP)
    expect(msgs[0].id).toBe('50')
    expect(msgs[msgs.length - 1].id).toBe(String(KEEP + 49))
  })
})

describe('when a call’s chat is thrown away', () => {
  it('clears when the call becomes a different call', () => {
    expect(roomChange('room-a', 'room-b', 3)).toEqual({ changed: true, clear: true })
  })

  it('clears when the call ends', () => {
    expect(roomChange('room-a', null, 3)).toEqual({ changed: true, clear: true })
  })

  it('keeps what is held while the call is the same one', () => {
    expect(roomChange('room-a', 'room-a', 3)).toEqual({ changed: false, clear: false })
  })

  it('notices the change even with nothing to throw away', () => {
    /* `changed` still has to move, or the room it remembers goes stale and the NEXT change is
       measured from the wrong place */
    expect(roomChange('room-a', 'room-b', 0)).toEqual({ changed: true, clear: false })
  })
})

/** a clock the test turns by hand, the same shape nudge.test.ts uses */
const hand = () => {
  let t = 0
  return { clock: { now: () => t }, tick: (ms: number) => (t += ms) }
}

describe('one sender’s rate, and nobody else’s', () => {
  it('lets an ordinary flurry straight through', () => {
    const h = hand()
    const g = senderGate({}, h.clock)
    /* five at once is the burst — typing three quick lines must never be refused */
    for (let i = 0; i < CHAT_BURST; i++) expect(g.allow('them')).toBe(true)
  })

  it('refuses the line after the burst, rather than delaying it', () => {
    const h = hand()
    const g = senderGate({}, h.clock)
    for (let i = 0; i < CHAT_BURST; i++) g.allow('them')
    expect(g.allow('them')).toBe(false)
  })

  it('gives one back per refill, so a flood costs one line a second', () => {
    const h = hand()
    const g = senderGate({}, h.clock)
    for (let i = 0; i < CHAT_BURST; i++) g.allow('them')
    expect(g.allow('them')).toBe(false)
    h.tick(CHAT_REFILL_MS)
    expect(g.allow('them')).toBe(true)
    expect(g.allow('them')).toBe(false)
    h.tick(CHAT_REFILL_MS * 3)
    expect(g.allow('them')).toBe(true)
    expect(g.allow('them')).toBe(true)
    expect(g.allow('them')).toBe(true)
    expect(g.allow('them')).toBe(false)
  })

  it('does not stall a sender whose gaps are just under the refill', () => {
    /* whole-number refill would hand back nothing at 900ms for ever; fractional tokens do not */
    const h = hand()
    const g = senderGate({}, h.clock)
    for (let i = 0; i < CHAT_BURST; i++) g.allow('them')
    let taken = 0
    for (let i = 0; i < 40; i++) {
      h.tick(900)
      if (g.allow('them')) taken++
    }
    /* 40 gaps of 900ms is 36 seconds, so about 36 lines earned — never zero */
    expect(taken).toBeGreaterThan(30)
  })

  it('counts each sender on their own, so one flood does not silence the room', () => {
    const h = hand()
    const g = senderGate({}, h.clock)
    for (let i = 0; i < CHAT_BURST + 5; i++) g.allow('loud')
    expect(g.allow('loud')).toBe(false)
    expect(g.allow('quiet')).toBe(true)
  })

  it('forgets the least recently heard rather than growing without end', () => {
    const h = hand()
    const g = senderGate({ senders: 4 }, h.clock)
    for (const who of ['a', 'b', 'c', 'd']) g.allow(who)
    expect(g.size()).toBe(4)
    g.allow('e')
    expect(g.size()).toBe(4)
    /* 'a' was the oldest, so it is gone and starts fresh — which is the safe direction to err:
       a forgotten sender gets their burst back, never somebody else's refusal */
    g.allow('b')
    g.allow('f')
    expect(g.size()).toBe(4)
  })
})

describe('the unseen count on the 💬', () => {
  const them = (n: number) => Array.from({ length: n }, (_, i) => line({ id: `t${i}` }))
  const mine = (n: number) => Array.from({ length: n }, (_, i) => line({ id: `m${i}`, mine: true }))

  it('is nothing before the first read lands', () => {
    /* the whole point of `null`: a room's history is not news */
    expect(unseenOf(them(50), null)).toBe(0)
  })

  it('counts what arrived after the mark', () => {
    expect(unseenOf([...them(3), ...them(2)], 3)).toBe(2)
  })

  it('never counts your own lines', () => {
    expect(unseenOf([...them(1), ...mine(4)], 1)).toBe(0)
    expect(unseenOf([...them(1), ...mine(4), ...them(2)], 1)).toBe(2)
  })

  it('is nothing when the mark is past the end, rather than negative or NaN', () => {
    expect(unseenOf(them(2), 9)).toBe(0)
  })
})

describe('where the seen mark moves to', () => {
  it('does not move before the thread is ready', () => {
    expect(nextSeen({ ready: false, open: true, length: 9, seen: null })).toBeNull()
  })

  it('starts at the end, so what was said before you rang is not news', () => {
    expect(nextSeen({ ready: true, open: false, length: 50, seen: null })).toBe(50)
  })

  it('follows the end while the panel is open, because reading is seeing', () => {
    expect(nextSeen({ ready: true, open: true, length: 7, seen: 3 })).toBe(7)
  })

  it('stays put while the panel is closed and lines arrive', () => {
    expect(nextSeen({ ready: true, open: false, length: 7, seen: 3 })).toBeNull()
  })

  it('follows a list that got shorter down to its new end', () => {
    /* a cleared call: leaving the mark at 7 would have `slice(7)` reading past the end for ever */
    expect(nextSeen({ ready: true, open: false, length: 0, seen: 7 })).toBe(0)
  })
})
