import { useEffect, useRef, useState } from 'react'
import { useVoiceSession } from './useVoiceSession'
import type { VoicePeer } from './voiceSession'
import { callWord, peerWord } from './callWords'

/**
 * A call now outlives the screen it started on, which is what makes it usable — but a call
 * you can't see is worse than one that hangs up. This is the small floating strip that
 * follows you across every page while you're connected: who you're with, how loud they are,
 * mute, hang up, and a way back to the conversation.
 *
 * It also owns the audio elements. They used to live in the chat thread, so navigating away
 * unmounted them and the other person went silent even though the connection was fine.
 */

const VOL_KEY = 'voice.volume.v1'

function readVol(): number {
  try {
    const v = parseFloat(localStorage.getItem(VOL_KEY) ?? '1')
    return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1
  } catch {
    return 1
  }
}

/** master × that person's own level — the dock knob moves everyone, the per-person one doesn't */
function PeerAudio({ peer, volume }: { peer: VoicePeer; volume: number }) {
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
  // Volume is applied on its own, so dragging the slider doesn't re-attach the stream —
  // re-attaching mid-call causes an audible gap.
  useEffect(() => {
    if (ref.current) ref.current.volume = volume
  }, [volume])
  return <audio ref={ref} autoPlay playsInline />
}

export function CallDock() {
  const { inCall, roomId, roomName, peers, muted, leave, toggleMute, peerVolume } =
    useVoiceSession()
  const [volume, setVolume] = useState(readVol)

  useEffect(() => {
    try {
      localStorage.setItem(VOL_KEY, String(volume))
    } catch {
      /* private mode — it just won't persist */
    }
  }, [volume])

  if (!inCall) return null

  return (
    <div className="call-dock" role="status" aria-live="polite">
      <span className="voice-dot" aria-hidden />
      {/* Tapping the room name takes you back to the conversation the call is in — you can
          wander off mid-call, and finding your way back shouldn't mean hunting for it. */}
      <a
        className="call-dock-who"
        href={roomId ? `#chat?room=${roomId}` : '#chat'}
        title={peers.map(peerWord).join('\n') || `Back to ${roomName}`}
      >
        <strong>{roomName}</strong>
        <span className="muted">{callWord(peers)}</span>
      </a>
      <label className="call-vol" title={`Their volume: ${Math.round(volume * 100)}%`}>
        <span aria-hidden>{volume === 0 ? '🔈' : '🔊'}</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={volume}
          onChange={(e) => setVolume(parseFloat(e.target.value))}
          aria-label="Call volume"
        />
      </label>
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
          <PeerAudio key={p.id} peer={p} volume={volume * (peerVolume[p.id] ?? 1)} />
        ))}
    </div>
  )
}
