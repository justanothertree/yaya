import { useEffect, useRef, useState } from 'react'

type Point = { x: number; y: number }
const GRID = 30
const SPEED_MS = 90

export function SnakeGame() {
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const cellRef = useRef<number>(16)
  const [score, setScore] = useState(0)
  const [running, setRunning] = useState(false)

  useEffect(() => {
    const wrapper = wrapRef.current!
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!

    // game state
    let snake: Point[] = [{ x: 5, y: 5 }]
    let dir: Point = { x: 1, y: 0 }
    let food: Point = randomFood()
    let timer: number | undefined
    let touchStart: { x: number; y: number } | null = null

    function randomFood(): Point {
      return { x: Math.floor(Math.random() * GRID), y: Math.floor(Math.random() * GRID) }
    }

    function resizeCanvas() {
      const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1))
      // Fit square canvas by constraining to smallest of width and available height
      const headerFooterSpace = 220 // approximate nav+controls height in px
      const availH = Math.max(240, window.innerHeight - headerFooterSpace)
      const maxWidth = Math.min(wrapper.clientWidth, 520, availH)
      const cell = Math.max(10, Math.floor(maxWidth / GRID))
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

    function step() {
      const head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y }
      // wrap
      head.x = (head.x + GRID) % GRID
      head.y = (head.y + GRID) % GRID

      // self hit
      if (snake.some((s) => s.x === head.x && s.y === head.y)) {
        setScore(0)
        snake = [{ x: 5, y: 5 }]
        dir = { x: 1, y: 0 }
        food = randomFood()
        draw()
        return
      }

      snake.unshift(head)
      if (head.x === food.x && head.y === food.y) {
        setScore((s: number) => s + 1)
        food = randomFood()
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

    // controls
    const onKey = (e: KeyboardEvent) => {
      // Prevent page scroll while using arrow keys over the game
      const activeEl = document.activeElement as HTMLElement | null
      const isTyping = ['input', 'textarea'].includes(activeEl?.tagName.toLowerCase() || '')
      if (!isTyping && ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', ' '].includes(e.key)) {
        e.preventDefault()
      }
      if (e.key === 'ArrowUp' && dir.y !== 1) dir = { x: 0, y: -1 }
      if (e.key === 'ArrowDown' && dir.y !== -1) dir = { x: 0, y: 1 }
      if (e.key === 'ArrowLeft' && dir.x !== 1) dir = { x: -1, y: 0 }
      if (e.key === 'ArrowRight' && dir.x !== -1) dir = { x: 1, y: 0 }
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
      if (Math.abs(dx) > Math.abs(dy)) {
        if (dx < 0 && dir.x !== 1) dir = { x: -1, y: 0 }
        if (dx > 0 && dir.x !== -1) dir = { x: 1, y: 0 }
      } else {
        if (dy < 0 && dir.y !== 1) dir = { x: 0, y: -1 }
        if (dy > 0 && dir.y !== -1) dir = { x: 0, y: 1 }
      }
      touchStart = null
    }

    window.addEventListener('keydown', onKey)
    canvas.style.touchAction = 'none'
    canvas.setAttribute('tabindex', '0')
    canvas.addEventListener('touchstart', onTouchStart, { passive: true })
    canvas.addEventListener('touchend', onTouchEnd)
    window.addEventListener('resize', resizeCanvas)

    resizeCanvas()
    if (running) timer = window.setInterval(step, SPEED_MS)

    return () => {
      window.removeEventListener('keydown', onKey)
      canvas.removeEventListener('touchstart', onTouchStart)
      canvas.removeEventListener('touchend', onTouchEnd)
      window.removeEventListener('resize', resizeCanvas)
      if (timer) window.clearInterval(timer)
    }
  }, [running])

  // On-screen D-pad for touch
  const setDir = (nx: number, ny: number) => {
    // fire a fake key event by directly updating direction via a temporary interval tick
    // The actual dir is captured inside effect closure; emulate by toggling running briefly
    // Simpler: toggle a hidden state to retrigger effect isn't ideal. Instead, dispatch a key event.
    const key =
      nx === -1 ? 'ArrowLeft' : nx === 1 ? 'ArrowRight' : ny === -1 ? 'ArrowUp' : 'ArrowDown'
    window.dispatchEvent(new KeyboardEvent('keydown', { key }))
  }

  return (
    <section className="card snake-wrap">
      <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <button className="btn" onClick={() => setRunning((r: boolean) => !r)}>
          {running ? 'Pause' : 'Play'}
        </button>
        <div className="muted">Score: {score}</div>
      </div>
      <div ref={wrapRef} style={{ width: '100%', display: 'grid', placeItems: 'center' }}>
        <canvas
          ref={canvasRef}
          style={{ marginTop: '1rem', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 8 }}
        />
      </div>
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
        Use arrow keys, swipe, or the on-screen controls. The snake wraps around edges.
      </p>
    </section>
  )
}
