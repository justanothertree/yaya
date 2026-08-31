/* eslint-disable react-hooks/exhaustive-deps */
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import { shared, type Offer } from './shared'
import { useVoiceSession } from '../voice/useVoiceSession'

/**
 * Everything a window needs to be shareable, in one call.
 *
 * The point of this file is that adding a window to the party should cost a handful of lines and
 * no new concepts. A window supplies two functions — how to describe itself, and how to adopt
 * somebody else's description — and gets back the state and the four verbs the UI needs.
 *
 * ⚠️ TAKING A FOLLOWED WINDOW BACK is the window's own job, and the cheap way to do it is one
 * capture-phase handler on whatever contains the controls:
 *
 *     <div onPointerDownCapture={() => following && stopFollowing()}>
 *
 * rather than wrapping every setter. Fighting an incoming update is the one behaviour nobody can
 * work with — a slider that springs back half a second after you move it reads as a broken site —
 * and a handler on the container covers controls nobody has written yet.
 *
 * ⚠️ `snapshot` and `apply` are held in REFS and re-read on every call, rather than being wired
 * up as dependencies. They are almost always inline closures over the window's current state, so
 * they change identity on every render; registering them as dependencies would tear down and
 * rebuild the registration sixty times a second while a slider is moving, and every rebuild is a
 * chance to drop an update that arrived mid-swap.
 */
export function useSharedWindow<T>(
  id: string,
  label: string,
  snapshot: () => T,
  apply: (data: T) => void,
) {
  const st = useSyncExternalStore(shared.subscribe, shared.getState, shared.getState)
  const { inCall } = useVoiceSession()

  const snapRef = useRef(snapshot)
  snapRef.current = snapshot
  const applyRef = useRef(apply)
  applyRef.current = apply

  useEffect(
    () =>
      shared.register(
        id,
        () => snapRef.current(),
        (d) => applyRef.current(d as T),
      ),
    [id],
  )

  /**
   * Leaving the page gives the window back to you rather than leaving you following something you
   * can no longer see, and stops offering a window you no longer have open.
   */
  useEffect(
    () => () => {
      shared.withdraw(id)
      shared.unfollow(id)
    },
    [id],
  )

  // ⚠️ depends on `st` on purpose: offersFor reads the store, and without the store snapshot in
  // the deps this memo would keep returning the offers as they were when the window mounted
  const offers: Offer[] = useMemo(() => shared.offersFor(id), [st, id])
  const sharing = st.sharing.includes(id)
  const followingPeer = st.following[id] ?? null
  const followingName = followingPeer
    ? (offers.find((o) => o.by === followingPeer)?.name ?? 'Someone')
    : null

  /** Call after any change the room should see. A no-op unless we are the one sharing. */
  const push = useCallback(() => shared.push(id), [id])

  return {
    /** true while WE are offering this window */
    sharing,
    /** other people offering it */
    offers,
    /** whose copy we are following, if any */
    following: followingPeer,
    followingName,
    /** the party layer only exists inside a call */
    available: inCall,
    share: useCallback(() => shared.offer(id, label), [id, label]),
    stopSharing: useCallback(() => shared.withdraw(id), [id]),
    follow: useCallback((peer: string) => shared.follow(id, peer), [id]),
    stopFollowing: useCallback(() => shared.unfollow(id), [id]),
    push,
  }
}
