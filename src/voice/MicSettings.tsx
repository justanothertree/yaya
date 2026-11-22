import { useState } from 'react'
import { useVoiceSession } from './useVoiceSession'
import { MicMeter } from './MicMeter'
import { soundsEnabled, setSoundsEnabled } from './callSounds'

/**
 * Your microphone, and how loud each person is — the panel behind a call's ⚙.
 *
 * ⚠️ ONE PANEL, TWO DOORS. It lived inside VoiceBar, so it could only be opened from the
 * conversation the call started in: the anchor that follows you to every other page had mute and
 * leave and no way to say "my keyboard is too loud" without walking back to the chat first. The
 * anchor has a ⚙ of its own now, and both open this — reading the session directly, so the two
 * cannot show different numbers for the same slider.
 */
export function MicSettings() {
  const v = useVoiceSession()
  const [sounds, setSounds] = useState(soundsEnabled)
  return (
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
        Speak normally and put the marker just below where the bar reaches. 0 always sends.
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
  )
}
