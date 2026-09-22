import { useEffect, useMemo, useRef } from 'react'
import type { Drawing } from '../draw/strokes'
import { paintPet, poseRoom } from './paint'
import { petBox, rigOf, type Mood } from './rig'

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
  show,
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
   * Which drawn attack to reveal, if the creature is mid-swing.
   *
   * ⚠️ A hit layer is invisible unless it is named here — see PetPaint.show. Passed live like
   * the energy and the facing, because it changes several times a second during a fight and
   * restarting the animation each time would be a creature that stutters whenever it swings.
   */
  show?: number
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
  /* ⚠️ the same sum the park uses to push a lunge about — see petBox */
  const { w, h } = useMemo(() => petBox(art, size), [art, size])

  /**
   * The margin the bitmap carries so a pose is not cut off by its own edge.
   *
   * ⚠️ THE PICTURE DOES NOT MOVE AND DOES NOT RESIZE. paintPet is still handed w and h and
   * still crops the ink to exactly that box; the bitmap is bigger and the drawing is painted at
   * an offset into the middle of it, so every pixel of the creature lands where it always did.
   * That is what makes this safe to add under everything: petBox is what the park's altitude,
   * the lunge push, bodyFill and footRoom are all measured against, and none of them can tell.
   *
   * ⚠️ AND THE ELEMENT IS PULLED BACK BY WHAT IT GREW. A canvas that is bigger in the
   * layout would push its neighbours about and shift itself inside anything centring it, so the
   * extra is taken straight back off as margin. The laid-out box stays w by h.
   */
  const room = useMemo(() => {
    const r = poseRoom(art, parts)
    return { x: Math.round(w * r.x), y: Math.round(h * r.y) }
  }, [art, parts, w, h])

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
  const live = useRef({ energy, facing, stance, show, look: { x: 0, y: 0 } })
  live.current = { ...live.current, energy, facing, stance, show }

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
    const fullW = w + room.x * 2
    const fullH = h + room.y * 2
    el.style.width = fullW + 'px'
    el.style.height = fullH + 'px'
    /* pulled back to the box the layout expects — see room */
    el.style.margin = `${-room.y}px ${-room.x}px`
    el.width = Math.round(fullW * dpr)
    el.height = Math.round(fullH * dpr)
    /* ⚠️ the margin is baked into the transform, so everything below is written in the
       creature's own coordinates exactly as it was before there was any margin */
    ctx.setTransform(dpr, 0, 0, dpr, room.x * dpr, room.y * dpr)

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
      /* ⚠️ the rect is the PADDED bitmap now, and the margin is symmetric, so the middle
         of it is still the middle of the creature — which is all this needs. */
      const cx = r.left + r.width / 2
      const cy = r.top + r.height / 2
      const span = (v: number, c: number, max: number) => {
        const gap = v < c ? c : max - c
        return gap > 1 ? Math.max(-1, Math.min(1, (v - c) / gap)) : 0
      }
      return { x: span(p.x, cx, window.innerWidth), y: span(p.y, cy, window.innerHeight) }
    }

    const draw = (t: number) => {
      const look = watch === 'page' ? lookAt() : live.current.look
      /**
       * ⚠️ THE MARGIN HAS TO BE CLEARED HERE. paintPet clears 0,0,w,h — the creature's
       * own box — and with the offset transform that leaves the surrounding room untouched,
       * so anything a pose painted out there last frame stayed painted. A leaning creature
       * smeared a trail of itself around its own edge. Clearing in device space covers the
       * whole bitmap whatever the transform is doing.
       */
      ctx.save()
      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, el.width, el.height)
      ctx.restore()
      paintPet(ctx, art, parts, w, h, {
        t,
        energy: live.current.energy,
        facing: live.current.facing,
        mood: { stance: live.current.stance, lookX: look.x, lookY: look.y },
        show: live.current.show,
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
  }, [art, parts, w, h, room, moving, stance, watch])

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
