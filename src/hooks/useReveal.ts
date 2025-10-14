import { useEffect } from 'react'

export function useReveal(selector = '.reveal', rerunToken?: unknown) {
  useEffect(() => {
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const els = Array.from(document.querySelectorAll<HTMLElement>(selector))

    // If reduced motion is preferred, show everything immediately
    if (prefersReduced) {
      els.forEach((el) => el.classList.add('reveal-in'))
      return
    }

    // Fallback when IntersectionObserver is unavailable
    if (typeof IntersectionObserver === 'undefined') {
      els.forEach((el) => el.classList.add('reveal-in'))
      return
    }

    // Helper to check if element is currently in view
    const inView = (el: HTMLElement) => {
      const r = el.getBoundingClientRect()
      const vw = window.innerWidth || document.documentElement.clientWidth
      const vh = window.innerHeight || document.documentElement.clientHeight
      // Any pixel visible horizontally and vertically
      return r.bottom > 0 && r.right > 0 && r.top < vh && r.left < vw
    }

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add('reveal-in')
            observer.unobserve(entry.target)
          }
        }
      },
      // Be permissive to avoid zoom/threshold issues
      { rootMargin: '0px', threshold: 0 },
    )

    // If no elements found, nothing to do
    if (els.length === 0) return () => observer.disconnect()

    // Immediately reveal those already in view, observe the rest
    els.forEach((el) => {
      if (inView(el)) el.classList.add('reveal-in')
      else observer.observe(el)
    })

    // Safety: if any still hidden after a short delay (e.g., exotic zoom/layout), reveal them
    const timer = window.setTimeout(() => {
      els.forEach((el) => {
        if (!el.classList.contains('reveal-in')) el.classList.add('reveal-in')
      })
    }, 1200)

    return () => {
      observer.disconnect()
      window.clearTimeout(timer)
    }
  }, [selector, rerunToken])
}
