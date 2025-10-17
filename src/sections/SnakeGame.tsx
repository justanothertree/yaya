import { useEffect, useRef, useState } from 'react'

type Point = { x: number; y: number }
const GRID = 30
const BASE_SPEED = 110 // ms; slower initial speed for clarity
const MIN_SPEED = 50 // ms floor
const SPEED_STEP = 4 // ms faster per food

type Leader = { name: string; score: number; date: string }
type Mode = 'easy' | 'normal' | 'hard'

export function SnakeGame({
  onControlChange,
  autoFocus,
}: {
  onControlChange?: (v: boolean) => void
  autoFocus?: boolean
}) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const cellRef = useRef<number>(16)
  const dirRef = useRef<Point>({ x: 1, y: 0 })
  const [score, setScore] = useState(0)
  const [running, setRunning] = useState(false)
  const [active, setActive] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [leaders, setLeaders] = useState<Leader[]>([])
  const [askNameOpen, setAskNameOpen] = useState(false)
  const [playerName, setPlayerName] = useState('')
  const [mode, setMode] = useState<Mode>('easy')
  const lastScoreRef = useRef(0)
  const scoreRef = useRef(0)
  const runningRef = useRef(false)
  const loopTimer = useRef<number | null>(null)
  const lastToggleRef = useRef(0)

  const controlCbRef = useRef(onControlChange)
  controlCbRef.current = onControlChange

  // Load leaderboard and player name
  useEffect(() => {
    try {
      const raw = localStorage.getItem('snake.leaderboard')
      if (raw) setLeaders(JSON.parse(raw))
    } catch {
      // ignore parse errors
    }
    try {
      const pn = localStorage.getItem('snake.player')
      if (pn) setPlayerName(pn)
    } catch {
      // ignore storage errors
    }
  }, [])

  const saveLeaders = (arr: Leader[]) => {
    setLeaders(arr)
    try {
      localStorage.setItem('snake.leaderboard', JSON.stringify(arr))
    } catch {
      // ignore storage errors
    }
  }

  useEffect(() => {
    const wrapper = wrapRef.current!
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!

    // game state
    let snake: Point[] = [{ x: 5, y: 5 }]
    let food: Point = randomFood()
    let obstacles: Point[] = []
    let timer: number | undefined
    let touchStart: { x: number; y: number } | null = null

    function randomFood(): Point {
      return { x: Math.floor(Math.random() * GRID), y: Math.floor(Math.random() * GRID) }
    }

    function resizeCanvas() {
      const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1))
      const wrapRect = wrapper.getBoundingClientRect()
      // Available height from wrapper top to bottom of the viewport minus small padding
      const availH = Math.max(240, Math.floor(window.innerHeight - wrapRect.top - 24))
      const availW = Math.floor(wrapper.clientWidth)
      // On desktop, allow a larger cap so it doesn't feel too small
      const isDesktop = window.matchMedia('(min-width: 900px)').matches
      const maxCap = isDesktop ? 640 : 520
      const square = Math.max(240, Math.min(availW, availH, maxCap))
      const cell = Math.max(10, Math.floor(square / GRID))
      cellRef.current = cell
      const logical = GRID * cell
      canvas.style.width = logical + 'px'
      canvas.style.height = logical + 'px'
      canvas.width = Math.floor(logical * dpr)
      canvas.height = Math.floor(logical * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      draw()
    }

    function draw() {
      const cell = cellRef.current
      const size = GRID * cell
      const styles = getComputedStyle(document.documentElement)
      const bg = styles.getPropertyValue('--bg').trim() || '#0b0f19'
      const snakeCol = styles.getPropertyValue('--accent').trim() || '#22c55e'
      const foodCol = styles.getPropertyValue('--accent-2').trim() || '#ef4444'
      ctx.fillStyle = bg
      ctx.fillRect(0, 0, size, size)
      // food
      ctx.fillStyle = foodCol
      ctx.fillRect(food.x * cell, food.y * cell, cell, cell)
      // snake
      ctx.fillStyle = snakeCol
      snake.forEach((p) => ctx.fillRect(p.x * cell, p.y * cell, cell, cell))
    }

    function getSpeed() {
      // Speed up with score, capped at MIN_SPEED
      const base = mode === 'hard' ? 90 : mode === 'normal' ? 100 : BASE_SPEED
      const step = mode === 'hard' ? 6 : mode === 'normal' ? 5 : SPEED_STEP
      const target = base - step * scoreRef.current
      return Math.max(MIN_SPEED, target)
    }

    function loop() {
      if (!runningRef.current) return
      step()
      const delay = getSpeed()
      timer = window.setTimeout(loop, delay)
      loopTimer.current = timer
    }

    function step() {
      const d = dirRef.current
      let nx = snake[0].x + d.x
      let ny = snake[0].y + d.y
      // wrap or wall collision based on mode
      if (mode === 'easy') {
        nx = (nx + GRID) % GRID
        ny = (ny + GRID) % GRID
      } else {
        if (nx < 0 || nx >= GRID || ny < 0 || ny >= GRID) {
          // hit wall => game over
          handleGameOver()
          return
        }
      }
      const head = { x: nx, y: ny }

      // self hit => game over
      if (snake.some((s) => s.x === head.x && s.y === head.y)) {
        handleGameOver()
        return
      }
      // obstacle hit
      if (obstacles.some((o) => o.x === head.x && o.y === head.y)) {
        handleGameOver()
        return
      }

      snake.unshift(head)
      if (head.x === food.x && head.y === food.y) {
        setScore((s: number) => {
          const next = s + 1
          scoreRef.current = next
          return next
        })
        food = randomFood()
        // spawn obstacles after eating based on mode
        if (mode === 'normal') maybeAddObstacle(0.5)
        if (mode === 'hard') maybeAddObstacle(1)
        // haptic feedback where supported
        try {
          if ('vibrate' in navigator) navigator.vibrate?.(15)
        } catch {
          // ignore haptics errors
        }
      } else {
        snake.pop()
      }
      draw()
    }

    function maybeAddObstacle(intensity: number) {
      // intensity 0..1 chance per food; place randomly not overlapping snake or food
      if (Math.random() > intensity) return
      for (let i = 0; i < 50; i++) {
        const p = randomFood()
        if (
          !snake.some((s) => s.x === p.x && s.y === p.y) &&
          !(food.x === p.x && food.y === p.y) &&
          !obstacles.some((o) => o.x === p.x && o.y === p.y)
        ) {
          obstacles.push(p)
          break
        }
      }
    }

    function handleGameOver() {
      const finalScore = scoreRef.current
      lastScoreRef.current = finalScore
      setRunning(false)
      runningRef.current = false
      setActive(false)
      // Reset state for next game
      setTimeout(() => {
        setScore(0)
        scoreRef.current = 0
        snake = [{ x: 5, y: 5 }]
        dirRef.current = { x: 1, y: 0 }
        food = randomFood()
        obstacles = []
        draw()
      }, 0)
      if (finalScore > 0) setAskNameOpen(true)
    }

    // controls
    const onKey = (e: KeyboardEvent) => {
      // Prevent page scroll while using arrow keys over the game
      const activeEl = document.activeElement as HTMLElement | null
      const isTyping = ['input', 'textarea'].includes(activeEl?.tagName.toLowerCase() || '')
      if (!isTyping && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) {
        e.preventDefault()
      }
      if (askNameOpen) return
      // Start on first arrow press if focused and not running
      if (
        !runningRef.current &&
        ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)
      ) {
        setRunning(true)
        runningRef.current = true
      }
      // Space toggles pause
      if (e.key === ' ') {
        const now = performance.now()
        if (now - lastToggleRef.current >= 200) {
          lastToggleRef.current = now
          const next = !runningRef.current
          setRunning(next)
          runningRef.current = next
          if (next) setActive(true)
        }
      }
      const d = dirRef.current
      if (e.key === 'ArrowUp' && d.y !== 1) dirRef.current = { x: 0, y: -1 }
      if (e.key === 'ArrowDown' && d.y !== -1) dirRef.current = { x: 0, y: 1 }
      if (e.key === 'ArrowLeft' && d.x !== 1) dirRef.current = { x: -1, y: 0 }
      if (e.key === 'ArrowRight' && d.x !== -1) dirRef.current = { x: 1, y: 0 }
    }
    const onTouchStart = (e: TouchEvent) => {
      const t = e.touches[0]
      touchStart = { x: t.clientX, y: t.clientY }
    }
    const onTouchEnd = (e: TouchEvent) => {
      if (!touchStart) return
      const t = e.changedTouches[0]
      const dx = t.clientX - touchStart.x
      const dy = t.clientY - touchStart.y
      const d = dirRef.current
      if (Math.abs(dx) > Math.abs(dy)) {
        if (dx < 0 && d.x !== 1) dirRef.current = { x: -1, y: 0 }
        if (dx > 0 && d.x !== -1) dirRef.current = { x: 1, y: 0 }
      } else {
        if (dy < 0 && d.y !== 1) dirRef.current = { x: 0, y: -1 }
        if (dy > 0 && d.y !== -1) dirRef.current = { x: 0, y: 1 }
      }
      touchStart = null
    }

    window.addEventListener('keydown', onKey)
    canvas.style.touchAction = 'none'
    canvas.setAttribute('tabindex', '0')
    const onFocus = () => {
      setActive(true)
      controlCbRef.current?.(true)
    }
    const onBlur = () => {
      // Border indicates keyboard control: if blurred, remove active
      setActive(false)
      controlCbRef.current?.(false)
    }
    canvas.addEventListener('focus', onFocus)
    canvas.addEventListener('blur', onBlur)
    canvas.addEventListener('touchstart', onTouchStart, { passive: true })
    canvas.addEventListener('touchend', onTouchEnd)
    window.addEventListener('resize', resizeCanvas)
    const onFsChange = () => {
      const docFS = document as Document & { webkitFullscreenElement?: Element | null }
      const fsEl = docFS.fullscreenElement ?? docFS.webkitFullscreenElement ?? null
      const now = fsEl === wrapper
      setIsFullscreen(!!now)
      if (now) canvas.focus()
      resizeCanvas()
    }
    document.addEventListener('fullscreenchange', onFsChange)
    document.addEventListener('webkitfullscreenchange', onFsChange)

    resizeCanvas()
    // Start/stop loop
    runningRef.current = running
    if (running) {
      // Kick off immediately for responsiveness
      const delay = 0
      timer = window.setTimeout(loop, delay)
      loopTimer.current = timer
    }
    // If asked, focus the canvas when mounted/active
    if (autoFocus) {
      setTimeout(() => canvas.focus(), 0)
    }

    return () => {
      window.removeEventListener('keydown', onKey)
      canvas.removeEventListener('focus', onFocus)
      canvas.removeEventListener('blur', onBlur)
      canvas.removeEventListener('touchstart', onTouchStart)
      canvas.removeEventListener('touchend', onTouchEnd)
      window.removeEventListener('resize', resizeCanvas)
      if (timer) window.clearTimeout(timer)
      document.removeEventListener('fullscreenchange', onFsChange)
      document.removeEventListener(
        'webkitfullscreenchange' as unknown as keyof DocumentEventMap,
        onFsChange as EventListener,
      )
    }
  }, [running, autoFocus, mode, askNameOpen])

  // On-screen D-pad for touch/mouse
  const setDir = (nx: number, ny: number) => {
    const d = dirRef.current
    if (nx === -1 && d.x !== 1) dirRef.current = { x: -1, y: 0 }
    if (nx === 1 && d.x !== -1) dirRef.current = { x: 1, y: 0 }
    if (ny === -1 && d.y !== 1) dirRef.current = { x: 0, y: -1 }
    if (ny === 1 && d.y !== -1) dirRef.current = { x: 0, y: 1 }
    // Bring focus to canvas so keyboard arrows control the game
    canvasRef.current?.focus()
    onControlChange?.(true)
  }

  const toggleFullscreen = async () => {
    const wrapper = wrapRef.current
    if (!wrapper) return
    const docFS = document as Document & {
      webkitFullscreenElement?: Element | null
      webkitExitFullscreen?: () => Promise<void>
    }
    const isFs = docFS.fullscreenElement || docFS.webkitFullscreenElement
    try {
      if (!isFs) {
        const wfs = wrapper as HTMLElement & { webkitRequestFullscreen?: () => Promise<void> }
        const req = wfs.requestFullscreen || wfs.webkitRequestFullscreen
        if (req) await req.call(wfs)
      } else {
        const exit = docFS.exitFullscreen || docFS.webkitExitFullscreen
        if (exit) await exit.call(docFS)
      }
    } catch {
      // ignore FS errors
    }
  }

  const onSubmitScore = () => {
    const n = playerName.trim() || 'Player'
    try {
      localStorage.setItem('snake.player', n)
    } catch {
      // ignore storage errors
    }
    const entry: Leader = { name: n, score: lastScoreRef.current, date: new Date().toISOString() }
    const next = [...leaders, entry].sort((a, b) => b.score - a.score).slice(0, 10)
    saveLeaders(next)
    setAskNameOpen(false)
  }

  const clearLeaders = () => {
    saveLeaders([])
  }

  return (
    <div className="snake-wrap">
      {/* Toolbar */}
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <button
          className="btn"
          onClick={() => {
            const now = performance.now()
            if (now - lastToggleRef.current < 200) return // debounce pause spam
            lastToggleRef.current = now
            const next = !running
            setRunning(next)
            if (next) {
              canvasRef.current?.focus()
              onControlChange?.(true)
              setActive(true)
            } else {
              onControlChange?.(false)
              setActive(false)
            }
          }}
        >
          {running ? 'Pause' : 'Play'}
        </button>
        <button className="btn" onClick={toggleFullscreen}>
          {isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
        </button>
        <div className="muted">Score: {score}</div>
        <div aria-label="Mode" style={{ display: 'inline-flex', gap: 6, marginLeft: 8 }}>
          {(['easy', 'normal', 'hard'] as Mode[]).map((m) => (
            <button
              key={m}
              className="btn"
              aria-pressed={mode === m}
              onClick={() => {
                setMode(m)
                // reset immediately when changing mode
                setRunning(false)
                runningRef.current = false
                setActive(false)
                try {
                  localStorage.setItem('snake.mode', m)
                } catch {
                  /* ignore */
                }
              }}
              style={{
                opacity: mode === m ? 1 : 0.7,
                background: mode === m ? 'var(--accent)' : 'var(--control-bg)',
                color: mode === m ? 'var(--btn-text)' : 'var(--text)',
                border: '1px solid var(--border)',
              }}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      {/* Game wrapper (fullscreen target) */}
      <div
        ref={wrapRef}
        style={{ width: '100%', display: 'grid', placeItems: 'center', position: 'relative' }}
      >
        {isFullscreen && !askNameOpen && (
          <div
            style={{ position: 'absolute', top: 8, right: 8, display: 'flex', gap: 8, zIndex: 5 }}
          >
            <button
              className="btn"
              onClick={() => {
                const now = performance.now()
                if (now - lastToggleRef.current < 200) return
                lastToggleRef.current = now
                const next = !running
                setRunning(next)
                runningRef.current = next
                if (next) setActive(true)
              }}
            >
              {running ? 'Pause' : 'Play'}
            </button>
            <button className="btn" onClick={toggleFullscreen}>
              Exit
            </button>
          </div>
        )}
        <canvas
          ref={canvasRef}
          className={active ? 'snake-active' : ''}
          style={{ marginTop: '1rem', border: '2px solid var(--border)', borderRadius: 8 }}
        />

        {/* In fullscreen, render the modal overlay inside the wrapper so it's visible */}
        {isFullscreen && askNameOpen && (
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Save your score"
            onClick={() => setAskNameOpen(false)}
            style={{
              position: 'absolute',
              inset: 0,
              background: 'rgba(0,0,0,0.6)',
              display: 'grid',
              placeItems: 'center',
              zIndex: 10,
            }}
          >
            <div
              className="card"
              style={{
                maxWidth: 420,
                width: '90%',
                cursor: 'auto',
                background: 'var(--bg)',
                borderColor: 'var(--border-strong)',
              }}
              onClick={(e) => e.stopPropagation()}
            >
              <h2 className="section-title" style={{ marginTop: 0 }}>
                Nice run! Save your score
              </h2>
              <p className="muted">Score: {lastScoreRef.current}</p>
              <label className="muted" htmlFor="player-name">
                Name
              </label>
              <input
                id="player-name"
                value={playerName}
                onChange={(e) => setPlayerName(e.target.value)}
                autoFocus
                style={{
                  width: '100%',
                  padding: '0.5rem',
                  borderRadius: 8,
                  border: '1px solid var(--border)',
                  background: 'transparent',
                  color: 'var(--text)',
                }}
              />
              <div
                style={{
                  marginTop: '0.75rem',
                  display: 'flex',
                  gap: 8,
                  justifyContent: 'flex-end',
                }}
              >
                <button className="btn" onClick={() => setAskNameOpen(false)}>
                  Cancel
                </button>
                <button className="btn" onClick={onSubmitScore}>
                  Save
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* D-pad */}
      <div className="dpad" aria-label="Snake controls">
        <button className="dpad-btn" onClick={() => setDir(0, -1)} aria-label="Up">
          ▲
        </button>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr 1fr',
            gap: 8,
            alignItems: 'center',
          }}
        >
          <button className="dpad-btn" onClick={() => setDir(-1, 0)} aria-label="Left">
            ◀
          </button>
          <span />
          <button className="dpad-btn" onClick={() => setDir(1, 0)} aria-label="Right">
            ▶
          </button>
        </div>
        <button className="dpad-btn" onClick={() => setDir(0, 1)} aria-label="Down">
          ▼
        </button>
      </div>

      <p className="muted">
        Use arrow keys to start and steer, space to pause, swipe or D‑pad on touch. Easy wraps at
        edges; Normal/Hard use walls and add obstacles.
      </p>

      {/* Leaderboard */}
      {leaders.length > 0 && (
        <div style={{ marginTop: '0.75rem' }}>
          <h3 className="section-title" style={{ marginTop: 0 }}>
            Top scores
          </h3>
          <ol style={{ margin: 0, paddingLeft: '1.25rem' }}>
            {leaders.map((l, i) => (
              <li key={i} className="muted">
                <strong style={{ color: 'var(--text)' }}>{l.name}</strong> — {l.score}
              </li>
            ))}
          </ol>
          <div style={{ marginTop: '0.5rem' }}>
            <button className="btn" onClick={clearLeaders}>
              Clear leaderboard
            </button>
          </div>
        </div>
      )}

      {/* Name prompt modal (non-fullscreen case) */}
      {!isFullscreen && askNameOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Save your score"
          onClick={() => setAskNameOpen(false)}
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.6)',
            display: 'grid',
            placeItems: 'center',
            zIndex: 300,
          }}
        >
          <div
            className="card"
            style={{
              maxWidth: 420,
              width: '90%',
              cursor: 'auto',
              background: 'var(--bg)',
              borderColor: 'var(--border-strong)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="section-title" style={{ marginTop: 0 }}>
              Nice run! Save your score
            </h2>
            <p className="muted">Score: {lastScoreRef.current}</p>
            <label className="muted" htmlFor="player-name">
              Name
            </label>
            <input
              id="player-name"
              value={playerName}
              onChange={(e) => setPlayerName(e.target.value)}
              autoFocus
              style={{
                width: '100%',
                padding: '0.5rem',
                borderRadius: 8,
                border: '1px solid var(--border)',
                background: 'transparent',
                color: 'var(--text)',
              }}
            />
            <div
              style={{ marginTop: '0.75rem', display: 'flex', gap: 8, justifyContent: 'flex-end' }}
            >
              <button className="btn" onClick={() => setAskNameOpen(false)}>
                Cancel
              </button>
              <button className="btn" onClick={onSubmitScore}>
                Save
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
