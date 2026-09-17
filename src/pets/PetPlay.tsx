import { useEffect, useMemo, useRef, useState } from 'react'
import type { Drawing } from '../draw/strokes'
import { PetView } from './PetView'
import { petRatio, rigOf } from './rig'
import { useOneShot } from './oneShot'
import {
  COURSE,
  effortFor,
  followInput,
  restingBody,
  stanceOf,
  stepBody,
  collect,
  PET_TALL,
  TREATS,
  WORLD,
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
  const [taken, setTaken] = useState<boolean[]>(() => TREATS.map(() => false))
  /* ⚠️ the loop reads this rather than closing over the state, so picking one up does not
     tear down and rebuild the animation frame */
  const takenRef = useRef(taken)
  takenRef.current = taken

  /**
   * Where the window onto the world is.
   *
   * ⚠️ IT EASES RATHER THAN SNAPPING. Locked to the lead exactly, the whole world slides
   * under a creature that is standing still while it accelerates, and every small correction you
   * make is a shove to the entire picture. Chasing at a rate means the camera arrives a moment
   * after you do, which is what makes it feel like a window rather than a treadmill.
   *
   * ⚠️ AND IT STOPS AT THE EDGES, so the ends of the world sit against the sides of the frame
   * rather than scrolling on into nothing. There is a floor and a wall out there and the camera
   * should admit it.
   */
  const cam = useRef(0)
  const [camAt, setCamAt] = useState(0)

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
  /* ⚠️ the one thing in this room that is done rather than held — see useOneShot */
  const [pouncing, pounce] = useOneShot()

  /**
   * Motion somebody did not ask for.
   *
   * ⚠️ EVERY OTHER FILE IN THIS MODULE DOES THIS AND THIS ONE DID NOT. PetBlock, PetCompanion,
   * PetsRoom and PetView all read prefers-reduced-motion; the playground, which is the most moving
   * thing in the room by a distance, was the only one that ignored it.
   *
   * ⚠️ A GAME IS NOT ALL ONE KIND OF MOTION, which is why this is not simply "stop". Movement
   * you CAUSED is the thing you came for and taking it away leaves no game at all; movement that
   * happens at you is what the setting is about. So a creature standing still stands still — no
   * breathing, no wings — and the camera arrives at once instead of gliding, while walking,
   * jumping and the followers keeping up are all left exactly as they are.
   */
  const [still, setStill] = useState(
    () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false,
  )
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    if (!mq) return
    const on = () => setStill(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  const stillRef = useRef(still)
  stillRef.current = still
  const pounceRef = useRef(pounce)
  pounceRef.current = pounce
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
      /* ⚠️ through a ref: this listener is armed once, and reading `pounce` directly would
         put it in the dependencies and tear the whole keyboard down every time one fires */
      if (on && (e.key === 'x' || e.key === 'X')) {
        e.preventDefault()
        pounceRef.current()
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
    /* ⚠️ a thumb that slides off a pad button releases nowhere near it, so the window is the
       only place that reliably hears about it — see the pad below */
    window.addEventListener('pointerup', drop)
    window.addEventListener('pointercancel', drop)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', drop)
      window.removeEventListener('pointerup', drop)
      window.removeEventListener('pointercancel', drop)
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
          i === at ? held.current : boss ? followInput(b, boss, i, COURSE) : STILL,
          COURSE,
          dt,
          traits[i],
        ),
      )
      const eye = bodies.current[at]
      if (eye) {
        const want = Math.max(0, Math.min(WORLD.w - 1, eye.x - 0.5))
        /* ⚠️ framerate-independent easing: 1 - e^(-k t), not a fixed fraction per frame, or the
           camera chases faster on a fast machine than a slow one. The glide is the decorative half
           of this, so reduced motion gets the window without the sweep. */
        cam.current = stillRef.current
          ? want
          : cam.current + (want - cam.current) * (1 - Math.exp(-7 * Math.min(0.05, dt)))
        setCamAt(cam.current)
      }
      setShown(bodies.current)
      /* ⚠️ null when nothing changed, so this is sixty comparisons a second and no renders —
         see collect */
      const got = collect(bodies.current, TREATS, takenRef.current)
      if (got) setTaken(got)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [traits])

  /**
   * How tall each creature stands, and it is worked out per creature.
   *
   * ⚠️ PetView's `size` IS THE LONG SIDE, NOT THE HEIGHT, and passing a height to it is the
   * bug this fixes: a creature drawn taller than it is wide came out that much bigger than one
   * drawn wide. Measured on a phone — a 40px `size` rendered 109px tall in a 168px field, so the
   * pet was two thirds of the world and every pet was a different size from every other.
   *
   * ⚠️ AND THE HEIGHT IS THE ONE THE PHYSICS ALREADY BELIEVES — PET_TALL, which the reach
   * test is written in too. Drawing it any other size means the thing you see and the thing that
   * touches a treat are different creatures. It was the same 0.2 typed in both files with a
   * comment asking the reader to keep them in step; now there is nothing to keep in step.
   */
  const petSize = (art: Drawing) => {
    const tall = Math.max(26, size.h * PET_TALL)
    const wh = petRatio(art)
    return Math.round(wh >= 1 ? tall * wh : tall)
  }
  const boss = shown[lead]

  return (
    <div className="pet-play">
      <div className="pet-play-field">
        {/**
         * ⚠️ THE WORLD GETS ITS OWN BOX SO THE THUMBS ARE NOT STANDING IN IT. Overlaid on the
         * field, the pad sat on the strip of floor the pets actually walk on — measured on a phone,
         * both creatures were underneath a key at the start, before anybody had moved. Controls
         * under the PICTURE are what I was avoiding; controls under the WORLD, inside the same
         * frame, cost the picture nothing and leave the floor clear.
         *
         * ⚠️ AND IT IS WHAT THE WORLD IS MEASURED AGAINST, so `host` moved here from the field.
         * y = 1 is the bottom of the stage, not the bottom of the frame, and a pet standing on the
         * floor stands on the floor rather than behind a button.
         */}
        <div className="pet-play-stage" ref={host}>
          {COURSE.map((l, i) => (
            <span
              key={i}
              className="pet-play-ledge"
              style={{
                left: `${(l.x - camAt) * 100}%`,
                top: `${l.y * 100}%`,
                width: `${l.w * 100}%`,
              }}
              aria-hidden
            />
          ))}
          <span className="pet-play-floor" aria-hidden />
          {TREATS.map((s, i) => (
            <span
              key={i}
              className={'pet-play-treat' + (taken[i] ? ' is-gone' : '')}
              style={{ left: `${(s.x - camAt) * 100}%`, top: `${s.y * 100}%` }}
              aria-hidden
            />
          ))}
          {pets.map((p, i) => {
            const b = shown[i]
            if (!b) return null
            const mine = i === lead
            const input = mine ? held.current : boss ? followInput(b, boss, i, COURSE) : STILL
            return (
              /* ⚠️ A BUTTON, so taking control of a creature is a thing you can do with a mouse, a
                 thumb or the keyboard — the number keys are the shortcut, not the only way. */
              <button
                key={`${p.name}-${i}`}
                className={'pet-play-pet' + (mine ? ' is-lead' : '')}
                style={{ left: `${(b.x - camAt) * 100}%`, top: `${b.y * 100}%` }}
                onClick={() => setLead(i)}
                title={
                  (mine ? `You are ${p.name}` : `Play as ${p.name} (${i + 1})`) +
                  (traitWords(traits[i]).length ? ` — ${traitWords(traits[i]).join(', ')}` : '')
                }
                aria-pressed={mine}
              >
                <PetView
                  art={p.art}
                  size={petSize(p.art)}
                  /* ⚠️ at rest and asked for less motion it simply stands there; the legs still
                     run when it runs, because that is motion you are causing — see effortFor */
                  energy={effortFor(b, still)}
                  facing={b.facing}
                  stance={mine && pouncing ? 'pounce' : stanceOf(b, input)}
                  label={mine ? `${p.name}, the one you are playing` : `${p.name}, following`}
                />
              </button>
            )
          })}
        </div>
        {/**
         * ⚠️ THE GAME DID NOT EXIST ON A PHONE. Everything in this room was driven by the
         * arrow keys, and the note under the field said so out loud — "this is the only place on
         * the site where the keyboard IS the interface" — which reads as a design decision and was
         * really an admission. On a touch screen you could open the playground, see your pets and
         * do nothing whatever with them.
         *
         * ⚠️ ON THE FIELD, NOT UNDER IT. Controls below the picture are controls your thumb
         * covers the picture to reach on a screen this size. Overlaid at the bottom corners, the
         * thumbs sit where they already rest and the creature stays visible between them.
         *
         * ⚠️ pointer EVENTS RATHER THAN click, because a platformer needs held, not pressed —
         * and pointerup is taken on the WINDOW, since a thumb that slides off a button never sends
         * one to the button and the pet would walk off on its own for ever.
         */}
        <div className="pet-play-pad" aria-hidden={false}>
          <span className="pet-play-pad-side">
            {(['left', 'right'] as const).map((k) => (
              <button
                key={k}
                className="pet-play-key"
                aria-label={k === 'left' ? 'Walk left' : 'Walk right'}
                onPointerDown={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  held.current[k] = true
                }}
                onPointerUp={() => (held.current[k] = false)}
                onPointerCancel={() => (held.current[k] = false)}
                onPointerLeave={() => (held.current[k] = false)}
              >
                {k === 'left' ? '◀' : '▶'}
              </button>
            ))}
          </span>
          <span className="pet-play-pad-side">
            {/* ⚠️ a tap rather than a hold, because it is a thing that happens once — the other
                four keys are held and this one cannot be */}
            <button
              className="pet-play-key"
              aria-label="Pounce"
              onPointerDown={(e) => {
                e.preventDefault()
                e.stopPropagation()
                pounce()
              }}
            >
              ⚡
            </button>
            {(['down', 'jump'] as const).map((k) => (
              <button
                key={k}
                className={'pet-play-key' + (k === 'jump' ? ' is-jump' : '')}
                aria-label={k === 'jump' ? 'Jump, hold to glide' : 'Crouch'}
                onPointerDown={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  held.current[k] = true
                }}
                onPointerUp={() => (held.current[k] = false)}
                onPointerCancel={() => (held.current[k] = false)}
                onPointerLeave={() => (held.current[k] = false)}
              >
                {k === 'jump' ? '⬆' : '▼'}
              </button>
            ))}
          </span>
        </div>
      </div>
      {/**
       * ⚠️ THE WHOLE WORLD, WITH THE PART YOU CAN SEE MARKED ON IT. The field shows one screen
       * of three, so without this there is no way to tell whether there is more to the right, how
       * much of it there is, or where the things you have not found are — you walk and find out.
       *
       * ⚠️ IT IS NOT A CONTROL. No clicking to jump the camera somewhere: the point of the
       * world being bigger than the window is that you cross it, and a map you can teleport with
       * takes that back. It says where you are and nothing else.
       */}
      <div className="pet-play-map" aria-hidden>
        <span
          className="pet-play-map-view"
          style={{ left: `${(camAt / WORLD.w) * 100}%`, width: `${(1 / WORLD.w) * 100}%` }}
        />
        {TREATS.map((s, i) => (
          <span
            key={i}
            className={'pet-play-map-treat' + (taken[i] ? ' is-gone' : '')}
            style={{ left: `${(s.x / WORLD.w) * 100}%` }}
          />
        ))}
        {boss && (
          <span className="pet-play-map-you" style={{ left: `${(boss.x / WORLD.w) * 100}%` }} />
        )}
      </div>
      <p className="pet-play-score muted">
        {taken.every(Boolean) ? (
          <>
            <strong>All {TREATS.length} found.</strong>{' '}
            <button className="btn btn-ghost" onClick={() => setTaken(TREATS.map(() => false))}>
              Put them back
            </button>
          </>
        ) : (
          `${taken.filter(Boolean).length} of ${TREATS.length} found`
        )}
      </p>
      {/* ⚠️ said in the room rather than in a tooltip, because a tooltip is not a thing a phone
          has and this is the only place on the site where the keyboard IS the interface */}
      <p className="muted pet-play-keys">
        <strong>← →</strong> or <strong>A D</strong> to walk · <strong>↑</strong>,{' '}
        <strong>W</strong> or <strong>space</strong> to jump · <strong>↓</strong> to crouch ·{' '}
        <strong>X</strong> to pounce
        {pets.length > 1 && (
          <>
            {' · '}
            <strong>1–{Math.min(9, pets.length)}</strong> or click a minion to play as it
          </>
        )}
        . What each one is made of is what it can do: wings glide if you hold jump on the way down,
        legs make it quicker, and anything the rig calls a float is lighter
        {pets.length > 1 ? '. The rest follow whoever you are.' : '.'}
      </p>
    </div>
  )
}
