import { mulberry32, randInt } from './random'
import type { GameState, Point, Settings, TickResult } from './types'

export class GameEngine {
  readonly settings: Settings
  readonly grid: number
  private rand: () => number
  private state: GameState

  constructor(settings: Settings, seed: number) {
    this.settings = settings
    this.grid = settings.grid
    this.rand = mulberry32(seed)
    this.state = this.initialState()
  }

  reset(seed?: number) {
    if (typeof seed === 'number') this.rand = mulberry32(seed)
    this.state = this.initialState()
    return this.snapshot()
  }

  snapshot(): GameState {
    // Return a deep-ish copy to avoid accidental external mutation
    const s = this.state
    return {
      snake: s.snake.map((p) => ({ ...p })),
      dir: { ...s.dir },
      apples: s.apples.map((a) => ({ ...a })),
      alive: s.alive,
      ticks: s.ticks,
    }
  }

  loadSnapshot(s: GameState) {
    // Basic validation and deep copy to protect internal state
    const clamp = (n: number) => Math.max(0, Math.min(this.grid - 1, n))
    const snake = s.snake.map((p) => ({ x: clamp(p.x), y: clamp(p.y) }))
    const dir = { x: Math.sign(s.dir.x) as -1 | 0 | 1, y: Math.sign(s.dir.y) as -1 | 0 | 1 }
    const apples = s.apples.map((a) => ({ x: clamp(a.x), y: clamp(a.y) }))
    this.state = {
      snake,
      dir,
      apples,
      alive: !!s.alive,
      ticks: Math.max(0, Math.floor(s.ticks || 0)),
    }
    return this.snapshot()
  }

  setDirection(next: Point) {
    const d = this.state.dir
    // Prevent immediate reversal
    if (next.x === -d.x && next.y === -d.y) return
    this.state.dir = next
  }

  tick(): TickResult {
    if (!this.state.alive) return { state: this.snapshot(), events: [] }
    const events: TickResult['events'] = []
    const s = this.state
    const { grid } = this
    const pass = this.settings.passThroughEdges
    const head = s.snake[0]
    let nx = head.x + s.dir.x
    let ny = head.y + s.dir.y

    // Edge behavior
    if (pass) {
      nx = (nx + grid) % grid
      ny = (ny + grid) % grid
    } else {
      if (nx < 0 || ny < 0 || nx >= grid || ny >= grid) {
        s.alive = false
        events.push({
          type: 'die',
          at: { x: Math.max(0, Math.min(grid - 1, nx)), y: Math.max(0, Math.min(grid - 1, ny)) },
        })
        return { state: this.snapshot(), events }
      }
    }

    const newHead = { x: nx, y: ny }
    // Will eat?
    const appleIdx = s.apples.findIndex((a) => a.x === newHead.x && a.y === newHead.y)
    const willGrow = appleIdx !== -1

    // Self collision: exclude tail when not growing
    const bodyToCheck = willGrow ? s.snake : s.snake.slice(0, -1)
    if (bodyToCheck.some((p) => p.x === newHead.x && p.y === newHead.y)) {
      s.alive = false
      events.push({ type: 'die', at: newHead })
      return { state: this.snapshot(), events }
    }

    s.snake.unshift(newHead)
    if (willGrow) {
      events.push({ type: 'eat', at: newHead })
      // Remove the eaten apple and spawn a replacement to maintain target count
      s.apples.splice(appleIdx, 1)
      this.spawnApplesUntil(this.settings.apples)
    } else {
      s.snake.pop()
    }

    s.ticks += 1
    return { state: this.snapshot(), events }
  }

  private initialState(): GameState {
    const mid = Math.floor(this.grid / 2)
    const start: GameState = {
      snake: [{ x: mid, y: mid }],
      dir: { x: 1, y: 0 },
      apples: [],
      alive: true,
      ticks: 0,
    }
    // Fill apples deterministically
    this.state = start
    this.spawnApplesUntil(this.settings.apples)
    return this.snapshot()
  }

  private spawnApplesUntil(n: number) {
    const { grid } = this
    const s = this.state
    const collides = (p: Point) =>
      s.snake.some((q) => q.x === p.x && q.y === p.y) ||
      s.apples.some((q) => q.x === p.x && q.y === p.y)
    while (s.apples.length < n) {
      const p = { x: randInt(this.rand, grid), y: randInt(this.rand, grid) }
      if (!collides(p)) s.apples.push(p)
    }
  }
}
