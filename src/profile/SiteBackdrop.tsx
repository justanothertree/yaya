import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { makeEffect, type BackdropId, type Paint } from './backdrops'
import { motionReduced, onMotionChange } from '../ui/motion'

/**
 * The canvas a profile backdrop is drawn on, and the rules that keep it cheap.
 *
 * ⚠️ EVERY GUARD HERE IS THE POINT. The effects themselves are a few dozen arcs a frame; what
 * turns a backdrop into a laptop fan is running it when nobody is looking, painting it at a
 * phone's 3x pixel ratio, or leaving it going after someone asked the site to stop moving.
 *
 *   - reduced motion: the canvas is never created. Not paused — absent. Someone who asked for
 *     stillness should not have a canvas element allocated on their behalf.
 *   - hidden tab: visibilitychange stops the loop. A background tab painting 60fps is the single
 *     most common way this kind of thing wastes a battery.
 *   - scrolled out of view: an IntersectionObserver stops it too, which matters most in canvas
 *     mode where a profile window can sit behind another one.
 *   - devicePixelRatio capped at 2, because a soft translucent backdrop gains nothing from 3x and
 *     pays for it in fill rate — the one number most likely to make a phone struggle.
 *   - dt clamped: a tab resumed after a minute must not advance the simulation by a minute in one
 *     frame, which teleports every particle and looks like a glitch.
 *   - pointer only on a fine pointer. There is no hovering cursor on a phone, so the interactive
 *     half is a desktop thing by nature rather than something withheld.
 */
export function SiteBackdrop({ id }: { id: BackdropId }) {
  const ref = useRef<HTMLCanvasElement | null>(null)
  const holder = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (id === 'none' || id === 'glow') return
    if (motionReduced()) return
    const host = holder.current
    const cv = ref.current
    if (!host || !cv) return
    const ctx = cv.getContext('2d')
    if (!ctx) return

    const coarse = window.matchMedia?.('(hover: none) and (pointer: coarse)').matches ?? false
    const effect = makeEffect(id)
    if (!effect) return

    let w = 0
    let h = 0
    let raf = 0
    let last = performance.now()
    let t = 0
    let visible = true
    let onScreen = true
    let px: number | null = null
    let py: number | null = null

    const paint = (): Paint => {
      const s = getComputedStyle(document.documentElement)
      const read = (name: string, fallback: [number, number, number]) => {
        const v = s.getPropertyValue(name).trim()
        const m = /^#?([0-9a-f]{6})$/i.exec(v)
        if (!m) return fallback
        const n = parseInt(m[1], 16)
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255] as [number, number, number]
      }
      return {
        accent: read('--accent', [34, 197, 94]),
        accent2: read('--accent-2', [239, 68, 68]),
        ink: read('--text', [238, 238, 248]),
      }
    }
    let colours = paint()

    const resize = () => {
      const r = host.getBoundingClientRect()
      // capped: a backdrop this soft gains nothing above 2x and pays for it in fill rate
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      w = Math.max(1, Math.round(r.width))
      h = Math.max(1, Math.round(r.height))
      cv.width = Math.round(w * dpr)
      cv.height = Math.round(h * dpr)
      cv.style.width = w + 'px'
      cv.style.height = h + 'px'
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      effect.init(w, h, coarse)
      colours = paint()
    }

    const frame = (now: number) => {
      // clamped so a tab resumed after a minute does not advance the world by a minute at once
      const dt = Math.min(0.05, Math.max(0, (now - last) / 1000))
      last = now
      t += dt
      ctx.clearRect(0, 0, w, h)
      effect.step({ ctx, w, h, t, dt, paint: colours, px, py })
      raf = requestAnimationFrame(frame)
    }

    const start = () => {
      if (raf || !visible || !onScreen) return
      last = performance.now()
      raf = requestAnimationFrame(frame)
    }
    const stop = () => {
      if (!raf) return
      cancelAnimationFrame(raf)
      raf = 0
    }

    const ro = new ResizeObserver(() => resize())
    ro.observe(host)
    const io = new IntersectionObserver((es) => {
      onScreen = es.some((e) => e.isIntersecting)
      if (onScreen) start()
      else stop()
    })
    io.observe(host)
    const onVis = () => {
      visible = document.visibilityState === 'visible'
      if (visible) start()
      else stop()
    }
    document.addEventListener('visibilitychange', onVis)

    const onMove = (e: PointerEvent) => {
      const r = host.getBoundingClientRect()
      px = e.clientX - r.left
      py = e.clientY - r.top
    }
    const onLeave = () => {
      px = null
      py = null
    }
    if (!coarse) {
      host.addEventListener('pointermove', onMove)
      host.addEventListener('pointerleave', onLeave)
    }

    // the palette can change under us — the look editor is right there, changing it live
    const offMotion = onMotionChange(() => {
      if (motionReduced()) stop()
      else start()
    })
    const repaint = () => {
      colours = paint()
    }
    window.addEventListener('yaya:palette', repaint)

    resize()
    start()
    return () => {
      stop()
      ro.disconnect()
      io.disconnect()
      document.removeEventListener('visibilitychange', onVis)
      host.removeEventListener('pointermove', onMove)
      host.removeEventListener('pointerleave', onLeave)
      window.removeEventListener('yaya:palette', repaint)
      offMotion()
    }
  }, [id])

  // glow is the older AmbientBackdrop component, not a canvas effect from backdrops.ts
  if (id === 'none' || id === 'glow' || motionReduced()) return null
  /**
   * Portalled to <body> as a fixed layer at z-index -1, exactly where the ambient glow sits.
   * These two are alternatives for the same slot, so they must occupy the same one — a backdrop
   * that painted inside the page would scroll with it and sit above the ground the glow uses.
   */
  return createPortal(
    <div ref={holder} className="site-backdrop" aria-hidden>
      <canvas ref={ref} />
    </div>,
    document.body,
  )
}
