import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import {
  TAPS,
  binCount,
  fftSize,
  liveTaps,
  readSpectrum,
  readWaveform,
  subscribeTaps,
  type TapId,
} from '../audio/audioTap'
import { localMicOn, startLocalMic, stopLocalMic } from '../audio/localMic'
import { playCallSound } from '../voice/ringtone'
import { VISUALS, clearsEachFrame, makeVisual, type Ink, type VisualId } from '../audio/visualModes'
import { motionReduced, onMotionChange } from '../ui/motion'

/**
 * A window that shows you the sound.
 *
 * Built like the Snake canvas — a section that is equally at home as a full page or as one window
 * on the circuit canvas, sizing itself to whatever box it is given rather than to the viewport.
 * That is the whole reason it observes its host instead of listening for window resizes.
 *
 * ⚠️ It never opens an audio graph of its own except for the mic button, and that one is
 * explicitly asked for. Everything else is read from analysers the call and the ringtone already
 * had (see audioTap.ts) — so having this window open during a call costs a read per frame, not a
 * second copy of the audio pipeline.
 *
 * Sources come and go on their own: a call starting publishes two, hanging up removes them. The
 * picker subscribes rather than snapshotting, so a source appearing mid-frame becomes selectable
 * without a refresh — the failure this site has already been bitten by twice.
 */

const MODE_KEY = 'viz_mode_v1'
const SRC_KEY = 'viz_src_v1'
const GAIN_KEY = 'viz_gain_v1'

function readStored<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key)
    return allowed.includes(v as T) ? (v as T) : fallback
  } catch {
    return fallback
  }
}

const VISUAL_IDS = VISUALS.map(([id]) => id)
const TAP_IDS = TAPS.map((t) => t.id)

export function AudioVisualizer() {
  const host = useRef<HTMLDivElement>(null)
  const canvas = useRef<HTMLCanvasElement>(null)

  const [mode, setMode] = useState<VisualId>(() => readStored(MODE_KEY, VISUAL_IDS, 'bars'))
  const [src, setSrc] = useState<TapId>(() => readStored(SRC_KEY, TAP_IDS, 'local'))
  const [gain, setGain] = useState(() => {
    const v = Number(localStorage.getItem(GAIN_KEY))
    return Number.isFinite(v) && v >= 0.5 && v <= 4 ? v : 1.5
  })
  const [micBusy, setMicBusy] = useState(false)
  // mirrored into state rather than read from the module during render: localMicOn() is not a
  // store React can subscribe to, so a bare call would render the stale answer after a toggle
  const [micOn, setMicOn] = useState(localMicOn)
  const [micDenied, setMicDenied] = useState(false)

  // Which sources exist RIGHT NOW. A snapshot taken on mount would be wrong the moment a call
  // starts, and the picker would offer nothing until you navigated away and back.
  const live = useSyncExternalStore(
    subscribeTaps,
    useCallback(() => liveTaps().join(','), []),
    useCallback(() => '', []),
  )
  const liveSet = live ? live.split(',') : []

  // State, not a bare call: the switch has to reach a running canvas, and reading the preference
  // once at mount is exactly why turning reduce-motion back off used to need a refresh.
  const [reduced, setReduced] = useState(motionReduced)
  useEffect(() => onMotionChange(() => setReduced(motionReduced())), [])

  useEffect(() => {
    try {
      localStorage.setItem(MODE_KEY, mode)
      localStorage.setItem(SRC_KEY, src)
      localStorage.setItem(GAIN_KEY, String(gain))
    } catch {
      /* private mode — the choice still holds for this visit */
    }
  }, [mode, src, gain])

  // The mic is a device, not a render: it must survive re-renders and must be released when the
  // window closes, or the browser's recording indicator stays on with nothing watching it.
  useEffect(() => () => stopLocalMic(), [])

  useEffect(() => {
    if (reduced) return
    const box = host.current
    const cv = canvas.current
    if (!box || !cv) return
    const ctx = cv.getContext('2d')
    if (!ctx) return

    const visual = makeVisual(mode)
    const wipe = clearsEachFrame(mode)
    let w = 0
    let h = 0
    let raf = 0
    let last = performance.now()
    let onScreen = true
    let visible = document.visibilityState === 'visible'
    let smoothed = 0

    // Allocated once per mount, not per frame. Sized for the largest analyser any source uses
    // (2048 from the local mic), so a source switch never needs a new buffer.
    const spec = new Uint8Array(2048)
    const wav = new Uint8Array(2048)

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
    // read off the canvas rather than the document root, so a window wearing somebody else's
    // look draws in THEIR colours
    let ink = readInk()

    const resize = () => {
      const r = box.getBoundingClientRect()
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      w = Math.max(1, Math.round(r.width))
      h = Math.max(1, Math.round(r.height))
      cv.width = Math.round(w * dpr)
      cv.height = Math.round(h * dpr)
      cv.style.width = w + 'px'
      cv.style.height = h + 'px'
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ink = readInk()
      visual.init(w, h)
    }

    const frame = (now: number) => {
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000))
      last = now
      const bins = Math.min(spec.length, binCount(src))
      const waveN = Math.min(wav.length, fftSize(src))
      const gotSpec = readSpectrum(src, spec)
      const gotWave = readWaveform(src, wav)
      if (!gotSpec) spec.fill(0)
      if (!gotWave) wav.fill(128)
      // sensitivity is applied to the DATA, not to the drawing: a mode that scaled its own
      // heights would have to be trusted to do it the same way as the other three
      if (gain !== 1 && gotSpec) {
        for (let i = 0; i < bins; i++) spec[i] = Math.min(255, spec[i] * gain)
      }
      if (gain !== 1 && gotWave) {
        for (let i = 0; i < waveN; i++) {
          wav[i] = Math.max(0, Math.min(255, 128 + (wav[i] - 128) * gain))
        }
      }
      /**
       * Loudness measured from the buffer we already have.
       *
       * ⚠️ NOT readLevel(), which fills the buffer you hand it — calling it here would
       * overwrite the sensitivity-scaled waveform a line above with raw samples, and the Wave
       * mode would silently ignore its own slider. Same RMS, no second read.
       */
      let sum = 0
      for (let i = 0; i < waveN; i++) {
        const v = (wav[i] - 128) / 128
        sum += v * v
      }
      const raw = Math.sqrt(sum / Math.max(1, waveN)) * 2.5
      // one-pole smoothing so a single loud frame doesn't make the whole figure jump
      smoothed += (Math.min(1, raw) - smoothed) * Math.min(1, dt * 8)

      if (wipe) ctx.clearRect(0, 0, w, h)
      visual.draw({
        ctx,
        w,
        h,
        dt,
        spec,
        bins: Math.max(1, bins),
        wave: wav,
        waveN: Math.max(2, waveN),
        level: smoothed,
        ink,
      })
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
    // A visualiser scrolled off screen or on a hidden tab is a rAF loop reading an analyser for
    // nobody. Both observers exist to make that cost zero rather than small.
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

    resize()
    start()
    return () => {
      stop()
      ro.disconnect()
      io.disconnect()
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [mode, src, gain, reduced])

  return (
    <section className="viz-wrap">
      <div className="viz-stage" ref={host}>
        <canvas ref={canvas} className="viz-canvas" aria-hidden />
        {reduced && (
          <p className="viz-still muted">
            Paused — animations are off. Turn Reduce motion off in the ⚙ menu to watch it move.
          </p>
        )}
        {/* Not an error: no sound is the ordinary state, and the window should say what would
            make something appear rather than sit there looking broken. */}
        {!reduced && !liveSet.includes(src) && (
          <p className="viz-still muted">
            Nothing on <strong>{TAPS.find((t) => t.id === src)?.label}</strong> yet.
            {src === 'local'
              ? ' Turn the mic on below.'
              : src === 'ring'
                ? ' Try the ringtone below.'
                : ' Join a call and it will appear here.'}
          </p>
        )}
      </div>

      <div className="viz-controls">
        <div className="viz-row" role="group" aria-label="Visual style">
          {VISUALS.map(([id, icon, label]) => (
            <button
              key={id}
              className={'fx-style-btn' + (mode === id ? ' is-on' : '')}
              aria-pressed={mode === id}
              onClick={() => setMode(id)}
            >
              <span aria-hidden>{icon}</span>
              <span className="fx-style-label">{label}</span>
            </button>
          ))}
        </div>

        <div className="viz-row" role="group" aria-label="Sound source">
          {TAPS.map((t) => {
            const on = liveSet.includes(t.id)
            return (
              <button
                key={t.id}
                className={'fx-style-btn viz-src' + (src === t.id ? ' is-on' : '')}
                aria-pressed={src === t.id}
                onClick={() => setSrc(t.id)}
                // a source with nothing on it stays clickable — picking it is how you say what
                // you want to watch when it starts
                title={on ? 'Live now' : 'Nothing playing'}
              >
                <span className={'viz-dot' + (on ? ' is-live' : '')} aria-hidden />
                <span className="fx-style-label">{t.label}</span>
              </button>
            )
          })}
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

          <button
            className="btn"
            aria-pressed={micOn}
            disabled={micBusy}
            onClick={async () => {
              if (micOn) {
                stopLocalMic()
                setMicOn(false)
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

        {micDenied && (
          <p className="muted viz-note">
            No microphone — the browser said no, or there isn’t one. Nothing was recorded either
            way.
          </p>
        )}
        <p className="muted viz-note">
          Nothing here is recorded or sent anywhere. The mic is read on this device and thrown away
          frame by frame.
        </p>
      </div>
    </section>
  )
}
