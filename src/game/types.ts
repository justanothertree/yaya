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

export type LeaderboardEntry = { username: string; score: number; date: string }

export type Mode = 'solo' | 'versus'

export type NetMessage =
  | { type: 'hello'; room: string }
  | { type: 'seed'; seed: number; settings: Settings }
  | { type: 'tick'; n: number; score: number }
  | { type: 'over'; reason: 'die' | 'quit' }
  | { type: 'input'; key: 'ArrowUp' | 'ArrowDown' | 'ArrowLeft' | 'ArrowRight' }
  | { type: 'presence'; count: number }
  | { type: 'ready' }
  | { type: 'name'; name: string }

export type ThemeColors = {
  bg: string
  snake: string
  apple: string
}
