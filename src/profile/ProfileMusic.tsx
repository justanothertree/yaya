import { useEffect, useRef, useSyncExternalStore } from 'react'
import { songNotes, type Song } from '../audio/songFile'
import { songPlayerState, subscribeSongPlayer, toggleSong, stopSong } from '../audio/songPlayer'
import { makeVisual, defaultTrail, VISUALS, type Ink, type VisualId } from '../audio/visualModes'
import { makeFeatureReader } from '../audio/audioFeatures'
import { paletteById } from '../audio/palettes'
import { binCount, fftSize, readSpectrum, readWaveform } from '../audio/audioTap'

/**
 * Somebody's music on their page, and something to watch while it plays.
 *
 * ⚠️ NOTHING IS HOSTED AND NOTHING IS EMBEDDED. A song here is the note events themselves, so
 * pressing play synthesises it in the visitor's own browser — no audio file, no upload, no CDN,
 * and no third party learning that somebody visited this page. That last part is why this is the
 * shape the profile got: an embed from a music service would put another company's scripts and
 * cookies in front of every visitor, which is a decision a profile owner cannot make on their
 * visitors' behalf.
 *
 * It also keeps the standing rule this block system was built on — every block is a fixed shape
 * the CLIENT renders from data, so there is no path from one person's config to another person's
 * markup, and no sanitiser to get wrong.
 */

export function SongBlock({ id, song }: { id: string; song: Song }) {
  const playing = useSyncExternalStore(subscribeSongPlayer, songPlayerState, songPlayerState)
  const isMe = playing.playing === id

  // leaving the page must not leave the song going — this is somebody else's tab
  useEffect(() => () => stopSong(), [])

  return (
    <div className="card profile-block profile-song">
      <button
        className={'btn profile-song-play' + (isMe ? ' is-on' : '')}
        onClick={() => toggleSong(id, song)}
        aria-pressed={isMe}
        title={isMe ? 'Stop' : 'Play this'}
      >
        {isMe ? '⏹' : '▶'}
      </button>
      <span className="profile-song-name">{song.name}</span>
      <span className="muted profile-song-meta">
        {song.layers.length} layer{song.layers.length === 1 ? '' : 's'} · {songNotes(song)} notes ·{' '}
        {song.bpm}bpm
      </span>
      <span className="muted profile-song-note">played by your browser, not streamed</span>
    </div>
  )
}

/**
 * A visualiser somebody chose, watching whatever the page is playing.
 *
 * ⚠️ It reads the `instrument` tap, which is where the song player's own output already lands —
 * so the two blocks need nothing wired between them. Put a song block and one of these on a
 * profile and pressing play makes the picture move, because they are looking at the same synth.
 *
 * ⚠️ The loop stops dead when there is no sound and when the tab is hidden. A profile is not the
 * visualiser page; nobody came here to have a canvas repaint sixty times a second behind a bio,
 * and a decorative animation that runs while a laptop is on battery in a background tab is a rude
 * thing to ship.
 */
export function VisualBlock({ cfg }: { cfg: Record<string, unknown> }) {
  const box = useRef<HTMLDivElement>(null)
  const cv = useRef<HTMLCanvasElement>(null)

  const modeId = (
    typeof cfg.mode === 'string' && VISUALS.some(([id]) => id === cfg.mode) ? cfg.mode : 'bars'
  ) as VisualId
  const paletteId = typeof cfg.palette === 'string' ? cfg.palette : 'theme'

  useEffect(() => {
    const el = cv.current
    const host = box.current
    if (!el || !host) return
    const ctx = el.getContext('2d')
    if (!ctx) return

    const visual = makeVisual(modeId)
    const features = makeFeatureReader()
    const spec = new Uint8Array(2048)
    const wave = new Uint8Array(2048)
    const trail = defaultTrail(modeId)
    let w = 0
    let h = 0
    let dpr = 1
    let raf = 0
    let last = performance.now()
    let quiet = 0

    const ink = (): Ink => {
      const s = getComputedStyle(el)
      const read = (name: string, fallback: [number, number, number]) => {
        const m = /^#?([0-9a-f]{6})$/i.exec(s.getPropertyValue(name).trim())
        if (!m) return fallback
        const n = parseInt(m[1], 16)
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255] as [number, number, number]
      }
      return {
        accent: read('--accent', [34, 197, 94]),
        accent2: read('--accent-2', [239, 68, 68]),
        ink: read('--text', [238, 238, 248]),
        stops: paletteById(paletteId).stops,
      }
    }
    let paint = ink()

    const resize = () => {
      const r = host.getBoundingClientRect()
      if (r.width < 1) return
      dpr = Math.min(window.devicePixelRatio || 1, 2)
      w = Math.round(r.width)
      h = Math.round(r.height)
      el.width = Math.round(w * dpr)
      el.height = Math.round(h * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      paint = ink()
      visual.init(w, h)
    }
    resize()

    const pointer = {
      x: 0,
      y: 0,
      inside: false,
      vx: 0,
      vy: 0,
      down: false,
      sinceClick: 99,
      clickX: 0,
      clickY: 0,
    }

    const frame = (now: number) => {
      raf = requestAnimationFrame(frame)
      // same per-frame size check as the visualiser: an observer that never fires leaves a canvas
      // sized for a box that no longer exists, and nothing to notice it
      const r = host.getBoundingClientRect()
      if (r.width >= 1 && Math.abs(r.width - w) > 0.5) resize()
      if (w < 1 || h < 1) return

      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000))
      last = now

      const bins = Math.min(spec.length, binCount('instrument'))
      const got = readSpectrum('instrument', spec)
      const gotW = readWaveform('instrument', wave)
      if (!got) spec.fill(0)
      if (!gotW) wave.fill(128)

      let sum = 0
      const n = Math.min(wave.length, fftSize('instrument'))
      for (let i = 0; i < n; i++) {
        const v = (wave[i] - 128) / 128
        sum += v * v
      }
      const rms = Math.sqrt(sum / Math.max(1, n)) * 2.5

      /**
       * ⚠️ Stop drawing when nothing is playing.
       *
       * Held for a moment rather than cut instantly, so a trail can finish rather than freezing
       * mid-smear — but a silent page settles to a still canvas within a second and stops costing
       * anything.
       */
      quiet = rms > 0.005 ? 0 : quiet + dt
      if (quiet > 1.2) return

      const f = features.read(spec, Math.max(1, bins), rms, dt)
      ctx.globalCompositeOperation = 'destination-out'
      ctx.fillStyle = `rgba(0,0,0,${1 - Math.max(0, Math.min(0.97, trail))})`
      ctx.fillRect(0, 0, w, h)
      ctx.globalCompositeOperation = 'source-over'
      visual.draw({
        ctx,
        w,
        h,
        dt,
        spec,
        bins: Math.max(1, bins),
        wave,
        waveN: Math.max(2, n),
        f,
        p: pointer,
        ink: paint,
      })
    }

    const start = () => {
      if (!raf && document.visibilityState === 'visible') {
        last = performance.now()
        quiet = 0
        raf = requestAnimationFrame(frame)
      }
    }
    const stop = () => {
      if (raf) cancelAnimationFrame(raf)
      raf = 0
    }
    const onVis = () => (document.visibilityState === 'visible' ? start() : stop())
    document.addEventListener('visibilitychange', onVis)

    // the song player is what wakes it up: subscribing means a silent page never spins the loop
    const offPlayer = subscribeSongPlayer(() => start())
    start()

    return () => {
      stop()
      document.removeEventListener('visibilitychange', onVis)
      offPlayer()
    }
  }, [modeId, paletteId])

  return (
    <div className="card profile-block profile-visual" ref={box}>
      <canvas ref={cv} aria-hidden />
    </div>
  )
}
