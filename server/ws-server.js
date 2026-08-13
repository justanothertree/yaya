/* Simple WebSocket game server implementing server-authoritative round IDs.
 * Responsibilities:
 *  - Manage rooms and host assignment
 *  - On host 'restart' request: generate UUID roundId, broadcast restart { roundId }
 *  - Immediately (or after tiny delay) broadcast seed { type:'seed', roundId, seedData:{ seed, settings } }
 *  - Echo player messages needed by client (name, ready, spectate, preview, tick, over, settings)
 *  - Reassign host on host disconnect
 *  - Finalize multiplayer rounds via Supabase finalize_round_rpc (server-owned finalize).
 */

import { createServer } from 'http'
import { WebSocketServer } from 'ws'
import crypto from 'crypto'
import { createClient } from '@supabase/supabase-js'

const PORT = process.env.PORT ? Number(process.env.PORT) : 8080
const WS_DEBUG = process.env.WS_DEBUG === '1' || process.env.WS_DEBUG === 'true'

// Max incoming message size (32 KB) – prevents DoS via huge payloads.
const MAX_MSG_BYTES = 32768
// Max length for user-supplied strings before they are truncated.
const MAX_NAME_LEN = 64
// In-match chat. Nothing is stored: the relay forwards a line to the room and forgets it.
const MAX_CHAT_LEN = 300
// A relay that forwards anything to everyone needs a ceiling, or one client can flood a room.
const CHAT_BURST = 5
const CHAT_WINDOW_MS = 4000
const MAX_ROOM_ID_LEN = 64

// Default settings mirrored from client DEFAULT_SETTINGS
const DEFAULT_SETTINGS = {
  grid: 30,
  // Mirrors DEFAULT_SETTINGS in src/game/manager.tsx — change both together.
  apples: 4,
  passThroughEdges: true,
  canvasSize: 'medium',
}

// Supabase env (server-side). These should be configured in Render:
// SUPABASE_URL, SUPABASE_ANON_KEY
const SUPABASE_URL = process.env.SUPABASE_URL || ''
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || ''
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const SCHED_INTERVAL_MS = Number(process.env.SCHEDULE_TICK_MS || 30000)
const SCHEDULE_BATCH_SIZE = Number(process.env.SCHEDULE_BATCH_SIZE || 50)

function createSupabaseServiceClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

async function runDueScheduledTradesTick(sb) {
  if (!sb) return
  try {
    const { data, error } = await sb.rpc('run_due_scheduled_trades', {
      limit_count: SCHEDULE_BATCH_SIZE,
    })
    if (error) {
      console.error('[ws][scheduler] run_due_scheduled_trades failed', error.message || error)
      return
    }
    const processed = Number(data?.processed ?? 0)
    const done = Number(data?.done ?? 0)
    const failed = Number(data?.failed ?? 0)
    if (processed > 0 || done > 0 || failed > 0) {
      console.log(`[ws][scheduler] processed=${processed} done=${done} failed=${failed}`)
    }
  } catch (err) {
    console.error('[ws][scheduler] unexpected error', err)
  }
}

/** Room state structure */
const rooms = new Map()
// rooms.set(roomId, {
//   clients: Map<id, ws>,
//   hostId,
//   settings,
//   seed,
//   roundId,
//   visitorCounter,
//   state: Map<id, { name?: string, ready?: boolean, spectate?: boolean, lastScore?: number, finished?: boolean }>,
//   round: {
//     active: boolean,
//     id: string | null,
//     participants: Set<string>, // frozen for the duration of the round (except disconnects)
//     finished: Set<string>, // participants that have sent a terminal "over" (or been dropped)
//     finishOrder: string[],
//     finalizing?: boolean,
//     finalized?: boolean,
//   },
//   meta: { name: string, public: boolean, createdAt: number }
// })

function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID()
  return crypto.randomBytes(16).toString('hex')
}

function pickHost(room) {
  const ids = Array.from(room.clients.keys())
  if (!ids.length) return null
  // Prefer existing host if still connected
  if (room.hostId && room.clients.has(room.hostId)) return room.hostId
  room.hostId = ids[0]
  return room.hostId
}

function broadcast(room, payload, exceptId) {
  const str = JSON.stringify(payload)
  for (const [id, ws] of room.clients) {
    if (ws.readyState === ws.OPEN && id !== exceptId) {
      try {
        ws.send(str)
      } catch {
        /* ignore */
      }
    }
  }
}

function send(ws, payload) {
  try {
    ws.send(JSON.stringify(payload))
  } catch {
    /* ignore */
  }
}

function makeSeed(room) {
  // Random seed for engine; store for potential debugging
  room.seed = Math.floor(Math.random() * 1e9)
  const settings = room.settings || DEFAULT_SETTINGS
  const roundId = room.roundId || uuid() // fallback (should already exist post-restart)
  const seedData = { seed: room.seed, settings }
  /**
   * Race apples ride ALONG WITH the seed rather than in a message after it.
   *
   * They used to be a separate broadcast, and the board started empty for a second or two:
   * the seed makes the client throw its engine away and build a new one, so an apple list that
   * arrives around the same moment lands on whichever engine happens to exist right then.
   * Carrying them in the seed makes the round and its apples one atomic thing — there is no
   * ordering left to get wrong.
   */
  if (settings.race) {
    startRace(room)
    seedData.apples = room.apples
  }
  // Tron's board is empty at the start by definition — the trails ARE the round — so there is
  // nothing to send with the seed, only state to clear.
  if (settings.solidBodies) room.crashed = new Set()
  if (settings.tron) {
    startTron(room)
    seedData.starts = tronStarts(room)
  }
  return { type: 'seed', roundId, seedData }
}

function sanitizeSettings(input, prev) {
  const next = { ...(prev || DEFAULT_SETTINGS) }
  if (!input || typeof input !== 'object') return next
  const s = input
  if (typeof s.apples === 'number' && s.apples >= 1 && s.apples <= 4) next.apples = s.apples
  if (typeof s.passThroughEdges === 'boolean') next.passThroughEdges = s.passThroughEdges
  if (typeof s.grid === 'number' && s.grid >= 10 && s.grid <= 60) next.grid = s.grid
  if (typeof s.canvasSize === 'string' && ['small', 'medium', 'large'].includes(s.canvasSize)) {
    next.canvasSize = s.canvasSize
  }
  if (typeof s.race === 'boolean') next.race = s.race
  if (typeof s.tron === 'boolean') next.tron = s.tron
  if (typeof s.tronRivals === 'boolean') next.tronRivals = s.tronRivals
  if (typeof s.solidBodies === 'boolean') next.solidBodies = s.solidBodies
  if (typeof s.ghosts === 'boolean') next.ghosts = s.ghosts
  /**
   * Hunger was missing here, and the symptom was baffling: toggling it on in a room flickered
   * and the seconds options never appeared. This list is an ALLOWLIST — anything absent is
   * dropped — so the client set hunger, sent it, and the relay echoed the room's settings back
   * without it, undoing the click. A setting that isn't here doesn't half-work, it silently
   * reverts. Add new ones here at the same time as the client control.
   */
  if (typeof s.hunger === 'boolean') next.hunger = s.hunger
  if (typeof s.hungerSeconds === 'number' && s.hungerSeconds >= 5 && s.hungerSeconds <= 120) {
    next.hungerSeconds = Math.floor(s.hungerSeconds)
  }
  if (typeof s.raceTarget === 'number' && s.raceTarget >= 5 && s.raceTarget <= 500) {
    next.raceTarget = Math.floor(s.raceTarget)
  }
  if (typeof s.speedMs === 'number' && s.speedMs >= 40 && s.speedMs <= 400) {
    next.speedMs = Math.floor(s.speedMs)
  }
  return next
}

/* ── race mode: the relay owns the apples ────────────────────────────────────
 * In classic, every client spawns its own apples from a shared seed. The seed makes the
 * STARTING board identical, but each client respawns when ITS player eats, so the boards drift
 * apart the moment anyone scores. That's fine for "same course, separate runs" and it is not a
 * race: nobody can take an apple from anybody.
 *
 * Race makes the apples shared, and shared state needs one owner. This is it. Clients claim an
 * apple; the relay decides who got there first, and the score it keeps is the one the winner is
 * judged on — a client that grew optimistically and lost the race still doesn't score for it.
 */

/** mulberry32, same as the client's, so a room's apples are reproducible from its seed. */
function makeRand(seed) {
  let t = seed >>> 0
  return function rand() {
    t += 0x6d2b79f5
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r)
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

function spawnApples(room) {
  const grid = (room.settings || DEFAULT_SETTINGS).grid || 30
  const want = (room.settings || DEFAULT_SETTINGS).apples || 2
  const taken = (p) => room.apples.some((a) => a.x === p.x && a.y === p.y)
  // Bounded: a full board would otherwise spin here forever.
  let guard = grid * grid * 4
  while (room.apples.length < want && guard-- > 0) {
    const p = { x: Math.floor(room.rand() * grid), y: Math.floor(room.rand() * grid) }
    if (!taken(p)) room.apples.push(p)
  }
}

/* ── tron: the relay owns the trails ─────────────────────────────────────────
 * Ghost snakes are drawn but not solid, because collision needs an arbiter and a phantom death
 * from someone else's lag feels terrible. Tron is the mode where they ARE solid, so it needs
 * that arbiter — and this is the same shape as apples: one owner, clients claim, relay decides.
 *
 * Each move a client claims the cell it is entering. Taken already, by anyone including itself?
 * That client crashed. Free? The cell becomes trail and everyone is told to draw it.
 *
 * This works here because the round trip is well under one tick (~32ms measured against the
 * deployed relay, versus 110ms a tick at normal speed), so a claim resolves before the player's
 * next move. It would be the wrong design on a slow link, where you would die a tick after the
 * fact for a cell that looked empty.
 */

function startTron(room) {
  // A Map, not a Set: the cell has to remember WHOSE line it is, because whether a rival's
  // trail is lethal is a setting. Without an owner the relay can only answer "is this taken",
  // which is the wrong question when only your own line kills you.
  room.trail = new Map()
  room.crashed = new Set()
}

/**
 * Where each rider starts.
 *
 * Every snake is spawned on the middle cell, which is fine when boards are private — in classic
 * and race you each have your own copy of the grid. Tron shares one board, so identical starts
 * mean everyone is stacked on the same square and the round is decided on tick one. Riders are
 * spread evenly around a circle, each facing along it, so nobody begins pointed at a wall or at
 * somebody's face.
 */
function tronStarts(room) {
  const grid = (room.settings || DEFAULT_SETTINGS).grid || 30
  const ids = Array.from(room.clients.keys()).filter((pid) => !(room.state.get(pid) || {}).spectate)
  const r = Math.max(3, Math.floor(grid / 3))
  const mid = Math.floor(grid / 2)
  const starts = {}
  ids.forEach((pid, i) => {
    const a = (i / Math.max(1, ids.length)) * Math.PI * 2
    const x = Math.min(grid - 1, Math.max(0, Math.round(mid + Math.cos(a) * r)))
    const y = Math.min(grid - 1, Math.max(0, Math.round(mid + Math.sin(a) * r)))
    // tangent to the circle: everyone sets off the same way round, so the opening seconds are
    // a chase rather than a head-on
    starts[pid] = { x, y, dir: { x: Math.round(-Math.sin(a)), y: Math.round(Math.cos(a)) } }
  })
  return starts
}

const cellKey = (x, y) => x + ',' + y

/**
 * Who is still riding.
 *
 * Two things this must NOT do. It must not count people who merely have the page open: a round's
 * participants are frozen at the start, so somebody sitting in the lobby or who joined midway
 * would otherwise keep the round alive forever because they can never crash. And it must not
 * count people who have gone: room.state is deliberately never deleted on disconnect, so a
 * departed player would linger as an eternal survivor.
 */
function stillRiding(room) {
  const r = room.round
  const pool =
    r && r.active && r.participants && r.participants.size
      ? Array.from(r.participants)
      : Array.from(room.clients.keys())
  return pool.filter(
    (pid) =>
      room.clients.has(pid) && !room.crashed.has(pid) && !(room.state.get(pid) || {}).spectate,
  )
}

/** Start a race round: fresh apples, scores back to zero. */
function startRace(room) {
  room.rand = makeRand(room.seed || 1)
  room.apples = []
  room.raceScores = new Map()
  room.raceWinner = null
  spawnApples(room)
}

function raceScorePayload(room) {
  const target = (room.settings || DEFAULT_SETTINGS).raceTarget || 50
  const scores = []
  for (const [id, score] of room.raceScores || []) {
    scores.push({ id, name: (room.state.get(id) || {}).name, score })
  }
  scores.sort((a, b) => b.score - a.score)
  return { type: 'race', scores, target, ...(room.raceWinner ? { winner: room.raceWinner } : {}) }
}

async function finalizeRoundOnSupabase(roomId, roundId, gameMode, baseItems) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null
  const payload = {
    p_room_id: roomId,
    p_round_id: roundId,
    p_game_mode: gameMode || 'survival',
    p_items: baseItems.map((row) => ({
      id: String(row.id),
      name: row.name,
      score: Number(row.score || 0),
      finishIdx: Number(row.finishIdx ?? 9999),
    })),
    p_players: baseItems.map((row) => ({ id: String(row.id), name: row.name })),
  }
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/finalize_round_rpc`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })
    if (!res.ok) {
      console.error('[ws] finalize_round_rpc HTTP error', res.status, await res.text())
      return null
    }
    const data = await res.json()
    if (!Array.isArray(data)) return null
    return data
  } catch (err) {
    console.error('[ws] finalize_round_rpc exception', err)
    return null
  }
}

async function tryFinalize(room, roomId) {
  const r = room.round
  if (!r || !r.active || !r.id) return
  // Guard against duplicate finalization for the same (room, round)
  if (r.finalizing || r.finalized) return
  const parts = Array.from(r.participants || [])
  if (parts.length === 0) return
  // Ensure all participants have finished using the round-local finished set.
  // Spectators and non-participants are never considered here.
  if (!r.finished) r.finished = new Set()
  for (const pid of parts) {
    if (!r.finished.has(pid)) return
  }
  r.finalizing = true
  // Build base results {id,name,score,finishIdx}
  const base = parts.map((pid) => {
    const st = room.state.get(pid) || {}
    const name = (st.name || 'Player').trim()
    const score = Number(st.lastScore || 0)
    const idx = r.finishOrder.indexOf(pid)
    return { id: pid, name, score, finishIdx: idx >= 0 ? idx : 9999 }
  })
  base.sort((a, b) => (b.score !== a.score ? b.score - a.score : a.finishIdx - b.finishIdx))
  // Default local placement (used if Supabase is unavailable)
  let items = []
  let prevScore = null
  let prevPlace = 0
  for (let i = 0; i < base.length; i++) {
    const row = base[i]
    const place = prevScore !== null && row.score === prevScore ? prevPlace : i + 1
    items.push({ id: row.id, name: row.name, score: row.score, place })
    prevScore = row.score
    prevPlace = place
  }
  let awarded = false
  // Attempt server-owned Supabase finalize_round_rpc; idempotent in DB
  const rpcResults = await finalizeRoundOnSupabase(roomId, r.id, 'survival', base)
  if (Array.isArray(rpcResults) && rpcResults.length) {
    items = rpcResults.map((row) => ({
      id: String(row.id),
      name: String(row.name || 'Player'),
      score: Number(row.score || 0),
      place: Number(row.place || 0) || 0,
    }))
    awarded = true
  }
  const payload = {
    type: 'results',
    roundId: r.id,
    total: items.length,
    awarded,
    items,
  }
  // Broadcast unified results to all clients
  broadcast(room, payload)
  // Mark round inactive until next restart; exactly-once guard
  r.active = false
  r.finalized = true
  r.finalizing = false
}

/**
 * Rescue rounds that can never finish on their own.
 *
 * A player whose socket stays open but who stops sending — a frozen tab, a phone put to
 * sleep, a laptop lid closed — leaves the round un-finalizable forever, and everyone
 * else's scores die with it when the room is eventually dropped.
 *
 * Keyed on SILENCE, not elapsed time, and that distinction is the whole safety argument:
 * a client that is actually playing sends `tick` every game tick and `preview` every
 * animation frame, so it is impossible for someone still playing to trip this. Only a
 * client that has said nothing for two solid minutes is treated as gone, and it keeps the
 * last score they were seen playing — the same rule as a clean disconnect.
 */
const STUCK_IDLE_MS = Number(process.env.STUCK_IDLE_MS || 120000)
// Check often enough that the rescue actually lands near the threshold rather than up to a
// sweep late — and so a shorter threshold stays meaningful instead of being rounded away.
const STUCK_SWEEP_MS = Math.max(1000, Math.min(15000, Math.floor(STUCK_IDLE_MS / 2)))

async function sweepStuckRounds() {
  const now = Date.now()
  for (const [roomId, room] of rooms) {
    const r = room.round
    if (!r || !r.active || r.finalizing || r.finalized) continue
    if (!r.participants || r.participants.size === 0) continue
    if (!r.finished) r.finished = new Set()
    let rescued = false
    for (const pid of r.participants) {
      if (r.finished.has(pid)) continue
      const st = room.state.get(pid) || {}
      const seen = Number(st.lastSeen || 0)
      if (seen && now - seen > STUCK_IDLE_MS) {
        r.finished.add(pid) // keeps st.lastScore, same as a disconnect
        rescued = true
        if (WS_DEBUG) console.log(`[ws] stuck participant ${pid} in ${roomId} — treating as gone`)
      }
    }
    if (rescued) await tryFinalize(room, roomId)
  }
}

setInterval(() => {
  void sweepStuckRounds()
}, STUCK_SWEEP_MS).unref?.()

const server = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' })
  res.end('ok')
})

const schedulerClient = createSupabaseServiceClient()
if (schedulerClient) {
  setInterval(
    () => {
      void runDueScheduledTradesTick(schedulerClient)
    },
    Math.max(5000, SCHED_INTERVAL_MS),
  )
  void runDueScheduledTradesTick(schedulerClient)
} else {
  console.warn('[ws][scheduler] disabled: missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
}

const wss = new WebSocketServer({ server })

wss.on('connection', (ws) => {
  const id = uuid().slice(0, 12)
  let joinedRoomId = null
  ws.on('message', (data) => {
    // Reject oversized messages before parsing to prevent DoS.
    if (data.length > MAX_MSG_BYTES) {
      send(ws, { type: 'error', code: 'msg-too-large', message: 'Message exceeds size limit' })
      return
    }
    let msg
    try {
      msg = JSON.parse(data.toString())
    } catch {
      return
    }
    if (!msg || typeof msg !== 'object') return

    // Heartbeat for the stuck-round sweeper below. Any message counts: a client that is
    // actually playing sends `tick` every game tick and `preview` every animation frame,
    // so silence means genuinely gone, never "still playing".
    if (joinedRoomId) {
      const rm = rooms.get(joinedRoomId)
      const st = rm && rm.state.get(id)
      if (st) {
        st.lastSeen = Date.now()
        rm.state.set(id, st)
      }
    }

    // Allow lobby list discovery without joining a room
    if (msg.type === 'list') {
      const items = Array.from(rooms.entries()).map(([rid, r]) => {
        const meta = r.meta || { name: rid, public: true }
        return {
          id: rid,
          name: typeof meta.name === 'string' ? meta.name : rid,
          count: r.clients.size,
        }
      })
      send(ws, { type: 'rooms', items })
      return
    }

    if (msg.type === 'hello') {
      const roomId =
        String(msg.room || '')
          .trim()
          .slice(0, MAX_ROOM_ID_LEN) || 'default'
      let room = rooms.get(roomId)
      // If room doesn't exist and client is not creating, return an error
      if (!room && !msg.create) {
        send(ws, { type: 'error', code: 'room-not-found', message: 'Room does not exist' })
        return
      }
      if (!room) {
        room = {
          clients: new Map(),
          hostId: null,
          settings: { ...DEFAULT_SETTINGS },
          seed: 0,
          roundId: null,
          visitorCounter: 0,
          state: new Map(),
          round: {
            active: false,
            id: null,
            participants: new Set(),
            finished: new Set(),
            finishOrder: [],
            finalizing: false,
            finalized: false,
          },
          meta: {
            name: roomId,
            public: true,
            createdAt: Date.now(),
          },
        }
        rooms.set(roomId, room)
      }
      room.clients.set(id, ws)
      room.state.set(id, {
        ready: false,
        spectate: false,
        lastScore: 0,
        finished: false,
        lastSeen: Date.now(),
      })
      joinedRoomId = roomId
      // Visitor numbering only if client did not supply id
      const visitor = room.visitorCounter++
      const hostBefore = room.hostId
      pickHost(room)
      send(ws, { type: 'welcome', id, visitor })
      if (hostBefore !== room.hostId && room.hostId) {
        broadcast(room, { type: 'host', hostId: room.hostId })
        send(ws, { type: 'host', hostId: room.hostId })
      } else if (room.hostId) {
        send(ws, { type: 'host', hostId: room.hostId })
      }
      // Emit presence count
      broadcast(room, { type: 'presence', count: room.clients.size })
      send(ws, { type: 'presence', count: room.clients.size })
      return
    }

    // Ignore anything until joined
    if (!joinedRoomId) return
    const room = rooms.get(joinedRoomId)
    if (!room) return

    // Optional debug logging for message routing
    if (WS_DEBUG && msg.type !== 'preview' && msg.type !== 'tick' && msg.type !== 'input') {
      try {
        console.log('[ws] message received', {
          type: msg.type,
          joinedRoomId,
          from: id,
        })
      } catch {}
    }

    // Maintain last seen host; re-validate if host disconnects later
    switch (msg.type) {
      case 'name': {
        const st = room.state.get(id) || {}
        if (typeof msg.name === 'string' && msg.name.trim()) {
          // Truncate to prevent oversized payloads being relayed to peers.
          st.name = msg.name.trim().slice(0, MAX_NAME_LEN)
          room.state.set(id, st)
          // Broadcast name updates to peers, matching legacy behavior
          broadcast(room, { type: 'name', name: st.name, from: id }, id)
        }
        break
      }
      case 'claim': {
        // The client is entering a cell and wants to know whether it survives it. Two things can
        // be in the way: a tron trail (permanent) or another player's body (moving).
        const cfg = room.settings || DEFAULT_SETTINGS
        if (!cfg.tron && !cfg.solidBodies) break
        if (cfg.tron && !room.trail) break
        if (!room.crashed) room.crashed = new Set()
        if (room.crashed.has(id)) break
        const grid = (room.settings || DEFAULT_SETTINGS).grid || 30
        const x = Math.floor(Number(msg.x))
        const y = Math.floor(Number(msg.y))
        if (!Number.isFinite(x) || !Number.isFinite(y)) break
        if (x < 0 || y < 0 || x >= grid || y >= grid) break
        const key = cellKey(x, y)
        /**
         * Somebody else's snake, right now. Their body is as of their last preview, so this
         * picture can be up to a tick stale — which is the honest cost of solid bodies and why
         * they are opt-in. At ~32ms round trip against ~110ms a tick that window is small, but
         * it is not zero: you can die to where someone WAS.
         */
        if (cfg.solidBodies) {
          for (const [pid, pst] of room.state) {
            if (pid === id || !pst.body || pst.spectate) continue
            // Gone, or already out. room.state is never deleted on disconnect — by design, so
            // scores survive finalization — which means without this check a player who closed
            // their tab would leave their last body behind as a wall nobody can see.
            if (!room.clients.has(pid) || room.crashed.has(pid)) continue
            if (pst.body.includes(key)) {
              room.crashed.add(id)
              send(ws, { type: 'crash', x, y })
              const alive = stillRiding(room)
              if (alive.length <= 1) {
                const winnerId = alive[0]
                broadcast(room, {
                  type: 'tron',
                  over: true,
                  ...(winnerId
                    ? { winner: { id: winnerId, name: (room.state.get(winnerId) || {}).name } }
                    : {}),
                })
              }
              break
            }
          }
          if (room.crashed.has(id)) break
        }
        if (!cfg.tron) break
        const owner = room.trail.get(key)
        // `tronRivals: false` means only your own line is deadly — you ride through everyone
        // else's. Their trails are still drawn, so the board fills up and still reads as a maze;
        // it just isn't a lethal one.
        const rivalsAreSolid = (room.settings || DEFAULT_SETTINGS).tronRivals !== false
        const deadly = owner !== undefined && (owner === id || rivalsAreSolid)
        if (deadly) {
          // Taken. Told only to the player who hit it — everyone else finds out because their
          // ghost stops moving, which is the same information without a broadcast per death.
          room.crashed.add(id)
          send(ws, { type: 'crash', x, y })
          const alive = stillRiding(room)
          // Last one standing, or nobody: the round is decided.
          if (alive.length <= 1) {
            const winnerId = alive[0]
            broadcast(room, {
              type: 'tron',
              over: true,
              ...(winnerId
                ? { winner: { id: winnerId, name: (room.state.get(winnerId) || {}).name } }
                : {}),
            })
          }
          break
        }
        room.trail.set(key, id)
        // Just the new cell. Sending the whole trail every move would grow with the round —
        // exactly the thing that makes a long game get heavier the longer it goes.
        broadcast(room, { type: 'trail', x, y, from: id })
        break
      }
      case 'eat': {
        // Only meaningful in race, and only for a round that's actually running.
        if (!(room.settings || DEFAULT_SETTINGS).race || !Array.isArray(room.apples)) break
        if (room.raceWinner) break
        const x = Math.floor(Number(msg.x))
        const y = Math.floor(Number(msg.y))
        if (!Number.isFinite(x) || !Number.isFinite(y)) break
        const idx = room.apples.findIndex((a) => a.x === x && a.y === y)
        // Gone already: somebody else's claim arrived first. Nothing is sent back — their client
        // has grown a segment it didn't earn, but the SCORE is here, and the score is what the
        // round is judged on. Rolling their snake back would be a worse lie than one extra
        // segment, because it would rewrite a board the player already reacted to.
        if (idx === -1) break

        room.apples.splice(idx, 1)
        spawnApples(room)
        const next = (room.raceScores.get(id) || 0) + 1
        room.raceScores.set(id, next)

        const target = (room.settings || DEFAULT_SETTINGS).raceTarget || 50
        if (next >= target) {
          room.raceWinner = { id, name: (room.state.get(id) || {}).name, score: next }
        }
        // Everyone, including the eater: their apple list has to match the room's.
        broadcast(room, { type: 'apples', apples: room.apples, roundId: room.roundId })
        broadcast(room, raceScorePayload(room))
        break
      }
      case 'chat': {
        const st = room.state.get(id) || {}
        const text = typeof msg.text === 'string' ? msg.text.trim().slice(0, MAX_CHAT_LEN) : ''
        if (!text) break
        // Sliding window, per client. Dropped silently rather than answered with an error:
        // telling a flooder they've been limited just tells them how fast to go.
        const now = Date.now()
        const recent = (st.chatTimes || []).filter((t) => now - t < CHAT_WINDOW_MS)
        if (recent.length >= CHAT_BURST) {
          st.chatTimes = recent
          room.state.set(id, st)
          break
        }
        recent.push(now)
        st.chatTimes = recent
        room.state.set(id, st)
        // `name` comes from what this client already told the room, never from this message —
        // otherwise a sender could attribute a line to somebody else. Sender is excluded, same
        // as 'name' and 'ready'; the client shows its own line locally.
        broadcast(room, { type: 'chat', text, from: id, name: st.name }, id)
        break
      }
      case 'ready': {
        const st = room.state.get(id) || {}
        st.ready = true
        room.state.set(id, st)
        // Inform peers of ready state (server does not echo to sender)
        broadcast(room, { type: 'ready', from: id }, id)
        break
      }
      case 'spectate': {
        const st = room.state.get(id) || {}
        st.spectate = !!msg.on
        if (st.spectate) st.ready = false
        room.state.set(id, st)
        // Broadcast spectate toggles so lobby lists stay in sync
        broadcast(room, { type: 'spectate', from: id, on: !!msg.on }, id)
        break
      }
      case 'preview': {
        const st = room.state.get(id) || {}
        if (typeof msg.score === 'number') st.lastScore = Number(msg.score)
        /**
         * Remember where this snake actually IS.
         *
         * The relay only forwarded previews before; solid bodies need it to hold them, because
         * "did I just run into someone" can only be answered by whoever knows where everyone
         * is. A body is not a trail: it moves and the tail vacates, so this is the CURRENT
         * occupancy, replaced every preview, not a set that grows all round.
         */
        if (msg.state && Array.isArray(msg.state.snake)) {
          st.body = msg.state.snake
            .slice(0, 4096)
            .map((p) => cellKey(Math.floor(p.x), Math.floor(p.y)))
        }
        room.state.set(id, st)
        // Only relay known fields – never spread the full client message to prevent
        // arbitrary field injection from being forwarded to other clients.
        broadcast(
          room,
          {
            type: 'preview',
            from: id,
            state: msg.state ?? null,
            score: typeof msg.score === 'number' ? Number(msg.score) : 0,
            name: typeof msg.name === 'string' ? msg.name.slice(0, MAX_NAME_LEN) : undefined,
            spectate: msg.spectate === true ? true : undefined,
          },
          id,
        )
        break
      }
      case 'tick': {
        const st = room.state.get(id) || {}
        if (typeof msg.score === 'number') st.lastScore = Number(msg.score)
        room.state.set(id, st)
        break
      }
      case 'over': {
        const r = room.round
        // Ignore over messages if there is no active round
        if (!r || !r.active) break
        // Ignore spectators and non-participants for lifecycle purposes
        if (!r.participants.has(id)) break
        const st = room.state.get(id) || {}
        if (typeof msg.score === 'number') st.lastScore = Number(msg.score)
        st.finished = true
        room.state.set(id, st)
        // Maintain per-round finished set and finish order for tie-breaks
        if (!r.finished) r.finished = new Set()
        if (!r.finished.has(id)) {
          r.finished.add(id)
          if (!r.finishOrder.includes(id)) r.finishOrder.push(id)
        }
        void tryFinalize(room, joinedRoomId)
        break
      }
      case 'error': {
        // Only relay a sanitized subset – never spread the full client message
        // to avoid forwarding arbitrary attacker-controlled fields to peers.
        const relayCode = typeof msg.code === 'string' ? msg.code.slice(0, 64) : undefined
        const relayMessage = typeof msg.message === 'string' ? msg.message.slice(0, 256) : undefined
        broadcast(room, {
          type: 'error',
          from: id,
          ...(relayCode !== undefined ? { code: relayCode } : {}),
          ...(relayMessage !== undefined ? { message: relayMessage } : {}),
        })
        break
      }
      case 'settings': {
        if (id === room.hostId && msg.settings) {
          room.settings = sanitizeSettings(msg.settings, room.settings)
          broadcast(room, { type: 'settings', settings: room.settings })
        }
        break
      }
      case 'restart': {
        if (WS_DEBUG) {
          try {
            console.log('[ws] restart received', {
              room: joinedRoomId,
              from: id,
              hostId: room.hostId,
              isHost: id === room.hostId,
              state: Array.from(room.state.entries()).map(([pid, st]) => ({
                pid,
                ready: !!st.ready,
                spectate: !!st.spectate,
              })),
            })
          } catch {}
        }

        if (id !== room.hostId) {
          if (WS_DEBUG) {
            try {
              console.warn('[ws] restart ignored: not host', {
                room: joinedRoomId,
                from: id,
                hostId: room.hostId,
              })
            } catch {}
          }
          break
        }

        // Generate new roundId server-side
        room.roundId = uuid()
        if (WS_DEBUG) {
          try {
            console.log(`[ws] restart accepted room=${joinedRoomId} roundId=${room.roundId}`)
          } catch {}
        }
        // Capture fresh participants snapshot: ready && not spectating at restart time.
        // This Set is frozen for the duration of the round (except disconnects).
        const participants = new Set(
          Array.from(room.state.entries())
            .filter(([, st]) => st.ready && !st.spectate)
            .map(([pid]) => pid),
        )
        // Initialize a brand new round object; discard any previous per-round flags
        room.round = {
          active: true,
          id: room.roundId,
          participants,
          finished: new Set(),
          finishOrder: [],
          finalizing: false,
          finalized: false,
        }
        // Reset per-round flags for all known players; participants will rebuild scores
        for (const [pid, stRaw] of room.state.entries()) {
          const st = stRaw || {}
          st.finished = false
          if (participants.has(pid)) {
            st.lastScore = 0
          }
          room.state.set(pid, st)
        }
        // Broadcast restart WITH roundId for clients that want early display
        broadcast(room, { type: 'restart', roundId: room.roundId })
        // Follow with seed broadcast containing same roundId
        const seedPayload = makeSeed(room)
        if (WS_DEBUG) {
          try {
            console.log(`[ws] seed room=${joinedRoomId} roundId=${room.roundId} seed=${room.seed}`)
          } catch {}
        }
        broadcast(room, seedPayload)
        // The apples themselves went out inside the seed above; this is just the empty
        // scoreboard, so everyone starts the round showing zeroes rather than last round's.
        if ((room.settings || DEFAULT_SETTINGS).race) {
          broadcast(room, raceScorePayload(room))
        }
        // Explicit ack back to the sender so client can verify path
        send(ws, { type: 'restart-ack', roundId: room.roundId })
        break
      }
      case 'results': {
        // Client-emitted results are ignored; server is the sole source of canonical results
        break
      }
      case 'roommeta': {
        // Persist basic metadata and forward to peers; all rooms are treated as public
        const meta = room.meta || { name: joinedRoomId, public: true, createdAt: Date.now() }
        if (typeof msg.name === 'string' && msg.name.trim())
          meta.name = msg.name.trim().slice(0, MAX_ROOM_ID_LEN)
        meta.public = true
        room.meta = meta
        broadcast(room, { type: 'roommeta', name: meta.name, public: true })
        break
      }
      default: {
        // Unknown message; ignore or send error
        break
      }
    }
  })

  ws.on('close', () => {
    if (!joinedRoomId) return
    const room = rooms.get(joinedRoomId)
    if (!room) return
    room.clients.delete(id)
    // Prune participant from active round, if present.
    // Policy: disconnecting participants are removed from the round and
    // no longer required (or counted) for finalization.
    try {
      const r = room.round
      if (r && r.active && r.participants && r.participants.has(id)) {
        if (!r.finished) r.finished = new Set()
        // Keep them IN the round, with the score they had when they left.
        //
        // We used to drop leavers from the round entirely, so a player who died and
        // closed the tab vanished from the results. Their score is still right here --
        // room.state is never deleted on disconnect and lastScore is updated live -- so
        // there is no reason to throw it away. Mark them finished instead: they can't
        // finish later, and leaving them un-finished blocks the round for everyone else.
        //
        // Deliberately NOT added to finishOrder: on a tie, someone who played it out
        // should rank above someone who left, and finishIdx defaults to last.
        r.finished.add(id)
        // If this was the last player still going, this finalizes the round now.
        void tryFinalize(room, joinedRoomId)
      }
    } catch {
      /* ignore */
    }
    const wasHost = room.hostId === id
    if (wasHost) {
      room.hostId = null
      pickHost(room)
      if (room.hostId) broadcast(room, { type: 'host', hostId: room.hostId })
    }
    if (room.clients.size === 0) {
      // A round exists only in this process's memory, so dropping the room is what
      // silently loses everyone's scores when the last person leaves. Finalize first,
      // then delete — otherwise the async finalize races the delete and loses.
      const r = room.round
      if (r && r.active && !r.finalized && !r.finalizing) {
        void tryFinalize(room, joinedRoomId).finally(() => rooms.delete(joinedRoomId))
      } else {
        rooms.delete(joinedRoomId)
      }
    } else {
      // Notify remaining peers that this player has left so they can
      // clear lobby rows and any per-player state.
      try {
        broadcast(room, { type: 'over', from: id, reason: 'quit' })
      } catch {
        /* ignore */
      }
      broadcast(room, { type: 'presence', count: room.clients.size })
    }
  })

  ws.on('error', () => {
    try {
      ws.close()
    } catch {
      /* ignore */
    }
  })
})

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[ws-server] listening on :${PORT}`)
})
