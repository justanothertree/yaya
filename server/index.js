import http from 'http'
import { WebSocketServer } from 'ws'

const PORT = process.env.PORT || 10000

// Default settings aligned with client
const DEFAULT_SETTINGS = {
  grid: 30,
  apples: 2,
  passThroughEdges: true,
  canvasSize: 'medium',
}

const server = http.createServer((req, res) => {
  // Simple health endpoint
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true }))
    return
  }
  res.writeHead(200, { 'Content-Type': 'text/plain' })
  res.end('Snake WS server')
})

const wss = new WebSocketServer({ server })

// roomId -> Set of clients
const rooms = new Map()
// roomId -> metadata
const roomsMeta = new Map() // { name, public, createdAt }
// roomId -> state flags
const roomsState = new Map() // { allReady: boolean }
// roomId -> settings
const roomsSettings = new Map() // { apples, passThroughEdges, grid, canvasSize }
// roomId -> host client id
const roomsHost = new Map()
// clientId -> visitor number; assigns one global sequential number per unique clientId
const clientVisitors = new Map()
let nextVisitor = 1

function joinRoom(ws, room) {
  let set = rooms.get(room)
  if (!set) {
    set = new Set()
    rooms.set(room, set)
    if (!roomsMeta.has(room))
      roomsMeta.set(room, { name: room, public: false, createdAt: Date.now() })
    if (!roomsState.has(room)) roomsState.set(room, { allReady: false })
    if (!roomsSettings.has(room)) roomsSettings.set(room, { ...DEFAULT_SETTINGS })
  }
  set.add(ws)
  ws._room = room
  ws._ready = false
  // Start a match when 2 clients are present: send shared seed/settings
  // Broadcast presence count to room
  broadcast(room, { type: 'presence', count: set.size })
}

function leaveRoom(ws) {
  const room = ws._room
  if (!room) return
  const set = rooms.get(room)
  if (!set) return
  set.delete(ws)
  if (set.size === 0) rooms.delete(room)
  else broadcast(room, { type: 'presence', count: set.size })
}

function broadcast(room, msg, except = null) {
  const set = rooms.get(room)
  if (!set) return
  const raw = JSON.stringify(msg)
  for (const client of set) {
    if (client !== except && client.readyState === 1) {
      try {
        client.send(raw)
      } catch {}
    }
  }
}

function ensureHost(room) {
  // If no host is assigned but room has clients, pick the first as host
  if (!roomsHost.has(room)) {
    const set = rooms.get(room)
    if (set && set.size > 0) {
      const first = Array.from(set)[0]
      roomsHost.set(room, first._id)
      broadcast(room, { type: 'host', hostId: first._id })
      return first._id
    }
  }
  return roomsHost.get(room)
}

wss.on('connection', (ws) => {
  ws._room = null
  ws._id = Math.random().toString(36).slice(2, 10)
  ws._ready = false
  try {
    ws.send(JSON.stringify({ type: 'welcome', id: ws._id }))
  } catch {}
  ws.on('message', (data) => {
    let msg
    try {
      msg = JSON.parse(data)
    } catch {
      return
    }
    if (!msg || typeof msg !== 'object') return
    if (msg.type === 'hello' && typeof msg.room === 'string') {
      // assign visitor number using a stable clientId, if provided
      let visitor
      if (typeof msg.clientId === 'string' && msg.clientId) {
        if (clientVisitors.has(msg.clientId)) visitor = clientVisitors.get(msg.clientId)
        else {
          visitor = nextVisitor++
          clientVisitors.set(msg.clientId, visitor)
        }
      } else {
        visitor = nextVisitor++
      }
      // room existence rules: allow creation only if explicitly requested
      const exists = rooms.has(msg.room)
      if (!exists && !msg.create) {
        try {
          ws.send(
            JSON.stringify({
              type: 'error',
              code: 'room-not-found',
              message: 'Room does not exist',
            }),
          )
        } catch {}
        return
      }
      try {
        ws.send(JSON.stringify({ type: 'welcome', id: ws._id, visitor }))
      } catch {}
      joinRoom(ws, msg.room)
      // Assign or confirm host
      if (msg.create || !roomsHost.has(msg.room)) {
        roomsHost.set(msg.room, ws._id)
      }
      const hostId = ensureHost(msg.room)
      // Inform all clients who the host is
      if (hostId) broadcast(msg.room, { type: 'host', hostId })
      // Send current settings snapshot to the newcomer
      const curSettings = roomsSettings.get(msg.room) || { ...DEFAULT_SETTINGS }
      try {
        ws.send(JSON.stringify({ type: 'settings', settings: curSettings }))
      } catch {}
      // Tell newcomer who is already ready
      const set = rooms.get(msg.room)
      if (set) {
        for (const peer of set) {
          if (peer !== ws && peer._ready) {
            try {
              ws.send(JSON.stringify({ type: 'ready', from: peer._id }))
            } catch {}
          }
        }
      }
      return
    }
    if (msg.type === 'roommeta') {
      const r = ws._room
      if (!r) return
      const meta = roomsMeta.get(r) || { name: r, public: false, createdAt: Date.now() }
      if (typeof msg.name === 'string' && msg.name.trim()) meta.name = msg.name.trim()
      // All rooms public now; ignore msg.public and mark as public
      meta.public = true
      roomsMeta.set(r, meta)
      return
    }
    if (msg.type === 'list') {
      const items = []
      for (const [id, set] of rooms.entries()) {
        const m = roomsMeta.get(id) || { name: id, public: true, createdAt: Date.now() }
        items.push({ id, name: m.name, count: set.size })
      }
      try {
        ws.send(JSON.stringify({ type: 'rooms', items }))
      } catch {}
      return
    }
    const room = ws._room
    if (!room) return
    // Relay gameplay messages to peers in the same room
    if (
      msg.type === 'input' ||
      msg.type === 'tick' ||
      msg.type === 'over' ||
      msg.type === 'name' ||
      msg.type === 'preview'
    ) {
      broadcast(room, { ...msg, from: ws._id }, ws)
      return
    }
    if (msg.type === 'restart') {
      // Host-initiated immediate restart: broadcast fresh seed with current settings
      const r = ws._room
      if (!r) return
      const hostId = roomsHost.get(r)
      if (hostId && hostId === ws._id) {
        const set = rooms.get(r)
        const seed = Math.floor(Math.random() * 1e9)
        const s = roomsSettings.get(r) || { ...DEFAULT_SETTINGS }
        broadcast(r, { type: 'seed', seed, settings: s })
        if (set) {
          for (const c of set) c._ready = false
        }
        roomsState.set(r, { allReady: false })
      }
      return
    }
    if (msg.type === 'settings') {
      // Only host can change settings
      const r = ws._room
      if (!r) return
      const hostId = roomsHost.get(r)
      if (hostId && hostId === ws._id) {
        const prev = roomsSettings.get(r) || { ...DEFAULT_SETTINGS }
        let next = { ...prev }
        if (msg.settings && typeof msg.settings === 'object') {
          const s = msg.settings
          if (typeof s.apples === 'number' && s.apples >= 1 && s.apples <= 4) next.apples = s.apples
          if (typeof s.passThroughEdges === 'boolean') next.passThroughEdges = s.passThroughEdges
        } else {
          if (typeof msg.apples === 'number' && msg.apples >= 1 && msg.apples <= 4) {
            next.apples = msg.apples
          }
          if (typeof msg.passThroughEdges === 'boolean') {
            next.passThroughEdges = msg.passThroughEdges
          }
        }
        roomsSettings.set(r, next)
        broadcast(r, { type: 'settings', settings: next })
      }
      return
    }
    if (msg.type === 'ready') {
      ws._ready = true
      broadcast(room, { type: 'ready', from: ws._id }, ws)
      // if all clients in the room are ready (and at least 2), broadcast seed once per transition
      const set = rooms.get(room)
      if (set) {
        const allReady = set.size >= 2 && Array.from(set).every((c) => c._ready)
        const state = roomsState.get(room) || { allReady: false }
        if (allReady && !state.allReady) {
          const seed = Math.floor(Math.random() * 1e9)
          const s = roomsSettings.get(room) || { ...DEFAULT_SETTINGS }
          broadcast(room, { type: 'seed', seed, settings: s })
          // reset readiness for a new round so subsequent rounds require Ready again
          for (const c of set) c._ready = false
          roomsState.set(room, { allReady: false })
        } else if (!allReady && state.allReady) {
          roomsState.set(room, { allReady: false })
        }
      }
      return
    }
  })
  ws.on('close', () => {
    const room = ws._room
    ws._ready = false
    leaveRoom(ws)
    if (room) {
      // Notify peers that someone left
      broadcast(room, { type: 'over', reason: 'quit', from: ws._id }, null)
      // reset allReady flag when composition changes
      const state = roomsState.get(room)
      if (state) roomsState.set(room, { allReady: false })
      // If host left, promote a new host
      const currentHost = roomsHost.get(room)
      if (currentHost && currentHost === ws._id) {
        roomsHost.delete(room)
        const set = rooms.get(room)
        if (set && set.size > 0) {
          const newHost = Array.from(set)[0]
          roomsHost.set(room, newHost._id)
          broadcast(room, { type: 'host', hostId: newHost._id })
        }
      }
    }
  })
})

server.listen(PORT, () => {
  console.log(`WS server listening on :${PORT}`)
})
