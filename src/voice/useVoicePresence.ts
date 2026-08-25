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
    let channels: ReturnType<typeof sb.channel>[] = []
    let gone = false

    /**
     * ⚠️ FREE THE TOPICS BEFORE ASKING FOR THEM AGAIN.
     *
     * realtime-js dedupes channels BY TOPIC, and removeChannel() is async — it only tears
     * down after awaiting unsubscribe(). The cleanup below is fire-and-forget, so when this
     * effect re-runs (and it re-runs the instant you JOIN a call, because activeRoomId is in
     * its deps) the old channel is still registered. sb.channel() hands that dying instance
     * back, and subscribe() no-ops on it because it only acts when the channel isClosed().
     * SUBSCRIBED never fires, so track() never runs.
     *
     * The consequence was the worst possible one: pressing Call announced you to nobody. No
     * "X is calling you" notice, no ring, nothing in the bell — you sat in a call the other
     * person was never told about. This hook is the only thing that tracks into vp:*, so
     * there was no fallback.
     *
     * voiceSession.join() and useRoomPresence have carried this guard for a while. This one
     * did not.
     */
    void (async () => {
      const topics = new Set(ids.map((id) => `realtime:vp:${id}`))
      for (const old of sb.getChannels().filter((c) => topics.has(c.topic))) {
        try {
          await sb.removeChannel(old)
        } catch {
          /* already torn down */
        }
      }
      if (gone) return // unmounted while we waited — do not subscribe a channel nobody owns
      channels = ids.map((id) => {
        // `private: true` is what makes the realtime.messages policies apply. Without it the
        // topic is a public channel and authorization is skipped entirely, so anyone holding
        // the anon key and this room's UUID could watch who is in the call.
        const ch = sb.channel(`vp:${id}`, {
          config: { presence: { key: myId }, private: true },
        })
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
    })()

    return () => {
      gone = true
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
