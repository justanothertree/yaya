import { closeCallChat, openCallChat, useCallChatShown } from '../../voice/callChatOpen'

/**
 * A live game's chat is the call's own (src/voice/CallChat.tsx, the dock's 💬): a game in a call
 * has no panel of its own, by Evan's choice, so what you type mid-game is what you would type to
 * the call. Everybody in the call reads it, watchers included; a call in a DM or a circuit puts it
 * in that conversation, kept, where its members read it whether or not they are in the call. The
 * panel itself says which.
 *
 * This opens it from beside the board, in a word: the dock's button is a glyph at the bottom of
 * the screen, and the table is where a player is looking. A toggle like the 💬, so it carries the
 * panel's state; opening puts the focus in the panel's box and its ✕ hands it back here
 * (callChatOpen.ts says why). On a phone the panel is kept short on a Lab page so the board is not
 * all under it (lab.css, "a live game's chat").
 */
export function CallChatButton() {
  const open = useCallChatShown()
  return (
    <button
      className="btn btn-ghost"
      aria-haspopup="dialog"
      aria-expanded={open}
      onClick={(e) => (open ? closeCallChat() : openCallChat(e.currentTarget))}
    >
      💬 Call chat
    </button>
  )
}
