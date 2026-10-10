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
/**
 * ⚠️ LAG IS A FEATURE HERE. On this machine a round trip is about a millisecond, which hides
 * every race the park can actually have — two people pressing the same button "at the same
 * time" over a real relay are 20 to 80ms apart, not one. STUB_LAG=60 makes that reproducible.
 */
const LAG = Number(process.env.STUB_LAG || 0)
const wss = new WebSocketServer({ port: PORT })
/** roomId -> Map<clientId, { ws, look, name }> */
const rooms = new Map()
/** roomId -> { by, name, art } */
const bosses = new Map()
/** the host's last word per room, replayed to whoever joins next — see the roster */
const scenes = new Map()
let next = 1

const send = (ws, o) => {
  const go = () => {
    try {
      ws.send(JSON.stringify(o))
    } catch {
      /* gone */
    }
  }
  if (LAG > 0) setTimeout(go, LAG)
  else go()
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
      /**
       * ⚠️ THE SCENE RIDES ALONG TOO, for exactly the reason the boss does. A guest who joins
       * after the host said which map everyone is in learns it from the roster and nowhere
       * else — the host has no reason to say it again. Leaving it out looks like a client that
       * ignores the host, which is the most expensive kind of wrong.
       *
       * ⚠️ AND THE REAL RELAY MUST DO THE SAME. This is a double; it can only prove the client
       * is right about a server that behaves this way.
       */
      send(ws, { type: 'park', who, boss, scene: scenes.get(roomId) ?? null })
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
    /**
     * ⚠️ NO OWNER CHECK HERE, AND THAT IS NOT WHAT THE REAL ONE SHOULD DO. The relay is the only
     * place a host can be established, because it is the only place a socket is tied to a
     * verified account — this double has no Supabase config and no accounts at all, so it
     * forwards whoever speaks. See docs/2026-10-09-park-lobby-design.md: until the real relay
     * drops a scene from a non-owner, the host's word is advisory.
     */
    if (msg.type === 'scene') {
      const at = typeof msg.at === 'number' ? msg.at : null
      const had = scenes.get(roomId)
      if (at === null || (had && at <= had.at)) return
      scenes.set(roomId, { map: msg.map ?? null, at })
      console.log(`[stub] ${id} scene map=${msg.map ?? 'none'} at=${at}`)
    }
    if (msg.type === 'boss') {
      const had = bosses.get(roomId)
      /**
       * ⚠️ ONE BOSS AT A TIME IS ENFORCED AT THE SERVER, and a double that let two stand up
       * would be testing itself rather than the park. The real relay refuses a second one and
       * answers the caller with the one that is already out — see its own `room.boss.by !== id`
       * branch — so this does the same, including the refusal message.
       */
      if (had && had.by !== id && msg.art != null) {
        /* ⚠️ THE ERROR TOO, WHICH THIS CLAIMED TO SEND AND DID NOT. The note above says "including
           the refusal message" and only the boss itself went back — so a client that keyed off
           the code would have looked broken here and been fine against the real relay, which is
           this file's whole failure mode pointed the wrong way. */
        send(ws, {
          type: 'error',
          code: 'boss-taken',
          message: 'Somebody else has a boss out already',
        })
        send(ws, { type: 'boss', from: had.by, name: had.name, art: had.art })
        console.log(`[stub] ${id} boss refused — ${had.by} already has one out`)
        return
      }
      if (msg.art == null) {
        if (had && had.by === id) bosses.delete(roomId)
      } else bosses.set(roomId, { by: id, name: msg.name, art: msg.art })
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
