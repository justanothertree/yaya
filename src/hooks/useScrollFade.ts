import { useEffect, useRef } from 'react'

/**
 * Marks a horizontal strip as "nothing more to reach" so CSS can fade its trailing edge
 * only while swiping still gets you somewhere. Without this the fade is a lie: it would
 * dim the last tab on a strip that already fits, which reads as clipping rather than
 * as an invitation to scroll.
 */
export function useScrollFade<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const update = () => {
      const scrollable = el.scrollWidth > el.clientWidth + 1
      const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 1
      el.classList.toggle('cz-scroll-end', !scrollable || atEnd)
    }
    // Re-measure on the next frame AND once more shortly after. On a viewport change the
    // first measurement can land before layout has settled, reading the previous width —
    // which left the "nothing more to reach" flag stuck and the fade wrong (missing on a
    // narrow phone, lingering on a wide one). The late tick is what actually settles it.
    let t = 0
    const schedule = () => {
      requestAnimationFrame(update)
      clearTimeout(t)
      t = window.setTimeout(update, 150)
    }
    schedule()
    el.addEventListener('scroll', update, { passive: true })
    // window resize as well as element resize — the strip's own box can settle a frame
    // later than the viewport it's reacting to
    window.addEventListener('resize', schedule)
    const ro = new ResizeObserver(schedule)
    ro.observe(el)
    return () => {
      clearTimeout(t)
      el.removeEventListener('scroll', update)
      window.removeEventListener('resize', schedule)
      ro.disconnect()
    }
  }, [])
  return ref
}
