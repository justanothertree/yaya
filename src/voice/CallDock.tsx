import { useEffect, useRef } from 'react'
import { useVoiceSession } from './useVoiceSession'
import type { VoicePeer } from './voiceSession'
import { callWord, peerWord } from './callWords'

/**
 * A call now outlives the screen it started on, which is what makes it usable — but a call
 * you can't see is worse than one that hangs up. This is the small floating strip that
 * follows you across every page while you're connected: who you're with, mute, hang up.
 *
 * It also owns the audio elements. They used to live in the chat thread, so navigating away
 * unmounted them and the other person went silent even though the connection was fine.
 */

function PeerAudio({ peer }: { peer: VoicePeer }) {
  const ref = useRef<HTMLAudioElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el || !peer.stream) return
    el.srcObject = peer.stream
    void el.play().catch(() => {})
    return () => {
      el.srcObject = null
    }
  }, [peer.stream])
  return <audio ref={ref} autoPlay playsInline />
}

export function CallDock() {
  const { inCall, roomName, peers, muted, leave, toggleMute } = useVoiceSession()
  if (!inCall) return null

  return (
    <div className="call-dock" role="status" aria-live="polite">
      <span className="voice-dot" aria-hidden />
      <span className="call-dock-who" title={peers.map(peerWord).join('\n')}>
        <strong>{roomName}</strong>
        <span className="muted">{callWord(peers)}</span>
      </span>
      <button
        className={'btn' + (muted ? ' is-muted' : '')}
        onClick={toggleMute}
        aria-pressed={muted}
        title={muted ? 'Unmute your microphone' : 'Mute your microphone'}
      >
        {muted ? '🔇' : '🎙'}
      </button>
      <button className="btn voice-leave" onClick={leave} title="Leave the call">
        Leave
      </button>
      {/* Audio lives here so it survives navigation. Only peers that actually sent a
          stream — a failed peer has none, and an <audio> with a null source is noise. */}
      {peers
        .filter((p) => p.stream)
        .map((p) => (
          <PeerAudio key={p.id} peer={p} />
        ))}
    </div>
  )
}
