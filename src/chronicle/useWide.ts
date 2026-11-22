import { useEffect, useState } from 'react'

/**
 * The width from which Chronicle has room for its side rail — the same 900px as `.chron-body`'s
 * two-column rule in index.css, which says why it is not the page's own 700px.
 */
export const WIDE = '(min-width: 900px)'

/**
 * Whether the room is at that width now, following the window as it changes.
 *
 * ⚠️ A HOOK RATHER THAN A CSS RULE, because the two layouts are not the same elements styled two
 * ways. Under 900px the day's summary is a fold at the top of the Day half; from 900px it is the
 * side rail it always was. Drawing both and hiding one with CSS would fetch the day's totals twice
 * on every load and keep two copies of the rail's state that could disagree — so the room asks
 * once and draws one.
 */
export function useWide(): boolean {
  const [wide, setWide] = useState(
    () => typeof window !== 'undefined' && !!window.matchMedia?.(WIDE).matches,
  )
  useEffect(() => {
    const mq = window.matchMedia?.(WIDE)
    if (!mq) return
    const on = () => setWide(mq.matches)
    on()
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return wide
}
