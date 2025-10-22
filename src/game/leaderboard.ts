import type { LeaderboardEntry } from './types'

const LS_KEY = 'snake.leaderboard.v2'

export async function submitScore(entry: LeaderboardEntry): Promise<void> {
  const env = (import.meta as unknown as { env?: Record<string, string> }).env
  const url = env?.VITE_LEADERBOARD_URL
  if (url) {
    try {
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(entry),
      })
      return
    } catch {
      // fall through to local storage backup
    }
  }
  // Fallback: local persisted leaderboard (top 10)
  try {
    const raw = localStorage.getItem(LS_KEY)
    const arr: LeaderboardEntry[] = raw ? JSON.parse(raw) : []
    arr.push(entry)
    arr.sort((a, b) => b.score - a.score)
    localStorage.setItem(LS_KEY, JSON.stringify(arr.slice(0, 10)))
  } catch {
    /* ignore */
  }
}

export async function fetchLeaderboard(): Promise<LeaderboardEntry[]> {
  const env = (import.meta as unknown as { env?: Record<string, string> }).env
  const url = env?.VITE_LEADERBOARD_URL
  if (url) {
    try {
      const res = await fetch(url)
      if (res.ok) return (await res.json()) as LeaderboardEntry[]
    } catch {
      // fall through to local backup
    }
  }
  try {
    const raw = localStorage.getItem(LS_KEY)
    return raw ? (JSON.parse(raw) as LeaderboardEntry[]) : []
  } catch {
    return []
  }
}
