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
 * ⚠️ WHAT IT DELIBERATELY DOES NOT DO, IN A PARK. No vouching, and no clamping. The real
 * server's clamps have their own round-trip tests and a double that re-implemented them would only
 * be testing itself; what is under test here is the CLIENT — its decoders, its peer rendering, and
 * who is allowed to take health off what.
 *
 * ⚠️ A LAB TABLE IS DIFFERENT: IT RUNS THE REAL DOOR. A `lab:` room here makes every decision
 * through server/lib/labDoor.mjs — the same file the relay imports — so the silence, the windows,
 * the chain and the friends rule are the relay's own and not a copy. What it cannot have is
 * Supabase, so the three answers are stubbed and nothing else is:
 *   - the token and the standing are 'yes' once a socket sends `stub-who {uid, friends}`, which a
 *     dev tab sends in place of the `auth` it has no session for;
 *   - the friends answer is 'yes' only when each side's `stub-who` lists the other, so a dev call's
 *     `stranger=1` and `unfriend=` reach this door as a no without any rule copied here.
 * The real relay never hears `stub-who`: kindAllowed refuses it there.
 *
 * ⚠️ AND IT REFUSES TO START WITHOUT BEING ASKED TWICE, so it can never be the thing running
 * by accident when somebody believes they are testing the real door.
 *
 *   PARK_STUB_RELAY=yes node scripts/park-stub-relay.mjs
 *   # then point .env.local at it: VITE_WS_URL=ws://localhost:8080
 *   # open two tabs on #dev-park, walk both in
 *
 *   STUB_LAG=60      every frame it sends arrives 60 ms late
 *   STUB_WAKE=40000  every socket opened in its first 40 s waits until then to open — a free relay
 *                    waking. Whether Render's proxy really holds an upgrade like this is unverified
 *   STUB_KILL_AT=ms  it exits once, that long after starting — a deploy mid-game, for reconnecting
 */
import { createServer } from 'node:http'
import { WebSocketServer } from 'ws'
import { MAX_MSG_BYTES } from '../server/lib/frameCap.mjs'
import {
  LAB,
  SAY,
  doorFor,
  helloFrames,
  isLabId,
  kindAllowed,
  leaveFrames,
  looksLab,
  rate,
  readLab,
  vouchTimerCloses,
} from '../server/lib/labDoor.mjs'

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
const WAKE = Number(process.env.STUB_WAKE || 0)
const KILL_AT = Number(process.env.STUB_KILL_AT || 0)
const started = Date.now()
/**
 * ⚠️ A WAKING RELAY IS IMITATED AT THE UPGRADE, not at the socket. A socket that opens and then
 * says nothing looks like a relay that is up and broken; one that does not open yet looks like a
 * relay that is not up — which is what the client's "waking" line has to be tested against.
 */
const server = createServer((req, res) => {
  res.writeHead(426)
  res.end()
})
/* ⚠️ THE PIPE IS AS WIDE AS THE REAL ONE, imported rather than copied. A frame size is the
   transport's rule, not a check on what the park says, so it is the one refusal this double keeps:
   without it a client frame the relay would close with 1009 would sail through here, and the
   first anybody heard of it would be on the live site. */
const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MSG_BYTES })
server.on('upgrade', (req, socket, head) => {
  const go = () => wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req))
  const wait = started + WAKE - Date.now()
  if (wait > 0) setTimeout(go, wait)
  else go()
})
if (KILL_AT > 0)
  setTimeout(() => {
    console.log('[stub] STUB_KILL_AT — exiting, as a deploy would')
    process.exit(1)
  }, KILL_AT).unref()
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
/** a close after whatever was sent before it, lag included */
const closeAfter = (ws) => setTimeout(() => ws.close(1008), LAG)

/**
 * Lab tables: roomId -> { clients: Map<id, { ws, uid, sentAuth, vouched, times }>, door, times }.
 * Every decision is labDoor's; this is only the bookkeeping the relay keeps in its own rooms map.
 */
const labs = new Map()
/** uid -> the friends its tab said it has, from `stub-who` — the stub's whole Supabase */
const said = new Map()
let labTimes = []
const labVouched = (room) => [...room.clients.values()].filter((c) => c.vouched).map((c) => c.uid)
const labCounts = () => [...labs.values()].map(labVouched).map((v) => v.length)
const mutual = (a, b) => (said.get(a)?.has(b) && said.get(b)?.has(a) ? 'yes' : 'no')

function labLeave(roomId, id) {
  const room = labs.get(roomId)
  const me = room?.clients.get(id)
  if (!me) return
  clearTimeout(me.timer)
  room.clients.delete(id)
  if (room.clients.size === 0) labs.delete(roomId)
  else
    for (const frame of leaveFrames(id, me.vouched))
      for (const c of room.clients.values()) if (c.vouched) send(c.ws, frame)
}

wss.on('connection', (ws) => {
  const id = 'p' + next++
  let roomId = null

  const labRefuse = (code) => {
    send(ws, { type: 'error', code, message: SAY[code] })
    if (roomId && labs.has(roomId)) labLeave(roomId, id)
    roomId = null
    closeAfter(ws)
  }

  function labHello(want) {
    if (!isLabId(want)) return labRefuse('bad-room')
    if (roomId === want) return
    if (roomId && labs.has(roomId)) labLeave(roomId, id)
    let room = labs.get(want)
    if (room && room.clients.size >= LAB.sockets) return labRefuse('lab-full')
    if (!room) labs.set(want, (room = { clients: new Map(), door: doorFor(), times: [] }))
    const me = { ws, uid: null, sentAuth: false, vouched: false, times: [], timer: null }
    room.clients.set(id, me)
    roomId = want
    for (const frame of helloFrames(id)) send(ws, frame)
    me.timer = setTimeout(() => {
      if (labs.get(want)?.clients.get(id) === me && vouchTimerCloses(me)) labRefuse('members-only')
    }, LAB.vouchMs)
    console.log(`[stub] ${id} at a lab table (${room.clients.size} here)`)
  }

  function labWho(room, me, msg) {
    const uid = typeof msg.uid === 'string' ? msg.uid.slice(0, 64) : ''
    if (!uid || me.sentAuth || me.vouched) return
    const friends = Array.isArray(msg.friends) ? msg.friends.slice(0, 64) : []
    said.set(uid, new Set(friends.filter((f) => typeof f === 'string')))
    /* the token and the standing, stubbed: a tab that says who it is has a good session, so the
       door goes straight to the friends question — through labDoor, as the relay's does */
    me.sentAuth = true
    const here = () => labs.get(roomId) === room && room.clients.get(id) === me
    void room.door
      .check({
        uid,
        vouched: () => labVouched(room),
        ask: (other) => mutual(uid, other),
        counts: labCounts,
        gone: () => !here(),
        enter: () => {
          me.vouched = true
          me.uid = uid
          clearTimeout(me.timer)
          const who = []
          for (const [cid, c] of room.clients)
            if (cid !== id && c.vouched) who.push({ from: cid, uid: c.uid })
          send(ws, { type: 'labin', who })
          for (const [cid, c] of room.clients)
            if (cid !== id && c.vouched) send(c.ws, { type: 'lab-here', from: id, uid })
        },
      })
      .then((verdict) => {
        if (verdict && verdict !== 'admit' && here()) labRefuse(verdict)
        console.log(`[stub] ${id} at the lab door: ${verdict ?? 'gone'}`)
      })
  }

  function labMessage(msg) {
    const room = labs.get(roomId)
    const me = room?.clients.get(id)
    if (!me) return
    if (msg.type === 'stub-who') return labWho(room, me, msg)
    if (!kindAllowed(msg.type)) return
    /* `auth` is the real relay's; a dev tab with a session sends it too, and there is nobody here
       to check it with — the stub-who beside it is what this door reads */
    if (msg.type === 'auth' || !me.vouched) return
    const m = readLab(msg, labVouched(room))
    if (!m) return
    const now = Date.now()
    const w = [
      rate(me.times, now, LAB.socketHz),
      rate(room.times, now, LAB.roomHz),
      rate(labTimes, now, LAB.globalHz),
    ]
    ;[me.times, room.times, labTimes] = w.map((x) => x.times)
    if (!w.every((x) => x.ok)) return
    for (const t of [me.times, room.times, labTimes]) t.push(now)
    for (const [cid, c] of room.clients)
      if (cid !== id && c.vouched && (!m.to || c.uid === m.to))
        send(c.ws, { type: 'lab', from: id, uid: me.uid, d: m.d })
  }

  ws.on('message', (raw) => {
    let msg
    try {
      msg = JSON.parse(String(raw))
    } catch {
      return
    }
    if (!msg || typeof msg !== 'object') return

    if (msg.type === 'hello' && looksLab(String(msg.room || '').trim())) {
      return labHello(String(msg.room).trim())
    }
    if (roomId && labs.has(roomId)) {
      if (msg.type === 'hello') labLeave(roomId, id)
      else return labMessage(msg)
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
     * ⚠️ NO OWNER CHECK HERE, AND THE REAL ONE HAS ONE. The relay is the only place a host can be
     * established, because it is the only place a socket is tied to a verified account — this
     * double has no Supabase config and no accounts at all, so it forwards whoever speaks. The
     * real relay drops a scene from anybody but the park's owner (its `scene` case asks
     * park_rooms), so a guest's scene that works here does nothing there.
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
    if (roomId && labs.has(roomId)) return labLeave(roomId, id)
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

  /* ⚠️ A FRAME PAST THE CAP ARRIVES HERE, and `ws` closes that socket by itself afterwards (1009),
     which runs the close handler above. With no listener the error is thrown instead, and nothing
     in this file catches it: one oversized frame would end the double for everyone in it. */
  ws.on('error', () => {})
})

/* the port actually bound, so PORT=0 works — scripts/relay-harness.mjs reads this line */
server.listen(PORT, () => {
  console.log(
    `[stub] doorless park relay listening on :${server.address().port} — development only`,
  )
})
