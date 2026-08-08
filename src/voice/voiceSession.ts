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

export type VoicePeer = { id: string; name: string; stream: MediaStream }

export type VoiceState = {
  roomId: string | null
  roomName: string
  inCall: boolean
  muted: boolean
  peers: VoicePeer[]
  error: string | null
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
}

let state: VoiceState = IDLE
const listeners = new Set<() => void>()

// live plumbing, deliberately outside the snapshot — React never needs to see these
let local: MediaStream | null = null
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

function dropPeer(id: string) {
  pcs.get(id)?.close()
  pcs.delete(id)
  names.delete(id)
  set({ peers: state.peers.filter((p) => p.id !== id) })
}

function makePc(peerId: string, peerName: string) {
  const existing = pcs.get(peerId)
  if (existing) return existing
  const pc = new RTCPeerConnection(ICE)
  pcs.set(peerId, pc)
  names.set(peerId, peerName)
  local?.getTracks().forEach((t) => pc.addTrack(t, local!))

  pc.onicecandidate = (e) => {
    if (e.candidate && meId) {
      send({ kind: 'ice', from: meId, to: peerId, candidate: e.candidate.toJSON() })
    }
  }
  pc.ontrack = (e) => {
    const stream = e.streams[0]
    if (!stream) return
    const nm = names.get(peerId) ?? 'Someone'
    set({
      peers: state.peers.some((p) => p.id === peerId)
        ? state.peers.map((p) => (p.id === peerId ? { ...p, stream, name: nm } : p))
        : [...state.peers, { id: peerId, name: nm, stream }],
    })
  }
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'failed' || pc.connectionState === 'closed') dropPeer(peerId)
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
    let mic: MediaStream
    try {
      mic = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
    } catch {
      set({ error: 'Microphone blocked. Allow it in your browser’s site settings, then retry.' })
      return
    }
    local = mic
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
    local?.getTracks().forEach((t) => t.stop())
    local = null
    if (chan) void getSupabaseClient().removeChannel(chan)
    chan = null
    meId = null
    state = IDLE
    listeners.forEach((l) => l())
  },

  toggleMute() {
    const next = !state.muted
    local?.getAudioTracks().forEach((t) => (t.enabled = !next))
    set({ muted: next })
  },
}

// Closing the tab should hang up rather than leave a ghost sitting in the room.
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', () => {
    if (state.inCall) voiceSession.leave()
  })
}
