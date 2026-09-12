import { useCallback, useEffect, useRef, useState } from 'react'
import type { InstrumentId } from '../audio/synth'
import { hasTap, readSpectrum, subscribeTaps, tapFormat } from '../audio/audioTap'
import { onStopAll, withSynth } from './homeSynth'
import { TileArt } from './TileArt'

/**
 * The front page, wired to itself: this draws the sound the rest of the page is making.
 *
 * ⚠️ THE CAPTION USED TO BE A LIE. "That is what it does to a drum loop" pointed at an SVG with
 * CSS keyframes — five circles breathing on a timer, with no drum loop and no audio anywhere near
 * it. Every other claim on this page is checkable by pressing the thing beside it, so the one
 * ornament pretending to be a readout was the weakest sentence on the site.
 *
 * ⚠️ AND THE PIPE WAS ALREADY THERE. synth.ts publishes its analyser to the tap registry the
 * moment a note sounds — `registerTap('instrument', analyser)` — and audioTap exists precisely so
 * a consumer can read that without opening a second audio graph. Nothing was plugged into it from
 * here. So this costs no new context, no new node and no new data: it reads bins somebody else
 * already computed, in a frame it was going to draw anyway.
 *
 * ⚠️ WHICH MAKES THE PAGE ONE INSTRUMENT. The hero's keys and the sequencer feed this same tap,
 * so a line started at the top of the page is still moving this picture three sections down. That
 * is the argument the site makes about itself — the rooms are one app, not a menu of separate
 * things — and until now the front page demonstrated the opposite, with eight demos that had never
 * heard of each other.
 *
 * ⚠️ NOTHING RUNS UNTIL SOMETHING SOUNDS, and the cheap states are the common ones: with no synth
 * loaded there are no timers at all and the CSS art is what you see; once a tap exists an 8Hz poll
 * watches for signal; only actual sound starts a requestAnimationFrame. A visitor who presses
 * nothing pays exactly what they paid before this file existed.
 */

/** the tap every home toy feeds — see synth.ts registerTap */
const TAP = 'instrument' as const
/** readSpectrum refuses a short read, and the visualiser room reads this same tap at 2048 */
const BINS = 2048

/** mirrored columns per side */
const BANDS = 22
/**
 * ⚠️ LOG-SPACED, NOT LINEAR. A 2048-point FFT at 48kHz is a bin every 23.4Hz, so a linear sweep
 * spends four fifths of the picture on 5–20kHz, where music has almost nothing, and crushes every
 * note anybody actually played into the first two columns. These are the bins worth looking at:
 * roughly 45Hz to 7kHz.
 */
const LO_BIN = 2
const HI_BIN = 300

/** below this, across the whole range, the tile counts as silent */
const QUIET = 0.035
/** and it has to stay that way this long before the picture goes back to sleep */
const QUIET_FOR = 1400
/** how often to look for signal while nothing is playing */
const WATCH_MS = 125

/**
 * ⚠️ TIME-BASED DECAY, NOT PER-FRAME. A bar falling by a fixed fraction each frame falls twice as
 * fast on a 120Hz screen as on a 60Hz one — this repo has already been caught by that once, in the
 * scribble pad's fade. Halves in about 110ms on any display.
 */
const FALL = Math.LN2 / 0.11

/* ── the loop the button plays ──────────────────────────────────────────────
   ⚠️ REAL NOTES THROUGH THE REAL SYNTH, which is the whole point: the picture is drawn from the
   analyser, so a faked loop would draw nothing at all. The kit is synthesised (see hitDrum), so
   this ships no samples — midi % 12 picks the piece: 0 kick, 2 snare, 6 closed hat, 8 open hat. */
const KICK = 60
const SNARE = 62
const HAT = 66
const OPEN_HAT = 68
const DRUMS: InstrumentId = 'drums'
/** low enough to give the middle of the picture something to draw */
const BASS: InstrumentId = 'bass'

const STEPS = 16
/** 150ms a step is 100bpm in sixteenths — the same clock the sequencer upstairs runs on */
const STEP_MS = 150
/** one bar: kick and snare, with hats on the eighths */
const HITS: number[][] = [
  [KICK, HAT],
  [],
  [HAT],
  [KICK],
  [SNARE, HAT],
  [],
  [KICK, HAT],
  [],
  [HAT],
  [],
  [KICK, HAT],
  [],
  [SNARE, HAT],
  [],
  [HAT],
  [OPEN_HAT],
]
/** step → midi: C pentatonic roots walking under it */
const BASS_LINE: Record<number, number> = { 0: 36, 6: 36, 8: 43, 12: 40 }

/** its own part, so this never inherits whatever the instrument room was left set to */
const PART = 'home-viz'
const FX = { echo: 0.1, echoTime: 0.22, space: 0.24, vibrato: 0, glide: 0 }
const GAIN = 0.45
/**
 * ⚠️ IT STOPS ITSELF. A loop still going while somebody reads the rest of the page is the same
 * rudeness as autoplay, arriving late. Ten bars is long enough to watch the picture and short
 * enough that wandering off ends it.
 */
const LOOP_MAX = 24000

export function HomeViz() {
  const wrap = useRef<HTMLSpanElement | null>(null)
  const cv = useRef<HTMLCanvasElement | null>(null)
  const [lit, setLit] = useState(false)
  const [playing, setPlaying] = useState(false)

  /** filled once and reused — a Uint8Array per frame is the classic visualiser stutter */
  const spec = useRef<Uint8Array>(new Uint8Array(BINS))
  const level = useRef<Float32Array>(new Float32Array(BANDS))
  const raf = useRef(0)
  const lastFrame = useRef(0)
  const loudAt = useRef(0)
  const ink = useRef('#7c6af7')

  const running = useRef(false)
  const stepTimer = useRef(0)
  const startedAt = useRef(0)
  const step = useRef(0)

  /** the bin range each column answers for, worked out once */
  const edges = useRef<number[]>([])
  if (!edges.current.length) {
    const e: number[] = []
    for (let i = 0; i <= BANDS; i++)
      e.push(Math.round(LO_BIN * Math.pow(HI_BIN / LO_BIN, i / BANDS)))
    edges.current = e
  }

  /**
   * ⚠️ ONLY WHEN THE SIZE ACTUALLY CHANGED. Assigning canvas.width clears the bitmap even when the
   * value is identical, so a resize handler that sets it unconditionally wipes the picture on every
   * scroll-driven layout nudge — a lesson this repo has already paid for twice.
   */
  const fit = useCallback(() => {
    const c = cv.current
    if (!c) return
    const r = c.getBoundingClientRect()
    if (!r.width || !r.height) return
    /* re-read regardless: the theme can change without the box ever moving */
    ink.current = getComputedStyle(c).color || ink.current
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const w = Math.round(r.width * dpr)
    const h = Math.round(r.height * dpr)
    if (c.width === w && c.height === h) return
    c.width = w
    c.height = h
    c.getContext('2d')?.setTransform(dpr, 0, 0, dpr, 0, 0)
  }, [])

  const draw = useCallback((now: number) => {
    const c = cv.current
    const g = c?.getContext('2d')
    if (!c || !g) {
      raf.current = 0
      return
    }
    const dt = lastFrame.current ? Math.min(0.1, (now - lastFrame.current) / 1000) : 0.016
    lastFrame.current = now

    const arr = spec.current
    const got = readSpectrum(TAP, arr)
    const fmt = tapFormat(TAP)
    const top = Math.min(HI_BIN, fmt ? fmt.bins - 1 : HI_BIN)
    const keep = Math.exp(-FALL * dt)

    let loudest = 0
    for (let i = 0; i < BANDS; i++) {
      let peak = 0
      if (got) {
        const a = Math.min(edges.current[i], top)
        const b = Math.max(a + 1, Math.min(edges.current[i + 1], top + 1))
        for (let k = a; k < b; k++) if (arr[k] > peak) peak = arr[k]
      }
      /* ⚠️ The bins are already 0–255 on a dB-ish curve, so this only needs normalising. Squaring
         or logging it a second time flattens the whole picture into a stub. */
      const target = peak / 255
      const prev = level.current[i]
      level.current[i] = target > prev ? target : prev * keep
      if (level.current[i] > loudest) loudest = level.current[i]
    }

    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const w = c.width / dpr
    const h = c.height / dpr
    const mid = h / 2
    const colW = w / (BANDS * 2)
    g.clearRect(0, 0, w, h)
    g.fillStyle = ink.current

    /* the line the bars grow out of — there even at rest, so the picture is never a void */
    g.globalAlpha = 0.14 + loudest * 0.22
    g.fillRect(0, mid - 0.5, w, 1)

    for (let i = 0; i < BANDS; i++) {
      const v = level.current[i]
      const bar = Math.max(1, v * h * 0.44)
      g.globalAlpha = 0.3 + v * 0.55
      const x = colW * i + 0.7
      /* ⚠️ MIRRORED ABOUT THE MIDDLE, both ways — which is the claim the caption makes about the
         visualiser room, and what puts the low notes in the centre instead of off to one side. */
      g.fillRect(w / 2 + x, mid - bar, colW - 1.4, bar * 2)
      g.fillRect(w / 2 - x - (colW - 1.4), mid - bar, colW - 1.4, bar * 2)
    }
    g.globalAlpha = 1

    if (loudest > QUIET) loudAt.current = now
    if (!loudAt.current || now - loudAt.current < QUIET_FOR) {
      raf.current = requestAnimationFrame(draw)
      return
    }
    /* gone quiet: park the loop, and hand the tile back to the art */
    raf.current = 0
    lastFrame.current = 0
    level.current.fill(0)
    g.clearRect(0, 0, w, h)
    setLit(false)
  }, [])

  const wake = useCallback(() => {
    if (raf.current) return
    fit()
    loudAt.current = performance.now()
    lastFrame.current = 0
    setLit(true)
    raf.current = requestAnimationFrame(draw)
  }, [draw, fit])

  /**
   * Watch for sound, cheaply, and only while there is something to watch.
   *
   * ⚠️ NO TIMER AT ALL BEFORE THE SYNTH EXISTS. subscribeTaps says the moment one registers —
   * which on this page is the moment somebody presses a key upstairs — so the common visit, where
   * nobody touches anything, runs nothing whatsoever.
   */
  useEffect(() => {
    let poll = 0
    const onScreen = () => {
      const el = wrap.current
      if (!el || document.hidden) return false
      const r = el.getBoundingClientRect()
      return r.bottom > 0 && r.top < (window.innerHeight || 0) && r.width > 0
    }
    const look = () => {
      if (raf.current || !onScreen()) return
      const arr = spec.current
      if (!readSpectrum(TAP, arr)) return
      const fmt = tapFormat(TAP)
      const top = Math.min(HI_BIN, fmt ? fmt.bins - 1 : HI_BIN)
      let peak = 0
      for (let k = LO_BIN; k <= top; k++) if (arr[k] > peak) peak = arr[k]
      if (peak / 255 > QUIET) wake()
    }
    const sync = () => {
      const want = hasTap(TAP)
      if (want && !poll) poll = window.setInterval(look, WATCH_MS)
      if (!want && poll) {
        window.clearInterval(poll)
        poll = 0
      }
    }
    sync()
    const offTaps = subscribeTaps(sync)
    /* the same belt-and-braces as the snake board: no observer to go quiet on us */
    const slow = window.setInterval(sync, 2000)
    return () => {
      offTaps()
      window.clearInterval(slow)
      window.clearInterval(poll)
      cancelAnimationFrame(raf.current)
      raf.current = 0
    }
  }, [wake])

  useEffect(() => {
    fit()
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => fit())
    if (ro && cv.current) ro.observe(cv.current)
    /* a window listener as well: ResizeObserver does not fire in every embedded context */
    window.addEventListener('resize', fit)
    /* savePalette announces itself — see customTheme.ts — so the bars follow a theme change */
    window.addEventListener('yaya:palette', fit)
    return () => {
      ro?.disconnect()
      window.removeEventListener('resize', fit)
      window.removeEventListener('yaya:palette', fit)
    }
  }, [fit])

  /* ── the loop ──────────────────────────────────────────────────────────── */

  /** ⚠️ A ref so the listeners below never go stale: they are registered once, for the life of
      the component, and a closure captured then would be stopping the first render forever. */
  const stop = useRef(() => {})
  stop.current = () => {
    if (!running.current) return
    running.current = false
    setPlaying(false)
    window.clearInterval(stepTimer.current)
    stepTimer.current = 0
    withSynth((s) => s.allNotesOff())
  }

  const tickStep = useCallback(() => {
    if (performance.now() - startedAt.current > LOOP_MAX) return stop.current()
    const at = step.current % STEPS
    step.current = at + 1
    withSynth((s) => {
      for (const m of HITS[at]) {
        s.noteOn(`viz:d:${at}:${m}`, DRUMS, m, undefined, { key: PART, fx: FX, gain: GAIN })
      }
      const b = BASS_LINE[at]
      if (b == null) return
      const id = `viz:b:${at}`
      s.noteOn(id, BASS, b, undefined, { key: PART, fx: FX, gain: GAIN })
      /* every voice has to be released or they pile up, whatever its own envelope does */
      window.setTimeout(() => withSynth((t) => t.noteOff(id)), 380)
    })
  }, [])

  const toggle = () => {
    if (running.current) return stop.current()
    /**
     * ⚠️ EVERYTHING INSIDE withSynth, INCLUDING THE STOP. On the very first press the module is
     * still loading, so a stopLive() called out here would land after the interval had started and
     * silence the very loop it was meant to make room for.
     */
    withSynth((s) => {
      /* one sound source at a time — this puts the sequencer upstairs away before starting */
      s.stopLive()
      if (running.current) return
      running.current = true
      setPlaying(true)
      startedAt.current = performance.now()
      step.current = 0
      tickStep()
      stepTimer.current = window.setInterval(tickStep, STEP_MS)
    })
  }

  useEffect(() => {
    /* ⚠️ The dock's stop button has to stop the PLAYER, not the notes: silencing a thing that
       plays a fresh note every 150ms only makes it stutter and carry on. */
    const offStop = onStopAll(() => stop.current())
    /* ⚠️ And pressing anywhere else puts it away — the rule the sequencer keeps, because leaving
       is how people stop something. pointerdown rather than click, so it lands even when the press
       is on something that swallows the click. */
    const elsewhere = (e: Event) => {
      const el = wrap.current
      const t = e.target
      if (!el || (t instanceof Node && el.contains(t))) return
      stop.current()
    }
    document.addEventListener('pointerdown', elsewhere, true)
    return () => {
      offStop()
      document.removeEventListener('pointerdown', elsewhere, true)
      stop.current()
    }
  }, [])

  return (
    <span ref={wrap} className={'hag-viz' + (lit ? ' is-lit' : '')}>
      {/* ⚠️ The art stays, as the resting state. It is a compositor animation costing no main
          thread that goes still by itself for a reader who asked for less motion — exactly what a
          tile nobody has made a sound at should be. The canvas takes over on top of it. */}
      <TileArt kind="viz" />
      <canvas ref={cv} className="hag-viz-cv" aria-hidden />
      <button
        type="button"
        className="hag-viz-go"
        onClick={toggle}
        aria-pressed={playing}
        title={playing ? 'Stop the loop' : 'Play a drum loop through the synth'}
      >
        {playing ? '■ Stop' : '▶ Play a loop'}
      </button>
    </span>
  )
}
