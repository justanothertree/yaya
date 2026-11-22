// What a conversation IS, for the two files that draw one: the list (ui/ChatList) and the open
// thread (ui/Chat). Here rather than in either, because a component file may only export
// components — fast refresh cannot keep state across an edit to one that exports anything else.
import type { Seen } from '../hooks/usePresence'

/** one row of list_chat_overview — a conversation you can see, and where it stands */
export type Overview = {
  id: string
  kind: string
  name: string
  last_body: string | null
  last_author: string | null
  last_at: string | null
  unread: number
  /**
   * For a DM, the other person's id.
   *
   * ⚠️ THE KEY A FRIEND IS MATCHED TO THEIR CONVERSATION BY, not the room's name. A DM is named
   * after the other person's first name, and matching on that works right up until two friends
   * share one. Optional because the dev harness and any older row may not carry it — such a DM
   * simply lists as a conversation rather than under its person.
   */
  peer_user_id?: string | null
}

export const roomIcon = (kind: string) => (kind === 'lounge' ? '🛋️' : kind === 'dm' ? '✉️' : '👥')

/** "Online" / "Away" spelled out, or nothing — a 10px dot alone is easy to have never noticed */
export const seenWord = (seen?: Seen) => (seen ? (seen.status === 'away' ? 'Away' : 'Online') : '')

/** one message, in the shape list_room_messages and send_chat_message both return */
export type Msg = {
  id: string
  room_id: string
  /** null in the Lounge — see list_room_messages. Never read it to decide "is this mine". */
  author_user_id: string | null
  author_name: string
  /** present only when the author's identity is theirs to show; null makes the name unlinkable */
  author_username: string | null
  mine: boolean
  body: string
  created_at: string
}
