import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent } from 'react'

/**
 * The front door's second toy: a pad you can actually draw on.
 *
 * ⚠️ THE SAME ARGUMENT THE HERO'S KEYS MAKE — see HeroPlay. A grid of cards describing playable
 * things is not a playable thing, and "Draw something" written on a rectangle is the card doing
 * the describing. This is the smallest honest version of the paint studio, sitting in its own
 * invitation, and it needs no sentence explaining it: a surface under a finger is self-evident in
 * a way no copy ever is.
 *
 * ⚠️ NO LIBRARY, NO IMPORT, NO AUDIO. Unlike the keys this costs a visitor nothing to ship and
 * nothing to switch on — canvas 2D and pointer events, both already in the browser. The front page
 * must never be the reason a chunk loads.
 *
 * ⚠️ THE INK DISSOLVES, which is a feature and not decoration. A doodle pad that keeps everything
 * is a mess within a minute and then reads as broken rather than used, so it would need a Clear
 * button — one more control on a page whose whole problem was too many rectangles. Fading means
 * the pad is always inviting, always looks alive, and has nothing to press.
 *
 * ⚠️ THE STROKES ARE KEPT AND REDRAWN BY AGE, rather than dissolved by repeatedly painting
 * destination-out over the canvas. The composite trick is the obvious way to do this and it does
 * not work: canvas alpha is an 8-BIT INTEGER, so multiplying it down stalls the moment the
 * per-frame decrement rounds to zero — measured, it parks at 20% opacity and stays there until
 * the hard clear snaps it away in one frame, which is the exact visible pop the fade exists to
 * avoid. The stall floor is 0.5/alpha-per-frame, so any fade slow enough to be pleasant is also
 * slow enough to stall. Keeping the strokes costs a redraw of a few hundred short segments and
 * is exactly right instead of nearly right.
 *
 * It is also better behaviour: each stroke ages from when YOU stopped drawing it, so an old
 * squiggle dims while the one under your finger stays bright. And because the picture is data
 * rather than pixels, resizing the pad no longer throws it away.
 *
 * ⚠️ The dissolve itself has never been watched in the preview pane — requestAnimationFrame
 * does not fire there at all. The curve was checked by driving this loop from a timer shim and
 * sampling the alpha channel; that is how the 20% stall above was found.
 */

/** Roughly how long a stroke takes to disappear once you lift the pen. */
const FADE_SECONDS = 7
/** ln(0.02): "down to 2%", the point at which a stroke is dropped rather than drawn. */
const FADE_K = 3.9 / FADE_SECONDS
/** Below this a stroke is gone — it stops being drawn and stops being kept. */
const GONE = 0.02
/**
 * A ceiling on what is kept, so a long session cannot grow the redraw without limit.
 * Generous: a vigorous scribble is a few hundred points and they expire on their own.
 */
const MAX_POINTS = 1500

type Pt = { x: number; y: number }
type Stroke = {
  hue: number
  pts: Pt[]
  /** when the last point was added — a stroke does not start fading until you stop drawing it */
  touched: number
}

export function HomeScribble() {
  const ref = useRef<HTMLCanvasElement | null>(null)
  const drawing = useRef(false)
  const strokes = useRef<Stroke[]>([])
  /** advanced per stroke, so two strokes in a row are never the same colour */
  const hue = useRef(Math.floor(Math.random() * 360))
  const raf = useRef(0)

  const ctx = () => ref.current?.getContext('2d') ?? null

  /**
   * ⚠️ ONLY WHEN THE SIZE ACTUALLY CHANGED. Assigning canvas.width clears the bitmap even when
   * the value is identical, so a resize handler that sets it unconditionally wipes the canvas on
   * every scroll-driven layout nudge — a lesson this repo has already paid for twice. The picture
   * survives either way now, being data, but a needless clear still flickers.
   */
  const fit = useCallback(() => {
    const c = ref.current
    if (!c) return
    const r = c.getBoundingClientRect()
    if (!r.width || !r.height) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const w = Math.round(r.width * dpr)
    const h = Math.round(r.height * dpr)
    if (c.width === w && c.height === h) return
    c.width = w
    c.height = h
    const g = c.getContext('2d')
    if (!g) return
    g.setTransform(dpr, 0, 0, dpr, 0, 0)
    g.lineCap = 'round'
    g.lineJoin = 'round'
  }, [])

  useEffect(() => {
    fit()
    const ro =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            fit()
          })
    if (ro && ref.current) ro.observe(ref.current)
    // ⚠️ a window listener as well as the observer: ResizeObserver does not fire in every
    // embedded context this page is viewed in, and a pad sized 0×0 is an invisible dead tile.
    window.addEventListener('resize', fit)
    return () => {
      ro?.disconnect()
      window.removeEventListener('resize', fit)
      cancelAnimationFrame(raf.current)
    }
  }, [fit])

  /**
   * Redraw everything still alive, dimmed by its own age.
   *
   * ⚠️ Stops itself the moment nothing is left. A permanent rAF loop on the front page is a
   * battery cost every visitor pays for a pad most of them never touch.
   */
  const tick = useCallback((now: number) => {
    const c = ref.current
    const g = ctx()
    if (!c || !g) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    g.clearRect(0, 0, c.width / dpr, c.height / dpr)

    const live: Stroke[] = []
    for (const st of strokes.current) {
      const age = Math.max(0, (now - st.touched) / 1000)
      const alpha = Math.exp(-FADE_K * age)
      if (alpha < GONE) continue
      live.push(st)
      if (st.pts.length === 1) {
        const p = st.pts[0]
        g.globalAlpha = alpha
        g.fillStyle = `hsl(${st.hue} 85% 62%)`
        g.beginPath()
        g.arc(p.x, p.y, 1.8, 0, Math.PI * 2)
        g.fill()
        continue
      }
      g.globalAlpha = alpha
      g.strokeStyle = `hsl(${st.hue} 85% 62%)`
      g.lineWidth = 3
      g.beginPath()
      g.moveTo(st.pts[0].x, st.pts[0].y)
      for (let i = 1; i < st.pts.length; i++) g.lineTo(st.pts[i].x, st.pts[i].y)
      g.stroke()
    }
    g.globalAlpha = 1
    strokes.current = live

    if (!live.length && !drawing.current) {
      raf.current = 0
      return
    }
    raf.current = requestAnimationFrame(tick)
  }, [])

  const wake = useCallback(() => {
    if (!raf.current) raf.current = requestAnimationFrame(tick)
  }, [tick])

  const at = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }

  const down = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    fit()
    /* ⚠️ try/catch: capture throws InvalidStateError for a pointer id the browser does not
       consider active, and a thrown handler would abandon the stroke entirely. The capture is a
       nicety — it keeps a drag alive past the edge of the pad — not a requirement for drawing. */
    try {
      e.currentTarget.setPointerCapture(e.pointerId)
    } catch {
      /* draw without it */
    }
    drawing.current = true
    hue.current = (hue.current + 47) % 360
    /* a tap with no drag is a one-point stroke, drawn as a dot — a careful tap that left nothing
       would read as a dead surface */
    strokes.current.push({ hue: hue.current, pts: [at(e)], touched: performance.now() })
    wake()
  }

  const move = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return
    const st = strokes.current[strokes.current.length - 1]
    if (!st) return
    st.pts.push(at(e))
    st.touched = performance.now()

    /* ⚠️ Drop from the FRONT, oldest first: those are the strokes closest to expiring anyway,
       so the cap is invisible rather than chopping the line somebody is currently drawing. */
    let total = 0
    for (const x of strokes.current) total += x.pts.length
    while (total > MAX_POINTS && strokes.current.length > 1) {
      total -= strokes.current[0].pts.length
      strokes.current.shift()
    }
    wake()
  }

  const up = () => {
    drawing.current = false
    wake()
  }

  return (
    <canvas
      ref={ref}
      className="hag-pad"
      /* ⚠️ touch-action lives in CSS, not here — without it a finger scrolls the page instead of
         drawing, which is the whole of the feature on the device most people arrive on. */
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      aria-label="A scratch pad — drag to draw"
    />
  )
}
