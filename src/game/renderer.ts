import type { GameState, Point, ThemeColors } from './types'

export class GameRenderer {
  private ctx: CanvasRenderingContext2D
  private canvas: HTMLCanvasElement
  private grid: number
  private cell = 16
  private colors: ThemeColors
  /** other players, drawn as pass-through outlines — see setGhosts */
  private ghosts: Array<{ snake: Point[]; name?: string }> = []
  /** tron trails, keyed "x,y". Solid, unlike ghosts — these are what you die to. */
  private trail: Set<string> = new Set()

  constructor(canvas: HTMLCanvasElement, grid: number) {
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('2D context not available')
    this.ctx = ctx
    this.canvas = canvas
    this.grid = grid
    this.colors = this.readTheme()
  }

  setGrid(grid: number) {
    this.grid = grid
  }

  resize(container: HTMLElement, canvasSize: 'small' | 'medium' | 'large') {
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1))
    const wrapRect = container.getBoundingClientRect()
    const availH = Math.max(240, Math.floor(window.innerHeight - wrapRect.top - 24))
    const availW = Math.floor(container.clientWidth)
    const cap = canvasSize === 'large' ? 720 : canvasSize === 'medium' ? 560 : 420
    const square = Math.max(240, Math.min(availW, availH, cap))
    this.cell = Math.max(8, Math.floor(square / this.grid))
    const logical = this.grid * this.cell
    this.canvas.style.width = logical + 'px'
    this.canvas.style.height = logical + 'px'
    this.canvas.width = Math.floor(logical * dpr)
    this.canvas.height = Math.floor(logical * dpr)
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    this.colors = this.readTheme()
  }

  /**
   * The other players, drawn on YOUR board as outlines you pass straight through.
   *
   * This is what makes a race read as a race: without it you're staring at your own snake and
   * inferring everyone else from a scoreboard. They're ghosts on purpose — the engine never
   * hears about them, so they can't be collided with, and that's not a shortcut. Making them
   * solid would mean the relay arbitrating every body cell of every player on every tick, and
   * a phantom death from someone else's lag is a far worse feeling than passing through.
   */
  setGhosts(ghosts: Array<{ snake: Point[]; name?: string }>) {
    this.ghosts = ghosts
  }

  /** Tron trails, owned by the relay. Solid: the whole point is that these kill you. */
  setTrail(trail: Set<string>) {
    this.trail = trail
  }

  draw(state: GameState) {
    const { ctx, cell } = this
    // Refresh theme each frame to reflect runtime theme toggles
    this.colors = this.readTheme()
    const size = this.grid * cell
    ctx.fillStyle = this.colors.bg
    ctx.fillRect(0, 0, size, size)
    // apples
    ctx.fillStyle = this.colors.apple
    for (const a of state.apples) {
      ctx.fillRect(a.x * cell, a.y * cell, cell, cell)
    }
    // Trails first, under everything: they're scenery you must not touch, and drawing them
    // over the snakes would hide whose head is where at the moment that matters most.
    if (this.trail.size) {
      ctx.globalAlpha = 0.5
      ctx.fillStyle = this.colors.snake
      for (const key of this.trail) {
        const c = key.indexOf(',')
        const x = +key.slice(0, c)
        const y = +key.slice(c + 1)
        ctx.fillRect(x * cell + 1, y * cell + 1, cell - 2, cell - 2)
      }
      ctx.globalAlpha = 1
    }
    // Ghosts UNDER your own snake: when you overlap, you should still see yourself clearly —
    // you're the one being steered.
    if (this.ghosts.length) {
      const inset = Math.max(1, Math.floor(cell * 0.16))
      ctx.lineWidth = Math.max(1, Math.floor(cell * 0.14))
      for (const g of this.ghosts) {
        ctx.strokeStyle = this.colors.snake
        ctx.globalAlpha = 0.38
        for (let i = 0; i < g.snake.length; i++) {
          const p = g.snake[i]
          ctx.strokeRect(p.x * cell + inset, p.y * cell + inset, cell - inset * 2, cell - inset * 2)
        }
        // the head filled, so at a glance you can tell which way they're going
        const head = g.snake[0]
        if (head) {
          ctx.globalAlpha = 0.55
          ctx.fillStyle = this.colors.snake
          ctx.fillRect(
            head.x * cell + inset,
            head.y * cell + inset,
            cell - inset * 2,
            cell - inset * 2,
          )
        }
      }
      ctx.globalAlpha = 1
    }
    // snake
    ctx.fillStyle = this.colors.snake
    for (const p of state.snake) {
      ctx.fillRect(p.x * cell, p.y * cell, cell, cell)
    }
  }

  async animateDeath(state: GameState) {
    const { ctx, cell } = this
    const size = this.grid * cell
    // Simple fade+shrink animation over ~400ms
    const start = performance.now()
    const dur = 400
    await new Promise<void>((resolve) => {
      const step = (t: number) => {
        const k = Math.min(1, (t - start) / dur)
        // redraw background
        ctx.fillStyle = this.colors.bg
        ctx.fillRect(0, 0, size, size)
        // apples (dim)
        ctx.globalAlpha = 0.6
        ctx.fillStyle = this.colors.apple
        for (const a of state.apples) ctx.fillRect(a.x * cell, a.y * cell, cell, cell)
        // snake pieces shrinking
        ctx.globalAlpha = 1 - k
        ctx.fillStyle = this.colors.snake
        const shrink = Math.floor(cell * (1 - 0.6 * k))
        const pad = Math.floor((cell - shrink) / 2)
        for (const p of state.snake)
          ctx.fillRect(p.x * cell + pad, p.y * cell + pad, shrink, shrink)
        ctx.globalAlpha = 1
        if (k < 1) requestAnimationFrame(step)
        else resolve()
      }
      requestAnimationFrame(step)
    })
    // After animation completes, redraw final state so the snake remains visible
    this.draw(state)
  }

  private readTheme(): ThemeColors {
    const styles = getComputedStyle(document.documentElement)
    return {
      bg: styles.getPropertyValue('--bg').trim() || '#0b0f19',
      snake: styles.getPropertyValue('--accent').trim() || '#22c55e',
      apple: styles.getPropertyValue('--accent-2').trim() || '#ef4444',
    }
  }
}
