import { useEffect, useMemo, useRef } from 'react'
import type { Drawing } from '../draw/strokes'
import { paintPet } from './paint'
import { petRatio, rigOf, type Mood } from './rig'

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
  stance = 'idle',
  watch,
  className,
  label,
}: {
  art: Drawing
  /** css pixels on the long side */
  size: number
  energy?: number
  facing?: number
  stance?: Mood['stance']
  /**
   * Follow the pointer with its head and eyes.
   *
   * `'hover'` only while the pointer is over the pet, which is right for one sitting in a page
   * among other things. `'page'` follows it anywhere on the screen, which is the only mode that
   * works for a creature pinned in a corner — your cursor is almost never on top of it.
   */
  watch?: 'hover' | 'page'
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
  /**
   * ⚠️ READ LIVE INSIDE THE LOOP, so none of this tears the loop down — and the look in
   * particular could not work any other way: it changes on every pointermove, and restarting an
   * animation sixty times a second is not an animation.
   */
  const live = useRef({ energy, facing, stance, look: { x: 0, y: 0 } })
  live.current = { ...live.current, energy, facing, stance }

  /* ⚠️ the BOOLEAN, not the number. Crossing between still and moving has to restart the loop;
     every other change of energy is picked up through the ref on the next frame. */
  const moving = energy > 0

  /**
   * ⚠️ IT LOOKS AT YOUR POINTER, which is the one thing here that is a reaction rather than a
   * clock — and the only reason a creature in the corner feels like it has noticed you. Written
   * straight into the ref the loop reads, never into state: this fires on every pointermove.
   */
  const follow = (e: React.PointerEvent) => {
    if (watch !== 'hover') return
    const r = e.currentTarget.getBoundingClientRect()
    if (!r.width || !r.height) return
    live.current.look = {
      x: Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width) * 2 - 1)),
      y: Math.max(-1, Math.min(1, ((e.clientY - r.top) / r.height) * 2 - 1)),
    }
  }
  const away = () => {
    live.current.look = { x: 0, y: 0 }
  }

  /**
   * Where the pointer is on the screen, for the corner pet.
   *
   * ⚠️ CLIENT COORDINATES, NOT A LOOK VECTOR, and the split is the point. Turning a pointer
   * position into "which way is that from here" needs the pet's rectangle, and reading a rectangle
   * is a layout read — doing it in this handler would mean one per pointermove, which is as often
   * as the mouse can be bothered to move. Storing two numbers here and converting inside the frame
   * costs at most one read per frame, and a frame is the only moment the answer is used.
   */
  const at = useRef<{ x: number; y: number } | null>(null)
  useEffect(() => {
    if (watch !== 'page') return
    const on = (e: PointerEvent) => {
      at.current = { x: e.clientX, y: e.clientY }
    }
    /* a pointer that has left the window is not somewhere to look — and a touch screen has no
       pointer at all between taps, which is the same thing */
    const gone = () => {
      at.current = null
    }
    window.addEventListener('pointermove', on, { passive: true })
    window.addEventListener('pointerleave', gone)
    window.addEventListener('pointercancel', gone)
    return () => {
      window.removeEventListener('pointermove', on)
      window.removeEventListener('pointerleave', gone)
      window.removeEventListener('pointercancel', gone)
    }
  }, [watch])

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

    /**
     * ⚠️ THE WHOLE SCREEN MAPS TO THE WHOLE RANGE, measured from wherever the pet happens to
     * sit rather than over a fixed distance. A pet in a corner is never more than a sliver of the
     * screen from one edge and nearly all of it from the other, so dividing by one number pins it
     * at a full glance in the direction it has room in and barely moves it in the other. Giving
     * each side its own distance to the edge means the far corner is a full look and the near one
     * is a small one, whichever corner the pet sits in.
     *
     * ⚠️ Safe to read a rectangle here: this runs inside the frame, after the canvas has been
     * sized and before anything writes to the page, so it cannot be the read half of a thrash.
     */
    const lookAt = (): { x: number; y: number } => {
      const p = at.current
      if (!p) return { x: 0, y: 0 }
      const r = el.getBoundingClientRect()
      if (!r.width || !r.height) return { x: 0, y: 0 }
      const cx = r.left + r.width / 2
      const cy = r.top + r.height / 2
      const span = (v: number, c: number, max: number) => {
        const room = v < c ? c : max - c
        return room > 1 ? Math.max(-1, Math.min(1, (v - c) / room)) : 0
      }
      return { x: span(p.x, cx, window.innerWidth), y: span(p.y, cy, window.innerHeight) }
    }

    const draw = (t: number) => {
      const look = watch === 'page' ? lookAt() : live.current.look
      paintPet(ctx, art, parts, w, h, {
        t,
        energy: live.current.energy,
        facing: live.current.facing,
        mood: { stance: live.current.stance, lookX: look.x, lookY: look.y },
      })
    }

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
    /**
     * ⚠️ THE STANCE IS A DEPENDENCY, unlike energy and the look. Those change while the loop is
     * running and get picked up on the next frame through the ref — but a still pet has no next
     * frame, so at zero energy (which is what reduced motion gets) changing the stance would have
     * repainted nothing at all. It is a rare, deliberate press, so restarting the loop for it
     * costs nothing, and the clock lives in a ref so the creature does not snap back to t=0.
     */
  }, [art, parts, w, h, moving, stance, watch])

  return (
    <canvas
      ref={cv}
      className={className}
      aria-label={label ?? art.name ?? 'Minion'}
      role="img"
      onPointerMove={watch === 'hover' ? follow : undefined}
      onPointerLeave={watch === 'hover' ? away : undefined}
    />
  )
}
