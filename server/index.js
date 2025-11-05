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
  }
  set.add(ws)
  ws._room = room
  // Start a match when 2 clients are present: send shared seed/settings
  if (set.size === 2) {
    const seed = Math.floor(Math.random() * 1e9)
    broadcast(room, { type: 'seed', seed, settings: DEFAULT_SETTINGS })
  }
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

wss.on('connection', (ws) => {
  ws._room = null
  ws._id = Math.random().toString(36).slice(2, 10)
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
      try {
        ws.send(JSON.stringify({ type: 'welcome', id: ws._id, visitor }))
      } catch {}
      joinRoom(ws, msg.room)
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
      msg.type === 'ready' ||
      msg.type === 'name' ||
      msg.type === 'preview'
    ) {
      broadcast(room, { ...msg, from: ws._id }, ws)
      return
    }
  })
  ws.on('close', () => {
    const room = ws._room
    leaveRoom(ws)
    if (room) {
      // Notify peers that someone left
      broadcast(room, { type: 'over', reason: 'quit', from: ws._id }, null)
    }
  })
})

server.listen(PORT, () => {
  console.log(`WS server listening on :${PORT}`)
})
