import { useEffect } from 'react'
import { motionReduced } from '../ui/motion'

/**
 * Fade-in-on-scroll for anything tagged `.reveal`.
 *
 * The class is added imperatively rather than through React state because the elements belong to
 * a dozen unrelated sections. That's fine, but it makes this hook responsible for two things a
 * one-shot `querySelectorAll` gets wrong — both of which shipped as "the page is blank":
 *
 * 1. **Sections are lazy-loaded.** On a direct `#circuit` load the effect runs before the chunk
 *    resolves, so the query matches nothing; the section then mounts at `opacity: 0` with nobody
 *    left to reveal it. (The old code made this worse by returning early on an empty match, which
 *    skipped its own safety timer.)
 * 2. **React owns the `class` attribute.** When a component's className string changes — e.g.
 *    the Circuit's `cz-tab-${tab}` on every sub-tab click — React writes the whole attribute and
 *    silently drops the `reveal-in` we added, fading the section back out for good.
 *
 * A MutationObserver covers both at the root, which the previous `rerunToken` could not: a token
 * only re-runs on signals the caller already knows about, and neither "a chunk finished loading"
 * nor "React rewrote a class" is one of those.
 */
export function useReveal(selector = '.reveal', rerunToken?: unknown) {
  useEffect(() => {
    const prefersReduced = motionReduced()
    // no animation to stage: show everything the moment we see it
    const showAll = prefersReduced || typeof IntersectionObserver === 'undefined'

    // elements we've already revealed, so a class rewrite can be told apart from an element
    // that's legitimately still waiting to scroll into view
    const revealed = new WeakSet<Element>()
    const show = (el: Element) => {
      revealed.add(el)
      el.classList.add('reveal-in')
    }

    const observer = showAll
      ? null
      : new IntersectionObserver(
          (entries) => {
            for (const entry of entries) {
              if (entry.isIntersecting) {
                show(entry.target)
                observer?.unobserve(entry.target)
              }
            }
          },
          // Be permissive to avoid zoom/threshold issues
          { rootMargin: '0px', threshold: 0 },
        )

    // Any pixel visible horizontally and vertically
    const inView = (el: HTMLElement) => {
      const r = el.getBoundingClientRect()
      const vw = window.innerWidth || document.documentElement.clientWidth
      const vh = window.innerHeight || document.documentElement.clientHeight
      return r.bottom > 0 && r.right > 0 && r.top < vh && r.left < vw
    }

    const take = (el: HTMLElement) => {
      if (el.classList.contains('reveal-in')) return
      if (showAll || inView(el)) show(el)
      else observer?.observe(el)
    }

    const scan = () => document.querySelectorAll<HTMLElement>(selector).forEach(take)
    scan()

    const mo = new MutationObserver((records) => {
      for (const r of records) {
        if (r.type === 'attributes') {
          const el = r.target as HTMLElement
          // Put it straight back. This runs as a microtask, before the next style recalc, so
          // the element never actually paints at opacity 0 and nothing flickers.
          if (revealed.has(el) && !el.classList.contains('reveal-in')) el.classList.add('reveal-in')
          continue
        }
        for (const n of r.addedNodes) {
          if (!(n instanceof HTMLElement)) continue
          if (n.matches(selector)) take(n)
          n.querySelectorAll<HTMLElement>(selector).forEach(take)
        }
      }
    })
    mo.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class'],
    })

    // Safety: anything still hidden after a beat (exotic zoom/layout) gets shown regardless.
    // Re-queries rather than reusing the first scan's list, so it also catches whatever
    // arrived in between.
    const timer = window.setTimeout(() => {
      document.querySelectorAll<HTMLElement>(selector).forEach((el) => {
        if (!el.classList.contains('reveal-in')) show(el)
      })
    }, 1200)

    return () => {
      mo.disconnect()
      observer?.disconnect()
      window.clearTimeout(timer)
    }
  }, [selector, rerunToken])
}
