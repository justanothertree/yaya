import { useEffect, useRef, useState } from 'react'
import { useVoiceSession } from './useVoiceSession'
import type { VoicePeer } from './voiceSession'
import { callWord, peerWord, speakingNames } from './callWords'

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

/**
 * The element exists to keep the remote track flowing — some browsers won't deliver one
 * without a media sink attached. When Web Audio is handling playback (which is what lets
 * volume exceed 100%) this stays muted so nothing is heard twice; if Web Audio failed it
 * plays normally, capped at source level.
 */
function PeerAudio({
  peer,
  fallbackVolume,
  webAudio,
}: {
  peer: VoicePeer
  fallbackVolume: number
  webAudio: boolean
}) {
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
  // Applied separately so dragging a slider never re-attaches the stream — re-attaching
  // mid-call causes an audible gap.
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.muted = webAudio
    el.volume = Math.min(1, fallbackVolume)
  }, [fallbackVolume, webAudio])
  return <audio ref={ref} autoPlay playsInline />
}

export function CallDock() {
  const {
    inCall,
    roomId,
    roomName,
    peers,
    muted,
    leave,
    toggleMute,
    peerVolume,
    setMaster,
    usesWebAudio,
  } = useVoiceSession()
  const [volume, setVolume] = useState(readVol)

  useEffect(() => {
    setMaster(volume)
    try {
      localStorage.setItem(VOL_KEY, String(volume))
    } catch {
      /* private mode — it just won't persist */
    }
  }, [volume, setMaster])

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
        {/* Who's talking wins over the roster while it's happening — that's the information
            you want mid-call, and it's the Discord cue Evan's friends asked for. */}
        {speakingNames(peers).length > 0 ? (
          <span className="call-dock-talking">🗣 {speakingNames(peers).join(', ')}</span>
        ) : (
          <span className="muted">{callWord(peers)}</span>
        )}
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
      {/* wrapped so the click event isn't passed as leave()'s `silent` flag — see VoiceBar */}
      <button className="btn voice-leave" onClick={() => leave()} title="Leave the call">
        Leave
      </button>
      {/* Audio lives here so it survives navigation. Only peers that actually sent a
          stream — a failed peer has none, and an <audio> with a null source is noise. */}
      {peers
        .filter((p) => p.stream)
        .map((p) => (
          <PeerAudio
            key={p.id}
            peer={p}
            fallbackVolume={volume * (peerVolume[p.id] ?? 0.5) * 2}
            webAudio={usesWebAudio()}
          />
        ))}
    </div>
  )
}
