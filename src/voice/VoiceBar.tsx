import { useEffect, useState } from 'react'
import { useVoiceSession } from './useVoiceSession'
import { callWord, callHelp, peerWord, speakingNames } from './callWords'
import { MicMeter } from './MicMeter'
import { soundsEnabled, setSoundsEnabled } from './callSounds'

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
}: {
  roomId: string
  roomName: string
  meId: string
  myName: string
  /** how many are already in this room's call, from voice presence */
  occupancy?: number
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
  const [sounds, setSounds] = useState(soundsEnabled)
  const mine = v.inCall && v.roomId === roomId

  if (!mine) {
    return (
      <div className="voice-bar">
        <button
          className="btn"
          disabled={v.joining}
          onClick={() => void v.join(roomId, roomName, meId, myName, occupancy)}
          title={
            v.inCall
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

      {showAudio && (
        <div className="voice-audio">
          <label className="voice-row">
            <span className="voice-row-label">Only send when I’m this loud</span>
            <MicMeter getLevel={v.getMicLevel} isOpen={v.isOpen} threshold={v.threshold} />
            <input
              type="range"
              min={0}
              max={0.6}
              step={0.02}
              value={v.threshold}
              onChange={(e) => v.setThreshold(parseFloat(e.target.value))}
              aria-label="Microphone sensitivity"
            />
            <span className="voice-row-val">
              {/* Shown as position along the slider, not the raw value. Measured against real
                  signal: room noise sits near 0.05 and normal speech near 0.56, so the useful
                  band is 0–0.6. Printing the raw number meant "20%" landed at 0.2, i.e. right
                  on top of normal speech, and would have cut off anyone talking quietly. */}
              {v.threshold === 0 ? 'always on' : `${Math.round((v.threshold / 0.6) * 100)}%`}
            </span>
          </label>
          {/* The Krisp gap: keyboards blow straight through a level gate because clacks are
              loud. This is RNNoise (the open-source ML denoiser) in the mic chain, with the
              gate listening to the CLEANED signal — so a removed clack doesn't even open it. */}
          <label className="voice-row">
            <span className="voice-row-label">
              Remove background noise
              {v.denoiseUnavailable && <span className="muted"> (not in this browser)</span>}
            </span>
            <input
              type="checkbox"
              checked={v.denoise && !v.denoiseUnavailable}
              disabled={v.denoiseUnavailable}
              onChange={(e) => v.setDenoise(e.target.checked)}
              aria-label="Remove keyboard and background noise from your microphone"
            />
          </label>
          <label className="voice-row">
            <span className="voice-row-label">Join / leave sounds</span>
            <input
              type="checkbox"
              checked={sounds}
              onChange={(e) => {
                setSoundsEnabled(e.target.checked)
                setSounds(e.target.checked)
              }}
              aria-label="Play a sound when someone joins or leaves"
            />
          </label>
          <p className="voice-hint muted">
            Speak normally and watch the bar. Put the marker just below where it reaches, and quiet
            rooms stop being broadcast. Leave it at 0 to always send.
          </p>
          {/* The layer under the UI, for bug reports: whether the relay is held, each
              connection's real state, and signalling counters both ways. "In the call" via
              presence while the connection sits in `connecting` is invisible everywhere else,
              and that gap is exactly what a remote "we can't see each other's shares" needs. */}
          <p className="voice-hint muted" style={{ userSelect: 'all', fontSize: '0.68rem' }}>
            {v.debugSnapshot()}
          </p>

          {v.peers.length > 0 && (
            <>
              <div className="voice-row-label">How loud each person is</div>
              {v.peers.map((p) => (
                <label className="voice-row" key={p.id}>
                  <span className={'voice-row-label' + (p.speaking ? ' is-talking' : '')}>
                    {p.name}
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    /* 0.5 is unity, so the slider reads 100% at normal and goes to 200% —
                       a friend's 100% was too quiet, and an <audio> element can't exceed
                       source level. Web Audio gain can. */
                    value={v.peerVolume[p.id] ?? 0.5}
                    onChange={(e) => v.setPeerVolume(p.id, parseFloat(e.target.value))}
                    aria-label={`Volume for ${p.name}`}
                  />
                  <span className="voice-row-val">
                    {Math.round((v.peerVolume[p.id] ?? 0.5) * 200)}%
                  </span>
                </label>
              ))}
            </>
          )}
        </div>
      )}
    </div>
  )
}
