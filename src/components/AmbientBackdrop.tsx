import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

/**
 * Atmosphere: the ground behind the page is alive even when nothing is happening.
 * A few soft colour fields drift slowly, lean toward the cursor, and take their hue
 * from the section you're in — so the Circuit feels green before you've read a word.
 *
 * Battery manners: paints at half frame rate, pauses when the tab is hidden, caps
 * devicePixelRatio, and under prefers-reduced-motion paints ONCE and stops (still
 * coloured, just still). The whole thing is one canvas and three gradients.
 *
 * It portals to <body> at z-index -1: painted above the html ground but beneath every
 * in-flow box, so it can never sit over text. (NOT via a z-lift on #root — a stacking
 * context there flattens the nav's z against the canvas-mode surface and buries the
 * cog's dropdown. Learned the hard way.)
 */

// each section leans its own way; anything unlisted breathes in the theme accent
const SECTION_HUES: Record<string, string[]> = {
  home: ['accent', '#8b5cf6'],
  circuit: ['#22c55e', '#4ade80'],
  investments: ['#38bdf8', '#22c55e'],
  snake: ['#a3e635', '#38bdf8'],
  contact: ['#8b5cf6', '#38bdf8'],
  'account-settings': ['accent', '#38bdf8'],
  admin: ['accent', '#f59e0b'],
  signin: ['accent', '#8b5cf6'],
}

type RGB = { r: number; g: number; b: number }

function parseColor(c: string): RGB {
  const h = c.trim().replace('#', '')
  if (/^[0-9a-f]{3}$/i.test(h)) {
    const n = parseInt(
      h
        .split('')
        .map((x) => x + x)
        .join(''),
      16,
    )
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
  }
  if (/^[0-9a-f]{6}$/i.test(h)) {
    const n = parseInt(h, 16)
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
  }
  const m = c.match(/[\d.]+/g)
  if (m && m.length >= 3) return { r: +m[0], g: +m[1], b: +m[2] }
  return { r: 124, g: 106, b: 247 }
}

const lum = (c: RGB) => (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255

export function AmbientBackdrop({
  section,
  theme,
  enabled,
}: {
  section: string
  theme: string
  enabled: boolean
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const sectionRef = useRef(section)
  sectionRef.current = section
  // under reduced motion there's no loop to drift the hue, so a section change repaints
  // the still frame directly
  const repaintStill = useRef<(() => void) | null>(null)
  useEffect(() => {
    repaintStill.current?.()
  }, [section])

  useEffect(() => {
    if (!enabled) return
    const cv = canvasRef.current
    const ctx = cv?.getContext('2d')
    if (!cv || !ctx) return

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let raf = 0
    let frame = 0
    let running = true
    // pointer lean + hue cross-fade both ease toward their targets — nothing jumps
    let mx = 0.5
    let my = 0.5
    let sx = 0.5
    let sy = 0.5
    let cur: RGB[] | null = null

    const dpr = Math.min(1.5, window.devicePixelRatio || 1)
    const size = () => {
      cv.width = Math.max(1, Math.floor(innerWidth * dpr))
      cv.height = Math.max(1, Math.floor(innerHeight * dpr))
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    }
    size()

    const css = (v: string) => getComputedStyle(document.documentElement).getPropertyValue(v).trim()
    const targets = (): RGB[] => {
      const hues = SECTION_HUES[sectionRef.current] ?? ['accent', 'accent']
      return hues.map((h) => parseColor(h === 'accent' ? css('--accent') || '#7c6af7' : h))
    }
    // light grounds need quieter colour than dark ones. Deliberately faint — Evan's read
    // on the first cut was "overbearing": ambience should be noticed on the second look,
    // not the first.
    const baseAlpha = () => (lum(parseColor(css('--bg') || '#08080f')) > 0.5 ? 0.045 : 0.08)

    const paint = () => {
      const w = innerWidth
      const h = innerHeight
      ctx.clearRect(0, 0, w, h)
      const tgt = targets()
      if (!cur) cur = tgt.map((c) => ({ ...c }))
      cur.forEach((c, i) => {
        c.r += (tgt[i].r - c.r) * 0.04
        c.g += (tgt[i].g - c.g) * 0.04
        c.b += (tgt[i].b - c.b) * 0.04
      })
      sx += (mx - sx) * 0.05
      sy += (my - sy) * 0.05
      // Two composed fields, not three overlapping ones — anchored to opposite corners
      // so the middle of the page (where the content lives) stays clean. Slow drift,
      // gentle lean: a breath, not a lava lamp.
      const t = frame * 0.0022
      const a = baseAlpha()
      const fields = [
        {
          c: cur[0],
          x: 0.14 + Math.sin(t) * 0.025 + (sx - 0.5) * 0.05,
          y: 0.08 + Math.cos(t * 0.8) * 0.02 + (sy - 0.5) * 0.04,
          r: 0.42,
          k: 1,
        },
        {
          c: cur[1],
          x: 0.88 + Math.cos(t * 0.7) * 0.03 + (sx - 0.5) * 0.06,
          y: 0.92 + Math.sin(t * 0.9) * 0.02 + (sy - 0.5) * 0.05,
          r: 0.38,
          k: 0.75,
        },
      ]
      for (const f of fields) {
        const g = ctx.createRadialGradient(
          f.x * w,
          f.y * h,
          0,
          f.x * w,
          f.y * h,
          f.r * Math.max(w, h),
        )
        g.addColorStop(0, `rgba(${f.c.r | 0}, ${f.c.g | 0}, ${f.c.b | 0}, ${a * f.k})`)
        g.addColorStop(1, `rgba(${f.c.r | 0}, ${f.c.g | 0}, ${f.c.b | 0}, 0)`)
        ctx.fillStyle = g
        ctx.fillRect(0, 0, w, h)
      }
    }

    const loop = () => {
      if (!running) return
      frame++
      // half rate — ambience doesn't need 60fps, and the battery notices
      if (frame % 2 === 0 && !document.hidden) paint()
      raf = requestAnimationFrame(loop)
    }

    const onMove = (e: PointerEvent) => {
      mx = e.clientX / innerWidth
      my = e.clientY / innerHeight
    }
    const onResize = () => {
      size()
      if (reduced) paint()
    }
    window.addEventListener('resize', onResize)

    if (reduced) {
      // still coloured, just still: one paint, no loop, no cursor tracking
      cur = null // snap straight to the section hue instead of easing
      paint()
      repaintStill.current = () => {
        cur = null
        paint()
      }
    } else {
      window.addEventListener('pointermove', onMove, { passive: true })
      raf = requestAnimationFrame(loop)
    }

    return () => {
      running = false
      cancelAnimationFrame(raf)
      repaintStill.current = null
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('resize', onResize)
    }
    // theme in deps: the CSS vars it reads change with the theme, and reduced-motion's
    // single paint would otherwise keep the old ground
  }, [enabled, theme])

  if (!enabled || typeof document === 'undefined') return null
  return createPortal(
    <canvas
      ref={canvasRef}
      aria-hidden
      style={{ position: 'fixed', inset: 0, zIndex: -1, pointerEvents: 'none' }}
    />,
    document.body,
  )
}
