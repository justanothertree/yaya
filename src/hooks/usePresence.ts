import { useEffect, useState } from 'react'
import { getSupabaseClient } from '../finance/client'
import { type SeenStatus } from './presenceStatus'

/**
 * Who's online, among the people allowed to know that about you.
 *
 * One presence topic PER PERSON (`presence:<uuid>`), not one shared topic for everyone. A single
 * shared topic would broadcast online/offline to every signed-in member, which is the exact
 * over-exposure class this platform's privacy rule exists to prevent — the server-side gate
 * (`presence_topic_member`) only admits accepted friends and circuit-mates, the same audience the
 * People directory already uses. This hook is the client half of that: it broadcasts to your own
 * topic and subscribes to everyone in `ids` to read theirs.
 *
 * `private: true` on every channel routes the join through realtime.messages' RLS, exactly like
 * voice presence does — without it the topic would bypass authorization entirely.
 *
 * ⚠️ THIS ONLY WATCHES. Announcing yourself is PresenceBeacon's job, at app level, because it used
 * to happen here — and this hook is only called by the People directory, so you were online only
 * while looking at that one page. Two people had to be on the same screen at the same moment to
 * see each other, which is why nobody's status ever appeared.
 *
 * ⚠️ Returns a STATUS per person, and a missing entry means "not visible to you" — which covers
 * offline and invisible with one answer, on purpose. Distinguishing the two would leak exactly
 * what invisible exists to hide: "offline" and "hiding" must be indistinguishable from outside,
 * or invisibility is only a label.
 */
export function usePresence(
  myId: string | null,
  ids: string[],
): Record<string, SeenStatus | undefined> {
  const [online, setOnline] = useState<Record<string, SeenStatus | undefined>>({})
  // stable key so the effect re-runs only when the SET of ids actually changes
  const idsKey = [...new Set(ids)].sort().join(',')
  /* Nothing here depends on YOUR status: going invisible stops you being broadcast, it does not
     stop you seeing other people. */
  useEffect(() => {
    if (!myId) return
    const sb = getSupabaseClient()
    const targets = idsKey ? idsKey.split(',') : []
    const channels = targets.map((id) => {
      const ch = sb.channel(`presence:${id}`, {
        config: { presence: { key: myId }, private: true },
      })
      ch.on('presence', { event: 'sync' }, () => {
        const state = ch.presenceState()
        // Someone can be present from more than one device. Any device that is not away makes
        // them online — the alternative (last writer wins) would flicker between the two.
        const entries = Object.values(state).flat() as Array<{ status?: string }>
        const seen: SeenStatus | undefined = !entries.length
          ? undefined
          : entries.some((e) => e.status !== 'away')
            ? 'online'
            : 'away'
        setOnline((prev) => (prev[id] === seen ? prev : { ...prev, [id]: seen }))
      })
      // Just listening -- announcing happens once, below, on `mine`. Being unable to join
      // simply leaves this id absent from `online`, which the default already covers.
      ch.subscribe((status, err) => {
        if (status !== 'SUBSCRIBED' && status !== 'CLOSED')
          console.warn(`[realtime] presence: ${status}${err ? ` — ${err.message}` : ''} (not live)`)
      })
      return ch
    })

    return () => {
      channels.forEach((ch) => void sb.removeChannel(ch))
      setOnline({})
    }
  }, [myId, idsKey])

  return online
}
