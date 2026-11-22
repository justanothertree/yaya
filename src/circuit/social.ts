// Feed social layer — kudos (emoji reactions) + comments on a day's log. Members only,
// so it loads/subscribes through the authed Supabase client (RLS scopes everything to
// logs you can see). Signed out, the Feed simply doesn't use this.
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getSupabaseClient } from '../finance/client'
import { previewMember } from '../dev/previewMember'

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

/**
 * The longest comment the box takes: `circuit_log_comments_body_check` allows 1000 characters.
 * ⚠️ THE BOX HAD NO CAP, and `post` clears it without waiting for the answer, so a comment over the
 * limit vanished — the box emptied, nothing was posted and nothing said why (found in the pane
 * once the feed had a stand-in, OPEN-DECISIONS §22c). An input's `maxLength` counts UTF-16 units,
 * never fewer than the characters `char_length` counts, so capping at the same number can only
 * ever be stricter than the server. scripts/comment-cap.test.mjs holds this against the schema.
 */
export const COMMENT_MAX = 1000

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
  /**
   * DEV only: the member preview has no session, so every read here answered nothing and the pane
   * could only ever show a feed with no kudos and no comments (OPEN-DECISIONS §22c). It gets a
   * double instead — dev/feedSocialPreview.ts — and this hook runs unchanged over it.
   * ⚠️ `import.meta.env.DEV` SPELLED OUT, as in circuit/connect.ts: Vite folds the literal to
   * `false` in a build, so the dynamic import is gone before rollup decides what to keep, and a
   * production page has the real client from its first render.
   */
  const [sb, setSb] = useState<SupabaseClient | null>(() =>
    import.meta.env.DEV && previewMember ? null : getSupabaseClient(),
  )
  useEffect(() => {
    if (!(import.meta.env.DEV && previewMember)) return
    let live = true
    void import('../dev/feedSocialPreview').then((m) => {
      if (live) setSb(m.previewSocialClient() as unknown as SupabaseClient)
    })
    return () => {
      live = false
    }
  }, [])
  const [uid, setUid] = useState<string | null>(null)
  const [reactions, setReactions] = useState<Reaction[]>([])
  const [comments, setComments] = useState<Comment[]>([])

  const load = useCallback(async () => {
    if (!sb) return
    const [r, c] = await Promise.all([
      sb.from('circuit_log_reactions').select('*'),
      sb.from('circuit_log_comments').select('*').order('created_at', { ascending: true }),
    ])
    setReactions((r.data as Reaction[] | null) ?? [])
    setComments((c.data as Comment[] | null) ?? [])
  }, [sb])

  useEffect(() => {
    if (!enabled || !sb) return
    void sb.auth.getUser().then(({ data }) => setUid(data.user?.id ?? null))
    void load()
    const ch = sb
      .channel('circuit-social', { config: { private: true } })
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'circuit_log_reactions' },
        () => load(),
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'circuit_log_comments' }, () =>
        load(),
      )
      .subscribe((status, err) => {
        if (status !== 'SUBSCRIBED' && status !== 'CLOSED')
          console.warn(
            `[realtime] circuit-social: ${status}${err ? ` — ${err.message}` : ''} (not live)`,
          )
      })
    return () => {
      void sb.removeChannel(ch)
    }
  }, [enabled, sb, load])

  const reactionsByLog = useMemo(() => groupByLog(reactions), [reactions])
  const commentsByLog = useMemo(() => groupByLog(comments), [comments])

  const toggleReaction = useCallback(
    async (logId: string, emoji: string, authorName: string) => {
      if (!sb || !uid) return
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
      if (!sb || !uid || !text) return
      await sb
        .from('circuit_log_comments')
        .insert({ log_id: logId, user_id: uid, body: text, author_name: authorName })
      await load()
    },
    [sb, uid, load],
  )

  const deleteComment = useCallback(
    async (id: string) => {
      if (!sb) return
      await sb.from('circuit_log_comments').delete().eq('id', id)
      await load()
    },
    [sb, load],
  )

  return { uid, reactionsByLog, commentsByLog, toggleReaction, addComment, deleteComment }
}
