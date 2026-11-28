/**
 * The automatic PlayerN handle, decided where a test can ask about it.
 *
 * ⚠️ A FAILED READ IS NOT AN EMPTY REGISTRY. supabase-js does not throw when a request fails: a
 * dropped connection, a 5xx or a refusal all resolve `{ data: null, error }`. This used to read
 * that `null` as "nobody has registered yet" and answer 1, and the mount effect in manager.tsx
 * then renamed an automatic player to "Player1" — a handle somebody already has — and wrote it
 * to this browser. A run posted under it landed on that person's row or was refused as claimed.
 * Now a read that did not answer gives null, and null keeps the name there is: the next mount
 * asks again.
 */

/** The next PlayerN number from a `player_registry` read of the highest id, or null if unknown. */
export function nextIdFrom(data: unknown, error: unknown): number | null {
  if (error) return null
  if (!Array.isArray(data)) return null
  /* a list that came back empty is a real answer: nobody has registered yet */
  if (data.length === 0) return 1
  const maxId = Number((data[0] as { id?: unknown } | null)?.id)
  return Number.isFinite(maxId) ? maxId + 1 : null
}

/**
 * The name to switch to on mount, or null to keep the one there is.
 *
 * Only an automatic name moves — empty, or still a PlayerN placeholder — and only when the read
 * actually answered. A player the old bug named "Player1" still reads as automatic, so the next
 * read that works moves them off it.
 */
export function autoPlayerName(
  current: string,
  source: 'auto' | 'custom',
  nextNum: number | null,
): string | null {
  if (source === 'custom') return null
  if (!nextNum) return null
  const proposed = `Player${nextNum}`
  const cur = (current || '').trim()
  if (!cur || /^Player[0-9A-Za-z]+$/.test(cur)) return proposed
  return null
}
