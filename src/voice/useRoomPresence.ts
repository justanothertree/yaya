import { useEffect, useState } from 'react'
import { getSupabaseClient } from '../finance/client'

/**
 * Who is CURRENTLY LOOKING AT a room — the honest answer to "who's here", as opposed to
 * "who has ever opted in", which is what `get_lounge_names()` answered while the UI said
 * "5 here" to nobody.
 *
 * Deliberately its own topic (`room:<id>`), separate from `vp:<id>` (voice presence): being in
 * the room's call and having the room's thread open are different facts, and conflating them
 * would make "who's here" jump the moment anyone started a call, or vanish the moment they
 * stopped — right for neither question. `voice_topic_member` already recognises this prefix
 * and gates it through the same `chat_room_member` rule every room kind already uses.
 *
 * Same shape as useVoicePresence for the same reasons: one channel per room (so the gate
 * applies per room, never a single broadcast that leaks who's where), presence keyed by user id
 * (a shared key undercounts), and you only ever announce yourself in the room you're actually
 * looking at.
 */
export function useRoomPresence(
  roomId: string | null,
  myId: string | null,
  myName: string,
): string[] {
  const [names, setNames] = useState<string[]>([])

  useEffect(() => {
    if (!myId || !roomId) {
      setNames([])
      return
    }
    const sb = getSupabaseClient()
    const ch = sb.channel(`room:${roomId}`, {
      config: { presence: { key: myId }, private: true },
    })
    ch.on('presence', { event: 'sync' }, () => {
      const state = ch.presenceState() as Record<string, Array<{ name?: string }>>
      setNames(Object.entries(state).map(([, metas]) => metas[0]?.name || 'Someone'))
    })
    ch.subscribe((status) => {
      if (status === 'SUBSCRIBED') void ch.track({ name: myName })
    })
    return () => {
      void ch.untrack().catch(() => {})
      void sb.removeChannel(ch)
    }
  }, [roomId, myId, myName])

  return names
}
