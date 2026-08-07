import { useCallback, useEffect, useRef, useState } from 'react'
import { getSupabaseClient } from '../finance/client'

/**
 * Peer-to-peer voice for a chat room.
 *
 * WHY IT'S SHAPED THIS WAY
 *
 * Media is a full mesh: every participant connects directly to every other, so audio never
 * touches a server and nobody — not even Evan — can listen in. That's the whole point, and
 * it's what makes this the private option. The cost is that each person uploads one stream
 * per other person, so it's right for 1:1 and small groups and falls over somewhere around
 * six. Bigger rooms need an SFU, which decrypts by design; see docs and the roadmap.
 *
 * Signalling rides Supabase Realtime rather than the Snake ws-server, which sleeps on
 * Render's free tier and drops its connections — calls would fail exactly when nobody had
 * been playing. Only the "let's connect" handshake goes through Supabase; the audio does
 * not.
 *
 * Membership needs no new model: the channel is per chat room, and who may be in a room is
 * already decided by chat_room_member.
 */

export type VoicePeer = { id: string; name: string; stream: MediaStream }

// Public STUN is enough to discover your own address. Some networks (strict NAT, a lot of
// mobile carriers) can't connect peer-to-peer at all and need a TURN relay — those calls
// will simply fail to connect rather than degrade. A relay can't decrypt the audio, so
// adding one later costs no privacy.
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

export function useVoiceRoom(roomId: string | null, meId: string | null, myName: string) {
  const [inCall, setInCall] = useState(false)
  const [peers, setPeers] = useState<VoicePeer[]>([])
  const [muted, setMuted] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Refs, not state: these are touched from signalling callbacks that must not re-run when
  // React re-renders, and a stale closure here means a dropped connection.
  const localRef = useRef<MediaStream | null>(null)
  const pcsRef = useRef<Map<string, RTCPeerConnection>>(new Map())
  const chanRef = useRef<ReturnType<ReturnType<typeof getSupabaseClient>['channel']> | null>(null)
  const namesRef = useRef<Map<string, string>>(new Map())

  const send = useCallback((msg: Signal) => {
    void chanRef.current?.send({ type: 'broadcast', event: 'voice', payload: msg })
  }, [])

  const dropPeer = useCallback((id: string) => {
    pcsRef.current.get(id)?.close()
    pcsRef.current.delete(id)
    namesRef.current.delete(id)
    setPeers((p) => p.filter((x) => x.id !== id))
  }, [])

  /** One RTCPeerConnection per peer, wired for both directions. */
  const makePc = useCallback(
    (peerId: string, peerName: string) => {
      const existing = pcsRef.current.get(peerId)
      if (existing) return existing
      const pc = new RTCPeerConnection(ICE)
      pcsRef.current.set(peerId, pc)
      namesRef.current.set(peerId, peerName)

      localRef.current?.getTracks().forEach((t) => pc.addTrack(t, localRef.current!))

      pc.onicecandidate = (e) => {
        if (e.candidate && meId) {
          send({ kind: 'ice', from: meId, to: peerId, candidate: e.candidate.toJSON() })
        }
      }
      pc.ontrack = (e) => {
        const stream = e.streams[0]
        if (!stream) return
        setPeers((prev) =>
          prev.some((x) => x.id === peerId)
            ? prev.map((x) => (x.id === peerId ? { ...x, stream } : x))
            : [...prev, { id: peerId, name: namesRef.current.get(peerId) ?? 'Someone', stream }],
        )
      }
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === 'failed' || pc.connectionState === 'closed') dropPeer(peerId)
      }
      return pc
    },
    [meId, send, dropPeer],
  )

  const leave = useCallback(() => {
    if (meId) send({ kind: 'bye', from: meId })
    pcsRef.current.forEach((pc) => pc.close())
    pcsRef.current.clear()
    namesRef.current.clear()
    localRef.current?.getTracks().forEach((t) => t.stop())
    localRef.current = null
    if (chanRef.current) void getSupabaseClient().removeChannel(chanRef.current)
    chanRef.current = null
    setPeers([])
    setInCall(false)
    setMuted(false)
  }, [meId, send])

  const join = useCallback(async () => {
    if (!roomId || !meId || inCall) return
    setError(null)
    let mic: MediaStream
    try {
      mic = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
    } catch {
      // Denied once, and the browser buries the reset in its settings — say so plainly
      // rather than leaving a dead button.
      setError('Microphone blocked. Allow it in your browser’s site settings, then try again.')
      return
    }
    localRef.current = mic
    const sb = getSupabaseClient()
    const chan = sb.channel(`voice:${roomId}`, { config: { broadcast: { self: false } } })
    chanRef.current = chan

    chan.on('broadcast', { event: 'voice' }, ({ payload }) => {
      const m = payload as Signal
      if (!meId || m.from === meId) return
      void (async () => {
        switch (m.kind) {
          case 'hello': {
            // Someone arrived. Answer so they learn we're here, then WE make the offer —
            // whoever was already in the room offers to the newcomer, which avoids glare
            // without needing a tie-break rule.
            send({ kind: 'here', from: meId, name: myName, to: m.from })
            const pc = makePc(m.from, m.name)
            const offer = await pc.createOffer()
            await pc.setLocalDescription(offer)
            send({ kind: 'offer', from: meId, to: m.from, sdp: offer })
            break
          }
          case 'here':
            if (m.to === meId) namesRef.current.set(m.from, m.name)
            break
          case 'offer': {
            if (m.to !== meId) return
            const pc = makePc(m.from, namesRef.current.get(m.from) ?? 'Someone')
            await pc.setRemoteDescription(new RTCSessionDescription(m.sdp))
            const answer = await pc.createAnswer()
            await pc.setLocalDescription(answer)
            send({ kind: 'answer', from: meId, to: m.from, sdp: answer })
            break
          }
          case 'answer': {
            if (m.to !== meId) return
            const pc = pcsRef.current.get(m.from)
            if (pc) await pc.setRemoteDescription(new RTCSessionDescription(m.sdp))
            break
          }
          case 'ice': {
            if (m.to !== meId) return
            const pc = pcsRef.current.get(m.from)
            if (pc) await pc.addIceCandidate(new RTCIceCandidate(m.candidate)).catch(() => {})
            break
          }
          case 'bye':
            dropPeer(m.from)
            break
        }
      })()
    })

    chan.subscribe((status) => {
      if (status === 'SUBSCRIBED') send({ kind: 'hello', from: meId, name: myName })
    })
    setInCall(true)
  }, [roomId, meId, myName, inCall, send, makePc, dropPeer])

  const toggleMute = useCallback(() => {
    const next = !muted
    localRef.current?.getAudioTracks().forEach((t) => (t.enabled = !next))
    setMuted(next)
  }, [muted])

  // Leaving the room, closing the tab or unmounting must tear the call down — otherwise the
  // mic stays live and the other side keeps hearing a room nobody is in.
  useEffect(() => {
    // Reading .current at cleanup time is the point here, not an oversight: the connections
    // we need to hang up on are whoever is live WHEN we unmount. The lint rule's suggested
    // fix — copy the ref into a local at effect setup — would capture an empty map, because
    // nobody has connected yet, and we'd leave every peer connection open with the
    // microphone still running. Disabled for the teardown block only.
    /* eslint-disable react-hooks/exhaustive-deps */
    return () => {
      pcsRef.current.forEach((pc) => pc.close())
      pcsRef.current.clear()
      localRef.current?.getTracks().forEach((t) => t.stop())
      localRef.current = null
      if (chanRef.current) void getSupabaseClient().removeChannel(chanRef.current)
      chanRef.current = null
    }
    /* eslint-enable react-hooks/exhaustive-deps */
  }, [])

  // Switching rooms while in a call would leave the old call running invisibly.
  useEffect(() => {
    if (inCall) leave()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId])

  return { inCall, peers, muted, error, join, leave, toggleMute }
}
