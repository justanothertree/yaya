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
import { createClient } from '@supabase/supabase-js'
// The SAME parser the CLI uses — see the note in that file.
import { parseTrades } from './lib/parseTrades.mjs'

const PORT = process.env.PORT ? Number(process.env.PORT) : 8080
const WS_DEBUG = process.env.WS_DEBUG === '1' || process.env.WS_DEBUG === 'true'

// Max incoming message size (32 KB) – prevents DoS via huge payloads.
const MAX_MSG_BYTES = 32768
// Max length for user-supplied strings before they are truncated.
const MAX_NAME_LEN = 64
// In-match chat. Nothing is stored: the relay forwards a line to the room and forgets it.
const MAX_CHAT_LEN = 300
// A relay that forwards anything to everyone needs a ceiling, or one client can flood a room.
const CHAT_BURST = 5
const CHAT_WINDOW_MS = 4000
const MAX_ROOM_ID_LEN = 64
/** How many rooms may exist at once. See the room-leak note in the hello handler. */
const MAX_ROOMS = Number(process.env.MAX_ROOMS || 500)
/**
 * How fast one address may open sockets, and how many may be open at once.
 *
 * MAX_ROOMS bounds what a flood can allocate; it does nothing about the flood itself. Opening
 * and dropping sockets costs a TLS handshake and an event-loop slot each, and every one of
 * them is unauthenticated — so the ceiling has to sit in front of the handshake, not after it.
 *
 * Sized against real use, not a guess: the shipped client opens ONE socket per room join, and
 * the busiest hour this relay has ever seen is a single player finishing 13 rounds. Thirty a
 * minute is far above anything a person produces and far below what a script needs.
 */
const CONN_BURST = Number(process.env.CONN_BURST || 30)
/** Total connections a minute, across everyone — the backstop for a forged address. */
const CONN_BURST_GLOBAL = Number(process.env.CONN_BURST_GLOBAL || 240)
const CONN_WINDOW_MS = Number(process.env.CONN_WINDOW_MS || 60000)
const MAX_CLIENTS = Number(process.env.MAX_CLIENTS || 400)
/** Whether x-forwarded-for can be believed. True on Render; false if exposed directly. */
const TRUST_PROXY = process.env.TRUST_PROXY !== 'false'

// Default settings mirrored from client DEFAULT_SETTINGS
const DEFAULT_SETTINGS = {
  grid: 30,
  // Mirrors DEFAULT_SETTINGS in src/game/manager.tsx — change both together.
  apples: 4,
  passThroughEdges: true,
  canvasSize: 'medium',
}

// Supabase env (server-side). These should be configured in Render:
// SUPABASE_URL, SUPABASE_ANON_KEY
const SUPABASE_URL = process.env.SUPABASE_URL || ''
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || ''
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const SCHED_INTERVAL_MS = Number(process.env.SCHEDULE_TICK_MS || 30000)
const SCHEDULE_BATCH_SIZE = Number(process.env.SCHEDULE_BATCH_SIZE || 50)

function createSupabaseServiceClient() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return null
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

/**
 * ⚠️ `run_due_scheduled_trades` DOES NOT EXIST in the database, and neither does the
 * `finance.scheduled_trades` table it was meant to drain. Checked across every schema on
 * 2026-08-21: no such function, no such table. The feature was documented in
 * docs/supabase-contract.md and wired up here, but never actually shipped server-side.
 *
 * Left running, this fired every 30 seconds forever — roughly 2,880 failed service-role calls a
 * day, each logging an error line. That is Render CPU and log volume spent on nothing, and a
 * steady drip of noise that would bury a real error.
 *
 * So the tick DISABLES ITSELF the first time the function turns out to be missing, rather than
 * being deleted: if the feature is ever built, a restart picks it straight back up. Any other
 * error still just logs, because a transient failure should not switch the scheduler off.
 */
let schedulerTimer = null
let schedulerOff = false

function isMissingFunction(error) {
  const code = String(error?.code || '')
  const msg = String(error?.message || error || '')
  // PostgREST: PGRST202 = no matching function; Postgres: 42883 = undefined_function
  return (
    code === 'PGRST202' ||
    code === '42883' ||
    /could not find the function|does not exist/i.test(msg)
  )
}

async function runDueScheduledTradesTick(sb) {
  if (!sb || schedulerOff) return
  try {
    const { data, error } = await sb.rpc('run_due_scheduled_trades', {
      limit_count: SCHEDULE_BATCH_SIZE,
    })
    if (error) {
      if (isMissingFunction(error)) {
        schedulerOff = true
        if (schedulerTimer) clearInterval(schedulerTimer)
        console.warn(
          '[ws][scheduler] run_due_scheduled_trades does not exist — scheduler stopped. ' +
            'Build the function and restart to re-enable.',
        )
        return
      }
      console.error('[ws][scheduler] run_due_scheduled_trades failed', error.message || error)
      return
    }
    const processed = Number(data?.processed ?? 0)
    const done = Number(data?.done ?? 0)
    const failed = Number(data?.failed ?? 0)
    if (processed > 0 || done > 0 || failed > 0) {
      console.log(`[ws][scheduler] processed=${processed} done=${done} failed=${failed}`)
    }
  } catch (err) {
    console.error('[ws][scheduler] unexpected error', err)
  }
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
  const seedData = { seed: room.seed, settings }
  /**
   * Race apples ride ALONG WITH the seed rather than in a message after it.
   *
   * They used to be a separate broadcast, and the board started empty for a second or two:
   * the seed makes the client throw its engine away and build a new one, so an apple list that
   * arrives around the same moment lands on whichever engine happens to exist right then.
   * Carrying them in the seed makes the round and its apples one atomic thing — there is no
   * ordering left to get wrong.
   */
  if (settings.race) {
    startRace(room)
    seedData.apples = room.apples
  }
  // Tron's board is empty at the start by definition — the trails ARE the round — so there is
  // nothing to send with the seed, only state to clear.
  /**
   * Distinct starting cells whenever snakes can collide with each other — which is tron OR
   * solid bodies, not tron alone.
   *
   * Every engine spawns on the middle square facing right. That is invisible while boards are
   * private, and fatal the moment they aren't: with crash on, every player begins stacked on one
   * cell travelling the same way, so a race ended in a pile-up before anyone had turned. Tron got
   * starts when it was built; solid bodies arrived later and inherited the bug.
   */
  if (settings.solidBodies) room.crashed = new Set()
  if (settings.tron) startTron(room)
  if (settings.tron || settings.solidBodies) seedData.starts = tronStarts(room)
  return { type: 'seed', roundId, seedData }
}

function sanitizeSettings(input, prev) {
  const next = { ...(prev || DEFAULT_SETTINGS) }
  if (!input || typeof input !== 'object') return next
  const s = input
  // Ceiling raised from 4 so the count can be typed rather than only picked. Still bounded:
  // apples are spawned in a loop against free cells, so an unbounded number would spin.
  // No upper bound by request. Spawning loops against free cells and is guarded, so a silly
  // number fills the board instead of hanging; the floor of 1 is what actually matters.
  if (typeof s.apples === 'number' && s.apples >= 1) next.apples = Math.floor(s.apples)
  if (typeof s.passThroughEdges === 'boolean') next.passThroughEdges = s.passThroughEdges
  if (typeof s.grid === 'number' && s.grid >= 10 && s.grid <= 60) next.grid = s.grid
  if (typeof s.canvasSize === 'string' && ['small', 'medium', 'large'].includes(s.canvasSize)) {
    next.canvasSize = s.canvasSize
  }
  if (typeof s.race === 'boolean') next.race = s.race
  if (typeof s.tron === 'boolean') next.tron = s.tron
  if (typeof s.tronRivals === 'boolean') next.tronRivals = s.tronRivals
  if (typeof s.solidBodies === 'boolean') next.solidBodies = s.solidBodies
  if (typeof s.ghosts === 'boolean') next.ghosts = s.ghosts
  /**
   * Hunger was missing here, and the symptom was baffling: toggling it on in a room flickered
   * and the seconds options never appeared. This list is an ALLOWLIST — anything absent is
   * dropped — so the client set hunger, sent it, and the relay echoed the room's settings back
   * without it, undoing the click. A setting that isn't here doesn't half-work, it silently
   * reverts. Add new ones here at the same time as the client control.
   */
  if (typeof s.hunger === 'boolean') next.hunger = s.hunger
  if (typeof s.hungerSeconds === 'number' && s.hungerSeconds >= 2 && s.hungerSeconds <= 120) {
    next.hungerSeconds = Math.floor(s.hungerSeconds)
  }
  if (typeof s.raceTarget === 'number' && s.raceTarget >= 5 && s.raceTarget <= 500) {
    next.raceTarget = Math.floor(s.raceTarget)
  }
  if (typeof s.speedMs === 'number' && s.speedMs >= 40 && s.speedMs <= 400) {
    next.speedMs = Math.floor(s.speedMs)
  }
  return next
}

/* ── race mode: the relay owns the apples ────────────────────────────────────
 * In classic, every client spawns its own apples from a shared seed. The seed makes the
 * STARTING board identical, but each client respawns when ITS player eats, so the boards drift
 * apart the moment anyone scores. That's fine for "same course, separate runs" and it is not a
 * race: nobody can take an apple from anybody.
 *
 * Race makes the apples shared, and shared state needs one owner. This is it. Clients claim an
 * apple; the relay decides who got there first, and the score it keeps is the one the winner is
 * judged on — a client that grew optimistically and lost the race still doesn't score for it.
 */

/** mulberry32, same as the client's, so a room's apples are reproducible from its seed. */
function makeRand(seed) {
  let t = seed >>> 0
  return function rand() {
    t += 0x6d2b79f5
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r)
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
}

function spawnApples(room) {
  const grid = (room.settings || DEFAULT_SETTINGS).grid || 30
  const want = (room.settings || DEFAULT_SETTINGS).apples || 2
  const taken = (p) => room.apples.some((a) => a.x === p.x && a.y === p.y)
  // Bounded: a full board would otherwise spin here forever.
  let guard = grid * grid * 4
  while (room.apples.length < want && guard-- > 0) {
    const p = { x: Math.floor(room.rand() * grid), y: Math.floor(room.rand() * grid) }
    if (!taken(p)) room.apples.push(p)
  }
}

/* ── tron: the relay owns the trails ─────────────────────────────────────────
 * Ghost snakes are drawn but not solid, because collision needs an arbiter and a phantom death
 * from someone else's lag feels terrible. Tron is the mode where they ARE solid, so it needs
 * that arbiter — and this is the same shape as apples: one owner, clients claim, relay decides.
 *
 * Each move a client claims the cell it is entering. Taken already, by anyone including itself?
 * That client crashed. Free? The cell becomes trail and everyone is told to draw it.
 *
 * This works here because the round trip is well under one tick (~32ms measured against the
 * deployed relay, versus 110ms a tick at normal speed), so a claim resolves before the player's
 * next move. It would be the wrong design on a slow link, where you would die a tick after the
 * fact for a cell that looked empty.
 */

function startTron(room) {
  // A Map, not a Set: the cell has to remember WHOSE line it is, because whether a rival's
  // trail is lethal is a setting. Without an owner the relay can only answer "is this taken",
  // which is the wrong question when only your own line kills you.
  room.trail = new Map()
  room.crashed = new Set()
}

/**
 * Where each player starts when snakes can hit each other.
 *
 * Every snake is spawned on the middle cell, which is fine when boards are private — in classic
 * and race you each have your own copy of the grid. Tron shares one board, so identical starts
 * mean everyone is stacked on the same square and the round is decided on tick one. Riders are
 * spread evenly around a circle, each facing along it, so nobody begins pointed at a wall or at
 * somebody's face.
 */
function tronStarts(room) {
  const grid = (room.settings || DEFAULT_SETTINGS).grid || 30
  const ids = Array.from(room.clients.keys()).filter((pid) => !(room.state.get(pid) || {}).spectate)
  const r = Math.max(3, Math.floor(grid / 3))
  const mid = Math.floor(grid / 2)
  const starts = {}
  ids.forEach((pid, i) => {
    const a = (i / Math.max(1, ids.length)) * Math.PI * 2
    const x = Math.min(grid - 1, Math.max(0, Math.round(mid + Math.cos(a) * r)))
    const y = Math.min(grid - 1, Math.max(0, Math.round(mid + Math.sin(a) * r)))
    /**
     * Tangent to the circle, SNAPPED TO ONE AXIS: everyone sets off the same way round, so the
     * opening is a chase rather than a head-on.
     *
     * Rounding both components independently produced diagonals — a start of (1,-1) came out of
     * the very first test — and a snake has no diagonal. Taking whichever component is larger
     * gives the nearest legal heading.
     */
    const tx = -Math.sin(a)
    const ty = Math.cos(a)
    const dir =
      Math.abs(tx) >= Math.abs(ty) ? { x: tx >= 0 ? 1 : -1, y: 0 } : { x: 0, y: ty >= 0 ? 1 : -1 }
    starts[pid] = { x, y, dir }
  })
  return starts
}

const cellKey = (x, y) => x + ',' + y

/**
 * Who is still riding.
 *
 * Two things this must NOT do. It must not count people who merely have the page open: a round's
 * participants are frozen at the start, so somebody sitting in the lobby or who joined midway
 * would otherwise keep the round alive forever because they can never crash. And it must not
 * count people who have gone: room.state is deliberately never deleted on disconnect, so a
 * departed player would linger as an eternal survivor.
 */
function stillRiding(room) {
  const r = room.round
  const pool =
    r && r.active && r.participants && r.participants.size
      ? Array.from(r.participants)
      : Array.from(room.clients.keys())
  return pool.filter(
    (pid) =>
      room.clients.has(pid) && !room.crashed.has(pid) && !(room.state.get(pid) || {}).spectate,
  )
}

/** Start a race round: fresh apples, scores back to zero. */
function startRace(room) {
  room.rand = makeRand(room.seed || 1)
  room.apples = []
  room.raceScores = new Map()
  room.raceWinner = null
  spawnApples(room)
}

function raceScorePayload(room) {
  const target = (room.settings || DEFAULT_SETTINGS).raceTarget || 50
  const scores = []
  for (const [id, score] of room.raceScores || []) {
    scores.push({ id, name: (room.state.get(id) || {}).name, score })
  }
  scores.sort((a, b) => b.score - a.score)
  return { type: 'race', scores, target, ...(room.raceWinner ? { winner: room.raceWinner } : {}) }
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
    /**
     * Called with the SERVICE ROLE key, not the anon key.
     *
     * This function writes the leaderboard, the trophies AND `player_registry`, which is where
     * names are reserved — so an anonymous caller could forge results and squat nicknames that
     * belong to real people. The anon key is public by design, so "only the relay calls this"
     * was a convention, not a rule.
     *
     * Using the service key lets EXECUTE be revoked from anon and authenticated, which turns it
     * into a rule. Falls back to anon so a relay without the key keeps working — but that is a
     * misconfiguration worth shouting about, because the revoke will make it fail.
     */
    if (!SUPABASE_SERVICE_ROLE_KEY) {
      console.warn(
        '[ws] finalize_round_rpc falling back to the ANON key — set SUPABASE_SERVICE_ROLE_KEY',
      )
    }
    const finalizeKey = SUPABASE_SERVICE_ROLE_KEY || SUPABASE_ANON_KEY
    const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/finalize_round_rpc`, {
      method: 'POST',
      headers: {
        apikey: finalizeKey,
        Authorization: `Bearer ${finalizeKey}`,
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

/**
 * Rescue rounds that can never finish on their own.
 *
 * A player whose socket stays open but who stops sending — a frozen tab, a phone put to
 * sleep, a laptop lid closed — leaves the round un-finalizable forever, and everyone
 * else's scores die with it when the room is eventually dropped.
 *
 * Keyed on SILENCE, not elapsed time, and that distinction is the whole safety argument:
 * a client that is actually playing sends `tick` every game tick and `preview` every
 * animation frame, so it is impossible for someone still playing to trip this. Only a
 * client that has said nothing for two solid minutes is treated as gone, and it keeps the
 * last score they were seen playing — the same rule as a clean disconnect.
 */
const STUCK_IDLE_MS = Number(process.env.STUCK_IDLE_MS || 120000)
// Check often enough that the rescue actually lands near the threshold rather than up to a
// sweep late — and so a shorter threshold stays meaningful instead of being rounded away.
const STUCK_SWEEP_MS = Math.max(1000, Math.min(15000, Math.floor(STUCK_IDLE_MS / 2)))

async function sweepStuckRounds() {
  const now = Date.now()
  for (const [roomId, room] of rooms) {
    const r = room.round
    if (!r || !r.active || r.finalizing || r.finalized) continue
    if (!r.participants || r.participants.size === 0) continue
    if (!r.finished) r.finished = new Set()
    let rescued = false
    for (const pid of r.participants) {
      if (r.finished.has(pid)) continue
      const st = room.state.get(pid) || {}
      const seen = Number(st.lastSeen || 0)
      if (seen && now - seen > STUCK_IDLE_MS) {
        r.finished.add(pid) // keeps st.lastScore, same as a disconnect
        rescued = true
        if (WS_DEBUG) console.log(`[ws] stuck participant ${pid} in ${roomId} — treating as gone`)
      }
    }
    if (rescued) await tryFinalize(room, roomId)
  }
}

setInterval(() => {
  void sweepStuckRounds()
}, STUCK_SWEEP_MS).unref?.()

/**
 * Short-lived TURN credentials, minted here because the API token cannot go in the browser.
 *
 * WHY TURN AT ALL: without a relay, two people whose networks both refuse direct connections
 * simply never connect — the call reports "Some networks block direct calls", which is honest
 * but unfixable from the client. TURN forwards their media through Cloudflare instead. Only the
 * minority of connections that cannot go peer-to-peer ever use it.
 *
 * Credentials are short-lived by design: they are handed to the browser, so a long-lived one is
 * a long-lived secret sitting in someone's dev tools. The API token itself never leaves here.
 *
 * Unconfigured is not an error. Without the env vars this returns the plain STUN list and calls
 * work exactly as they did before — which keeps the relay deployable without a Cloudflare
 * account at all.
 */
const TURN_KEY_ID = process.env.CF_TURN_KEY_ID || ''
const TURN_API_TOKEN = process.env.CF_TURN_API_TOKEN || ''
/** an hour is plenty for a call and short enough that a leaked credential is worth little */
const TURN_TTL = Number(process.env.CF_TURN_TTL || 3600)
const FALLBACK_ICE = [{ urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302'] }]

/** cached because every joiner asks, and the credentials are valid for the whole TTL anyway */
let iceCache = { at: 0, servers: null }

async function iceServers() {
  if (!TURN_KEY_ID || !TURN_API_TOKEN) return FALLBACK_ICE
  // re-mint at half life, so nobody is ever handed one that expires mid-call
  if (iceCache.servers && Date.now() - iceCache.at < (TURN_TTL * 1000) / 2) return iceCache.servers
  try {
    const r = await fetch(
      `https://rtc.live.cloudflare.com/v1/turn/keys/${TURN_KEY_ID}/credentials/generate-ice-servers`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${TURN_API_TOKEN}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ttl: TURN_TTL }),
      },
    )
    if (!r.ok) throw new Error(`turn ${r.status}`)
    const data = await r.json()
    const servers = Array.isArray(data?.iceServers)
      ? data.iceServers
      : data?.iceServers
        ? [data.iceServers]
        : null
    if (!servers) throw new Error('turn: unexpected shape')
    iceCache = { at: Date.now(), servers }
    return servers
  } catch (err) {
    // A relay we cannot reach must not take calls down with it: fall back to STUN, which is
    // exactly the behaviour before TURN existed.
    console.error('[ice] falling back to STUN:', err?.message || err)
    return FALLBACK_ICE
  }
}

/**
 * Account-wide TURN usage, straight from Cloudflare.
 *
 * The client can measure its OWN relayed bytes from getStats, but that is one device's view of
 * a bill that covers everyone. This is Cloudflare's own accounting — the same numbers they
 * charge from — so it is both account-wide and authoritative.
 *
 * Costs nothing per call: it is one query, made only when someone opens the usage panel, and
 * cached for a quarter of an hour on top of that. Nothing is added to the call path, which is
 * the part that must stay cheap.
 *
 * Needs a token with the Account Analytics permission — NOT the TURN key token, which can only
 * mint credentials. Unset means the endpoint politely says so and the UI falls back.
 */
/**
 * Who is asking?
 *
 * Both endpoints below were wide open when written, and neither should be:
 *  - `/ice` HANDS OUT TURN CREDENTIALS. Anyone who could curl it could relay their own traffic
 *    through this Cloudflare account, on our quota and eventually our bill.
 *  - `/usage` reports what the account has spent, which is nobody else's business.
 *
 * Verified against Supabase rather than with a shared secret, because the browser already holds
 * a session and a secret shipped to the browser is not a secret. Cached briefly so a busy call
 * doesn't re-verify the same token on every request.
 */
const tokenCache = new Map()
const TOKEN_TTL = 60_000

function bearer(req) {
  const raw = req.headers?.authorization || ''
  return raw.startsWith('Bearer ') ? raw.slice(7) : ''
}

async function verifyUser(req) {
  const token = bearer(req)
  if (!token || !SUPABASE_URL || !SUPABASE_ANON_KEY) return null
  const hit = tokenCache.get(token)
  if (hit && Date.now() - hit.at < TOKEN_TTL) return hit.user
  try {
    const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_ANON_KEY },
    })
    if (!r.ok) return null
    const user = await r.json()
    const ok = user?.id ? user : null
    tokenCache.set(token, { at: Date.now(), user: ok })
    // the cache is per-token and unbounded otherwise; a call has a handful of tokens at most
    if (tokenCache.size > 200) tokenCache.clear()
    return ok
  } catch {
    return null
  }
}

/** Admin per the database's own rule (is_admin -> admin_users), never a copy of it here. */
async function isAdmin(req) {
  const token = bearer(req)
  if (!token || !SUPABASE_URL || !SUPABASE_ANON_KEY) return false
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/is_admin`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
      },
      body: '{}',
    })
    if (!r.ok) return false
    return (await r.json()) === true
  } catch {
    return false
  }
}

const CF_ACCOUNT_ID = process.env.CF_ACCOUNT_ID || ''
const CF_ANALYTICS_TOKEN = process.env.CF_ANALYTICS_TOKEN || ''
const USAGE_QUERY = `query turnUsage($accountId: String!, $from: Date!, $to: Date!) {
  viewer {
    accounts(filter: { accountTag: $accountId }) {
      callsTurnUsageAdaptiveGroups(limit: 1000, filter: { date_geq: $from, date_leq: $to }) {
        sum { egressBytes ingressBytes }
      }
    }
  }
}`

let usageCache = { at: 0, body: null }

async function turnUsage() {
  if (!CF_ACCOUNT_ID || !CF_ANALYTICS_TOKEN) {
    return { configured: false, reason: 'CF_ACCOUNT_ID / CF_ANALYTICS_TOKEN not set' }
  }
  if (usageCache.body && Date.now() - usageCache.at < 15 * 60_000) return usageCache.body
  const now = new Date()
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    .toISOString()
    .slice(0, 10)
  const to = now.toISOString().slice(0, 10)
  try {
    const r = await fetch('https://api.cloudflare.com/client/v4/graphql', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${CF_ANALYTICS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        query: USAGE_QUERY,
        variables: { accountId: CF_ACCOUNT_ID, from, to },
      }),
    })
    /**
     * ⚠️ Check the HTTP status BEFORE trusting the body.
     *
     * GraphQL errors were handled, but a transport-level failure was not: a 401 or 403 from a
     * stale CF_ANALYTICS_TOKEN can answer with a body that has no `errors` array, in which case
     * `groups` falls through to [] and this reports egressBytes: 0 — "you have used nothing" —
     * and caches that for 15 minutes.
     *
     * Reporting zero usage when the real answer is unknown is the worst possible failure for
     * this endpoint, because its entire purpose is to answer "am I about to be charged". An
     * error says "go and look"; a confident zero says "no need".
     */
    if (!r.ok) {
      const detail = (await r.text().catch(() => '')).slice(0, 200)
      throw new Error(`cloudflare http ${r.status}${detail ? ` — ${detail}` : ''}`)
    }
    const data = await r.json()
    if (data?.errors?.length) throw new Error(data.errors[0]?.message || 'graphql error')
    const groups = data?.data?.viewer?.accounts?.[0]?.callsTurnUsageAdaptiveGroups ?? []
    let egress = 0
    let ingress = 0
    for (const g of groups) {
      egress += Number(g?.sum?.egressBytes || 0)
      ingress += Number(g?.sum?.ingressBytes || 0)
    }
    // Billed on the total moved through the relay, so report the sum and its parts.
    const body = { configured: true, from, to, egressBytes: egress, ingressBytes: ingress }
    usageCache = { at: Date.now(), body }
    return body
  } catch (err) {
    return { configured: true, error: String(err?.message || err) }
  }
}

const server = createServer((req, res) => {
  /**
   * ⚠️ TWO VALUES, ON PURPOSE. `url` is the PATH, for routing; `rawUrl` still has the query
   * string, for anything that needs to read one.
   *
   * There used to be only the stripped one, and /import-trades read its `commit=1` flag off it —
   * a flag that could therefore never be true. Pressing Import parsed the file, reported a
   * dry-run summary and wrote nothing, which looks identical to a successful import that had
   * nothing to add. It cost an evening and a wrong accusation about a missing key.
   */
  const rawUrl = req.url || ''
  const url = rawUrl.split('?')[0]
  if (url === '/usage') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type')
    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }
    // What the account has spent is the operator's business and nobody else's.
    void isAdmin(req).then(async (ok) => {
      if (!ok) {
        res.writeHead(403, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'admin only' }))
        return
      }
      const body = await turnUsage()
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(body))
    })
    return
  }
  if (url === '/ice') {
    // the browser fetches this cross-origin from the site
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type')
    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }
    /**
     * Signed in gets the relay; everyone else still gets STUN.
     *
     * Deliberately not a 401: refusing outright would break calls for anyone whose session had
     * expired, to protect a resource they may not even need. Falling back to STUN costs a
     * stranger nothing that was ours and still connects the majority of calls.
     */
    void verifyUser(req).then(async (user) => {
      const servers = user ? await iceServers() : FALLBACK_ICE
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ iceServers: servers, relay: !!user }))
    })
    return
  }
  /**
   * Importing broker CSVs without a terminal.
   *
   * The whole reason this exists: doing it from the command line means downloading a file,
   * finding it, and putting a SERVICE-ROLE KEY on a command line — a step that can fail four
   * ways and reports the same message for all of them. A process with that many steps does not
   * become a monthly habit, and that is how the trades and the prices both went months stale.
   *
   * Here, being signed in as an admin IS the credential. The service key never leaves this
   * process, and the browser never sees one.
   *
   * ⚠️ Parsing is shared/parseTrades.mjs — the SAME module the CLI uses. A second parser would
   * be a second set of answers about somebody's money.
   *
   * POST /import-trades          -> parse only, return the summary. Writes nothing.
   * POST /import-trades?commit=1 -> parse, then insert + even-split via the admin RPCs.
   */
  /**
   * ⚠️⚠️ RENDER'S HEALTH CHECK POINTS AT THIS PATH. IT MUST STAY UNAUTHENTICATED AND RETURN 2xx.
   *
   * This is not a preference. Render probes `/health` after every deploy and waits for a success
   * code before switching traffic to the new instance. An admin-gated route here answered its
   * probe with 403, so every deploy "succeeded" at build time and then FAILED at the health
   * check, and Render quietly kept serving the previous build. That is the whole reason a string
   * of pushes appeared to deploy and did nothing — including the fix for the import bug they
   * were meant to carry.
   *
   * Explicitly routed rather than left to the catch-all below, so that changing the catch-all
   * later cannot silently break deployment again.
   */
  if (url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ok: true }))
    return
  }

  /**
   * What this relay is actually configured with. Admin only, and BOOLEANS ONLY — never a value,
   * not even a prefix.
   *
   * Deliberately NOT on /health, for the reason directly above.
   *
   * Added because "I pressed the button and I can't tell if it worked" had no answerable form:
   * a missing env var on Render looks identical from the outside to a bug in the code, and the
   * only way to tell them apart was to guess. A check that can distinguish them is worth more
   * than another round of guessing.
   */
  if (url === '/relay-config') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type')
    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }
    void isAdmin(req).then((ok) => {
      if (!ok) {
        res.writeHead(403, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'admin only' }))
        return
      }
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(
        JSON.stringify({
          node: process.version,
          uptimeSeconds: Math.round(process.uptime()),
          /**
           * What the proxy in front of us actually sends, and what the rate limiter makes of it.
           *
           * Here because assuming the shape of this header already cost one silently dead rate
           * limit: the ceiling keyed on the rightmost entry, which turned out to vary per
           * connection on Render, so every caller got a fresh budget and nothing was ever
           * refused. Admin-only, and it only ever reveals the caller's own chain.
           */
          xff: {
            raw: req.headers['x-forwarded-for'] ?? null,
            socket: req.socket?.remoteAddress ?? null,
            trustProxy: TRUST_PROXY,
            usedAsKey: clientAddr(req),
          },
          connections: {
            perAddressPerWindow: CONN_BURST,
            globalPerWindow: CONN_BURST_GLOBAL,
            windowMs: CONN_WINDOW_MS,
            addressesTracked: connLog.size,
            inWindow: connLogAll.length,
            open: wss.clients.size,
          },
          has: {
            SUPABASE_URL: !!SUPABASE_URL,
            SUPABASE_ANON_KEY: !!SUPABASE_ANON_KEY,
            SUPABASE_SERVICE_ROLE_KEY: !!SUPABASE_SERVICE_ROLE_KEY,
            CF_TURN_KEY_ID: !!TURN_KEY_ID,
            CF_TURN_API_TOKEN: !!TURN_API_TOKEN,
          },
          // the one that decides whether Admin -> Import can write anything at all
          canImport: !!SUPABASE_SERVICE_ROLE_KEY && !!SUPABASE_URL,
        }),
      )
    })
    return
  }

  // `url` is already the path, so no need to test for a query suffix that cannot be there.
  if (url === '/import-trades') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type')
    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }
    if (req.method !== 'POST') {
      res.writeHead(405, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'POST a CSV' }))
      return
    }
    void handleImport(req, res, rawUrl)
    return
  }

  res.writeHead(200, { 'Content-Type': 'text/plain' })
  res.end('ok')
})

/** A broker export is a few hundred KB at most; anything larger is not one. */
const MAX_CSV_BYTES = 8 * 1024 * 1024

function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (c) => {
      size += c.length
      // Stop READING rather than checking at the end — the point of a limit is not to hold the
      // thing you are refusing.
      if (size > limit) {
        reject(new Error('too large'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

async function handleImport(req, res, rawUrl) {
  const say = (code, body) => {
    res.writeHead(code, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(body))
  }
  if (!(await isAdmin(req))) return say(403, { error: 'admin only' })

  /**
   * Refuse on the declared size BEFORE reading a byte.
   *
   * The streaming guard below destroys the socket, which is correct for a lying or absent
   * Content-Length — but a destroyed connection reaches the browser as a network error rather
   * than a sentence, and "something went wrong" is the worst possible answer to "your file is
   * too big". Answering first costs one header read.
   */
  const declared = Number(req.headers['content-length'] || 0)
  if (declared > MAX_CSV_BYTES) {
    return say(413, {
      error: `That file is ${(declared / 1048576).toFixed(1)} MB. Broker exports are a fraction of that — is it definitely the activity CSV?`,
    })
  }

  let payload
  try {
    payload = JSON.parse(await readBody(req, MAX_CSV_BYTES))
  } catch (err) {
    return say(400, {
      error:
        err?.message === 'too large'
          ? 'that file is too big to be a broker export'
          : 'bad request body',
    })
  }

  const csv = typeof payload?.csv === 'string' ? payload.csv : ''
  const name = typeof payload?.name === 'string' ? payload.name.slice(0, 200) : 'upload.csv'
  const since =
    typeof payload?.since === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(payload.since)
      ? payload.since
      : null
  if (!csv.trim()) return say(400, { error: 'no CSV content' })

  let parsed
  try {
    parsed = parseTrades(csv, { source: payload?.source || null, since })
  } catch (err) {
    return say(400, { error: String(err?.message || err) })
  }

  // Exact: `commit=10` is not `commit=1`, and this one boolean decides whether anything
  // is written at all.
  const commit = /[?&]commit=1(&|$)/.test(rawUrl)
  if (!commit) return say(200, { name, committed: false, ...parsed.summary })

  // Checked HERE and not earlier: a dry run writes nothing, so it has no business needing a
  // service key. Gating the preview on one meant a relay missing the key couldn't even show you
  // what was in your file — refusing to read because it might later be asked to write.
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    return say(500, {
      error: 'the relay has no service key configured, so it cannot write',
      ...parsed.summary,
      committed: false,
    })
  }

  // ── the write half ────────────────────────────────────────────────────────
  // Same two RPCs the CLI calls, in the same order. The owner is the signed-in admin rather
  // than an environment variable, which is one fewer thing to get wrong.
  const me = await verifyUser(req)
  if (!me?.id) return say(403, { error: 'admin only' })

  const rpc = async (fn, body) => {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        apikey: SUPABASE_SERVICE_ROLE_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
    const text = await r.text()
    if (!r.ok) throw new Error(`${fn}: ${text.slice(0, 300)}`)
    return text ? JSON.parse(text) : null
  }

  try {
    const imported = await rpc('admin_import_trades', {
      p_user_id: me.id,
      p_trades: parsed.trades,
    })
    const split = await rpc('admin_even_split_trades', { p_user_id: me.id })
    say(200, { name, committed: true, ...parsed.summary, imported, split })
  } catch (err) {
    say(502, { error: String(err?.message || err), ...parsed.summary, committed: false })
  }
}

const schedulerClient = createSupabaseServiceClient()
if (schedulerClient) {
  schedulerTimer = setInterval(
    () => {
      void runDueScheduledTradesTick(schedulerClient)
    },
    Math.max(5000, SCHED_INTERVAL_MS),
  )
  // the first tick is what discovers the function is missing and switches the rest off
  void runDueScheduledTradesTick(schedulerClient)
} else {
  console.warn('[ws][scheduler] disabled: missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY')
}

/**
 * The last line of defence. Several call sites are `void somePromise()` — handleImport,
 * isAdmin(req).then(...), tryFinalize(...).finally(...) — and a throw inside any of those
 * callbacks reaches here, where the default behaviour is to exit. For a relay whose whole
 * job is to still be running, logging and carrying on is the right trade: the alternative is
 * an outage of multiplayer, voice TURN and the import route together.
 */
process.on('uncaughtException', (err) => {
  console.error('[relay] uncaught exception — staying up', err)
})
process.on('unhandledRejection', (err) => {
  console.error('[relay] unhandled rejection — staying up', err)
})

/**
 * Which X-Forwarded-For entry identifies the caller.
 *
 * ⚠️ THIS READ THE RIGHTMOST ENTRY AND THE LIMIT SILENTLY DID NOTHING. The reasoning was sound
 * in the abstract — XFF is a list each proxy APPENDS to, so a forged header arrives as
 * `<their text>, <real client>`, and keying on the leftmost entry means keying on attacker
 * input. The rightmost entry is the one our own proxy wrote, so it cannot be forged.
 *
 * Measured against the real deployment, that is not what arrives. 35 connections from one
 * machine were all accepted against a ceiling of 30, which can only happen if the key differs
 * every time — so Render appends something per-connection, and the rightmost entry is
 * effectively a random string. A per-address ceiling keyed on a random string is not a ceiling.
 * It looked implemented, it passed a local test, and in production it did nothing at all.
 *
 * So: the LEFTMOST entry, which is the conventional client address and the one Render puts
 * first. It is forgeable — a client that sends its own XFF prepends whatever it likes and gets
 * a fresh budget per connection — and that is now handled by bounding the TOTAL rate as well,
 * below. Best-effort identification with a real backstop beats perfect identification of the
 * wrong thing.
 *
 * ⚠️ Do not "fix" this back to the rightmost entry without measuring the header first. That is
 * what `xff` on the admin-only /relay-config is for.
 */
function clientAddr(req) {
  // ⚠️ And only when something in front of us actually writes it. Render terminates TLS and
  // proxies, so it does; a relay exposed directly would be reading a header the client typed,
  // and should set TRUST_PROXY=false so the socket address is used instead.
  const xff = TRUST_PROXY ? req?.headers?.['x-forwarded-for'] : null
  if (typeof xff === 'string') {
    const parts = xff
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    if (parts.length) return parts[0]
  }
  return req?.socket?.remoteAddress || 'unknown'
}

/**
 * addr -> recent connection timestamps. Pruned by the heartbeat sweep below.
 *
 * ⚠️ This map is itself a leak if nothing empties it — one entry per address, forever, which is
 * precisely the shape of the room leak fixed above. Do not let the thing that bounds a flood
 * become the thing a flood grows.
 */
const connLog = new Map()
/**
 * Every recent connection, regardless of who claimed to open it.
 *
 * ⚠️ The per-address ceiling is best-effort, because the address comes from a header the client
 * can prepend to (see clientAddr). Anyone rotating a forged X-Forwarded-For gets a fresh
 * per-address budget every time, so without this there is no bound on them at all.
 *
 * Deliberately far above real use — the busiest hour this relay has ever seen is one player
 * finishing 13 rounds — because a global ceiling is a SHARED FUSE: whoever trips it locks
 * everyone else out too. Same reasoning as the global backstop on submit_score. It exists to
 * stop a flood from being unbounded, not to police normal traffic, and a single honest client
 * hits its own per-address limit eight times over before it gets near this.
 */
const connLogAll = []
/** How many connections still get to describe their address on the log. See the block below. */
let addrDiag = Number(process.env.ADDR_DIAG || 6)

function connectionAllowed(addr) {
  const now = Date.now()
  const recent = (connLog.get(addr) || []).filter((t) => now - t < CONN_WINDOW_MS)
  recent.push(now)
  connLog.set(addr, recent)

  while (connLogAll.length && now - connLogAll[0] >= CONN_WINDOW_MS) connLogAll.shift()
  connLogAll.push(now)

  return recent.length <= CONN_BURST && connLogAll.length <= CONN_BURST_GLOBAL
}

const wss = new WebSocketServer({ server })

wss.on('connection', (ws, req) => {
  /**
   * Refused before any state is allocated: no id, no room, no listeners. 4029 is the private-use
   * close code for "too many requests" — the close itself is the whole message, deliberately.
   * The chat limiter a few hundred lines down says nothing when it drops a line, on the grounds
   * that telling a flooder they have been limited tells them how fast to go; a closed socket
   * cannot be hidden the same way, so it carries a code a real client can act on and nothing
   * that describes the budget.
   */
  if (wss.clients.size > MAX_CLIENTS) {
    try {
      ws.close(4029, 'too many connections')
    } catch {
      /* already gone */
    }
    return
  }
  const addr = clientAddr(req)
  /**
   * The first few connections after a restart say what the proxy actually sends.
   *
   * ⚠️ Not decoration. This ceiling has now been wrong TWICE — once keyed on the rightmost
   * x-forwarded-for entry, once on the leftmost — and both times it deployed, refused nothing,
   * and looked fine, because a local relay has no proxy in front of it and so cannot reproduce
   * the only condition that matters. Reasoning about this header has a worse track record than
   * reading it.
   *
   * `tracked` is the tell: if it climbs with every connection then each one is getting a unique
   * key, which is exactly how a per-address ceiling ends up bounding nothing.
   *
   * Bounded to a handful per process so it can stay in permanently — a deploy prints them and
   * then goes quiet.
   */
  if (addrDiag > 0) {
    addrDiag--
    console.log(
      '[relay][addr] xff=%j socket=%j key=%j tracked=%d inWindow=%d',
      req?.headers?.['x-forwarded-for'] ?? null,
      req?.socket?.remoteAddress ?? null,
      addr,
      connLog.size,
      connLogAll.length,
    )
  }
  if (!connectionAllowed(addr)) {
    try {
      ws.close(4029, 'too many connections')
    } catch {
      /* already gone */
    }
    return
  }
  const id = uuid().slice(0, 12)
  let joinedRoomId = null
  // see the heartbeat below — a half-open socket answers no pong and gets terminated,
  // which runs this connection's normal close handler and frees its room
  ws.isAlive = true
  ws.on('pong', () => {
    ws.isAlive = true
  })
  const handleMessage = (data) => {
    // Reject oversized messages before parsing to prevent DoS.
    if (data.length > MAX_MSG_BYTES) {
      send(ws, { type: 'error', code: 'msg-too-large', message: 'Message exceeds size limit' })
      return
    }
    let msg
    try {
      msg = JSON.parse(data.toString())
    } catch {
      return
    }
    if (!msg || typeof msg !== 'object') return

    // Heartbeat for the stuck-round sweeper below. Any message counts: a client that is
    // actually playing sends `tick` every game tick and `preview` every animation frame,
    // so silence means genuinely gone, never "still playing".
    if (joinedRoomId) {
      const rm = rooms.get(joinedRoomId)
      const st = rm && rm.state.get(id)
      if (st) {
        st.lastSeen = Date.now()
        rm.state.set(id, st)
      }
    }

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
      const roomId =
        String(msg.room || '')
          .trim()
          .slice(0, MAX_ROOM_ID_LEN) || 'default'
      let room = rooms.get(roomId)
      // If room doesn't exist and client is not creating, return an error
      if (!room && !msg.create) {
        send(ws, { type: 'error', code: 'room-not-found', message: 'Room does not exist' })
        return
      }
      if (!room) {
        // A ceiling, so that a bug or a bored stranger cannot turn room creation into memory
        // exhaustion. Far above any real lobby: this relay has never held more than a handful.
        if (rooms.size >= MAX_ROOMS) {
          send(ws, { type: 'error', code: 'too-many-rooms', message: 'The relay is full' })
          return
        }
        room = {
          clients: new Map(),
          hostId: null,
          /**
           * A new room takes the CREATOR'S settings, not the defaults.
           *
           * You pick apples, board size, speed and edges in solo — that is the only place the
           * controls are usable before a room exists — then open a room to play with a friend,
           * and every one of those choices was thrown away: the room was born at DEFAULT_SETTINGS
           * and the panel kept showing yours until the first seed arrived and snapped it back.
           * The reset looked like a bug in the panel; it was the room never having been told.
           *
           * Safe to take from the client because sanitizeSettings is a bounded allowlist, and
           * this branch only runs when the room does not exist — a joiner cannot use it to
           * rewrite rules that are already in force.
           */
          settings: sanitizeSettings(msg.settings, DEFAULT_SETTINGS),
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
      /**
       * ⚠️ LEAVE THE ROOM YOU ARE IN BEFORE JOINING ANOTHER.
       *
       * `hello` used to reassign joinedRoomId without removing this client from the previous
       * room, and `close` only ever cleans up the LAST one. So the old room kept an entry for
       * a socket that had gone, its clients.size could never reach 0, and it was therefore
       * never deleted — one socket could mint rooms forever and they outlived it.
       *
       * Measured before fixing: 60,000 hellos down a single socket in 4.1s left 59,999 rooms
       * resident at 186MB, and `list` — unauthenticated, and it enumerates every room — turned
       * a 15-byte request into a 7.2MB response stringified on the event loop. The shipped
       * client never hit it because it opens a fresh socket per room.
       */
      if (joinedRoomId && joinedRoomId !== roomId) {
        const prev = rooms.get(joinedRoomId)
        if (prev) {
          prev.clients.delete(id)
          prev.state.delete(id)
          if (prev.hostId === id) {
            prev.hostId = null
            pickHost(prev)
            if (prev.hostId) broadcast(prev, { type: 'host', hostId: prev.hostId })
          }
          if (prev.clients.size === 0) rooms.delete(joinedRoomId)
          else broadcast(prev, { type: 'presence', count: prev.clients.size })
        }
      }
      room.clients.set(id, ws)
      room.state.set(id, {
        ready: false,
        spectate: false,
        lastScore: 0,
        finished: false,
        lastSeen: Date.now(),
      })
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
      /**
       * The room's rules, on arrival. Without this a guest sat in the lobby looking at their OWN
       * saved settings — editable-looking, and wrong — until the first seed replaced them mid
       * countdown. The settings broadcast only fires when the host CHANGES something, so a host
       * who was already happy with the room never sent one.
       */
      send(ws, { type: 'settings', settings: room.settings })
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
          // Truncate to prevent oversized payloads being relayed to peers.
          st.name = msg.name.trim().slice(0, MAX_NAME_LEN)
          room.state.set(id, st)
          // Broadcast name updates to peers, matching legacy behavior
          broadcast(room, { type: 'name', name: st.name, from: id }, id)
        }
        break
      }
      case 'claim': {
        // The client is entering a cell and wants to know whether it survives it. Two things can
        // be in the way: a tron trail (permanent) or another player's body (moving).
        const cfg = room.settings || DEFAULT_SETTINGS
        if (!cfg.tron && !cfg.solidBodies) break
        if (cfg.tron && !room.trail) break
        if (!room.crashed) room.crashed = new Set()
        if (room.crashed.has(id)) break
        const grid = (room.settings || DEFAULT_SETTINGS).grid || 30
        const x = Math.floor(Number(msg.x))
        const y = Math.floor(Number(msg.y))
        if (!Number.isFinite(x) || !Number.isFinite(y)) break
        if (x < 0 || y < 0 || x >= grid || y >= grid) break
        const key = cellKey(x, y)
        /**
         * Somebody else's snake, right now. Their body is as of their last preview, so this
         * picture can be up to a tick stale — which is the honest cost of solid bodies and why
         * they are opt-in. At ~32ms round trip against ~110ms a tick that window is small, but
         * it is not zero: you can die to where someone WAS.
         */
        if (cfg.solidBodies) {
          for (const [pid, pst] of room.state) {
            if (pid === id || !pst.body || pst.spectate) continue
            // Gone, or already out. room.state is never deleted on disconnect — by design, so
            // scores survive finalization — which means without this check a player who closed
            // their tab would leave their last body behind as a wall nobody can see.
            if (!room.clients.has(pid) || room.crashed.has(pid)) continue
            if (pst.body.includes(key)) {
              room.crashed.add(id)
              send(ws, { type: 'crash', x, y })
              const alive = stillRiding(room)
              if (alive.length <= 1) {
                const winnerId = alive[0]
                broadcast(room, {
                  type: 'tron',
                  over: true,
                  ...(winnerId
                    ? { winner: { id: winnerId, name: (room.state.get(winnerId) || {}).name } }
                    : {}),
                })
              }
              break
            }
          }
          if (room.crashed.has(id)) break
        }
        if (!cfg.tron) break
        const owner = room.trail.get(key)
        // `tronRivals: false` means only your own line is deadly — you ride through everyone
        // else's. Their trails are still drawn, so the board fills up and still reads as a maze;
        // it just isn't a lethal one.
        const rivalsAreSolid = (room.settings || DEFAULT_SETTINGS).tronRivals !== false
        const deadly = owner !== undefined && (owner === id || rivalsAreSolid)
        if (deadly) {
          // Taken. Told only to the player who hit it — everyone else finds out because their
          // ghost stops moving, which is the same information without a broadcast per death.
          room.crashed.add(id)
          send(ws, { type: 'crash', x, y })
          const alive = stillRiding(room)
          // Last one standing, or nobody: the round is decided.
          if (alive.length <= 1) {
            const winnerId = alive[0]
            broadcast(room, {
              type: 'tron',
              over: true,
              ...(winnerId
                ? { winner: { id: winnerId, name: (room.state.get(winnerId) || {}).name } }
                : {}),
            })
          }
          break
        }
        room.trail.set(key, id)
        // Just the new cell. Sending the whole trail every move would grow with the round —
        // exactly the thing that makes a long game get heavier the longer it goes.
        broadcast(room, { type: 'trail', x, y, from: id })
        break
      }
      case 'eat': {
        // Only meaningful in race, and only for a round that's actually running.
        if (!(room.settings || DEFAULT_SETTINGS).race || !Array.isArray(room.apples)) break
        if (room.raceWinner) break
        const x = Math.floor(Number(msg.x))
        const y = Math.floor(Number(msg.y))
        if (!Number.isFinite(x) || !Number.isFinite(y)) break
        const idx = room.apples.findIndex((a) => a.x === x && a.y === y)
        // Gone already: somebody else's claim arrived first. Nothing is sent back — their client
        // has grown a segment it didn't earn, but the SCORE is here, and the score is what the
        // round is judged on. Rolling their snake back would be a worse lie than one extra
        // segment, because it would rewrite a board the player already reacted to.
        if (idx === -1) break

        room.apples.splice(idx, 1)
        spawnApples(room)
        const next = (room.raceScores.get(id) || 0) + 1
        room.raceScores.set(id, next)

        const target = (room.settings || DEFAULT_SETTINGS).raceTarget || 50
        if (next >= target) {
          room.raceWinner = { id, name: (room.state.get(id) || {}).name, score: next }
        }
        // Everyone, including the eater: their apple list has to match the room's.
        broadcast(room, { type: 'apples', apples: room.apples, roundId: room.roundId })
        broadcast(room, raceScorePayload(room))
        break
      }
      case 'chat': {
        const st = room.state.get(id) || {}
        const text = typeof msg.text === 'string' ? msg.text.trim().slice(0, MAX_CHAT_LEN) : ''
        if (!text) break
        // Sliding window, per client. Dropped silently rather than answered with an error:
        // telling a flooder they've been limited just tells them how fast to go.
        const now = Date.now()
        const recent = (st.chatTimes || []).filter((t) => now - t < CHAT_WINDOW_MS)
        if (recent.length >= CHAT_BURST) {
          st.chatTimes = recent
          room.state.set(id, st)
          break
        }
        recent.push(now)
        st.chatTimes = recent
        room.state.set(id, st)
        // `name` comes from what this client already told the room, never from this message —
        // otherwise a sender could attribute a line to somebody else. Sender is excluded, same
        // as 'name' and 'ready'; the client shows its own line locally.
        broadcast(room, { type: 'chat', text, from: id, name: st.name }, id)
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
        /**
         * Remember where this snake actually IS.
         *
         * The relay only forwarded previews before; solid bodies need it to hold them, because
         * "did I just run into someone" can only be answered by whoever knows where everyone
         * is. A body is not a trail: it moves and the tail vacates, so this is the CURRENT
         * occupancy, replaced every preview, not a set that grows all round.
         */
        if (msg.state && Array.isArray(msg.state.snake)) {
          // ⚠️ the ELEMENTS are checked, not just the array. A single null in here threw
          // straight out of the message handler and stopped the process.
          st.body = msg.state.snake
            .slice(0, 4096)
            .filter((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y))
            .map((p) => cellKey(Math.floor(p.x), Math.floor(p.y)))
        }
        room.state.set(id, st)
        // Only relay known fields – never spread the full client message to prevent
        // arbitrary field injection from being forwarded to other clients.
        broadcast(
          room,
          {
            type: 'preview',
            from: id,
            state: msg.state ?? null,
            score: typeof msg.score === 'number' ? Number(msg.score) : 0,
            name: typeof msg.name === 'string' ? msg.name.slice(0, MAX_NAME_LEN) : undefined,
            spectate: msg.spectate === true ? true : undefined,
          },
          id,
        )
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
        // Only relay a sanitized subset – never spread the full client message
        // to avoid forwarding arbitrary attacker-controlled fields to peers.
        const relayCode = typeof msg.code === 'string' ? msg.code.slice(0, 64) : undefined
        const relayMessage = typeof msg.message === 'string' ? msg.message.slice(0, 256) : undefined
        broadcast(room, {
          type: 'error',
          from: id,
          ...(relayCode !== undefined ? { code: relayCode } : {}),
          ...(relayMessage !== undefined ? { message: relayMessage } : {}),
        })
        break
      }
      case 'settings': {
        if (id === room.hostId && msg.settings) {
          room.settings = sanitizeSettings(msg.settings, room.settings)
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
          if (WS_DEBUG) {
            try {
              console.warn('[ws] restart ignored: not host', {
                room: joinedRoomId,
                from: id,
                hostId: room.hostId,
              })
            } catch {}
          }
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
        // The apples themselves went out inside the seed above; this is just the empty
        // scoreboard, so everyone starts the round showing zeroes rather than last round's.
        if ((room.settings || DEFAULT_SETTINGS).race) {
          broadcast(room, raceScorePayload(room))
        }
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
        if (typeof msg.name === 'string' && msg.name.trim())
          meta.name = msg.name.trim().slice(0, MAX_ROOM_ID_LEN)
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
  }

  /**
   * ⚠️ A RELAY MUST NOT DIE OF A PEER'S PAYLOAD.
   *
   * ws.on(...) invokes this synchronously, so anything thrown in there escapes emit() and
   * takes the process down — and the process is not only multiplayer: it also serves /ice
   * (the TURN credentials every voice call needs), /usage, /relay-config and /import-trades.
   * The socket is unauthenticated and accepts any origin, so one malformed frame from any
   * browser console was an outage for all of it, repeatable as fast as Render restarts.
   *
   * Found by review: {"type":"preview","state":{"snake":[null]}} dereferenced p.x and killed
   * it. That specific hole is closed below where the body is read, but validating each field
   * one at a time is a race the relay loses eventually. This is the backstop that makes the
   * whole class survivable.
   */
  ws.on('message', (data) => {
    try {
      handleMessage(data)
    } catch (err) {
      console.error('[ws] message handler threw — connection kept alive', err)
      try {
        send(ws, { type: 'error', code: 'bad-message', message: 'Message could not be processed' })
      } catch {
        /* the socket may already be gone; there is nothing further to do */
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
        // Keep them IN the round, with the score they had when they left.
        //
        // We used to drop leavers from the round entirely, so a player who died and
        // closed the tab vanished from the results. Their score is still right here --
        // room.state is never deleted on disconnect and lastScore is updated live -- so
        // there is no reason to throw it away. Mark them finished instead: they can't
        // finish later, and leaving them un-finished blocks the round for everyone else.
        //
        // Deliberately NOT added to finishOrder: on a tie, someone who played it out
        // should rank above someone who left, and finishIdx defaults to last.
        r.finished.add(id)
        // If this was the last player still going, this finalizes the round now.
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
      // A round exists only in this process's memory, so dropping the room is what
      // silently loses everyone's scores when the last person leaves. Finalize first,
      // then delete — otherwise the async finalize races the delete and loses.
      const r = room.round
      if (r && r.active && !r.finalized && !r.finalizing) {
        void tryFinalize(room, joinedRoomId).finally(() => rooms.delete(joinedRoomId))
      } else {
        rooms.delete(joinedRoomId)
      }
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

/**
 * ⚠️ A SOCKET THAT DIED WITHOUT SAYING SO STILL HOLDS ITS ROOM.
 *
 * TCP does not necessarily tell you when a peer vanishes — a laptop lid, a dropped mobile
 * connection, a NAT timeout — so ws never fires 'close' and the client stays in room.clients
 * forever. clients.size can then never reach 0, so the room is never deleted. That is the same
 * end state as the room leak fixed in the hello handler, arrived at with nobody doing anything
 * wrong.
 *
 * The standard ws remedy: mark every connection dead, ping, and let a pong revive it. Anything
 * still dead on the next sweep is terminated, which runs its close handler and frees the room
 * properly rather than just dropping the reference.
 */
const HEARTBEAT_MS = Number(process.env.HEARTBEAT_MS || 30000)
const heartbeat = setInterval(() => {
  wss.clients.forEach((ws) => {
    if (ws.isAlive === false) {
      try {
        ws.terminate()
      } catch {
        /* already gone */
      }
      return
    }
    ws.isAlive = false
    try {
      ws.ping()
    } catch {
      /* the next sweep will terminate it */
    }
  })
  // and drop connection-rate entries that have aged out, so connLog cannot grow without bound
  const now = Date.now()
  for (const [addr, times] of connLog) {
    const live = times.filter((t) => now - t < CONN_WINDOW_MS)
    if (live.length) connLog.set(addr, live)
    else connLog.delete(addr)
  }
}, HEARTBEAT_MS)
// unref so the interval never keeps the process alive on its own during a shutdown
heartbeat.unref?.()
wss.on('close', () => clearInterval(heartbeat))

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[ws-server] listening on :${PORT}`)
})
