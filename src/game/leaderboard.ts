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
  _client = createClient(url, anon, { auth: { persistSession: false, storageKey: 'sb-snake' } })
  return _client
}

export type LeaderboardPeriod = 'all' | 'month' | 'today'

function startIsoFor(period: LeaderboardPeriod): string | null {
  if (period === 'all') return null
  // LOCAL midnight, not UTC. Building this from Date.UTC meant "Today" began at 00:00 UTC —
  // which is 7pm the previous day in US Central — so games played this morning dropped out of
  // "Today" as soon as UTC rolled over, and the tab looked empty even though you'd just played.
  const now = new Date()
  const start =
    period === 'today'
      ? new Date(now.getFullYear(), now.getMonth(), now.getDate())
      : new Date(now.getFullYear(), now.getMonth(), 1)
  return start.toISOString()
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

// Insert into score_history and update leaderboard if new high
/**
 * Which board a run belongs on.
 *
 * `game_mode` has been in the schema from the start and every write hardcoded 'survival' —
 * because when the board was built, survival was the only mode there was, and the column existed
 * precisely so future modes wouldn't be compared against it. Now that they exist, race and tron
 * and hungry runs were all landing on the classic board, where a race score (everyone stops the
 * moment somebody hits the target) sits next to a survival run that ended when the player did.
 * Not comparable, which is the whole reason for the column.
 *
 * Only MODE-defining settings are in the key. Apples, speed and edges deliberately are not: a key
 * per combination would shatter one board into dozens with a single entry each, and the original
 * survival board already mixed those.
 */
export type BoardMode = 'survival' | 'race' | 'tron'

/**
 * The boards actually offered, in order.
 *
 * ⚠️ 'tron' is a valid BoardMode and deliberately NOT here. Tron was removed from the game after
 * playtesting — the settings panel now actively sends `tron: false` — so a Tron tab could only
 * ever be an empty board inviting a click. modeKeyFor still maps it, so a round from a room left
 * on the old setting is recorded honestly rather than mislabelled as survival; there is simply
 * no tab for it, and there is no such data.
 */
export const BOARD_MODES: readonly BoardMode[] = ['survival', 'race'] as const

export const BOARD_LABELS: Record<BoardMode, string> = {
  survival: 'Survival',
  race: 'Race',
  tron: 'Tron',
}

export function modeKeyFor(settings?: { race?: boolean; tron?: boolean }): BoardMode {
  if (!settings) return 'survival'
  // tron before race: a tron round can have race scoring on top, but the trails are what
  // decides how it is played and therefore which board it belongs on
  if (settings.tron) return 'tron'
  if (settings.race) return 'race'
  return 'survival'
}

/**
 * What became of a submitted score.
 *
 * `claimed` is the one that needs saying out loud: the name belongs to a member, and only they
 * can post under it. Signed-out play on an unclaimed name still saves normally.
 */
export type SubmitResult = 'saved' | 'claimed' | 'local'

export async function submitScore(
  entry: LeaderboardEntry & {
    gameMode?: string
    applesEaten?: number
    timeElapsed?: number
  },
): Promise<SubmitResult> {
  const { url, anon } = envs()
  const client = getClient()
  const name = (entry.username || '').trim()
  // Server-authoritative: every score goes through the submit_score RPC (direct table writes are
  // locked down). It finds-or-creates the player, records history, and keeps only each player's
  // best — so no one can tamper with or clear the board through the REST API.
  //
  // ⚠️ The RPC REFUSES BY RETURNING NULL, not by raising — a claimed handle is only writable by
  // the member who claimed it. So `!error` is not success: checking only the error meant a
  // refused score looked saved and then quietly wasn't there.
  const params = {
    p_name: name,
    p_score: entry.score,
    p_game_mode: entry.gameMode || 'survival',
    p_apples: entry.applesEaten ?? null,
    p_time: entry.timeElapsed ?? null,
    p_created_at: entry.date,
  }
  if (name && client && url && anon) {
    try {
      const { data, error } = await client.rpc('submit_score', params)
      if (!error && data != null) return 'saved'
      if (!error) return 'claimed'
    } catch {
      // fall through to REST / local
    }
  }
  if (name && url && anon) {
    try {
      const res = await fetch(`${url}/rest/v1/rpc/submit_score`, {
        method: 'POST',
        headers: sbHeaders(anon),
        body: JSON.stringify(params),
      })
      if (res.ok) {
        const body = (await res.text()).trim()
        // same contract over REST: a bare `null` body is a refusal, not a save
        if (body && body !== 'null') return 'saved'
        return 'claimed'
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
  return 'local'
}

export async function fetchLeaderboard(
  period: LeaderboardPeriod = 'all',
  limit = 15,
  mode: BoardMode = 'survival',
): Promise<LeaderboardEntry[]> {
  const { url, anon, leaderboardTable, nameCol } = envs()
  const since = startIsoFor(period)
  const MODE = mode
  // NOTE: the board deliberately shows the TYPED handle, not the member's real name.
  // Snake is public — anyone, including strangers, can read it — and Evan's rule is that
  // friends' identities are not on display there. A friends-only "handle (Name)" variant is
  // wanted, but it must be built so a non-friend can never resolve a handle to a person.
  //
  // This also must keep returning the real leaderboard row id: fetchTrophiesFor() keys
  // trophies by it, so substituting an index silently emptied everyone's trophy case.
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

/**
 * Every run by one player, newest first — deliberately NOT de-duplicated.
 * The Top 15 keeps one row per player, which meant your own history was unreachable: below
 * rank 15 you vanished, and beating your second-best showed nothing.
 */
/**
 * Typed handle -> the friend behind it, so the board can read "handle (Name)".
 * Only ever returns your own handles and your friends'; a signed-out visitor gets nothing at
 * all (the RPC is not granted to anon), so the public board can't resolve anyone.
 */
export async function fetchFriendNames(): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  const { url, anon } = envs()
  if (!url || !anon) return out
  try {
    // the APP's client, not this module's: getClient() runs with persistSession:false and its
    // own storage key, so it carries no session — auth.uid() would be null and a friends-only
    // lookup would correctly return nothing.
    const { getSupabaseClient } = await import('../finance/client')
    const { data, error } = await getSupabaseClient().rpc('snake_friend_names')
    if (error || !data) return out
    for (const r of data as Array<{ player_name: string; member_name: string }>) {
      if (r.player_name && r.member_name) out[r.player_name.toLowerCase()] = r.member_name
    }
  } catch {
    /* signed out or unavailable — the board simply shows handles */
  }
  return out
}

export async function fetchMyScores(
  name: string,
  limit = 50,
  mode: BoardMode = 'survival',
): Promise<LeaderboardEntry[]> {
  const nm = (name || '').trim()
  if (!nm) return []
  // score_history, NOT the leaderboard table: `leaderboard` holds one best row per player,
  // which is exactly why your own history was invisible. Every run lives in score_history.
  const { url, anon, scoreHistoryTable, nameCol } = envs()
  const MODE = mode
  if (url && anon) {
    try {
      const select = `id,username:${nameCol},score,created_at`
      const endpoint =
        `${url}/rest/v1/${scoreHistoryTable}?select=${encodeURIComponent(select)}` +
        `&order=created_at.desc&limit=${Math.max(1, Math.min(limit, 200))}` +
        `&game_mode=eq.${encodeURIComponent(MODE)}&score=gt.0` +
        `&${nameCol}=ilike.${encodeURIComponent(nm)}`
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
      /* fall through to local */
    }
  }
  try {
    const raw = localStorage.getItem(LS_KEY)
    const all = raw ? (JSON.parse(raw) as LeaderboardEntry[]) : []
    return all
      .filter((e) => e.score > 0 && e.username.toLowerCase() === nm.toLowerCase())
      .sort((a, b) => (a.date < b.date ? 1 : -1))
      .slice(0, limit)
  } catch {
    return []
  }
}

/**
 * Your best in a period plus where it actually sits. The board only shows 15 rows, so below
 * that you had no idea whether you ranked 16th or 200th — this makes your standing visible
 * without pretending you're on the podium.
 */
export async function fetchMyBestAndRank(
  name: string,
  period: LeaderboardPeriod = 'all',
  mode: BoardMode = 'survival',
): Promise<{ best: number; rank: number } | null> {
  const nm = (name || '').trim()
  if (!nm) return null
  const { url, anon, scoreHistoryTable, nameCol } = envs()
  const since = startIsoFor(period)
  const MODE = mode
  if (!url || !anon) return null
  try {
    const parts = [
      `${url}/rest/v1/${scoreHistoryTable}?select=score`,
      `order=score.desc`,
      `limit=1`,
      `game_mode=eq.${encodeURIComponent(MODE)}`,
      `score=gt.0`,
      `${nameCol}=ilike.${encodeURIComponent(nm)}`,
    ]
    if (since) parts.push(`created_at=gte.${encodeURIComponent(since)}`)
    const res = await fetch(parts[0] + '&' + parts.slice(1).join('&'), { headers: sbHeaders(anon) })
    if (!res.ok) return null
    const rows = (await res.json()) as Array<{ score: number }>
    const best = rows[0]?.score
    if (!best) return null
    const rank = await fetchRankForScore(best, period)
    return rank == null ? null : { best, rank }
  } catch {
    return null
  }
}

export async function fetchRankForScore(
  score: number,
  period: LeaderboardPeriod = 'all',
  mode: BoardMode = 'survival',
): Promise<number | null> {
  const { url, anon, leaderboardTable } = envs()
  const since = startIsoFor(period)
  if (url && anon) {
    try {
      const parts = [
        `${url}/rest/v1/${leaderboardTable}?select=score`,
        `score=gt.${encodeURIComponent(String(score))}`,
        `game_mode=eq.${encodeURIComponent(mode)}`,
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
    // private, but readable by `anon` — the public leaderboard live-updates for signed-out
    // visitors, and that has to keep working once public channels are switched off project-wide
    .channel('scores-changes', { config: { private: true } })
    .on('postgres_changes', { event: '*', schema: 'public', table: leaderboardTable }, () =>
      onChange(),
    )
    .subscribe((status, err) => {
      if (status !== 'SUBSCRIBED' && status !== 'CLOSED')
        console.warn(
          `[realtime] scores-changes: ${status}${err ? ` — ${err.message}` : ''} (not live)`,
        )
    })
  return () => {
    try {
      void client.removeChannel(channel)
    } catch {
      /* noop */
    }
  }
}

/**
 * Your gold/silver/bronze on one board.
 *
 * ⚠️ Trophies hang off the LEADERBOARD row, which is one per player per mode — not off
 * individual runs. So "My runs" cannot show a trophy beside a given run, because that
 * relationship does not exist in the data; what it can honestly show is the tally for the board
 * you are looking at, which is what a trophy actually is.
 *
 * player_name is compared with eq: the column is case-insensitively collated, so a handle typed
 * in any case still finds its row.
 */
export async function fetchMyTrophies(name: string, mode: BoardMode): Promise<TrophyCounts | null> {
  const nm = (name || '').trim()
  if (!nm) return null
  const { url, anon, leaderboardTable } = envs()
  if (!url || !anon) return null
  try {
    const res = await fetch(
      `${url}/rest/v1/${leaderboardTable}?select=id` +
        `&player_name=eq.${encodeURIComponent(nm)}` +
        `&game_mode=eq.${encodeURIComponent(mode)}&limit=1`,
      { headers: sbHeaders(anon) },
    )
    if (!res.ok) return null
    const rows = (await res.json()) as Array<{ id: number }>
    if (!rows.length) return null
    const counts = await fetchTrophiesFor([rows[0].id])
    return counts[rows[0].id] || { gold: 0, silver: 0, bronze: 0 }
  } catch {
    return null
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

function registerFinalizeRoundDevTest() {
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
if (import.meta.env.DEV) {
  registerFinalizeRoundDevTest()
}
