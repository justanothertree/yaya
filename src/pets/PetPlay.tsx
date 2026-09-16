import { useEffect, useRef, useState } from 'react'
import type { Drawing } from '../draw/strokes'
import { PetView } from './PetView'
import { COURSE, effortOf, restingBody, stanceOf, stepBody, type Body, type Input } from './play'

/**
 * Somewhere to actually play with the thing you drew.
 *
 * ⚠️ THE RIG WAS ALREADY A CHARACTER CONTROLLER AND NOBODY HAD NOTICED. It reads a run, a crouch
 * and a braced pose out of the layer names, takes a facing, and runs its legs off a clock — which
 * is the whole of what a platformer asks of a sprite. So this needed no new drawing, no sprite
 * sheet and no second format: your pet walks because `run` is a stance it already had.
 *
 * ⚠️ THE PHYSICS IS NOT IN HERE, on purpose. It is a pure function in play.ts, because
 * requestAnimationFrame does not run in the browser pane and a loop that owns its own maths is a
 * loop that cannot be checked. This component is the clock, the keys and the positioning; every
 * question about what the pet DOES is answered next door and answerable without a browser.
 */

const KEYS: Record<string, keyof Input> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'jump',
  ArrowDown: 'down',
  a: 'left',
  A: 'left',
  d: 'right',
  D: 'right',
  w: 'jump',
  W: 'jump',
  s: 'down',
  S: 'down',
  ' ': 'jump',
}

export function PetPlay({ art, name }: { art: Drawing; name: string }) {
  const host = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [shown, setShown] = useState<Body>(() => restingBody())

  /**
   * ⚠️ THE BODY LIVES IN A REF AND IS COPIED INTO STATE ONCE A FRAME. The loop must not depend on
   * React to know where the pet is — a setState per frame that also feeds the next frame is how a
   * game ends up running at the speed of the renderer rather than the speed of the clock.
   */
  const body = useRef<Body>(restingBody())
  const held = useRef<Input>({ left: false, right: false, jump: false, down: false })

  /* ⚠️ measured on resize rather than with a ResizeObserver, which never fires in the pane —
     the pet's size in pixels has to come from somewhere and this is the honest somewhere */
  useEffect(() => {
    const fit = () => {
      const r = host.current?.getBoundingClientRect()
      if (r && r.width > 1) setSize({ w: Math.round(r.width), h: Math.round(r.height) })
    }
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [])

  /**
   * ⚠️ preventDefault ON THE ARROWS AND THE SPACE BAR, or playing scrolls the page out from under
   * the game — which on a room this far down the page means the pet you are steering leaves the
   * screen while you steer it.
   */
  useEffect(() => {
    const set = (e: KeyboardEvent, on: boolean) => {
      const k = KEYS[e.key]
      if (!k) return
      e.preventDefault()
      held.current[k] = on
    }
    const down = (e: KeyboardEvent) => set(e, true)
    const up = (e: KeyboardEvent) => set(e, false)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    /* ⚠️ a key held when the window loses focus never sends its keyup, and the pet walks off on
       its own for ever. Letting go of everything is the only honest answer to "I stopped looking". */
    const drop = () => {
      held.current = { left: false, right: false, jump: false, down: false }
    }
    window.addEventListener('blur', drop)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', drop)
    }
  }, [])

  useEffect(() => {
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      const dt = (now - last) / 1000
      last = now
      body.current = stepBody(body.current, held.current, COURSE, dt)
      setShown(body.current)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  /* the pet stands about a ninth of the height, which is the size a platformer character reads at */
  const pet = Math.max(40, Math.round(size.h * 0.22))
  const input = held.current
  const stance = stanceOf(shown, input)

  return (
    <div className="pet-play">
      <div className="pet-play-field" ref={host}>
        {COURSE.map((l, i) => (
          <span
            key={i}
            className="pet-play-ledge"
            style={{ left: `${l.x * 100}%`, top: `${l.y * 100}%`, width: `${l.w * 100}%` }}
            aria-hidden
          />
        ))}
        <span className="pet-play-floor" aria-hidden />
        <span
          className="pet-play-pet"
          style={{ left: `${shown.x * 100}%`, top: `${shown.y * 100}%` }}
        >
          <PetView
            art={art}
            size={pet}
            energy={effortOf(shown)}
            facing={shown.facing}
            stance={stance}
            label={`${name}, being played`}
          />
        </span>
      </div>
      {/* ⚠️ said in the room rather than in a tooltip, because a tooltip is not a thing a phone
          has and this is the only place on the site where the keyboard IS the interface */}
      <p className="muted pet-play-keys">
        <strong>← →</strong> or <strong>A D</strong> to walk · <strong>↑</strong>,{' '}
        <strong>W</strong> or <strong>space</strong> to jump · <strong>↓</strong> to crouch. It
        runs, crouches and braces on the way down using the layer names you gave it — a pet with a
        layer called <code>leg</code> runs on its legs.
      </p>
    </div>
  )
}
