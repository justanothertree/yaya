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
// rooms.set(roomId, { clients: Map<id, ws>, hostId, settings, seed, roundId, visitorCounter })

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
      if (!room) {
        room = {
          clients: new Map(),
          hostId: null,
          settings: { ...DEFAULT_SETTINGS },
          seed: 0,
          roundId: null,
          visitorCounter: 0,
        }
        rooms.set(roomId, room)
      }
      room.clients.set(id, ws)
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
      case 'name':
      case 'ready':
      case 'spectate':
      case 'preview':
      case 'tick':
      case 'over':
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
        // Broadcast restart WITH roundId for clients that want early display
        broadcast(room, { type: 'restart', roundId: room.roundId })
        // Follow with seed broadcast containing same roundId
        const seedPayload = makeSeed(room)
        broadcast(room, seedPayload)
        // Also send to host (since broadcast excludes none, host already gets it)
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
