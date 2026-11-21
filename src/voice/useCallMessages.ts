import { useEffect, useState } from 'react'
import { markThreadRead, useThread } from '../circuit/roomThread'
import type { Msg } from '../circuit/chatRooms'
import { nextSeen, unseenOf } from './callChatLog'
import { useCallChat } from './callChatStore'
import type { RoomKind } from './voiceSession'

/**
 * Whether a call happens in a chat room — a DM, a circuit or the Lounge — whose own conversation
 * is the natural place for what you type during it. A profile call (and anything that did not
 * say what it is) has none, and gets a chat that lasts as long as the call. See callChat.ts.
 */
const hasRoom = (kind: RoomKind | null) => kind === 'dm' || kind === 'circuit' || kind === 'lounge'

/**
 * This call's messages, and how many arrived that you have not looked at.
 *
 * ⚠️ THE ANCHOR FOLLOWS THE CONVERSATION THE WHOLE CALL, PANEL OPEN OR NOT, because the count on
 * its 💬 is the only way somebody who is on another page, talking, finds out that a link was just
 * pasted for them. It follows as a WATCHER, not a viewer (see useThread): a message that arrives
 * while the panel is closed stays unread for the bell too, since nobody has seen it.
 */
export function useCallMessages(roomId: string | null, kind: RoomKind | null, open: boolean) {
  const inRoom = hasRoom(kind)
  const thread = useThread(inRoom ? roomId : null, kind ?? '', open)
  const loose = useCallChat()
  const msgs: Msg[] = inRoom ? thread.msgs : loose
  const ready = inRoom ? thread.loaded : true

  /**
   * Everything up to here has been seen.
   *
   * ⚠️ STATE AND AN EFFECT, NOT A REF WRITTEN DURING RENDER. It was `useRef` moved in the render
   * body, which React does not promise anything about: a render may be thrown away or run twice
   * (StrictMode does the second on purpose), and a ref written in it keeps the mark from a render
   * nobody kept. The decision itself is `nextSeen`, which has no React in it at all and is asked
   * directly in `callChatLog.test.ts`.
   *
   * The visible difference is one frame: opening the panel used to zero the badge during the same
   * render, and now zeroes it on the next one. The panel is open at that point, so the badge is
   * not what anybody is looking at — and the two readings that could flash a WRONG number, a
   * first load and a list that shrank, both answer 0 through `unseenOf` while the mark is still
   * null or past the end.
   */
  const [seen, setSeen] = useState<number | null>(null)
  useEffect(() => {
    const mark = nextSeen({ ready, open, length: msgs.length, seen })
    if (mark !== null && mark !== seen) setSeen(mark)
  }, [ready, open, msgs.length, seen])
  const unseen = unseenOf(msgs, seen)

  /* opening the panel is reading the room: clear its unread for the bell as well */
  useEffect(() => {
    if (open && inRoom && roomId) markThreadRead(roomId)
  }, [open, inRoom, roomId])

  return { msgs, unseen, inRoom, err: inRoom ? thread.err : null }
}
