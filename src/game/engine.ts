import { mulberry32, randInt } from './random'
import type { GameState, Point, Settings, TickResult } from './types'

export class GameEngine {
  readonly settings: Settings
  readonly grid: number
  private rand: () => number
  private state: GameState
  /**
   * Segments owed. In race mode the snake does NOT grow when the head reaches an apple — it
   * grows when the relay says the apple was yours. Growing on contact meant a player who lost a
   * photo-finish kept a segment they never scored for, so the snake's length and the scoreboard
   * disagreed. Length is driven by the authoritative score now, so they can't.
   *
   * Deferring growth by a tick or two is invisible: growing is just "don't drop the tail this
   * tick", and it doesn't matter which tick that happens on.
   */
  private owed = 0

  constructor(settings: Settings, seed: number) {
    this.settings = settings
    this.grid = settings.grid
    this.rand = mulberry32(seed)
    this.state = this.initialState()
  }

  reset(seed?: number) {
    if (typeof seed === 'number') this.rand = mulberry32(seed)
    this.owed = 0
    this.state = this.initialState()
    return this.snapshot()
  }

  /** Race only: the relay's apple list replaces ours. It is the one that counts. */
  setApples(apples: Point[]) {
    const clamp = (n: number) => Math.max(0, Math.min(this.grid - 1, Math.floor(n)))
    this.state.apples = apples.map((a) => ({ x: clamp(a.x), y: clamp(a.y) }))
  }

  /**
   * Race only: the relay confirmed `n` apples were yours, so grow by that much. Called with the
   * DIFFERENCE in your authoritative score, which is what keeps length and score in lockstep
   * even if a message is missed — a dropped `race` broadcast just means the next one owes two.
   */
  grow(n: number) {
    if (n > 0) this.owed += Math.floor(n)
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
    const appleIdx = s.apples.findIndex((a) => a.x === newHead.x && a.y === newHead.y)
    const onApple = appleIdx !== -1
    const race = !!this.settings.race

    /**
     * Classic grows the instant the head reaches an apple, because the apple was only ever ours
     * to take. Race can't: the apple is shared, and until the relay answers we don't know it was
     * ours. So growth waits on `owed`, which the relay's score fills in.
     */
    const willGrow = race ? this.owed > 0 : onApple

    // Self collision: exclude tail when not growing
    const bodyToCheck = willGrow ? s.snake : s.snake.slice(0, -1)
    if (bodyToCheck.some((p) => p.x === newHead.x && p.y === newHead.y)) {
      s.alive = false
      events.push({ type: 'die', at: newHead })
      return { state: this.snapshot(), events }
    }

    s.snake.unshift(newHead)
    // The event fires on CONTACT in both modes — in race it's what makes the client claim the
    // apple, and the claim has to go the moment you touch it or you lose races you won.
    if (onApple) events.push({ type: 'eat', at: newHead })
    if (willGrow) {
      if (race) this.owed -= 1
    } else {
      s.snake.pop()
    }
    if (onApple && !race) {
      // Classic only: we own the apples, so remove the eaten one and top the board back up.
      // In race the relay's next `apples` broadcast is what removes it — doing it here would
      // hide an apple that might still be there for everyone else.
      s.apples.splice(appleIdx, 1)
      this.spawnApplesUntil(this.settings.apples)
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
    this.state = start
    // Race apples belong to the relay and arrive by broadcast; spawning our own here would put
    // fruit on the board that nobody else can see and nobody can score.
    if (!this.settings.race) this.spawnApplesUntil(this.settings.apples)
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
