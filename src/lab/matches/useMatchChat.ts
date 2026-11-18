import { useCallback, useEffect, useRef, useState } from 'react'
import { cleanLine, mergeLines, type ChatLine } from './chat'
import { readLines, sayLine } from './cloud'

/**
 * A match's chat, by turns (chat.ts has the rules of a line). It reads the lines when the match
 * opens, when the other player's page says it has written one (`reload`, from the nudge), and on
 * the way back to the tab; it never polls on its own, since a chat line is never urgent enough to
 * cost a call every few seconds for every open match.
 *
 * ⚠️ IT IS SHOWN ONLY ONCE IT HAS BEEN READ (`ready`). The chat's SQL is a draft that ships apart
 * from this page, and until it is applied lab_match_lines does not exist: a panel shown regardless
 * would take a line and answer it with PostgREST's "could not find the function". So a match whose
 * chat cannot be read shows none, and one that can shows it from its first answer, empty or not.
 *
 * ⚠️ WHAT IS SHOWN IS WHAT THE SERVER KEPT. A line sent is shown once lab_match_say answers with it,
 * not before, so a refused one (twenty a minute, a declined challenge) is never shown as said.
 */
export function useMatchChat(id: string | null, on: boolean, said: (line: number) => void) {
  const [lines, setLines] = useState<ChatLine[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [ready, setReady] = useState(false)
  const last = useRef(0)
  const gen = useRef(0)

  const reload = useCallback(async () => {
    if (!id || !on) return
    const g = gen.current
    try {
      const more = await readLines(id, last.current)
      if (g !== gen.current) return
      setReady(true)
      if (!more.length) return
      last.current = Math.max(last.current, ...more.map((l) => l.id))
      setLines((held) => mergeLines(held, more))
    } catch {
      /* a look that failed is simply not shown; the next one asks again */
    }
  }, [id, on])

  // a different match, or this one opened: start again from nothing
  useEffect(() => {
    gen.current++
    last.current = 0
    setReady(false)
    setLines([])
    setError(null)
    void reload()
    const look = () => {
      if (document.visibilityState === 'visible') void reload()
    }
    window.addEventListener('focus', look)
    document.addEventListener('visibilitychange', look)
    return () => {
      window.removeEventListener('focus', look)
      document.removeEventListener('visibilitychange', look)
    }
  }, [reload])

  const send = useCallback(
    async (text: string): Promise<boolean> => {
      const t = cleanLine(text)
      if (!id || !t) return false
      const g = gen.current
      setBusy(true)
      setError(null)
      try {
        const l = await sayLine(id, t)
        if (g !== gen.current) return false
        last.current = Math.max(last.current, l.id)
        setLines((held) => mergeLines(held, [l]))
        said(l.id)
        return true
      } catch (e) {
        if (g === gen.current) setError(e instanceof Error ? e.message : 'The line was not sent.')
        return false
      } finally {
        if (g === gen.current) setBusy(false)
      }
    },
    [id, said],
  )

  return { lines, error, busy, ready, send, reload }
}
export type MatchChat = ReturnType<typeof useMatchChat>
