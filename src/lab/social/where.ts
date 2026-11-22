import { useEffect, useState, useSyncExternalStore } from 'react'
import { usePartyHere } from '../../party/whereEveryone'
import type { PartyHere } from '../../party/party'
import { labSocial } from './social'

/**
 * Who in the call is on which Lab toy — only while your own Lab may share (everyone present is a
 * friend, gate.ts), and only while you are sharing at all (usePartyHere is empty otherwise). The
 * same two conditions that decide whether YOUR toy goes out, so nobody sees more than they show.
 */
export function useFriendsOnToys(): PartyHere[] {
  const here = usePartyHere()
  const verdict = useSyncExternalStore(labSocial.subscribe, labSocial.get, labSocial.get)
  if (!verdict.allowed) return []
  return (here.lab ?? []).filter((p) => p.sub)
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
