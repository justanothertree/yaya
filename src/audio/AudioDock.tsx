import { useEffect, useState } from 'react'
import { musicEl, musicName, sharedOn, stopMusic, stopShared, onMusicChange } from './musicSource'
import { onMixerChange, setVolume, volume } from './mixer'

/**
 * What is playing, wherever you are on the site.
 *
 * ⚠️ THE POINT IS THAT THE AUDIO OUTLIVES THE PAGE. Music used to stop the moment you navigated
 * away from the visualiser, because the component's unmount tore it down — which made the whole
 * thing a toy you had to stand still to use. The sound now lives in musicSource, a module with no
 * component attached, and this dock is only a window onto it. Exactly the arrangement voiceSession
 * and CallDock already use, and for the same reason: a call that ended when you clicked a link
 * would be useless too.
 *
 * So this renders nothing unless something is actually playing. It is not a music player you open;
 * it is the handle on a thing already happening, which is why it has a stop button and no start.
 */
export function AudioDock({ onOpen }: { onOpen: () => void }) {
  const [, bump] = useState(0)
  const [vol, setVol] = useState(() => volume('music'))

  // musicSource is a plain module, so it announces changes rather than being subscribed to by
  // React — same shape as the mixer and the tap registry
  useEffect(() => onMusicChange(() => bump((n) => n + 1)), [])
  useEffect(() => onMixerChange(() => setVol(volume('music'))), [])

  // an <audio> element's play/pause can be changed from outside this component (or by the OS
  // media keys), so track the element rather than assuming our own button is the only cause
  const el = musicEl()
  useEffect(() => {
    if (!el) return
    const on = () => bump((n) => n + 1)
    el.addEventListener('play', on)
    el.addEventListener('pause', on)
    el.addEventListener('ended', on)
    return () => {
      el.removeEventListener('play', on)
      el.removeEventListener('pause', on)
      el.removeEventListener('ended', on)
    }
  }, [el])

  const track = musicName()
  const sharing = sharedOn()
  if (!track && !sharing) return null

  const paused = el?.paused ?? true

  return (
    <div className="audio-dock" role="status" aria-live="polite">
      <button
        className="audio-dock-name"
        onClick={onOpen}
        title="Open the visualiser"
        aria-label={`Open the visualiser — playing ${track || 'tab audio'}`}
      >
        <span aria-hidden>{sharing && !track ? '🖥️' : '🎵'}</span>
        <span className="audio-dock-title">{track || 'Tab audio'}</span>
      </button>

      {el && (
        <button
          className="btn audio-dock-btn"
          onClick={() => {
            if (el.paused) void el.play().catch(() => {})
            else el.pause()
            bump((n) => n + 1)
          }}
          aria-label={paused ? 'Play' : 'Pause'}
          title={paused ? 'Play' : 'Pause'}
        >
          {paused ? '▶' : '⏸'}
        </button>
      )}

      {/* the level that follows you around too — turning music down should not need the page
          that started it */}
      <input
        className="audio-dock-vol"
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={vol}
        onChange={(e) => {
          const v = Number(e.target.value)
          setVol(v)
          setVolume('music', v)
        }}
        aria-label="Music volume"
        title={`Volume ${Math.round(vol * 100)}%`}
      />

      <button
        className="btn audio-dock-btn"
        onClick={() => {
          if (track) stopMusic()
          if (sharing) stopShared()
        }}
        aria-label="Stop"
        title="Stop"
      >
        ⏹
      </button>
    </div>
  )
}
