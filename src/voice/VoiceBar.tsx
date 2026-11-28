import { useEffect, useState } from 'react'
import { useVoiceSession } from './useVoiceSession'
import { callWord, callHelp, peerWord, speakingNames } from './callWords'
import { MicSettings } from './MicSettings'
import type { RoomKind } from './voiceSession'

/**
 * The call strip inside a conversation.
 *
 * One button until you're in a call — someone with no computer literacy should see "Call"
 * and nothing else. Once connected you get who's here, mute and leave; the fiddly bits
 * (mic sensitivity, per-person volume) sit behind a settings toggle so they're there when
 * wanted and invisible when not.
 *
 * Reads the session directly rather than taking a dozen props: the call is a global thing
 * now, and threading it through would only invite the two surfaces to disagree.
 *
 * It does NOT render the audio — CallDock does, once, at app level. Two elements playing one
 * stream would double it, and audio mounted here would cut out when you navigated away.
 */
export function VoiceBar({
  roomId,
  roomName,
  meId,
  myName,
  occupancy,
  roomKind,
}: {
  roomId: string
  roomName: string
  meId: string
  /**
   * Who the call announces you as, or null for "not known yet" — the Lounge before its name has
   * loaded. ⚠️ NULL HOLDS THE CALL rather than falling back to anything, because the only name
   * there is to fall back to is the real one, which is what the Lounge exists not to show.
   */
  myName: string | null
  /** how many are already in this room's call, from voice presence */
  occupancy?: number
  /** circuit, lounge or dm — said here because the call itself cannot know */
  roomKind?: RoomKind
}) {
  const v = useVoiceSession()
  const [showAudio, setShowAudio] = useState(false)
  /**
   * Wake the relay as soon as a call button is on screen, not when it's pressed.
   *
   * The relay sleeps when idle and takes the better part of a minute to wake. Doing this at
   * mount means that cold start runs while you're reading the conversation, so the credentials
   * are already in hand by the time anyone joins — instead of the first call of the day being
   * the one that has to wait for it, or give up on it.
   */
  useEffect(() => {
    v.warmIce()
    // once per mount; the session caches the result
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const mine = v.inCall && v.roomId === roomId

  if (!mine) {
    return (
      <div className="voice-bar">
        <button
          className="btn"
          disabled={v.joining || myName === null}
          onClick={() => {
            if (myName !== null) void v.join(roomId, roomName, meId, myName, occupancy, roomKind)
          }}
          title={
            myName === null
              ? 'Your Lounge name has not loaded yet'
              : v.inCall
                ? `Leave ${v.roomName} and join this call instead`
                : `Start a voice call in ${roomName}`
          }
        >
          {/* Switching used to be blocked until you'd left the other call first. It just
              moves you now, so the button says which it's about to do. "Connecting…" exists
              because a cold call relay can hold this up for most of a minute, and a button
              that does nothing that long reads as broken — and gets pressed again. */}
          {v.joining ? '⏳ Connecting…' : v.inCall ? '🎙 Switch to this call' : '🎙 Call'}
        </button>
        {/* This describes where YOU are, not this room -- it renders on every OTHER room's
            bar while you're in a call anywhere, and "In a call in Josh" under the Circuit
            row read as if the Circuit had an active call rather than as a note about
            somewhere else entirely. Made unambiguous instead. */}
        {v.inCall && <span className="voice-status muted">You're in a call in {v.roomName}</span>}
        {v.error && <span className="voice-err">{v.error}</span>}
      </div>
    )
  }

  return (
    <div className="voice-wrap">
      <div className="voice-bar is-live">
        <span className="voice-dot" aria-hidden />
        <span className="voice-status" title={v.peers.map(peerWord).join('\n')}>
          {speakingNames(v.peers).length > 0 ? (
            <span className="voice-talking">🗣 {speakingNames(v.peers).join(', ')}</span>
          ) : (
            callWord(v.peers)
          )}
        </span>
        <button
          className={'btn' + (v.muted ? ' is-muted' : '')}
          onClick={v.toggleMute}
          aria-pressed={v.muted}
          title={v.muted ? 'Unmute your microphone' : 'Mute your microphone'}
        >
          {v.muted ? '🔇 Muted' : '🎙 Mute'}
        </button>
        <button
          className="btn"
          onClick={() => setShowAudio((s) => !s)}
          aria-expanded={showAudio}
          title="Microphone sensitivity and how loud each person is"
        >
          ⚙
        </button>
        {/* Wrapped, not passed bare: onClick would hand leave() the click event as its
            `silent` argument, and an event object is truthy — every hang-up would have been
            silent. TypeScript caught it; the runtime would not have. */}
        <button className="btn voice-leave" onClick={() => v.leave()} title="Leave the call">
          Leave
        </button>
        {callHelp(v.peers) && <span className="voice-err">{callHelp(v.peers)}</span>}
      </div>

      {showAudio && <MicSettings />}
    </div>
  )
}
