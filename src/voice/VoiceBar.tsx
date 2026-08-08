import type { VoicePeer } from './voiceSession'
import { callWord, callHelp, peerWord } from './callWords'

/**
 * The call strip inside a conversation.
 *
 * Deliberately one button until you're in a call. Someone with no computer literacy should
 * see "Call" and nothing else — mute, who's here and hang up only appear once they're
 * relevant. Same progressive-disclosure rule the rest of the site follows.
 *
 * It does NOT render the audio: CallDock does, once, at app level. Playing the same stream
 * from two elements would double it, and audio mounted here would cut out the moment you
 * navigated away.
 */
export function VoiceBar({
  inCall,
  peers,
  muted,
  error,
  onJoin,
  onLeave,
  onToggleMute,
  label,
}: {
  inCall: boolean
  peers: VoicePeer[]
  muted: boolean
  error: string | null
  onJoin: () => void
  onLeave: () => void
  onToggleMute: () => void
  /** who you'd be calling, for the resting state */
  label: string
}) {
  if (!inCall) {
    return (
      <div className="voice-bar">
        <button className="btn" onClick={onJoin} title={`Start a voice call in ${label}`}>
          🎙 Call
        </button>
        {error && <span className="voice-err">{error}</span>}
      </div>
    )
  }

  return (
    <div className="voice-bar is-live">
      <span className="voice-dot" aria-hidden />
      <span className="voice-status" title={peers.map(peerWord).join('\n')}>
        {callWord(peers)}
      </span>
      <button
        className={'btn' + (muted ? ' is-muted' : '')}
        onClick={onToggleMute}
        aria-pressed={muted}
        title={muted ? 'Unmute your microphone' : 'Mute your microphone'}
      >
        {muted ? '🔇 Muted' : '🎙 Mute'}
      </button>
      <button className="btn voice-leave" onClick={onLeave} title="Leave the call">
        Leave
      </button>
      {callHelp(peers) && <span className="voice-err">{callHelp(peers)}</span>}
    </div>
  )
}
