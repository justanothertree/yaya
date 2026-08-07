import { useEffect, useRef } from 'react'
import type { VoicePeer } from './useVoiceRoom'

/**
 * The call strip that sits under a conversation's header.
 *
 * Deliberately one button until you're in a call. Someone with no computer literacy should
 * see "Call" and nothing else — mute, who's here and hang up only appear once they're
 * relevant. Same progressive-disclosure rule the rest of the site follows.
 */

/** One <audio> per peer. Rendered, not created imperatively, so React owns the teardown. */
function PeerAudio({ peer }: { peer: VoicePeer }) {
  const ref = useRef<HTMLAudioElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.srcObject = peer.stream
    // Autoplay is allowed here because joining the call was itself a user gesture.
    void el.play().catch(() => {})
    return () => {
      el.srcObject = null
    }
  }, [peer.stream])
  return <audio ref={ref} autoPlay playsInline />
}

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
      <span className="voice-status">
        {peers.length === 0
          ? 'Waiting for someone to join…'
          : `In call with ${peers.map((p) => p.name).join(', ')}`}
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
      {peers.map((p) => (
        <PeerAudio key={p.id} peer={p} />
      ))}
    </div>
  )
}
