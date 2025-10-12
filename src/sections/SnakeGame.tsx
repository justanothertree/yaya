import { useEffect, useRef, useState } from 'react'

type Point = { x: number; y: number }
const CELL = 16
const GRID = 30
const SPEED_MS = 90

export function SnakeGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [score, setScore] = useState(0)
  const [running, setRunning] = useState(false)

  useEffect(() => {
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!
    canvas.width = GRID * CELL
    canvas.height = GRID * CELL

    let snake: Point[] = [{ x: 5, y: 5 }]
    let dir: Point = { x: 1, y: 0 }
    let food: Point = randomFood()
    let timer: number | undefined

    function randomFood(): Point {
      return { x: Math.floor(Math.random() * GRID), y: Math.floor(Math.random() * GRID) }
    }

    function draw() {
      ctx.fillStyle = '#0b0f19'
      ctx.fillRect(0, 0, canvas.width, canvas.height)

      // food
      ctx.fillStyle = '#ef4444'
      ctx.fillRect(food.x * CELL, food.y * CELL, CELL, CELL)

      // snake
      ctx.fillStyle = '#22c55e'
      snake.forEach((p) => ctx.fillRect(p.x * CELL, p.y * CELL, CELL, CELL))
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
      } else {
        snake.pop()
      }
      draw()
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowUp' && dir.y !== 1) dir = { x: 0, y: -1 }
      if (e.key === 'ArrowDown' && dir.y !== -1) dir = { x: 0, y: 1 }
      if (e.key === 'ArrowLeft' && dir.x !== 1) dir = { x: -1, y: 0 }
      if (e.key === 'ArrowRight' && dir.x !== -1) dir = { x: 1, y: 0 }
    }
    window.addEventListener('keydown', onKey)
    draw()

    if (running) timer = window.setInterval(step, SPEED_MS)
    return () => { window.removeEventListener('keydown', onKey); if (timer) window.clearInterval(timer) }
  }, [running])

  return (
    <section className="card snake-wrap">
      <div style={{display:'flex', gap:'1rem', alignItems:'center'}}>
        <button className="btn" onClick={() => setRunning((r: boolean) => !r)}>{running ? 'Pause' : 'Play'}</button>
        <div className="muted">Score: {score}</div>
      </div>
      <canvas ref={canvasRef} style={{marginTop:'1rem', border:'1px solid rgba(255,255,255,0.1)', borderRadius:8}} />
      <p className="muted">Use arrow keys. The snake wraps around edges.</p>
    </section>
  )
}
