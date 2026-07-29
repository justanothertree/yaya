import { useCallback, useEffect, useState } from 'react'
import { getSupabaseClient } from '../finance/client'
import {
  previewMember,
  PREVIEW_PEOPLE,
  PREVIEW_UNREAD,
  previewOverview,
} from '../dev/previewMember'

/**
 * What's waiting for you, in one place: unread messages per conversation and friend requests
 * you haven't answered. Both already had a source of truth server-side (list_chat_overview
 * carries unread counts, list_friends carries pending requests) — this just gathers them so
 * the nav can badge them and the bell can list them.
 */

export type Notice = {
  id: string
  kind: 'chat' | 'friend'
  text: string
  detail?: string
  /** where tapping it should take you */
  href: string
  count?: number
}

export type Notifications = {
  items: Notice[]
  total: number
  unreadChats: number
  friendRequests: number
  refresh: () => void
}

export function useNotifications(authed: boolean): Notifications {
  const [items, setItems] = useState<Notice[]>([])

  const load = useCallback(async () => {
    if (previewMember) {
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
      ])
      return
    }
    if (!authed) {
      setItems([])
      return
    }
    const sb = getSupabaseClient()
    const [chat, friends] = await Promise.all([
      sb.rpc('list_chat_overview'),
      sb.rpc('list_friends'),
    ])
    const rooms = (
      (chat.data ?? []) as {
        id: string
        name: string
        unread: number
        last_body: string | null
      }[]
    ).filter((r) => r.unread > 0)
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
    ])
  }, [authed])

  useEffect(() => {
    void load()
  }, [load])

  // a new message anywhere we can see should update the badge without a reload; RLS applies
  // to realtime too, so this only fires for rooms we're actually in
  useEffect(() => {
    if (!authed || previewMember) return
    const sb = getSupabaseClient()
    const ch = sb
      .channel('notif:chat')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'chat_messages' },
        () => void load(),
      )
      .subscribe()
    return () => {
      void sb.removeChannel(ch)
    }
  }, [authed, load])

  // reading a room or answering a request happens on another screen — recheck on navigation
  useEffect(() => {
    const onHash = () => void load()
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [load])

  const unreadChats = items.filter((i) => i.kind === 'chat').reduce((n, i) => n + (i.count ?? 0), 0)
  const friendRequests = items.filter((i) => i.kind === 'friend').length
  return {
    items,
    total: unreadChats + friendRequests,
    unreadChats,
    friendRequests,
    refresh: () => void load(),
  }
}
