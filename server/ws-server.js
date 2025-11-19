/* Simple WebSocket game server implementing server-authoritative round IDs.
 * Responsibilities:
 *  - Manage rooms and host assignment
 *  - On host 'restart' request: generate UUID roundId, broadcast restart { roundId }
 *  - Immediately (or after tiny delay) broadcast seed { type:'seed', roundId, seedData:{ seed, settings } }
 *  - Echo player messages needed by client (name, ready, spectate, preview, tick, over, settings)
 *  - Reassign host on host disconnect
 *  - NEVER writes to Supabase; only forwards roundId and gameplay messages.
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
//   round: { active: boolean, id: string|null, participants: Set<string>, finishOrder: string[] }
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

function tryFinalize(room) {
  const r = room.round
  if (!r || !r.active || !r.id) return
  const parts = Array.from(r.participants)
  if (parts.length === 0) return
  // Ensure all participants have finished
  for (const pid of parts) {
    if (!room.state.get(pid)?.finished) return
  }
  // Build base results {id,name,score,finishIdx}
  const base = parts.map((pid) => {
    const st = room.state.get(pid) || {}
    const name = (st.name || 'Player').trim()
    const score = Number(st.lastScore || 0)
    const idx = r.finishOrder.indexOf(pid)
    return { id: pid, name, score, finishIdx: idx >= 0 ? idx : 9999 }
  })
  base.sort((a, b) => (b.score !== a.score ? b.score - a.score : a.finishIdx - b.finishIdx))
  const items = []
  let prevScore = null
  let prevPlace = 0
  for (let i = 0; i < base.length; i++) {
    const row = base[i]
    const place = prevScore !== null && row.score === prevScore ? prevPlace : i + 1
    items.push({ id: row.id, name: row.name, score: row.score, place })
    prevScore = row.score
    prevPlace = place
  }
  const payload = {
    type: 'results',
    roundId: r.id,
    total: parts.length,
    awarded: false,
    items,
  }
  // Broadcast unified results to all clients
  broadcast(room, payload)
  // Mark round inactive until next restart
  r.active = false
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
          round: { active: false, id: null, participants: new Set(), finishOrder: [] },
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
          tryFinalize(room)
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
        // Forward client-emitted results (e.g., to signal awarded:true) to all
        broadcast(room, { ...msg, from: id })
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
        tryFinalize(room)
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
