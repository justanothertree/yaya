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
  /**
   * Tron: your snake leaves a permanent trail and every trail is SOLID — hit any line, yours
   * included, and you're out. Last one riding wins. Unlike ghosts, this needs the relay to own
   * the trail and arbitrate every cell, which is why it's a mode rather than a toggle.
   */
  tron?: boolean
  /** tron: are OTHER riders' trails lethal, or only your own? Defaults to lethal. */
  tronRivals?: boolean
  /**
   * Solid bodies: run into another player's snake and you're out.
   *
   * Not the same as tron. A trail is permanent and turns the board into a maze; a body moves and
   * its tail vacates, so this is about the snakes themselves rather than where they've been.
   * Ghosts are drawn either way — this decides whether they're scenery or a hazard.
   *
   * Opt-in because it has an honest cost: the relay judges against each player's LAST reported
   * body, so its picture can be up to a tick stale and you can die to where someone was.
   */
  solidBodies?: boolean
  /**
   * Hungry: a meter that drains with time and refills when you eat.
   *
   * Deliberately not "eat or die". It degrades in stages — a nudge, then a shove, then real
   * damage — so the pressure is legible and you always have a moment to do something about it.
   * Entirely per-player, so unlike race and tron it needs nothing from the relay.
   */
  hunger?: boolean
  /** seconds of full meter; how long you can go between apples before it starts to hurt */
  hungerSeconds?: number
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
  /**
   * `settings` is only read when `create` is true and the room does not exist yet — it is what
   * the room is BORN with. A joiner cannot use it to rewrite rules that are already in force.
   */
  | { type: 'hello'; room: string; clientId?: string; create?: boolean; settings?: Settings }
  | { type: 'welcome'; id: string; visitor?: number }
  | {
      type: 'seed'
      roundId: string
      /** `apples` only in race, where the relay owns them and sends them WITH the round */
      seedData: {
        seed: number
        settings: Settings
        /** race only: the relay owns the apples and sends them WITH the round */
        apples?: Apple[]
        /** tron only: where each rider begins, so nobody shares a starting cell */
        starts?: Record<string, { x: number; y: number; dir: Point }>
      }
    }
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
  /** tron: claim the cell you're entering; the relay says whether you survive it */
  | { type: 'claim'; x: number; y: number }
  | { type: 'crash'; x: number; y: number }
  | { type: 'trail'; x: number; y: number; from?: string }
  | { type: 'tron'; over?: boolean; winner?: { id: string; name?: string } }
  | { type: 'apples'; apples: Apple[]; roundId?: string }
  | {
      type: 'race'
      scores: Array<{ id: string; name?: string; score: number }>
      target: number
      winner?: { id: string; name?: string; score: number }
    }
  | { type: 'roommeta'; name?: string; public?: boolean }
  /**
   * Client -> relay only, and never echoed to peers. Lets a signed-in player prove who they are
   * so finalize_round_rpc will credit a handle their account owns; the relay checks the token
   * with Supabase and takes the account id from that answer, never from this message.
   */
  | { type: 'auth'; token: string }
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
      /** Why it was not saved, in a word — only present when awarded is false. */
      awardedReason?: string
    }

export type ThemeColors = {
  bg: string
  snake: string
  apple: string
}
