import { useEffect, useState } from 'react'
import { getSupabaseClient } from '../finance/client'
import { effectiveStatus, onStatusChange, type SeenStatus } from './presenceStatus'

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
  // re-run when you change your own status, so the announcement below is redone (or withdrawn)
  const [statusTick, setStatusTick] = useState(0)
  useEffect(() => onStatusChange(() => setStatusTick((n) => n + 1)), [])

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

    /**
     * Announce yourself on your OWN topic, so friends watching it see you — separate from the
     * loop above because you are never in your own `ids` list (list_member_directory excludes
     * you), yet your own topic is the one everyone else is actually subscribed to.
     *
     * ⚠️ Invisible does not join at all. Not "joins and marks itself hidden" — there is no
     * channel, no track(), and so nothing for a patched client or a socket log to read. See
     * presenceStatus.ts: this line is where that guarantee is actually kept.
     */
    const mine = effectiveStatus()
      ? sb.channel(`presence:${myId}`, { config: { presence: { key: myId }, private: true } })
      : null
    mine?.subscribe((status) => {
      const now = effectiveStatus()
      if (status === 'SUBSCRIBED' && now) void mine.track({ at: Date.now(), status: now })
    })

    return () => {
      channels.forEach((ch) => void sb.removeChannel(ch))
      if (mine) void sb.removeChannel(mine)
      setOnline({})
    }
  }, [myId, idsKey, statusTick])

  return online
}
