import { useEffect, useState } from 'react'
import { getSupabaseClient } from '../finance/client'
import { getSessionUser, onAuthStateChange } from '../finance/auth'
import { effectiveStatus, onStatusChange } from '../hooks/presenceStatus'

/**
 * Saying that you are here, from wherever you are on the site.
 *
 * ⚠️ ANNOUNCING BELONGS AT APP LEVEL, WATCHING DOES NOT. This used to live inside usePresence,
 * which only the People directory calls — so you appeared online only while you happened to be
 * looking at that one page, and two people had to be sitting on the same screen at the same moment
 * to ever see each other. That is why nobody's status ever showed up. Reading other people's
 * presence is still the directory's business, because it is the only screen that displays it; but
 * being present is a property of the person, not of the page they are on. Same reasoning as the
 * call dock and the audio dock living up here: it outlives the screen it started on.
 *
 * ⚠️ Invisible joins NOTHING. Not a channel with a flag set — see presenceStatus.ts, where the
 * point is argued properly: there is no packet to inspect and nothing on the server to leak.
 *
 * ⚠️ Going idle re-tracks, it does not rejoin. Tearing the channel down and building it again on
 * every online/away flip would show watchers a moment of you being gone each time you stopped
 * typing for five minutes.
 */
export function PresenceBeacon() {
  const [myId, setMyId] = useState<string | null>(null)

  useEffect(() => {
    let live = true
    void getSessionUser()
      .then((u) => live && setMyId(u?.id ?? null))
      .catch(() => {})
    const { data } = onAuthStateChange((event, session) => {
      if (session?.user) setMyId(session.user.id)
      else if (event === 'SIGNED_OUT') setMyId(null)
    })
    return () => {
      live = false
      data.subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!myId) return
    const sb = getSupabaseClient()
    let channel: ReturnType<typeof sb.channel> | null = null
    let dropped = false

    const sync = () => {
      const status = effectiveStatus()
      if (!status) {
        if (channel) {
          void sb.removeChannel(channel)
          channel = null
        }
        return
      }
      if (channel) {
        void channel.track({ at: Date.now(), status })
        return
      }
      const ch = sb.channel(`presence:${myId}`, {
        config: { presence: { key: myId }, private: true },
      })
      channel = ch
      ch.subscribe((state, err) => {
        if (dropped) return
        const now = effectiveStatus()
        if (state === 'SUBSCRIBED' && now) void ch.track({ at: Date.now(), status: now })
        else if (state !== 'SUBSCRIBED' && state !== 'CLOSED')
          console.warn(`[realtime] presence beacon: ${state}${err ? ` — ${err.message}` : ''}`)
      })
    }

    sync()
    const off = onStatusChange(sync)
    return () => {
      dropped = true
      off()
      if (channel) void sb.removeChannel(channel)
    }
  }, [myId])

  return null
}
