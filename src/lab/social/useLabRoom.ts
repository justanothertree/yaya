import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { myPeerId, onParty, sendParty, voiceSession } from '../../voice/voiceSession'
import { party } from '../../party/party'
import { usePartyHere } from '../../party/whereEveryone'
import { labSocial } from './social'
import type { Table } from './table'
import { keepOnline } from './online'
import { rosterNow, sharingNow } from './where'
import { heldSeat } from './held'
import { gameOver } from './gameOver'
import {
  act,
  computerTurn,
  finishedOf,
  idle,
  isHost,
  openRoom,
  outcomeFor,
  playComputer,
  present,
  receive,
  seatOf,
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
 * GAME IS KEPT (online.ts) for each seated player — once, on the move that finished it — and told,
 * with who won, to anything on the page that listens for it (gameOver.ts: the party tour).
 */
/** a call's room is a table (table.ts): the same seats, line and result words as a saved match */
export type LabRoom<G, M> = Table<G, M>

export function useLabRoom<G, M>(sub: string, rules: Rules<G, M>): LabRoom<G, M> {
  const here = usePartyHere()
  const verdict = useSyncExternalStore(labSocial.subscribe, labSocial.get, labSocial.get)
  const sharing = useSyncExternalStore(party.subscribe, sharingNow, sharingNow)
  const me = myPeerId()
  const live = verdict.allowed && sharing && !!me
  /* ⚠️ ON THIS TOY AND STILL IN THE CALL. The party remembers somebody for up to 16 s after they
     stop saying where they are, and hanging up tells the party nothing; the call's roster drops
     them at their `bye` — and somebody who has left the call has left the room. A crash sends no
     `bye` and stays on the roster (gate.ts, onToysNow), so it still takes the party's 16 s. */
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
      /* ⚠️ KEPT ON THE MOVE THAT FINISHED IT, NEVER ON SEEING A FINISHED BOARD (finishedOf says
         why). Asked once, and both the record and the party tour read that one answer. */
      const done = finishedOf(rulesRef.current, prev, next)
      if (done) {
        const how = outcomeFor(rulesRef.current, next)
        if (how) keepOnline(sub, next.mode, how)
        gameOver.tell(done)
      }
    },
    [sub],
  )

  // open a room when it becomes live, listen while it is
  useEffect(() => {
    if (!live || !me) return
    const opened = openRoom(rulesRef.current, sub, me, performance.now())
    take(opened.room, opened.out)
    const off = onParty((m) => {
      if (m.kind !== 'lab' || !roomRef.current) return
      const s = receive(rulesRef.current, roomRef.current, m.from, m.body, performance.now())
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

  /* ⚠️ A SEAT IN A GAME STILL GOING IS SOMETHING A FOLLOW MUST NOT TAKE AWAY. Following a friend
     round the Lab moves you by remounting the toy, which ends this room and the game in it — so
     while you sit in an unfinished one, the tour offers instead of moving (held.ts, tour.ts). A
     seat at a game that is over or not yet begun is not held: moving on from it costs nothing. */
  const holding = live && !!room && seatOf(room) !== null && !idle(rules, room)
  useEffect(() => {
    if (!holding) return
    heldSeat.set(sub)
    return () => heldSeat.clear(sub)
  }, [holding, sub])

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
