import { useEffect } from 'react'

export function useReveal(selector = '.reveal', rerunToken?: unknown) {
  useEffect(() => {
    const prefersReduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (prefersReduced) return

    const els = Array.from(document.querySelectorAll<HTMLElement>(selector))
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add('reveal-in')
            observer.unobserve(entry.target)
          }
        }
      },
      { rootMargin: '0px 0px -10% 0px', threshold: 0.1 },
    )
    // If no elements found, nothing to do
    if (els.length === 0) return () => observer.disconnect()
    els.forEach((el) => observer.observe(el))
    return () => observer.disconnect()
  }, [selector, rerunToken])
}
