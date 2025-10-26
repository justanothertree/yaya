import type { LeaderboardEntry } from './types'

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

export async function submitScore(entry: LeaderboardEntry): Promise<void> {
  const { url, anon, table, nameCol } = envs()
  if (url && anon) {
    try {
      const endpoint = `${url}/rest/v1/${table}`
      const body = {
        // map to configured column name (e.g., player_name)
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
      // fall through to local storage backup
    }
  }
  // Fallback: local persisted leaderboard (top 15)
  try {
    const raw = localStorage.getItem(LS_KEY)
    const arr: LeaderboardEntry[] = raw ? JSON.parse(raw) : []
    arr.push(entry)
    arr.sort((a, b) => b.score - a.score)
    localStorage.setItem(LS_KEY, JSON.stringify(arr.slice(0, 15)))
  } catch {
    /* ignore */
  }
}

export async function fetchLeaderboard(limit = 15): Promise<LeaderboardEntry[]> {
  const { url, anon, table, nameCol } = envs()
  if (url && anon) {
    try {
      // alias the configured name column to `username` for internal code
      const select = `username:${nameCol},score,created_at`
      const endpoint = `${url}/rest/v1/${table}?select=${encodeURIComponent(select)}&order=score.desc,created_at.asc&limit=${limit}`
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
      // fall through to local backup
    }
  }
  try {
    const raw = localStorage.getItem(LS_KEY)
    return raw ? (JSON.parse(raw) as LeaderboardEntry[]).slice(0, limit) : []
  } catch {
    return []
  }
}

export async function fetchRankForScore(score: number): Promise<number | null> {
  const { url, anon, table } = envs()
  if (url && anon) {
    try {
      // count how many scores are strictly greater than the given score
      const endpoint = `${url}/rest/v1/${table}?select=score&score=gt.${encodeURIComponent(String(score))}`
      const res = await fetch(endpoint, {
        headers: sbHeaders(anon, { Prefer: 'count=exact' }),
      })
      if (res.ok) {
        const cr = res.headers.get('content-range') || res.headers.get('Content-Range')
        if (cr) {
          const total = Number(cr.split('/').pop())
          if (Number.isFinite(total)) return total + 1
        }
        // fallback: compute from body length if small
        const rows = (await res.json()) as unknown[]
        return rows.length + 1
      }
    } catch {
      /* ignore */
    }
  }
  return null
}
