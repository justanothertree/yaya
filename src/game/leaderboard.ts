import type { LeaderboardEntry } from './types'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const LS_KEY = 'snake.leaderboard.v2'

function sbHeaders(anon: string, extra?: Record<string, string>) {
  return {
    apikey: anon,
    Authorization: `Bearer ${anon}`,
    'Content-Type': 'application/json',
    ...(extra || {}),
  }
}

function envs() {
  const env = (import.meta as unknown as { env?: Record<string, string> }).env || {}
  return {
    url: env.VITE_SUPABASE_URL,
    anon: env.VITE_SUPABASE_ANON_KEY,
    table: env.VITE_LEADERBOARD_TABLE || 'scores',
    nameCol: env.VITE_LEADERBOARD_NAME_COLUMN || 'username',
  }
}

let _client: SupabaseClient | null = null
function getClient(): SupabaseClient | null {
  const { url, anon } = envs()
  if (!url || !anon) return null
  if (_client) return _client
  _client = createClient(url, anon, { auth: { persistSession: false } })
  return _client
}

export type LeaderboardPeriod = 'all' | 'month' | 'today'

function startIsoFor(period: LeaderboardPeriod): string | null {
  if (period === 'all') return null
  const now = new Date()
  const y = now.getUTCFullYear()
  const m = now.getUTCMonth()
  const d = now.getUTCDate()
  const start = period === 'today' ? new Date(Date.UTC(y, m, d)) : new Date(Date.UTC(y, m, 1))
  return start.toISOString()
}

export async function submitScore(entry: LeaderboardEntry): Promise<void> {
  const { url, anon, table, nameCol } = envs()
  const client = getClient()
  if (client && url && anon) {
    try {
      // Best-by-name upsert: only update if the new score is higher
      const { data: existing } = await client
        .from(table)
        .select('id, score')
        .eq(nameCol, entry.username)
        .maybeSingle()
      if (!existing) {
        await client
          .from(table)
          .insert({ [nameCol]: entry.username, score: entry.score, created_at: entry.date })
        return
      }
      if (entry.score > (existing as { score: number }).score) {
        await client
          .from(table)
          .update({ score: entry.score, created_at: entry.date })
          .eq('id', (existing as { id: string }).id)
      }
      return
    } catch {
      // fall through to REST/local backup
    }
  }
  if (url && anon) {
    try {
      const endpoint = `${url}/rest/v1/${table}`
      const body = {
        [nameCol]: entry.username,
        score: entry.score,
        created_at: entry.date,
      }
      await fetch(endpoint, {
        method: 'POST',
        headers: sbHeaders(anon, { Prefer: 'return=minimal' }),
        body: JSON.stringify(body),
      })
      return
    } catch {
      /* ignore */
    }
  }
  // Fallback: local persisted leaderboard (top 15)
  try {
    const raw = localStorage.getItem(LS_KEY)
    const arr: LeaderboardEntry[] = raw ? JSON.parse(raw) : []
    const idx = arr.findIndex((e) => e.username === entry.username)
    if (idx >= 0) {
      if (entry.score > arr[idx].score) arr[idx] = entry
    } else {
      arr.push(entry)
    }
    arr.sort((a, b) => b.score - a.score)
    localStorage.setItem(LS_KEY, JSON.stringify(arr.slice(0, 15)))
  } catch {
    /* ignore */
  }
}

export async function fetchLeaderboard(
  period: LeaderboardPeriod = 'all',
  limit = 15,
): Promise<LeaderboardEntry[]> {
  const { url, anon, table, nameCol } = envs()
  const since = startIsoFor(period)
  if (url && anon) {
    try {
      const select = `username:${nameCol},score,created_at`
      const parts = [
        `${url}/rest/v1/${table}?select=${encodeURIComponent(select)}`,
        `order=score.desc,created_at.asc`,
        `limit=${limit}`,
      ]
      if (since) parts.push(`created_at=gte.${encodeURIComponent(since)}`)
      const endpoint = parts[0] + '&' + parts.slice(1).join('&')
      const res = await fetch(endpoint, { headers: sbHeaders(anon) })
      if (res.ok) {
        const rows = (await res.json()) as Array<{
          username: string
          score: number
          created_at: string
        }>
        return rows.map((r) => ({ username: r.username, score: r.score, date: r.created_at }))
      }
    } catch {
      /* fall through */
    }
  }
  try {
    const raw = localStorage.getItem(LS_KEY)
    const all = raw ? (JSON.parse(raw) as LeaderboardEntry[]) : []
    const filtered = since ? all.filter((e) => e.date >= since) : all
    return filtered.sort((a, b) => b.score - a.score).slice(0, limit)
  } catch {
    return []
  }
}

export async function fetchRankForScore(
  score: number,
  period: LeaderboardPeriod = 'all',
): Promise<number | null> {
  const { url, anon, table } = envs()
  const since = startIsoFor(period)
  if (url && anon) {
    try {
      const parts = [
        `${url}/rest/v1/${table}?select=score`,
        `score=gt.${encodeURIComponent(String(score))}`,
      ]
      if (since) parts.push(`created_at=gte.${encodeURIComponent(since)}`)
      const endpoint = parts[0] + '&' + parts.slice(1).join('&')
      const res = await fetch(endpoint, { headers: sbHeaders(anon, { Prefer: 'count=exact' }) })
      if (res.ok) {
        const cr = res.headers.get('content-range') || res.headers.get('Content-Range')
        if (cr) {
          const total = Number(cr.split('/').pop())
          if (Number.isFinite(total)) return total + 1
        }
        const rows = (await res.json()) as unknown[]
        return rows.length + 1
      }
    } catch {
      /* ignore */
    }
  }
  return null
}

export function subscribeToLeaderboard(onChange: () => void): (() => void) | null {
  const client = getClient()
  const { table } = envs()
  if (!client) return null
  const channel = client
    .channel('scores-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table }, () => onChange())
    .subscribe()
  return () => {
    try {
      void client.removeChannel(channel)
    } catch {
      /* noop */
    }
  }
}
