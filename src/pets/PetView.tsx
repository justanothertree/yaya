import { useEffect, useMemo, useRef } from 'react'
import type { Drawing } from '../draw/strokes'
import { paintPet } from './paint'
import { petRatio, rigOf } from './rig'

/**
 * A pet, alive, at whatever size it is given.
 *
 * ⚠️ requestAnimationFrame, NOT an interval, and it matters more here than anywhere else on the
 * site: this is meant to end up in the corner of every page, and rAF is the one timer a browser
 * stops paying for when the tab is not in front. An interval would keep a canvas repainting on a
 * machine nobody is looking at, which is exactly the cost a pet in the corner must not have.
 *
 * ⚠️ IT STOPS WHEN NOTHING IS MOVING. A pet at zero energy is one still frame, so the loop paints
 * it once and lets go rather than redrawing an identical picture sixty times a second. That is
 * also what prefers-reduced-motion gets: not a slower pet, a still one.
 */
export function PetView({
  art,
  size,
  energy = 1,
  facing = 1,
  className,
  label,
}: {
  art: Drawing
  /** css pixels on the long side */
  size: number
  energy?: number
  facing?: number
  className?: string
  label?: string
}) {
  const cv = useRef<HTMLCanvasElement>(null)

  /* ⚠️ memoised on the drawing: rigOf walks every stroke twice to find the boxes, and this
     component re-renders whenever its parent does */
  const parts = useMemo(() => rigOf(art), [art])

  /* ⚠️ THE INK'S SHAPE, NOT THE PAPER'S. paintPet crops to the creature, and the crop is only
     a magnification rather than a stretch if the canvas is this shape — see the note there. */
  const wh = useMemo(() => petRatio(art), [art])
  const w = Math.round(wh >= 1 ? size : size * wh)
  const h = Math.round(wh >= 1 ? size / wh : size)

  /**
   * ⚠️ THE CLOCK OUTLIVES THE LOOP. Energy changes when the pet is prodded, and if the start
   * time were a local the restarted loop would begin at t=0 again — so a pet that was mid-flap
   * would snap back to wings down at the exact moment you touched it. The one visible effect of
   * poking it would be a glitch.
   */
  const t0 = useRef(performance.now())
  /* read live inside the loop, so a change of energy does not tear the loop down */
  const live = useRef({ energy, facing })
  live.current = { energy, facing }

  /* ⚠️ the BOOLEAN, not the number. Crossing between still and moving has to restart the loop;
     every other change of energy is picked up through the ref on the next frame. */
  const moving = energy > 0

  useEffect(() => {
    const el = cv.current
    if (!el) return
    const ctx = el.getContext('2d')
    if (!ctx) return
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    el.style.width = w + 'px'
    el.style.height = h + 'px'
    el.width = Math.round(w * dpr)
    el.height = Math.round(h * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    const draw = (t: number) =>
      paintPet(ctx, art, parts, w, h, {
        t,
        energy: live.current.energy,
        facing: live.current.facing,
      })

    /**
     * ⚠️ ONE FRAME NOW, BEFORE THE LOOP. requestAnimationFrame does not run until the next
     * frame, and does not run AT ALL in a background tab — so without this a pet is an empty
     * canvas until the browser feels like it, which on a tab opened in the background means until
     * somebody looks at it. Painting the resting pose first means the pet is simply there.
     */
    draw(0)
    if (!moving) return
    let raf = 0
    const tick = (now: number) => {
      draw((now - t0.current) / 1000)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [art, parts, w, h, moving])

  return (
    <canvas ref={cv} className={className} aria-label={label ?? art.name ?? 'Pet'} role="img" />
  )
}
