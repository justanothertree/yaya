import { useEffect, useRef, useState } from 'react'

/**
 * What joined a set since last time — the ids a moment of feedback is about.
 *
 * ⚠️ NOTHING ON THE FIRST LOOK. `prev` is null until the set has been seen once, so a page that
 * loads with three goals already done does not celebrate three goals; only the one finished while
 * you watch does. Ids that left are not news either.
 */
export function added(prev: ReadonlySet<string> | null, next: Iterable<string>): string[] {
  if (!prev) return []
  const out: string[] = []
  for (const id of next) if (!prev.has(id)) out.push(id)
  return out
}

/**
 * The ids that have just joined `ids`, for `ms` milliseconds, then none.
 *
 * ⚠️ `view` STARTS IT AGAIN. Changing what is on screen — another day, another horizon of goals —
 * swaps the whole set, and every id in the new one would otherwise count as just arrived. So a new
 * view is a first look, the same as a first render.
 *
 * ⚠️ AND THE TIMER IS ITS OWN, NOT AN EFFECT'S CLEANUP. An effect that returned its clearTimeout
 * would have it cancelled by the next change to `ids`, leaving the last ids marked for good.
 */
export function useFresh(
  ids: readonly string[],
  view: string,
  onFresh?: (got: string[]) => void,
  ms = 900,
): ReadonlySet<string> {
  const seen = useRef<{ view: string; ids: ReadonlySet<string> } | null>(null)
  const timer = useRef(0)
  const [fresh, setFresh] = useState<ReadonlySet<string>>(() => new Set())
  const sig = ids.join('\u0000')
  useEffect(() => {
    const was = seen.current
    const now = new Set(ids)
    seen.current = { view, ids: now }
    const got = was && was.view === view ? added(was.ids, now) : []
    if (!got.length) return
    setFresh(new Set(got))
    onFresh?.(got)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setFresh(new Set()), ms)
    /* eslint-disable-next-line react-hooks/exhaustive-deps */
  }, [sig, view])
  useEffect(() => () => window.clearTimeout(timer.current), [])
  return fresh
}
