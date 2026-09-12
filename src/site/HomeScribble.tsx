import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from 'react'

/**
 * The front door's second toy: a pad you can actually draw on — and which draws by itself.
 *
 * ⚠️ THE SAME ARGUMENT THE HERO'S KEYS MAKE — see HeroPlay. A grid of cards describing playable
 * things is not a playable thing, and "Draw something" written on a rectangle is the card doing
 * the describing. This is the smallest honest version of the paint studio, sitting in its own
 * invitation, and it needs no sentence explaining it: a surface under a finger is self-evident in
 * a way no copy ever is.
 *
 * ⚠️ AN EMPTY PAD IS STILL A CARD. That was the hole this left: the FIRST demo on the front page
 * was a black rectangle with the words "drag here" on it, sitting still, beside a snake board that
 * was busy playing itself. Nobody scrolling past learns anything from a blank surface, and the one
 * demo that asks for a hand was the one that looked broken. So it does what the snake does — it
 * runs on its own and hands itself straight back the moment you touch it. The pad is never empty,
 * and what it shows is exactly what it wants from you.
 *
 * ⚠️ NO LIBRARY, NO IMPORT, NO AUDIO. Unlike the keys this costs a visitor nothing to ship and
 * nothing to switch on — canvas 2D and pointer events, both already in the browser. The front page
 * must never be the reason a chunk loads.
 *
 * ⚠️ THE INK DISSOLVES, which is a feature and not decoration. A doodle pad that keeps everything
 * is a mess within a minute and then reads as broken rather than used, so it would need a Clear
 * button — one more control on a page whose whole problem was too many rectangles. Fading means
 * the pad is always inviting, always looks alive, and has nothing to press. It is also what lets
 * it draw itself forever without filling up.
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

/** how long the pad waits, on screen and untouched, before it starts drawing for itself */
const AUTO_AFTER = 1600
/**
 * ⚠️ AND HOW LONG IT WAITS AFTER YOU. Taking the pen back out of somebody's hand is the whole
 * way to make this feel like a toy that is fighting you, so the handback is long enough to be sure
 * they have finished rather than paused.
 *
 * ⚠️ SIX SECONDS BECAUSE THE SNAKE BOARD SAYS SIX (HANDBACK_MS in HomeSnake). These two sit
 * beside each other making the same promise — it plays itself, you take over, it hands itself
 * back — and a reader who tries both should find the same pause, not two different ones.
 *
 * ⚠️ It also has to be SHORTER THAN THE FADE, or the pad goes visibly blank between your last
 * stroke dissolving at seven seconds and the next self-drawn one starting. Measured at nine: an
 * empty rectangle for about a second and a half, which is the exact look this file exists to end.
 */
const HAND_BACK = 6000
/** one self-drawn stroke, and the pause after it */
const AUTO_STROKE_MS = 2600
const AUTO_GAP_MS = 850

type Pt = { x: number; y: number }
type Stroke = {
  hue: number
  pts: Pt[]
  /** when the last point was added — a stroke does not start fading until you stop drawing it */
  touched: number
}

/**
 * What the pad draws when left alone.
 *
 * ⚠️ TWO SINES PER AXIS, NOT ONE. A single pair is a Lissajous figure, and a Lissajous figure
 * looks like a machine drew it — the same clean loop every time, symmetrical, obviously generated.
 * A quieter second harmonic at an unrelated frequency breaks the symmetry enough that the line
 * wanders, doubles back and closes untidily, which is what a hand does. The phases are random per
 * stroke, so no two are the same shape.
 */
type Seed = {
  fx: number
  fy: number
  gx: number
  gy: number
  px: number
  py: number
  turns: number
}
const newSeed = (): Seed => ({
  fx: 1,
  fy: 1 + Math.floor(Math.random() * 3) * 0.5,
  gx: 2.3 + Math.random() * 1.6,
  gy: 2.7 + Math.random() * 1.6,
  px: Math.random() * Math.PI * 2,
  py: Math.random() * Math.PI * 2,
  turns: 0.9 + Math.random() * 0.7,
})

export function HomeScribble() {
  const ref = useRef<HTMLCanvasElement | null>(null)
  const drawing = useRef(false)
  const strokes = useRef<Stroke[]>([])
  /** advanced per stroke, so two strokes in a row are never the same colour */
  const hue = useRef(Math.floor(Math.random() * 360))
  const raf = useRef(0)
  /**
   * ⚠️ AN EMPTY PAD READS AS A BROKEN TILE, not as an invitation. It is a bordered rectangle with
   * nothing in it, next to seven tiles that are all doing something — so it needs to say what it
   * wants, once, and then never again. Gone on the first mark and it does not come back, because
   * a hint that reappears is a hint that is arguing with you.
   */
  const [marked, setMarked] = useState(false)

  /** the pad's own size in CSS pixels, so the self-drawn path can be laid out inside it */
  const box = useRef({ w: 0, h: 0 })
  /** false parks the loop entirely — see the visibility effect */
  const onScreen = useRef(false)
  /** 0 = never touched. Otherwise when the last stroke of yours ended. */
  const lastTouch = useRef(0)
  /** when the pad was first ready to draw for itself, so the first one is not instant */
  const readyAt = useRef(0)
  const autoStroke = useRef<Stroke | null>(null)
  const autoEnds = useRef(0)
  const autoNext = useRef(0)
  const seed = useRef<Seed>(newSeed())

  /**
   * ⚠️ A reader who asked for less motion gets a pad that does nothing until they touch it. The
   * whole point of the setting is that things do not move on their own.
   */
  const still =
    typeof window !== 'undefined' &&
    (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false)

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
    box.current = { w: r.width, h: r.height }
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

  /** where the self-drawn line is at `t`, 0 to 1 through one stroke */
  const pathAt = useCallback((t: number): Pt => {
    const s = seed.current
    const { w, h } = box.current
    const mx = w * 0.12
    const my = h * 0.18
    const rx = Math.max(6, (w - mx * 2) / 2)
    const ry = Math.max(6, (h - my * 2) / 2)
    const u = t * s.turns * Math.PI * 2
    const x = w / 2 + (rx * (Math.sin(u * s.fx + s.px) + 0.34 * Math.sin(u * s.gx))) / 1.34
    const y = h / 2 + (ry * (Math.cos(u * s.fy + s.py) + 0.34 * Math.cos(u * s.gy))) / 1.34
    return { x, y }
  }, [])

  /** drop from the FRONT, oldest first — those are closest to expiring anyway */
  const trim = useCallback(() => {
    let total = 0
    for (const x of strokes.current) total += x.pts.length
    while (total > MAX_POINTS && strokes.current.length > 1) {
      total -= strokes.current[0].pts.length
      strokes.current.shift()
    }
  }, [])

  /**
   * Draw for ourselves, if it is our turn.
   *
   * ⚠️ IT NEVER INTERRUPTS. A hand on the pad stops this dead — not at the end of the current
   * stroke, immediately — and the half-finished line is simply left to fade like any other. A toy
   * that finishes its own gesture while somebody is trying to use it is a toy that is arguing.
   */
  const autoDraw = useCallback(
    (now: number) => {
      if (still || drawing.current || !box.current.w) return
      const quietSince = lastTouch.current || readyAt.current
      const wait = lastTouch.current ? HAND_BACK : AUTO_AFTER
      if (!quietSince || now - quietSince < wait) return

      const st = autoStroke.current
      if (st) {
        if (now >= autoEnds.current) {
          autoStroke.current = null
          autoNext.current = now + AUTO_GAP_MS
          return
        }
        st.pts.push(pathAt(1 - (autoEnds.current - now) / AUTO_STROKE_MS))
        st.touched = now
        trim()
        return
      }
      if (now < autoNext.current) return
      hue.current = (hue.current + 47) % 360
      seed.current = newSeed()
      autoEnds.current = now + AUTO_STROKE_MS
      const fresh: Stroke = { hue: hue.current, pts: [pathAt(0)], touched: now }
      strokes.current.push(fresh)
      autoStroke.current = fresh
    },
    [pathAt, still, trim],
  )

  /**
   * Redraw everything still alive, dimmed by its own age.
   *
   * ⚠️ Stops itself the moment nothing is left AND nothing wants to start. A permanent rAF loop
   * on the front page is a battery cost every visitor pays — so this parks whenever the pad is off
   * screen or the tab is hidden, and the slow poll below is what starts it again.
   */
  const tick = useCallback(
    (now: number) => {
      const c = ref.current
      const g = ctx()
      if (!c || !g || !onScreen.current) {
        raf.current = 0
        return
      }
      autoDraw(now)

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

      /* ⚠️ `!still` keeps the loop alive through the gap between self-drawn strokes — without it
         the pad goes quiet for AUTO_GAP_MS, the loop stops, and nothing draws again until the
         one-second poll happens to come round. */
      if (!live.length && !drawing.current && still) {
        raf.current = 0
        return
      }
      raf.current = requestAnimationFrame(tick)
    },
    [autoDraw, still],
  )

  const wake = useCallback(() => {
    if (!raf.current) raf.current = requestAnimationFrame(tick)
  }, [tick])

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
      raf.current = 0
    }
  }, [fit])

  /**
   * On screen or not.
   *
   * ⚠️ A RECT CHECK ON A TIMER, NOT IntersectionObserver — the same call the snake board makes,
   * for the same reason: the observer reported nothing at all in an embedded view, and a board
   * that never gets told it is visible is a board that never moves.
   */
  useEffect(() => {
    const check = () => {
      const el = ref.current
      const on =
        !!el &&
        !document.hidden &&
        (() => {
          const r = el.getBoundingClientRect()
          return r.bottom > 0 && r.top < (window.innerHeight || 0) && r.width > 0
        })()
      if (on && !onScreen.current) {
        /* the countdown starts when the pad comes into view, not when the page loaded — a pad
           that drew its first line while three sections off screen has already thrown it away */
        if (!readyAt.current) readyAt.current = performance.now()
        onScreen.current = true
        fit()
        wake()
      } else if (!on) {
        onScreen.current = false
      }
    }
    check()
    window.addEventListener('scroll', check, { passive: true })
    window.addEventListener('resize', check)
    document.addEventListener('visibilitychange', check)
    const poll = window.setInterval(check, 1000)
    return () => {
      window.clearInterval(poll)
      window.removeEventListener('scroll', check)
      window.removeEventListener('resize', check)
      document.removeEventListener('visibilitychange', check)
    }
  }, [fit, wake])

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
    /* the pad lets go instantly; whatever it was drawing is left to fade like anything else */
    autoStroke.current = null
    lastTouch.current = performance.now()
    hue.current = (hue.current + 47) % 360
    /* a tap with no drag is a one-point stroke, drawn as a dot — a careful tap that left nothing
       would read as a dead surface */
    strokes.current.push({ hue: hue.current, pts: [at(e)], touched: performance.now() })
    setMarked(true)
    wake()
  }

  const move = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return
    const st = strokes.current[strokes.current.length - 1]
    if (!st) return
    st.pts.push(at(e))
    st.touched = performance.now()
    lastTouch.current = st.touched
    trim()
    wake()
  }

  const up = () => {
    drawing.current = false
    lastTouch.current = performance.now()
    wake()
  }

  return (
    <span className="hag-pad-wrap">
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
      {!marked && <span className="hag-pad-hint">drag here</span>}
    </span>
  )
}
