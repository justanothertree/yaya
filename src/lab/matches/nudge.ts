import { useCallback, useEffect, useMemo, useRef } from 'react'
import { getSupabaseClient } from '../../finance/client'
import { useRealtimeLife } from '../../finance/realtimeLife'
import type { RealtimeChannel } from '@supabase/supabase-js'

/**
 * The nudge on an open match (docs/2026-11-14-lab-async-matches-plan.md, "How you know it's your
 * move"): while both players have the match open, whoever acts says so on the match's own private
 * channel, and the other page looks again at once instead of at its next look (useLabMatch's
 * WATCH_MS). It carries `{ seq }` and nothing else — never a move — and the page re-reads the match
 * through lab_match_get, so what it shows is still only what the server says.
 *
 * ⚠️ AN OPTIMISATION, NEVER THE WAY IN. The topic is private, so the join goes through the
 * realtime.messages policies (lab_match_topic_member: the match's two players and nobody else).
 * Until those policies exist the join is refused, quietly, and the page goes on looking again on
 * focus and every so often, as it always has. Nothing waits on a nudge arriving.
 */
export const nudgeTopic = (id: string) => `labmatch:${id}`

/**
 * The least time between two nudges sent, and between two looks taken because of nudges heard.
 *
 * ⚠️ NOTHING ELSE LIMITS A NUDGE. The realtime.messages policies say only WHO may send on a match's
 * topic (its two players); Realtime's own caps are per project, far above one person. And every
 * nudge heard is a call to lab_match_get, so a page that hears a hundred looks a hundred times.
 * The gap is kept on both sides: sending, so this page never floods its friend, and hearing, so a
 * friend's page, whatever it sends, costs this one at most a look a second.
 */
export const NUDGE_GAP_MS = 1000

/**
 * `fn` at most once per `gap`: the first call at once, and any made within the gap after it run
 * together, once, when the gap is up, with the last value given — so the latest seq always goes,
 * and the latest nudge heard is always looked at, however many came before it.
 */
export function coalesce<T>(
  fn: (v: T) => void,
  gap: number,
  clock: {
    now: () => number
    set: (f: () => void, ms: number) => unknown
    clear: (t: unknown) => void
  } = {
    now: () => Date.now(),
    set: (f, ms) => setTimeout(f, ms),
    clear: (t) => clearTimeout(t as ReturnType<typeof setTimeout>),
  },
): { call: (v: T) => void; cancel: () => void } {
  let last = -Infinity
  let timer: unknown = null
  let latest: { v: T } | null = null
  const fire = () => {
    timer = null
    if (!latest) return
    const { v } = latest
    latest = null
    last = clock.now()
    fn(v)
  }
  return {
    call: (v) => {
      latest = { v }
      if (timer !== null) return
      const wait = last + gap - clock.now()
      if (wait <= 0) fire()
      else timer = clock.set(fire, wait)
    },
    cancel: () => {
      if (timer !== null) clock.clear(timer)
      timer = null
      latest = null
    },
  }
}

/** a nudge's seq, or null for anything that is not exactly a nudge */
export function readNudge(x: unknown): number | null {
  const o = x as { seq?: unknown } | null
  if (!o || typeof o !== 'object' || Object.keys(o).join() !== 'seq') return null
  return Number.isInteger(o.seq) && (o.seq as number) >= 0 ? (o.seq as number) : null
}

/**
 * Listen on a match's channel while `on`, calling `heard` for each nudge from the other player;
 * the returned function tells the other player this one has acted.
 */
export function useNudge(id: string | null, on: boolean, heard: () => void) {
  const life = useRealtimeLife()
  const chan = useRef<RealtimeChannel | null>(null)
  /* ⚠️ A NUDGE SAID BEFORE THE JOIN IS HELD, NOT DROPPED. The commonest moment to act is straight
     after opening a link — Accept on an invitation — and a join takes a moment; measured on the
     local stack, the accept went unheard and the challenger waited for its next look. And it is
     held for the MATCH, not the channel: a token refresh rebuilds the channel (`life`), and a hold
     cleared with it lost that same accept a second time. */
  const held = useRef<{ id: string; seq: number } | null>(null)
  const heardRef = useRef(heard)
  heardRef.current = heard
  useEffect(() => {
    if (!id || !on) return
    const sb = getSupabaseClient()
    // however fast the other page nudges, this one looks at most once a gap
    const hear = coalesce<null>(() => heardRef.current(), NUDGE_GAP_MS)
    const ch = sb
      .channel(nudgeTopic(id), { config: { broadcast: { self: false }, private: true } })
      .on('broadcast', { event: 'moved' }, ({ payload }) => {
        if (readNudge(payload) !== null) hear.call(null)
      })
      .subscribe((status) => {
        /* ⚠️ A REFUSED JOIN IS LET GO, NOT RETRIED. supabase-js rejoins a refused channel on a
           backoff, for as long as the page is open, and Realtime counts every refusal against the
           connection that carries the bell and the call too — on the local stack a run of
           refusals left every channel on the socket unanswered. One try per match and token. */
        if (status === 'CHANNEL_ERROR') {
          if (chan.current === ch) chan.current = null
          void sb.removeChannel(ch)
          return
        }
        const h = held.current
        if (status !== 'SUBSCRIBED' || !h) return
        held.current = null
        if (h.id === id)
          void ch.send({ type: 'broadcast', event: 'moved', payload: { seq: h.seq } })
      })
    chan.current = ch
    return () => {
      hear.cancel()
      chan.current = null
      void sb.removeChannel(ch)
    }
  }, [id, on, life])
  /* sending: at most once a gap, the latest seq last; one per match, made again with the match */
  const say = useMemo(
    () =>
      coalesce<number>((seq) => {
        const ch = chan.current
        if (ch && ch.state === 'joined')
          void ch.send({ type: 'broadcast', event: 'moved', payload: { seq } })
        // not in yet: said on joining; a refused join never joins, and so never says it
        else if (id) held.current = { id, seq }
      }, NUDGE_GAP_MS),
    [id],
  )
  useEffect(() => () => say.cancel(), [say])
  return useCallback((seq: number) => say.call(seq), [say])
}
