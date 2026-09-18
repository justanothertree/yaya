import { InviteFriends } from '../components/InviteFriends'
import { boutMessage } from './boutInvite'

/**
 * "Fight a friend" — pick someone, and a scrap invite lands in your DM with them.
 *
 * ⚠️ THE SAME MACHINERY AS THE OTHER TWO. The friends list, open_dm, send_chat_message and the
 * popover are all shared with Snake's challenge and the circuit's invite — see InviteFriends. This
 * only decides what gets said, which is the whole of what makes a third one worth having rather
 * than a third thing to maintain.
 */
export function ScrapFriend({ code }: { code: string }) {
  if (!code) return null
  return (
    <InviteFriends
      body={boutMessage(code)}
      label="⚔️ Fight a friend"
      title="Send a friend an invite to this scrap"
      verb="challenge"
      emptyHint="No friends yet — add someone on the People page and you can fight them here."
      hint="They’ll get it in your messages, with a button that drops them straight into this bout."
    />
  )
}
