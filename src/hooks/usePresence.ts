import { useEffect, useState } from 'react'
import { getSupabaseClient } from '../finance/client'

/**
 * Who's online, among the people allowed to know that about you.
 *
 * One presence topic PER PERSON (`presence:<uuid>`), not one shared topic for everyone. A single
 * shared topic would broadcast online/offline to every signed-in member, which is the exact
 * over-exposure class this platform's privacy rule exists to prevent — the server-side gate
 * (`presence_topic_member`) only admits friends and circuit-mates, the same audience the People
 * directory already uses. This hook is the client half of that: it broadcasts to your own topic
 * and subscribes to everyone in `ids` to read theirs.
 *
 * `private: true` on every channel routes the join through realtime.messages' RLS, exactly like
 * voice presence does — without it the topic would bypass authorization entirely.
 */
export function usePresence(myId: string | null, ids: string[]): Record<string, boolean> {
  const [online, setOnline] = useState<Record<string, boolean>>({})
  // stable key so the effect re-runs only when the SET of ids actually changes
  const idsKey = [...new Set(ids)].sort().join(',')

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
        setOnline((prev) => ({ ...prev, [id]: Object.keys(state).length > 0 }))
      })
      // Just listening -- announcing happens once, below, on `mine`. Being unable to join
      // simply leaves this id absent from `online`, which the default `false` already covers.
      ch.subscribe((status, err) => {
        if (status !== 'SUBSCRIBED' && status !== 'CLOSED')
          console.warn(`[realtime] presence: ${status}${err ? ` — ${err.message}` : ''} (not live)`)
      })
      return ch
    })

    // Announce yourself on your OWN topic too, so friends watching it see you — separate from
    // the loop above because you are never in your own `ids` list (list_member_directory
    // excludes you), yet your own topic is the one everyone else is actually subscribed to.
    const mine = sb.channel(`presence:${myId}`, {
      config: { presence: { key: myId }, private: true },
    })
    mine.subscribe((status) => {
      if (status === 'SUBSCRIBED') void mine.track({ at: Date.now() })
    })

    return () => {
      channels.forEach((ch) => void sb.removeChannel(ch))
      void sb.removeChannel(mine)
      setOnline({})
    }
  }, [myId, idsKey])

  return online
}
