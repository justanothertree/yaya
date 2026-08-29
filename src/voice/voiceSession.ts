import { getSupabaseClient } from '../finance/client'
import { callSounds } from './callSounds'
import { registerTap } from '../audio/audioTap'
import { broadcastBus, sharedCtx } from '../audio/context'
/**
 * RNNoise — the same family of ML denoiser Krisp is built on, as open source (Xiph), compiled
 * to WASM and run in an AudioWorklet. This is the answer to "we hear each other's keyboards":
 * a level gate can't stop a keyboard, because clacks are LOUD — they open any gate that speech
 * can open. A denoiser removes them from the signal itself, and putting the gate AFTER it means
 * clacks no longer even count toward opening the gate.
 */
import { RnnoiseWorkletNode, loadRnnoise } from '@sapphi-red/web-noise-suppressor'
import rnnoiseWorkletPath from '@sapphi-red/web-noise-suppressor/rnnoiseWorklet.js?url'
import rnnoiseWasmPath from '@sapphi-red/web-noise-suppressor/rnnoise.wasm?url'
import rnnoiseWasmSimdPath from '@sapphi-red/web-noise-suppressor/rnnoise_simd.wasm?url'

/**
 * The live call, owned by the module rather than by a component.
 *
 * WHY IT MOVED OUT OF THE HOOK
 *
 * A call has to outlive whatever screen you started it on. When this lived inside Chat, the
 * peer connections were torn down the moment that component unmounted — so navigating to
 * Home, or toggling canvas, silently hung up on whoever you were talking to. It only
 * survived in canvas mode, and only by accident, because canvas keeps its panes mounted.
 *
 * This is the same rule the pinned canvas panes taught: anything that outlives its owner by
 * design must be module-level, never a closure over component state. React binds to it (see
 * useVoiceSession); it does not own it.
 *
 * Media stays peer-to-peer — see useVoiceSession's join for the mesh and why signalling
 * rides Supabase Realtime rather than the ws-server.
 */

/**
 * `status` exists because failure and emptiness used to look identical. A peer we tried and
 * failed to reach was silently dropped, so "Josh's network is blocking this" rendered as
 * "waiting for someone to join…" — the single most likely failure (no TURN relay) was also
 * the most confusing one. Every peer we know about is now visible with its real state.
 */
export type VoicePeer = {
  id: string
  name: string
  stream: MediaStream | null
  status: 'connecting' | 'connected' | 'reconnecting' | 'failed'
  /** currently making noise — drives the Discord-style "who's talking" highlight */
  speaking: boolean
  /** their screen, when they're sharing one. Separate from `stream`, which is voice. */
  share: MediaStream | null
  /**
   * True when this connection is going through the TURN relay rather than straight to them.
   * Relay is ICE's LAST resort — lowest priority of the three candidate types — so this is
   * false for anyone whose network could be reached directly, which is most people.
   */
  relayed: boolean
}

/**
 * Incoming audio runs through Web Audio rather than straight out of an <audio> element,
 * for two reasons that arrived together from testing:
 *
 *  - an element's `volume` is hard-capped at 1.0, and a friend reported that his 100% was
 *    still too quiet. Going louder than source needs a GainNode. peerVolume 0.5 is unity,
 *    so the slider reads 100% at normal and goes to 200%.
 *  - it gives us an analyser per person, which is what makes a speaking indicator possible.
 *
 * The <audio> element stays, muted, because some browsers won't flow a remote track without
 * a media element sink attached.
 */
type PeerOut = { src: MediaStreamAudioSourceNode; gain: GainNode; analyser: AnalyserNode }

export type VoiceState = {
  roomId: string | null
  roomName: string
  inCall: boolean
  /** true from pressing Call until the room accepts (or refuses) us — the button says so,
   *  and a second press while it's set is ignored rather than double-opening the mic */
  joining: boolean
  muted: boolean
  peers: VoicePeer[]
  error: string | null
  /** mic gate: below this loudness (0–1) nothing is transmitted. 0 disables the gate. */
  threshold: number
  /** per-person listening level, 0–1, keyed by peer id. Missing means 1. */
  peerVolume: Record<string, number>
  /** noise removal preference — RNNoise on the mic. Persisted; on by default. */
  denoise: boolean
  /** true when this browser can't run the denoiser (no AudioWorklet / wasm failed to load) */
  denoiseUnavailable: boolean
  /** true while WE are sharing a screen */
  sharing: boolean
  /** what the share is optimised for; switchable live, mid-share */
  shareMode: ShareMode
  /** why a share attempt was refused, e.g. too many viewers for a mesh. Cleared on success. */
  shareError: string | null
  /** the call is big enough that a mesh may start to struggle — see CALL_SOFT_LIMIT */
  crowded: boolean
}

const THRESH_KEY = 'voice.threshold.v1'
const DENOISE_KEY = 'voice.denoise.v1'

/** on unless explicitly turned off — the keyboard problem is the default problem */
function readDenoise(): boolean {
  try {
    return localStorage.getItem(DENOISE_KEY) !== '0'
  } catch {
    return true
  }
}

function readThreshold(): number {
  try {
    const v = parseFloat(localStorage.getItem(THRESH_KEY) ?? '0')
    return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0
  } catch {
    return 0
  }
}

/**
 * How many people can watch a screen share.
 *
 * THIS IS THE MESH, NOT A POLICY. Every viewer gets their own encoded copy from the sharer's
 * uplink, so N viewers costs N x the bitrate UP: ~2 Mbps each, against a typical home upload of
 * 10-20 Mbps. Three is the honest ceiling. Going beyond it needs an SFU, where the sharer
 * uploads once and a server fans it out — a different transport, and a bill.
 *
 * Refusing with a clear reason beats accepting and delivering a slideshow to everyone.
 */
const MAX_SHARE_VIEWERS = 3
/**
 * TOTAL upload budget for a screen share, split across everyone watching.
 *
 * This used to be a PER-VIEWER cap, which quietly multiplied: two viewers meant 5 Mbps leaving
 * your machine, three meant 7.5, against a home uplink that is often 10 and sometimes less —
 * and that is before you also receive everyone else's audio and any share of their own. The
 * encoders never knew about each other, so each one cheerfully believed it had room.
 *
 * Congestion does not look like stutter here, it looks like BLUR: `contentHint: 'motion'` tells
 * the encoder to protect the frame rate and spend resolution, so an oversubscribed link goes
 * soft rather than choppy. Two people sharing at once was enough to do it; one of them stopping
 * made the other sharp again.
 *
 * Budgeting the total and dividing it keeps the sum honest no matter how many are watching.
 */
const SHARE_UPLOAD_BUDGET = 4_000_000
/** below this a share is too mushy to be worth watching; better to refuse than to pretend */
const SHARE_MIN_BITRATE = 700_000
/** no single viewer needs more than this, however few of them there are */
const SHARE_MAX_BITRATE = 2_500_000

/** what each viewer's stream may use right now, given how many there are */
function shareBitrate() {
  const viewers = Math.max(1, state.peers.filter((p) => p.status !== 'failed').length)
  return Math.max(SHARE_MIN_BITRATE, Math.min(SHARE_MAX_BITRATE, SHARE_UPLOAD_BUDGET / viewers))
}

/**
 * Sharpness or smoothness — you cannot have both, and which one you want depends entirely on
 * what is on the screen.
 *
 * A fixed bitrate buys a fixed number of pixels per second, so it can be spent on MORE pixels
 * or on MORE often, never both. A game needs the frame rate and can afford soft detail; showing
 * code or a website needs the resolution and barely moves, so 5fps is plenty and every spare bit
 * goes into text that is actually readable. Downscaling a big monitor to 1080p is exactly what
 * makes text mushy, so detail mode stops downscaling as hard and pays for it in frame rate.
 *
 * `contentHint` tells the encoder the same thing in its own language: given a hard choice, keep
 * the frames ('motion') or keep the pixels ('detail').
 */
const SHARE_MODES = {
  motion: {
    label: 'Game',
    hint: 'motion' as const,
    video: { frameRate: { ideal: 30, max: 30 }, width: { max: 1920 }, height: { max: 1080 } },
  },
  detail: {
    label: 'Text',
    hint: 'detail' as const,
    // 1440p rather than the full panel: even at a few frames a second, three encoders running
    // beside a game is real work, and 4K is where that stops being free.
    video: { frameRate: { ideal: 5, max: 10 }, width: { max: 2560 }, height: { max: 1440 } },
  },
}
export type ShareMode = keyof typeof SHARE_MODES

/**
 * How many people a mesh call can hold.
 *
 * Same shape of limit as MAX_SHARE_VIEWERS and the same cause: everyone sends their voice to
 * everyone, so an N-person call is N-1 uploads and N-1 decodes PER PERSON. Voice is cheap
 * (~40kbps) so this ceiling is far higher than the screen-share one — but it is a ceiling, and
 * past it calls get choppy for everybody rather than failing cleanly for one person.
 *
 * THESE NUMBERS ARE ESTIMATES, NOT MEASUREMENTS. Nobody has stress-tested a big call on this
 * platform yet. SOFT is where the UI starts telling the truth about what's happening; HARD is
 * where it stops letting more people in. Lower them once real calls show where it actually
 * falls over — that is the whole reason the warning exists.
 */
const CALL_SOFT_LIMIT = 6
const CALL_HARD_LIMIT = 12

/**
 * STUN alone only tells you your own public address — it cannot help two networks that both
 * refuse direct connections, which is what produces "Some networks block direct calls". A TURN
 * relay forwards the media instead, and is the only fix for that case.
 *
 * Credentials are short-lived and minted by the relay (`/ice`), because the API token behind
 * them must never reach a browser. Everything here degrades: no relay, a relay that is down, or
 * a relay with no Cloudflare configured all fall back to this STUN list, which is exactly how
 * calls behaved before TURN existed.
 */
const ICE: RTCConfiguration = {
  iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }],
}

/**
 * TURN usage, measured rather than looked up.
 *
 * Cloudflare bills TURN by the gigabyte relayed, and `getStats()` knows exactly which
 * connections are relayed: a candidate pair whose local or remote candidate has
 * `candidateType === 'relay'` is going through TURN, and its byte counters are the bill. Most
 * calls never touch it, so this is usually zero — which is itself the useful thing to see.
 *
 * Counted from DELTAS per connection, because the counters restart when a connection does, and
 * treating a reset as fresh traffic would inflate the total exactly when a call was struggling.
 *
 * Stored per month in localStorage. That makes it THIS DEVICE's usage, not the account's —
 * an honest limitation, and still the number that answers "am I about to be charged", because
 * the free tier is 1000GB and one person's calls are nowhere near it.
 */
const USAGE_KEY = 'voice.turnUsage.v1'
const seenBytes = new Map<string, number>()

const monthKey = () => new Date().toISOString().slice(0, 7)

function readUsage(): Record<string, number> {
  try {
    const raw = JSON.parse(localStorage.getItem(USAGE_KEY) || '{}')
    return raw && typeof raw === 'object' ? raw : {}
  } catch {
    return {}
  }
}

function addRelayedBytes(n: number) {
  if (n <= 0) return
  const all = readUsage()
  const k = monthKey()
  all[k] = (all[k] || 0) + n
  // keep a year, drop the rest — this is a running check, not an archive
  const keys = Object.keys(all).sort().slice(-12)
  const trimmed: Record<string, number> = {}
  for (const key of keys) trimmed[key] = all[key]
  try {
    localStorage.setItem(USAGE_KEY, JSON.stringify(trimmed))
  } catch {
    /* private mode: the meter just won't persist */
  }
}

/** Walk one connection's stats and bank any bytes that went through a relay. */
async function sampleRelayUsage(peerId: string, pc: RTCPeerConnection) {
  try {
    const stats = await pc.getStats()
    const byId = new Map<string, RTCStats>()
    stats.forEach((r) => byId.set(r.id, r))
    let relayed = 0
    stats.forEach((r) => {
      const pair = r as RTCStats & {
        type: string
        state?: string
        nominated?: boolean
        localCandidateId?: string
        remoteCandidateId?: string
        bytesSent?: number
        bytesReceived?: number
      }
      if (pair.type !== 'candidate-pair' || pair.state !== 'succeeded') return
      const local = byId.get(pair.localCandidateId || '') as { candidateType?: string } | undefined
      const remote = byId.get(pair.remoteCandidateId || '') as
        | { candidateType?: string }
        | undefined
      if (local?.candidateType !== 'relay' && remote?.candidateType !== 'relay') return
      relayed += (pair.bytesSent || 0) + (pair.bytesReceived || 0)
    })
    // Surfaced per peer: "is this call costing me anything" should be answerable by looking,
    // not by trusting an explanation.
    const isRelayed = relayed > 0
    if (state.peers.find((p) => p.id === peerId)?.relayed !== isRelayed) {
      upsertPeer(peerId, { relayed: isRelayed })
    }
    const key = peerId
    const prev = seenBytes.get(key) ?? 0
    // a counter that went BACKWARDS means the connection restarted, so start from it
    const delta = relayed >= prev ? relayed - prev : relayed
    seenBytes.set(key, relayed)
    addRelayedBytes(delta)
  } catch {
    /* stats are best-effort; a missed sample only loses one interval */
  }
}

let usageTimer = 0

let pinged = false
/** resolved once per session and reused; refreshed on the next join after it expires */
let iceConfig: RTCConfiguration = ICE
let iceFetchedAt = 0

function relayHttpBase(): string | null {
  try {
    const raw = (import.meta as unknown as { env?: Record<string, string> }).env?.VITE_WS_URL
    const ws = raw || `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}`
    return ws.replace(/^ws:/, 'http:').replace(/^wss:/, 'https:').replace(/\/$/, '')
  } catch {
    return null
  }
}

/** true once the servers we hold actually include a relay, not just STUN */
let haveTurn = false
let icePending: Promise<RTCConfiguration> | null = null

/**
 * Ask the relay for ICE servers.
 *
 * THE TIMEOUT IS THE WHOLE PROBLEM HERE. The relay sleeps on a free tier and takes 30-50s to
 * wake, and nothing else in a voice call wakes it — so a short deadline meant the very first
 * call after an idle period silently fell back to STUN and failed for exactly the people TURN
 * exists to help. It has to outlast a cold start, so it does.
 *
 * Still best-effort: if it genuinely cannot be reached we keep STUN and carry on, because most
 * connections never needed a relay.
 */
async function loadIce(): Promise<RTCConfiguration> {
  // half an hour, comfortably inside the relay's TTL
  if (haveTurn && Date.now() - iceFetchedAt < 30 * 60_000) return iceConfig
  // one flight at a time: warming and joining must not each start their own cold start
  if (icePending) return icePending
  const base = relayHttpBase()
  if (!base) return ICE
  icePending = (async () => {
    try {
      const ctl = new AbortController()
      // long enough for a cold Render dyno to boot and answer
      const t = setTimeout(() => ctl.abort(), 60_000)
      /**
       * The session token is what earns the TURN credentials: the relay hands the plain STUN
       * list to anyone, and the relay only to someone signed in — otherwise a stranger could
       * mint credentials and spend this account's quota.
       */
      const { data: sess } = await getSupabaseClient().auth.getSession()
      const token = sess.session?.access_token
      const r = await fetch(`${base}/ice`, {
        signal: ctl.signal,
        headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      })
      clearTimeout(t)
      if (!r.ok) throw new Error(String(r.status))
      const data = (await r.json()) as { iceServers?: RTCIceServer[] }
      if (Array.isArray(data.iceServers) && data.iceServers.length) {
        iceConfig = { iceServers: data.iceServers }
        iceFetchedAt = Date.now()
        haveTurn = data.iceServers.some((s) =>
          [s.urls].flat().some((u) => String(u).startsWith('turn')),
        )
      }
    } catch {
      /* keep whatever we had — STUN-only still connects for most people */
    } finally {
      icePending = null
    }
    return iceConfig
  })()
  return icePending
}

type Signal =
  | { kind: 'hello'; from: string; name: string }
  | { kind: 'here'; from: string; name: string; to: string }
  | { kind: 'offer'; from: string; to: string; sdp: RTCSessionDescriptionInit }
  | { kind: 'answer'; from: string; to: string; sdp: RTCSessionDescriptionInit }
  | { kind: 'ice'; from: string; to: string; candidate: RTCIceCandidateInit }
  /**
   * "Whatever we had between us is dead — start over." Targeted at one peer rather than
   * broadcast like `hello`, so a call that is working for everyone else is left alone.
   */
  | { kind: 'again'; from: string; to: string }
  | { kind: 'bye'; from: string }

const IDLE: VoiceState = {
  roomId: null,
  roomName: '',
  inCall: false,
  joining: false,
  muted: false,
  peers: [],
  error: null,
  threshold: readThreshold(),
  peerVolume: {},
  denoise: readDenoise(),
  denoiseUnavailable: false,
  sharing: false,
  shareMode: 'motion',
  shareError: null,
  crowded: false,
}

let state: VoiceState = IDLE
const listeners = new Set<() => void>()

// live plumbing, deliberately outside the snapshot — React never needs to see these
let local: MediaStream | null = null
/** the raw mic, kept so it can be stopped; `local` is the gated stream peers receive */
let rawMic: MediaStream | null = null
let audioCtx: AudioContext | null = null
let analyser: AnalyserNode | null = null
let gate: GainNode | null = null
/** the mic's source node + the RNNoise worklet, kept so the chain can be rewired live */
let micSrc: MediaStreamAudioSourceNode | null = null
let denoiser: AudioWorkletNode | null = null
/** the wasm binary, fetched once per page — every call reuses it */
let rnnoiseBinary: ArrayBuffer | null = null
let gateTimer = 0
let micLevel = 0
let openUntil = 0
/** one shared context for playback, plus a node graph per person */
let outCtx: AudioContext | null = null
/**
 * Everyone else, mixed down to one node, for anything that wants to watch the room rather than a
 * person. Separate from the per-peer analysers on purpose: those decide who is speaking, which
 * needs them kept apart, and summing three of them per frame in a consumer would be both slower
 * and wrong (levels don't add linearly).
 */
let peersMix: AnalyserNode | null = null
const outs = new Map<string, PeerOut>()
/** master attenuation from the dock, 0–1; per-person gain multiplies on top */
let master = 1
let speakTick = 0
let chan: ReturnType<ReturnType<typeof getSupabaseClient>['channel']> | null = null
let meId: string | null = null
let myName = 'You'
const pcs = new Map<string, RTCPeerConnection>()
const names = new Map<string, string>()
/** our screen capture while sharing, kept so it can be stopped and re-added to new peers */
let share: MediaStream | null = null
/**
 * Perfect-negotiation bookkeeping, one entry per peer.
 *
 * The original design had no glare: whoever was already in the room offered to the newcomer,
 * once, and nobody ever renegotiated. Screen sharing breaks that — adding a track mid-call
 * means a second round of offers, and two people starting one at the same moment collide.
 * Politeness is decided by comparing ids so both sides always reach the same verdict without
 * having to agree on anything at runtime.
 */
/**
 * Which remote stream is a peer's SCREEN, so its audio can be told apart from their voice.
 *
 * A share can carry system audio, and that track used to fall into the generic audio branch of
 * ontrack — which routed the GAME's sound into the per-person voice mixer, replacing the actual
 * voice, while the share's <video> element played the same audio a second time. The stream id is
 * recorded when the share's video arrives (the sharer sends video first, so it always does
 * arrive first) and consulted before any audio is treated as voice.
 */
const peerShareStreamId = new Map<string, string>()

/**
 * Live per-call signalling counters, for the ⚙ panel's diagnostic line.
 *
 * This exists because a two-person share failure could not be diagnosed from either end: every
 * layer that can be checked from outside (negotiation logic, channel authorization, the deploy,
 * the relay) verified healthy, and what was missing was any view of what THIS call actually did.
 * Counting offers/answers/ice both ways splits the question cleanly: counters moving with no
 * media means the connection itself is failing; counters at zero means signalling never left.
 */
const diag = {
  offersSent: 0,
  offersRecv: 0,
  answersSent: 0,
  answersRecv: 0,
  iceSent: 0,
  iceRecv: 0,
}
const resetDiag = () => {
  diag.offersSent = diag.offersRecv = diag.answersSent = diag.answersRecv = 0
  diag.iceSent = diag.iceRecv = 0
}

const nego = new Map<string, { making: boolean; ignore: boolean }>()
const negoFor = (id: string) => {
  let n = nego.get(id)
  if (!n) nego.set(id, (n = { making: false, ignore: false }))
  return n
}
/** deterministic and opposite on the two ends, which is all perfect negotiation requires */
const isPolite = (peerId: string) => (meId ?? '') < peerId

/**
 * Candidates that arrived before there was anywhere to put them.
 *
 * `addIceCandidate` REJECTS while `remoteDescription` is null, and a rejected candidate is gone
 * — there is no retry and no second copy. The other side starts trickling the moment it sets
 * its local description, which is strictly before its offer has crossed the wire and been
 * applied here, so the first candidates always land in that gap. Losing them usually still
 * connects, because the later ones are enough; when it doesn't, ICE simply never pairs and the
 * call goes connecting → reconnecting → failed while the network is perfectly fine. Retrying
 * "fixes" it by rolling the timing dice again, which is exactly what it looked like.
 */
const pendingIce = new Map<string, RTCIceCandidateInit[]>()

/**
 * When we last threw a peer's connection away and built a new one. Kept OUTSIDE the per-peer
 * bookkeeping on purpose — resetPeerConnection clears that, so a flag living there would be
 * gone by the time it needed to stop the next rebuild, and one failing peer would loop.
 */
const rebuiltAt = new Map<string, number>()
const REBUILD_COOLDOWN_MS = 25_000

/**
 * One signalling message at a time, per peer.
 *
 * Each broadcast used to start its own detached async task, so an `ice` or `answer` could be
 * processed while the `offer` before it was still awaiting setRemoteDescription. Ordered
 * delivery over the socket bought nothing once the handlers themselves interleaved.
 */
const signalQueue = new Map<string, Promise<void>>()

/** Apply a candidate, or hold it until there is a remote description to attach it to. */
async function acceptIce(peerId: string, candidate: RTCIceCandidateInit) {
  const pc = pcs.get(peerId)
  if (!pc || !pc.remoteDescription) {
    const q = pendingIce.get(peerId) ?? []
    // Bounded: a peer that never completes a handshake must not grow this forever.
    if (q.length < 128) q.push(candidate)
    pendingIce.set(peerId, q)
    return
  }
  try {
    await pc.addIceCandidate(new RTCIceCandidate(candidate))
  } catch {
    // Candidates for an offer we deliberately ignored will fail to apply, and that is
    // expected rather than an error worth surfacing.
  }
}

/** Called the moment a remote description lands, which is the moment the held ones can apply. */
async function flushIce(peerId: string) {
  const q = pendingIce.get(peerId)
  if (!q?.length) return
  pendingIce.delete(peerId)
  for (const c of q) await acceptIce(peerId, c)
}

/** Replace the snapshot so useSyncExternalStore sees a new reference only on real change. */
function set(patch: Partial<VoiceState>) {
  state = { ...state, ...patch }
  // derived here rather than at every call site, so it cannot be forgotten in one of them.
  // +1 for us: `peers` is everyone ELSE.
  const size = state.inCall ? state.peers.length + 1 : 0
  state.crowded = size > CALL_SOFT_LIMIT
  // the audience decides each viewer's slice of the upload budget
  if (patch.peers && share) retuneShareBitrate()
  listeners.forEach((l) => l())
}

function send(msg: Signal) {
  if (msg.kind === 'offer') diag.offersSent++
  else if (msg.kind === 'answer') diag.answersSent++
  else if (msg.kind === 'ice') diag.iceSent++
  void chan?.send({ type: 'broadcast', event: 'voice', payload: msg })
}

/**
 * Connect the mic chain in whichever shape is currently right:
 * denoise on and ready:  mic → RNNoise → analyser + gate
 * otherwise:             mic → analyser + gate
 *
 * One function owns the topology so the async worklet arrival and the ⚙ toggle can't each
 * wire half of it. disconnect() without arguments is deliberate — it detaches everything the
 * node feeds, which makes this idempotent instead of throwing on a not-currently-connected
 * pair.
 */
function wireMic() {
  if (!micSrc || !analyser || !gate) return
  try {
    micSrc.disconnect()
    denoiser?.disconnect()
    if (state.denoise && denoiser) {
      micSrc.connect(denoiser)
      denoiser.connect(analyser)
      denoiser.connect(gate)
    } else {
      micSrc.connect(analyser)
      micSrc.connect(gate)
    }
  } catch {
    /* a node from a torn-down context — the next join rebuilds everything anyway */
  }
}

/**
 * Route the mic through a gate so a quiet room transmits nothing.
 *
 * This is Discord's "input sensitivity", and it exists because an always-open mic broadcasts
 * your fan, your keyboard and your family in the next room to everyone in the call. The gate
 * only decides WHETHER to send; the browser's noiseSuppression cleans up what does get sent.
 *
 * Returns the stream peers should receive. Peers get the gated output, never the raw mic.
 */
function buildGate(mic: MediaStream): MediaStream {
  try {
    // 48kHz is RNNoise's native rate; asking for it up front means the denoiser never has to
    // work on resampled-in-flight audio. Browsers resample the mic to the context rate anyway.
    // ⚠️ The SHARED context, not a private one — already pinned to 48k for exactly this
    // reason (see context.ts). Sharing it is what lets the instrument and shared music reach
    // `dest` below; nodes in different contexts cannot be connected at all.
    audioCtx = sharedCtx()
    const src = audioCtx.createMediaStreamSource(mic)
    micSrc = src
    analyser = audioCtx.createAnalyser()
    analyser.fftSize = 512
    // Publish the node rather than let a visualiser build its own. This one already sits on the
    // POST-denoise mic (see the rewire below), so what you watch is what peers hear — a separate
    // tap off the raw mic would show keyboard clacks the gate is busy hiding.
    registerTap('mic', analyser)
    gate = audioCtx.createGain()
    const dest = audioCtx.createMediaStreamDestination()
    /**
     * Anything on the broadcast bus goes out with your voice — the instrument, and music you
     * chose to share.
     *
     * ⚠️ Connected AFTER the gate rather than through it. The gate is a noise gate for
     * SPEECH: it closes when you are not talking, so routing an instrument through it would chop
     * every held note the moment you stopped speaking over it. Peers get gated voice plus
     * ungated everything-else, which is what both are supposed to sound like.
     */
    try {
      broadcastBus().connect(dest)
    } catch {
      /* no bus — the call still carries voice */
    }
    // measure off the source, gate on the way out — rewired to run through RNNoise once the
    // worklet is ready (see below); this direct chain is also the no-denoise fallback
    src.connect(analyser)
    src.connect(gate)
    gate.connect(dest)
    gate.gain.value = 1

    /**
     * Upgrade the chain to mic → RNNoise → (analyser + gate) once the worklet loads.
     *
     * Async on purpose: the call must not wait on a wasm fetch to start, so the first beat of
     * a call runs the plain chain and the denoiser splices itself in when ready — the same
     * "paint from local knowledge, verify in the background" shape used everywhere else here.
     *
     * The ORDER is the point, not just the cleanup: the analyser (which decides the gate and
     * the mic meter) listens to the DENOISED signal, so a keyboard clack that RNNoise removes
     * no longer even counts toward opening the gate. Gate + denoiser compose; either alone
     * lets keyboards through.
     */
    const ctxAtBuild = audioCtx
    void (async () => {
      try {
        rnnoiseBinary ??= await loadRnnoise({
          url: rnnoiseWasmPath,
          simdUrl: rnnoiseWasmSimdPath,
        })
        await ctxAtBuild.audioWorklet.addModule(rnnoiseWorkletPath)
        // the call may have ended (or restarted) while the wasm was loading
        if (audioCtx !== ctxAtBuild) return
        denoiser = new RnnoiseWorkletNode(ctxAtBuild, {
          wasmBinary: rnnoiseBinary,
          maxChannels: 2,
        })
        wireMic()
      } catch {
        // No AudioWorklet / wasm blocked — calls work exactly as before, and the ⚙ panel
        // says why the toggle is disabled instead of leaving a dead switch.
        if (audioCtx === ctxAtBuild) set({ denoiseUnavailable: true })
      }
    })()

    const buf = new Float32Array(analyser.fftSize)
    const tick = () => {
      if (!analyser || !gate || !audioCtx) return
      analyser.getFloatTimeDomainData(buf)
      let sum = 0
      for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i]
      // RMS, scaled so ordinary speech lands around the middle of the slider's range
      micLevel = Math.min(1, Math.sqrt(sum / buf.length) * 4)

      const th = state.threshold
      const now = performance.now()
      if (th <= 0) {
        // gate disabled — always open
        gate.gain.setTargetAtTime(1, audioCtx.currentTime, 0.01)
      } else {
        if (micLevel >= th) openUntil = now + 350 // hold, so pauses between words don't chop
        const open = now < openUntil
        // short ramps rather than hard switches; a hard cut clicks
        gate.gain.setTargetAtTime(open ? 1 : 0, audioCtx.currentTime, open ? 0.01 : 0.08)
      }
    }
    // A timer, NOT requestAnimationFrame. rAF is suspended while the tab is in the
    // background, which would freeze the gate in whatever state it was last in — leaving
    // you either hot-mic or silently muted for as long as you were looking elsewhere.
    // Timers are throttled in background tabs rather than stopped, so the gate keeps
    // deciding; it just reacts up to about a second late until you come back.
    gateTimer = window.setInterval(() => {
      tick()
      // Same timer drives the speaking indicators — one interval, not two, and it keeps
      // working in a background tab where rAF would stop.
      if (++speakTick % 3 === 0) pollSpeaking()
    }, 40)
    tick()
    return dest.stream
  } catch {
    // Web Audio unavailable or blocked — fall back to the plain mic rather than no call
    registerTap('mic', null)
    audioCtx = null
    analyser = null
    gate = null
    return mic
  }
}

/** peerVolume is 0–1 with 0.5 = unity, so the UI can offer 0–200%. */
const gainFor = (peerId: string) => master * (state.peerVolume[peerId] ?? 0.5) * 2

/** Build the playback graph for a person once their track arrives. */
function attachOutput(peerId: string, stream: MediaStream) {
  try {
    // shared, like the gate above — see context.ts
    if (!outCtx) outCtx = sharedCtx()
    // Full teardown, not just the source: a peer whose connection drops and recovers comes
    // back through here, and disconnecting only the source left the old gain node wired to
    // the destination forever. Inaudible — nothing feeds it — but it accumulates per recovery.
    detachOutput(peerId)
    const src = outCtx.createMediaStreamSource(stream)
    const gain = outCtx.createGain()
    const analyser = outCtx.createAnalyser()
    analyser.fftSize = 512
    gain.gain.value = gainFor(peerId)
    src.connect(gain)
    gain.connect(analyser)
    gain.connect(outCtx.destination)
    if (!peersMix) {
      peersMix = outCtx.createAnalyser()
      peersMix.fftSize = 1024
      registerTap('peers', peersMix)
    }
    // the mix is a measuring point, never a route to the speakers — an analyser passes audio on
    // only if you connect its output, and this one's is deliberately left dangling
    gain.connect(peersMix)
    outs.set(peerId, { src, gain, analyser })
    // A context created before a user gesture starts suspended; joining was the gesture,
    // but resume anyway or nobody is audible and nothing says why.
    void outCtx.resume().catch(() => {})
  } catch {
    // No Web Audio — the element falls back to plain playback, capped at 100%.
  }
}

function detachOutput(peerId: string) {
  const o = outs.get(peerId)
  if (o) {
    try {
      o.src.disconnect()
      o.gain.disconnect()
    } catch {
      /* already gone */
    }
  }
  outs.delete(peerId)
}

/** Poll every peer's analyser and flip `speaking` only when it actually changes. */
function pollSpeaking() {
  if (!outs.size) return
  const buf = new Float32Array(512)
  let changed = false
  const next = state.peers.map((p) => {
    const o = outs.get(p.id)
    if (!o) return p
    o.analyser.getFloatTimeDomainData(buf)
    let s = 0
    for (let i = 0; i < buf.length; i++) s += buf[i] * buf[i]
    // low bar — this is "is there voice" not "is it loud"
    const talking = Math.sqrt(s / buf.length) > 0.01
    if (talking !== p.speaking) changed = true
    return talking === p.speaking ? p : { ...p, speaking: talking }
  })
  // Only touch state on a real transition; this runs ten times a second.
  if (changed) set({ peers: next })
}

function teardownGate() {
  if (gateTimer) clearInterval(gateTimer)
  gateTimer = 0
  registerTap('mic', null)
  analyser = null
  gate = null
  micSrc = null
  denoiser = null
  micLevel = 0
  openUntil = 0
  /**
   * ⚠️ The context is SHARED now, so hanging up must not close it.
   *
   * Closing it here would take the instrument, the music player, the ringtone and every
   * visualiser source down with the call — and the symptom, "leaving a call silences the whole
   * site until you reload", is a genuinely hard one to trace back to this line. The bus is
   * disconnected instead, so the room stops hearing your instrument the moment you leave.
   */
  try {
    broadcastBus().disconnect()
  } catch {
    /* nothing was connected */
  }
  audioCtx = null
}

/** They hung up or left — remove them entirely. Not the same as failing to connect. */
function dropPeer(id: string) {
  pcs.get(id)?.close()
  pcs.delete(id)
  names.delete(id)
  detachOutput(id)
  // Only chime if we'd actually connected to them. A peer that never got past the handshake
  // "leaving" isn't a departure, and shouldn't sound like one.
  const wasConnected = state.peers.find((p) => p.id === id)?.status === 'connected'
  // the per-peer bookkeeping has to go too, or a reconnecting peer inherits a stale
  // negotiation state and a byte counter that makes their first sample look like new traffic
  nego.delete(id)
  pendingIce.delete(id)
  signalQueue.delete(id)
  rebuiltAt.delete(id)
  seenBytes.delete(id)
  peerShareStreamId.delete(id)
  set({ peers: state.peers.filter((p) => p.id !== id) })
  if (wasConnected && state.inCall) callSounds.peerLeave()
}

/** Add or update a peer row, so someone we're mid-handshake with is already on screen. */
function upsertPeer(id: string, patch: Partial<VoicePeer>) {
  const existing = state.peers.find((p) => p.id === id)
  set({
    peers: existing
      ? state.peers.map((p) => (p.id === id ? { ...p, ...patch } : p))
      : [
          ...state.peers,
          {
            id,
            name: names.get(id) ?? 'Someone',
            stream: null,
            share: null,
            relayed: false,
            status: 'connecting',
            ...patch,
          } as VoicePeer,
        ],
  })
}

/**
 * Attach our screen to one peer, capped.
 *
 * The bitrate cap is not politeness — an uncapped screen encoder will use whatever the link
 * appears to offer, and in a mesh that estimate is made per-connection with no idea that two
 * other copies are going out of the same uplink. Three unaware encoders will happily agree to
 * oversubscribe the link and then all stutter together.
 *
 * `contentHint = 'motion'` tells the encoder this is a game, not a spreadsheet: keep the frame
 * rate and let sharpness go, which is the right trade for watching someone play.
 */
function addShareTo(pc: RTCPeerConnection) {
  if (!share) return
  // Video FIRST, always: the receiver tells share audio from voice by the stream id it
  // recorded when the share's VIDEO arrived, so the video track must be first in the SDP —
  // which follows addTrack order, not luck. getDisplayMedia usually lists video first
  // anyway; sorting makes it a guarantee instead of a usually.
  const tracks = [...share.getTracks()].sort((a, b) =>
    a.kind === b.kind ? 0 : a.kind === 'video' ? -1 : 1,
  )
  for (const track of tracks) {
    if (track.kind === 'video') track.contentHint = SHARE_MODES[state.shareMode].hint
    const sender = pc.addTrack(track, share)
    if (track.kind !== 'video') continue
    try {
      const params = sender.getParameters()
      if (!params.encodings || !params.encodings.length) params.encodings = [{}]
      params.encodings[0].maxBitrate = shareBitrate()
      void sender.setParameters(params)
    } catch {
      /* older browsers ignore encoding parameters; the share still works, just uncapped */
    }
  }
}

/**
 * Re-divide the budget across whoever is watching NOW.
 *
 * Someone joining mid-share shrinks everyone's slice, and someone leaving gives it back. Without
 * this the split is frozen at whatever the audience was when the share started, so the fourth
 * person to arrive is the one who makes it blurry for everybody and nothing ever recovers.
 */
function retuneShareBitrate() {
  if (!share) return
  const target = shareBitrate()
  pcs.forEach((pc) => {
    pc.getSenders().forEach((sender) => {
      if (!sender.track || sender.track.kind !== 'video') return
      if (!share?.getTracks().includes(sender.track)) return
      try {
        const params = sender.getParameters()
        if (!params.encodings || !params.encodings.length) params.encodings = [{}]
        params.encodings[0].maxBitrate = target
        void sender.setParameters(params)
      } catch {
        /* nothing to do for one sender that refuses */
      }
    })
  })
}

/** Take our screen back off every connection. Renegotiation fires from onnegotiationneeded. */
function removeShareFromAll() {
  pcs.forEach((pc) => {
    pc.getSenders().forEach((sender) => {
      if (sender.track && share?.getTracks().includes(sender.track)) pc.removeTrack(sender)
    })
  })
}

/**
 * Drop everything we hold for a peer without removing them from the UI.
 *
 * Used when someone rejoins: they are still the same person, so the row should stay, but every
 * piece of connection state belongs to a session that no longer exists.
 */
function resetPeerConnection(peerId: string) {
  const pc = pcs.get(peerId)
  if (pc) {
    try {
      pc.onicecandidate = null
      pc.ontrack = null
      pc.onconnectionstatechange = null
      pc.onnegotiationneeded = null
      pc.close()
    } catch {
      /* already gone */
    }
  }
  pcs.delete(peerId)
  nego.delete(peerId)
  // The connection these were waiting for no longer exists; holding them would apply a dead
  // session's candidates to the fresh one.
  pendingIce.delete(peerId)
  seenBytes.delete(peerId)
  peerShareStreamId.delete(peerId)
  detachOutput(peerId)
}

function makePc(peerId: string, peerName: string, fresh = false) {
  /**
   * `fresh` is what makes rejoining work.
   *
   * Reusing whatever connection we already had was fine while people only ever joined once. But
   * someone who leaves and comes straight back sends a new `hello` under the SAME id, and we'd
   * hand back their dead connection — so no offer was made, no media flowed, and they sat
   * looking at "waiting for someone to join" while presence cheerfully showed everyone there.
   */
  if (fresh) resetPeerConnection(peerId)
  const existing = pcs.get(peerId)
  if (existing) return existing
  const pc = new RTCPeerConnection(iceConfig)
  pcs.set(peerId, pc)
  names.set(peerId, peerName)
  local?.getTracks().forEach((t) => pc.addTrack(t, local!))
  // Someone joining mid-share should see it, not wait for the next one.
  if (share) addShareTo(pc)
  // On screen from the first handshake, not from the first audio packet. Otherwise a peer
  // that never connects is invisible and the room just looks empty.
  upsertPeer(peerId, { name: peerName, status: 'connecting' })

  pc.onicecandidate = (e) => {
    if (e.candidate && meId) {
      send({ kind: 'ice', from: meId, to: peerId, candidate: e.candidate.toJSON() })
    }
  }
  /**
   * Renegotiate whenever the set of tracks changes — starting or stopping a share.
   *
   * `making` guards the window where our own offer is in flight, so an offer arriving in the
   * middle is recognised as a collision rather than treated as a fresh conversation.
   */
  pc.onnegotiationneeded = () => {
    void (async () => {
      const n = negoFor(peerId)
      try {
        n.making = true
        await pc.setLocalDescription()
        if (meId && pc.localDescription) {
          send({ kind: 'offer', from: meId, to: peerId, sdp: pc.localDescription })
        }
      } catch {
        /* the connection went away mid-offer; the state change handler deals with it */
      } finally {
        n.making = false
      }
    })()
  }
  pc.ontrack = (e) => {
    const stream = e.streams[0]
    if (!stream) return
    /**
     * Video is a screen share; audio is a voice. They are routed completely differently —
     * voice goes through the per-person gain graph, a share goes to a <video> element — so
     * sending a share into attachOutput would try to play a picture through the mixer.
     */
    if (e.track.kind === 'video') {
      peerShareStreamId.set(peerId, stream.id)
      upsertPeer(peerId, { share: stream, name: names.get(peerId) ?? 'Someone' })
      // "They stopped sharing" arrives as the track ending, not as a message we have to send.
      e.track.onended = () => upsertPeer(peerId, { share: null })
      e.track.onmute = () => upsertPeer(peerId, { share: null })
      // Mute is also just "no RTP right now" — a game hitching, a static screen between
      // frames. Without restoring on unmute, one transient gap dismissed the stage for good
      // and the share looked ended to everyone but the person still sending it.
      e.track.onunmute = () => upsertPeer(peerId, { share: stream })
      stream.onremovetrack = () => upsertPeer(peerId, { share: null })
      return
    }
    /**
     * Audio is only VOICE when it isn't the share's system audio. A share's audio track
     * arrives in the share's own stream (the sharer adds video first, so the id is already
     * recorded above); routing it into the voice mixer replaced the person's voice with
     * their game's sound — and doubled it, since the share's <video> plays its own audio.
     */
    if (peerShareStreamId.get(peerId) === stream.id || stream.getVideoTracks().length > 0) return
    upsertPeer(peerId, { stream, name: names.get(peerId) ?? 'Someone' })
    attachOutput(peerId, stream)
  }
  pc.onconnectionstatechange = () => {
    switch (pc.connectionState) {
      case 'connected': {
        // chime only on the first connect, not on every recovery from a blip
        const first = state.peers.find((p) => p.id === peerId)?.status !== 'connected'
        upsertPeer(peerId, { status: 'connected' })
        // A stale "couldn't connect" is worse than no message: it was still on screen while the
        // call worked, and it named whoever failed FIRST rather than who was actually failing.
        if (state.error) set({ error: null })
        if (first) callSounds.peerJoin()
        break
      }
      case 'disconnected':
        // Often a blip that recovers on its own — say "reconnecting", don't declare death.
        upsertPeer(peerId, { status: 'reconnecting' })
        break
      case 'failed':
        /**
         * Try once to recover before calling it dead.
         *
         * `failed` is not always terminal — a network change or a candidate that went stale can
         * produce it, and an ICE restart re-gathers and often reconnects. Declaring failure
         * immediately is what put "couldn't connect" on screen for someone who was in the call.
         */
        upsertPeer(peerId, { status: 'reconnecting', stream: null })
        try {
          pc.restartIce()
        } catch {
          /* older browsers: fall through to the failed state below */
        }
        // give the restart a chance; if it is still failed after this, try once more properly
        window.setTimeout(() => {
          if (pcs.get(peerId) !== pc) return
          if (pc.connectionState !== 'failed') return
          /**
           * An ICE restart REUSES the connection. What actually recovered this in practice was
           * the other person hanging up and calling again — which builds a brand new one — and
           * needing a human on the far end to know to do that is not a recovery path. Do it
           * ourselves, once, before showing a dead end.
           */
          const lastTry = rebuiltAt.get(peerId) ?? 0
          if (meId && Date.now() - lastTry > REBUILD_COOLDOWN_MS) {
            rebuiltAt.set(peerId, Date.now())
            const nm = names.get(peerId) ?? 'Someone'
            resetPeerConnection(peerId)
            upsertPeer(peerId, { name: nm, status: 'connecting', stream: null })
            send({ kind: 'again', from: meId, to: peerId })
            return
          }
          upsertPeer(peerId, { status: 'failed', stream: null })
        }, 6000)
        if (!haveTurn) {
          set({
            error:
              'Couldn’t connect directly, and the call relay wasn’t reachable. Wait a few seconds and try again — the relay may have been asleep.',
          })
        }
        break
      case 'closed':
        dropPeer(peerId)
        break
    }
  }
  return pc
}

export const voiceSession = {
  getState: () => state,
  subscribe(fn: () => void) {
    listeners.add(fn)
    return () => listeners.delete(fn)
  },

  async join(
    roomId: string,
    roomName: string,
    userId: string,
    displayName: string,
    /** how many are already in that call, from voice presence. Unknown means don't guess. */
    occupancy?: number,
  ) {
    // Already here — nothing to do.
    if (state.inCall && state.roomId === roomId) return
    // A join can take a while (a cold relay adds up to a minute before the UI flips), and a
    // second press during that window used to start a SECOND join — another mic grab,
    // another channel. One at a time; the button shows "Connecting…" meanwhile.
    if (state.joining) return
    // Calling a different room switches to it. It used to refuse until you'd left the old
    // one first, which is a step nobody should have to think about; every app that has
    // rooms just moves you.
    // voiceSession.leave, not this.leave — these methods get passed around as bare
    // references (the hook hands them straight to components), so `this` isn't reliable.
    // Silent: the join chime that follows is the sound of the switch.
    if (state.inCall) voiceSession.leave(true)
    set({ error: null, joining: true })
    /**
     * Refused BEFORE the microphone is opened, so a full call never costs a permission prompt.
     * Presence is the only count available — there is no server keeping a tally — so two people
     * joining in the same instant can still slip past. That is a fair trade for a soft cap:
     * the failure is one extra person in a crowded call, not a broken one.
     */
    if (typeof occupancy === 'number' && occupancy >= CALL_HARD_LIMIT) {
      set({
        joining: false,
        error: `This call is full (${occupancy}). Calls are peer-to-peer, so everyone sends their voice to everyone — past about ${CALL_HARD_LIMIT} that stops working well for the people already in it.`,
      })
      return
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === 'undefined') {
      set({
        joining: false,
        error: 'This browser can’t do voice calls. Try Chrome, Edge, Safari or Firefox.',
      })
      return
    }
    let mic: MediaStream
    try {
      mic = await navigator.mediaDevices.getUserMedia({
        // Ask for the browser's built-in voice processing explicitly rather than trusting
        // the defaults. echoCancellation is what stops two people in one room feeding back
        // through each other's speakers; noiseSuppression gates room hum and fans;
        // autoGainControl levels a quiet talker against a loud one, which is the practical
        // version of compression here. Browsers vary in what they enable unasked.
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          // Platform-level ML voice isolation (macOS Voice Isolation, some Windows devices)
          // where the browser exposes it. Not in TS's lib yet; unknown constraints are
          // ignored by spec, so this is free everywhere it isn't supported.
          ...({ voiceIsolation: true } as MediaTrackConstraints),
        },
        video: false,
      })
    } catch (e) {
      // Blocked and absent need different advice — telling someone with no microphone to
      // check their permissions sends them somewhere that can't help.
      const name = (e as DOMException)?.name
      set({
        joining: false,
        error:
          name === 'NotFoundError' || name === 'OverconstrainedError'
            ? 'No microphone found. Plug one in or check your system sound settings.'
            : name === 'NotReadableError'
              ? 'Your microphone is in use by another app. Close that, then try again.'
              : 'Microphone blocked. Allow it for this site in your browser, then try again.',
      })
      return
    }
    rawMic = mic
    // peers receive the gated stream, never the raw mic
    local = buildGate(mic)
    // Before signalling starts, so the very first handshake already has the relay available.
    // Awaited rather than fired off, because a peer connection built with the STUN-only config
    // keeps it for its whole life — ICE servers cannot be swapped in later.
    await loadIce()
    meId = userId
    myName = displayName

    const sb = getSupabaseClient()
    /**
     * ⚠️ Free the topic BEFORE creating the channel — this is what makes leave-then-rejoin work.
     *
     * leave() removes its channel fire-and-forget, and realtime-js dedupes channels BY TOPIC:
     * ask for `voice:<room>` while the old channel is still mid-teardown and it hands back that
     * same dying instance — whose subscribe() then THROWS ("tried to subscribe multiple times"),
     * after `inCall` was already set. Net effect: leave, rejoin quickly, and the UI sat in a
     * call where nothing would ever arrive, until a full restart of the join. Awaiting the
     * removal makes the rejoin start from a genuinely fresh channel every time.
     */
    for (const old of sb.getChannels().filter((c) => c.topic === `realtime:voice:${roomId}`)) {
      try {
        await sb.removeChannel(old)
      } catch {
        /* already torn down */
      }
    }
    // `private: true` routes the join through the realtime.messages policies, which gate the
    // topic on room membership. Public channels skip authorization, which is why signalling
    // used to be protected by nothing but the room UUID being hard to guess.
    const ch = sb.channel(`voice:${roomId}`, {
      config: { broadcast: { self: false }, private: true },
    })
    chan = ch

    ch.on('broadcast', { event: 'voice' }, ({ payload }) => {
      const m = payload as Signal
      if (!meId || m.from === meId) return
      if (m.kind === 'offer') diag.offersRecv++
      else if (m.kind === 'answer') diag.answersRecv++
      else if (m.kind === 'ice') diag.iceRecv++
      /**
       * Strictly in order, per peer. The switch below awaits, so running these detached let a
       * candidate overtake the offer it belonged to.
       */
      const prev = signalQueue.get(m.from) ?? Promise.resolve()
      const run = prev.then(async () => {
        switch (m.kind) {
          case 'hello': {
            // Whoever was already here offers to the newcomer — no glare, no tie-break rule.
            send({ kind: 'here', from: meId!, name: myName, to: m.from })
            // a hello is always the START of a session, so never reuse an older one
            const pc = makePc(m.from, m.name, true)
            const offer = await pc.createOffer()
            await pc.setLocalDescription(offer)
            send({ kind: 'offer', from: meId!, to: m.from, sdp: offer })
            break
          }
          case 'here':
            if (m.to === meId) names.set(m.from, m.name)
            break
          case 'offer': {
            if (m.to !== meId) return
            const pc = makePc(m.from, names.get(m.from) ?? 'Someone')
            const n = negoFor(m.from)
            /**
             * Collision: an offer arrived while ours was in flight. Both sides cannot win, and
             * both must reach the SAME verdict without talking about it — so the polite peer
             * (lower id) drops its own offer and accepts theirs, and the impolite one ignores
             * theirs and lets its own stand. Without this, two people sharing at once leave
             * both connections stuck in have-local-offer and the call goes silent.
             */
            const collision = n.making || pc.signalingState !== 'stable'
            n.ignore = collision && !isPolite(m.from)
            if (n.ignore) break
            if (collision) {
              // rolls our half-finished offer back so their offer applies cleanly
              await Promise.all([
                pc.setLocalDescription({ type: 'rollback' } as RTCLocalSessionDescriptionInit),
                pc.setRemoteDescription(new RTCSessionDescription(m.sdp)),
              ])
            } else {
              await pc.setRemoteDescription(new RTCSessionDescription(m.sdp))
            }
            // There is somewhere to put candidates now.
            await flushIce(m.from)
            await pc.setLocalDescription()
            if (pc.localDescription) {
              send({ kind: 'answer', from: meId!, to: m.from, sdp: pc.localDescription })
            }
            break
          }
          case 'answer': {
            if (m.to !== meId) return
            const pc = pcs.get(m.from)
            if (!pc) return
            await pc.setRemoteDescription(new RTCSessionDescription(m.sdp))
            await flushIce(m.from)
            break
          }
          case 'ice': {
            if (m.to !== meId) return
            await acceptIce(m.from, m.candidate)
            break
          }
          case 'again': {
            if (m.to !== meId) return
            // Same path as a fresh hello: our half is dead too, so throw it away and offer
            // them a brand new connection rather than patching the corpse.
            const nm = names.get(m.from) ?? 'Someone'
            const pc = makePc(m.from, nm, true)
            const offer = await pc.createOffer()
            await pc.setLocalDescription(offer)
            send({ kind: 'offer', from: meId!, to: m.from, sdp: offer })
            break
          }
          case 'bye':
            dropPeer(m.from)
            break
        }
      })
      // The link that is STORED must never reject: the next message chains off it, so a single
      // throw would wedge this peer's queue for the rest of the call.
      const link = run.catch(() => {})
      signalQueue.set(m.from, link)
      void link.then(() => {
        // Don't leave an entry per peer behind once their queue has drained.
        if (signalQueue.get(m.from) === link) signalQueue.delete(m.from)
      })
    })

    resetDiag()
    set({ inCall: true, roomId, roomName, muted: false, peers: [] })
    // Sampled rather than summed at the end, so a call that crashes or a tab that closes still
    // accounts for the traffic it already used.
    clearInterval(usageTimer)
    usageTimer = window.setInterval(() => {
      pcs.forEach((pc, id) => void sampleRelayUsage(id, pc))
    }, 20_000) as unknown as number

    let joined = false
    ch.subscribe((status, err) => {
      if (status === 'SUBSCRIBED') {
        joined = true
        set({ joining: false })
        if (meId) send({ kind: 'hello', from: meId, name: myName })
        // Chime only once the room actually accepted us. It used to fire unconditionally, so a
        // refused join sounded exactly like a successful one.
        callSounds.join()
        return
      }
      // The topic is private now, so a join can be REFUSED — not being in the room, or a
      // session that expired. Every one of those used to land here and be dropped on the
      // floor: you'd hear the join chime, your mic would be live, the dock would sit on
      // "waiting for someone to join…", and nothing would ever connect. Fail loudly instead.
      // Hanging up removes the channel, which reports CLOSED right back to here — without this
      // guard every normal leave would raise "couldn't reach the call". `chan` is nulled by
      // leave(), so this is also what stops a stale callback touching a newer call.
      if (chan !== ch || state.roomId !== roomId) return
      // And after a successful join, CLOSED is just the socket dropping; realtime reconnects.
      if (
        status === 'CHANNEL_ERROR' ||
        status === 'TIMED_OUT' ||
        (status === 'CLOSED' && !joined)
      ) {
        const refused = /unauthor|permission/i.test(String(err?.message ?? err ?? ''))
        voiceSession.leave(true)
        set({
          error: refused
            ? 'You don’t have access to this call. If you were just added, sign out and back in.'
            : 'Couldn’t reach the call. Check your connection and try again.',
        })
      }
    })
  },

  /** `silent` is for the leave that's really the first half of switching rooms — a departure
   *  chime followed 50ms later by an arrival chime is just a muddle. */
  leave(silent = false) {
    if (state.inCall && !silent) callSounds.leave()
    if (meId) send({ kind: 'bye', from: meId })
    // one last sample before the connections go, or the final stretch of a call is lost
    pcs.forEach((pc, id) => void sampleRelayUsage(id, pc))
    clearInterval(usageTimer)
    usageTimer = 0
    seenBytes.clear()
    pcs.forEach((pc) => pc.close())
    pcs.clear()
    names.clear()
    nego.clear()
    pendingIce.clear()
    signalQueue.clear()
    rebuiltAt.clear()
    share?.getTracks().forEach((t) => t.stop())
    share = null
    teardownGate()
    outs.forEach((_, id) => detachOutput(id))
    outs.clear()
    registerTap('peers', null)
    peersMix = null
    // shared context: drop the reference, never close it (see teardownGate)
    outCtx = null
    local?.getTracks().forEach((t) => t.stop())
    rawMic?.getTracks().forEach((t) => t.stop())
    local = null
    rawMic = null
    if (chan) void getSupabaseClient().removeChannel(chan)
    chan = null
    meId = null
    // keep the settings, drop the call
    state = { ...IDLE, threshold: state.threshold, denoise: state.denoise }
    listeners.forEach((l) => l())
  },

  /**
   * Share your screen with the call.
   *
   * THE SEAM: callers ask for "share my screen" and read `peer.share`. That the transport
   * underneath is a mesh — and that a mesh is what forces MAX_SHARE_VIEWERS — lives entirely
   * in here. Moving to an SFU later replaces this function's insides and nothing else.
   */
  async startShare() {
    if (!state.inCall) return
    set({ shareError: null })
    if (!navigator.mediaDevices?.getDisplayMedia) {
      set({ shareError: 'This browser can’t share a screen. Try Chrome, Edge or Firefox.' })
      return
    }
    // Refuse BEFORE the picker: making someone choose a window and then telling them no is
    // a worse experience than telling them up front.
    // Someone who never connected isn't a viewer: counting them refused shares that would
    // have been fine, and they are exactly the people already visible as "couldn't connect".
    const viewers = state.peers.filter((p) => p.status !== 'failed').length
    if (viewers > MAX_SHARE_VIEWERS) {
      set({
        shareError: `Too many people to share to (${viewers}). Screen sharing works for up to ${MAX_SHARE_VIEWERS} others — everyone gets their own copy from your connection.`,
      })
      return
    }
    let media: MediaStream
    /**
     * Audio first, then a retry WITHOUT it.
     *
     * Asking for `audio: true` can make the whole request fail on a browser that cannot capture
     * system audio — Firefox most notably — so one person gets a picker and another gets nothing
     * at all, sharing the same game on the same call. That asymmetry looks like the site is
     * broken for them personally, and it is only ever the audio track's fault.
     *
     * A silent share is worth far more than no share, so a failure is retried video-only and the
     * player is told what they lost rather than left guessing.
     */
    const capture = async (withAudio: boolean) =>
      navigator.mediaDevices.getDisplayMedia({
        /**
         * Capped, because capture defaults to the SOURCE resolution — a 1440p or 4K monitor
         * would otherwise be encoded at full size. That matters more here than in most apps:
         * in a mesh each viewer has their own encoder, so three viewers means encoding the
         * screen three times over, on the machine running the game.
         */
        video: SHARE_MODES[state.shareMode].video,
        /**
         * The game's sound, not just the picture — and the only legitimate route to an
         * analyser on audio the page doesn't own (see the visualiser plans).
         *
         * Asking is not getting: the browser decides what audio a source can carry. On Windows
         * Chrome, "Entire screen" offers a Share system audio tick-box and a single WINDOW
         * offers no audio at all. So sharing a game window silently means no game sound, and
         * the fix is to share the screen instead — which is also what most people mean.
         */
        audio: withAudio,
      })
    try {
      media = await capture(true)
    } catch (e) {
      const name = (e as DOMException)?.name
      // Cancelling the picker is a decision, not a failure.
      if (name === 'NotAllowedError') return
      try {
        media = await capture(false)
        set({
          shareError: 'Sharing without sound — this browser can’t capture system audio.',
        })
      } catch (e2) {
        if ((e2 as DOMException)?.name === 'NotAllowedError') return
        set({
          shareError:
            'Couldn’t start the screen share. Try Chrome or Edge, and pick a screen rather than a window.',
        })
        return
      }
    }
    // Asked for audio and got a picture only. On Chrome/Edge that is the "Share system audio"
    // tick-box left unticked — but Firefox has NO such tick-box (it cannot capture system
    // audio at all, and quietly returns video-only instead of failing), so telling a Firefox
    // user to go find the checkbox sent them hunting for something that does not exist.
    if (!media.getAudioTracks().length) {
      const firefox = /firefox/i.test(navigator.userAgent)
      set({
        shareError: firefox
          ? 'Firefox can’t share your screen’s sound — the stream is video-only. Use Chrome or Edge if the sound matters.'
          : 'No sound is being shared — tick “Share system audio” in the picker.',
      })
    }
    share = media
    // Chrome's own "Stop sharing" bar ends the track without telling us — treat that as a stop
    // so the UI can't sit there claiming you're still sharing.
    media.getVideoTracks().forEach((t) => {
      t.onended = () => voiceSession.stopShare()
    })
    pcs.forEach((pc) => addShareTo(pc))
    set({ sharing: true })
  },

  /**
   * Switch between smooth and sharp WITHOUT restarting the share.
   *
   * `applyConstraints` retunes the live track and `contentHint` retunes the encoder, so nothing
   * renegotiates and nobody sees a black frame. Restarting the capture would mean re-opening
   * the picker and choosing the screen again — which is the part of doing this in Discord that
   * makes it a chore, and the reason people just put up with the wrong mode.
   */
  async setShareMode(mode: ShareMode) {
    set({ shareMode: mode })
    const track = share?.getVideoTracks()[0]
    if (!track) return
    track.contentHint = SHARE_MODES[mode].hint
    try {
      await track.applyConstraints(SHARE_MODES[mode].video)
    } catch {
      /* the source may refuse a size; the hint alone still shifts the encoder's priorities */
    }
  },

  stopShare() {
    if (!share) return
    removeShareFromAll()
    share.getTracks().forEach((t) => t.stop())
    share = null
    set({ sharing: false })
  },

  /**
   * Start fetching ICE before anyone presses Call.
   *
   * Called when the call UI appears, so the relay's cold start overlaps with the user reading
   * the page instead of with the handshake that needs the result.
   */
  warmIce() {
    void loadIce()
  },

  /**
   * One line of truth about what this call is actually doing, for the ⚙ panel.
   *
   * Reads the live connections directly rather than the React snapshot, because the whole
   * point is to see the layer UNDER the UI: a peer can look "in the call" via presence while
   * its RTCPeerConnection never left `connecting`, and that difference is exactly what a
   * remote bug report ("we can't see each other's shares") cannot convey on its own.
   */
  debugSnapshot(): string {
    const peers = [...pcs.entries()]
      .map(([id, pc]) => {
        const nm = names.get(id) ?? id.slice(0, 6)
        return `${nm}: ${pc.connectionState}/${pc.iceConnectionState}/${pc.signalingState}`
      })
      .join(' · ')
    const d = `offers ${diag.offersSent}↑${diag.offersRecv}↓ answers ${diag.answersSent}↑${diag.answersRecv}↓ ice ${diag.iceSent}↑${diag.iceRecv}↓`
    return `${haveTurn ? 'relay ready' : 'no relay'} · ${peers || 'no connections'} · ${d}`
  },

  /**
   * Poke the relay awake without asking it for anything.
   *
   * Called on page load, by everyone, whether or not they will ever make a call. The relay
   * sleeps after a quiet spell and takes most of a minute to boot, and that boot has to happen
   * SOMETIME — far better during someone idly loading the home page than in the middle of the
   * handshake that needs it.
   *
   * Deliberately not `/ice`: waking it is the whole job, and minting credentials for a visitor
   * who never calls is work nobody asked for. `no-cors` because we don't read the reply — the
   * request arriving is the entire point — and it keeps a CORS error out of the console.
   */
  pingRelay() {
    // once per page load: StrictMode mounts effects twice in dev, and a remount shouldn't
    // re-poke a server that is already awake
    if (pinged) return
    pinged = true
    const base = relayHttpBase()
    if (!base) return
    void fetch(base + '/', { mode: 'no-cors', cache: 'no-store' }).catch(() => {})
  },

  /**
   * Relayed bytes per month, newest last. Only traffic that actually went through TURN — the
   * bytes Cloudflare would bill for — not total call traffic.
   */
  turnUsage: () => readUsage(),

  /** where the relay lives, for callers that need its other endpoints */
  relayBase: () => relayHttpBase(),

  /** Whether we actually hold a relay. Distinguishes "no TURN" from "TURN didn't help". */
  hasTurn: () => haveTurn,

  /** Our own screen, for the local preview. Not in the snapshot — it never changes identity. */
  getLocalShare: () => share,

  toggleMute() {
    const next = !state.muted
    local?.getAudioTracks().forEach((t) => (t.enabled = !next))
    set({ muted: next })
  },

  /**
   * Live mic loudness, 0–1. Deliberately NOT in the snapshot: it changes every frame, and
   * putting it in state would re-render the app sixty times a second. The meter polls it.
   */
  getMicLevel: () => micLevel,

  /**
   * True when playback is going through Web Audio, which is what allows above-100% volume.
   * The <audio> elements mute themselves in that case so the sound isn't played twice; if
   * Web Audio failed they stay unmuted and fall back to plain, capped playback.
   */
  usesWebAudio: () => !!outCtx,

  /** Is the gate currently letting audio through? Lets the meter show open vs held shut. */
  isOpen: () => state.threshold <= 0 || performance.now() < openUntil,

  setThreshold(v: number) {
    const t = Math.min(1, Math.max(0, v))
    try {
      localStorage.setItem(THRESH_KEY, String(t))
    } catch {
      /* private mode — it just won't persist */
    }
    set({ threshold: t })
  },

  /** Noise removal on/off — takes effect immediately on a live call (the chain rewires). */
  setDenoise(on: boolean) {
    try {
      localStorage.setItem(DENOISE_KEY, on ? '1' : '0')
    } catch {
      /* private mode — it just won't persist */
    }
    set({ denoise: on })
    wireMic()
  },

  setPeerVolume(peerId: string, v: number) {
    const vol = Math.min(1, Math.max(0, v))
    set({ peerVolume: { ...state.peerVolume, [peerId]: vol } })
    const o = outs.get(peerId)
    if (o && outCtx) o.gain.gain.setTargetAtTime(gainFor(peerId), outCtx.currentTime, 0.02)
  },

  /** The dock's knob: attenuation across everyone, on top of each person's own level. */
  setMaster(v: number) {
    master = Math.min(1, Math.max(0, v))
    if (!outCtx) return
    outs.forEach((o, id) => o.gain.gain.setTargetAtTime(gainFor(id), outCtx!.currentTime, 0.02))
  },
}

// Closing the tab should hang up rather than leave a ghost sitting in the room.
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    if (state.inCall) voiceSession.leave()
  })
}
