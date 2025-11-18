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

// Server-authoritative round finalization RPC
export async function finalizeRound(params: {
  roomId: string
  roundId: string
  gameMode?: string
  items: Array<{ id: string; name: string; score: number; finishIdx: number }>
  participants: Array<{ id: string; name: string }>
}): Promise<{
  type: 'results'
  roomId: string
  roundId: string
  total: number
  awarded: true
  items: Array<{ id: string; name: string; score: number; place: number }>
} | null> {
  const { url, anon } = envs()
  const client = getClient()
  const payload = {
    p_room_id: params.roomId,
    p_round_id: params.roundId,
    p_game_mode: params.gameMode || 'survival',
    p_items: params.items,
    p_players: params.participants,
  }
  if (client && url && anon) {
    try {
      const { data, error } = await client.rpc(
        'finalize_round_rpc',
        payload as unknown as {
          p_room_id: string
          p_round_id: string
          p_game_mode: string
          p_items: Array<{ id: string; name: string; score: number; finishIdx: number }>
          p_players: Array<{ id: string; name: string }>
        },
      )
      if (error) throw error
      return data as unknown as {
        type: 'results'
        roomId: string
        roundId: string
        total: number
        awarded: true
        items: Array<{ id: string; name: string; score: number; place: number }>
      }
    } catch {
      // fall through to REST
    }
  }
  if (url && anon) {
    try {
      const res = await fetch(`${url}/rest/v1/rpc/finalize_round_rpc`, {
        method: 'POST',
        headers: sbHeaders(anon),
        body: JSON.stringify(payload),
      })
      if (res.ok) {
        const out = (await res.json()) as {
          type: 'results'
          roomId: string
          roundId: string
          total: number
          awarded: true
          items: Array<{ id: string; name: string; score: number; place: number }>
        }
        return out
      }
    } catch {
      /* ignore */
    }
  }
  return null
}

// Lightweight env status for debug panel
export function supabaseEnvStatus() {
  const { url, anon } = envs()
  return { hasUrl: !!url, hasAnon: !!anon }
}

// Get next sequential player id number (max(id)+1) from player_registry
export async function getNextPlayerIdNumber(): Promise<number | null> {
  const { url, anon, playerTable } = envs()
  const client = getClient()
  if (client && url && anon) {
    try {
      const { data } = await client
        .from(playerTable)
        .select('id')
        .order('id', { ascending: false })
        .limit(1)
      if (Array.isArray(data) && data.length > 0) {
        const maxId = Number((data[0] as { id: number }).id)
        if (Number.isFinite(maxId)) return maxId + 1
      }
      return 1
    } catch {
      /* fallthrough */
    }
  }
  if (url && anon) {
    try {
      const endpoint = `${url}/rest/v1/${playerTable}?select=id&order=id.desc&limit=1`
      const res = await fetch(endpoint, { headers: sbHeaders(anon) })
      if (res.ok) {
        const rows = (await res.json()) as Array<{ id: number }>
        if (rows.length > 0) {
          const maxId = Number(rows[0].id)
          if (Number.isFinite(maxId)) return maxId + 1
        } else {
          return 1
        }
      }
    } catch {
      /* ignore */
    }
  }
  return null
}

// Ensure player exists in player_registry; return id
// Trims name and performs a case-insensitive lookup to avoid duplicates
async function ensurePlayerId(name: string): Promise<number | null> {
  const rawName = (name || '').trim()
  if (!rawName) return null
  const { url, anon, playerTable, nameCol } = envs()
  const client = getClient()
  if (client && url && anon) {
    try {
      // exact match first
      {
        const { data: existing } = await client
          .from(playerTable)
          .select('id, ' + nameCol)
          .eq(nameCol, rawName)
          .maybeSingle()
        if (existing && (existing as unknown as { id?: number }).id != null) {
          return Number((existing as unknown as { id: number }).id)
        }
      }
      // case-insensitive match
      {
        const { data: candidates } = await client
          .from(playerTable)
          .select('id, ' + nameCol)
          .ilike(nameCol, rawName)
        if (Array.isArray(candidates) && candidates.length > 0) {
          const id = (candidates[0] as unknown as { id?: number }).id
          if (id != null) return Number(id)
        }
      }
      const { data: inserted, error } = await client
        .from(playerTable)
        .insert({ [nameCol]: rawName })
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
      // exact
      const sel = `${base}?select=id,${nameCol}&${nameCol}=eq.${encodeURIComponent(rawName)}`
      const r = await fetch(sel, { headers: sbHeaders(anon) })
      if (r.ok) {
        const rows = (await r.json()) as Array<{ id: number }>
        if (rows.length) return Number(rows[0].id)
      }
      // case-insensitive
      const selIlike = `${base}?select=id,${nameCol}&${nameCol}=ilike.${encodeURIComponent(rawName)}`
      const r2 = await fetch(selIlike, { headers: sbHeaders(anon) })
      if (r2.ok) {
        const rows = (await r2.json()) as Array<{ id: number }>
        if (rows.length) return Number(rows[0].id)
      }
      const ins = await fetch(base, {
        method: 'POST',
        headers: sbHeaders(anon),
        body: JSON.stringify({ [nameCol]: rawName }),
      })
      if (ins.ok) {
        // Fetch back id
        const r3 = await fetch(sel, { headers: sbHeaders(anon) })
        if (r3.ok) {
          const rows = (await r3.json()) as Array<{ id: number }>
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
    [nameCol]: (entry.username || '').trim(),
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
            // keep display name in sync (trimmed)
            [nameCol]: payload[nameCol as keyof typeof payload],
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
  const MODE = 'survival'
  if (url && anon) {
    try {
      const select = `id,username:${nameCol},score,created_at`
      const parts = [
        `${url}/rest/v1/${leaderboardTable}?select=${encodeURIComponent(select)}`,
        `order=score.desc,created_at.asc`,
        // over-fetch to allow client-side dedupe by username
        `limit=${Math.max(limit * 5, limit)}`,
        `game_mode=eq.${encodeURIComponent(MODE)}`,
        `score=gt.0`,
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
        // Dedupe by username (case-insensitive), keep highest score first due to ordering
        const seen = new Set<string>()
        const out: LeaderboardEntry[] = []
        for (const r of rows) {
          const key = String(r.username || '')
            .trim()
            .toLowerCase()
          if (seen.has(key)) continue
          seen.add(key)
          out.push({ id: r.id, username: r.username, score: r.score, date: r.created_at })
          if (out.length >= limit) break
        }
        return out
      }
    } catch {
      /* fall through */
    }
  }
  try {
    const raw = localStorage.getItem(LS_KEY)
    const all = raw ? (JSON.parse(raw) as LeaderboardEntry[]) : []
    const filtered = (since ? all.filter((e) => e.date >= since) : all).filter((e) => e.score > 0)
    const seen = new Set<string>()
    const out: LeaderboardEntry[] = []
    for (const r of filtered.sort((a, b) => b.score - a.score)) {
      const key = r.username.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      out.push(r)
      if (out.length >= limit) break
    }
    return out
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
        `game_mode=eq.survival`,
        `score=gt.0`,
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
      // Avoid inserting placeholder rows here; the row should exist after submitScore
      return null
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
      // Don't create placeholder via REST either
    } catch {
      /* ignore */
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Dev-only manual RPC test hook (temporary)
// Attaches window.testFinalizeRound() for manual console invocation.
// Does NOT run automatically or integrate with gameplay.
// Usage (in browser console): await testFinalizeRound()
// Remove after end-to-end verification.
// ---------------------------------------------------------------------------
declare global {
  interface Window {
    testFinalizeRound?: () => Promise<{ data: unknown; error: unknown }>
  }
}

export function registerFinalizeRoundDevTest() {
  try {
    const env = (import.meta as unknown as { env?: Record<string, string> }).env || {}
    const isDev =
      !!env.DEV ||
      !!env.VITE_DEV ||
      (typeof location !== 'undefined' && /localhost|127\.0\.0\.1/.test(location.hostname))
    if (!isDev) return
    if (typeof window === 'undefined') return
    if (window.testFinalizeRound) return // already attached
    const client = getClient()
    window.testFinalizeRound = async () => {
      if (!client) {
        console.warn('[testFinalizeRound] Supabase client unavailable (missing env?)')
      }
      const payload = {
        p_room_id: 'room123',
        p_round_id: 'round1',
        p_game_mode: 'survival',
        p_items: [
          { id: 'p1', name: 'Alice', score: 10, finishIdx: 0 },
          { id: 'p2', name: 'Bob', score: 8, finishIdx: 1 },
        ],
        p_players: [
          { id: 'p1', name: 'Alice' },
          { id: 'p2', name: 'Bob' },
        ],
      }
      try {
        const { data, error } = await (client || getClient())!.rpc('finalize_round_rpc', payload)
        console.log('RPC TEST RESULT →', { data, error })
        return { data, error }
      } catch (e) {
        console.error('[testFinalizeRound] exception', e)
        return { data: null, error: e }
      }
    }
    console.info('[dev] window.testFinalizeRound attached')
  } catch {
    /* ignore */
  }
}

// Auto-register in dev builds (safe: only defines function)
registerFinalizeRoundDevTest()
