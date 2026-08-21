import { InviteFriends } from '../components/InviteFriends'
import { challengeMessage } from './challenge'

/**
 * "Challenge a friend" — pick someone, and a Snake invite lands in your DM with them.
 *
 * All the machinery (friends list, open_dm, send_chat_message, the popover) is shared with the
 * Circuit's "invite to this circuit", which is the same gesture with a different sentence. See
 * InviteFriends; this only decides what gets said.
 */
export function ChallengeFriend({ roomId, roomLabel }: { roomId: string; roomLabel?: string }) {
  if (!roomId) return null
  return (
    <InviteFriends
      body={challengeMessage(roomId, roomLabel)}
      label="⚔️ Challenge a friend"
      title="Send a friend an invite to this game"
      verb="challenge"
      emptyHint="No friends yet — add someone on the People page and you can challenge them here."
      hint="They’ll get it in your messages, with a button that drops them straight into this room."
    />
  )
}
