// Chat — a top-level destination rather than a tab buried inside the Circuit. Messaging is
// its own thing: you come here to talk, not to look at fitness numbers, and on a phone the
// conversation list wants the whole screen. The cz-tab-chat class carries the full-height
// mobile treatment the chat already had as a Circuit tab.
import { Chat } from '../circuit/ui/Chat'

export function ChatPage({
  authed = false,
  voiceIn,
}: {
  authed?: boolean
  /** who is in each room's call — subscribed once in App, see useVoicePresence */
  voiceIn?: Record<string, string[]>
}) {
  return (
    <div className="cz-tab-chat">
      <div
        className="cz-head"
        style={{ display: 'flex', alignItems: 'baseline', gap: '0.75rem', flexWrap: 'wrap' }}
      >
        <h2 className="section-title" style={{ margin: 0 }}>
          Chat
        </h2>
        <span className="muted cz-subtitle" style={{ fontSize: '0.85rem' }}>
          your circles, your crew, your DMs
        </span>
      </div>
      <Chat authed={authed} voiceIn={voiceIn} />
    </div>
  )
}
