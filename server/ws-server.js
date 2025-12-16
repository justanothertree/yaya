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

const PORT = process.env.PORT ? Number(process.env.PORT) : 8080

// Default settings mirrored from client DEFAULT_SETTINGS
const DEFAULT_SETTINGS = {
  grid: 30,
  apples: 2,
  passThroughEdges: true,
  canvasSize: 'medium',
}

// Supabase env (server-side). These should be configured in Render:
// SUPABASE_URL, SUPABASE_ANON_KEY
const SUPABASE_URL = process.env.SUPABASE_URL || ''
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || ''

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
//   round: { active: boolean, id: string|null, participants: Set<string>, finishOrder: string[], finalizing?: boolean, finalized?: boolean }
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
  return { type: 'seed', roundId, seedData: { seed: room.seed, settings } }
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
  const parts = Array.from(r.participants)
  if (parts.length === 0) return
  // Ensure all participants have finished
  for (const pid of parts) {
    if (!room.state.get(pid)?.finished) return
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

const server = createServer()
const wss = new WebSocketServer({ server })

wss.on('connection', (ws) => {
  const id = uuid().slice(0, 12)
  let joinedRoomId = null
  ws.on('message', (data) => {
    let msg
    try {
      msg = JSON.parse(data.toString())
    } catch {
      return
    }
    if (!msg || typeof msg !== 'object') return

    if (msg.type === 'hello') {
      const roomId = String(msg.room || '').trim() || 'default'
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
            finishOrder: [],
            finalizing: false,
            finalized: false,
          },
        }
        rooms.set(roomId, room)
      }
      room.clients.set(id, ws)
      room.state.set(id, { ready: false, spectate: false, lastScore: 0, finished: false })
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

    // Maintain last seen host; re-validate if host disconnects later
    switch (msg.type) {
      case 'name': {
        const st = room.state.get(id) || {}
        st.name = msg.name
        room.state.set(id, st)
      }
      case 'ready': {
        const st = room.state.get(id) || {}
        st.ready = true
        room.state.set(id, st)
      }
      case 'spectate': {
        const st = room.state.get(id) || {}
        st.spectate = !!msg.on
        if (st.spectate) st.ready = false
        room.state.set(id, st)
      }
      case 'preview':
      case 'tick': {
        const st = room.state.get(id) || {}
        if (typeof msg.score === 'number') st.lastScore = Number(msg.score)
        room.state.set(id, st)
      }
      case 'over': {
        const st = room.state.get(id) || {}
        if (typeof msg.score === 'number') st.lastScore = Number(msg.score)
        st.finished = true
        room.state.set(id, st)
        // Maintain finish order for tie-breaks
        const r = room.round
        if (r && r.active && r.participants.has(id)) {
          if (!r.finishOrder.includes(id)) r.finishOrder.push(id)
          void tryFinalize(room, joinedRoomId)
        }
      }
      case 'error':
        broadcast(room, { ...msg, from: id })
        break
      case 'settings':
        if (id === room.hostId && msg.settings) {
          room.settings = { ...room.settings, ...msg.settings }
          broadcast(room, { type: 'settings', settings: room.settings })
        }
        break
      case 'restart':
        if (id !== room.hostId) return // only host can start
        // Generate new roundId server-side
        room.roundId = uuid()
        try {
          console.log(`[ws] restart room=${joinedRoomId} roundId=${room.roundId}`)
        } catch {}
        // Capture participants snapshot: ready && not spectating
        room.round = {
          active: true,
          id: room.roundId,
          participants: new Set(
            Array.from(room.state.entries())
              .filter(([, st]) => st.ready && !st.spectate)
              .map(([pid]) => pid),
          ),
          finishOrder: [],
          finalizing: false,
          finalized: false,
        }
        // Reset per-round flags for participants
        for (const pid of room.round.participants) {
          const st = room.state.get(pid) || {}
          st.finished = false
          st.lastScore = 0
          room.state.set(pid, st)
        }
        // Broadcast restart WITH roundId for clients that want early display
        broadcast(room, { type: 'restart', roundId: room.roundId })
        // Follow with seed broadcast containing same roundId
        const seedPayload = makeSeed(room)
        try {
          console.log(`[ws] seed room=${joinedRoomId} roundId=${room.roundId} seed=${room.seed}`)
        } catch {}
        broadcast(room, seedPayload)
        // Also send to host (since broadcast excludes none, host already gets it)
        break
      case 'results':
        // Client-emitted results are ignored; server is the sole source of canonical results
        break
      case 'list':
        // Provide summary; treat all rooms as public
        const items = Array.from(rooms.entries()).map(([rid, r]) => ({
          id: rid,
          name: rid,
          count: r.clients.size,
        }))
        send(ws, { type: 'rooms', items })
        break
      case 'roommeta':
        // Optionally forward (not persisted)
        broadcast(room, { type: 'roommeta', name: msg.name, public: msg.public })
        break
      default:
        // Unknown message; ignore or send error
        break
    }
  })

  ws.on('close', () => {
    if (!joinedRoomId) return
    const room = rooms.get(joinedRoomId)
    if (!room) return
    room.clients.delete(id)
    // Prune participant from active round, if present
    try {
      const r = room.round
      if (r && r.active && r.participants && r.participants.has(id)) {
        r.participants.delete(id)
        // If this disconnect unblocks finalization, try finalize now
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
      rooms.delete(joinedRoomId)
    } else {
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

server.listen(PORT, () => {
  console.log(`[ws-server] listening on :${PORT}`)
})
