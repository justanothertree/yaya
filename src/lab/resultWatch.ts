import { RESULT_EVENT } from '../gpu/kept'
import type { Card } from './recorded'

type Target = Pick<EventTarget, 'addEventListener' | 'removeEventListener'>

/**
 * Keep a toy's result card current while the page is open, on events and nothing else: this tab's
 * own writes announce themselves as `lab:result` (writeKept in gpu/kept.ts), and another tab's
 * arrive as the browser's `storage` event. Either one re-reads through the toy's own reader, and
 * `onChange` hears only a card that is different from the last.
 *
 * `fresh` is true for a card that differs from the one there when watching began: a result made
 * during this visit, which is the moment somebody wants to share it.
 *
 * It replaced a 1.5 s poll, which re-read every open toy's storage forty times a minute for a
 * button that changes once a game.
 */
export function watchResult(
  read: () => Card | null,
  onChange: (card: Card | null, fresh: boolean) => void,
  target: Target = window,
): () => void {
  const first = read()?.line ?? null
  let last = first
  const check = () => {
    const now = read()
    const line = now?.line ?? null
    if (line === last) return
    last = line
    onChange(now, line !== null && line !== first)
  }
  target.addEventListener(RESULT_EVENT, check)
  target.addEventListener('storage', check)
  return () => {
    target.removeEventListener(RESULT_EVENT, check)
    target.removeEventListener('storage', check)
  }
}
