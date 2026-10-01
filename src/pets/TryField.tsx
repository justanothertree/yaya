import { useEffect, useMemo, useRef, useState } from 'react'
import type { Drawing } from '../draw/strokes'
import { PetView } from './PetView'
import { footRoom, petCanvas } from './rig'
import { movesOf, petWide, type Attack } from './attack'
import { CAST, patchesOf, type CastKind } from '../park/cast'
import { shapeOf } from '../park/castShape'
import { footSpan, PARK_TALL, strikeSwipe } from '../park/strike'
import { SwipePatch } from '../park/SwipePatch'
import {
  restingWalker,
  stepWalker,
  STILL,
  VIEW,
  type Steer,
  type Walker,
  type Way,
} from '../park/walk'

/**
 * Your creature, at the size it is in the game, that you can actually move.
 *
 * ⚠️ ASKED FOR THREE TIMES AND HALF-ANSWERED TWICE. "see/play your so far drawn layers animated
 * with gameplay 1:1 size as to what it would look like in game". The cast preview beside this was
 * made true to the field, and the swings were added to it, and both of those are things you WATCH
 * — a loop playing one move at a time. What was asked for is to move about: how fast you walk,
 * how far that swing really reaches when you are the one swinging it, how big you are next to it.
 * None of those are questions a loop answers.
 *
 * ⚠️ THE PARK'S OWN FUNCTIONS, ALL OF THEM, so this cannot become a second opinion about the
 * game. stepWalker moves you, strikeSwipe says where a swing lands, patchesOf says where a cast
 * does, footSpan draws what has to be hit — every one of them pure, and every one of them the
 * exact function the park calls. The wiring is new and nothing else is: this file owns a
 * keyboard, a loop and some CSS, which is the split CLAUDE.md asks for in so many words.
 *
 * ⚠️ AND IT IS NOT THE PARK. No relay, no boss, no map, no camera, nothing at stake. One
 * screenful with you in it, which is exactly the question being asked and nothing more.
 */

/** the field is 16:10, and a screen-height is its height — the same constant the park uses */
const FIELD_ASPECT = 16 / 10

const KEYS: Record<string, Way> = {
  ArrowLeft: 'left',
  ArrowRight: 'right',
  ArrowUp: 'up',
  ArrowDown: 'down',
  a: 'left',
  A: 'left',
  d: 'right',
  D: 'right',
  w: 'up',
  W: 'up',
  s: 'down',
  S: 'down',
}

/**
 * ⚠️ ONE SCREENFUL, CLAMPED, RATHER THAN A CAMERA. The park is three screens by three and
 * follows you; here there is nowhere to go and nothing to find, so a camera would only mean the
 * creature sits still while a blank field slides underneath it. Clamping to the one screenful
 * keeps stepWalker's speed exactly the park's — which is the thing being judged — and keeps you
 * on screen, which is the thing being looked at.
 */
const MID = { x: 0.5, y: 0.5 }
const EDGE = 0.045

export function TryField({ art, onDone }: { art: Drawing; onDone: () => void }) {
  const [you, setYou] = useState<Walker>(() => restingWalker(MID.x, MID.y))
  const [swing, setSwing] = useState<{ a: Attack; t: number } | null>(null)
  const [cast, setCast] = useState<{ kind: CastKind; t: number } | null>(null)
  const held = useRef<Steer>({ ...STILL })
  const want = useRef<{ swing: Attack | null; cast: CastKind | null }>({ swing: null, cast: null })
  const field = useRef<HTMLDivElement>(null)
  const [tall, setTall] = useState(0)

  const moves = useMemo(() => movesOf(art), [art])
  const shape = useMemo(() => shapeOf(art), [art])
  const casts = useMemo(() => {
    const list: CastKind[] = ['bloom', 'mark', 'wave', 'bolt']
    return list
  }, [])

  /**
   * ⚠️ MEASURED, NOT CHOSEN — the same rule the cast preview had to be taught. Everything on this
   * field is a fraction of its height, so the creature has to be PARK_TALL of whatever that is or
   * the one thing the field exists to show is the one thing it gets wrong.
   */
  useEffect(() => {
    const el = field.current
    if (!el) return
    const measure = () => setTall(el.getBoundingClientRect().height)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const set = (e: KeyboardEvent, on: boolean) => {
      const k = KEYS[e.key]
      if (k) {
        e.preventDefault()
        held.current[k] = on
        /* ⚠️ last press wins, the same as the park — see Steer.lastX */
        if (on) {
          if (k === 'left' || k === 'right') held.current.lastX = k
          else held.current.lastY = k
        }
        return
      }
      if (!on) return
      const low = e.key.toLowerCase()
      if (low === 'f' || low === 'g') {
        e.preventDefault()
        want.current.swing = moves[low === 'f' ? 0 : 1] ?? moves[0] ?? null
        return
      }
      const slot = '123'.indexOf(e.key)
      if (slot >= 0) {
        e.preventDefault()
        want.current.cast = casts[slot] ?? null
      }
    }
    const down = (e: KeyboardEvent) => set(e, true)
    const up = (e: KeyboardEvent) => set(e, false)
    /* ⚠️ a key held when the window loses focus never sends its keyup — see the park's note */
    const drop = () => {
      held.current = { ...STILL }
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', drop)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', drop)
    }
  }, [moves, casts])

  useEffect(() => {
    let raf = 0
    let last = performance.now()
    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      setYou((w) => {
        const next = stepWalker(w, held.current, dt)
        /* held to one screenful — see MID */
        return {
          ...next,
          x: Math.max(MID.x - VIEW.w / 2 + EDGE, Math.min(MID.x + VIEW.w / 2 - EDGE, next.x)),
          y: Math.max(MID.y - VIEW.h / 2 + EDGE, Math.min(MID.y + VIEW.h / 2 - EDGE, next.y)),
        }
      })
      /**
       * ⚠️ TAKEN BEFORE THE UPDATER, NEVER INSIDE IT, and the first version did it inside. React
       * invokes a state updater TWICE in StrictMode: the first call consumed the pressed key and
       * set it back to null, the second saw null and threw the swing away — so every press did
       * exactly nothing, which reads as a keyboard that is not wired up rather than as a thrown
       * move that was immediately discarded. Measured: forty samples across a whole swing and the
       * box never once existed. CLAUDE.md warns about this for undo stacks; it is the same trap.
       */
      const threw = want.current.swing
      const sent = want.current.cast
      want.current.swing = null
      want.current.cast = null
      setSwing((s) => {
        if (threw) return { a: threw, t: 0 }
        if (!s) return null
        const t = s.t + dt
        return t > s.a.span ? null : { ...s, t }
      })
      setCast((c) => {
        if (sent) return { kind: sent, t: 0 }
        if (!c) return null
        const t = c.t + dt
        return t > CAST[c.kind].time ? null : { ...c, t }
      })
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  /* where you are, as a fraction of the one screenful on show */
  const at = {
    x: 0.5 + (you.x - MID.x) / VIEW.w,
    y: 0.5 + (you.y - MID.y) / VIEW.h,
  }
  const aim = { x: you.facing >= 0 ? 1 : -1, y: 0 }
  const size = petCanvas(art, Math.max(1, tall * PARK_TALL))
  const swiped = swing ? strikeSwipe(you, aim, swing.a, swing.t) : null
  const patches = cast ? patchesOf(cast.kind, you, aim, cast.t, 1, 0, shape) : []
  const half = { x: footSpan(petWide(art), 1, 1, 0), y: footSpan(petWide(art), 1, 0, 1) }

  return (
    <div className="try-field-wrap">
      <div className="try-field" ref={field}>
        {/* ⚠️ the hitbox the park uses, from the park's own function — never a second copy */}
        <span
          className="park-box is-foot"
          aria-hidden
          style={{
            left: `${at.x * 100}%`,
            top: `${at.y * 100}%`,
            width: `${((half.x * 2) / FIELD_ASPECT) * 100}%`,
            height: `${half.y * 2 * 100}%`,
            transform: 'translate(-50%, -50%)',
            borderRadius: '50%',
          }}
        />
        {swiped && (
          <SwipePatch
            swipe={swiped}
            at={{
              x: at.x + (swiped.from.x - you.x) / VIEW.w,
              y: at.y + (swiped.from.y - you.y) / VIEW.h,
            }}
            aspect={FIELD_ASPECT}
            className="park-box is-hit"
          />
        )}
        {patches.map((p, i) => (
          <span
            key={i}
            className={'park-patch' + (p.live ? ' is-live' : '')}
            aria-hidden
            style={{
              left: `${(at.x + (p.at.x - you.x) / VIEW.w) * 100}%`,
              top: `${(at.y + (p.at.y - you.y) / VIEW.h) * 100}%`,
              width: `${((p.r * 2) / FIELD_ASPECT) * 100}%`,
              height: `${p.r * 2 * 100}%`,
              transform: `translate(-50%, -50%) scale(${(0.5 + p.ready * 0.5).toFixed(3)})`,
              opacity: p.live ? 0.9 : 0.2 + p.ready * 0.5,
            }}
          />
        ))}
        <span
          className="try-field-pet"
          style={{
            left: `${at.x * 100}%`,
            top: `${at.y * 100}%`,
            transform: `translate(-50%, calc(-100% + ${(footRoom(art) * 100).toFixed(1)}%))`,
          }}
        >
          {tall > 0 && (
            <PetView
              art={art}
              size={size}
              facing={you.facing}
              stance={you.moving ? 'run' : 'idle'}
              energy={you.moving ? 1.2 : 0.4}
              show={swing?.a.layer}
              label="your minion, at the size it is in the game"
            />
          )}
        </span>
      </div>
      <p className="muted try-field-say">
        <strong>WASD</strong> to walk · <strong>F</strong> and <strong>G</strong> to swing ·{' '}
        <strong>1 2 3</strong> for the big ones. This is its real size and its real reach.
        <button className="btn btn-ghost" onClick={onDone}>
          Done
        </button>
      </p>
    </div>
  )
}
