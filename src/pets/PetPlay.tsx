import { useEffect, useMemo, useRef, useState } from 'react'
import type { Drawing } from '../draw/strokes'
import { PetView } from './PetView'
import { rigOf } from './rig'
import {
  COURSE,
  effortOf,
  followInput,
  restingBody,
  stanceOf,
  stepBody,
  traitWords,
  traitsOf,
  type Body,
  type Input,
  type Traits,
} from './play'

/**
 * Somewhere to actually play with the things you drew.
 *
 * ⚠️ THE RIG WAS ALREADY A CHARACTER CONTROLLER AND NOBODY HAD NOTICED. It reads a run, a crouch
 * and a braced pose out of the layer names, takes a facing, and runs its legs off a clock — which
 * is the whole of what a platformer asks of a sprite. So this needed no new drawing, no sprite
 * sheet and no second format: your pet walks because `run` is a stance it already had.
 *
 * ⚠️ ALL OF THEM ARE HERE, AND YOU PICK WHICH ONE YOU ARE. The ask was a way to SELECT them and
 * control them, and a room holding one creature at a time only answers half of that. The rest
 * follow whoever you are being — through the same stepBody, so a follower obeys the same gravity
 * and the same one-way ledges and cannot get anywhere you could not.
 *
 * ⚠️ THE PHYSICS IS NOT IN HERE, on purpose. It is pure functions in play.ts, because
 * requestAnimationFrame does not run in the browser pane and a loop that owns its own maths is a
 * loop that cannot be checked. This component is the clock, the keys and the positioning; every
 * question about what a pet DOES is answered next door, without a browser.
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

const STILL: Input = { left: false, right: false, jump: false, down: false }

export type PlayPet = { name: string; art: Drawing }

/**
 * Where everybody stands before anything has happened.
 *
 * ⚠️ THE FIRST FRAME IS DRAWN FROM THIS, NOT FROM THE LOOP. Starting the shown list empty and
 * waiting for requestAnimationFrame to fill it means the room renders with no creatures in it
 * until the browser gets round to a frame — one blank frame in a real browser, and forever in the
 * pane, where rAF never runs at all. A game whose resting state is "nothing is here yet" cannot be
 * checked and blinks on arrival.
 *
 * ⚠️ SPREAD ALONG THE FLOOR rather than stacked on one spot, so a room full of pets opens as
 * a row of creatures rather than one creature with a crowd hiding behind it.
 */
const startBodies = (n: number): Body[] =>
  Array.from({ length: n }, (_, i) => restingBody(0.14 + i * 0.11))

export function PetPlay({ pets, startAt = 0 }: { pets: PlayPet[]; startAt?: number }) {
  const host = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [lead, setLead] = useState(() => Math.min(startAt, Math.max(0, pets.length - 1)))
  const [shown, setShown] = useState<Body[]>(() => startBodies(pets.length))

  /**
   * ⚠️ THE BODIES LIVE IN A REF AND ARE COPIED INTO STATE ONCE A FRAME. The loop must not depend
   * on React to know where anybody is — a setState per frame that also feeds the next frame is how
   * a game ends up running at the speed of the renderer rather than the speed of the clock.
   *
   * ⚠️ SPREAD ALONG THE FLOOR rather than stacked on one spot, so a room full of pets is a row of
   * creatures at the start rather than one creature with a crowd hiding behind it.
   */
  const bodies = useRef<Body[]>([])
  /**
   * ⚠️ WORKED OUT ONCE PER PET, not once per frame. rigOf walks every stroke to find the part
   * boxes, and this is asked inside the loop — sixty times a second times however many creatures
   * you have drawn is the one place in this room where that would actually be felt.
   */
  const traits = useMemo<Traits[]>(() => pets.map((p) => traitsOf(rigOf(p.art))), [pets])
  const held = useRef<Input>({ ...STILL })
  const leadRef = useRef(lead)
  leadRef.current = lead

  /* ⚠️ both of them, together: the ref the loop steps and the state the page draws start as
     the same row of creatures, so what you see before the first frame is what the loop inherits */
  useEffect(() => {
    bodies.current = startBodies(pets.length)
    setShown(bodies.current)
  }, [pets.length])

  /* ⚠️ measured on resize rather than with a ResizeObserver, which never fires in the pane —
     the pets' size in pixels has to come from somewhere and this is the honest somewhere */
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
   *
   * ⚠️ NUMBERS SWITCH WHO YOU ARE, not Tab. Tab is how somebody who cannot use a mouse leaves
   * this game, and taking it would trap them in a room whose only other control is the arrow keys.
   */
  useEffect(() => {
    const set = (e: KeyboardEvent, on: boolean) => {
      const k = KEYS[e.key]
      if (k) {
        e.preventDefault()
        held.current[k] = on
        return
      }
      if (on && /^[1-9]$/.test(e.key)) {
        const n = Number(e.key) - 1
        if (n < pets.length) {
          e.preventDefault()
          setLead(n)
        }
      }
    }
    const down = (e: KeyboardEvent) => set(e, true)
    const up = (e: KeyboardEvent) => set(e, false)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    /* ⚠️ a key held when the window loses focus never sends its keyup, and the pet walks off on
       its own for ever. Letting go of everything is the only honest answer to "I stopped looking". */
    const drop = () => {
      held.current = { ...STILL }
    }
    window.addEventListener('blur', drop)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', drop)
    }
  }, [pets.length])

  useEffect(() => {
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      const dt = (now - last) / 1000
      last = now
      const at = leadRef.current
      const lot = bodies.current
      const boss = lot[at]
      bodies.current = lot.map((b, i) =>
        stepBody(
          b,
          i === at ? held.current : boss ? followInput(b, boss, i) : STILL,
          COURSE,
          dt,
          traits[i],
        ),
      )
      setShown(bodies.current)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [traits])

  /* a pet stands about a fifth of the height, which is the size a platformer character reads at */
  const pet = Math.max(40, Math.round(size.h * 0.22))
  const boss = shown[lead]

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
        {pets.map((p, i) => {
          const b = shown[i]
          if (!b) return null
          const mine = i === lead
          const input = mine ? held.current : boss ? followInput(b, boss, i) : STILL
          return (
            /* ⚠️ A BUTTON, so taking control of a creature is a thing you can do with a mouse, a
               thumb or the keyboard — the number keys are the shortcut, not the only way. */
            <button
              key={`${p.name}-${i}`}
              className={'pet-play-pet' + (mine ? ' is-lead' : '')}
              style={{ left: `${b.x * 100}%`, top: `${b.y * 100}%` }}
              onClick={() => setLead(i)}
              title={
                (mine ? `You are ${p.name}` : `Play as ${p.name} (${i + 1})`) +
                (traitWords(traits[i]).length ? ` — ${traitWords(traits[i]).join(', ')}` : '')
              }
              aria-pressed={mine}
            >
              <PetView
                art={p.art}
                size={pet}
                energy={effortOf(b)}
                facing={b.facing}
                stance={stanceOf(b, input)}
                label={mine ? `${p.name}, the one you are playing` : `${p.name}, following`}
              />
            </button>
          )
        })}
      </div>
      {/* ⚠️ said in the room rather than in a tooltip, because a tooltip is not a thing a phone
          has and this is the only place on the site where the keyboard IS the interface */}
      <p className="muted pet-play-keys">
        <strong>← →</strong> or <strong>A D</strong> to walk · <strong>↑</strong>,{' '}
        <strong>W</strong> or <strong>space</strong> to jump · <strong>↓</strong> to crouch
        {pets.length > 1 && (
          <>
            {' · '}
            <strong>1–{Math.min(9, pets.length)}</strong> or click a pet to play as it
          </>
        )}
        . What each one is made of is what it can do: wings glide if you hold jump on the way down,
        legs make it quicker, and anything the rig calls a float is lighter
        {pets.length > 1 ? '. The rest follow whoever you are.' : '.'}
      </p>
    </div>
  )
}
