import { useEffect, useRef } from 'react'
import { markThreadRead, useThread } from '../circuit/roomThread'
import type { Msg } from '../circuit/chatRooms'
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
   * Everything up to here has been seen. A ref and not state: it only matters at the moment a
   * message arrives, and moving it must not re-render anything.
   *
   * ⚠️ `null` UNTIL THE FIRST READ LANDS, which is the difference between "three new messages"
   * and "the fifty that were already in this room before you rang" — a count that starts at the
   * room's whole history is a badge that is wrong from the first second of every call.
   */
  const seen = useRef<number | null>(null)
  if (ready && (seen.current === null || open || msgs.length < seen.current))
    seen.current = msgs.length
  const unseen = seen.current === null ? 0 : msgs.slice(seen.current).filter((m) => !m.mine).length

  /* opening the panel is reading the room: clear its unread for the bell as well */
  useEffect(() => {
    if (open && inRoom && roomId) markThreadRead(roomId)
  }, [open, inRoom, roomId])

  return { msgs, unseen, inRoom, err: inRoom ? thread.err : null }
}
