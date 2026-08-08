import { getSupabaseClient } from '../finance/client'

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
}

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

const ICE: RTCConfiguration = {
  iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }],
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
let chan: ReturnType<ReturnType<typeof getSupabaseClient>['channel']> | null = null
let meId: string | null = null
let myName = 'You'
const pcs = new Map<string, RTCPeerConnection>()
const names = new Map<string, string>()

/** Replace the snapshot so useSyncExternalStore sees a new reference only on real change. */
function set(patch: Partial<VoiceState>) {
  state = { ...state, ...patch }
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
    gateTimer = window.setInterval(tick, 40)
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
  set({ peers: state.peers.filter((p) => p.id !== id) })
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
            status: 'connecting',
            ...patch,
          } as VoicePeer,
        ],
  })
}

function makePc(peerId: string, peerName: string) {
  const existing = pcs.get(peerId)
  if (existing) return existing
  const pc = new RTCPeerConnection(ICE)
  pcs.set(peerId, pc)
  names.set(peerId, peerName)
  local?.getTracks().forEach((t) => pc.addTrack(t, local!))
  // On screen from the first handshake, not from the first audio packet. Otherwise a peer
  // that never connects is invisible and the room just looks empty.
  upsertPeer(peerId, { name: peerName, status: 'connecting' })

  pc.onicecandidate = (e) => {
    if (e.candidate && meId) {
      send({ kind: 'ice', from: meId, to: peerId, candidate: e.candidate.toJSON() })
    }
  }
  pc.ontrack = (e) => {
    const stream = e.streams[0]
    if (!stream) return
    upsertPeer(peerId, { stream, name: names.get(peerId) ?? 'Someone' })
  }
  pc.onconnectionstatechange = () => {
    switch (pc.connectionState) {
      case 'connected':
        upsertPeer(peerId, { status: 'connected' })
        break
      case 'disconnected':
        // Often a blip that recovers on its own — say "reconnecting", don't declare death.
        upsertPeer(peerId, { status: 'reconnecting' })
        break
      case 'failed':
        // Usually a network that can't do peer-to-peer and has no relay to fall back on.
        // Keep the row so the UI can say WHY nobody can be heard.
        upsertPeer(peerId, { status: 'failed', stream: null })
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

  async join(roomId: string, roomName: string, userId: string, displayName: string) {
    if (state.inCall) return
    set({ error: null })
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
    meId = userId
    myName = displayName

    const sb = getSupabaseClient()
    const ch = sb.channel(`voice:${roomId}`, { config: { broadcast: { self: false } } })
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
            await pc.setRemoteDescription(new RTCSessionDescription(m.sdp))
            const answer = await pc.createAnswer()
            await pc.setLocalDescription(answer)
            send({ kind: 'answer', from: meId!, to: m.from, sdp: answer })
            break
          }
          case 'answer': {
            if (m.to !== meId) return
            await pcs.get(m.from)?.setRemoteDescription(new RTCSessionDescription(m.sdp))
            break
          }
          case 'ice': {
            if (m.to !== meId) return
            await pcs
              .get(m.from)
              ?.addIceCandidate(new RTCIceCandidate(m.candidate))
              .catch(() => {})
            break
          }
          case 'bye':
            dropPeer(m.from)
            break
        }
      })()
    })

    ch.subscribe((status) => {
      if (status === 'SUBSCRIBED' && meId) send({ kind: 'hello', from: meId, name: myName })
    })
    set({ inCall: true, roomId, roomName, muted: false, peers: [] })
  },

  leave() {
    if (meId) send({ kind: 'bye', from: meId })
    pcs.forEach((pc) => pc.close())
    pcs.clear()
    names.clear()
    teardownGate()
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
  },
}

// Closing the tab should hang up rather than leave a ghost sitting in the room.
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    if (state.inCall) voiceSession.leave()
  })
}
