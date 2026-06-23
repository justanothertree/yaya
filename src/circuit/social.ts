// Feed social layer — kudos (emoji reactions) + comments on a day's log. Members only,
// so it loads/subscribes through the authed Supabase client (RLS scopes everything to
// logs you can see). Signed out, the Feed simply doesn't use this.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { getSupabaseClient } from '../finance/client'

export type Reaction = {
  log_id: string
  user_id: string
  emoji: string
  author_name: string | null
}
export type Comment = {
  id: string
  log_id: string
  user_id: string
  author_name: string | null
  body: string
  created_at: string
}

export const KUDOS = ['👍', '🔥', '💪', '👏', '🐐'] as const

function groupByLog<T extends { log_id: string }>(rows: T[]): Record<string, T[]> {
  const m: Record<string, T[]> = {}
  for (const r of rows) (m[r.log_id] ||= []).push(r)
  return m
}

export interface FeedSocial {
  uid: string | null
  reactionsByLog: Record<string, Reaction[]>
  commentsByLog: Record<string, Comment[]>
  toggleReaction: (logId: string, emoji: string, authorName: string) => Promise<void>
  addComment: (logId: string, body: string, authorName: string) => Promise<void>
  deleteComment: (id: string) => Promise<void>
}

/** Reactions + comments for the feed. `enabled` is false when signed out (no-op). */
export function useFeedSocial(enabled: boolean): FeedSocial {
  const sb = useMemo(() => getSupabaseClient(), [])
  const [uid, setUid] = useState<string | null>(null)
  const [reactions, setReactions] = useState<Reaction[]>([])
  const [comments, setComments] = useState<Comment[]>([])

  const load = useCallback(async () => {
    const [r, c] = await Promise.all([
      sb.from('circuit_log_reactions').select('*'),
      sb.from('circuit_log_comments').select('*').order('created_at', { ascending: true }),
    ])
    setReactions((r.data as Reaction[] | null) ?? [])
    setComments((c.data as Comment[] | null) ?? [])
  }, [sb])

  useEffect(() => {
    if (!enabled) return
    void sb.auth.getUser().then(({ data }) => setUid(data.user?.id ?? null))
    void load()
    const ch = sb
      .channel('circuit-social')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'circuit_log_reactions' },
        () => load(),
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'circuit_log_comments' }, () =>
        load(),
      )
      .subscribe()
    return () => {
      void sb.removeChannel(ch)
    }
  }, [enabled, sb, load])

  const reactionsByLog = useMemo(() => groupByLog(reactions), [reactions])
  const commentsByLog = useMemo(() => groupByLog(comments), [comments])

  const toggleReaction = useCallback(
    async (logId: string, emoji: string, authorName: string) => {
      if (!uid) return
      const mine = reactions.some(
        (r) => r.log_id === logId && r.user_id === uid && r.emoji === emoji,
      )
      if (mine) {
        await sb
          .from('circuit_log_reactions')
          .delete()
          .eq('log_id', logId)
          .eq('user_id', uid)
          .eq('emoji', emoji)
      } else {
        await sb
          .from('circuit_log_reactions')
          .insert({ log_id: logId, user_id: uid, emoji, author_name: authorName })
      }
      await load()
    },
    [sb, uid, reactions, load],
  )

  const addComment = useCallback(
    async (logId: string, body: string, authorName: string) => {
      const text = body.trim()
      if (!uid || !text) return
      await sb
        .from('circuit_log_comments')
        .insert({ log_id: logId, user_id: uid, body: text, author_name: authorName })
      await load()
    },
    [sb, uid, load],
  )

  const deleteComment = useCallback(
    async (id: string) => {
      await sb.from('circuit_log_comments').delete().eq('id', id)
      await load()
    },
    [sb, load],
  )

  return { uid, reactionsByLog, commentsByLog, toggleReaction, addComment, deleteComment }
}
