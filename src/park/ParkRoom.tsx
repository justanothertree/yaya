import { useEffect, useMemo, useRef, useState } from 'react'
import type { Drawing } from '../draw/strokes'
import { PetView } from '../pets/PetView'
import { petCanvas } from '../pets/rig'
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
import {
  joinPark,
  lookFits,
  SEND_HZ,
  type BossEcho,
  type Park,
  type ParkState,
  type Someone,
} from './room'
import { MAX_WANDERERS, wanderAt } from './wander'
import {
  busy,
  driven,
  aimFromKeys,
  aimOf,
  inSwipe,
  type Swipe,
  mauled,
  PLAYER_LIFE,
  restingStriker,
  shoved,
  stepDown,
  stepStrike,
  FOOT,
  octantOf,
  PARK_TALL,
  strikeSwipe,
  swipeTell,
  type StrikeInput,
  type Striker,
} from './strike'
import { movesOf, petWide, type Attack } from '../pets/attack'
import { footRoom, petBox } from '../pets/rig'
import { lungeOf } from '../pets/fight'
import {
  beaten,
  BOSS,
  bossMoves,
  bossThink,
  bossWide,
  makeBoss,
  ringSpot,
  stepTurn,
  wounded,
  type Boss,
} from './boss'
import { saysOf, temperOf, type Temper } from './temper'

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

/**
 * How long a beaten boss stays standing before its owner puts it away.
 *
 * ⚠️ IT HAS TO GO BY ITSELF, because a park has ONE boss and whoever called it is not
 * necessarily still looking at the screen. A boss left dead in a field nobody can replace is a
 * park with the fight switched off, ended by somebody wandering away from their keyboard.
 */
const BOSS_LINGER = 3.5

/**
 * The lunge of a swing known only as a slot and a clock.
 *
 * ⚠️ A PEER'S ATTACK HAS TO READ AS AN ATTACK. What arrives is which move is out and, kept
 * here, how long it has been out — which is exactly what phaseOf needs, so somebody else's swing
 * winds up, lunges and recovers on your screen for the same fractions of it as on theirs.
 */
const echoLunge = (a: Attack | undefined, gone: number): number =>
  a
    ? lungeOf({ swing: Math.max(0.0001, a.span - gone), move: 0, spent: false, stun: 0, hold: 0 }, [
        a,
      ])
    : 0

/**
 * A boss standing in the field.
 *
 * ⚠️ ONE COMPONENT FOR YOURS AND FOR SOMEBODY ELSE'S, because the difference between them is
 * entirely a question of which machine is doing the arithmetic. Yours is stepped here; theirs
 * arrives as a place, a facing, a slot and a fraction — and once either has been reduced to those
 * four things there is nothing left to tell them apart, which is the whole point of the echo.
 */
function BossFigure({
  name,
  art,
  at,
  cam,
  facing,
  size,
  lunge,
  show,
  hp,
  hit,
  moving,
  turning,
  aim,
}: {
  name: string
  art: Drawing
  at: Spot
  cam: Spot
  facing: number
  size: number
  lunge: number
  show: number | undefined
  /** what is LEFT of it, 0..1 */
  hp: number
  hit: boolean
  moving: boolean
  /** mid-pivot, so the window it is giving you can be seen — see stepTurn */
  turning: boolean
  /** which way its swing points, so the body leans that way too — see lungePush */
  aim: { x: number; y: number }
}) {
  const on = onScreen(at, cam)
  const done = hp <= 0
  return (
    <span
      className={
        'park-one is-boss' +
        (hit ? ' is-hit' : '') +
        (done ? ' is-beaten' : '') +
        /* ⚠️ A WINDOW NOBODY CAN SEE IS NOT A WINDOW. Turning costs the boss its swing for
           450ms, which is the reward for getting round it — and without a tell that is just a
           boss that sometimes does not attack for no visible reason. */
        (turning ? ' is-turning' : '')
      }
      style={{
        left: `${on.x * 100}%`,
        top: `${on.y * 100}%`,
        zIndex: depthOf(at),
        transform: (() => {
          const p = lungePush(lunge, aim, art, size)
          return `translate(calc(-50% + ${p.x.toFixed(1)}px), calc(-100% + ${(
            footRoom(art) * 100
          ).toFixed(1)}% + ${p.y.toFixed(1)}px))`
        })(),
      }}
    >
      <PetView
        art={art}
        size={size}
        facing={facing}
        energy={done ? 0 : moving ? 1.3 : 0.5}
        show={show}
        label={`${name}, the boss`}
      />
      {/* ⚠️ what is LEFT of it, not what it has taken. A boss has a pool rather than the three
          lives a scrap gives you, and a bar is the only honest way to say how much of a thing that
          big is still coming — and with two people hitting it, the only way to agree on it. */}
      <span className="park-life" aria-label={`${Math.round(hp * 100)}% left`}>
        <i style={{ width: `${hp * 100}%` }} />
      </span>
      <span className="park-name">{done ? `${name} — beaten` : name}</span>
    </span>
  )
}

/**
 * A swing's patch, pointed the way it was thrown.
 *
 * ⚠️ ONE COMPONENT FOR THE TELEGRAPH AND THE DEBUG BOX, because they must never disagree
 * about where a swing is — that disagreement is the whole bug this module keeps paying for.
 *
 * ⚠️ EVERYTHING IS SIZED IN SCREEN-HEIGHTS, which are isotropic in PIXELS: one screen-height
 * across and one down are the same number of pixels, because the field's width is its height
 * times the aspect and the width percentage divides that back out. That is what makes a CSS
 * rotate correct here — rotating a box whose two sides are measured in different units would
 * shear it, and a sheared hitbox is one that lies at every angle except the four it was built on.
 */
function SwipePatch({
  swipe,
  cam,
  className,
  style,
}: {
  swipe: Swipe
  cam: Spot
  className: string
  style?: React.CSSProperties
}) {
  const at = onScreen(swipe.from, cam)
  const deg = (Math.atan2(swipe.aim.y, swipe.aim.x) * 180) / Math.PI
  const long = swipe.both ? swipe.reach * 2 : swipe.reach
  return (
    <span
      className={className}
      aria-hidden
      style={{
        left: `${at.x * 100}%`,
        top: `${at.y * 100}%`,
        width: `${(long / FIELD_ASPECT) * 100}%`,
        height: `${swipe.half * 2 * 100}%`,
        transformOrigin: swipe.both ? '50% 50%' : '0 50%',
        transform: swipe.both
          ? `translate(-50%, -50%) rotate(${deg.toFixed(1)}deg)`
          : `translateY(-50%) rotate(${deg.toFixed(1)}deg)`,
        ...style,
      }}
    />
  )
}

/** The field is 16:10, and a screen-height is its height — see SwipePatch. */
const FIELD_ASPECT = 16 / 10

/**
 * A lunge, pushed along the way the swing is aimed.
 *
 * ⚠️ THE LUNGE WAS ALWAYS HORIZONTAL, because until now a creature could only attack left or
 * right. With eight directions the geometry and the telegraph turned and the BODY did not, so an
 * up-right attack had the right hitbox and a picture that still leaned sideways — the half of
 * the move that a player actually looks at.
 *
 * ⚠️ IN PIXELS, AND THAT IS THE SECOND VERSION. A CSS translate in percent is a percent of
 * the element's OWN width for x and its OWN height for y — and the element here is the WRAPPER,
 * which is the canvas plus a name tag underneath it, so its aspect is not the creature's. The
 * first version corrected by the canvas's aspect and every diagonal came out 3.9 degrees off,
 * identically on all four, which is what a systematic factor looks like rather than noise.
 *
 * Pixels have no basis to be wrong about. The lunge is a fraction of the creature's own width,
 * so one multiplication gives a displacement that is the same distance in both axes and the
 * wrapper's shape stops mattering at all.
 */
function lungePush(
  lunge: number,
  aim: { x: number; y: number },
  art: Drawing,
  size: number,
): { x: number; y: number } {
  if (!lunge) return { x: 0, y: 0 }
  const reach = petBox(art, size).w * lunge
  return { x: aim.x * reach, y: aim.y * reach }
}

/** The one park, until there is a reason for a second. */
export const PARK_ROOM = 'park'

/** Everybody on one little map, so a park bigger than a screen is not a park you get lost in. */
function MiniMap({
  cam,
  me,
  others,
  strolling,
  boss,
}: {
  cam: Spot
  me: Spot
  others: Array<Spot & { id: string }>
  /**
   * ⚠️ AND SO DOES THE BOSS, for the same reason the wanderers are on here: a fight you cannot
   * find is a fight you are not in. The Join button is the fast way over; this is the one that
   * shows you it is happening at all, and which way to walk if you would rather arrive on foot.
   */
  boss: Spot | null
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
      {boss && (
        <span
          className="park-map-dot is-boss"
          style={{ left: `${boss.x * 100}%`, top: `${boss.y * 100}%` }}
        />
      )}
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
  room = PARK_ROOM,
}: {
  pets: ParkPet[]
  myName: string
  /**
   * Which park this is.
   *
   * ⚠️ A PROP SO THE WORKBENCH CANNOT WALK INTO THE REAL ONE. There is one park and there is
   * meant to be one — see PARK_ROOM — but #dev-park exists to let a signed-out developer stand
   * on the grass, and standing on the grass in the room the family is using is not a workbench,
   * it is an uninvited stranger with a test creature. Defaulted, so every real caller is
   * unchanged and nothing has to remember to pass it.
   */
  room?: string
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
  /**
   * ⚠️ THE DRAWING, NOT THE WRAPPER AROUND IT, is what the socket depends on. The effect below
   * owns the connection and uses only the art and the name — so depending on the object that
   * holds them makes the park reconnect every time somebody upstream rebuilds that object, which
   * is a bug this has already had once. GamesRoom memoises its side; this is the other half, and
   * it is the half that cannot be broken from outside.
   */
  const myArt = mine?.art
  const tooBig = useMemo(() => (myArt ? !lookFits(myArt) : false), [myArt])

  /* ⚠️ read once per creature, never per frame — rigOf walks every stroke */
  const myMoves = useMemo<Attack[]>(() => (myArt ? movesOf(myArt) : []), [myArt])
  const boss = useRef<Boss | null>(null)
  const [bossShown, setBossShown] = useState<Boss | null>(null)
  const [bossPick, setBossPick] = useState(0)
  /** when your boss was beaten, so it can take itself away — see BOSS_LINGER */
  const bossDoneAt = useRef(0)
  /**
   * What somebody else's boss can throw, worked out once from the drawing they sent.
   *
   * ⚠️ THE SAME BARGAIN AS A PEER'S MOVE TABLE. Its drawing arrived when it was called out, so
   * its reach, timing and bite are already knowable here — and rigOf walks every stroke, which is
   * not a thing to do sixty times a second for a creature that has not changed.
   */
  const echoKit = useRef<{
    by: string
    moves: Attack[]
    wide: number
    /**
     * ⚠️ WORKED OUT HERE, NOT SENT. A boss's size, health, pace and nerve are a pure function
     * of its drawing — which arrived when it was called out — so both ends reach the same answer
     * from the same picture with nothing about it on the wire. What matters is that this end uses
     * the SAME scale the host does: reach is multiplied by it, so a remote boss sized at a
     * constant would have a hitbox that disagreed with the one hitting you.
     */
    temper: Temper
  } | null>(null)
  const myWide = useMemo(() => (myArt ? petWide(myArt) : 0.2), [myArt])

  /* ⚠️ the drawing again, not the wrapper — this one feeds the animation loop's deps, and a
     loop rebuilt every render is a loop whose clock starts again every render */
  const bossArt = (pets[bossPick] ?? pets[0])?.art
  const bossKit = useMemo(
    () =>
      bossArt
        ? { moves: bossMoves(bossArt), wide: bossWide(bossArt), temper: temperOf(bossArt) }
        : null,
    [bossArt],
  )

  /** the wandering creatures, in the order wanderAt indexes them */
  const strollPets = useMemo(
    () => pets.filter((_, i) => i !== pick).slice(0, MAX_WANDERERS),
    [pets, pick],
  )
  const wides = useRef<number[]>([])
  wides.current = strollPets.map((p) => petWide(p.art))

  const state = useRef<ParkState>({ me: null, here: new Map(), boss: null, trouble: null })
  const park = useRef<Park | null>(null)
  const you = useRef<Striker>(restingStriker(restingWalker()))
  /**
   * Seconds left of being knocked out, 0 when you are on your feet.
   *
   * ⚠️ A REF DRIVEN PER FRAME, A STATE FLIPPED TWICE. The countdown belongs with everything
   * else the loop owns; only going down and getting up are worth a render, which is what
   * `knocked` is for.
   */
  const downFor = useRef(0)
  const [knocked, setKnocked] = useState(false)
  /**
   * A thing to hit that hits nothing back.
   *
   * ⚠️ BECAUSE YOU CANNOT TUNE A SWING AGAINST SOMETHING THAT MOVES. A boss circles, backs
   * off and swings back, so "did that land" and "was it even still there" are the same question
   * — which is most of why the reach of a move is hard to feel. A dummy stands exactly still and
   * counts, so the only variable left is the swing.
   *
   * ⚠️ A REF FOR THE POSITION, A STATE FOR WHAT IS DRAWN, the same split everything else in
   * this loop uses: the hit test runs sixty times a second and a render does not.
   */
  const dummy = useRef<{ x: number; y: number; hurt: number; hits: number; lit: number } | null>(
    null,
  )
  const [dummyShown, setDummyShown] = useState<{
    x: number
    y: number
    hurt: number
    hits: number
    lit: number
  } | null>(null)
  /**
   * ⚠️ DRAWN FROM THE SAME CALLS THE HIT TEST MAKES, which is the whole point of it. A debug
   * overlay that draws its own idea of a hitbox is a second implementation, and a second
   * implementation is the thing that was wrong in the first place — the maker's preview and the
   * park disagreed by 43% on a tail sweep and nobody could see it. These boxes come out of
   * strikeArea and footOf, so if they are wrong the game is wrong in exactly the same way.
   */
  /**
   * Where the boss is about to hit, and how close that is — see strikeTell.
   *
   * ⚠️ A STATE RATHER THAN A REF, because unlike the debug boxes this is always on and has
   * to redraw. It is one small object a frame, set beside setShownYou which already runs every
   * frame, so it costs a render that was happening anyway.
   */
  const [tell, setTell] = useState<{ swipe: Swipe; ready: number } | null>(null)
  const [debug, setDebug] = useState(false)
  /* the loop is installed once; a ref is how a toggle reaches inside it without rebuilding it */
  const debugRef = useRef(false)
  debugRef.current = debug
  const boxesOn = useRef(false)
  const [feet, setFeet] = useState<Array<{ k: string; at: Spot; wide: number; scale: number }>>([])
  const [swings, setSwings] = useState<Array<{ k: string; swipe: Swipe }>>([])
  const held = useRef<Steer>({ ...STILL })
  const hitting = useRef<StrikeInput>({ quick: false, heavy: false, up: false, down: false })
  /** bumped when a swing starts or ends, so the render follows without owning the loop */
  const [swingAt, setSwingAt] = useState(0)
  /**
   * The boss, if one has been called out.
   *
   * ⚠️ A ROLE, NOT A KIND. It is one of your own minions — the same drawing, the same rig, the
   * same moves read from the same layer names — stood up bigger with a pool of health and
   * something that actually plays behind it. See boss.ts for why that is the design rather than
   * the shortcut.
   *
   * ⚠️ AND IT IS YOURS ALONE FOR NOW. Nothing about it crosses the wire, so you and a friend in
   * the same park are each fighting your own. Sharing one is the next piece and needs somebody to
   * own its state — saying that out loud beats letting two people wonder why their hits disagree.
   */
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
    if (!walking || !myArt) return
    state.current = { me: null, here: new Map(), boss: null, trouble: null }
    /* ⚠️ somewhere in the middle of the park rather than the middle of a screen, so two people
       arriving separately do not always land on top of each other */
    you.current = restingStriker(
      restingWalker(0.3 + Math.random() * 0.4, 0.35 + Math.random() * 0.4),
    )
    cam.current = camWant(you.current)
    setCamAt(cam.current)
    const bump = () => setRoster((n) => n + 1)
    const p = joinPark(room, { name: myName, art: myArt }, state.current, bump)
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
      state.current = { me: null, here: new Map(), boss: null, trouble: null }
      /* the relay drops your boss when your socket goes; this is the same thing on this side */
      boss.current = null
      setBossShown(null)
    }
  }, [walking, myArt, myName, room])

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
      /**
       * ⚠️ THE AIM IS TAKEN ON THE FRAME THE SWING STARTS and not touched again. Reading the
       * keys every frame would let you steer a live hitbox round somebody after committing to
       * it, which is the same unfairness the frozen position and locked facing already refuse.
       */
      if (!wasSwinging && struck.swing > 0)
        struck.aim = aimFromKeys(held.current, { x: you.current.facing, y: 0 })
      const steer = busy(struck) ? STILL : held.current
      you.current = { ...struck, ...stepWalker(struck, steer, struck.hold > 0 ? 0 : dt) }
      /* ⚠️ and the move carries you, if it is one that does — see Attack.drive */
      you.current = driven(you.current, myMoves[you.current.move], struck.hold > 0 ? 0 : dt)
      if (wasSwinging !== you.current.swing > 0) setSwingAt((n) => n + 1)

      /* what my swing is hurting right now, if anything */
      const mv0 = myMoves[you.current.move]
      const area0 =
        you.current.swing > 0 && !you.current.spent && mv0
          ? strikeSwipe(you.current, you.current.aim, mv0, mv0.span - you.current.swing)
          : null
      const area = area0
      const mv = mv0
      if (area && mv) {
        nudges.current.forEach((n, i) => {
          const w = wanderAt(i, clockRef.current)
          if (!inSwipe(w.at, wides.current[i] ?? 0.2, area)) return
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

        /* ⚠️ the dummy is hit by the SAME inArea the boss is, with the same footprint sum, so
           landing one on it means the same thing as landing one on anything else */
        const d = dummy.current
        if (d && !you.current.spent && inSwipe(d, myWide, area)) {
          dummy.current = { ...d, hurt: d.hurt + mv.bite, hits: d.hits + 1, lit: 0.18 }
          you.current = { ...you.current, spent: true, hold: 0.05 + mv.bite * 0.004 }
        }
      }
      if (dummy.current && dummy.current.lit > 0)
        dummy.current = { ...dummy.current, lit: Math.max(0, dummy.current.lit - dt) }

      /**
       * The boss takes its turn: it thinks, it walks, it swings, and it is hit.
       *
       * ⚠️ THROUGH THE SAME stepStrike AND stepWalker A PERSON IS, so it cannot do anything you
       * could not — no extra speed, no attack from nowhere, no turning mid-swing. What it has
       * over you is reach and health, both of which you can see.
       */
      /**
       * ⚠️ THE RELAY SAYS WHOSE BOSS IT IS, AND IT SAYS SO AFTER THE FACT. Pressing the button
       * stands one up on this screen immediately, because waiting a round trip for permission
       * would put the network in front of every boss anybody ever calls. If somebody else won
       * that race the relay hands us theirs — and this is where ours steps aside, which is the
       * whole of the arbitration on this side.
       */
      if (boss.current && state.current.boss) {
        boss.current = null
        setBossShown(null)
        bossDoneAt.current = 0
      }

      const bs = boss.current
      if (bs && bossKit) {
        /* ⚠️ a local, not the ref: everything below reads what the line above it produced, and a
           ref that might have been set to null cannot be narrowed by a compiler reading in order */
        let cur: Boss = { ...bs, think: bs.think + dt }
        /**
         * ⚠️ IT FIGHTS WHOEVER IS NEAREST, NOT WHOEVER CALLED IT. A boss that only ever chased
         * its owner walks away from the friend who just joined and swings at somebody a screen
         * behind them — which turns a fight two people are in into two people taking turns being
         * ignored. Everybody's position is already here to draw them with; picking the closest is
         * the whole cost of making the boss agree that this is one fight.
         */
        let target: Spot = you.current
        let near = (you.current.x - cur.x) ** 2 + (you.current.y - cur.y) ** 2
        for (const o of state.current.here.values()) {
          const d = (o.shown.x - cur.x) ** 2 + (o.shown.y - cur.y) ** 2
          if (d < near) {
            near = d
            target = o.shown
          }
        }
        const plan = bossThink(cur, target, bossKit.moves)
        /**
         * ⚠️ COMING ABOUT COSTS IT THE SWING, which is the whole point of it costing anything
         * — see stepTurn. A turn it could attack through would be a turn you cannot punish, and
         * then getting behind it buys position without buying time, which is what it did before.
         *
         * ⚠️ WORKED OUT BEFORE stepStrike RUNS, because the input has to be suppressed on the
         * way in. Cancelling a swing after the fact would let it start one on the frame it began
         * turning, and a swing that comes out backwards is worse than no swing at all.
         */
        const spun = stepTurn(cur, target.x, busy(cur), dt)
        const bHit = spun.turning
          ? { quick: false, heavy: false, up: false, down: false }
          : plan.hit
        const wasSwing = cur.swing > 0
        const struckBoss = stepStrike(cur, bHit, bossKit.moves, dt)
        /**
         * ⚠️ IT AIMS AT YOU, NOT ALONG ITSELF. A boss can still only FACE two ways, because a
         * drawing mirrors and does not rotate — but WHERE it swings is a separate question, and
         * tying the two together is what made every fight a line. Snapped to the same eight a
         * player gets, and fixed on the frame the swing starts, like theirs.
         */
        if (!wasSwing && struckBoss.swing > 0)
          struckBoss.aim = aimOf(target.x - cur.x, target.y - cur.y, { x: cur.facing, y: 0 })
        const bSteer = busy(struckBoss) ? STILL : { ...STILL, ...plan.steer }
        const walked = stepWalker(
          struckBoss,
          bSteer,
          struckBoss.hold > 0 ? 0 : dt,
          /* its own pace, and half again when it is running at somebody — see bossThink */
          plan.speed,
        )
        /* ⚠️ mid-swing it keeps the way it was looking, because a creature that only faced the
           way it walked would back away and then swing at nothing — stepTurn owns the rest */
        const facing = struckBoss.swing > 0 ? cur.facing : spun.facing
        /* ⚠️ cur first: stepStrike and stepWalker each return only the part they own, so
           spreading them alone would quietly drop the name, the art and the health */
        cur = { ...cur, ...struckBoss, ...walked, facing, turn: spun.turn }
        /* the same rule a player travels by — see driven */
        cur = { ...cur, ...driven(cur, bossKit.moves[cur.move], struckBoss.hold > 0 ? 0 : dt) }

        /* its swing against me */
        const bm = bossKit.moves[cur.move]
        if (cur.swing > 0 && !cur.spent && bm) {
          const area = strikeSwipe(cur, cur.aim, bm, bm.span - cur.swing, cur.scale)
          if (area && you.current.stun <= 0 && inSwipe(you.current, myWide, area)) {
            /* ⚠️ mauled, not shoved — a boss is the one thing allowed to take health off */
            you.current = mauled(you.current, cur, bm)
            cur = { ...cur, spent: true }
          }
        }

        /* and mine against it — one swing is one hit, so a swipe that already caught a
           wanderer does not also land on the boss */
        if (
          area0 &&
          mv0 &&
          !you.current.spent &&
          !beaten(cur) &&
          inSwipe(cur, bossKit.wide, area0, cur.scale)
        ) {
          cur = wounded(cur, mv0)
          you.current = { ...you.current, spent: true, hold: 0.06 + mv0.bite * 0.004 }
        }

        /* ⚠️ A BEATEN BOSS TAKES ITSELF AWAY. One park has one boss, and whoever called it is
           not necessarily still at the keyboard — see BOSS_LINGER. */
        if (beaten(cur) && !bossDoneAt.current) bossDoneAt.current = now / 1000
        if (bossDoneAt.current && now / 1000 - bossDoneAt.current > BOSS_LINGER) {
          boss.current = null
          setBossShown(null)
          bossDoneAt.current = 0
          park.current?.callBoss('', null)
        } else {
          boss.current = cur
          setBossShown(cur)
        }
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
        if (o.spent) continue
        const list = foeMoves.current.get(o.id)
        const theirs = list?.[o.swing - 1]
        if (!theirs) continue
        const area = strikeSwipe(o.shown, { x: o.facing, y: 0 }, theirs, o.swingFor)
        if (!area) continue
        /**
         * ⚠️ AND WHOEVER CALLED THE BOSS DECIDES WHAT IT TAKES. Everybody's swing is tested
         * against the boss on the one machine running it, using the attacker's OWN drawing — so
         * a friend's hit is worth exactly what their creature's move is worth, and no damage
         * number ever crosses the wire for anybody to make up. It costs them the lag before the
         * bar moves, and buys one health bar that both of you believe.
         */
        const b = boss.current
        if (b && bossKit && !beaten(b) && inSwipe(b, bossKit.wide, area, b.scale)) {
          boss.current = wounded(b, theirs)
          setBossShown(boss.current)
          o.spent = true
          continue
        }
        if (you.current.stun > 0) continue
        if (!inSwipe(you.current, myWide, area)) continue
        you.current = shoved(you.current, o.shown, theirs)
        o.spent = true
      }

      /**
       * Somebody else's boss: eased into place, and dangerous.
       *
       * ⚠️ IT HITS ME HERE, THE SAME WAY EVERYBODY ELSE DOES. The machine running the boss does
       * not get to decide when it has hit you, for exactly the reason a peer does not. What
       * arrives is where it is and which move is out; whether that reached you is answered on
       * your own screen, against your own position, out of its own drawing's reach.
       */
      const tb = state.current.boss
      if (tb) {
        if (echoKit.current?.by !== tb.by)
          echoKit.current = {
            by: tb.by,
            moves: bossMoves(tb.art),
            wide: bossWide(tb.art),
            temper: temperOf(tb.art),
          }
        const kit = echoKit.current
        tb.shown = farFrom(tb.shown, tb.at)
          ? tb.at
          : easeTo(tb.shown, tb.at, dt, stillRef.current ? 60 : 14)
        const theirMove = tb.swing > 0 ? kit.moves[tb.swing - 1] : undefined
        if (theirMove) {
          tb.swingFor += dt
          if (!tb.spent) {
            const area = strikeSwipe(tb.shown, tb.aim, theirMove, tb.swingFor, kit.temper.scale)
            if (area && you.current.stun <= 0 && inSwipe(you.current, myWide, area)) {
              /* somebody else's boss is still a boss — see mauled */
              you.current = mauled(you.current, tb.shown, theirMove)
              tb.spent = true
            }
          }
        }
        /* ⚠️ MY HIT ON IT IS FELT HERE AND COUNTED THERE. The freeze lands on this frame so the
           swing has weight; the bar moves when the machine running the boss says so, a fraction of
           a second later. Taking the health off locally as well would be showing a number that is
           about to be contradicted by the only one that counts. */
        if (
          area0 &&
          mv0 &&
          !you.current.spent &&
          tb.hp > 0 &&
          inSwipe(tb.shown, kit.wide, area0, kit.temper.scale)
        )
          you.current = { ...you.current, spent: true, hold: 0.06 + mv0.bite * 0.004 }
      }

      /* a nudge decays back to nothing, so the path stays the truth */
      for (const n of nudges.current) {
        const ease = Math.exp(-3.2 * Math.min(0.05, dt))
        n.x *= ease
        n.y *= ease
      }

      setDummyShown(dummy.current)

      /**
       * ⚠️ THE TELEGRAPH IS PART OF THE GAME, NOT OF THE DEBUG VIEW. Reported after playing:
       * the boxes were "currently required to win". The wind-up was already 320ms; what was
       * missing was anything on screen saying what those 320ms were FOR.
       */
      {
        const b = boss.current
        const bm = b && bossKit ? bossKit.moves[b.move] : null
        const t =
          b && bm && b.swing > 0 ? swipeTell(b, b.aim, bm, bm.span - b.swing, b.scale) : null
        const tb = state.current.boss
        const tm = tb && echoKit.current ? echoKit.current.moves[tb.swing - 1] : null
        const t2 =
          !t && tb && tm
            ? swipeTell(
                tb.shown,
                tb.aim,
                tm,
                tb.swingFor,
                echoKit.current?.temper.scale ?? BOSS.scale,
              )
            : null
        setTell(t ?? t2)
      }

      /**
       * ⚠️ BUILT ONLY WHILE IT IS ON, and out of the very calls the hit test just made. Every
       * box here is a strikeArea or a footOf, so there is no second opinion to drift — what is
       * drawn is what you are hit by, by construction rather than by agreement.
       */
      if (debugRef.current) {
        const f: Array<{ k: string; at: Spot; wide: number; scale: number }> = [
          { k: 'me', at: you.current, wide: myWide, scale: 1 },
        ]
        const sw: Array<{ k: string; swipe: Swipe }> = []
        if (area0) sw.push({ k: 'my-swing', swipe: area0 })
        const d = dummy.current
        if (d) f.push({ k: 'dummy', at: d, wide: myWide, scale: 1 })
        const b = boss.current
        if (b && bossKit) {
          f.push({ k: 'boss', at: b, wide: bossKit.wide, scale: b.scale })
          const bm = bossKit.moves[b.move]
          if (b.swing > 0 && bm) {
            const ba = strikeSwipe(b, b.aim, bm, bm.span - b.swing, b.scale)
            if (ba) sw.push({ k: 'boss-swing', swipe: ba })
          }
        }
        setFeet(f)
        setSwings(sw)
      } else if (boxesOn.current) {
        setFeet([])
        setSwings([])
      }
      boxesOn.current = debugRef.current

      /* ⚠️ only a boss can fill the pool that this reads — see mauled and stepDown */
      const fall = stepDown(downFor.current, you.current, dt)
      downFor.current = fall.down
      you.current = fall.s
      if (fall.went) setKnocked(fall.went === 'down')

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
        /* ⚠️ THE BOSS GOES OUT AT THE SAME RATE AS A WALK AND NO FASTER — it is one more
           creature moving in the park, and fifteen a second is what everything else in here
           costs. What is left of it rides along as a fraction, so the relay never learns how
           much health a boss has. */
        const mineOut = boss.current
        if (mineOut)
          park.current?.stepBoss(
            mineOut,
            mineOut.facing,
            mineOut.swing > 0 ? mineOut.move + 1 : 0,
            mineOut.lifeMax > 0 ? mineOut.life / mineOut.lifeMax : 0,
            mineOut.turn > 0,
            octantOf(mineOut.aim),
          )
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [walking, myMoves, myWide, bossKit])

  /* the same sizing as everywhere else — PetView's size is the LONG side, not the height */
  /* ⚠️ the CREATURE is this tall, not its canvas — see petCanvas */
  const petSize = (art: Drawing) => petCanvas(art, Math.max(22, size.h * PET_TALL * 0.8))

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
    if (!foeMoves.current.has(o.id)) foeMoves.current.set(o.id, movesOf(o.art))
  /* roster is read so this recomputes when somebody joins or leaves — see the note on the loop */
  void roster
  /* somebody else's boss, which this screen echoes rather than runs — see BossEcho */
  const theirBoss: BossEcho | null = state.current.boss

  /**
   * What the picture will fight like, or what the one in the field is fighting like.
   *
   * ⚠️ THE TEMPER THAT IS ACTUALLY IN USE, never a fresh reading. bossShown carries the temper
   * it was built with and the echo's kit carries the one its hitboxes use — reading the drawing
   * again here would be a second answer free to drift from the one doing the hitting.
   */
  const bossSays = (() => {
    if (bossShown) return `${bossShown.name} — ${saysOf(bossShown.temper)}`
    if (theirBoss) {
      const t = echoKit.current?.by === theirBoss.by ? echoKit.current.temper : null
      return t ? `${theirBoss.name} — ${saysOf(t)}` : null
    }
    if (!bossKit || !bossArt) return null
    const who = (pets[bossPick] ?? pets[0])?.name ?? 'It'
    return `${who} as a boss: ${saysOf(bossKit.temper)} ${bossKit.temper.life} health.`
  })()
  const theirMove =
    theirBoss && echoKit.current?.by === theirBoss.by && theirBoss.swing > 0
      ? echoKit.current.moves[theirBoss.swing - 1]
      : undefined
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
        {walking && pets.length > 0 && !theirBoss && (
          <button
            className="btn"
            onClick={() => {
              if (boss.current) {
                boss.current = null
                setBossShown(null)
                bossDoneAt.current = 0
                park.current?.callBoss('', null)
                return
              }
              const art = pets[bossPick] ?? pets[0]
              /* ⚠️ a little way off rather than on top of you, so a boss arriving is something
                 you walk towards rather than something that lands on your head */
              boss.current = makeBoss(art.name, art.art, {
                x: Math.max(0.05, Math.min(0.95, you.current.x + 0.1)),
                y: you.current.y,
              })
              bossDoneAt.current = 0
              setBossShown(boss.current)
              /* ⚠️ AND EVERYBODY ELSE IS TOLD AT ONCE. A boss too detailed to send is refused by
                 the relay, which answers with the reason — the same door a look goes through. */
              if (lookFits(art.art)) park.current?.callBoss(art.name, art.art)
              else
                state.current.trouble = `${art.name} is too detailed to stand up where everybody can see — something with fewer strokes will.`
            }}
            title={
              bossShown
                ? 'Send it away'
                : 'Stand one of your minions up for everybody in the park to fight'
            }
          >
            {bossShown ? '✕ Boss away' : '☠ Call a boss'}
          </button>
        )}
        {/* ⚠️ A THING TO HIT THAT DOES NOT MOVE. See the note on `dummy`: against anything
            that circles, "did that land" and "was it still there" are one question. */}
        {walking && (
          <button
            className={'btn' + (dummyShown ? ' is-on' : '')}
            aria-pressed={!!dummyShown}
            onClick={() => {
              if (dummy.current) {
                dummy.current = null
                setDummyShown(null)
                return
              }
              /* just inside a comfortable swing, so the first press lands without walking */
              const at = {
                x: Math.min(1 - 0.04 * VIEW.w, you.current.x + 0.06 * VIEW.w),
                y: you.current.y,
                hurt: 0,
                hits: 0,
                lit: 0,
              }
              dummy.current = at
              setDummyShown(at)
            }}
            title="Stand a target in front of you that never moves and never hits back"
          >
            {dummyShown ? '✕ Dummy away' : '🎯 Hit dummy'}
          </button>
        )}
        {walking && (
          <button
            className={'btn' + (debug ? ' is-on' : '')}
            aria-pressed={debug}
            onClick={() => setDebug((v) => !v)}
            title="Draw the boxes the hit test actually uses"
          >
            {debug ? '✕ Boxes off' : '▦ Show hitboxes'}
          </button>
        )}
        {/* ⚠️ JOINING IS A BUTTON, NOT A WALK. The park is nine screens; a boss is in one of
            them, and a fight you have to find is a fight you mostly miss — see ringSpot. */}
        {walking && theirBoss && (
          <button
            className="btn"
            onClick={() => {
              const b = state.current.boss
              if (!b) return
              const spot = ringSpot(
                b.shown,
                others.length,
                (echoKit.current?.by === b.by ? echoKit.current.moves[0]?.reach : 0) || 1,
                echoKit.current?.by === b.by ? echoKit.current.temper.scale : undefined,
              )
              you.current = { ...you.current, x: spot.x, y: spot.y, vx: 0, vy: 0 }
              setShownYou(you.current)
              cam.current = camWant(you.current)
              setCamAt(cam.current)
            }}
            title={`Stand next to ${theirBoss.name}`}
          >
            ⚔ Join the fight
          </button>
        )}
        {walking && pets.length > 1 && !bossShown && !theirBoss && (
          <label className="park-seat">
            <span className="sr-only">Which minion to fight</span>
            <select value={bossPick} onChange={(e) => setBossPick(Number(e.target.value))}>
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

      {/*
        ⚠️ WHAT THE DRAWING TURNED INTO, SAID OUT LOUD BEFORE YOU CALL IT. A boss's size, health,
        pace, nerve and preferred range all come out of the picture — and a reading nobody is shown
        is a reading nobody can act on. This is the same job the maker's move list does for a
        creature: the rig was invisible until the preview existed.

        ⚠️ AND IT DESCRIBES THE ONE THAT IS OUT once there is one, including somebody else's,
        because the answer to "why is this thing so fast" should be on the screen it is fast on.
      */}
      {walking && bossSays && (
        <p className="muted park-says" role="status">
          {bossSays}
        </p>
      )}

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
                /* a wanderer never swings, so this is only here to keep the list one shape */
                aim: { x: w.facing, y: 0 },
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
                /* ⚠️ a peer's aim is not on the wire, only their facing — so their lunge is
                   straight ahead, exactly as it was before any of this. It costs nothing: a
                   neighbour's swing shoves and cannot hurt you, so there is no reading to get
                   wrong. The boss, which CAN hurt you, does send its aim. */
                aim: { x: o.facing, y: 0 },
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
                aim: shownYou.aim,
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
                      'park-one' +
                      (one.mine ? ' is-me' : '') +
                      (one.stroll ? ' is-stroll' : '') +
                      (one.mine && knocked ? ' is-down' : '')
                    }
                    style={{
                      left: `${at.x * 100}%`,
                      top: `${at.y * 100}%`,
                      zIndex: depthOf(one.at),
                      /* the swing moves the picture, never the creature — see the scrap's note */
                      transform: (() => {
                        const p = lungePush(one.lunge, one.aim, one.art, petSize(one.art))
                        return `translate(calc(-50% + ${p.x.toFixed(1)}px), calc(-100% + ${(
                          footRoom(one.art) * 100
                        ).toFixed(1)}% + ${p.y.toFixed(1)}px))`
                      })(),
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
                    {/* ⚠️ ONLY ONCE SOMETHING HAS HIT YOU, and only a boss can. A bar over
                        everybody at all times is four bars on a field where three of the
                        creatures are out for a walk — this appears on the blow that makes it
                        mean something, and goes again when you get back up. */}
                    {one.mine && shownYou.hurt > 0 && (
                      <span
                        className="park-life is-mine"
                        aria-label={`${Math.max(0, Math.round((1 - shownYou.hurt / PLAYER_LIFE) * 100))}% left`}
                      >
                        <i
                          style={{
                            width: `${Math.max(0, Math.min(1, 1 - shownYou.hurt / PLAYER_LIFE)) * 100}%`,
                          }}
                        />
                      </span>
                    )}
                    <span className="park-name">
                      {one.mine && knocked ? `${one.name} — down` : one.name}
                    </span>
                  </span>
                )
              })}
          {/**
           * The dummy, and the boxes.
           *
           * ⚠️ DRAWN LAST so they sit over everything — an overlay you have to look behind is
           * not an overlay. Both are positioned through the same onScreen the creatures are, so
           * a box lines up with the thing it belongs to at every camera position.
           */}
          {/**
           * ⚠️ UNDER EVERYTHING, because it is the ground lighting up rather than a thing in
           * the air — drawn before the creatures so they stand on it. The debug boxes go over
           * the top; this goes beneath, which is most of what tells them apart at a glance.
           */}
          {walking && tell && (
            <SwipePatch
              swipe={tell.swipe}
              cam={camAt}
              className="park-tell"
              style={{ opacity: 0.25 + tell.ready * 0.6 }}
            />
          )}
          {walking && dummyShown && (
            <span
              className={'park-dummy' + (dummyShown.lit > 0 ? ' is-hit' : '')}
              style={{
                left: `${onScreen(dummyShown, camAt).x * 100}%`,
                top: `${onScreen(dummyShown, camAt).y * 100}%`,
                zIndex: depthOf(dummyShown),
              }}
            >
              <span className="park-dummy-post" aria-hidden />
              <span className="park-name">
                {dummyShown.hits} hit{dummyShown.hits === 1 ? '' : 's'} ·{' '}
                {Math.round(dummyShown.hurt)}
              </span>
            </span>
          )}
          {/* ⚠️ the feet are ELLIPSES here because that is what inSwipe tests against — see
              footSpan. Drawing the box they used to be would be drawing a shape nothing uses. */}
          {walking &&
            debug &&
            feet.map((f) => {
              const at = onScreen(f.at, camAt)
              const rx = (f.wide * 0.8 * f.scale) / 2
              const ry = (FOOT.deep * PARK_TALL * f.scale) / 2
              return (
                <span
                  key={f.k}
                  className="park-box is-foot"
                  aria-hidden
                  style={{
                    left: `${at.x * 100}%`,
                    top: `${at.y * 100}%`,
                    width: `${((rx * 2) / FIELD_ASPECT) * 100}%`,
                    height: `${ry * 2 * 100}%`,
                    transform: 'translate(-50%, -50%)',
                    borderRadius: '50%',
                  }}
                />
              )
            })}
          {walking &&
            debug &&
            swings.map((w) => (
              <SwipePatch key={w.k} swipe={w.swipe} cam={camAt} className="park-box is-hit" />
            ))}
          {walking && bossShown && (
            <BossFigure
              name={bossShown.name}
              art={bossShown.art}
              at={bossShown}
              cam={camAt}
              facing={bossShown.facing}
              size={petSize(bossShown.art) * bossShown.scale}
              lunge={lungeOf(bossShown, bossKit?.moves ?? [])}
              show={bossShown.swing > 0 ? (bossKit?.moves ?? [])[bossShown.move]?.layer : undefined}
              turning={bossShown.turn > 0}
              aim={bossShown.aim}
              hp={bossShown.lifeMax > 0 ? bossShown.life / bossShown.lifeMax : 0}
              hit={bossShown.hold > 0}
              moving={bossShown.moving}
            />
          )}
          {walking && theirBoss && (
            <BossFigure
              name={theirBoss.name}
              art={theirBoss.art}
              at={theirBoss.shown}
              cam={camAt}
              facing={theirBoss.facing}
              turning={theirBoss.turning}
              aim={theirBoss.aim}
              size={petSize(theirBoss.art) * (echoKit.current?.temper.scale ?? 2.6)}
              lunge={echoLunge(theirMove, theirBoss.swingFor)}
              show={theirMove?.layer}
              hp={theirBoss.hp}
              hit={false}
              /* it is walking if where it says it is has got ahead of where it is drawn */
              moving={
                Math.abs(theirBoss.at.x - theirBoss.shown.x) +
                  Math.abs(theirBoss.at.y - theirBoss.shown.y) >
                0.0006
              }
            />
          )}
          {!walking && (
            <div className="park-empty">
              <p className="muted">
                A field three screens across, and whoever else is standing in it. Take one of your
                minions for a walk and anybody else in the park will see them.
              </p>
            </div>
          )}
          {/* ⚠️ INSIDE THE FIELD, NOT BESIDE IT. It pins to the top-right of whatever box it sits
              in, and the field is no longer always as wide as the stage — so out here it drifted
              off the corner of the world it is a map of, and did so in fullscreen already. */}
          {walking && (
            <MiniMap
              cam={camAt}
              me={shownYou}
              others={others.map((o) => ({ id: o.id, x: o.shown.x, y: o.shown.y }))}
              strolling={strolling}
              boss={bossShown ?? theirBoss?.shown ?? null}
            />
          )}
        </div>
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
        )}{' '}
        <strong>F</strong> and <strong>G</strong> swing, the same six moves your creature has
        anywhere else. Call a boss and one of your own minions stands up big with a health bar,
        where <em>everybody</em> in the park can see it and hit it — one boss at a time, run by
        whoever called it, and it goes when they do.
      </p>
    </div>
  )
}
