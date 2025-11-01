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

function joinRoom(ws, room) {
  let set = rooms.get(room)
  if (!set) {
    set = new Set()
    rooms.set(room, set)
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
  ws.on('message', (data) => {
    let msg
    try {
      msg = JSON.parse(data)
    } catch {
      return
    }
    if (!msg || typeof msg !== 'object') return
    if (msg.type === 'hello' && typeof msg.room === 'string') {
      joinRoom(ws, msg.room)
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
      msg.type === 'name'
    ) {
      broadcast(room, msg, ws)
      return
    }
  })
  ws.on('close', () => {
    const room = ws._room
    leaveRoom(ws)
    if (room) {
      // Notify peers that someone left
      broadcast(room, { type: 'over', reason: 'quit' }, null)
    }
  })
})

server.listen(PORT, () => {
  console.log(`WS server listening on :${PORT}`)
})
