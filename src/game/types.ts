export type Point = { x: number; y: number }

export type CanvasSize = 'small' | 'medium' | 'large'

export type Settings = {
  grid: number // logical grid (e.g., 30x30)
  apples: number // number of apples on screen
  passThroughEdges: boolean // wrap vs wall death
  canvasSize: CanvasSize
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
  | { type: 'seed'; seed: number; settings: Settings }
  | { type: 'settings'; settings: Settings }
  | { type: 'host'; hostId: string }
  | { type: 'restart' }
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
  | { type: 'roommeta'; name?: string; public?: boolean }
  | { type: 'list' }
  | { type: 'rooms'; items: Array<{ id: string; name: string; count: number }> }
  | { type: 'error'; code: 'room-not-found' | 'bad-request' | string; message?: string }
  | {
      type: 'results'
      roundId?: number
      total: number
      items: Array<{ id: string; name: string; score: number; place: number }>
      from?: string
    }

export type ThemeColors = {
  bg: string
  snake: string
  apple: string
}
