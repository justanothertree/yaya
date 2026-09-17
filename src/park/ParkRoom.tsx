import { useEffect, useMemo, useRef, useState } from 'react'
import type { Drawing } from '../draw/strokes'
import { PetView } from '../pets/PetView'
import { petRatio } from '../pets/rig'
import { PET_TALL } from '../pets/play'
import {
  camWant,
  depthOf,
  easeTo,
  farFrom,
  onScreen,
  PARK,
  restingWalker,
  stepWalker,
  STILL,
  VIEW,
  walkEffort,
  type Spot,
  type Steer,
} from './walk'
import { joinPark, lookFits, SEND_HZ, type Park, type ParkState, type Someone } from './room'
import { MAX_WANDERERS, wanderAt } from './wander'
import {
  busy,
  inArea,
  restingStriker,
  shoved,
  stepStrike,
  strikeArea,
  type StrikeInput,
  type Striker,
} from './strike'
import { attacksOf, moveTable, petWide, type Attack } from '../pets/attack'
import { rigOf } from '../pets/rig'
import { lungeOf } from '../pets/fight'

/**
 * A park you walk into and find people in.
 *
 * ⚠️ NO TILES, NO PROPS, NO HATS, NO SNACKS, on purpose. The riskiest unknown in the whole idea
 * is several hand-drawn creatures moving around one persistent space over a network — not the
 * art, and not the editors, which are the parts already known to work. A bare field proves or
 * disproves the hard half in an afternoon; everything else is additive and each piece is small.
 *
 * ⚠️ THE LOOP OWNS POSITIONS AND REACT OWNS THE ROSTER. Who is here is state; where they are is
 * a ref the animation frame reads and writes directly. Fifteen packets a second per person, each
 * one causing a render, is the same mistake PartyCursors already documents not making.
 */

export type ParkPet = { name: string; art: Drawing }

/**
 * ⚠️ THE SAME BUTTONS AS A SCRAP, on purpose. Somebody who has learned that F is quick and G is
 * heavy in the ring should not have to learn a second pair for the park — and the moves behind
 * them are the same six read from the same drawing, so a different key would be a different name
 * for exactly the same thing.
 */
const HITS: Record<string, 'quick' | 'heavy'> = {
  f: 'quick',
  F: 'quick',
  g: 'heavy',
  G: 'heavy',
}

const KEYS: Record<string, keyof Steer> = {
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

/** The one park, until there is a reason for a second. */
export const PARK_ROOM = 'park'

/** Everybody on one little map, so a park bigger than a screen is not a park you get lost in. */
function MiniMap({
  cam,
  me,
  others,
  strolling,
}: {
  cam: Spot
  me: Spot
  others: Array<Spot & { id: string }>
  /**
   * ⚠️ THE WANDERERS GO ON THE MAP OR THEY MIGHT AS WELL NOT EXIST. The park is nine screens and
   * they roam all of it, so the odds of one being in your window at any moment are small — which
   * made a field that was supposed to feel inhabited feel empty, and made the creatures in it
   * something you met by luck rather than went to find. On the map they are somewhere to walk to,
   * which is the thing an open park most needs and the cheapest possible version of it.
   */
  strolling: Array<{ at: Spot }>
}) {
  return (
    <div className="park-map" aria-hidden>
      <span
        className="park-map-view"
        style={{
          left: `${cam.x * 100}%`,
          top: `${cam.y * 100}%`,
          width: `${VIEW.w * 100}%`,
          height: `${VIEW.h * 100}%`,
        }}
      />
      {strolling.map((w, i) => (
        <span
          key={'s' + i}
          className="park-map-dot is-stroll"
          style={{ left: `${w.at.x * 100}%`, top: `${w.at.y * 100}%` }}
        />
      ))}
      {others.map((o) => (
        <span
          key={o.id}
          className="park-map-dot"
          style={{ left: `${o.x * 100}%`, top: `${o.y * 100}%` }}
        />
      ))}
      <span
        className="park-map-dot is-me"
        style={{ left: `${me.x * 100}%`, top: `${me.y * 100}%` }}
      />
    </div>
  )
}

export function ParkRoom({
  pets,
  myName,
  authed,
  onControlChange,
}: {
  pets: ParkPet[]
  myName: string
  /**
   * ⚠️ RAISED ONLY WHILE WALKING, which is what makes this a prop rather than a line in the
   * games room. Everywhere else in that tab, being on the page IS playing; here you stand at the
   * gate first, and the arrow keys should still move between sections until you go in.
   */
  onControlChange?: (on: boolean) => void
  /**
   * ⚠️ A COURTESY, NOT THE RULE. The relay is what actually keeps a park members-only — its
   * socket is unauthenticated and accepts any origin, so a button this page declines to draw is
   * a button somebody can skip. This exists so a signed-out visitor is told why, rather than
   * walking into a field and waiting twelve seconds to be told no.
   */
  authed: boolean
}) {
  const field = useRef<HTMLDivElement>(null)
  /** what goes fullscreen — the field and its map, not the whole page */
  const stage = useRef<HTMLDivElement>(null)
  const [full, setFull] = useState(false)
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [pick, setPick] = useState(0)
  const [walking, setWalking] = useState(false)
  /** bumped whenever the roster changes, so the render follows without owning the positions */
  const [roster, setRoster] = useState(0)

  const mine = pets[pick] ?? pets[0]
  const tooBig = useMemo(() => (mine ? !lookFits(mine.art) : false), [mine])

  /* ⚠️ read once per creature, never per frame — rigOf walks every stroke */
  const myMoves = useMemo<Attack[]>(
    () => (mine ? moveTable(attacksOf(rigOf(mine.art))) : []),
    [mine],
  )
  const myWide = useMemo(() => (mine ? petWide(mine.art) : 0.2), [mine])
  /** the wandering creatures, in the order wanderAt indexes them */
  const strollPets = useMemo(
    () => pets.filter((_, i) => i !== pick).slice(0, MAX_WANDERERS),
    [pets, pick],
  )
  const wides = useRef<number[]>([])
  wides.current = strollPets.map((p) => petWide(p.art))

  const state = useRef<ParkState>({ me: null, here: new Map(), trouble: null })
  const park = useRef<Park | null>(null)
  const you = useRef<Striker>(restingStriker(restingWalker()))
  const held = useRef<Steer>({ ...STILL })
  const hitting = useRef<StrikeInput>({ quick: false, heavy: false, up: false, down: false })
  /** bumped when a swing starts or ends, so the render follows without owning the loop */
  const [swingAt, setSwingAt] = useState(0)
  /**
   * How far each wanderer has been knocked from its path, and how fast it is drifting back.
   *
   * ⚠️ THE PATH STAYS PURE AND THE SHOVE SITS ON TOP. A wanderer is a function of the clock —
   * that is what makes it free — so being hit cannot change where it is; it changes where it is
   * DRAWN, by an offset that decays back to nothing. Nothing accumulates, nothing drifts, and a
   * wanderer that is left alone for a second is exactly where the clock says it should be.
   */
  const nudges = useRef<Array<{ x: number; y: number; till: number }>>([])
  const [shownYou, setShownYou] = useState<Striker>(() => restingStriker(restingWalker()))
  /**
   * ⚠️ THE WINDOW EASES RATHER THAN SNAPPING, the same as the platformer's. Locked to you exactly,
   * the whole park slides under a creature that is standing still while it accelerates, and every
   * small correction is a shove to the entire picture.
   */
  const cam = useRef<Spot>({ x: 0, y: 0 })
  const [camAt, setCamAt] = useState<Spot>({ x: 0, y: 0 })
  /* the clock the wanderers are a function of — see wander.ts */
  const [clockAt, setClockAt] = useState(0)
  /* the same clock, where the loop can reach it without depending on a render */
  const clockRef = useRef(0)

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

  useEffect(() => {
    const fit = () => {
      const r = field.current?.getBoundingClientRect()
      if (r && r.width > 1) setSize({ w: Math.round(r.width), h: Math.round(r.height) })
    }
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [])

  /* fullscreen can also be left with Escape, which fires no click of ours — so follow the
     browser rather than assuming our own button is the only way out (same as the visualiser) */
  useEffect(() => {
    const onFs = () => setFull(document.fullscreenElement === stage.current)
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [])

  /**
   * ⚠️ JOINING IS A THING YOU DO, not something a page does to you. Opening a tab should not put
   * you in a room with other people and tell them your name — that is the same rule the corner
   * companion follows, and it matters more here because arriving is visible to everybody else.
   */
  useEffect(() => {
    if (!walking || !mine) return
    state.current = { me: null, here: new Map(), trouble: null }
    /* ⚠️ somewhere in the middle of the park rather than the middle of a screen, so two people
       arriving separately do not always land on top of each other */
    you.current = restingStriker(
      restingWalker(0.3 + Math.random() * 0.4, 0.35 + Math.random() * 0.4),
    )
    cam.current = camWant(you.current)
    setCamAt(cam.current)
    const bump = () => setRoster((n) => n + 1)
    const p = joinPark(PARK_ROOM, { name: myName, art: mine.art }, state.current, bump)
    if (!p) {
      state.current.trouble = 'The park is not switched on in this build'
      bump()
      return
    }
    park.current = p
    bump()
    return () => {
      p.leave()
      park.current = null
      state.current = { me: null, here: new Map(), trouble: null }
    }
  }, [walking, mine, myName])

  /* ⚠️ one per wanderer, rebuilt when the roster of them changes — an index into this must
     always mean the same creature as the same index into strollPets */
  useEffect(() => {
    nudges.current = strollPets.map(() => ({ x: 0, y: 0, till: 0 }))
  }, [strollPets])

  useEffect(() => {
    if (!walking) return
    onControlChange?.(true)
    return () => onControlChange?.(false)
  }, [walking, onControlChange])

  useEffect(() => {
    if (!walking) return
    const set = (e: KeyboardEvent, on: boolean) => {
      const hit = HITS[e.key]
      if (hit) {
        e.preventDefault()
        hitting.current[hit] = on
        return
      }
      const k = KEYS[e.key]
      if (!k) return
      e.preventDefault()
      held.current[k] = on
      /* the aim is the same two keys you already hold — see the scrap's note on the same rule */
      if (k === 'up' || k === 'down') hitting.current[k] = on
    }
    const down = (e: KeyboardEvent) => set(e, true)
    const up = (e: KeyboardEvent) => set(e, false)
    /* a key held when the window loses focus never sends its keyup — see PetPlay */
    const drop = () => {
      held.current = { ...STILL }
      hitting.current = { quick: false, heavy: false, up: false, down: false }
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', drop)
    window.addEventListener('pointerup', drop)
    window.addEventListener('pointercancel', drop)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', drop)
      window.removeEventListener('pointerup', drop)
      window.removeEventListener('pointercancel', drop)
    }
  }, [walking])

  useEffect(() => {
    if (!walking) return
    let raf = 0
    let last = performance.now()
    const started = last
    let sent = 0
    const tick = (now: number) => {
      const dt = (now - last) / 1000
      last = now
      /**
       * ⚠️ SWING FIRST, THEN WALK, and the walk is thrown away while the swing is out. A creature
       * mid-attack is committed — the same rule the scrap follows — so it keeps whatever speed it
       * had and gains none, which is what makes a long recovery cost something.
       */
      const wasSwinging = you.current.swing > 0
      const struck = stepStrike(you.current, hitting.current, myMoves, dt)
      const steer = busy(struck) ? STILL : held.current
      you.current = { ...struck, ...stepWalker(struck, steer, struck.hold > 0 ? 0 : dt) }
      if (wasSwinging !== you.current.swing > 0) setSwingAt((n) => n + 1)

      /* what my swing is hurting right now, if anything */
      const mv = myMoves[you.current.move]
      const area =
        you.current.swing > 0 && !you.current.spent && mv
          ? strikeArea(you.current, you.current.facing, mv, mv.span - you.current.swing)
          : null
      if (area && mv) {
        nudges.current.forEach((n, i) => {
          const w = wanderAt(i, clockRef.current)
          if (!inArea(w.at, wides.current[i] ?? 0.2, area)) return
          const dx = w.at.x - you.current.x
          const dy = w.at.y - you.current.y
          const len = Math.hypot(dx, dy) || 1
          const power = mv.shove * 0.06
          n.x += (dx / len) * power
          n.y += (dy / len) * power * 0.6
          n.till = clockRef.current + 0.5
          you.current = { ...you.current, spent: true, hold: 0.05 + mv.bite * 0.004 }
        })
        /* ⚠️ the other people in the park are shoved by their OWN reading of my swing, never by
           mine — see the note on hits below. Nothing here reaches across the wire. */
      }

      /**
       * ⚠️ I DECIDE WHEN I AM HIT, NOT THEM. Everybody sees a slightly different park — positions
       * arrive fifteen times a second and are eased on the way in — so two people will never quite
       * agree on whether a swing connected. Letting the swinger decide would mean being shoved by
       * somebody else's picture of where you were standing; deciding it here means the worst case
       * is that a blow you saw miss shoved them anyway, on their screen, which nobody minds.
       */
      for (const o of state.current.here.values()) {
        if (o.swing <= 0) continue
        o.swingFor += dt
        const list = foeMoves.current.get(o.id)
        const theirs = list?.[o.swing - 1]
        if (!theirs) continue
        const area = strikeArea(o.shown, o.facing, theirs, o.swingFor)
        if (!area || you.current.stun > 0) continue
        if (!inArea(you.current, myWide, area)) continue
        you.current = shoved(you.current, o.shown, theirs)
      }

      /* a nudge decays back to nothing, so the path stays the truth */
      for (const n of nudges.current) {
        const ease = Math.exp(-3.2 * Math.min(0.05, dt))
        n.x *= ease
        n.y *= ease
      }

      setShownYou(you.current)

      clockRef.current = (now - started) / 1000
      setClockAt(clockRef.current)

      const want = camWant(you.current)
      /* framerate-independent easing, not a fixed fraction per frame — see PetPlay's camera */
      const k = stillRef.current ? 1 : 1 - Math.exp(-7 * Math.min(0.05, dt))
      cam.current = {
        x: cam.current.x + (want.x - cam.current.x) * k,
        y: cam.current.y + (want.y - cam.current.y) * k,
      }
      setCamAt(cam.current)

      /**
       * ⚠️ EVERY PEER MOVES ON EVERY FRAME, not only on the frames a packet arrived. Fifteen a
       * second against sixty is three frames in four with no news, and drawing the last packet
       * on all of them is the jerk that makes a working network look broken.
       */
      for (const one of state.current.here.values()) {
        one.shown = farFrom(one.shown, one.at)
          ? one.at
          : easeTo(one.shown, one.at, dt, stillRef.current ? 60 : 14)
      }

      /* ⚠️ on a clock of its own, not once per frame: sixty positions a second is four times
         what anybody can see and four times what the relay has to forward */
      if (now - sent > 1000 / SEND_HZ) {
        sent = now
        park.current?.send(you.current, you.current.swing > 0 ? you.current.move + 1 : 0)
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [walking, myMoves, myWide])

  /* the same sizing as everywhere else — PetView's size is the LONG side, not the height */
  const petSize = (art: Drawing) => {
    const tall = Math.max(22, size.h * PET_TALL * 0.8)
    const wh = petRatio(art)
    return Math.round(wh >= 1 ? tall * wh : tall)
  }

  /**
   * Your other creatures, out for a walk of their own.
   *
   * ⚠️ WORKED OUT FROM THE CLOCK ON EVERY RENDER, which is cheap because there is nothing to
   * work out — a wanderer's position is a function of the time and its index, with no state to
   * keep and nothing to step. See wander.ts for why they are your minions rather than invented
   * people, and why nobody else can see them.
   */
  const strolling = useMemo(
    () =>
      strollPets.map((p, i) => {
        const w = wanderAt(i, clockAt)
        const n = nudges.current[i]
        /* the shove is drawn on top of the path, never written into it — see nudges */
        return { pet: p, ...w, at: { x: w.at.x + (n?.x ?? 0), y: w.at.y + (n?.y ?? 0) } }
      }),
    [strollPets, clockAt],
  )

  /**
   * What everybody else can throw, worked out from the drawing they sent.
   *
   * ⚠️ THE WIRE CARRIES A SLOT NUMBER AND NOTHING ELSE. Their creature arrived with their look,
   * so their moves are already knowable here — sending the attack itself would be sending a thing
   * this end can work out, fifteen times a second, for as long as they stand there.
   */
  const foeMoves = useRef<Map<string, Attack[]>>(new Map())

  /* read so that a swing starting or ending re-renders — see the loop */
  void swingAt
  const others: Someone[] = [...state.current.here.values()]
  for (const o of others)
    if (!foeMoves.current.has(o.id)) foeMoves.current.set(o.id, moveTable(attacksOf(rigOf(o.art))))
  /* roster is read so this recomputes when somebody joins or leaves — see the note on the loop */
  void roster
  const crowd = others.length + (walking ? 1 : 0)

  if (!pets.length) return null

  return (
    <div className="park">
      <div className="park-bar">
        {!walking ? (
          <button className="btn" disabled={tooBig || !authed} onClick={() => setWalking(true)}>
            🌳 Walk into the park
          </button>
        ) : (
          <button className="btn" onClick={() => setWalking(false)}>
            ← Leave
          </button>
        )}
        {pets.length > 1 && !walking && (
          <label className="park-seat">
            <span className="sr-only">Who to take</span>
            <select value={pick} onChange={(e) => setPick(Number(e.target.value))}>
              {pets.map((p, i) => (
                <option key={i} value={i}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {walking && (
          <span className="muted park-count">
            {crowd === 1 ? 'Nobody else here yet' : `${crowd} here`}
          </span>
        )}
        {walking && (
          <button
            className="btn btn-ghost"
            aria-pressed={full}
            title={full ? 'Leave fullscreen' : 'Fill the screen'}
            onClick={() => {
              const el = stage.current
              if (!el) return
              if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
              else void el.requestFullscreen?.().catch(() => {})
            }}
          >
            {full ? '⤡ Out' : '⛶ Fullscreen'}
          </button>
        )}
      </div>

      {/* ⚠️ A PROBLEM IS SAID OUT LOUD. A room that silently fails to connect is a room that
          looks like an empty park, and somebody waits in it for a friend who cannot arrive. */}
      {state.current.trouble && (
        <p className="muted park-trouble" role="status">
          {state.current.trouble}
        </p>
      )}
      {!authed && !walking && (
        <p className="muted park-trouble" role="status">
          The park is for people with an account. Snake is open to everybody — but in here your
          creature is drawn on everyone else's screen, and a picture is the one thing nobody can
          filter, so this one asks who you are first. <a href="#signin">Sign in</a> and walk right
          in.
        </p>
      )}
      {tooBig && !walking && (
        <p className="muted park-trouble" role="status">
          {mine?.name} is too detailed to carry into the park — everybody here has to be sent your
          creature, so there is a size limit. Something with fewer strokes will walk in fine.
        </p>
      )}

      <div className={'park-stage' + (full ? ' is-full' : '')} ref={stage}>
        <div className="park-field" ref={field}>
          {/* ⚠️ THE GROUND MOVES, NOT THE CREATURES. Everything in the park is placed by the same
              onScreen() the walkers are, so the grass, the path and the people can never disagree
              about where the middle of the world is. */}
          <span
            className="park-ground"
            style={{
              left: `${-camAt.x * PARK.across * 100}%`,
              top: `${-camAt.y * PARK.down * 100}%`,
              width: `${PARK.across * 100}%`,
              height: `${PARK.down * 100}%`,
            }}
            aria-hidden
          />
          {walking &&
            [
              /* ⚠️ IN THE SAME SORT AS EVERYBODY ELSE, so a wanderer that is nearer the camera
                 is drawn in front of you rather than always behind — they are in the park, not
                 painted on the back of it. */
              ...strolling.map((w, i) => ({
                key: 'stroll-' + i,
                name: w.pet.name,
                art: w.pet.art,
                at: w.at,
                facing: w.facing,
                moving: w.moving,
                mine: false,
                stroll: true,
                lunge: 0,
                show: undefined as number | undefined,
              })),
              ...others.map((o) => ({
                key: o.id,
                name: o.name,
                art: o.art,
                at: o.shown,
                facing: o.facing,
                moving: o.moving,
                mine: false,
                stroll: false,
                /* their swing, animated from the slot they sent and the drawing they sent */
                lunge: lungeOf(
                  { swing: o.swing > 0 ? 1 : 0, move: 0, spent: false, stun: 0, hold: 0 },
                  [],
                ),
                show: (foeMoves.current.get(o.id) ?? [])[o.swing - 1]?.layer,
              })),
              {
                key: 'me',
                name: myName,
                art: mine.art,
                at: shownYou as Spot,
                facing: shownYou.facing,
                moving: shownYou.moving,
                mine: true,
                stroll: false,
                lunge: lungeOf(shownYou, myMoves),
                show: shownYou.swing > 0 ? myMoves[shownYou.move]?.layer : undefined,
              },
            ]
              /* ⚠️ lower on the screen is nearer the camera, which in a top-down world is the
                 whole of depth — see depthOf */
              .sort((a, b) => depthOf(a.at) - depthOf(b.at))
              .map((one) => {
                const at = onScreen(one.at, camAt)
                /* ⚠️ anybody further than a screen away is simply not drawn. They are still there,
                   still moving, and still a dot on the map — but a creature at -240% is a DOM node
                   the browser lays out every frame to show nobody anything. */
                if (at.x < -0.2 || at.x > 1.2 || at.y < -0.2 || at.y > 1.2) return null
                return (
                  <span
                    key={one.key}
                    className={
                      'park-one' + (one.mine ? ' is-me' : '') + (one.stroll ? ' is-stroll' : '')
                    }
                    style={{
                      left: `${at.x * 100}%`,
                      top: `${at.y * 100}%`,
                      zIndex: depthOf(one.at),
                      /* the swing moves the picture, never the creature — see the scrap's note */
                      transform: `translate(calc(-50% + ${(one.facing * one.lunge * 100).toFixed(
                        1,
                      )}%), -100%)`,
                    }}
                  >
                    <PetView
                      art={one.art}
                      size={petSize(one.art)}
                      facing={one.facing}
                      show={one.show}
                      energy={
                        one.mine
                          ? walkEffort(shownYou, stillRef.current)
                          : one.moving
                            ? 1.2
                            : stillRef.current
                              ? 0
                              : 0.4
                      }
                      label={
                        one.stroll
                          ? `${one.name}, one of yours, having a wander`
                          : `${one.name}, in the park`
                      }
                    />
                    <span className="park-name">{one.name}</span>
                  </span>
                )
              })}
          {!walking && (
            <div className="park-empty">
              <p className="muted">
                A field three screens across, and whoever else is standing in it. Take one of your
                minions for a walk and anybody else in the park will see them.
              </p>
            </div>
          )}
        </div>

        {walking && (
          <MiniMap
            cam={camAt}
            me={shownYou}
            others={others.map((o) => ({ id: o.id, x: o.shown.x, y: o.shown.y }))}
            strolling={strolling}
          />
        )}
      </div>

      {walking && (
        <div className="park-pad">
          {(['left', 'up', 'down', 'right'] as const).map((k) => (
            <button
              key={k}
              className="pet-play-key"
              aria-label={`Walk ${k}`}
              onPointerDown={(e) => {
                e.preventDefault()
                e.stopPropagation()
                held.current[k] = true
              }}
              onPointerUp={() => (held.current[k] = false)}
              onPointerCancel={() => (held.current[k] = false)}
              onPointerLeave={() => (held.current[k] = false)}
            >
              {k === 'left' ? '◀' : k === 'right' ? '▶' : k === 'up' ? '▲' : '▼'}
            </button>
          ))}
        </div>
      )}

      <p className="muted park-keys">
        <strong>← → ↑ ↓</strong> or <strong>WASD</strong> to walk about. The park is {PARK.across}{' '}
        screens across and {PARK.down} down, so keep going and the view follows you — the little map
        shows the whole of it, where you are, and everybody else. Everyone is in the same park, so
        whoever is online is who you will meet.
        {strolling.length > 0 && (
          <> The faded ones are your own other minions having a wander — only you see those.</>
        )}
      </p>
    </div>
  )
}
