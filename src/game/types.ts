export type Point = { x: number; y: number }

export type CanvasSize = 'small' | 'medium' | 'large'

export type Settings = {
  grid: number // logical grid (e.g., 30x30)
  apples: number // number of apples on screen
  passThroughEdges: boolean // wrap vs wall death
  canvasSize: CanvasSize
  /**
   * Race: the apples are SHARED. Eat one and it is gone for everyone, which is what makes it a
   * race rather than everyone running the same course separately. That single word changes who
   * owns the game: in classic each client's engine spawns its own apples from a shared seed, so
   * boards drift apart the moment anyone scores; in race the relay owns the apple list and
   * decides who reached one first. Off by default, and classic is untouched by it.
   */
  race?: boolean
  /** first to this score wins the round. Only meaningful in race. */
  raceTarget?: number
  /** milliseconds per tick; lower is faster. Undefined keeps the historical default. */
  speedMs?: number
  /**
   * Show the other players on your own board as outlines you pass straight through. Without
   * them a race is you staring at your own snake and inferring everyone else from a scoreboard.
   * They are deliberately non-solid — see GameRenderer.setGhosts. Defaults to on.
   */
  ghosts?: boolean
}

export type Apple = Point

export type GameState = {
  snake: Point[]
  dir: Point
  apples: Apple[]
  alive: boolean
  ticks: number
}

export type EngineEvent = { type: 'eat'; at: Point } | { type: 'die'; at: Point }

export type TickResult = {
  state: GameState
  events: EngineEvent[]
}

export type LeaderboardEntry = { id?: number; username: string; score: number; date: string }

// Trophy counts associated with a player name (multiplayer round achievements)
export type TrophyCounts = { gold: number; silver: number; bronze: number }

export type Mode = 'solo' | 'versus'

export type NetMessage =
  | { type: 'hello'; room: string; clientId?: string; create?: boolean }
  | { type: 'welcome'; id: string; visitor?: number }
  | { type: 'seed'; roundId: string; seedData: { seed: number; settings: Settings } }
  | { type: 'settings'; settings: Settings }
  | { type: 'host'; hostId: string }
  | { type: 'restart'; roundId?: string }
  | { type: 'tick'; n: number; score: number; from?: string }
  | { type: 'over'; reason: 'die' | 'quit'; from?: string; score?: number }
  | { type: 'input'; key: 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight' }
  | { type: 'presence'; count: number }
  | { type: 'ready'; from?: string }
  | { type: 'spectate'; on: boolean; from?: string }
  | { type: 'name'; name: string; from?: string }
  | {
      type: 'preview'
      state: GameState
      score: number
      from?: string
      name?: string
      spectate?: boolean
    }
  /**
   * In-match chat. Ephemeral and room-scoped: the relay forwards it and keeps nothing, so
   * there is no history to load, moderate or leak. `name` is filled in by the server from the
   * name that player already announced to the room, rather than trusted from the sender —
   * otherwise anyone could put words in someone else's mouth.
   */
  | { type: 'chat'; text: string; from?: string; name?: string }
  /**
   * Race mode. The client claims an apple; the relay decides. `apples` is the authoritative
   * list — clients render that rather than their own — and `race` carries the scores the
   * winner is judged on, so a client that grew optimistically and lost the race still can't
   * score for it.
   */
  | { type: 'eat'; x: number; y: number; from?: string }
  | { type: 'apples'; apples: Apple[]; roundId?: string }
  | {
      type: 'race'
      scores: Array<{ id: string; name?: string; score: number }>
      target: number
      winner?: { id: string; name?: string; score: number }
    }
  | { type: 'roommeta'; name?: string; public?: boolean }
  | { type: 'list' }
  | { type: 'rooms'; items: Array<{ id: string; name: string; count: number }> }
  | { type: 'restart-ack'; roundId?: string }
  | { type: 'error'; code: 'room-not-found' | 'bad-request' | string; message?: string }
  | {
      type: 'results'
      roundId?: string
      total: number
      items: Array<{ id: string; name: string; score: number; place: number }>
      from?: string
      awarded?: boolean
    }

export type ThemeColors = {
  bg: string
  snake: string
  apple: string
}
