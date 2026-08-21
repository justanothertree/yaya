import { useCallback, useEffect, useRef, useState } from 'react'
import { getSupabaseClient } from '../finance/client'
import {
  previewMember,
  PREVIEW_PEOPLE,
  PREVIEW_UNREAD,
  PREVIEW_ACTIVITY,
  previewOverview,
} from '../dev/previewMember'
import { onNotificationsChanged } from './notifySignal'

/**
 * What's waiting for you, in one place: unread messages per conversation and friend requests
 * you haven't answered. Both already had a source of truth server-side (list_chat_overview
 * carries unread counts, list_friends carries pending requests) — this just gathers them so
 * the nav can badge them and the bell can list them.
 */

export type Notice = {
  id: string
  kind: 'chat' | 'friend' | 'kudos' | 'comment' | 'join' | 'guestbook' | 'call'
  text: string
  detail?: string
  /** where tapping it should take you */
  href: string
  count?: number
}

/** just enough about a conversation for someone else to notice a call happening in it */
export type NotifRoom = { id: string; name: string; kind: string }

export type Notifications = {
  items: Notice[]
  /**
   * Every conversation you can see, not only the ones with something waiting.
   *
   * Exposed because this hook is the one place that's always mounted AND knows your room
   * list, which is exactly what a site-wide "someone is in a call" watch needs. Live call
   * presence itself deliberately stays out of here — see App, where it's subscribed once.
   */
  rooms: NotifRoom[]
  total: number
  unreadChats: number
  friendRequests: number
  refresh: () => void
  /** called when the bell is opened: activity stops being "new" */
  markSeen: () => void
}

type ActivityRow = {
  kind: 'kudos' | 'comment' | 'join' | 'guestbook'
  actor: string
  subject: string
  detail: string | null
  at?: string
}

/**
 * One activity row -> a bell entry. Kudos/comments point at the feed, joins at the circuit, and
 * a guestbook note at the page it was written on — `subject` carries your own username for
 * exactly that, so tapping the notice lands where the note actually is.
 */
function activityNotice(a: ActivityRow, i: number): Notice {
  const text =
    a.kind === 'kudos'
      ? `${a.actor} cheered your ${a.subject} log`
      : a.kind === 'comment'
        ? `${a.actor} commented on your ${a.subject} log`
        : a.kind === 'guestbook'
          ? `${a.actor} wrote on your page`
          : `${a.actor} joined ${a.subject}`
  return {
    id: `${a.kind}-${a.actor}-${a.subject}-${i}`,
    kind: a.kind,
    text,
    detail: a.detail ?? undefined,
    href:
      a.kind === 'join'
        ? '#circuit?tab=circuits'
        : a.kind === 'guestbook'
          ? '#profile?u=' + encodeURIComponent(a.subject)
          : '#circuit?tab=feed',
  }
}

export function useNotifications(authed: boolean): Notifications {
  const [items, setItems] = useState<Notice[]>([])
  const [rooms, setAllRooms] = useState<NotifRoom[]>([])
  // set once the bell has been opened, so activity drops out of the count immediately while
  // the panel you're reading still shows it
  const seenRef = useRef(false)
  const [seen, setSeen] = useState(false)

  const load = useCallback(async () => {
    if (previewMember) {
      setAllRooms(previewOverview().map((r) => ({ id: r.id, name: r.name, kind: r.kind })))
      const rooms = previewOverview().filter((r) => (PREVIEW_UNREAD[r.id] ?? 0) > 0)
      const reqs = PREVIEW_PEOPLE.filter((p) => p.rel === 'in')
      setItems([
        ...rooms.map((r) => ({
          id: 'chat-' + r.id,
          kind: 'chat' as const,
          text: `${r.unread} unread in ${r.name}`,
          detail: r.last_body ?? undefined,
          href: '#chat?room=' + r.id,
          count: r.unread,
        })),
        ...reqs.map((p) => ({
          id: 'friend-' + p.username,
          kind: 'friend' as const,
          text: `${p.name} wants to be friends`,
          detail: '@' + p.username,
          href: '#people',
        })),
        ...(seenRef.current ? [] : PREVIEW_ACTIVITY.map(activityNotice)),
      ])
      return
    }
    if (!authed) {
      setItems([])
      setAllRooms([])
      return
    }
    const sb = getSupabaseClient()
    const [chat, friends, activity] = await Promise.all([
      sb.rpc('list_chat_overview'),
      sb.rpc('list_friends'),
      sb.rpc('list_activity_notices'),
    ])
    const overview = (chat.data ?? []) as {
      id: string
      name: string
      kind: string
      unread: number
      last_body: string | null
    }[]
    setAllRooms(overview.map((r) => ({ id: r.id, name: r.name, kind: r.kind })))
    const rooms = overview.filter((r) => r.unread > 0)
    const reqs = (
      (friends.data ?? []) as {
        username: string
        name: string
        status: string
        direction: string
      }[]
    ).filter((f) => f.status === 'pending' && f.direction === 'in')
    setItems([
      ...rooms.map((r) => ({
        id: 'chat-' + r.id,
        kind: 'chat' as const,
        text: `${r.unread} unread in ${r.name}`,
        detail: r.last_body ?? undefined,
        href: '#chat?room=' + r.id,
        count: r.unread,
      })),
      ...reqs.map((f) => ({
        id: 'friend-' + f.username,
        kind: 'friend' as const,
        text: `${f.name} wants to be friends`,
        detail: '@' + f.username,
        href: '#people',
      })),
      ...(seenRef.current ? [] : ((activity.data ?? []) as ActivityRow[]).map(activityNotice)),
    ])
  }, [authed])

  useEffect(() => {
    void load()
  }, [load])

  // new activity arriving after you've looked should light the bell up again
  useEffect(() => {
    if (!seen) return
    const t = window.setTimeout(() => {
      seenRef.current = false
      setSeen(false)
    }, 60000)
    return () => clearTimeout(t)
  }, [seen])

  // a new message anywhere we can see should update the badge without a reload; RLS applies
  // to realtime too, so this only fires for rooms we're actually in
  useEffect(() => {
    if (!authed || previewMember) return
    const sb = getSupabaseClient()
    const ch = sb
      .channel('notif:chat', { config: { private: true } })
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages' },
        () => void load(),
      )
      .subscribe((status, err) => {
        if (status !== 'SUBSCRIBED' && status !== 'CLOSED')
          console.warn(
            `[realtime] notif:chat: ${status}${err ? ` — ${err.message}` : ''} (not live)`,
          )
      })
    return () => {
      void sb.removeChannel(ch)
    }
  }, [authed, load])

  // Reading a room doesn't always move the hash — tapping a conversation row marks it read
  // in place — so the screens that change these counts say so directly. This is the reliable
  // path; the hashchange listener below is the backstop for anything that doesn't announce.
  useEffect(() => onNotificationsChanged(() => void load()), [load])

  // reading a room or answering a request happens on another screen — recheck on navigation
  useEffect(() => {
    let t = 0
    const onHash = () => {
      void load()
      // Opening a room marks it read as part of the same navigation, so an immediate reload can
      // still count the message you just opened. Check again once that has landed — this is why
      // the badge appeared not to clear.
      clearTimeout(t)
      t = window.setTimeout(() => void load(), 900)
    }
    window.addEventListener('hashchange', onHash)
    return () => {
      clearTimeout(t)
      window.removeEventListener('hashchange', onHash)
    }
  }, [load])

  // Opening the bell is the read receipt for ACTIVITY only: unread messages stay unread
  // until you actually open the room. It deliberately leaves `items` alone — clearing the
  // list on open meant the notices vanished before you could read them.
  const markSeen = useCallback(() => {
    seenRef.current = true
    setSeen(true)
    if (previewMember || !authed) return
    // ⚠️ A supabase-js builder is LAZY: the request is only sent when something calls
    // .then() on it. `void sb.rpc(...)` evaluates the builder and throws it away without
    // ever hitting the network — silently, with no error to notice. That is why the bell
    // cleared on screen and came back on reload for months: the local `seen` state was
    // the only thing that ever changed, and activity_reads stayed empty.
    // Always .then() or await a builder, even when the result doesn't matter.
    void getSupabaseClient()
      .rpc('mark_activity_seen')
      .then(({ error }) => {
        // If it didn't land, don't let the bell claim it cleared — it would only come
        // back on the next reload, which is the confusing behaviour we just fixed.
        if (error) {
          seenRef.current = false
          setSeen(false)
        }
      })
  }, [authed])

  const unreadChats = items.filter((i) => i.kind === 'chat').reduce((n, i) => n + (i.count ?? 0), 0)
  const friendRequests = items.filter((i) => i.kind === 'friend').length
  // everything that isn't a chat or a friend request counts until the bell has been opened.
  // Written as "not chat/friend" rather than a list of activity kinds on purpose: the old
  // version enumerated kudos/comment/join, so adding a kind meant it rendered in the panel but
  // was silently missing from the badge — a new notice type would arrive already half-wired.
  const activity = seen ? 0 : items.filter((i) => i.kind !== 'chat' && i.kind !== 'friend').length
  return {
    items,
    rooms,
    total: unreadChats + friendRequests + activity,
    unreadChats,
    friendRequests,
    refresh: () => void load(),
    markSeen,
  }
}
