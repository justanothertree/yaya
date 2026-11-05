import { useSyncExternalStore } from 'react'

/**
 * A media query a component can ask, and be told when the answer changes.
 *
 * ⚠️ LIVE, NOT READ ONCE — the same reason `pointerKind.ts` gives next door. A phone turns
 * sideways, a desktop window is dragged narrow, a tablet gains a keyboard case: the layout
 * follows, because CSS is live, and a component that read `innerWidth` at mount would be the
 * only thing on the page still answering yesterday's question. The instrument has to agree with
 * the stylesheet about what a phone is, so it must change its mind at the same moment.
 *
 * ⚠️ AND THE SERVER SNAPSHOT IS `false`. There is no `matchMedia` in node or during a test, and
 * false means "the ordinary layout" — a desktop with a pointer, which is both the safer guess
 * and the one that degrades into a longer keyboard rather than a shorter one.
 */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (fn) => {
      const mq = window.matchMedia?.(query)
      if (!mq) return () => {}
      mq.addEventListener('change', fn)
      return () => mq.removeEventListener('change', fn)
    },
    () => !!window.matchMedia?.(query).matches,
    () => false,
  )
}
