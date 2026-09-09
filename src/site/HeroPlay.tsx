import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react'
import type { InstrumentId } from '../audio/synth'

/**
 * The front door's one toy: twelve keys that actually play, with strings above them that ring.
 *
 * ⚠️ THE PAGE IS THE PORTFOLIO, so the page should DO something rather than list what it can do.
 * Everything else on this site is a room you have to travel to; the complaint about the old front
 * page was that it did not draw anyone in, and a grid of cards describing playable things is not
 * a playable thing. This is the smallest honest version of the site, sitting in the hero.
 *
 * ⚠️ PENTATONIC, so there is no wrong key. Somebody mashing at random has to come away thinking
 * "that sounded nice" rather than "I broke it" — a major scale hands you a semitone clash on the
 * first accidental two-finger press, and that is the press that decides whether they keep going.
 *
 * ⚠️ THE SYNTH IS IMPORTED ON FIRST TOUCH, never on render — though be honest about what that
 * buys today, which is nothing. synth.ts is already in the entry chunk and the build says why:
 * NINE modules import it statically, AudioDock and looper and songFile and songPlayer among them,
 * and App pulls the dock in eagerly. So the deferral here saves a visitor zero bytes right now,
 * and getting those bytes back is a nine-importer job, not a one-line fix.
 *
 * It stays dynamic anyway, for one reason: the front page must never be the REASON the synth
 * ships. A static import here would quietly make the home page one of those importers, so the
 * day somebody untangles the rest, this page would be the thing still pinning it to first paint.
 *
 * ⚠️ NO SOUND UNTIL A DELIBERATE PRESS — not merely because autoplay is blocked. A front page
 * that makes noise at you is the fastest way there is to lose somebody.
 */

/** C major pentatonic over two octaves. */
const NOTES = [60, 62, 64, 67, 69, 72, 74, 76, 79, 81, 84, 86]
const NAMES = ['C', 'D', 'E', 'G', 'A', 'C', 'D', 'E', 'G', 'A', 'C', 'D']

/**
 * ⚠️ Marimba on purpose: soft attack, short decay, nothing to hold. The patches with a slow swell
 * are the ones still under investigation for clicking on release, and the front page is not where
 * anybody should find that out. It also forgives someone hammering one key, which they will.
 */
const INSTRUMENT: InstrumentId = 'marimba'
/** its own part, so the hero never inherits whatever the instrument room was left set to */
const PART = 'home-hero'
const FX = { echo: 0.16, echoTime: 0.26, space: 0.3, vibrato: 0, glide: 0 }
const GAIN = 0.5

type SynthMod = typeof import('../audio/synth')
let mod: SynthMod | null = null
let pending: Promise<SynthMod> | null = null
/** ⚠️ Called straight through once loaded, so no key press after the first has an async hop in it. */
function withSynth(fn: (s: SynthMod) => void) {
  if (mod) return fn(mod)
  if (!pending) pending = import('../audio/synth').then((m) => (mod = m))
  void pending.then(fn)
}

const ROWS = 4
const LIFE = 2.6
/** px per second a pluck travels out along its string */
const SPEED = 190
const PACKET = 46
const AMP = 9
const IDLE_AMP = 2.6
const STEP = 6

type Pluck = { x: number; row: number; t0: number }

export function HeroPlay() {
  const band = useRef<HTMLDivElement>(null)
  const cv = useRef<HTMLCanvasElement>(null)
  const keys = useRef<HTMLDivElement>(null)
  const plucks = useRef<Pluck[]>([])
  const held = useRef<Set<number>>(new Set())
  const running = useRef(false)
  const visible = useRef(true)
  /** handed out by the draw effect so a key press can wake the loop without owning it */
  const startRef = useRef<(() => void) | null>(null)

  const still =
    typeof window !== 'undefined' &&
    (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false)

  /* ── the strings ─────────────────────────────────────────────────────────── */
  useEffect(() => {
    const el = cv.current
    const box = band.current
    if (!el || !box) return
    const ctx = el.getContext('2d')
    if (!ctx) return

    let w = 0
    let h = 0
    let stroke = '#7c6af7'
    let readAt = -1

    /**
     * ⚠️ The canvas is absolutely positioned inside the band, so its ATTRIBUTES can be whatever
     * the screen wants without ever feeding back into layout. The profile art block learned this
     * the expensive way: a canvas with no CSS size lays out at its attribute size, so measuring
     * the parent and multiplying by devicePixelRatio grew the parent, which grew the canvas.
     */
    const size = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      w = Math.round(box.clientWidth)
      h = Math.round(box.clientHeight)
      if (w < 1 || h < 1) return false
      const bw = Math.round(w * dpr)
      const bh = Math.round(h * dpr)
      if (el.width !== bw || el.height !== bh) {
        el.width = bw
        el.height = bh
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      return true
    }

    const draw = (tMs: number) => {
      const t = tMs / 1000
      /* ⚠️ once a second, not once a frame: getComputedStyle forces a style recalc, and the
         accent only changes when somebody changes the theme. */
      if (t - readAt > 1) {
        readAt = t
        const v = getComputedStyle(box).getPropertyValue('--accent').trim()
        if (v) stroke = v
      }
      ctx.clearRect(0, 0, w, h)
      ctx.strokeStyle = stroke
      ctx.lineCap = 'round'

      const live = plucks.current
      for (let r = 0; r < ROWS; r++) {
        const y0 = ((r + 0.5) / ROWS) * h
        let energy = 0
        /* ⚠️ thicker toward the bottom, like the bass strings of anything with strings on it.
           Four identical hairlines read as ruled notepad paper — measured by looking at it. */
        ctx.lineWidth = 1 + (ROWS - 1 - r) * 0.45
        ctx.beginPath()
        for (let x = 0; x <= w; x += STEP) {
          let d = still
            ? 0
            : IDLE_AMP *
              (Math.sin(x * 0.011 + t * 0.5 + r * 1.7) + 0.4 * Math.sin(x * 0.027 - t * 0.31 + r))
          for (const p of live) {
            if (p.row !== r) continue
            const age = t - p.t0
            const fade = 1 - age / LIFE
            if (fade <= 0) continue
            const off = Math.abs(x - p.x) - age * SPEED
            const env = Math.exp(-(off * off) / (2 * PACKET * PACKET)) * fade
            d += AMP * env * Math.sin(off * 0.055)
            if (fade > energy) energy = fade
          }
          if (x === 0) ctx.moveTo(x, y0 + d)
          else ctx.lineTo(x, y0 + d)
        }
        /* the string you plucked is the bright one */
        ctx.globalAlpha = 0.24 + 0.62 * energy
        ctx.stroke()
      }
      ctx.globalAlpha = 1
    }

    let raf = 0
    const frame = (t: number) => {
      const now = t / 1000
      plucks.current = plucks.current.filter((p) => now - p.t0 < LIFE)
      draw(t)
      /* ⚠️ stops dead when there is nothing moving and nothing to move it. A front page holding a
         rAF open forever is a battery cost paid by everybody who only scrolled past. */
      const wanted = visible.current && !document.hidden && (!still || plucks.current.length > 0)
      if (wanted) raf = requestAnimationFrame(frame)
      else running.current = false
    }
    const start = () => {
      if (running.current) return
      running.current = true
      raf = requestAnimationFrame(frame)
    }
    startRef.current = start

    if (size()) {
      if (still) draw(performance.now())
      else start()
    }

    const ro = new ResizeObserver(() => {
      if (!size()) return
      if (still || !running.current) draw(performance.now())
      if (!still) start()
    })
    ro.observe(box)

    /* only animate while it is actually on somebody's screen */
    const io = new IntersectionObserver(
      ([e]) => {
        visible.current = e.isIntersecting
        if (e.isIntersecting && !still) start()
      },
      { threshold: 0 },
    )
    io.observe(box)

    const wake = () => {
      if (!document.hidden && visible.current && !still) start()
    }
    document.addEventListener('visibilitychange', wake)
    return () => {
      cancelAnimationFrame(raf)
      running.current = false
      startRef.current = null
      ro.disconnect()
      io.disconnect()
      document.removeEventListener('visibilitychange', wake)
    }
  }, [still])

  /* ── the keys ────────────────────────────────────────────────────────────── */
  const mark = (i: number, down: boolean) => {
    keys.current
      ?.querySelector<HTMLElement>(`[data-note="${i}"]`)
      ?.classList.toggle('is-down', down)
  }

  const play = useCallback((i: number) => {
    if (held.current.has(i)) return
    held.current.add(i)
    mark(i, true)
    withSynth((s) =>
      s.noteOn(`hero:${i}`, INSTRUMENT, NOTES[i], undefined, { key: PART, fx: FX, gain: GAIN }),
    )
    const w = band.current?.clientWidth ?? 0
    plucks.current.push({
      x: ((i + 0.5) / NOTES.length) * w,
      /* higher note, higher string */
      row: ROWS - 1 - Math.floor((i / NOTES.length) * ROWS),
      t0: performance.now() / 1000,
    })
    startRef.current?.()
  }, [])

  const release = useCallback((i: number) => {
    if (!held.current.delete(i)) return
    mark(i, false)
    withSynth((s) => s.noteOff(`hero:${i}`))
  }, [])

  const releaseAll = useCallback(() => {
    for (const i of [...held.current]) release(i)
  }, [release])

  /* ⚠️ every held note released on unmount, or navigating away leaves one sounding forever */
  useEffect(() => () => releaseAll(), [releaseAll])

  /**
   * ⚠️ Hit-tested from the POINTER rather than handled per key, because a touch drag captures to
   * the element it started on — so pointerenter never fires on the neighbours, and sliding a
   * finger across the keys would play exactly one note on a phone. Which is the gesture most
   * people try first.
   */
  const noteUnder = (x: number, y: number): number | null => {
    const el = document.elementFromPoint(x, y)
    const k = el instanceof Element ? el.closest<HTMLElement>('[data-note]') : null
    const n = k ? Number(k.dataset.note) : NaN
    return Number.isInteger(n) ? n : null
  }

  const slide = (e: ReactPointerEvent) => {
    const i = noteUnder(e.clientX, e.clientY)
    for (const h of [...held.current]) if (h !== i) release(h)
    if (i !== null) play(i)
  }

  return (
    <div className="hero-play">
      <div className="hero-strings" ref={band} aria-hidden>
        <canvas ref={cv} />
      </div>
      <div
        className="hero-keys"
        ref={keys}
        role="group"
        aria-label="Play a few notes"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          slide(e)
        }}
        onPointerMove={(e) => {
          if (e.buttons & 1) slide(e)
        }}
        onPointerUp={releaseAll}
        onPointerCancel={releaseAll}
      >
        {NOTES.map((_, i) => (
          <button
            key={i}
            type="button"
            data-note={i}
            className="hero-key"
            aria-label={`Play ${NAMES[i]}`}
            /* a stepped silhouette, rather than twelve identical rectangles */
            style={{ height: `${62 - i * 2.2}px` }}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' && e.key !== ' ') return
              e.preventDefault()
              play(i)
            }}
            onKeyUp={(e) => {
              if (e.key === 'Enter' || e.key === ' ') release(i)
            }}
            onBlur={() => release(i)}
          >
            <span aria-hidden>{NAMES[i]}</span>
          </button>
        ))}
      </div>
      <p className="hero-play-hint muted">
        Press one, or drag across them — there are no wrong notes. There is a whole studio of this
        behind the <a href="#instrument">Instrument</a> tab.
      </p>
    </div>
  )
}
