import { getSupabaseClient } from '../finance/client'
import { callSounds } from './callSounds'

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
  muted: boolean
  peers: VoicePeer[]
  error: string | null
  /** mic gate: below this loudness (0–1) nothing is transmitted. 0 disables the gate. */
  threshold: number
  /** per-person listening level, 0–1, keyed by peer id. Missing means 1. */
  peerVolume: Record<string, number>
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
/** Cap per viewer. Left uncapped, the encoder will happily try to use everything you have. */
const SHARE_MAX_BITRATE = 2_500_000

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
      const r = await fetch(`${base}/ice`, { signal: ctl.signal })
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
  | { kind: 'bye'; from: string }

const IDLE: VoiceState = {
  roomId: null,
  roomName: '',
  inCall: false,
  muted: false,
  peers: [],
  error: null,
  threshold: readThreshold(),
  peerVolume: {},
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
let gateTimer = 0
let micLevel = 0
let openUntil = 0
/** one shared context for playback, plus a node graph per person */
let outCtx: AudioContext | null = null
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
const nego = new Map<string, { making: boolean; ignore: boolean }>()
const negoFor = (id: string) => {
  let n = nego.get(id)
  if (!n) nego.set(id, (n = { making: false, ignore: false }))
  return n
}
/** deterministic and opposite on the two ends, which is all perfect negotiation requires */
const isPolite = (peerId: string) => (meId ?? '') < peerId

/** Replace the snapshot so useSyncExternalStore sees a new reference only on real change. */
function set(patch: Partial<VoiceState>) {
  state = { ...state, ...patch }
  // derived here rather than at every call site, so it cannot be forgotten in one of them.
  // +1 for us: `peers` is everyone ELSE.
  const size = state.inCall ? state.peers.length + 1 : 0
  state.crowded = size > CALL_SOFT_LIMIT
  listeners.forEach((l) => l())
}

function send(msg: Signal) {
  void chan?.send({ type: 'broadcast', event: 'voice', payload: msg })
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
    audioCtx = new AudioContext()
    const src = audioCtx.createMediaStreamSource(mic)
    analyser = audioCtx.createAnalyser()
    analyser.fftSize = 512
    gate = audioCtx.createGain()
    const dest = audioCtx.createMediaStreamDestination()
    // measure off the source, gate on the way out
    src.connect(analyser)
    src.connect(gate)
    gate.connect(dest)
    gate.gain.value = 1

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
    if (!outCtx) outCtx = new AudioContext()
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
  analyser = null
  gate = null
  micLevel = 0
  openUntil = 0
  void audioCtx?.close().catch(() => {})
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
  for (const track of share.getTracks()) {
    if (track.kind === 'video') track.contentHint = SHARE_MODES[state.shareMode].hint
    const sender = pc.addTrack(track, share)
    if (track.kind !== 'video') continue
    try {
      const params = sender.getParameters()
      if (!params.encodings || !params.encodings.length) params.encodings = [{}]
      params.encodings[0].maxBitrate = SHARE_MAX_BITRATE
      void sender.setParameters(params)
    } catch {
      /* older browsers ignore encoding parameters; the share still works, just uncapped */
    }
  }
}

/** Take our screen back off every connection. Renegotiation fires from onnegotiationneeded. */
function removeShareFromAll() {
  pcs.forEach((pc) => {
    pc.getSenders().forEach((sender) => {
      if (sender.track && share?.getTracks().includes(sender.track)) pc.removeTrack(sender)
    })
  })
}

function makePc(peerId: string, peerName: string) {
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
      upsertPeer(peerId, { share: stream, name: names.get(peerId) ?? 'Someone' })
      // "They stopped sharing" arrives as the track ending, not as a message we have to send.
      e.track.onended = () => upsertPeer(peerId, { share: null })
      e.track.onmute = () => upsertPeer(peerId, { share: null })
      stream.onremovetrack = () => upsertPeer(peerId, { share: null })
      return
    }
    upsertPeer(peerId, { stream, name: names.get(peerId) ?? 'Someone' })
    attachOutput(peerId, stream)
  }
  pc.onconnectionstatechange = () => {
    switch (pc.connectionState) {
      case 'connected': {
        // chime only on the first connect, not on every recovery from a blip
        const first = state.peers.find((p) => p.id === peerId)?.status !== 'connected'
        upsertPeer(peerId, { status: 'connected' })
        if (first) callSounds.peerJoin()
        break
      }
      case 'disconnected':
        // Often a blip that recovers on its own — say "reconnecting", don't declare death.
        upsertPeer(peerId, { status: 'reconnecting' })
        break
      case 'failed':
        // Usually a network that can't do peer-to-peer. WHICH failure it is matters: with no
        // relay it is expected, with one it means the relay was reached and still didn't help.
        upsertPeer(peerId, { status: 'failed', stream: null })
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

  /** the caller's presence count for the room, so a full call can be refused before it starts */
  callLimits: { soft: CALL_SOFT_LIMIT, hard: CALL_HARD_LIMIT },

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
    // Calling a different room switches to it. It used to refuse until you'd left the old
    // one first, which is a step nobody should have to think about; every app that has
    // rooms just moves you.
    // voiceSession.leave, not this.leave — these methods get passed around as bare
    // references (the hook hands them straight to components), so `this` isn't reliable.
    // Silent: the join chime that follows is the sound of the switch.
    if (state.inCall) voiceSession.leave(true)
    set({ error: null })
    /**
     * Refused BEFORE the microphone is opened, so a full call never costs a permission prompt.
     * Presence is the only count available — there is no server keeping a tally — so two people
     * joining in the same instant can still slip past. That is a fair trade for a soft cap:
     * the failure is one extra person in a crowded call, not a broken one.
     */
    if (typeof occupancy === 'number' && occupancy >= CALL_HARD_LIMIT) {
      set({
        error: `This call is full (${occupancy}). Calls are peer-to-peer, so everyone sends their voice to everyone — past about ${CALL_HARD_LIMIT} that stops working well for the people already in it.`,
      })
      return
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === 'undefined') {
      set({ error: 'This browser can’t do voice calls. Try Chrome, Edge, Safari or Firefox.' })
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
        },
        video: false,
      })
    } catch (e) {
      // Blocked and absent need different advice — telling someone with no microphone to
      // check their permissions sends them somewhere that can't help.
      const name = (e as DOMException)?.name
      set({
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
      void (async () => {
        switch (m.kind) {
          case 'hello': {
            // Whoever was already here offers to the newcomer — no glare, no tie-break rule.
            send({ kind: 'here', from: meId!, name: myName, to: m.from })
            const pc = makePc(m.from, m.name)
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
            await pc.setLocalDescription()
            if (pc.localDescription) {
              send({ kind: 'answer', from: meId!, to: m.from, sdp: pc.localDescription })
            }
            break
          }
          case 'answer': {
            if (m.to !== meId) return
            await pcs.get(m.from)?.setRemoteDescription(new RTCSessionDescription(m.sdp))
            break
          }
          case 'ice': {
            if (m.to !== meId) return
            try {
              await pcs.get(m.from)?.addIceCandidate(new RTCIceCandidate(m.candidate))
            } catch {
              // Candidates for an offer we deliberately ignored will fail to apply, and that
              // is expected rather than an error worth surfacing.
              if (!negoFor(m.from).ignore) {
                /* a real failure, but nothing useful to do about one candidate */
              }
            }
            break
          }
          case 'bye':
            dropPeer(m.from)
            break
        }
      })()
    })

    set({ inCall: true, roomId, roomName, muted: false, peers: [] })

    let joined = false
    ch.subscribe((status, err) => {
      if (status === 'SUBSCRIBED') {
        joined = true
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
    pcs.forEach((pc) => pc.close())
    pcs.clear()
    names.clear()
    nego.clear()
    share?.getTracks().forEach((t) => t.stop())
    share = null
    teardownGate()
    outs.forEach((_, id) => detachOutput(id))
    outs.clear()
    void outCtx?.close().catch(() => {})
    outCtx = null
    local?.getTracks().forEach((t) => t.stop())
    rawMic?.getTracks().forEach((t) => t.stop())
    local = null
    rawMic = null
    if (chan) void getSupabaseClient().removeChannel(chan)
    chan = null
    meId = null
    // keep the settings, drop the call
    state = { ...IDLE, threshold: state.threshold }
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
    const viewers = state.peers.length
    if (viewers > MAX_SHARE_VIEWERS) {
      set({
        shareError: `Too many people to share to (${viewers}). Screen sharing works for up to ${MAX_SHARE_VIEWERS} others — everyone gets their own copy from your connection.`,
      })
      return
    }
    let media: MediaStream
    try {
      media = await navigator.mediaDevices.getDisplayMedia({
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
        audio: true,
      })
    } catch (e) {
      // Cancelling the picker is not an error worth shouting about.
      if ((e as DOMException)?.name !== 'NotAllowedError') {
        set({ shareError: 'Couldn’t start the screen share.' })
      }
      return
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
