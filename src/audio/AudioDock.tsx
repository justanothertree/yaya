import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { musicEl, musicName, sharedOn, stopMusic, stopShared, onMusicChange } from './musicSource'
import { onMixerChange, setVolume, volume } from './mixer'
import { songPlayerState, stopSong, subscribeSongPlayer } from './songPlayer'

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
  /**
   * ⚠️ A SONG ON A PROFILE COUNTS AS SOMETHING PLAYING. The dock watched the <audio>
   * element and the shared tab, which are two of the three ways this site makes noise — the
   * third is the synth, which is what a profile's song block uses. So a page could be playing
   * music at you with nothing anywhere to pause it except the block itself, and the block might
   * be a long way up the page or on a tab you have left.
   */
  const song = useSyncExternalStore(subscribeSongPlayer, songPlayerState, songPlayerState)
  const [instVol, setInstVol] = useState(() => volume('instrument'))

  /**
   * ⚠️ WHERE THE DOCK SITS, if somebody has moved it. It is fixed above the mobile bar by
   * default, which is the right place until it is over the one thing you are looking at — and
   * since it follows you between pages, "the wrong place" is different on every one of them.
   *
   * Pointer events rather than HTML5 drag: this is moving an object, not transferring data, and
   * a drag image ghosting across the screen is the wrong feedback entirely. Kept between visits,
   * and clamped on read, because a window that was wide when it was saved may be narrow now and
   * a dock stranded off-screen has no way back.
   */
  const [spot, setSpot] = useState<{ x: number; y: number } | null>(() => {
    try {
      const raw = localStorage.getItem('audio_dock_at')
      if (!raw) return null
      const v = JSON.parse(raw) as { x: number; y: number }
      return typeof v?.x === 'number' && typeof v?.y === 'number' ? v : null
    } catch {
      return null
    }
  })
  const dock = useRef<HTMLDivElement>(null)
  const startMove = (e: React.PointerEvent) => {
    const box = dock.current?.getBoundingClientRect()
    if (!box) return
    e.preventDefault()
    const dx = e.clientX - box.left
    const dy = e.clientY - box.top
    const move = (ev: PointerEvent) => {
      const w = dock.current?.offsetWidth ?? 240
      const h = dock.current?.offsetHeight ?? 44
      setSpot({
        x: Math.max(4, Math.min(window.innerWidth - w - 4, ev.clientX - dx)),
        y: Math.max(4, Math.min(window.innerHeight - h - 4, ev.clientY - dy)),
      })
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      setSpot((cur) => {
        try {
          if (cur) localStorage.setItem('audio_dock_at', JSON.stringify(cur))
        } catch {
          /* private mode: it holds for this visit */
        }
        return cur
      })
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  /* ⚠️ clamped on every render, not only on drop: the window can be resized between visits */
  const placed = spot
    ? {
        x: Math.max(4, Math.min(window.innerWidth - 120, spot.x)),
        y: Math.max(4, Math.min(window.innerHeight - 44, spot.y)),
      }
    : null
  const dockProps = {
    ref: dock,
    className: 'audio-dock' + (placed ? ' is-placed' : ''),
    style: placed
      ? ({ ['--dock-x']: placed.x + 'px', ['--dock-y']: placed.y + 'px' } as React.CSSProperties)
      : undefined,
  }
  const handle = (
    <span
      className="audio-dock-move"
      onPointerDown={startMove}
      role="button"
      tabIndex={-1}
      aria-label="Move this player"
      title="Drag me somewhere else"
    >
      ⠿
    </span>
  )
  useEffect(() => onMixerChange(() => setInstVol(volume('instrument'))), [])

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
  const playingSong = song.playing != null
  if (!track && !sharing && !playingSong) return null

  /**
   * ⚠️ The SONG takes the dock when one is playing, because it is the thing the visitor
   * did not start and most wants a handle on. The music player and a shared tab are both
   * something you turned on yourself and can turn off where you turned it on; a profile's song
   * begins on its own.
   */
  if (playingSong && !track && !sharing)
    return (
      <div {...dockProps} role="status" aria-live="polite">
        {handle}
        <span className="audio-dock-name" aria-label="A song is playing">
          <span aria-hidden>🎹</span>
          <span className="audio-dock-title">Song on this page</span>
        </span>
        <button
          className="btn audio-dock-btn"
          onClick={() => stopSong()}
          aria-label="Stop the song"
          title="Stop"
        >
          ⏹
        </button>
        <input
          className="audio-dock-vol"
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={instVol}
          onChange={(e) => {
            const v = Number(e.target.value)
            setInstVol(v)
            setVolume('instrument', v)
          }}
          aria-label="Song volume"
          title={`Volume ${Math.round(instVol * 100)}%`}
        />
      </div>
    )

  const paused = el?.paused ?? true

  return (
    <div {...dockProps} role="status" aria-live="polite">
      {handle}
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
