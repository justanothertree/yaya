import { useEffect, useState } from 'react'
import { getSupabaseClient } from '../finance/client'

/**
 * Who is sitting in each room's voice call, live — the "two friends are in General" glance
 * that makes a voice room feel like a place rather than a button.
 *
 * ⚠️ WHY THIS IS PER-ROOM AND NOT ONE GLOBAL CHANNEL
 *
 * One shared presence channel would be cheaper: everyone in a call announces {room, name}
 * and every client reads the lot. It would also broadcast that Evan and Josh are in a DM
 * call together to every member of the site — who is talking privately with whom is exactly
 * the kind of thing that must not leak. Filtering it client-side wouldn't help; the data
 * would still have arrived.
 *
 * So: one channel per room, and only for rooms already in your own conversation list, which
 * list_chat_overview has access-controlled. You can only learn about rooms you're in.
 *
 * ⚠️ THE KEY MUST BE THE USER ID, NOT THE NAME
 *
 * It was the name, and the name was the literal 'You' for everybody, so Supabase filed all
 * participants under one presence key. Consequences, all reported from real testing: the
 * count never rose above 1 however many people joined, and the badge lingered after someone
 * left because the shared key stayed occupied by whoever remained. A presence key has to be
 * unique per person; the display name rides in the payload where it belongs.
 *
 * Topic is separate from the signalling channel (`voice:<id>`) on purpose. Subscribing twice
 * to one topic from the same client would report you as two people in the room.
 */
export function useVoicePresence(
  roomIds: string[],
  /** unique per person — this is the presence key */
  myId: string | null,
  myName: string,
  /** the room whose call you're actually in, if any — you appear only there */
  activeRoomId: string | null,
): Record<string, string[]> {
  const [byRoom, setByRoom] = useState<Record<string, string[]>>({})
  // joined into a string so the effect doesn't re-run on every render just because the
  // caller built a new array with the same ids in it
  const key = roomIds.join(',')

  useEffect(() => {
    if (!myId) return
    const sb = getSupabaseClient()
    const ids = key ? key.split(',') : []
    const channels = ids.map((id) => {
      const ch = sb.channel(`vp:${id}`, { config: { presence: { key: myId } } })
      ch.on('presence', { event: 'sync' }, () => {
        const state = ch.presenceState() as Record<string, Array<{ name?: string }>>
        // One entry per presence KEY, i.e. per person. Deduping by name would merge two
        // people who happen to share one — which is exactly how the count got stuck at 1.
        const names = Object.entries(state).map(([, metas]) => metas[0]?.name || 'Someone')
        setByRoom((prev) => ({ ...prev, [id]: names }))
      })
      ch.subscribe((status) => {
        // Announce yourself only in the room you're actually calling in. Watching a room
        // must stay invisible — otherwise merely having a conversation open would look
        // like being in its call.
        if (status === 'SUBSCRIBED' && id === activeRoomId) void ch.track({ name: myName })
      })
      return ch
    })
    return () => {
      // untrack before removing, so the badge clears for everyone else immediately rather
      // than waiting for the server to time the connection out
      channels.forEach((ch) => {
        void ch.untrack().catch(() => {})
        void sb.removeChannel(ch)
      })
    }
  }, [key, activeRoomId, myId, myName])

  return byRoom
}
