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
const WS_DEBUG = process.env.WS_DEBUG === '1' || process.env.WS_DEBUG === 'true'

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

const server = createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' })
  res.end('ok')
})

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
          st.name = msg.name
          room.state.set(id, st)
          // Broadcast name updates to peers, matching legacy behavior
          broadcast(room, { type: 'name', name: msg.name, from: id }, id)
        }
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
        room.state.set(id, st)
        // Relay preview snapshots to peers (except sender), matching legacy server
        broadcast(room, { ...msg, from: id }, id)
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
        broadcast(room, { ...msg, from: id })
        break
      }
      case 'settings': {
        if (id === room.hostId && msg.settings) {
          room.settings = { ...room.settings, ...msg.settings }
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
          try {
            console.warn('[ws] restart ignored: not host', {
              room: joinedRoomId,
              from: id,
              hostId: room.hostId,
            })
          } catch {}
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
        if (typeof msg.name === 'string' && msg.name.trim()) meta.name = msg.name.trim()
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
        r.participants.delete(id)
        r.finished.delete(id)
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
