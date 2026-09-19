/**
 * A TEST DOUBLE FOR THE PARK'S RELAY. Development only. Never deployed, never imported.
 *
 * ⚠️ WHY THIS EXISTS. The real relay will not show one person to another until Supabase has
 * verified their token server-side, and a local relay has no Supabase config — so two dev tabs
 * can never meet, and every co-op path in the park went unexercised for weeks. That is the door
 * working, not a gap: ParkPreview's claim that `authed` grants nothing is exactly right, and it
 * must stay that way. So rather than weaken the door, this stands in for the pipe behind it.
 *
 * The first time two clients were actually put in one park together it found a real bug in the
 * first minute — a friend's cast could never damage the boss you were running — after seventeen
 * commits of "only a second machine can check this". It could not, and it was not true.
 *
 * ⚠️ WHAT IT DELIBERATELY DOES NOT DO. No vouching, and no clamping. The real server's clamps
 * have their own round-trip tests and a double that re-implemented them would only be testing
 * itself; what is under test here is the CLIENT — its decoders, its peer rendering, and who is
 * allowed to take health off what.
 *
 * ⚠️ AND IT REFUSES TO START WITHOUT BEING ASKED TWICE, so it can never be the thing running
 * by accident when somebody believes they are testing the real door.
 *
 *   PARK_STUB_RELAY=yes node scripts/park-stub-relay.mjs
 *   # then point .env.local at it: VITE_WS_URL=ws://localhost:8080
 *   # open two tabs on #dev-park, walk both in
 */
import { WebSocketServer } from 'ws'

if (process.env.PARK_STUB_RELAY !== 'yes') {
  console.error(
    'refusing to start: this is a doorless test double, not the relay.\n' +
      'It forwards park messages between clients with no account check at all.\n' +
      'If that is what you want: PARK_STUB_RELAY=yes node scripts/park-stub-relay.mjs\n' +
      'The real one is: npm run ws-server',
  )
  process.exit(1)
}

const PORT = Number(process.env.PORT || 8080)
const wss = new WebSocketServer({ port: PORT })
/** roomId -> Map<clientId, { ws, look, name }> */
const rooms = new Map()
/** roomId -> { by, name, art } */
const bosses = new Map()
let next = 1

const send = (ws, o) => {
  try {
    ws.send(JSON.stringify(o))
  } catch {
    /* gone */
  }
}

wss.on('connection', (ws) => {
  const id = 'p' + next++
  let roomId = null

  ws.on('message', (raw) => {
    let msg
    try {
      msg = JSON.parse(String(raw))
    } catch {
      return
    }

    if (msg.type === 'hello') {
      roomId = String(msg.room || '')
      if (!rooms.has(roomId)) rooms.set(roomId, new Map())
      const room = rooms.get(roomId)
      room.set(id, { ws, look: null, name: '' })
      send(ws, { type: 'welcome', id })
      /**
       * ⚠️ `from`, NOT `id`, AND THE BOSS RIDES ALONG. Both of these are the real relay's
       * shape and both were wrong here first: readSomeone keys off `from`, and a guest who
       * joins after a boss was called learns about it from the roster's `boss` and nowhere
       * else. Getting either wrong looks exactly like a client bug.
       */
      const who = []
      for (const [oid, o] of room) if (oid !== id && o.look) who.push({ from: oid, ...o.look })
      const b = bosses.get(roomId)
      const boss = b && b.by !== id ? { from: b.by, name: b.name, art: b.art } : null
      send(ws, { type: 'park', who, boss })
      for (const [oid, o] of room)
        if (oid !== id) send(o.ws, { type: 'presence', count: room.size })
      console.log(`[stub] ${id} joined ${roomId} (${room.size} here, roster ${who.length})`)
      return
    }

    const room = rooms.get(roomId)
    if (!room) return
    if (msg.type === 'auth') return

    if (msg.type === 'look') {
      const me = room.get(id)
      if (me) {
        me.look = { name: msg.name, art: msg.art }
        me.name = msg.name
      }
    }
    if (msg.type === 'boss') {
      if (msg.art == null) bosses.delete(roomId)
      else bosses.set(roomId, { by: id, name: msg.name, art: msg.art })
      console.log(`[stub] ${id} boss ${msg.art == null ? 'away' : msg.name}`)
    }

    for (const [oid, o] of room) if (oid !== id) send(o.ws, { ...msg, from: id })
  })

  ws.on('close', () => {
    const room = rooms.get(roomId)
    if (!room) return
    room.delete(id)
    /**
     * ⚠️ `over` IS WHAT REMOVES SOMEBODY, and presence is only a number. The client deletes a
     * peer — and the boss they were running — on `over` and on nothing else, so a double that
     * sent presence alone left a ghost standing in the park and a boss nobody was stepping.
     * Caught by watching a guest keep a peer on its minimap after the host had walked out.
     */
    const b = bosses.get(roomId)
    if (b && b.by === id) bosses.delete(roomId)
    for (const [, o] of room) {
      send(o.ws, { type: 'over', from: id })
      send(o.ws, { type: 'presence', count: room.size })
    }
    console.log(`[stub] ${id} left (${room.size} here)`)
  })
})

console.log(`[stub] doorless park relay on :${PORT} — development only`)
