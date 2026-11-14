import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { myPeerId, onParty, sendParty, voiceSession } from '../../voice/voiceSession'
import { party } from '../../party/party'
import { usePartyHere } from '../../party/whereEveryone'
import { labSocial } from './social'
import { keepOnline } from './online'
import {
  act,
  computerTurn,
  isHost,
  openRoom,
  outcomeFor,
  playComputer,
  present,
  receive,
  waitingFor,
  type Action,
  type Room,
  type Rules,
  type Wire,
} from './room'

/**
 * A toy's two-seat room, carried by the call (src/lab/social/room.ts holds the rules of it).
 *
 * Live only when everything that lets your Lab share is true — in a call, sharing, everyone
 * present a friend (gate.ts) — and the toy is the one on screen. Messages go out as the party's
 * `lab` kind on the call's own channel; nobody outside the call receives them, and the meter
 * (party/meter.ts) counts them with everything else.
 *
 * ⚠️ IT KEEPS THE LAST ROOM WHEN THE CALL GOES, as `last`. Realtime dropping, the gate closing (a
 * stranger joining), or leaving the call all end the room at once, and the toy offers to carry on
 * against the computer from that board rather than throwing the game away.
 *
 * Two things every toy gets from here rather than writing its own: the HOST'S BROWSER PLAYS THE
 * COMPUTER in a together game, after a pause long enough to see whose move it was, and A FINISHED
 * GAME IS KEPT (online.ts) for each seated player — once, on the move that finished it.
 */
export type LabRoom<G, M> = {
  live: boolean
  /** the room now, or the last one there was; null before there has been one */
  room: Room<G> | null
  act: (a: Action<M>) => void
  /** names of everybody on this toy, by id, from the party */
  names: Record<string, string>
}

const sharingNow = () => party.getState().sharing
/** the call's own roster, as one string so it only changes when somebody joins or leaves */
const rosterNow = () =>
  voiceSession
    .getState()
    .peers.map((p) => p.id)
    .sort()
    .join(',')

export function useLabRoom<G, M>(sub: string, rules: Rules<G, M>): LabRoom<G, M> {
  const here = usePartyHere()
  const verdict = useSyncExternalStore(labSocial.subscribe, labSocial.get, labSocial.get)
  const sharing = useSyncExternalStore(party.subscribe, sharingNow, sharingNow)
  const me = myPeerId()
  const live = verdict.allowed && sharing && !!me
  /* ⚠️ ON THIS TOY AND STILL IN THE CALL. The party remembers somebody for up to 16 s after they
     stop saying where they are (a crash sends no goodbye), but the call's roster knows at once
     when somebody leaves it — and somebody who has left the call has left the room. */
  const roster = useSyncExternalStore(voiceSession.subscribe, rosterNow, rosterNow)
  const people = useMemo(() => {
    const inCall = new Set(roster.split(','))
    return (here.lab ?? []).filter((p) => p.sub === sub && inCall.has(p.id))
  }, [here, sub, roster])
  const ids = people.map((p) => p.id).join(',')
  /* names of everybody seen on this toy, kept after they go — "Waiting for Bo…" is about somebody
     who is, by definition, no longer here */
  const seen = useRef<Record<string, string>>({})
  const names = useMemo(() => {
    for (const p of here.lab ?? []) if (p.sub === sub) seen.current[p.id] = p.name
    return { ...seen.current }
  }, [here, sub])

  const rulesRef = useRef(rules)
  rulesRef.current = rules
  const roomRef = useRef<Room<G> | null>(null)
  const [room, setRoom] = useState<Room<G> | null>(null)
  const take = useCallback(
    (next: Room<G>, out: Wire[]) => {
      const prev = roomRef.current
      roomRef.current = next
      setRoom(next)
      for (const body of out) sendParty('lab', body)
      /* ⚠️ KEPT ON THE MOVE THAT FINISHED IT, NEVER ON SEEING A FINISHED BOARD. Somebody arriving
         (or coming back) is handed the room as it is, finished game and all; only a state one seq
         on from a game still going is the end of a game this browser was in. */
      if (prev && next.seq === prev.seq + 1 && rulesRef.current.turn(prev.game) !== null) {
        const how = outcomeFor(rulesRef.current, next)
        if (how) keepOnline(sub, next.mode, how)
      }
    },
    [sub],
  )

  // open a room when it becomes live, listen while it is
  useEffect(() => {
    if (!live || !me) return
    const opened = openRoom(rulesRef.current, sub, me)
    take(opened.room, opened.out)
    const off = onParty((m) => {
      if (m.kind !== 'lab' || !roomRef.current) return
      const s = receive(rulesRef.current, roomRef.current, m.from, m.body)
      if (s.room !== roomRef.current || s.out.length) take(s.room, s.out)
    })
    return off
  }, [live, me, sub, take])

  // who else is on this toy, and the clock that frees a seat held too long
  useEffect(() => {
    if (!live) return
    const tell = () => {
      if (!roomRef.current) return
      const list = ids ? ids.split(',') : []
      const s = present(rulesRef.current, roomRef.current, list, performance.now())
      take(s.room, s.out)
    }
    tell()
    const t = window.setInterval(tell, 5000)
    return () => window.clearInterval(t)
  }, [live, ids, take])

  // the host plays the computer, a moment after its turn comes round
  const due =
    live && !!room && isHost(room) && computerTurn(rules, room) && !waitingFor(room, rules)
  const dueAt = due && room ? room.seq : -1
  useEffect(() => {
    if (dueAt < 0) return
    const t = window.setTimeout(() => {
      const r = roomRef.current
      if (!r || r.seq !== dueAt) return
      const s = playComputer(rulesRef.current, r)
      if (s.room !== r) take(s.room, s.out)
    }, 700)
    return () => window.clearTimeout(t)
  }, [dueAt, take])

  const doAct = useCallback(
    (a: Action<M>) => {
      if (!live || !roomRef.current) return
      const s = act(rulesRef.current, roomRef.current, a)
      take(s.room, s.out)
    },
    [live, take],
  )
  return { live, room, act: doAct, names }
}
