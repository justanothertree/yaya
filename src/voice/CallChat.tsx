import { MessageLog } from '../circuit/ui/MessageLog'
import { Composer } from '../circuit/ui/Composer'
import { sendToThread } from '../circuit/roomThread'
import type { Msg } from '../circuit/chatRooms'
import type { ChatSong } from '../circuit/chatSongs'
import { sendCallChat } from './callChatStore'

/**
 * The call's chat, risen from the anchor: read and type without leaving the page you are on.
 *
 * It is the thing the anchor could not do. The room name on the dock is a link back to the
 * conversation, which is the right door when you want the conversation — and the wrong one when
 * you are mid-game or mid-drawing with somebody and only want to send them a line.
 */
export function CallChat({
  roomId,
  roomName,
  msgs,
  inRoom,
  err,
  songs,
  focusBox = false,
  onClose,
}: {
  roomId: string | null
  roomName: string
  msgs: Msg[]
  inRoom: boolean
  err: string | null
  /** the room's songs, when the call is in a chat room — see useCallMessages */
  songs?: Record<string, ChatSong>
  /** put the focus in the box on opening — asked from the page, where the panel is far away in
   *  the tab order (callChatOpen.ts); not from the dock's 💬, which it sits straight after */
  focusBox?: boolean
  onClose: () => void
}) {
  return (
    <div className="call-pop call-chat" role="dialog" aria-label={`Chat for ${roomName}`}>
      <div className="callroster-head">
        <strong className="call-chat-title">💬 {roomName}</strong>
        <button className="btn" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>
      {/* Said out loud, because the two kinds behave differently in the one way that matters:
          whether what you type is still there tomorrow. */}
      <p className="muted call-chat-note">
        {inRoom ? (
          <>
            This is your conversation in {roomName} — it is all still there after the call.{' '}
            {roomId && <a href={`#chat?room=${roomId}`}>Open it in Chat</a>}
          </>
        ) : (
          'Only for this call: everyone in it sees what is sent while they are here, and nothing is kept once you hang up.'
        )}
      </p>
      <MessageLog
        msgs={msgs}
        empty={inRoom ? undefined : 'Nothing yet — say something to the call.'}
        songs={inRoom ? songs : undefined}
      />
      {err && (
        <p className="muted cz-chat-err" role="alert">
          {err}
        </p>
      )}
      <Composer
        autoFocus={focusBox}
        /* one kept draft for this box, whichever way it is sending — the box itself keeps its
           words when the destination changes, so its draft does too */
        keep="call"
        placeholder={inRoom ? `Message ${roomName}` : 'Message the call'}
        onSend={(text) => (inRoom && roomId ? sendToThread(roomId, text) : sendCallChat(text))}
      />
    </div>
  )
}
