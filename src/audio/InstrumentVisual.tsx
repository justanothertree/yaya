// The visualiser's own modes, beside the keys you are playing.
//
// ⚠️ THE SCOPE ANSWERS A DIFFERENT QUESTION, and both are worth having. InstrumentScope tells you
// what a patch is doing — where the energy sits, whether a note released — and says in its own
// header that the decorative modes could never do that. True, and it cut the wrong way: the
// decorative ones are the reason people open the visualiser at all, and watching one react to
// something you are playing yourself is better than watching it react to a file. Answering "what
// does this patch do" and "this looks amazing" are not the same want, and the room had only the
// first.
//
// ⚠️ IT DID NOT NEED THE VISUALISER'S 600 LINES. That header also says reusing a mode means
// inheriting AudioVisualizer's frame governor, art baking, DPR handling and the rest. Most of
// that is not what a Frame needs: it is what the ROOM needs — presets, mirrors, 3D, recording,
// a picker over thirty modes, a drawing to rasterise. A Frame is the canvas, the spectrum, the
// waveform, features, the pointer and the ink. Assembled here in about fifty lines, and the
// modes never know the difference.
//
// ⚠️ NOTHING RUNS UNTIL THE SYNTH EXISTS, and nothing runs off screen. No tap, no timers at
// all; a tap but scrolled past or the tab hidden, no frames. Verified rather than assumed: with
// the panel above the fold it draws, and with it at top:-386 it does not.
//
// It does NOT stop on silence, and that is deliberate rather than an oversight. Parking the loop
// between notes would mean the first frame after a keypress is also the frame that has to resize,
// rebuild the mode and refill the feature history — so the attack you actually wanted to watch is
// the one it misses. Once you are looking at it you are about to play something.
import { useCallback, useEffect, useRef, useState } from 'react'
import { readSpectrum, readWaveform, subscribeTaps, tapFormat } from './audioTap'
import { makeFeatureReader } from './audioFeatures'
import { readInk } from './ink'
import {
  VISUALS,
  defaultTrail,
  makeVisual,
  ownsItsBuffer,
  type Pointer,
  type VisualId,
} from './visualModes'

const TAP = 'instrument' as const
const MODE_KEY = 'inst_visual_v1'
/** the visualiser room's own palette choice, so the two surfaces agree without a second setting */
const PALETTE_KEY = 'viz_palette_v1'

/**
 * ⚠️ EVERY MODE EXCEPT "Your art", which is the one that cannot work here. It draws a rasterised
 * copy of your paint-room picture, and baking that is exactly the expensive machinery this panel
 * exists without. Offering it and drawing nothing would be worse than not offering it.
 */
const MODES = VISUALS.filter(([id]) => id !== 'art')
const isMode = (v: string): v is VisualId => MODES.some(([id]) => id === v)

export function InstrumentVisual() {
  const wrap = useRef<HTMLDivElement | null>(null)
  const cv = useRef<HTMLCanvasElement | null>(null)
  const [mode, setMode] = useState<VisualId>(() => {
    try {
      const v = localStorage.getItem(MODE_KEY)
      if (v && isMode(v)) return v
    } catch {
      /* private window */
    }
    return 'warp'
  })
  const [live, setLive] = useState(false)

  const raf = useRef(0)
  const last = useRef(0)
  /** filled once and reused — a fresh array per frame is the classic visualiser stutter */
  const spec = useRef(new Uint8Array(2048))
  const wave = useRef(new Uint8Array(2048))
  const feat = useRef(makeFeatureReader())
  const visual = useRef<ReturnType<typeof makeVisual> | null>(null)
  const sized = useRef({ w: 0, h: 0 })
  const modeRef = useRef(mode)
  modeRef.current = mode
  const pointer = useRef<Pointer>({
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

  useEffect(() => {
    try {
      localStorage.setItem(MODE_KEY, mode)
    } catch {
      /* private window */
    }
    // a new mode gets a clean surface rather than inheriting the last one's trails
    visual.current = null
    const c = cv.current
    const g = c?.getContext('2d')
    if (c && g) g.clearRect(0, 0, c.width, c.height)
  }, [mode])

  /**
   * ⚠️ Size the BACKING STORE from the box, never the other way round. A canvas with no CSS size
   * lays out at its attribute size, so measuring the parent and multiplying by devicePixelRatio
   * grows the parent, which grows the canvas — the feedback loop the profile art block was caught
   * by. This one is absolutely positioned inside its wrapper, so its attributes cannot feed back.
   */
  const fit = useCallback(() => {
    const c = cv.current
    const box = wrap.current
    if (!c || !box) return false
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const w = Math.round(box.clientWidth)
    const h = Math.round(box.clientHeight)
    if (w < 8 || h < 8) return false
    const bw = Math.round(w * dpr)
    const bh = Math.round(h * dpr)
    if (c.width !== bw || c.height !== bh) {
      c.width = bw
      c.height = bh
      visual.current = null
    }
    const g = c.getContext('2d')
    if (!g) return false
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    sized.current = { w, h }
    return true
  }, [])

  const frame = useCallback(
    (now: number) => {
      const c = cv.current
      const g = c?.getContext('2d')
      if (!c || !g || !fit()) {
        raf.current = 0
        return
      }
      const dt = last.current ? Math.min(0.1, (now - last.current) / 1000) : 0.016
      last.current = now

      const fmt = tapFormat(TAP)
      const bins = fmt ? fmt.bins : 1024
      const gotSpec = readSpectrum(TAP, spec.current)
      readWaveform(TAP, wave.current)
      const waveN = fmt ? fmt.fftSize : 2048

      // rms straight off the waveform — the features reader wants loudness, not a band
      let sum = 0
      for (let i = 0; i < waveN; i++) {
        const v = (wave.current[i] - 128) / 128
        sum += v * v
      }
      const rms = Math.sqrt(sum / Math.max(1, waveN))

      const { w, h } = sized.current
      const id = modeRef.current
      if (!visual.current) {
        visual.current = makeVisual(id)
        visual.current.init(w, h)
      }

      /* ⚠️ Rain paints its own scrolling history and must never be faded by the host — the
         persistence pass would eat the spectrogram from underneath it. */
      if (!ownsItsBuffer(id)) {
        const keep = defaultTrail(id)
        g.globalCompositeOperation = 'source-over'
        g.fillStyle = `rgba(0,0,0,${1 - keep})`
        if (keep > 0) g.fillRect(0, 0, w, h)
        else g.clearRect(0, 0, w, h)
      }

      let paletteId = 'theme'
      try {
        paletteId = localStorage.getItem(PALETTE_KEY) || 'theme'
      } catch {
        /* private window */
      }
      visual.current.draw({
        ctx: g,
        w,
        h,
        dt,
        spec: spec.current,
        bins,
        wave: wave.current,
        waveN,
        f: feat.current.read(spec.current, bins, rms, dt),
        p: pointer.current,
        ink: readInk(c, paletteId),
        art: null,
      })
      pointer.current.sinceClick += dt

      if (gotSpec) {
        raf.current = requestAnimationFrame(frame)
      } else {
        raf.current = 0
        last.current = 0
      }
    },
    [fit],
  )

  /** start drawing, but only when there is something to draw and somewhere to draw it */
  useEffect(() => {
    let poll = 0
    const onScreen = () => {
      const el = wrap.current
      if (!el || document.hidden) return false
      const r = el.getBoundingClientRect()
      return r.bottom > 0 && r.top < (window.innerHeight || 0) && r.width > 0
    }
    const check = () => {
      const has = !!tapFormat(TAP)
      setLive(has)
      if (has && onScreen() && !raf.current) {
        last.current = 0
        raf.current = requestAnimationFrame(frame)
      }
      if ((!has || !onScreen()) && raf.current) {
        cancelAnimationFrame(raf.current)
        raf.current = 0
      }
    }
    check()
    const offTaps = subscribeTaps(check)
    /* the same belt-and-braces the snake board and the home visualiser use: a rect check on a
       timer, because IntersectionObserver has reported nothing at all in embedded views here */
    poll = window.setInterval(check, 1000)
    window.addEventListener('scroll', check, { passive: true })
    window.addEventListener('resize', check)
    document.addEventListener('visibilitychange', check)
    return () => {
      offTaps()
      window.clearInterval(poll)
      window.removeEventListener('scroll', check)
      window.removeEventListener('resize', check)
      document.removeEventListener('visibilitychange', check)
      cancelAnimationFrame(raf.current)
      raf.current = 0
    }
  }, [frame])

  const track = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const p = pointer.current
    const x = e.clientX - r.left
    const y = e.clientY - r.top
    p.vx = x - p.x
    p.vy = y - p.y
    p.x = x
    p.y = y
    p.inside = true
  }

  return (
    <div className="inst-visual">
      <div className="inst-visual-head">
        <span className="inst-visual-title">Watch it</span>
        <select
          className="inst-visual-pick"
          value={mode}
          onChange={(e) => setMode(e.target.value as VisualId)}
          title="Which visual to draw"
          aria-label="Visual mode"
        >
          {MODES.map(([id, emoji, label]) => (
            <option key={id} value={id}>
              {emoji} {label}
            </option>
          ))}
        </select>
      </div>
      <div className="inst-visual-stage" ref={wrap}>
        <canvas
          ref={cv}
          onPointerMove={track}
          onPointerLeave={() => {
            pointer.current.inside = false
          }}
          onPointerDown={(e) => {
            track(e)
            const p = pointer.current
            p.down = true
            p.sinceClick = 0
            p.clickX = p.x
            p.clickY = p.y
          }}
          onPointerUp={() => {
            pointer.current.down = false
          }}
          aria-hidden
        />
        {/* ⚠️ Says what to do rather than sitting black. An empty rectangle beside a keyboard
            reads as broken, and the thing that starts it is the one thing already under their
            hands. */}
        {!live && <span className="inst-visual-hint muted">play something</span>}
      </div>
    </div>
  )
}
