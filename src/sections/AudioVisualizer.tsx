import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import {
  TAPS,
  binCount,
  fftSize,
  liveTaps,
  readSpectrum,
  readSpectrumAll,
  readWaveform,
  readWaveformAll,
  binCountAll,
  fftSizeAll,
  subscribeTaps,
  type TapId,
} from '../audio/audioTap'
import { localMicOn, monitorOn, setMonitor, startLocalMic, stopLocalMic } from '../audio/localMic'
import { playCallSound } from '../voice/ringtone'
import {
  VISUALS,
  defaultTrail,
  makeVisual,
  ownsItsBuffer,
  type Ink,
  type VisualId,
} from '../audio/visualModes'
import { makeFeatureReader } from '../audio/audioFeatures'
import { motionReduced, onMotionChange } from '../ui/motion'
import {
  musicName,
  playFile,
  sharedOn,
  shareTabAudio,
  stopMusic,
  stopShared,
} from '../audio/musicSource'
import { onMixerChange, setVolume, volume, type Channel } from '../audio/mixer'
import { announceVizPrefs } from '../profile/audioBackdrop'

/**
 * A window that shows you the sound.
 *
 * ⚠️ THE PICTURE IS THE POINT, so it gets the room. This started as a modest canvas over a block
 * of controls, which is the shape of a settings page rather than of something you want to watch.
 * The stage now takes the whole pane and the controls collapse out of the way entirely; there is
 * a fullscreen button because the honest end state of "make the visuals the star" is nothing on
 * screen but the visuals.
 *
 * It never opens an audio graph of its own except for the mic button, which is explicitly asked
 * for. Everything else is read from analysers the call and the ringtone already had — see
 * audioTap.ts. Sources come and go on their own, and the picker subscribes rather than
 * snapshotting, so a call starting mid-frame becomes selectable without a refresh.
 *
 * TWO TOOLS APPLY TO EVERY MODE, which is what stops sixteen modes being sixteen private
 * implementations of the same ideas:
 *
 *   · Trails. Modes draw into an offscreen buffer that is only PARTLY erased each frame, so a
 *     line becomes a smear and a particle becomes a comet. Each mode ships a default, because the
 *     right amount is a property of the drawing (Nebula is nothing without it; Bars is unreadable
 *     with it) — but it is a dial, so any mode can be pushed somewhere its author didn't intend.
 *   · Mirror. The buffer is composited into N kaleidoscope wedges. Sixteen modes times six
 *     symmetries is a lot of pictures for one extra blit per wedge.
 */

const MODE_KEY = 'viz_mode_v1'
const SRC_KEY = 'viz_src_v1'
const GAIN_KEY = 'viz_gain_v1'
const PANEL_KEY = 'viz_panel_v1'
const MIRROR_KEY = 'viz_mirror_v1'

const MIRRORS: Array<[number, string]> = [
  [1, 'Off'],
  [2, '2'],
  [3, '3'],
  [4, '4'],
  [6, '6'],
  [8, '8'],
]

function readStored<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key)
    return allowed.includes(v as T) ? (v as T) : fallback
  } catch {
    return fallback
  }
}

const VISUAL_IDS = VISUALS.map(([id]) => id)

/**
 * "All" is a source you can pick, but not a tap that exists.
 *
 * ⚠️ Kept as a separate union rather than added to TapId, because everywhere else in the
 * codebase a TapId names one real analyser somebody registered. Letting a fictional id into that
 * type would mean every consumer — the backdrop, the readers, a future instrument room — has to
 * remember it is not real.
 */
const ALL = 'all' as const
type SrcChoice = TapId | typeof ALL
const TAP_IDS = [ALL, ...TAPS.map((t) => t.id)] as SrcChoice[]

/**
 * One output level.
 *
 * Subscribes to the mixer rather than owning the number, so a level changed anywhere — here, or
 * later from an instrument room or a call — shows up on every slider that displays it.
 */
function VolumeRow({ c, label }: { c: Channel; label: string }) {
  const [v, setV] = useState(() => volume(c))
  useEffect(() => onMixerChange(() => setV(volume(c))), [c])
  return (
    <label className="appearance-slider">
      <span className="muted">{label}</span>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={v}
        onChange={(e) => {
          const next = Number(e.target.value)
          setV(next)
          setVolume(c, next)
        }}
      />
      <span className="appearance-slider-val">{Math.round(v * 100)}%</span>
    </label>
  )
}

export function AudioVisualizer() {
  const host = useRef<HTMLDivElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)

  const [mode, setMode] = useState<VisualId>(() => readStored(MODE_KEY, VISUAL_IDS, 'bars'))
  const [src, setSrc] = useState<SrcChoice>(() => readStored(SRC_KEY, TAP_IDS, ALL))
  const [gain, setGain] = useState(() => {
    const v = Number(localStorage.getItem(GAIN_KEY))
    return Number.isFinite(v) && v >= 0.5 && v <= 4 ? v : 1.5
  })
  const [trail, setTrail] = useState(() => defaultTrail(readStored(MODE_KEY, VISUAL_IDS, 'bars')))
  const [mirror, setMirror] = useState(() => {
    const v = Number(localStorage.getItem(MIRROR_KEY))
    return MIRRORS.some(([n]) => n === v) ? v : 1
  })
  const [panel, setPanel] = useState(() => {
    try {
      return localStorage.getItem(PANEL_KEY) !== '0'
    } catch {
      return true
    }
  })
  const [full, setFull] = useState(false)
  const [micBusy, setMicBusy] = useState(false)
  const [micOn, setMicOn] = useState(localMicOn)
  const [micDenied, setMicDenied] = useState(false)
  // ⚠️ Never restored from storage: a playback-of-your-own-mic setting that came back on by
  // itself would greet somebody with feedback on load.
  const [hearing, setHearing] = useState(monitorOn)
  const [track, setTrack] = useState('')
  const [sharing, setSharing] = useState(sharedOn)
  const [srcErr, setSrcErr] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const filePick = useRef<HTMLInputElement>(null)

  /**
   * The pointer, kept in a REF rather than in state.
   *
   * ⚠️ A mousemove that called setState would re-render this component on every pixel of
   * movement, and the render tears down and rebuilds the whole animation effect — the visual
   * would restart continuously and never draw anything. The loop reads the ref instead, so the
   * pointer reaches the canvas without React ever hearing about it.
   */
  const ptr = useRef({
    x: 0,
    y: 0,
    inside: false,
    vx: 0,
    vy: 0,
    down: false,
    sinceClick: 99,
    clickX: 0,
    clickY: 0,
  })

  const live = useSyncExternalStore(
    subscribeTaps,
    useCallback(() => liveTaps().join(','), []),
    useCallback(() => '', []),
  )
  const liveSet = live ? live.split(',') : []

  const [reduced, setReduced] = useState(motionReduced)
  useEffect(() => onMotionChange(() => setReduced(motionReduced())), [])

  useEffect(() => {
    try {
      localStorage.setItem(MODE_KEY, mode)
      localStorage.setItem(SRC_KEY, src)
      localStorage.setItem(GAIN_KEY, String(gain))
      localStorage.setItem(MIRROR_KEY, String(mirror))
      localStorage.setItem(PANEL_KEY, panel ? '1' : '0')
    } catch {
      /* private mode — the choices still hold for this visit */
    }
    // the site background mirrors these, so tell it rather than making it poll localStorage
    announceVizPrefs()
  }, [mode, src, gain, mirror, panel])

  /**
   * ⚠️ Only the MICROPHONE is released on the way out.
   *
   * Music and tab audio deliberately keep playing: stopping them here is what made the player a
   * toy you had to stand still to use, and the AudioDock exists precisely so you can wander off
   * with the sound still going. The mic is different — it is a device with a recording
   * indicator, and leaving that burning because you clicked a link would be indefensible.
   */
  useEffect(
    () => () => {
      stopLocalMic()
    },
    [],
  )

  // fullscreen can also be left with Escape, which fires no click of ours — so track the browser
  // rather than assuming our own button is the only way out
  useEffect(() => {
    const onFs = () => setFull(document.fullscreenElement === stage.current)
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [])

  useEffect(() => {
    if (reduced) return
    const box = host.current
    const cv = canvas.current
    if (!box || !cv) return
    const view = cv.getContext('2d')
    if (!view) return

    /**
     * Modes draw HERE, not onto the visible canvas.
     *
     * ⚠️ The buffer is what makes trails and mirroring possible at all. Persistence needs a
     * surface that survives the frame, and a kaleidoscope needs to composite the drawing several
     * times — neither works if the mode paints straight onto the canvas the viewer sees.
     */
    const buf = document.createElement('canvas')
    const ctx = buf.getContext('2d')
    if (!ctx) return

    const visual = makeVisual(mode)
    const owns = ownsItsBuffer(mode)
    const features = makeFeatureReader()
    let w = 0
    let h = 0
    let raf = 0
    let last = performance.now()
    let onScreen = true
    let visible = document.visibilityState === 'visible'

    const spec = new Uint8Array(2048)
    const wav = new Uint8Array(2048)
    // a second buffer the mixer folds each source through, allocated once like the others
    const scratch = new Uint8Array(2048)

    const readInk = (): Ink => {
      const s = getComputedStyle(cv)
      const read = (name: string, fallback: [number, number, number]) => {
        const v = s.getPropertyValue(name).trim()
        const m = /^#?([0-9a-f]{6})$/i.exec(v)
        if (!m) return fallback
        const n = parseInt(m[1], 16)
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255] as [number, number, number]
      }
      return {
        accent: read('--accent', [34, 197, 94]),
        accent2: read('--accent-2', [239, 68, 68]),
        ink: read('--text', [238, 238, 248]),
      }
    }
    let ink = readInk()

    const resize = () => {
      const r = box.getBoundingClientRect()
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      w = Math.max(1, Math.round(r.width))
      h = Math.max(1, Math.round(r.height))
      for (const c of [cv, buf]) {
        c.width = Math.round(w * dpr)
        c.height = Math.round(h * dpr)
      }
      cv.style.width = w + 'px'
      cv.style.height = h + 'px'
      view.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ink = readInk()
      visual.init(w, h)
    }

    const frame = (now: number) => {
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000))
      last = now
      const all = src === ALL
      const bins = Math.min(spec.length, all ? binCountAll() : binCount(src))
      const waveN = Math.min(wav.length, all ? fftSizeAll() : fftSize(src))
      const gotSpec = all ? readSpectrumAll(spec, scratch) : readSpectrum(src, spec)
      const gotWave = all ? readWaveformAll(wav, scratch) : readWaveform(src, wav)
      if (!gotSpec) spec.fill(0)
      if (!gotWave) wav.fill(128)
      if (gain !== 1 && gotSpec) {
        for (let i = 0; i < bins; i++) spec[i] = Math.min(255, spec[i] * gain)
      }
      if (gain !== 1 && gotWave) {
        for (let i = 0; i < waveN; i++) {
          wav[i] = Math.max(0, Math.min(255, 128 + (wav[i] - 128) * gain))
        }
      }
      // RMS from the buffer we already have — see the note in audioTap.readLevel about why this
      // is not a second read
      let sum = 0
      for (let i = 0; i < waveN; i++) {
        const v = (wav[i] - 128) / 128
        sum += v * v
      }
      const rms = Math.sqrt(sum / Math.max(1, waveN)) * 2.5
      const f = features.read(spec, Math.max(1, bins), rms, dt)
      ptr.current.sinceClick += dt

      /**
       * Persistence: erase only PART of the last frame.
       *
       * destination-out with a partial alpha subtracts opacity rather than painting over, which
       * keeps the buffer genuinely transparent. Filling with a background colour instead would
       * look identical on a dark page and leave an opaque slab on a light one.
       */
      if (!owns) {
        const fade = 1 - Math.max(0, Math.min(0.97, trail))
        ctx.globalCompositeOperation = 'destination-out'
        ctx.fillStyle = `rgba(0,0,0,${fade})`
        ctx.fillRect(0, 0, w, h)
        ctx.globalCompositeOperation = 'source-over'
      }

      visual.draw({
        ctx,
        w,
        h,
        dt,
        spec,
        bins: Math.max(1, bins),
        wave: wav,
        waveN: Math.max(2, waveN),
        f,
        p: ptr.current,
        ink,
      })

      view.clearRect(0, 0, w, h)
      if (mirror <= 1) {
        view.drawImage(buf, 0, 0, w, h)
      } else {
        // Kaleidoscope: clip to a wedge, draw the whole buffer through it, repeat around the
        // circle. Alternate wedges are flipped so neighbouring edges meet rather than butting.
        const cx = w / 2
        const cy = h / 2
        const seg = (Math.PI * 2) / mirror
        const reach = Math.hypot(w, h)
        for (let i = 0; i < mirror; i++) {
          view.save()
          view.translate(cx, cy)
          view.rotate(i * seg)
          if (i % 2) view.scale(1, -1)
          view.beginPath()
          view.moveTo(0, 0)
          view.arc(0, 0, reach, -seg / 2, seg / 2)
          view.closePath()
          view.clip()
          view.translate(-cx, -cy)
          view.drawImage(buf, 0, 0, w, h)
          view.restore()
        }
      }
      raf = requestAnimationFrame(frame)
    }

    const start = () => {
      if (raf || !visible || !onScreen) return
      last = performance.now()
      raf = requestAnimationFrame(frame)
    }
    const stop = () => {
      if (!raf) return
      cancelAnimationFrame(raf)
      raf = 0
    }

    const ro = new ResizeObserver(() => resize())
    ro.observe(box)
    const io = new IntersectionObserver((es) => {
      onScreen = es.some((e) => e.isIntersecting)
      if (onScreen) start()
      else stop()
    })
    io.observe(box)
    const onVis = () => {
      visible = document.visibilityState === 'visible'
      if (visible) start()
      else stop()
    }
    document.addEventListener('visibilitychange', onVis)

    /**
     * Pointer, in the surface's own coordinates.
     *
     * Velocity is worked out here rather than in a mode, because it needs the time between two
     * real events — a mode only sees frames, and two frames can pass with no movement at all.
     */
    let lastMove = performance.now()
    const onMove = (e: PointerEvent) => {
      const r = box.getBoundingClientRect()
      const nx = e.clientX - r.left
      const ny = e.clientY - r.top
      const now = performance.now()
      const gap = Math.max(0.008, (now - lastMove) / 1000)
      lastMove = now
      const q = ptr.current
      q.vx = (nx - q.x) / gap
      q.vy = (ny - q.y) / gap
      q.x = nx
      q.y = ny
      q.inside = true
    }
    const onLeave = () => {
      ptr.current.inside = false
      ptr.current.vx = 0
      ptr.current.vy = 0
    }
    const onDown = (e: PointerEvent) => {
      const r = box.getBoundingClientRect()
      const q = ptr.current
      q.down = true
      q.sinceClick = 0
      q.clickX = e.clientX - r.left
      q.clickY = e.clientY - r.top
    }
    const onUp = () => {
      ptr.current.down = false
    }
    box.addEventListener('pointermove', onMove)
    box.addEventListener('pointerleave', onLeave)
    box.addEventListener('pointerdown', onDown)
    window.addEventListener('pointerup', onUp)

    resize()
    start()
    return () => {
      stop()
      ro.disconnect()
      io.disconnect()
      document.removeEventListener('visibilitychange', onVis)
      box.removeEventListener('pointermove', onMove)
      box.removeEventListener('pointerleave', onLeave)
      box.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointerup', onUp)
    }
  }, [mode, src, gain, reduced, trail, mirror])

  const pickMode = (id: VisualId) => {
    setMode(id)
    // each mode's own default, because the right amount of trail is a property of the drawing —
    // and it stays a dial, so this is a starting point rather than a decision
    setTrail(defaultTrail(id))
  }

  const goFull = () => {
    const el = stage.current
    if (!el) return
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
    else void el.requestFullscreen?.().catch(() => {})
  }

  const openFile = async (file: File | undefined) => {
    if (!file) return
    setSrcErr(null)
    const err = await playFile(file)
    if (err) {
      setSrcErr(err)
      setTrack('')
      return
    }
    setTrack(musicName())
    setSrc('music')
  }

  // "All" is live whenever anything is; a single source is live only if it is
  const nothingOn = src === ALL ? liveSet.length === 0 : !liveSet.includes(src)
  const srcLabel = src === ALL ? 'anything' : (TAPS.find((t) => t.id === src)?.label ?? src)

  return (
    <section className={'viz-wrap' + (panel ? '' : ' is-bare')}>
      <div
        className="viz-stage"
        ref={stage}
        data-full={full || undefined}
        onDragOver={(e) => {
          // preventDefault is what MAKES this a drop target; without it the browser navigates
          // away to the file instead, which loses the page
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
          if (!dragging) setDragging(true)
        }}
        onDragLeave={(e) => {
          if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
          setDragging(false)
        }}
        onDrop={(e) => {
          e.preventDefault()
          setDragging(false)
          void openFile(e.dataTransfer.files?.[0])
        }}
      >
        <div className="viz-surface" ref={host}>
          <canvas ref={canvas} className="viz-canvas" aria-hidden />
        </div>

        {reduced && (
          <p className="viz-still muted">
            Paused — animations are off. Turn Reduce motion off in the ⚙ menu to watch it move.
          </p>
        )}
        {!reduced && nothingOn && (
          <p className="viz-still muted">
            Nothing playing on <strong>{srcLabel}</strong> yet.
            {src === ALL
              ? ' Drop a track on this page, use your mic, or play the instrument.'
              : src === 'local'
                ? ' Turn the mic on below.'
                : src === 'ring'
                  ? ' Try the ringtone below.'
                  : src === 'music'
                    ? ' Drop a track anywhere on this page.'
                    : src === 'instrument'
                      ? ' Open the Instrument page and play something.'
                      : ' Join a call and it will appear here.'}
          </p>
        )}

        {/* Floating over the picture rather than below it, so hiding the panel gives the visuals
            the whole pane instead of leaving a gap where the controls were. */}
        <div className="viz-float">
          <button
            className="btn viz-icon"
            onClick={() => setPanel((p) => !p)}
            aria-expanded={panel}
            title={panel ? 'Hide the controls' : 'Show the controls'}
          >
            {panel ? '▾' : '▴'}
          </button>
          <button
            className="btn viz-icon"
            onClick={goFull}
            title={full ? 'Leave fullscreen' : 'Fullscreen'}
          >
            {full ? '⤡' : '⛶'}
          </button>
        </div>

        {/* Dropping a track anywhere on the picture loads it — the whole stage is the target,
            because aiming at a small strip is a worse experience than the feature is worth. */}
        {dragging && <div className="viz-drop">Drop a track to watch it</div>}

        {/* ⚠️ INSIDE the stage, not below it. Fullscreen shows one element and its
            descendants, so a control panel that is a SIBLING of the stage simply vanishes the
            moment you go fullscreen — which is exactly the state where you most want to change
            mode without leaving. In fullscreen the CSS floats this over the picture. */}
        {panel && (
          <div className="viz-controls">
            <div className="viz-modes" role="group" aria-label="Visual style">
              {VISUALS.map(([id, icon, label]) => (
                <button
                  key={id}
                  className={'fx-style-btn' + (mode === id ? ' is-on' : '')}
                  aria-pressed={mode === id}
                  onClick={() => pickMode(id)}
                >
                  <span aria-hidden>{icon}</span>
                  <span className="fx-style-label">{label}</span>
                </button>
              ))}
            </div>

            <div className="viz-row" role="group" aria-label="Sound source">
              {/* Everything at once, and the default. Most of the time the honest answer to
                  "what should this watch" is "whatever is making noise", and singling out one
                  source is the special case rather than the norm. */}
              <button
                className={'fx-style-btn viz-src' + (src === ALL ? ' is-on' : '')}
                aria-pressed={src === ALL}
                onClick={() => setSrc(ALL)}
                title={
                  liveSet.length
                    ? `Mixing ${liveSet.length} live source${liveSet.length > 1 ? 's' : ''}`
                    : 'Nothing playing yet'
                }
              >
                <span className={'viz-dot' + (liveSet.length ? ' is-live' : '')} aria-hidden />
                <span className="fx-style-label">
                  All{liveSet.length > 1 ? ` (${liveSet.length})` : ''}
                </span>
              </button>
              {TAPS.map((t) => {
                const on = liveSet.includes(t.id)
                return (
                  <button
                    key={t.id}
                    className={'fx-style-btn viz-src' + (src === t.id ? ' is-on' : '')}
                    aria-pressed={src === t.id}
                    onClick={() => setSrc(t.id)}
                    title={on ? 'Live now' : 'Nothing playing'}
                  >
                    <span className={'viz-dot' + (on ? ' is-live' : '')} aria-hidden />
                    <span className="fx-style-label">{t.label}</span>
                  </button>
                )
              })}
            </div>

            {/* Where a track comes from. Both routes end at the same tap, so every mode and every
              tool works on music with no further plumbing. */}
            <div className="viz-row viz-row-wide">
              <input
                ref={filePick}
                type="file"
                accept="audio/*"
                hidden
                onChange={(e) => {
                  void openFile(e.target.files?.[0])
                  // cleared so choosing the SAME file twice still fires a change event
                  e.target.value = ''
                }}
              />
              <button className="btn" onClick={() => filePick.current?.click()}>
                🎵 Open a track
              </button>
              {track && (
                <>
                  <span className="muted viz-track" title={track}>
                    {track}
                  </span>
                  <button
                    className="btn"
                    onClick={() => {
                      stopMusic()
                      setTrack('')
                    }}
                  >
                    ⏹ Stop
                  </button>
                </>
              )}
              <button
                className="btn"
                aria-pressed={sharing}
                onClick={async () => {
                  if (sharing) {
                    stopShared()
                    setSharing(false)
                    return
                  }
                  setSrcErr(null)
                  const err = await shareTabAudio()
                  if (err) {
                    setSrcErr(err)
                    return
                  }
                  if (sharedOn()) {
                    setSharing(true)
                    setSrc('shared')
                  }
                }}
                title="Watch what another tab is playing — Spotify, YouTube, anything"
              >
                {sharing ? '⏹ Stop tab audio' : '🖥️ Tab audio'}
              </button>
            </div>
            {srcErr && <p className="muted viz-note viz-warn">{srcErr}</p>}

            {/* ⚠️ These are OUTPUT levels and nothing else — see mixer.ts. They sit after the
              analyser branch, so turning the music down to a comfortable level does not shrink
              the picture, which is what a naive gain in the wrong place would do. */}
            <div className="viz-row viz-row-wide">
              <VolumeRow c="music" label="🎵 Music" />
              {micOn && hearing && <VolumeRow c="monitor" label="🎧 Yourself" />}
            </div>

            <div className="viz-row viz-row-wide">
              <label className="appearance-slider">
                <span className="muted">Sensitivity</span>
                <input
                  type="range"
                  min={0.5}
                  max={4}
                  step={0.1}
                  value={gain}
                  onChange={(e) => setGain(Number(e.target.value))}
                />
                <span className="appearance-slider-val">{gain.toFixed(1)}×</span>
              </label>
              <label className="appearance-slider">
                <span className="muted" title="How much of each frame lingers">
                  Trails
                </span>
                <input
                  type="range"
                  min={0}
                  max={0.97}
                  step={0.01}
                  value={trail}
                  onChange={(e) => setTrail(Number(e.target.value))}
                />
                <span className="appearance-slider-val">{Math.round(trail * 100)}%</span>
              </label>
            </div>

            <div className="viz-row viz-row-wide">
              <span className="muted viz-tool-label">Mirror</span>
              <div className="viz-mirrors">
                {MIRRORS.map(([n, label]) => (
                  <button
                    key={n}
                    className={'btn' + (mirror === n ? ' is-on' : '')}
                    aria-pressed={mirror === n}
                    data-active={mirror === n || undefined}
                    onClick={() => setMirror(n)}
                    title={n === 1 ? 'No symmetry' : `${n}-fold kaleidoscope`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <button
                className="btn"
                aria-pressed={micOn}
                disabled={micBusy}
                onClick={async () => {
                  if (micOn) {
                    stopLocalMic()
                    setMicOn(false)
                    setHearing(false)
                    setMicDenied(false)
                    return
                  }
                  setMicBusy(true)
                  const ok = await startLocalMic()
                  setMicBusy(false)
                  setMicOn(ok)
                  setMicDenied(!ok)
                  if (ok) setSrc('local')
                }}
              >
                {micOn ? '⏹ Stop mic' : micBusy ? 'Asking…' : '🎙 Use my mic'}
              </button>

              {micOn && (
                <button
                  className="btn"
                  aria-pressed={hearing}
                  onClick={() => {
                    const next = !hearing
                    setMonitor(next)
                    setHearing(next)
                  }}
                  title={hearing ? 'Stop playing your mic back' : 'Play your mic back to hear it'}
                >
                  {hearing ? '🔇 Stop listening' : '🎧 Hear myself'}
                </button>
              )}

              <button
                className="btn"
                onClick={() => {
                  setSrc('ring')
                  playCallSound('ring')
                }}
              >
                🔔 Ringtone
              </button>
            </div>

            {hearing && (
              <p className="muted viz-note viz-warn">
                ⚠️ Headphones — on speakers your mic will hear itself and start to howl.
              </p>
            )}
            {micDenied && (
              <p className="muted viz-note">
                No microphone — the browser said no, or there isn’t one. Nothing was recorded either
                way.
              </p>
            )}
            <p className="muted viz-note">
              Nothing is recorded or uploaded. A dropped file is played from your own disk, and the
              mic is read on this device and thrown away frame by frame.
            </p>
          </div>
        )}
      </div>
    </section>
  )
}
