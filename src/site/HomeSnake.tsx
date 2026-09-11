import { useCallback, useEffect, useRef } from 'react'

/**
 * A snake playing itself on the front page, which you can take over.
 *
 * ⚠️ IT PLAYS ITSELF FIRST. A dead board waiting to be pressed is indistinguishable from a
 * picture, and the point of a live tile is that a visitor sees movement and understands without
 * being told. So it runs on its own, and the moment you steer it, it is yours.
 *
 * ⚠️ THE AUTOPILOT IS DELIBERATELY MEDIOCRE — greedy toward the apple, and it only refuses a
 * move that kills it on the very next step. A perfect solver fills the board and then has
 * nowhere to go, which looks like a hang; a bad one dies in four seconds and looks broken. What
 * is wanted is a snake that keeps eating, occasionally dies, and starts again without ceremony —
 * exactly what somebody glancing at it expects a snake to do.
 *
 * ⚠️ IT STOPS WHEN IT IS NOT ON SCREEN. A front-page loop that keeps ticking while the reader is
 * three sections down is a battery cost for nothing, and this page now has enough on it that
 * "nobody will notice one more" stops being true.
 *
 * ⚠️ BUT NOT VIA IntersectionObserver, which was the first attempt and froze the board solid.
 * In an embedded view the observer reported nothing at all — not false, NOTHING — so the loop
 * paused on mount and had no event that could ever start it again. A pause whose only resume
 * signal is an observer that may never speak is not a pause, it is a hang, and it looks exactly
 * like a broken tile. A rect against the viewport is one layout read, answers the same question,
 * and cannot fail to answer it; the interval below then guarantees a recovery even if every
 * event were missed.
 *
 * ⚠️ ARROW KEYS ARE NOT BOUND TO THE WINDOW. They page between sections of this site — the
 * visualiser's pin and the profile editor's grip have both been bitten by it — so steering only
 * takes the keys while the board itself has focus, and it swallows them when it does.
 */

/**
 * ⚠️ THE COLUMNS ARE MEASURED, NOT DECLARED. A fixed 26x11 grid is a 2.4:1 board sitting in a
 * 6:1 tile, so it was letterboxed into the middle third with dead space either side — a game of
 * snake apologising for the space it was given. Rows are fixed (they set the cell size at this
 * height) and columns are however many of those cells fit across.
 */
const ROWS = 9
const MIN_COLS = 12
const MAX_COLS = 48
/** ms per step. Slow enough to read as a game rather than a screensaver. */
const STEP = 120
/** how long a taken-over game sits idle before the autopilot takes it back */
const HANDBACK_MS = 6000

type P = { x: number; y: number }
const DIRS: Record<string, P> = {
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
}

export function HomeSnake() {
  const ref = useRef<HTMLCanvasElement | null>(null)
  const raf = useRef(0)
  const lastStep = useRef(0)
  const snake = useRef<P[]>([])
  const dir = useRef<P>({ x: 1, y: 0 })
  const apple = useRef<P>({ x: 0, y: 0 })
  const cols = useRef(26)
  /** when a person last steered; 0 means the autopilot has it */
  const humanAt = useRef(0)
  const visible = useRef(true)

  const place = useCallback(() => {
    const taken = new Set(snake.current.map((s) => `${s.x},${s.y}`))
    for (let i = 0; i < 200; i++) {
      const p = { x: Math.floor(Math.random() * cols.current), y: Math.floor(Math.random() * ROWS) }
      /* ⚠️ the same bug this repo already fixed in the real game: an apple placed without
         checking the body spawns INSIDE the snake and is eaten instantly, or never. */
      if (!taken.has(`${p.x},${p.y}`)) return (apple.current = p)
    }
    return (apple.current = { x: 0, y: 0 })
  }, [])

  const reset = useCallback(() => {
    snake.current = [
      { x: 4, y: 5 },
      { x: 3, y: 5 },
      { x: 2, y: 5 },
    ]
    dir.current = { x: 1, y: 0 }
    /**
     * ⚠️ THE AUTOPILOT GETS IT BACK ON A DEATH, rather than the person keeping it for the rest
     * of HANDBACK_MS. Tap once and wander off and the snake held your last direction, drove into
     * the wall, restarted, drove into the same wall again — three or four times over six seconds.
     * A board restarting on a loop looks broken; one playing itself looks alive. Tapping again
     * takes it straight back.
     */
    humanAt.current = 0
    place()
  }, [place])

  /** would this move kill us on the very next step? */
  const fatal = (d: P) => {
    const h = snake.current[0]
    const n = { x: h.x + d.x, y: h.y + d.y }
    if (n.x < 0 || n.y < 0 || n.x >= cols.current || n.y >= ROWS) return true
    // the tail vacates as we move, so the last cell is not an obstacle
    return snake.current.slice(0, -1).some((s) => s.x === n.x && s.y === n.y)
  }

  const autopilot = () => {
    const h = snake.current[0]
    const a = apple.current
    const want: P[] = []
    if (a.x !== h.x) want.push({ x: Math.sign(a.x - h.x), y: 0 })
    if (a.y !== h.y) want.push({ x: 0, y: Math.sign(a.y - h.y) })
    // then anything at all that is not suicide, preferring to carry on straight
    want.push(dir.current, { x: 0, y: -1 }, { x: 0, y: 1 }, { x: -1, y: 0 }, { x: 1, y: 0 })
    for (const d of want) if (!fatal(d)) return d
    return dir.current
  }

  const step = useCallback(() => {
    const auto = !humanAt.current || performance.now() - humanAt.current > HANDBACK_MS
    if (auto) {
      humanAt.current = 0
      dir.current = autopilot()
    } else if (fatal(dir.current)) {
      /* a person drove into a wall: that is a real death, and starting over immediately is
         friendlier on a tile than a "you died" that nobody asked to read */
      reset()
      return
    }
    const h = snake.current[0]
    const n = { x: h.x + dir.current.x, y: h.y + dir.current.y }
    if (n.x < 0 || n.y < 0 || n.x >= cols.current || n.y >= ROWS) return reset()
    if (snake.current.slice(0, -1).some((s) => s.x === n.x && s.y === n.y)) return reset()
    snake.current.unshift(n)
    if (n.x === apple.current.x && n.y === apple.current.y) place()
    else snake.current.pop()
  }, [place, reset])

  const draw = useCallback(() => {
    const c = ref.current
    const g = c?.getContext('2d')
    if (!c || !g) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const w = c.width / dpr
    const h = c.height / dpr
    const cell = h / ROWS
    const ox = (w - cell * cols.current) / 2
    const oy = 0
    g.clearRect(0, 0, w, h)

    const a = apple.current
    g.fillStyle = '#e5484d'
    g.beginPath()
    g.arc(ox + (a.x + 0.5) * cell, oy + (a.y + 0.5) * cell, cell * 0.32, 0, Math.PI * 2)
    g.fill()

    const body = snake.current
    for (let i = 0; i < body.length; i++) {
      const s = body[i]
      /* the head is solid and the tail thins out, so which way it is going is readable at a
         glance on a board this small */
      g.globalAlpha = 1 - (i / Math.max(body.length, 1)) * 0.55
      g.fillStyle = i === 0 ? '#37d67a' : '#2aa85f'
      g.fillRect(ox + s.x * cell + 1, oy + s.y * cell + 1, cell - 2, cell - 2)
    }
    g.globalAlpha = 1
  }, [])

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
    c.getContext('2d')?.setTransform(dpr, 0, 0, dpr, 0, 0)
    const next = Math.max(MIN_COLS, Math.min(MAX_COLS, Math.floor(r.width / (r.height / ROWS))))
    if (next !== cols.current) {
      cols.current = next
      /* ⚠️ a narrower board can leave the snake or the apple outside it, and a body hanging off
         the edge never collides with anything again — so a real change of width starts over. */
      onCols.current?.()
    }
  }, [])
  /** set below: fit() runs before reset exists, so the callback is handed over rather than closed on */
  const onCols = useRef<null | (() => void)>(null)

  const loop = useCallback(
    (now: number) => {
      if (now - lastStep.current >= STEP) {
        lastStep.current = now
        step()
      }
      draw()
      raf.current = visible.current ? requestAnimationFrame(loop) : 0
    },
    [step, draw],
  )

  useEffect(() => {
    onCols.current = reset
    fit()
    reset()
    draw()
    const start = () => {
      if (!raf.current && visible.current) {
        lastStep.current = performance.now()
        raf.current = requestAnimationFrame(loop)
      }
    }
    /** on screen at all? one rect read, no observer to go quiet on us */
    const onScreen = () => {
      const c = ref.current
      if (!c) return false
      if (document.hidden) return false
      const r = c.getBoundingClientRect()
      return r.bottom > 0 && r.top < (window.innerHeight || 0) && r.width > 0
    }
    const check = () => {
      visible.current = onScreen()
      if (visible.current) start()
    }
    check()
    window.addEventListener('scroll', check, { passive: true })
    window.addEventListener('resize', check)
    document.addEventListener('visibilitychange', check)
    /* the belt to the braces: even with every event missed, this picks it up within a second, and
       an idle 1Hz rect read is nothing next to a 60Hz game loop */
    const poll = window.setInterval(check, 1000)

    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => fit())
    if (ro && ref.current) ro.observe(ref.current)
    window.addEventListener('resize', fit)
    return () => {
      ro?.disconnect()
      window.clearInterval(poll)
      window.removeEventListener('scroll', check)
      window.removeEventListener('resize', check)
      window.removeEventListener('resize', fit)
      document.removeEventListener('visibilitychange', check)
      cancelAnimationFrame(raf.current)
      raf.current = 0
    }
  }, [reset, fit, draw, loop])

  /** Takes the turn, or says it could not — see the tap handler for why the answer matters. */
  const steer = (d: P) => {
    // no reversing into yourself — the one input that turns a game into an instant death
    if (d.x === -dir.current.x && d.y === -dir.current.y) return false
    dir.current = d
    humanAt.current = performance.now()
    return true
  }

  return (
    <canvas
      ref={ref}
      className="hag-art hag-board"
      tabIndex={0}
      role="application"
      aria-label="A snake playing itself — click or tap it, then steer with the arrow keys"
      onKeyDown={(e) => {
        const d = DIRS[e.key]
        if (!d) return
        e.preventDefault()
        e.stopPropagation()
        steer(d)
      }}
      onPointerDown={(e) => {
        /* ⚠️ Tap-to-steer relative to the HEAD, not swipe. A swipe on a 104px-tall tile fights
           the page scroll, and the board deliberately does not take touch-action away from the
           page the way the scribble pad has to. Tap where you want it to go. */
        const c = e.currentTarget
        c.focus()
        const r = c.getBoundingClientRect()
        const cell = r.height / ROWS
        const ox = (r.width - cell * cols.current) / 2
        const oy = 0
        const gx = (e.clientX - r.left - ox) / cell
        const gy = (e.clientY - r.top - oy) / cell
        const h = snake.current[0]
        const dx = gx - (h.x + 0.5)
        const dy = gy - (h.y + 0.5)
        const across: P = { x: Math.sign(dx) || 1, y: 0 }
        const down: P = { x: 0, y: Math.sign(dy) || 1 }
        /**
         * ⚠️ TRY THE OTHER AXIS WHEN THE FIRST IS A REVERSE.
         *
         * Taking only the dominant axis made the whole half of the board BEHIND the head a dead
         * zone: moving right, every tap to the left resolved to "go left", which is the one turn
         * that is refused, so the tap did nothing whatsoever. Including taps like left-and-up,
         * where "up" is plainly what was meant. A tile that ignores you reads as broken, not as
         * strict. Only one axis can ever be the reverse, so the fallback always lands.
         */
        if (!steer(Math.abs(dx) > Math.abs(dy) ? across : down)) {
          steer(Math.abs(dx) > Math.abs(dy) ? down : across)
        }
      }}
    />
  )
}
