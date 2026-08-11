import { useEffect, useRef } from 'react'
import type { GameState } from './types'

/**
 * Watching someone else's game, full size.
 *
 * This costs almost nothing to build and that's worth knowing: the `preview` message every
 * client already broadcasts carries the sender's COMPLETE game state — snake, apples, score —
 * not a thumbnail. The small tiles were only ever a small rendering of data that was always
 * big enough for this. So there is no protocol work here, no relay change, and nothing extra
 * on the wire; it's the same stream drawn larger.
 *
 * Deliberately its own canvas rather than reusing GameRenderer: the renderer owns sizing tied
 * to the player's own settings and the live game loop, and borrowing it to paint someone
 * else's board would mean two owners fighting over one object. Drawing a static snapshot is a
 * dozen lines, and it can't disturb the game you're playing.
 */
export function SpectatorView({
  state,
  grid,
  name,
  score,
  status,
  peers,
  onSwitch,
  onClose,
}: {
  state: GameState
  grid: number
  name: string
  score: number
  status: string
  /** everyone watchable, in a stable order, so ‹ › always move the same way */
  peers: Array<{ id: string; name: string }>
  onSwitch: (dir: -1 | 1) => void
  onClose: () => void
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Read the palette off the document, so a custom palette applies here too — the same three
    // tokens the real board uses.
    const css = getComputedStyle(document.documentElement)
    const bg = css.getPropertyValue('--bg').trim() || '#0b0f19'
    const snake = css.getPropertyValue('--accent').trim() || '#22c55e'
    const apple = css.getPropertyValue('--accent-2').trim() || '#ef4444'
    const line = css.getPropertyValue('--border').trim() || 'rgba(255,255,255,0.1)'

    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1))
    const box = canvas.parentElement?.getBoundingClientRect()
    const square = Math.max(220, Math.min(box?.width ?? 420, 560))
    const cell = Math.max(6, Math.floor(square / grid))
    const logical = cell * grid
    canvas.style.width = logical + 'px'
    canvas.style.height = logical + 'px'
    canvas.width = Math.floor(logical * dpr)
    canvas.height = Math.floor(logical * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    ctx.fillStyle = bg
    ctx.fillRect(0, 0, logical, logical)

    ctx.strokeStyle = line
    ctx.lineWidth = 1
    for (let i = 1; i < grid; i++) {
      ctx.beginPath()
      ctx.moveTo(i * cell + 0.5, 0)
      ctx.lineTo(i * cell + 0.5, logical)
      ctx.stroke()
      ctx.beginPath()
      ctx.moveTo(0, i * cell + 0.5)
      ctx.lineTo(logical, i * cell + 0.5)
      ctx.stroke()
    }

    ctx.fillStyle = apple
    for (const a of state.apples) {
      ctx.beginPath()
      ctx.arc(
        a.x * cell + cell / 2,
        a.y * cell + cell / 2,
        Math.max(2, cell / 2 - 1),
        0,
        Math.PI * 2,
      )
      ctx.fill()
    }

    ctx.fillStyle = snake
    state.snake.forEach((p, i) => {
      // the head at full strength, the body a touch back, so direction reads at a glance
      ctx.globalAlpha = i === 0 ? 1 : 0.82
      ctx.fillRect(p.x * cell + 1, p.y * cell + 1, cell - 2, cell - 2)
    })
    ctx.globalAlpha = 1

    if (!state.alive) {
      ctx.fillStyle = 'rgba(0,0,0,0.45)'
      ctx.fillRect(0, 0, logical, logical)
      ctx.fillStyle = '#fff'
      ctx.font = '600 18px system-ui, sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText('Crashed', logical / 2, logical / 2)
    }
  }, [state, grid])

  return (
    <div className="spectate">
      <div className="spectate-bar">
        <button className="btn" onClick={() => onSwitch(-1)} disabled={peers.length < 2}>
          ‹
        </button>
        <div className="spectate-who">
          <strong>{name}</strong>
          <span className="muted">{status}</span>
        </div>
        <div className="spectate-score">{score}</div>
        <button className="btn" onClick={() => onSwitch(1)} disabled={peers.length < 2}>
          ›
        </button>
        <button className="btn" onClick={onClose} title="Back to your own game">
          ✕
        </button>
      </div>
      <div className="spectate-board">
        <canvas ref={canvasRef} />
      </div>
      {peers.length > 1 && (
        <div className="spectate-dots" aria-hidden>
          {peers.map((p) => (
            <i key={p.id} className={p.name === name ? 'is-on' : ''} />
          ))}
        </div>
      )}
    </div>
  )
}
