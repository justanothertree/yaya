import type { LeaderboardEntry, TrophyCounts } from './types'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const LS_KEY = 'snake.leaderboard.v2'
const LS_TROPHIES_KEY = 'snake.trophies.v1'

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
    leaderboardTable: env.VITE_LEADERBOARD_TABLE || 'leaderboard',
    scoreHistoryTable: env.VITE_SCORE_HISTORY_TABLE || 'score_history',
    playerTable: env.VITE_PLAYER_TABLE || 'player_registry',
    nameCol: env.VITE_LEADERBOARD_NAME_COLUMN || 'player_name',
    trophiesTable: env.VITE_TROPHIES_TABLE || 'trophies',
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

// Ensure player exists in player_registry; return id
async function ensurePlayerId(name: string): Promise<number | null> {
  const { url, anon, playerTable, nameCol } = envs()
  const client = getClient()
  if (client && url && anon) {
    try {
      const { data: existing } = await client
        .from(playerTable)
        .select('id, ' + nameCol)
        .eq(nameCol, name)
        .maybeSingle()
      if (existing && (existing as unknown as { id?: number }).id != null) {
        return Number((existing as unknown as { id: number }).id)
      }
      const { data: inserted, error } = await client
        .from(playerTable)
        .insert({ [nameCol]: name })
        .select('id')
        .single()
      if (!error && inserted && (inserted as { id?: number }).id != null) {
        return Number((inserted as { id: number }).id)
      }
    } catch {
      /* ignore */
    }
  }
  // REST fallback
  if (url && anon) {
    try {
      const base = `${url}/rest/v1/${playerTable}`
      const sel = `${base}?select=id,${nameCol}&${nameCol}=eq.${encodeURIComponent(name)}`
      const r = await fetch(sel, { headers: sbHeaders(anon) })
      if (r.ok) {
        const rows = (await r.json()) as Array<{ id: number }>
        if (rows.length) return Number(rows[0].id)
      }
      const ins = await fetch(base, {
        method: 'POST',
        headers: sbHeaders(anon),
        body: JSON.stringify({ [nameCol]: name }),
      })
      if (ins.ok) {
        // Fetch back id
        const r2 = await fetch(sel, { headers: sbHeaders(anon) })
        if (r2.ok) {
          const rows = (await r2.json()) as Array<{ id: number }>
          if (rows.length) return Number(rows[0].id)
        }
      }
    } catch {
      /* ignore */
    }
  }
  return null
}

// Insert into score_history and update leaderboard if new high
export async function submitScore(
  entry: LeaderboardEntry & {
    gameMode?: string
    applesEaten?: number
    timeElapsed?: number
  },
): Promise<void> {
  const { url, anon, leaderboardTable, scoreHistoryTable, nameCol } = envs()
  const client = getClient()
  const playerId = await ensurePlayerId(entry.username)
  const payload = {
    player_id: playerId,
    [nameCol]: entry.username,
    score: entry.score,
    game_mode: entry.gameMode || 'survival',
    apples_eaten: entry.applesEaten ?? null,
    time_elapsed: entry.timeElapsed ?? null,
    created_at: entry.date,
  }
  if (client && url && anon) {
    try {
      // 1) Insert history row
      await client.from(scoreHistoryTable).insert(payload)
      // 2) Upsert leaderboard row per player (single best per player and mode)
      const { data: existing } = await client
        .from(leaderboardTable)
        .select('id, score, game_mode, player_id')
        .eq('player_id', playerId)
        .eq('game_mode', payload.game_mode)
        .maybeSingle()
      if (!existing) {
        await client.from(leaderboardTable).insert(payload)
        return
      }
      const cur = existing as { id: number; score: number }
      if (entry.score > (cur.score || 0)) {
        await client
          .from(leaderboardTable)
          .update({
            score: entry.score,
            created_at: entry.date,
            apples_eaten: payload.apples_eaten,
            time_elapsed: payload.time_elapsed,
          })
          .eq('id', cur.id)
      }
      return
    } catch {
      // fall through to REST/local
    }
  }
  if (url && anon) {
    try {
      // 1) history
      await fetch(`${url}/rest/v1/${scoreHistoryTable}`, {
        method: 'POST',
        headers: sbHeaders(anon, { Prefer: 'return=minimal' }),
        body: JSON.stringify(payload),
      })
      // 2) leaderboard upsert
      const sel = `${url}/rest/v1/${leaderboardTable}?select=id,score,player_id,game_mode&player_id=eq.${playerId}&game_mode=eq.${encodeURIComponent(
        payload.game_mode as string,
      )}`
      const r = await fetch(sel, { headers: sbHeaders(anon) })
      let lid: number | null = null
      if (r.ok) {
        const rows = (await r.json()) as Array<{ id: number; score: number }>
        if (rows.length === 0) {
          await fetch(`${url}/rest/v1/${leaderboardTable}`, {
            method: 'POST',
            headers: sbHeaders(anon, { Prefer: 'return=minimal' }),
            body: JSON.stringify(payload),
          })
          return
        } else {
          lid = rows[0].id
          if (entry.score > (rows[0].score || 0)) {
            await fetch(`${url}/rest/v1/${leaderboardTable}?id=eq.${lid}`, {
              method: 'PATCH',
              headers: sbHeaders(anon, { Prefer: 'return=minimal' }),
              body: JSON.stringify({
                score: entry.score,
                created_at: entry.date,
                apples_eaten: payload.apples_eaten,
                time_elapsed: payload.time_elapsed,
              }),
            })
          }
          return
        }
      }
    } catch {
      /* ignore */
    }
  }
  // Fallback: local best-of cache
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
  const { url, anon, leaderboardTable, nameCol } = envs()
  const since = startIsoFor(period)
  if (url && anon) {
    try {
      const select = `id,username:${nameCol},score,created_at`
      const parts = [
        `${url}/rest/v1/${leaderboardTable}?select=${encodeURIComponent(select)}`,
        `order=score.desc,created_at.asc`,
        `limit=${limit}`,
      ]
      if (since) parts.push(`created_at=gte.${encodeURIComponent(since)}`)
      const endpoint = parts[0] + '&' + parts.slice(1).join('&')
      const res = await fetch(endpoint, { headers: sbHeaders(anon) })
      if (res.ok) {
        const rows = (await res.json()) as Array<{
          id: number
          username: string
          score: number
          created_at: string
        }>
        return rows.map((r) => ({
          id: r.id,
          username: r.username,
          score: r.score,
          date: r.created_at,
        }))
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
  const { url, anon, leaderboardTable } = envs()
  const since = startIsoFor(period)
  if (url && anon) {
    try {
      const parts = [
        `${url}/rest/v1/${leaderboardTable}?select=score`,
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
  const { leaderboardTable } = envs()
  if (!client) return null
  const channel = client
    .channel('scores-changes')
    .on('postgres_changes', { event: '*', schema: 'public', table: leaderboardTable }, () =>
      onChange(),
    )
    .subscribe()
  return () => {
    try {
      void client.removeChannel(channel)
    } catch {
      /* noop */
    }
  }
}

// Trophy utilities
// Award a single trophy row to a leaderboard id
export async function awardTrophy(
  leaderboardId: number,
  trophyName: 'gold' | 'silver' | 'bronze',
): Promise<void> {
  const { url, anon, trophiesTable } = envs()
  const client = getClient()
  if (client && url && anon) {
    try {
      await client
        .from(trophiesTable)
        .insert({ leaderboard_id: leaderboardId, trophy_name: trophyName })
      return
    } catch {
      // fallthrough
    }
  }
  if (url && anon) {
    try {
      await fetch(`${url}/rest/v1/${trophiesTable}`, {
        method: 'POST',
        headers: sbHeaders(anon, { Prefer: 'return=minimal' }),
        body: JSON.stringify({ leaderboard_id: leaderboardId, trophy_name: trophyName }),
      })
      return
    } catch {
      /* ignore */
    }
  }
  // local fallback: store counts by leaderboard id
  try {
    const raw = localStorage.getItem(LS_TROPHIES_KEY)
    const map: Record<string, TrophyCounts> = raw ? JSON.parse(raw) : {}
    const key = String(leaderboardId)
    const cur = map[key] || { gold: 0, silver: 0, bronze: 0 }
    cur[trophyName] = (cur[trophyName] || 0) + 1
    map[key] = cur
    localStorage.setItem(LS_TROPHIES_KEY, JSON.stringify(map))
  } catch {
    /* ignore */
  }
}

export async function fetchTrophiesFor(
  leaderboardIds: number[],
): Promise<Record<number, TrophyCounts>> {
  const out: Record<number, TrophyCounts> = {}
  if (!leaderboardIds.length) return out
  const { url, anon, trophiesTable } = envs()
  const client = getClient()
  if (client && url && anon) {
    try {
      const { data } = await client
        .from(trophiesTable)
        .select('leaderboard_id, trophy_name')
        .in('leaderboard_id', leaderboardIds)
      if (Array.isArray(data)) {
        const rows = data as unknown as Array<{ leaderboard_id: number; trophy_name: string }>
        for (const row of rows) {
          const id = Number(row.leaderboard_id)
          const name = String(row.trophy_name || '').toLowerCase()
          const cur = out[id] || { gold: 0, silver: 0, bronze: 0 }
          if (name === 'gold') cur.gold += 1
          else if (name === 'silver') cur.silver += 1
          else if (name === 'bronze') cur.bronze += 1
          out[id] = cur
        }
      }
      return out
    } catch {
      // fallthrough
    }
  }
  if (url && anon) {
    try {
      const q = `leaderboard_id=in.(${leaderboardIds.join(',')})`
      const res = await fetch(
        `${url}/rest/v1/${trophiesTable}?select=leaderboard_id,trophy_name&${q}`,
        {
          headers: sbHeaders(anon),
        },
      )
      if (res.ok) {
        const rows = (await res.json()) as Array<{ leaderboard_id: number; trophy_name: string }>
        for (const row of rows) {
          const id = Number(row.leaderboard_id)
          const name = String(row.trophy_name || '').toLowerCase()
          const cur = out[id] || { gold: 0, silver: 0, bronze: 0 }
          if (name === 'gold') cur.gold += 1
          else if (name === 'silver') cur.silver += 1
          else if (name === 'bronze') cur.bronze += 1
          out[id] = cur
        }
        return out
      }
    } catch {
      /* ignore */
    }
  }
  // local fallback (stored by leaderboard id)
  try {
    const raw = localStorage.getItem(LS_TROPHIES_KEY)
    const map: Record<string, TrophyCounts> = raw ? JSON.parse(raw) : {}
    for (const id of leaderboardIds) {
      const cur = map[String(id)]
      if (cur) out[id] = cur
    }
  } catch {
    /* ignore */
  }
  return out
}

// Resolve or create a leaderboard row id for a given player name and game mode
export async function getLeaderboardIdFor(
  name: string,
  gameMode: string = 'survival',
): Promise<number | null> {
  const { url, anon, leaderboardTable } = envs()
  const client = getClient()
  const playerId = await ensurePlayerId(name)
  if (!playerId) return null
  if (client && url && anon) {
    try {
      const { data: existing } = await client
        .from(leaderboardTable)
        .select('id')
        .eq('player_id', playerId)
        .eq('game_mode', gameMode)
        .maybeSingle()
      if (existing && (existing as { id?: number }).id != null) {
        return Number((existing as { id: number }).id)
      }
      // Insert a placeholder row with score 0 to obtain an id
      const payload = {
        player_id: playerId,
        player_name: name,
        score: 0,
        game_mode: gameMode,
      }
      const { data: inserted } = await client
        .from(leaderboardTable)
        .insert(payload)
        .select('id')
        .single()
      if (inserted && (inserted as { id?: number }).id != null)
        return Number((inserted as { id: number }).id)
    } catch {
      /* ignore */
    }
  }
  if (url && anon) {
    try {
      const sel = `${url}/rest/v1/${leaderboardTable}?select=id&player_id=eq.${playerId}&game_mode=eq.${encodeURIComponent(
        gameMode,
      )}`
      const r = await fetch(sel, { headers: sbHeaders(anon) })
      if (r.ok) {
        const rows = (await r.json()) as Array<{ id: number }>
        if (rows.length) return Number(rows[0].id)
      }
      const ins = await fetch(`${url}/rest/v1/${leaderboardTable}`, {
        method: 'POST',
        headers: sbHeaders(anon),
        body: JSON.stringify({
          player_id: playerId,
          player_name: name,
          score: 0,
          game_mode: gameMode,
        }),
      })
      if (ins.ok) {
        const r2 = await fetch(sel, { headers: sbHeaders(anon) })
        if (r2.ok) {
          const rows = (await r2.json()) as Array<{ id: number }>
          if (rows.length) return Number(rows[0].id)
        }
      }
    } catch {
      /* ignore */
    }
  }
  return null
}
