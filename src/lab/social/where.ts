import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { usePartyHere } from '../../party/whereEveryone'
import { party, type PartyHere } from '../../party/party'
import { myPeerId, voiceSession } from '../../voice/voiceSession'
import { labSocial } from './social'
import { onToysNow } from './gate'

/** whether you are sharing at all (the call bar's 🫱) */
export const sharingNow = () => party.getState().sharing
/** the call's own roster, as one string so it only changes when somebody joins or leaves */
export const rosterNow = () =>
  voiceSession
    .getState()
    .peers.map((p) => p.id)
    .sort()
    .join(',')

/**
 * Who in the call is on which Lab toy — only while your own Lab may share (everyone present is a
 * friend, gate.ts), and only while you are sharing at all (usePartyHere is empty otherwise). The
 * same two conditions that decide whether YOUR toy goes out, so nobody sees more than they show.
 *
 * And only people still in the call (onToysNow): somebody who hangs up leaves the picker at their
 * `bye`, not 16 s later when the party gives up on them. A crash still takes the 16 s.
 */
export function useFriendsOnToys(): PartyHere[] {
  const here = usePartyHere()
  const verdict = useSyncExternalStore(labSocial.subscribe, labSocial.get, labSocial.get)
  const roster = useSyncExternalStore(voiceSession.subscribe, rosterNow, rosterNow)
  return useMemo(
    () => onToysNow(here.lab, new Set(roster.split(',')), verdict.allowed),
    [here, roster, verdict.allowed],
  )
}

/**
 * Your own id in the call, while your toy is going out to it: your gate allows and you are
 * sharing. Null otherwise — the picker's "you" ring is drawn from this, so it never appears while
 * nothing about your toy is being said. Whether anybody is sharing back, and so can see it, is a
 * fact about them rather than you; the party drops what a friend sends until they share as well.
 */
export function useLabMe(): string | null {
  const allowed = useSyncExternalStore(labSocial.subscribe, labSocial.allowed, labSocial.allowed)
  const sharing = useSyncExternalStore(party.subscribe, sharingNow, sharingNow)
  /* the gate is never open outside a call, and the call sets your id before it says it joined */
  return allowed && sharing ? myPeerId() : null
}

/**
 * The toys' names, fetched only once somebody is on one: the list is a separate chunk (names.ts)
 * so a call that never visits the Lab never loads it.
 */
let names: Readonly<Record<string, string>> | null = null
export function useToyNames(needed: boolean): Readonly<Record<string, string>> | null {
  const [got, setGot] = useState(names)
  useEffect(() => {
    if (!needed || got) return
    let live = true
    void import('../names').then((m) => {
      names = m.TOY_NAMES
      if (live) setGot(names)
    })
    return () => {
      live = false
    }
  }, [needed, got])
  return got
}
