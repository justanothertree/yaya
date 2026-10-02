import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Drawing } from '../draw/strokes'
import { PetView } from './PetView'
import { footRoom, petCanvas } from './rig'
import { movesOf, petWide, type Attack } from './attack'
import { bakeWalk, blitBaked } from './bake'
import { minionOf } from '../park/minion'
import { FLOCK, ringOf, stepSwarm, type Mob } from '../park/swarm'
import { inSwipe } from '../park/strike'
import { TUNE } from '../park/walk'
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

/**
 * A minion on the field, with its own health.
 *
 * ⚠️ IN SCREEN-HEIGHTS, WHICH ARE ISOTROPIC, and that is the whole reason the crowd is not kept
 * in world units like the player is. A screen-height across and one down are the same number of
 * pixels; world units are not, and a flock whose separation meant different distances along x and
 * y would bunch into an oval nobody asked for. The conversion happens at the two edges — the
 * player's position going in, a hit test coming out — and nowhere in between.
 */
type Foe = Mob & { hp: number }

/** field fractions out of screen-heights, and back */
const outOf = (s: { x: number; y: number }) => ({ x: 0.5 + s.x / FIELD_ASPECT, y: 0.5 + s.y })
const intoWorld = (s: { x: number; y: number }) => ({
  x: MID.x + (s.x / FIELD_ASPECT) * VIEW.w,
  y: MID.y + s.y * VIEW.h,
})

export function TryField({ art, onDone }: { art: Drawing; onDone: () => void }) {
  const [you, setYou] = useState<Walker>(() => restingWalker(MID.x, MID.y))
  const [swing, setSwing] = useState<{ a: Attack; t: number } | null>(null)
  const [cast, setCast] = useState<{ kind: CastKind; t: number } | null>(null)
  const held = useRef<Steer>({ ...STILL })
  const want = useRef<{ swing: Attack | null; cast: CastKind | null }>({ swing: null, cast: null })
  const field = useRef<HTMLDivElement>(null)
  const [tall, setTall] = useState(0)

  /**
   * A wave of the same creature, at the size there are a lot of.
   *
   * ⚠️ THE ROLE NEEDS SOMETHING TO BE JUDGED AGAINST. minionOf is a pure derivation and its tests
   * say it is the same creature re-ranged — but whether a crowd of YOUR drawing is a crowd or a
   * wall is a question about forty things moving, and nothing but moving them answers it.
   *
   * ⚠️ BAKED, WHICH IS THE WHOLE REASON A WAVE IS POSSIBLE. Ten of a detailed creature painted
   * live costs 42ms a frame — see docs/2026-09-30-swarm-spike.md — and baked it is 800 for under
   * a millisecond, with the cost indifferent to how complicated the drawing is. Baked once here,
   * before the wave, never per spawn: a detailed creature takes 110ms to bake and that would land
   * exactly as the wave arrived.
   */
  const mob = useMemo(() => minionOf(art), [art])
  const [wave, setWave] = useState(0)
  const [left, setLeft] = useState(0)
  const crowd = useRef<Foe[]>([])
  const layer = useRef<HTMLCanvasElement>(null)
  const baked = useMemo(
    () => (tall > 0 ? bakeWalk(art, Math.max(2, tall * PARK_TALL * mob.scale)) : null),
    [art, tall, mob.scale],
  )

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

  /**
   * One step of the crowd: think, be hit, and be drawn.
   *
   * ⚠️ IN A REF AND NOT IN STATE, because fifty positions changing sixty times a second through
   * React is fifty reconciliations a frame for a picture that is painted on a canvas anyway. Only
   * the COUNT is state, because only the count is read as words.
   *
   * ⚠️ AND IT ASKS THE SAME inSwipe THE PARK DOES. A crowd that died to its own idea of a hit
   * would be a second opinion about what a swing reaches, which is the disagreement SwipePatch
   * was pulled into its own file to prevent — one sum, asked by everything.
   */
  const live = useRef({ you, swing, baked, mob, art })
  live.current = { you, swing, baked, mob, art }
  /* ⚠️ EVERYTHING FRESH COMES THROUGH THE REF, so this closes over nothing that changes and the
     loop below can hold one copy of it for its whole life. A loop rebuilt on every render is the
     shape CLAUDE.md §7 names — an effect whose dependency is rebuilt every render tears down and
     rebuilds whatever it owns, which here is the animation frame itself. */
  const runCrowd = useCallback((dt: number, clock: number) => {
    const cv = layer.current
    const now = live.current
    if (!cv) return
    const ctx = cv.getContext('2d')
    if (!ctx) return
    ctx.clearRect(0, 0, cv.width, cv.height)
    if (!crowd.current.length || !now.baked) return

    /* the player, in the crowd's own units */
    const seek = {
      x: ((now.you.x - MID.x) / VIEW.w) * FIELD_ASPECT,
      y: (now.you.y - MID.y) / VIEW.h,
    }
    const tune = {
      ...FLOCK,
      /* ⚠️ TUNE.speed is the player's own top speed in screenfuls a second, so a minion's pace is
         honestly a multiple of yours rather than a number picked to feel right */
      speed: TUNE.speed * now.mob.pace,
      apart: PARK_TALL * now.mob.scale * 1.4,
      reach: PARK_TALL * now.mob.scale * 1.6,
    }
    let alive = stepSwarm(crowd.current, seek, dt, tune)

    /* a swing fells whatever it reaches, once each — the same test the park runs */
    const facing = { x: now.you.facing >= 0 ? 1 : -1, y: 0 }
    const hit = now.swing ? strikeSwipe(now.you, facing, now.swing.a, now.swing.t) : null
    if (hit) {
      const wide = petWide(now.art) * now.mob.scale
      alive = alive.map((m) =>
        inSwipe(intoWorld(m), wide, hit) ? { ...m, hp: m.hp - now.swing!.a.bite } : m,
      )
    }
    const standing = alive.filter((m) => m.hp > 0)
    if (standing.length !== crowd.current.length) setLeft(standing.length)
    crowd.current = standing

    for (const m of standing) {
      const at = outOf(m)
      blitBaked(
        ctx,
        now.baked,
        at.x * cv.width,
        at.y * cv.height,
        clock + m.x * 0.6,
        m.vx < 0 ? -1 : 1,
      )
    }
  }, [])

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
      runCrowd(dt, now / 1000)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
    /* ⚠️ runCrowd is pinned with useCallback([]) and reads everything fresh through `live`, so
       naming it here is honest rather than a dependency that would rebuild the loop — which is
       the one thing this effect must never do. */
  }, [runCrowd])

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
        {/* ⚠️ ONE CANVAS FOR ALL OF THEM, which is what baking buys: fifty creatures are fifty
            drawImage calls into this, not fifty elements for the browser to lay out. */}
        <canvas ref={layer} className="try-field-crowd" width={1600} height={1000} aria-hidden />
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
        {/* ⚠️ THE SAME CREATURE, AT THE SIZE THERE ARE A LOT OF — see minionOf. Drawing one thing
            and then being chased by forty of it is the shortest way to find out whether what you
            drew makes a crowd or a wall, which is a question no number answers. */}
        {[12, 40].map((n) => (
          <button
            key={n}
            className="btn btn-ghost"
            onClick={() => {
              crowd.current = ringOf(n, 1234, { x: 0, y: 0 }, 1.1).map((m) => ({
                ...m,
                hp: mob.life,
              }))
              setWave(n)
              setLeft(n)
            }}
          >
            ⚔ {n} of them
          </button>
        ))}
        {wave > 0 && (
          <span>
            {left} left{left === 0 ? ' — all down' : ''}
          </span>
        )}
        <button className="btn btn-ghost" onClick={onDone}>
          Done
        </button>
      </p>
    </div>
  )
}
