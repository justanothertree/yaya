import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { Drawing } from '../draw/strokes'
import { PetView } from '../pets/PetView'
import { petCanvas, rigOf } from '../pets/rig'
import { PLAIN, traitsOf } from '../pets/play'
import type { Stance } from '../pets/rig'
import { PLANES, groundAt } from './ground'
import {
  camWant,
  stepCam,
  depthOf,
  easeTo,
  farFrom,
  onScreen,
  PARK,
  MARKS,
  markAt,
  nearestMark,
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
  canBeHurt,
  driven,
  aimFromKeys,
  aimFromPoint,
  aimOf,
  inSwipe,
  type Swipe,
  mauled,
  PLAYER_LIFE,
  restingStriker,
  shoved,
  stepDodge,
  stepGuard,
  stepAir,
  airFrac,
  aloft,
  diveNow,
  GUARD,
  HOP,
  stepDown,
  stepStrike,
  FOOT,
  octantOf,
  overHead,
  PARK_TALL,
  strikeSwipe,
  swipeTell,
  type Aimed,
  type StrikeInput,
  type Striker,
} from './strike'
import { movesOf, slotFor, petWide, type Attack } from '../pets/attack'
import { footRoom, petBox } from '../pets/rig'
import { CAST, castSlot, inPatch, patchesOf, type CastKind, type Patch } from './cast'
import { recordWin, subscribeWins, winFor, wins } from './records'
import { lungeOf } from '../pets/fight'
import {
  beaten,
  cornered,
  BOSS,
  bossMoves,
  CHARGE,
  LEAP,
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
/**
 * The keys that are not already in a table, in one place.
 *
 * ⚠️ BECAUSE THE HANDLER AND THE HELP BOTH HAVE TO NAME THEM. Walking and swinging were
 * already tables and so could never disagree with a list; rolling, guarding, jumping and
 * casting were four string literals in the key handler and four more in a paragraph of prose,
 * which is exactly the hand-maintained list this repository has learned not to keep. Now the
 * reference below is rendered FROM the thing the handler tests.
 */
const PARK_KEYS = { roll: 'shift', guard: 'q', jump: ' ', cast: 'e' } as const

/**
 * What a key is called on screen.
 *
 * ⚠️ THE TABLE HOLDS WHAT e.key.toLowerCase() PRODUCES, so 'shift' comes out of it in lower
 * case and went on screen that way — the cost of deriving the reference from the thing the
 * handler tests is that the thing the handler tests is not spelt for reading. A space has to
 * be named outright for the same reason.
 */
const keyName = (k: string): string =>
  k === ' ' ? 'Space' : k.length === 1 ? k.toUpperCase() : k[0].toUpperCase() + k.slice(1)

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
  up = 0,
  scale = 1,
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
  /** how high off the field it is standing, in pet-heights — see ground.ts */
  up?: number
  /** how many times a creature's height it stands, so an altitude can be un-scaled */
  scale?: number
}) {
  const on = onScreen(at, cam)
  const done = hp <= 0
  return (
    <span
      className={
        'park-one is-boss' +
        (hit ? ' is-hit' : '') +
        (done ? ' is-beaten' : '') +
        /* ⚠️ A DIFFICULTY CHANGE NOBODY CAN SEE IS A DIFFICULTY SPIKE. The last third throws
           its big moves nearly twice as often, so the creature has to visibly change when it
           crosses — otherwise the fight just gets harder for no reason you could point at. */
        (!done && cornered(hp) ? ' is-cornered' : '') +
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
          /**
           * ⚠️ AGAINST THE DRAWN BODY, NOT THE CANVAS — petBox, the same measure the player's
           * own height uses. The box is about three and a half times the ink.
           *
           * ⚠️ AND DIVIDED BY THE SCALE, WHICH IS THE WHOLE TRAP. `up` is in PET-heights — the
           * unit the rocks, the jump and every cast are written in — but this drawing is
           * rendered at `scale` times a creature, so multiplying by its own body height
           * multiplies the altitude by the scale as well. Caught it leaping 383px on a 476px
           * field, which is a boss flying off the top of the screen, and the same error would
           * have put it two and a half body-lengths up merely for standing on the rocks.
           */
          const lift = (up * petBox(art, size).h) / scale
          return `translate(calc(-50% + ${p.x.toFixed(1)}px), calc(-100% + ${(
            footRoom(art) * 100
          ).toFixed(1)}% + ${(p.y - lift).toFixed(1)}px))`
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

/**
 * Which way a swing is aimed, as the word slotFor wants.
 *
 * ⚠️ OFF THE SAME TWO FLAGS stepStrike READS, so the move drawn is the move thrown. Up wins
 * over down and nothing held is neutral, which is stepStrike's own rule copied nowhere — this
 * takes the very input object it is given.
 */
const aimWord = (k: { up: boolean; down: boolean }): 'up' | 'down' | 'neutral' =>
  k.up ? 'up' : k.down ? 'down' : 'neutral'

/**
 * What a sparring dummy throws.
 *
 * ⚠️ THREE VERBS ARRIVED WITH NOWHERE TO LEARN THEM. A dodge has to be timed inside a 400ms
 * telegraph, a guard only covers the way you are facing, and a jump only clears the things
 * drawn low — and the only thing in the park that attacks is a boss, so all three were learnt
 * while being killed by something that also circles, backs off and changes its mind. The still
 * dummy solved exactly the mirror of this for your own swings: against something that moves,
 * "did that land" and "was it still there" are one question.
 *
 * ⚠️ IT SHOVES AND CANNOT HURT, which is not a special case — it is the split the module was
 * built around. shoved() and mauled() are separate functions precisely so that a thing can push
 * you about without being allowed near your health, and a sparring partner is the honest use of
 * that. Nothing here can put you on the floor.
 *
 * ⚠️ SLOWER AND PLAINER THAN ANY REAL MOVE, on purpose. A wind-up you can comfortably read is
 * the point of a practice target; the fight is where it gets hard. And the lift is above
 * HOP.under, so the swing must be dodged or met and CANNOT be jumped — the jump gets its own
 * thing to answer.
 */
const SPAR: Attack = {
  name: 'spar',
  from: 'body',
  span: 0.95,
  live: [0.46, 0.7],
  reach: 1.7,
  rise: 0.5,
  bite: 6,
  shove: 1,
  lift: 0.55,
  rest: 0,
}

/** how often it throws, and how often that throw is the low one instead */
const SPAR_BEAT = 2.9
const SPAR_LOW_EVERY = 3

/** The field is 16:10, and a screen-height is its height — see SwipePatch. */
const FIELD_ASPECT = 16 / 10

/**
 * How long after one big move before the next.
 *
 * ⚠️ ONE WAIT FOR ALL THREE, which is what keeps three casts from being three times the
 * casting. Nothing about the rate of them moved when the other two arrived; what moved is that
 * you now choose WHICH one to spend the wait on, and spending it on the fissure means not
 * having the swell for four seconds. Three separate cooldowns would have been a different
 * feature — chain all three, then wait — and a much harder one to balance against a boss.
 *
 * ⚠️ AND IT IS A CONSTANT BECAUSE THE BAR DRAWS IT. A 4 in the loop and a 4 in the readout
 * is a readout that quietly starts lying the first time somebody tunes one of them.
 */

/** ⚠️ ONE PLACE, because three lines say a duration now and they must say it the same way. */
const said = (secs: number): string =>
  secs >= 60 ? `${Math.floor(secs / 60)}m ${secs % 60}s` : `${secs} seconds`

/**
 * How long a parried boss is left standing there.
 *
 * ⚠️ LONG ENOUGH FOR THE HEAVY, which is what makes the risk worth taking. The slowest thing
 * a creature can throw commits for about 0.6s, so half a second of a boss doing nothing is one
 * real punish and not two — the reward for reading an attack is a hit, not a combo.
 */
const PARRY_OPENS = 0.55

/**
 * How big the guard's arc is drawn, in screen-heights.
 *
 * ⚠️ JUST OUTSIDE THE CREATURE, not around it. A ring the creature sits inside reads as an
 * aura it has; a ring at arm's length reads as something held up, which is the verb.
 */
const GUARD_SHOW = PARK_TALL * 0.82

/**
 * Where a creature in the air actually is.
 *
 * ⚠️ WITHOUT THIS A JUMP IS INVISIBLE, and not slightly — in a world seen from above, moving
 * a picture up the screen and moving it north are the same pixels. The only thing that tells
 * the two apart is something left behind on the ground, so the shadow is not decoration here,
 * it is the entire readout. It shrinks as the creature rises, which is the second half of it:
 * a shadow the same size at every height says "somebody walked away", not "somebody jumped".
 */
/**
 * ⚠️ THE SHADOW IS THE ONLY THING THAT SAYS SOMETHING IS IN THE AIR. A creature drawn higher
 * up the screen is, in a top-down world, indistinguishable from a creature standing further
 * away — the whole leap read as the boss sliding about until it had one. Reported as "i cant
 * notice any leap".
 *
 * @param size how many times a creature's height the thing is, so a boss casts a boss's shadow
 */
function HopShade({
  at,
  cam,
  height,
  size = 1,
}: {
  at: Spot
  cam: Spot
  height: number
  size?: number
}) {
  if (height <= 0.001) return null
  const p = onScreen(at, cam)
  const shrink = 1 - 0.45 * Math.min(1, height / HOP.up)
  const wide = PARK_TALL * 0.5 * shrink * size
  return (
    <span
      className="park-shade"
      aria-hidden
      style={{
        left: `${p.x * 100}%`,
        top: `${p.y * 100}%`,
        width: `${(wide / FIELD_ASPECT) * 100}%`,
        height: `${wide * 0.42 * 100}%`,
        zIndex: depthOf(at) - 2,
        opacity: 0.42 * shrink,
      }}
    />
  )
}

/**
 * The guard, drawn on the ground.
 *
 * ⚠️ AN ARC AND NOT A CIRCLE, because the guard is not one. The gap in the drawing IS the gap
 * in the defence — a full ring would promise cover behind you that mauled does not give, and
 * the player would learn the wrong rule from the only picture of it they get.
 *
 * ⚠️ AND ON THE GROUND RATHER THAN ON THE CREATURE, for the reason the telegraphs are there:
 * the thing that matters about a guard is which way it points, and PetView mirrors rather than
 * rotates, so nothing drawn on the picture itself could say "this side". Placed and sized the
 * same way a swipe is — screen-heights, which are isotropic in pixels, so the rotation is
 * honest at all eight angles rather than only the four it was built on.
 */
function GuardArc({ me, cam }: { me: Striker; cam: Spot }) {
  /**
   * ⚠️ SPENT MEANS "YOU HAVE NONE", NOT "YOU HAVE LITTLE", and the difference is the whole
   * value of the class. Drawn on a guard that was merely low, the broken styling said the
   * stance had failed while it was still up and still stopping things — the one reading a
   * player would act on immediately and wrongly. Held up, how much is left is the arc's own
   * weight; down here, red and dashed is the gap you cannot close yet.
   */
  const spent = !me.braced && me.guard < GUARD.least
  if (!me.braced && !spent) return null
  const at = onScreen(me, cam)
  const deg = (Math.atan2(me.aim.y, me.aim.x) * 180) / Math.PI
  /* it shrinks a little as it goes, so a guard about to break looks like one */
  const r = GUARD_SHOW * (0.82 + 0.18 * me.guard)
  return (
    <span
      className={
        'park-guard' +
        (me.parried > 0 ? ' is-parry' : me.guardLit > 0 ? ' is-met' : '') +
        (spent ? ' is-spent' : '')
      }
      aria-hidden
      style={{
        left: `${at.x * 100}%`,
        top: `${at.y * 100}%`,
        width: `${((r * 2) / FIELD_ASPECT) * 100}%`,
        height: `${r * 2 * 100}%`,
        zIndex: depthOf(me) - 1,
        transform: `translate(-50%, -50%) rotate(${deg.toFixed(1)}deg)`,
        opacity: spent ? 1 : 0.4 + 0.6 * me.guard,
      }}
    >
      {/* an arc of 200°, centred on +x, so the whole span rotates to the aim */}
      <svg viewBox="-50 -50 100 100" preserveAspectRatio="none">
        <path d="M -6.95 -39.39 A 40 40 0 1 1 -6.95 39.39" />
      </svg>
    </span>
  )
}

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
      {/* ⚠️ THE PLACES FIRST, so the window and the dots sit on top of them rather than
          under — the map is for finding people, and a landmark is the thing you find them BY. */}
      {MARKS.map((m) => (
        <span
          key={m.name}
          className={'park-map-mark is-' + m.kind}
          style={{ left: `${m.at.x * 100}%`, top: `${m.at.y * 100}%` }}
        />
      ))}
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
  extras = [],
  myName,
  authed,
  onControlChange,
  room = PARK_ROOM,
}: {
  pets: ParkPet[]
  /**
   * Other drawings of yours that can be stood up as a boss, but are not you.
   *
   * ⚠️ EVERY DOODLE IS ALREADY A CREATURE AND NOTHING ASKED THEM. temperOf, movesOf and
   * makeBoss take a Drawing and read whatever is there — and since a plain drawing now gets
   * six distinct moves rather than two, a picture with no named parts at all makes a perfectly
   * good opponent. Meanwhile the park offered your adopted minions and nothing else, so a
   * gallery with ten things in it and three adopted was a gallery with seven unused opponents
   * sitting in it.
   *
   * ⚠️ BOSSES ONLY, NEVER YOU. Who you walk in as is a thing you adopted on purpose; what you
   * stand up to fight is just a picture, and keeping the two lists apart is what stops "fight
   * that thing" from quietly becoming "be that thing".
   */
  extras?: ParkPet[]
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
  /* ⚠️ the same measurement as a ref, so aimNow can be a stable callback. Reading the state
     would put `size` in its deps, which would put aimNow in the animation loop's deps, which
     would restart the loop's clock on every resize — see the note on the loop. */
  const sizeRef = useRef({ w: 0, h: 0 })
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
   * What the fight cost, so beating something is an event rather than a thing that stops.
   *
   * ⚠️ ASKED DIRECTLY AND NOT ANSWERED FOR A LONG TIME: "i hit it and it disappeared and this
   * popped up ... now what". A boss went grey, lingered and vanished, and the only thing on the
   * screen afterwards was the same description it had before the fight. How long it took and
   * what it cost you are the two facts that make a win a result, and both were already being
   * counted for other reasons.
   */
  const fightFrom = useRef(0)
  const fightDowns = useRef(0)
  const [result, setResult] = useState<{
    name: string
    secs: number
    downs: number
    best: boolean
    win: { beaten: number; best: number }
  } | null>(null)
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
  /**
   * What your own creature is like, read the same way a boss's is.
   *
   * ⚠️ THE SAME temperOf A BOSS GETS. Its casts list is what you throw with E, so the big
   * thing your creature does is the big thing it would do if somebody else were fighting it —
   * one reading of a drawing, used from both ends.
   */
  /**
   * Which way you are aiming.
   *
   * ⚠️ THE POINTER IF YOU HAVE ONE, THE KEYS IF YOU DO NOT, and the keyboard scheme is
   * untouched — asked for as "i want the mouse to be used for aim and activity along side wasd
   * q e 1234". A mouse gives a direction a keyboard cannot: eight octants is what W/S+F/G can
   * express, and a cursor is continuous, which is the difference between pointing an attack
   * and picking one of eight.
   *
   * ⚠️ IT AIMS FROM THE FEET, because that is where every attack is measured from — stepFrom
   * takes the creature's spot, so aiming from anywhere else would point the cursor at one
   * place and the swing at another.
   *
   * ⚠️ AND W/S STILL PICK WHICH OF THE SIX. The cursor says WHERE, the modifiers say high, low
   * or neither — two separate questions that were only ever answered by one control because a
   * keyboard had nothing else to answer them with.
   */
  const aimNow = useCallback((fallback: Aimed): Aimed => {
    const p = point.current
    const box = sizeRef.current
    if (!p || box.w < 2) return aimFromKeys(held.current, fallback)
    const me = onScreen(you.current, cam.current)
    return aimFromPoint((p.fx - me.x) * box.w, (p.fy - me.y) * box.h, fallback)
  }, [])

  /* which landmarks are ground you can stand on, and how high — see ground.ts */
  const raised = useMemo(() => new Map(PLANES.map((g) => [g.name, g.top])), [])

  /**
   * Which pose a creature of yours is in.
   *
   * ⚠️ THE PARK USED NONE OF THEM. Six stances have existed in rig.ts since the pets room did,
   * and this room passed exactly zero — so walking, guarding, swinging, jumping, gliding and
   * being thrown at the floor were all `idle` with the clock sped up or slowed down. That is
   * the animation gap, and closing it needed no drawing at all: a stance is seven numbers.
   *
   * ⚠️ ORDER IS THE WHOLE LOGIC. The most committed thing a creature is doing wins, because
   * that is the one a player needs to read — a dive while also technically moving is a dive.
   */
  const poseOfMine = (w: Striker): Stance => {
    if (w.dive) return 'dive'
    if (w.swing > 0) return 'pounce'
    if (aloft(w)) return w.vz < 0 && w.float > 0 && w.glide < 1 ? 'glide' : 'fly'
    if (w.braced) return 'crouch'
    if (w.moving) return 'run'
    return 'idle'
  }

  const myKit = useMemo(() => (myArt ? temperOf(myArt) : null), [myArt])
  /**
   * How your creature moves, off the same drawing everything else here comes from.
   *
   * ⚠️ traitsOf, NOT A SECOND IDEA OF WHAT LEGS DO. The platformer has read legs, wings and
   * floats into speed, jump, gravity and glide since the pets room existed, and the park was
   * the one room where a drawing's body made no difference to how it got about — every
   * creature walked at one speed and jumped one height. Asked for as "jump + minion ability
   * movement": the abilities were already derived, they just were not plugged in here.
   */
  const myTraits = useMemo(() => (myArt ? traitsOf(rigOf(myArt)) : PLAIN), [myArt])

  /* ⚠️ the drawing again, not the wrapper — this one feeds the animation loop's deps, and a
     loop rebuilt every render is a loop whose clock starts again every render */
  /** what can be stood up: your minions first, then the rest of your drawings */
  const bossable = useMemo(() => [...pets, ...extras], [pets, extras])
  const bossArt = (bossable[bossPick] ?? bossable[0])?.art
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
  /**
   * ⚠️ THE RHYTHM LIVES BESIDE THE DUMMY RATHER THAN INSIDE IT, so that turning sparring off
   * leaves the still target exactly as it was — its whole value is being the one thing in the
   * park with no variables in it, and a half-cleared attack clock is a variable.
   */
  const spar = useRef<{ on: boolean; t: number; turn: number; aim: Aimed; low: boolean }>({
    on: false,
    t: 0,
    turn: 0,
    aim: { x: 1, y: 0 },
    low: false,
  })
  const [sparring, setSparring] = useState(false)
  const sparHit = useRef(false)
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
  /* ⚠️ one cast is one hit on you, however many patches it is made of — see the wave */
  const castSpent = useRef(false)
  /** the same one-cast-one-hit rule, for a boss somebody else is running */
  const theirCastSpent = useRef(false)
  /**
   * Your own big committed thing, and how long before another.
   *
   * ⚠️ THE BOSS HAD THREE OF THESE AND YOU HAD NONE, which is the asymmetry that had been
   * growing all session: every addition was on its side of the fight. The machinery was already
   * here — patchesOf, inPatch, the ground telegraph — and the only thing missing was a way for a
   * player to reach it.
   *
   * ⚠️ AND IT IS YOUR CREATURE'S FAVOURITE, not a fourth thing to learn. temperOf already
   * works out which of the three a drawing leans towards; that lean is now something you get to
   * throw rather than only something thrown at you.
   */
  const myCast = useRef<{ kind: CastKind; t: number } | null>(null)
  const myCastRest = useRef(0)
  const [casting, setCasting] = useState<CastKind | null>(null)
  /**
   * ⚠️ WHICH ONE, NOT WHETHER. A creature has always had three big moves — temper.ts scores
   * all three off the drawing and sorts them best-first — and the boss has always rotated
   * through the lot while the player only ever got casts[0]. Two thirds of that table was
   * worked out every frame and thrown away, which is the sort of thing that reads as a missing
   * feature to whoever drew the creature and as dead code to whoever reads the file.
   *
   * 0 is nothing and 1..3 are the slots, so the rising edge can tell "pressed 2 while holding
   * 1" from "still holding 1" — which a boolean cannot.
   */
  const castWanted = useRef(0)
  const castHeld = useRef(0)
  /** seconds until the next one, in state because the readout needs to draw the wait */
  const [castLeft, setCastLeft] = useState(0)
  /** so one cast is one hit on each thing, however many patches it is made of */
  const myCastHit = useRef<Set<string>>(new Set())
  /** Q, held — unlike the dodge this one is a hold all the way through, so no edge is taken */
  const bracing = useRef(false)
  /** one punish per parry, not one per frame it is still flashing */
  const parryShown = useRef(false)
  /** Space, and a press like the dodge, so holding it does not bounce you across the park */
  const hopping = useRef(false)
  const hopped = useRef(false)
  /** Shift, held — a dodge is a press, so the loop takes the rising edge itself */
  const rolling = useRef(false)
  const rolled = useRef(false)
  const [dodging, setDodging] = useState(false)
  const dodgeShown = useRef(false)
  /** the patches on the ground right now, drawn for everybody — see patchesOf */
  const [patches, setPatches] = useState<Patch[]>([])
  /** yours, drawn apart from the boss's so you can tell whose ground is about to go */
  const [myPatches, setMyPatches] = useState<Patch[]>([])
  /**
   * What the boss is winding up, in words, while it winds it up.
   *
   * ⚠️ THE GROUND SAYS WHERE AND THIS SAYS WHAT. A telegraph tells you to leave a patch; it
   * cannot tell you that a bloom will follow you outward, or that a wave is five in a row and
   * the second one is where people die. Three casts that all light the floor orange are three
   * things you learn by dying to each of them — and the sentences already existed, written for
   * the maker and never shown anywhere.
   */
  const [bossCasting, setBossCasting] = useState<CastKind | null>(null)
  const debugRef = useRef(false)
  debugRef.current = debug
  const boxesOn = useRef(false)
  const [feet, setFeet] = useState<Array<{ k: string; at: Spot; wide: number; scale: number }>>([])
  const [swings, setSwings] = useState<Array<{ k: string; swipe: Swipe }>>([])
  const held = useRef<Steer>({ ...STILL })
  const hitting = useRef<StrikeInput>({ quick: false, heavy: false, up: false, down: false })
  /**
   * Where the pointer is in the field, as a fraction of it, or null until one is used here.
   *
   * ⚠️ A FRACTION, NOT PIXELS, so the rect is read once per move rather than five times per
   * frame — every aim below asks this, and a getBoundingClientRect in the animation loop is a
   * forced layout on a room that already has enough to do.
   */
  const point = useRef<{ fx: number; fy: number } | null>(null)
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
      if (r && r.width > 1) {
        const next = { w: Math.round(r.width), h: Math.round(r.height) }
        sizeRef.current = next
        setSize(next)
      }
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
      myTraits.jump,
      myTraits.glide,
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
  }, [walking, myArt, myName, room, myTraits])

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
      /* ⚠️ Shift, because it is the one key near the movement hand that nothing else here
         wants — F and G are the swings and WASD is the walk */
      const low = e.key.toLowerCase()
      if (low === PARK_KEYS.roll) {
        e.preventDefault()
        rolling.current = on
        return
      }
      /* ⚠️ SPACE, WHICH IS THE ONE KEY EVERYBODY ALREADY GUESSES. It also scrolls the page,
         so the preventDefault below is not tidiness — without it every jump scrolls the park
         out from under the person jumping. */
      if (low === PARK_KEYS.jump || e.key === 'Spacebar') {
        e.preventDefault()
        hopping.current = on
        return
      }
      /* ⚠️ Q, HELD, AND NOT A SECOND JOB FOR SHIFT. Smash puts the roll on the shield button
         and a direction, which works there because a shield is the default thing your thumb is
         doing; here you are holding a direction almost the whole fight, so the same mapping
         would mean you could never raise a guard while circling — the one moment you want one. */
      if (low === PARK_KEYS.guard) {
        e.preventDefault()
        bracing.current = on
        return
      }
      /**
       * ⚠️ 1, 2 AND 3 PICK ONE, AND E IS STILL THE FIRST. The number row is where everybody
       * already looks for a list of abilities, and keeping E means nothing anybody learned
       * yesterday stopped working — it throws slot one, which is the one the drawing is best
       * suited to and the one E always threw.
       */
      const slot = low === PARK_KEYS.cast ? 1 : '123'.indexOf(e.key) + 1
      if (slot > 0) {
        e.preventDefault()
        castWanted.current = on ? slot : castWanted.current === slot ? 0 : castWanted.current
        return
      }
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
      rolling.current = false
      castWanted.current = 0
      bracing.current = false
      hopping.current = false
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
      /**
       * ⚠️ A CAST OWNS YOU WHILE IT RUNS, exactly as it owns the boss — no walking, no
       * swinging, no rolling out of it. It reaches where your swings cannot and it costs you a
       * second and a half of being a target, which is the trade that stops it being the only
       * button anybody presses.
       */
      if (myCast.current) {
        const ct = myCast.current.t + dt
        if (ct >= CAST[myCast.current.kind].time) {
          myCastRest.current = CAST[myCast.current.kind].wait
          myCast.current = null
          myCastHit.current.clear()
          setCasting(null)
        } else {
          myCast.current = { ...myCast.current, t: ct }
        }
      } else {
        myCastRest.current = Math.max(0, myCastRest.current - dt)
        /* ⚠️ a DIFFERENT slot counts as a press even with the old key still down, which is
           what a boolean edge could not say — see castWanted */
        const press = castWanted.current !== 0 && castWanted.current !== castHeld.current
        castHeld.current = castWanted.current
        const pick = myKit?.casts[castWanted.current - 1]
        if (press && pick && myCastRest.current <= 0 && !busy(you.current) && !aloft(you.current)) {
          myCast.current = { kind: pick, t: 0 }
          you.current = { ...you.current, aim: aimNow(you.current.aim) }
          setCasting(pick)
        }
      }
      /* ⚠️ CASTING IS NOT THE SAME AS BEING HELD BY ONE any more. A bolt runs its timeline
         while you keep walking and swinging; the two earth-movers still own you outright. */
      const iAmCasting = !!myCast.current && CAST[myCast.current.kind].holds

      /**
       * ⚠️ THE RISING EDGE, like the dodge and unlike the guard: holding space would otherwise
       * be a way of getting about rather than an answer to something.
       *
       * ⚠️ AND BEFORE THE GUARD, so the two cannot both start on the same frame. stepAir
       * refuses to leave the ground out of a stance and stepGuard refuses to raise one off it;
       * putting the jump first is what makes that pair of refusals decide the same way every
       * time rather than depending on which key the loop happened to read.
       */
      const wantHop = hopping.current && !hopped.current && !iAmCasting
      hopped.current = hopping.current
      /* ⚠️ the EDGE starts a jump and the HELD state caps how fast it comes down — see
         stepAir. A creature with no wings has no float budget, so holding does nothing. The
         floor is whatever it is standing over, which is how the rocks become somewhere to
         land and somewhere to walk off. */
      /**
       * ⚠️ AN ATTACK IN THE AIR IS A DIVE, and it is read here rather than in stepStrike
       * because it is a change of where you are, not of what you are swinging. Pressing
       * either swing while off the ground commits you downwards; what lands is decided when
       * you arrive, which is the whole of "attack ability on ground hit".
       */
      if (aloft(you.current) && (hitting.current.quick || hitting.current.heavy))
        you.current = diveNow(you.current)

      const air = stepAir(
        you.current,
        wantHop,
        dt,
        hopping.current && !iAmCasting,
        groundAt(you.current),
      )
      const diveLanded = air.landed && you.current.dive
      you.current = air.s
      const inAir = aloft(you.current)

      /**
       * ⚠️ BEFORE THE SWING, because busy() now includes being braced and everything below
       * this line asks busy() what it is allowed to do. Raising the guard after the swing step
       * would give you one frame of swinging out of a stance every time you pressed both.
       *
       * ⚠️ AND THE AIM COMES FROM THE KEYS EVERY FRAME, which is the opposite of the rule a
       * swing follows. A swing's aim is frozen because a live hitbox that follows you is
       * unfair; a guard is the other way round — it is the defender's own commitment, and
       * turning it is the thing you are doing while you hold it. What it costs is that you
       * cannot walk at the same time.
       */
      you.current = stepGuard(
        you.current,
        bracing.current && !iAmCasting && !inAir,
        aimNow(you.current.aim),
        dt,
      )

      const wasSwinging = you.current.swing > 0
      const struck = stepStrike(
        you.current,
        iAmCasting || you.current.braced || inAir
          ? { quick: false, heavy: false, up: false, down: false }
          : hitting.current,
        myMoves,
        dt,
      )
      /**
       * ⚠️ THE AIM IS TAKEN ON THE FRAME THE SWING STARTS and not touched again. Reading the
       * keys every frame would let you steer a live hitbox round somebody after committing to
       * it, which is the same unfairness the frozen position and locked facing already refuse.
       */
      if (!wasSwinging && struck.swing > 0) struck.aim = aimNow({ x: you.current.facing, y: 0 })
      const steer = busy(struck) || iAmCasting ? STILL : held.current
      you.current = {
        ...struck,
        ...stepWalker(struck, steer, struck.hold > 0 ? 0 : dt, myTraits.speed),
      }
      /**
       * ⚠️ AFTER THE WALK, so a dodge overrides where walking put you rather than adding to
       * it — otherwise holding a direction would make the roll longer than it is meant to be,
       * which is the difference between an answer and an escape.
       *
       * ⚠️ THE RISING EDGE, taken here rather than in the key handler: a dodge is a press,
       * and reading "is Shift down" every frame would roll continuously while it is held.
       */
      const wantRoll = rolling.current && !rolled.current && !iAmCasting && !inAir
      rolled.current = rolling.current
      const roll = stepDodge(you.current, wantRoll, aimNow({ x: you.current.facing, y: 0 }), dt)
      you.current = roll.s
      if (you.current.dodge > 0 !== dodgeShown.current) {
        dodgeShown.current = you.current.dodge > 0
        setDodging(dodgeShown.current)
      }
      /**
       * ⚠️ A PARRY HAS TO OPEN THE THING THAT THREW IT, or it is a guard that happens to cost
       * nothing and the timing buys you only what waiting would have. strike.ts cannot reach
       * the boss — it is handed one creature and a point a blow came from — so the flag comes
       * back on the defender and the punishment is applied here, which is also the only place
       * that knows whose boss it is.
       *
       * ⚠️ AND ONLY TO A BOSS YOU ARE RUNNING. Somebody else's is staggered on THEIR machine
       * by THEIR reading, the same rule every other hit on a shared boss follows — a peer
       * cannot be told to flinch by somebody else's frame.
       */
      if (you.current.parried > 0 && !parryShown.current) {
        parryShown.current = true
        const b = boss.current
        if (b && !beaten(b)) {
          boss.current = { ...b, stun: Math.max(b.stun, PARRY_OPENS), swing: 0, cast: null }
          setBossShown(boss.current)
        }
      }
      if (you.current.parried <= 0) parryShown.current = false

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
      /**
       * ⚠️ ONE PATCH IS ONE HIT PER THING, tracked by name rather than by a single flag — a
       * wave rolling over the boss AND the dummy should hit both once, which a shared "spent"
       * would have made one or the other.
       */
      const mine = myCast.current
      if (mine && myMoves.length) {
        const weight = myMoves.reduce((n, m) => n + m.bite, 0) / myMoves.length
        for (const patch of patchesOf(mine.kind, you.current, you.current.aim, mine.t, 1)) {
          if (!patch.live) continue
          const b = boss.current
          if (b && bossKit && !beaten(b) && !myCastHit.current.has('boss')) {
            if (inPatch(b, bossKit.wide, patch, b.scale)) {
              boss.current = wounded(b, { ...myMoves[0], bite: weight * 1.1 })
              setBossShown(boss.current)
              myCastHit.current.add('boss')
            }
          }
          const d = dummy.current
          if (d && !myCastHit.current.has('dummy') && inPatch(d, myWide, patch)) {
            dummy.current = { ...d, hurt: d.hurt + weight * 1.1, hits: d.hits + 1, lit: 0.18 }
            myCastHit.current.add('dummy')
          }
        }
      }

      if (dummy.current && dummy.current.lit > 0)
        dummy.current = { ...dummy.current, lit: Math.max(0, dummy.current.lit - dt) }

      /**
       * The sparring partner's own clock.
       *
       * ⚠️ A FIXED BEAT AND NOTHING ELSE. A boss decides when to attack out of its temper, its
       * distance and a roll; a practice target must be the opposite of that, or you are learning
       * its mind instead of your own timing. It throws every SPAR_BEAT seconds, always, and the
       * only thing that varies is which of the two things it throws.
       *
       * ⚠️ AND IT AIMS AT YOU, so the guard's facing is the thing being practised rather than
       * a thing you can stand out of. Where you put yourself is the exercise.
       *
       * ⚠️ shoved, NEVER mauled, so this cannot take a point of health from anybody. That is
       * the whole licence for a thing that hits back living in a park people walk through.
       */
      if (spar.current.on && dummy.current) {
        const d = dummy.current
        const was = spar.current.t
        let t = was + dt
        if (t >= SPAR_BEAT) {
          t -= SPAR_BEAT
          const turn = spar.current.turn + 1
          spar.current = {
            on: true,
            t,
            turn,
            aim: aimOf(you.current.x - d.x, you.current.y - d.y, { x: 1, y: 0 }),
            low: turn % SPAR_LOW_EVERY === 0,
          }
          sparHit.current = false
        } else {
          spar.current = { ...spar.current, t }
        }
        const { aim, low } = spar.current
        const gone = spar.current.t
        if (!sparHit.current && canBeHurt(you.current)) {
          if (low) {
            /* ⚠️ THE LOW ONE IS A REAL FISSURE, out of patchesOf, so what you practise jumping
               is the same shape and the same clock as the thing a boss throws at you. */
            for (const patch of patchesOf('wave', d, aim, gone)) {
              if (!patch.live || !inPatch(you.current, myWide, patch)) continue
              you.current = shoved(you.current, patch.at, { ...SPAR, lift: CAST.wave.lift })
              sparHit.current = true
              break
            }
          } else {
            const area = strikeSwipe(d, aim, SPAR, gone)
            if (area && inSwipe(you.current, myWide, area)) {
              you.current = shoved(you.current, d, SPAR)
              sparHit.current = true
            }
          }
        }
      }

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
        /* ⚠️ how high the thing it is hunting is standing, so it can tell the difference
           between somebody beside it and somebody it cannot reach — see the leap. The nearest
           peer's altitude is not on the wire as a number, but where they are IS, and ground.ts
           turns one into the other. */
        const targetUp = target === (you.current as Spot) ? you.current.up : groundAt(target)
        const plan = bossThink(cur, target, bossKit.moves, targetUp)
        /**
         * ⚠️ A CAST OWNS THE BOSS WHILE IT RUNS. It cannot walk, turn or swing through one —
         * which is the price that makes it worth dodging rather than ignoring, and the window
         * that pays a player for reading it. Started here, before stepStrike, for the same
         * reason the turn is: the swing input has to be suppressed on the way in.
         */
        if (cur.cast) {
          const ct = cur.cast.t + dt
          cur =
            ct >= CAST[cur.cast.kind].time
              ? { ...cur, cast: null }
              : { ...cur, cast: { ...cur.cast, t: ct } }
        } else if (plan.cast) {
          cur = { ...cur, cast: { kind: plan.cast, t: 0 } }
        }
        /**
         * ⚠️ THE RUN IS OWNED HERE FOR THE SAME REASON THE CAST IS: bossThink is asked what to
         * do, it does not keep anything. A charge that lived inside it would be a second place
         * the boss's state exists, and the two would disagree the first time a fight was reset.
         */
        if (cur.charge) {
          const rt = cur.charge.t + dt
          cur =
            rt >= CHARGE.warn + CHARGE.run
              ? { ...cur, charge: null }
              : { ...cur, charge: { ...cur.charge, t: rt } }
        } else if (plan.charge) {
          cur = { ...cur, charge: { ...plan.charge, t: 0 } }
        }

        /**
         * ⚠️ THE LEAP IS FLOWN HERE RATHER THAN BY stepAir, and that is the one place the
         * boss is allowed to differ from a person. stepAir is ballistics: you choose a launch
         * speed and the arc decides where you come down. A leap is the other way round — the
         * spot is chosen first and the arc has to arrive at it — so it is driven off its own
         * clock, up through LEAP.rise, held, and down onto the ground that is actually there.
         *
         * ⚠️ AND IT LANDS ON WHATEVER IS UNDER THE SPOT. Leaping at somebody on the rocks puts
         * it on the rocks; the terrain is not something the move has to know about.
         */
        cur = { ...cur, leapRest: Math.max(0, cur.leapRest - dt) }
        if (cur.leap) {
          const lt = cur.leap.t + dt
          const whole = LEAP.warn + LEAP.rise + LEAP.fall
          if (lt >= whole) {
            const floor = groundAt(cur.leap)
            /**
             * ⚠️ IT LANDS ON YOU, OR IT LANDS. The slam is the whole reason for the move and
             * it is a place rather than a swing — no aim, no facing, no arc to read; you are
             * either where it came down or you are not. Built from the boss's hardest move so
             * that what it is made of still decides what it hits for, the same rule every
             * other thing it throws follows.
             */
            const hardest = bossKit.moves.reduce(
              (m, x) => (x.bite > m.bite ? x : m),
              bossKit.moves[0],
            )
            const near =
              Math.hypot(
                ((you.current.x - cur.leap.x) / VIEW.w) * FIELD_ASPECT,
                (you.current.y - cur.leap.y) / VIEW.h,
              ) <
              PARK_TALL * cur.scale * LEAP.spot
            if (hardest && near && canBeHurt(you.current)) {
              you.current = mauled(
                you.current,
                cur.leap,
                { ...hardest, bite: Math.round(hardest.bite * LEAP.bite), lift: 0.9 },
                floor,
              )
            }
            cur = { ...cur, leap: null, up: floor, ground: floor, vz: 0, leapRest: LEAP.rest }
          } else {
            const from = { x: cur.x, y: cur.y }
            const p = Math.max(0, (lt - LEAP.warn) / (LEAP.rise + LEAP.fall))
            const arc = Math.sin(Math.min(1, p) * Math.PI)
            const floor = groundAt(cur.leap)
            cur = {
              ...cur,
              leap: { ...cur.leap, t: lt },
              /* it does not move at all while it winds up — the tell a charge has too */
              x: lt < LEAP.warn ? from.x : from.x + (cur.leap.x - from.x) * Math.min(1, p * 1.15),
              y: lt < LEAP.warn ? from.y : from.y + (cur.leap.y - from.y) * Math.min(1, p * 1.15),
              up: floor + arc * LEAP.high,
              ground: floor,
              vz: 0,
            }
          }
        } else if (plan.leap) {
          cur = { ...cur, leap: { ...plan.leap, t: 0 } }
        }
        const casting = !!cur.cast
        /**
         * ⚠️ COMING ABOUT COSTS IT THE SWING, which is the whole point of it costing anything
         * — see stepTurn. A turn it could attack through would be a turn you cannot punish, and
         * then getting behind it buys position without buying time, which is what it did before.
         *
         * ⚠️ WORKED OUT BEFORE stepStrike RUNS, because the input has to be suppressed on the
         * way in. Cancelling a swing after the fact would let it start one on the frame it began
         * turning, and a swing that comes out backwards is worse than no swing at all.
         */
        const spun = stepTurn(cur, target.x, busy(cur) || casting, dt)
        const bHit =
          spun.turning || casting
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
        const bSteer = busy(struckBoss) || casting ? STILL : { ...STILL, ...plan.steer }
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

        /**
         * ⚠️ IT CLIMBS, THROUGH THE SAME stepAir A PERSON DOES. A boss that walked through the
         * rocks while everybody else stood on them would make the terrain a thing only one
         * side of the fight lives in — and this room's oldest rule about the boss is that it
         * cannot do anything you could not. It never presses the key, so it never jumps; the
         * ground simply carries it up and drops it off, and the leap it DOES have is its own
         * move rather than a hop.
         */
        /* ⚠️ NOT WHILE IT IS LEAPING, or two things own its altitude and gravity quietly
           drags the arc down out from under the slam. The leap flies itself; the ground only
           carries it when it is walking. */
        if (!cur.leap) cur = { ...cur, ...stepAir(cur, false, dt, false, groundAt(cur)).s }

        /**
         * ⚠️ THE CAST HURTS THROUGH THE SAME GUARD A SWING DOES — stun above zero means you
         * cannot be hit, so being knocked about by one thing does not feed you into another.
         * One patch landing spends the cast, so a wave rolling over you is one hit and not five.
         */
        const cs = cur.cast
        if (cs && !castSpent.current) {
          for (const patch of patchesOf(cs.kind, cur, cur.aim, cs.t, cur.scale)) {
            if (!patch.live) continue
            if (!canBeHurt(you.current)) break
            if (!inPatch(you.current, myWide, patch)) continue
            /**
             * ⚠️ ITS OWN WEIGHT, NOT A CONSTANT. This took the first move in the table and
             * added 15%, which meant a cast hit for whatever the CHEAPEST thing the creature had
             * hit for — the table is sorted by commitment, so entry zero is always the quickest
             * jab. A boss made of one heavy tail threw exactly as feeble a bloom as a boss made
             * of a flick. Averaged across everything it can throw, a cast is as heavy as the
             * creature that cast it.
             */
            const weight =
              bossKit.moves.reduce((n, m) => n + m.bite, 0) / Math.max(1, bossKit.moves.length)
            you.current = mauled(you.current, patch.at, {
              ...bossKit.moves[0],
              bite: weight * 1.1,
              /* ⚠️ THE CAST'S OWN HEIGHT, not whatever moves[0] happened to be drawn at. The
                 borrowed move is only here for its shove and its feel; how high the thing is
                 decides whether jumping answers it, and that is a property of the cast. */
              lift: CAST[cs.kind].lift,
            })
            castSpent.current = true
            break
          }
        }
        if (!cs) castSpent.current = false

        /* its swing against me */
        const bm = bossKit.moves[cur.move]
        if (cur.swing > 0 && !cur.spent && bm) {
          const area = strikeSwipe(cur, cur.aim, bm, bm.span - cur.swing, cur.scale)
          if (area && canBeHurt(you.current) && inSwipe(you.current, myWide, area)) {
            /* ⚠️ mauled, not shoved — a boss is the one thing allowed to take health off */
            you.current = mauled(you.current, cur, bm, cur.up)
            cur = { ...cur, spent: true }
          }
        }

        /* and mine against it — one swing is one hit, so a swipe that already caught a
           wanderer does not also land on the boss */
        /**
         * ⚠️ A DIVE LANDS AS A PLACE, NOT A SWING — the same shape as the boss's slam, and
         * deliberately so: the two moves are each other's answer and reading one should teach
         * you the other. No aim, no facing, no arc; it hit the ground and you were on it or
         * you were not. Built from your own heaviest swing, so what you drew still decides
         * what it costs.
         */
        if (diveLanded && mv0 && !beaten(cur)) {
          const heaviest = myMoves.reduce((m, x) => (x.bite > m.bite ? x : m), myMoves[0])
          const near =
            Math.hypot(
              ((cur.x - you.current.x) / VIEW.w) * FIELD_ASPECT,
              (cur.y - you.current.y) / VIEW.h,
            ) <
            PARK_TALL * (1 + cur.scale) * HOP.spot
          if (heaviest && near) {
            cur = wounded(cur, { ...heaviest, bite: Math.round(heaviest.bite * HOP.diveBite) })
            you.current = { ...you.current, hold: 0.08 + heaviest.bite * 0.004 }
          }
        }

        /**
         * ⚠️ AND HEIGHT CUTS BOTH WAYS, which is the whole reason overHead takes two sides. A
         * boss up in the trees is over a ground swing exactly as a jumping player is over its
         * sweep — if only one direction counted, climbing would be a thing the boss could do
         * TO you and not a thing you could answer. Asked of the boss as a striker, with your
         * own feet as the height it is being swung at from.
         */
        if (
          area0 &&
          mv0 &&
          !you.current.spent &&
          !beaten(cur) &&
          !overHead(cur, mv0, you.current.up) &&
          inSwipe(cur, bossKit.wide, area0, cur.scale)
        ) {
          cur = wounded(cur, mv0)
          you.current = { ...you.current, spent: true, hold: 0.06 + mv0.bite * 0.004 }
        }

        /* ⚠️ A BEATEN BOSS TAKES ITSELF AWAY. One park has one boss, and whoever called it is
           not necessarily still at the keyboard — see BOSS_LINGER. */
        if (!fightFrom.current) {
          fightFrom.current = now / 1000
          fightDowns.current = 0
        }
        if (beaten(cur) && !bossDoneAt.current) {
          bossDoneAt.current = now / 1000
          const secs = Math.max(1, Math.round(now / 1000 - fightFrom.current))
          /* ⚠️ written before the line is shown, so the line can say whether it was your best */
          const rec = recordWin(cur.name, secs, fightDowns.current)
          setResult({ name: cur.name, secs, downs: fightDowns.current, ...rec })
        }
        if (bossDoneAt.current && now / 1000 - bossDoneAt.current > BOSS_LINGER) {
          boss.current = null
          setBossShown(null)
          bossDoneAt.current = 0
          fightFrom.current = 0
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
        if (!canBeHurt(you.current)) continue
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
      if (!tb && !boss.current && fightFrom.current) {
        fightFrom.current = 0
        bossDoneAt.current = 0
      }
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
        /* ⚠️ a viewer counts how long their cast has been going rather than being told —
           see BossEcho.castFor. Its patches then come out identical to the host's. */
        if (tb.cast) tb.castFor += dt
        /**
         * ⚠️ AND A FRIEND'S BOSS FALLING IS YOUR RESULT TOO. Most of the bosses in a shared
         * park are somebody else's, so a win line that only fired for the host would be a win
         * line most people never see. The clock is your own — it starts when the thing appeared
         * on YOUR screen — which is honest for somebody who walked over halfway through.
         */
        if (!fightFrom.current) {
          fightFrom.current = now / 1000
          fightDowns.current = 0
        }
        if (tb.hp <= 0 && !bossDoneAt.current) {
          bossDoneAt.current = now / 1000
          const secs = Math.max(1, Math.round(now / 1000 - fightFrom.current))
          /* ⚠️ a friend's boss counts too. You were there and it went down; whose socket was
             running it is an implementation detail of the fight, not of the evening. */
          const rec = recordWin(tb.name, secs, fightDowns.current)
          setResult({ name: tb.name, secs, downs: fightDowns.current, ...rec })
        }
        const theirMove = tb.swing > 0 ? kit.moves[tb.swing - 1] : undefined
        if (theirMove) {
          tb.swingFor += dt
          if (!tb.spent) {
            const area = strikeSwipe(tb.shown, tb.aim, theirMove, tb.swingFor, kit.temper.scale)
            if (area && canBeHurt(you.current) && inSwipe(you.current, myWide, area)) {
              /* somebody else's boss is still a boss — see mauled */
              you.current = mauled(you.current, tb.shown, theirMove)
              tb.spent = true
            }
          }
        }
        /**
         * ⚠️ AND ITS CASTS REACH YOU TOO, WHICH THEY DID NOT. A viewer already re-derived a
         * remote boss's patches in order to DRAW them, in exactly the right places — nothing
         * ever asked whether you were standing in one. So a friend's boss swung at you and its
         * three big attacks were scenery, which is the half of a shared fight that only happens
         * when the boss is somebody else's. Same weight rule and same one-hit rule as your own.
         *
         * ⚠️ AND THE SAME ARGUMENTS AS THE DRAWING BELOW, deliberately written to match it:
         * patches you can see and patches that can hurt you must come out of one call shape, or
         * the fight is decided somewhere the picture is not.
         */
        if (tb.cast && !theirCastSpent.current) {
          const weight = kit.moves.reduce((n, m) => n + m.bite, 0) / Math.max(1, kit.moves.length)
          for (const patch of patchesOf(
            tb.cast.kind,
            tb.shown,
            tb.aim,
            tb.castFor,
            kit.temper.scale,
          )) {
            if (!patch.live) continue
            if (!canBeHurt(you.current)) break
            if (!inPatch(you.current, myWide, patch)) continue
            you.current = mauled(you.current, patch.at, {
              ...kit.moves[0],
              bite: weight * 1.1,
              lift: CAST[tb.cast.kind].lift,
            })
            theirCastSpent.current = true
            break
          }
        }
        if (!tb.cast) theirCastSpent.current = false

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

      /**
       * ⚠️ A PEER'S CAST, LANDING ON MY BOSS. Damage to a shared boss is always worked out by
       * the machine running it — see the note on their swing above — so this is the only place a
       * friend's cast can take anything off it. It does NOT touch the player: a neighbour cannot
       * hurt you here, which is the same rule their swing follows.
       */
      for (const o of state.current.here.values()) {
        if (!o.cast) continue
        o.castFor += dt
        const b = boss.current
        if (!b || !bossKit || beaten(b)) continue
        /* ⚠️ THEIR CAST'S OWN FLAG, NOT THEIR SWING'S — see Someone.castSpent. Sharing
           `spent` meant a friend's cast never landed at all. */
        if (o.castSpent) continue
        /* their own move table, already here because their drawing arrived with them */
        const kit = foeMoves.current.get(o.id)
        const weight = kit?.length ? kit.reduce((n, m) => n + m.bite, 0) / kit.length : 6
        for (const patch of patchesOf(o.cast.kind, o.shown, o.aim, o.castFor, 1)) {
          if (!patch.live) continue
          if (!inPatch(b, bossKit.wide, patch, b.scale)) continue
          boss.current = wounded(b, { ...bossKit.moves[0], bite: weight * 1.1 })
          setBossShown(boss.current)
          o.castSpent = true
          break
        }
      }

      /* a nudge decays back to nothing, so the path stays the truth */
      for (const n of nudges.current) {
        const ease = Math.exp(-3.2 * Math.min(0.05, dt))
        n.x *= ease
        n.y *= ease
      }

      setDummyShown(dummy.current)

      /**
       * ⚠️ DERIVED, NOT STORED, and the same on every machine. A cast is a pure function of
       * where the boss is, which way it is aimed and how long it has been going — all of which
       * are already on the wire — so a viewer works out the identical patches without a single
       * new message. See the note at the top of cast.ts.
       */
      {
        const b = boss.current
        const tb = state.current.boss
        const mineNow = myCast.current
        setBossCasting(b?.cast?.kind ?? tb?.cast?.kind ?? null)
        /* ⚠️ A FRIEND'S CAST IS DRAWN LIKE YOURS, because it is a thing happening on the same
           ground and standing in it is the same mistake. Theirs cannot hurt YOU — see the note
           where a peer's cast lands — but not seeing it at all would make a shared boss fight
           look like one person doing something inexplicable. */
        const others: Patch[] = []
        if (mineNow)
          others.push(...patchesOf(mineNow.kind, you.current, you.current.aim, mineNow.t, 1))
        for (const o of state.current.here.values())
          if (o.cast) others.push(...patchesOf(o.cast.kind, o.shown, o.aim, o.castFor, 1))
        setMyPatches(others)
        /**
         * ⚠️ THE INCOMING CHANNEL, NOT THE MINE ONE. Patches come in two colours here and the
         * colour is the whole meaning: `is-mine` says "you did this and it cannot hurt you".
         * The sparring fissure went out on that channel first and read as your own — an
         * incoming attack painted in the colour of a harmless one, on the practice target
         * whose entire job is teaching you to read incoming attacks.
         */
        const sparLow =
          spar.current.on && spar.current.low && dummy.current
            ? patchesOf('wave', dummy.current, spar.current.aim, spar.current.t)
            : null
        setPatches(
          b?.cast
            ? patchesOf(b.cast.kind, b, b.aim, b.cast.t, b.scale)
            : tb?.cast
              ? patchesOf(
                  tb.cast.kind,
                  tb.shown,
                  tb.aim,
                  tb.castFor,
                  echoKit.current?.temper.scale ?? BOSS.scale,
                )
              : (sparLow ?? []),
        )
      }

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
        /* ⚠️ THE SAME CHANNEL THE BOSS USES, deliberately: what you practise reading has to
           look exactly like what you will be reading. One tell at a time is right too — a
           sparring dummy is for when you are not already being attacked. */
        const sd = spar.current.on ? dummy.current : null
        const t3 =
          !t && !t2 && sd && !spar.current.low
            ? swipeTell(sd, spar.current.aim, SPAR, spar.current.t)
            : null
        setTell(t ?? t2 ?? t3)
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
      if (fall.went === 'down') fightDowns.current++

      setShownYou(you.current)
      setCastLeft(myCastRest.current)

      clockRef.current = (now - started) / 1000
      setClockAt(clockRef.current)

      cam.current = stepCam(cam.current, you.current, dt, stillRef.current)
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
        /* ⚠️ a cast rides above the six slots, the same way a boss's does — without it a
           friend's machine never learns you cast, and your cast does nothing to their boss */
        const myOut = myCast.current
        const mySlot = myOut
          ? castSlot(myOut.kind)
          : you.current.swing > 0
            ? you.current.move + 1
            : 0
        park.current?.send(
          you.current,
          mySlot,
          octantOf(you.current.aim),
          airFrac(you.current),
          downFor.current > 0,
        )
        /* ⚠️ THE BOSS GOES OUT AT THE SAME RATE AS A WALK AND NO FASTER — it is one more
           creature moving in the park, and fifteen a second is what everything else in here
           costs. What is left of it rides along as a fraction, so the relay never learns how
           much health a boss has. */
        const mineOut = boss.current
        /* ⚠️ seven and above is a cast — see castSlot, which is the only place that decides */
        const bossSlot = mineOut?.cast ? castSlot(mineOut.cast.kind) : null
        if (mineOut)
          park.current?.stepBoss(
            mineOut,
            mineOut.facing,
            bossSlot ?? (mineOut.swing > 0 ? mineOut.move + 1 : 0),
            mineOut.lifeMax > 0 ? mineOut.life / mineOut.lifeMax : 0,
            mineOut.turn > 0,
            octantOf(mineOut.aim),
          )
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [walking, myMoves, myWide, bossKit, myKit, myTraits, aimNow])

  /* the same sizing as everywhere else — PetView's size is the LONG side, not the height */
  /* ⚠️ the CREATURE is this tall, not its canvas — see petCanvas */
  /**
   * ⚠️ PARK_TALL, not a second copy of the factor. These two have to agree or the hitbox is
   * not where the creature is, which is the thing PARK_TALL's own note has always warned about
   * — and they were nevertheless two numbers until the park was zoomed out.
   *
   * ⚠️ AND THE FLOOR MOVES WITH THE ZOOM, WHICH IS THE PART THAT KEEPS CATCHING PEOPLE OUT.
   * The floor stops a creature becoming a speck, and it is the one place the picture and the
   * hitbox are allowed to disagree: below it the drawing stops shrinking and PARK_TALL does
   * not. At the original zoom it bit under a 137px field, which is not a park anybody plays
   * in. Each zoom out raises that — 0.104 would have made it 212px, and a phone's field
   * measures 205. At 0.088, 14 puts it back under 159px, clear of a phone again.
   *
   * ⚠️ A PHONE IS AT THE EDGE OF THIS ZOOM. 205px of field puts a creature at 18px, which is
   * small. The zoom cannot be made responsive — see PARK_TALL, the park is shared — so if it
   * is ever to be comfortable on a phone that will be by giving the field more of the page
   * there, not by drawing a bigger creature in the same field.
   */
  const petSize = (art: Drawing) => petCanvas(art, Math.max(14, size.h * PARK_TALL))

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
   * Where your next swing would land, and whether anything is standing in it.
   *
   * ⚠️ DERIVED FROM THE SAME CALLS THE HIT TEST MAKES — slotFor to choose the move,
   * strikeSwipe to shape it, inSwipe to ask. A second idea of "your reach" living beside the
   * real one is the bug this module keeps paying for, so there is not one: if the picture is
   * wrong then the hit is wrong in the same way, which is a thing a test can catch.
   *
   * ⚠️ ASKED AT THE MIDDLE OF THE LIVE WINDOW, which is the only time it answers at all.
   * strikeSwipe returns null outside a.live — the area does not grow, it simply does not exist
   * until the move is out — so the obvious call with gone = span returns nothing and the
   * indicator never appears. Watched exactly that. The midpoint is the same frame MoveShow
   * parks on when motion is turned off, for the same reason: it is the frame the move IS.
   */
  const myReach = (() => {
    if (!bossShown && !theirBoss && !dummyShown) return null
    if (!myMoves.length || knocked) return null
    const aim = aimNow(shownYou.aim)
    const mv = myMoves[Math.min(myMoves.length - 1, slotFor(false, aimWord(hitting.current)))]
    if (!mv) return null
    const swipe = strikeSwipe(shownYou, aim, mv, mv.span * ((mv.live[0] + mv.live[1]) / 2))
    if (!swipe) return null
    const kit = echoKit.current
    const onTarget =
      /* ⚠️ THE CACHED WIDTH, NOT A FRESH READING. bossWide walks every stroke and every point
         of the drawing, and this runs on every render of a room that renders every frame — so
         the reach indicator quietly re-measured the boss sixty times a second. Measured before
         changing it: 0.049ms on the biggest drawing the park will accept, which is 3ms of every
         second and 0.3% of a frame. Waste rather than a problem, and bossKit has held the same
         number since the boss was called, so there was never a reason to ask twice. */
      (!!bossShown &&
        !beaten(bossShown) &&
        !!bossKit &&
        inSwipe(bossShown, bossKit.wide, swipe, bossShown.scale)) ||
      (!!theirBoss &&
        theirBoss.hp > 0 &&
        !!kit &&
        inSwipe(theirBoss.shown, kit.wide, swipe, kit.temper.scale)) ||
      (!!dummyShown && inSwipe(dummyShown, myWide, swipe))
    return { swipe, onTarget }
  })()

  /**
   * What the picture will fight like, or what the one in the field is fighting like.
   *
   * ⚠️ THE TEMPER THAT IS ACTUALLY IN USE, never a fresh reading. bossShown carries the temper
   * it was built with and the echo's kit carries the one its hitboxes use — reading the drawing
   * again here would be a second answer free to drift from the one doing the hitting.
   */
  /**
   * ⚠️ SUBSCRIBED RATHER THAN READ ONCE, so a win appears in the list the moment it is
   * written rather than the next time something else happens to re-render the page. The store
   * already tells its watchers; this is the two lines that listen.
   */
  const myWins = useSyncExternalStore(subscribeWins, wins, wins)

  /* ⚠️ off shownYou, which already re-renders every frame — no new clock for a five-item scan */
  const whereIAm = walking ? markAt(shownYou) : null

  const bossSays = (() => {
    /* ⚠️ WHERE IT IS, out of the same table the map draws from — see nearestMark. The one
       thing a friend needs in order to come and help is which way to walk. */
    if (bossShown)
      return `${bossShown.name}, at ${nearestMark(bossShown).name} — ${saysOf(bossShown.temper)}`
    if (theirBoss) {
      const t = echoKit.current?.by === theirBoss.by ? echoKit.current.temper : null
      if (!t) return null
      /**
       * ⚠️ WHOSE IT IS, WHICH THE PARK KNEW AND NEVER SAID. The help has always promised a
       * boss is "run by whoever called it", and that mattered — it goes when they go, and its
       * health is decided on their machine — but the only thing on screen was the creature's
       * own name. Somebody walks into a park, finds a boss, and has no idea which of the
       * people standing there stood it up.
       *
       * ⚠️ AND IT COSTS NOTHING TO SEND, because it was already here. The echo carries the id
       * of the client running it and the roster carries that client's name, so this is two
       * things already on this machine being put next to each other.
       */
      const caller = state.current.here.get(theirBoss.by)?.name
      const place = nearestMark(theirBoss.shown).name
      return caller
        ? `${theirBoss.name}, stood up by ${caller} at ${place} — ${saysOf(t)}`
        : `${theirBoss.name}, at ${place} — ${saysOf(t)}`
    }
    if (!bossKit || !bossArt) return null
    const who = (bossable[bossPick] ?? bossable[0])?.name ?? 'It'
    /* ⚠️ BEFORE YOU CALL IT, which is when it is a reason to pick this one rather than a
       souvenir of picking it. Silent for a creature you have never beaten. */
    const had = winFor(who)
    const done = had
      ? ` Beaten ${had.beaten === 1 ? 'once' : `${had.beaten} times`}, quickest ${said(had.best)}.`
      : ''
    return `${who} as a boss: ${saysOf(bossKit.temper)} ${bossKit.temper.life} health.${done}`
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
        {walking && bossable.length > 0 && !theirBoss && (
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
              const art = bossable[bossPick] ?? bossable[0]
              /**
               * ⚠️ AT THE NEAREST PLACE, NOT AT YOUR FEET. A boss used to stand up a fixed
               * step east of wherever you happened to be, which meant a fight could happen
               * anywhere and therefore happened nowhere — the one thing the park had no word
               * for. Now it goes to the nearest landmark, so every fight is AT somewhere: you
               * can tell a friend where it is, they can see it on the map, and the ring is
               * finally named after what it is for.
               *
               * ⚠️ AND IT IS STILL A STEP AWAY RATHER THAN ON YOUR HEAD, which is what the
               * old offset was for. If you are already standing at the middle of the place,
               * it takes the same step east from there.
               */
              const spot = nearestMark(you.current).at
              const onTop =
                Math.hypot(
                  ((spot.x - you.current.x) / VIEW.w) * 1.6,
                  (spot.y - you.current.y) / VIEW.h,
                ) < 0.14
              boss.current = makeBoss(art.name, art.art, {
                x: Math.max(0.05, Math.min(0.95, onTop ? spot.x + 0.1 : spot.x)),
                y: spot.y,
              })
              bossDoneAt.current = 0
              /* last fight's line goes when the next one starts, or it reads as this one's */
              setResult(null)
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
                spar.current = { on: false, t: 0, turn: 0, aim: { x: 1, y: 0 }, low: false }
                setSparring(false)
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
        {/*
          ⚠️ ONLY WHEN THERE IS A DUMMY, so the toolbar does not grow a button that does
          nothing most of the time — it already carries enough, and a control that is only
          meaningful in one state should only exist in that state.

          ⚠️ AND A SEPARATE SWITCH RATHER THAN A THIRD STATE OF THE FIRST. The still dummy's
          whole value is being the one thing in the park with no variables in it, which is what
          makes a swing's reach measurable; folding an attack clock into the same button would
          mean you could not have that any more.
        */}
        {walking && dummyShown && (
          <button
            className={'btn' + (sparring ? ' is-on' : '')}
            aria-pressed={sparring}
            onClick={() => {
              const on = !spar.current.on
              spar.current = { on, t: 0, turn: 0, aim: { x: 1, y: 0 }, low: false }
              sparHit.current = false
              setSparring(on)
            }}
            title="Let the target attack you on a slow, steady beat. It pushes you about and can never take any health."
          >
            {sparring ? '✕ Stop sparring' : '🥊 Let it hit back'}
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
        {walking && bossable.length > 1 && !bossShown && !theirBoss && (
          <label className="park-seat">
            <span className="sr-only">Which drawing to fight</span>
            <select value={bossPick} onChange={(e) => setBossPick(Number(e.target.value))}>
              {bossable.map((p, i) => (
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
      {/*
        ⚠️ THE ANSWER TO "NOW WHAT". A boss went grey, lingered and vanished, and the only thing
        left on the screen was the same description it had before the fight — so the end of a
        fight looked exactly like a fight that had stopped. Two facts make it a result instead,
        and both were already being counted: how long it took, and how many times it put you on
        the floor. No score, no table, nothing stored — just the thing that happened, said.
      */}
      {/*
        ⚠️ GOING DOWN NEVER EXPLAINED ITSELF, and it is the one moment in the loop that most
        needs to. The creature tips over, the name tag says "down", and the two things that
        actually make it survivable are both invisible: nothing can touch you while you are
        there, and you come back with a full pool. stepDown's own note calls it "a setback, not
        a punishment" — that was true in the code and nowhere on the screen, so the first time
        it happens it reads as losing.

        ⚠️ AND IT IS THE ONE PIECE OF COPY HERE AIMED SQUARELY AT SOMEBODY'S FIRST FIGHT, which
        is who this site is for.
      */}
      {walking && result && (
        <p className="park-result" role="status">
          <strong>{result.name} is down.</strong> {said(result.secs)}
          {result.downs === 0
            ? ', and it never put you on the floor.'
            : result.downs === 1
              ? ', and it put you on the floor once.'
              : `, and it put you on the floor ${result.downs} times.`}{' '}
          {/*
            ⚠️ THE FIGHT HAD NO MEMORY AND THAT WAS THE LAST THING MISSING. "Now what" had no
            answer but "draw another one"; a boss you had already beaten looked exactly like
            one you had not, and a four-minute win looked exactly like a ninety-second one.
            Your own times only — the park is where a family go to hit a drawing together, so
            the thing worth keeping is "we did that, and faster than last time".
          */}
          {result.best && result.win.beaten > 1 ? (
            <em>Your quickest yet.</em>
          ) : result.win.beaten > 1 ? (
            <em>
              That is {result.win.beaten} times now; your quickest is {said(result.win.best)}.
            </em>
          ) : (
            <em>First time.</em>
          )}
        </p>
      )}
      {/*
        ⚠️ A PLACE IS ONLY A PLACE ONCE SOMETHING NAMES IT. The landmarks give the map
        something to look at; this is what makes them usable — you can tell somebody where you
        are, and where you found them. Without it they are wallpaper with a shape.
      */}
      {/* ⚠️ THE KEY LIST IS A KEY LIST, so the phone gets its own sentence rather than a
          column of blanks next to keys it does not have. */}
      <p className="muted park-touch">
        On a phone: the pad below walks and does the five — swing, heavy, roll, guard, jump. The
        chips throw your big moves.
      </p>
      <div className={'park-stage' + (full ? ' is-full' : '')} ref={stage}>
        {/*
          ⚠️ OVER THE FIELD, NOT ABOVE IT, BECAUSE THESE TWO COME AND GO WHILE YOU PLAY. "You
          are at the pond" appears the moment you reach one and vanishes when you leave, and
          being knocked down lasts a second and a half — and every one of those, sitting in the
          flow above the stage, shoved the field and the little map down and back up again.
          Reported exactly that way: "shifts the map down as the messages show and hide as
          youre playing". A game's live text belongs on the game, where appearing costs nothing.

          ⚠️ THE ORDERING NOTE STILL HOLDS. "What is happening sits above the field" was about
          reading order, and the top of the field is still above the field — what it cannot be
          is a thing that moves the field when it arrives.

          ⚠️ AND IT CANNOT BE CLICKED THROUGH. pointer-events stays off: the field under it
          takes the pointer for aiming now, and a status line that swallowed a swing would be
          a status line that cost you a fight.
        */}
        <div className="park-live" aria-live="polite">
          {walking && knocked && (
            <p className="park-down" role="status">
              <strong>Down.</strong> Nothing can touch you, and you get back up whole. The boss
              keeps what you took off it.
            </p>
          )}
          {walking && whereIAm && (
            <p className="park-where" role="status">
              You are at <strong>{whereIAm.name}</strong>.
            </p>
          )}
        </div>
        {/*
          ⚠️ THE FIELD TAKES THE POINTER, not the window, so a cursor over the reference table
          below does not aim your creature. Only while walking: outside a fight these are the
          controls of a page, and a right-click that will not open a menu on a page you are
          merely reading is a page that feels broken.

          ⚠️ LEFT IS QUICK AND RIGHT IS HEAVY, which is the pair F and G already are — "aim and
          activity", and the two buttons a hand on a mouse has. They set the same refs the keys
          set rather than a second path, so there is one place a swing starts however it was
          asked for.

          ⚠️ AND THE MENU IS SUPPRESSED ONLY WHILE WALKING, for the same reason: a heavy swing
          that also opens a context menu is not a control.
        */}
        <div
          className="park-field"
          ref={field}
          onPointerMove={(e) => {
            if (!walking) return
            const r = e.currentTarget.getBoundingClientRect()
            if (r.width < 2) return
            point.current = {
              fx: (e.clientX - r.left) / r.width,
              fy: (e.clientY - r.top) / r.height,
            }
          }}
          onPointerLeave={() => {
            hitting.current.quick = false
            hitting.current.heavy = false
          }}
          onPointerDown={(e) => {
            if (!walking || e.pointerType === 'touch') return
            if (e.button === 0) hitting.current.quick = true
            else if (e.button === 2) hitting.current.heavy = true
          }}
          onPointerUp={(e) => {
            if (e.button === 0) hitting.current.quick = false
            else if (e.button === 2) hitting.current.heavy = false
          }}
          onContextMenu={(e) => {
            if (walking) e.preventDefault()
          }}
        >
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
          {/*
            ⚠️ THREE THINGS SHARING ONE WAIT IS UNREADABLE WITHOUT THIS. One cast needed no
            readout: you pressed it, it either went off or it did not, and a second later it
            worked again. Three of them on a single cooldown is a CHOICE, and a choice you
            cannot see the terms of is a guess — which of mine are these, and is any of them
            ready. The strip is the feature's other half rather than decoration on it.

            ⚠️ IN THE FIELD, BOTTOM LEFT, because that is where your eyes are during a fight
            and the paragraph under the park is not. The map already holds the other corner.
          */}
          {walking && myKit && (
            <div className="park-belt" role="status" aria-label="your big moves">
              {myKit.casts.map((k, i) => (
                /**
                 * ⚠️ THE CHIPS ARE BUTTONS NOW, WHICH THEIR OWN NOTE SAID TO WAIT FOR. It read
                 * "a chip you can press on a phone would promise a control the rest of the
                 * fight does not have… pointer-events stays off until that is untrue". The pad
                 * below makes it untrue, so these are the three keys a phone has no room for.
                 * They stay unpressable with a mouse — a keyboard has the number row.
                 */
                <button
                  key={k}
                  type="button"
                  aria-label={`Throw your ${CAST[k].short}`}
                  className={
                    'park-belt-one' +
                    (castLeft > 0 ? ' is-waiting' : ' is-ready') +
                    (casting === k ? ' is-out' : '')
                  }
                  onPointerDown={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    castWanted.current = i + 1
                  }}
                  onPointerUp={() => {
                    if (castWanted.current === i + 1) castWanted.current = 0
                  }}
                  onPointerCancel={() => {
                    if (castWanted.current === i + 1) castWanted.current = 0
                  }}
                >
                  <b>{i + 1}</b>
                  {CAST[k].short}
                  {/* the wait, drained rather than counted — a bar is read without being read */}
                  <i
                    /* ⚠️ against ITS OWN wait, not a shared one. The bolt comes back in half
                       a second and the earth-movers in four; one denominator would draw the
                       bolt's chip as full the instant it fired and empty the next frame. */
                    style={{
                      width: `${Math.max(0, Math.min(1, castLeft / CAST[k].wait)) * 100}%`,
                    }}
                  />
                </button>
              ))}
            </div>
          )}
          {/*
        ⚠️ REACH IS THE WHOLE FIGHT AND NOTHING SAID WHAT YOURS WAS. Measured rather than
        guessed: a scripted player that walks at the boss lands 70% of its swings and one that
        does not lands 33%, for identical timing and identical moves — spacing is worth more
        than twice everything else put together. And it was already known in the room, said
        plainly: "i would only ever play with the hitboxes turned on because thats currently
        required to win". The debug overlay was carrying a job the game should do itself.

        ⚠️ SO IT IS THE REAL SWIPE, NOT A RING. A ring at reach distance would promise cover
        behind you that a swing does not give — the area drawn here is strikeSwipe of the move
        F would actually throw given the keys you are holding right now, which is the same call
        the hit test makes. Change your aim and it turns; hold nothing and it points where you
        are facing.

        ⚠️ AND IT ONLY EXISTS WHEN THERE IS SOMETHING TO HIT. A permanent wedge under your feet
        while you are walking about a park with friends is furniture; it appears when a boss or
        the dummy is out, which is exactly when knowing your reach is the thing you need.
      */}
          {walking && myReach && (
            <SwipePatch
              swipe={myReach.swipe}
              cam={camAt}
              className={'park-reach' + (myReach.onTarget ? ' is-on' : '')}
            />
          )}
          {/*
            ⚠️ DRAWN IN WORLD UNITS LIKE EVERYTHING ELSE, so the pond stays where the pond is
            while the ground slides past it — the same onScreen every creature uses. Sized in
            screenfuls and corrected for the field's 16:10, or a round pond would be an oval.

            ⚠️ AND BEHIND EVERYBODY. z-index below the lowest creature: this is scenery, and a
            landmark that covered a boss would be a landmark somebody had to walk around twice.
          */}
          {walking &&
            MARKS.map((m) => {
              const p = onScreen(m.at, camAt)
              if (p.x < -0.8 || p.x > 1.8 || p.y < -0.8 || p.y > 1.8) return null
              return (
                <span
                  key={m.name}
                  /* ⚠️ THE RAISED ONES SAY SO, or a place you can stand on looks exactly like
                     a place you cannot and the first anybody knows about the rocks is landing
                     on them. `--top` is how high in pet-heights, so the rim can grow with it
                     rather than every plateau looking the same height. */
                  className={'park-mark is-' + m.kind + (raised.has(m.name) ? ' is-raised' : '')}
                  aria-hidden
                  style={
                    {
                      left: `${p.x * 100}%`,
                      top: `${p.y * 100}%`,
                      width: `${((m.size * 2) / FIELD_ASPECT) * 100}%`,
                      height: `${m.size * 2 * 100}%`,
                      '--top': raised.get(m.name) ?? 0,
                    } as React.CSSProperties
                  }
                />
              )
            })}
          {walking && <GuardArc me={shownYou} cam={camAt} />}
          {walking && <HopShade at={shownYou} cam={camAt} height={shownYou.up} />}
          {/* ⚠️ the boss gets one too, and it is the difference between a leap and a slide.
              Its own scale, or a thing three times the size casts a creature's shadow. */}
          {walking && bossShown && (
            <HopShade at={bossShown} cam={camAt} height={bossShown.up} size={bossShown.scale} />
          )}
          {walking &&
            [...state.current.here.values()].map((o) => (
              <HopShade key={'shade-' + o.id} at={o.shown} cam={camAt} height={o.hop} />
            ))}
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
                down: false,
                /* a wanderer keeps its feet on the grass */
                up: 0,
                pose: (w.moving ? 'run' : 'idle') as Stance,
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
                /* ⚠️ THEIRS IS DRAWN FROM WHAT THEY SENT AND DECIDES NOTHING. A peer's height
                   is a picture; what can hit YOU is worked out from YOUR height on this
                   machine, the same split every other thing a neighbour does already makes. */
                up: o.hop,
                /* ⚠️ theirs comes off the wire where mine comes off my own loop — see
                   Someone.down. It is a picture either way and decides nothing. */
                down: o.down,
                /* ⚠️ read off what they already send: moving or not, off the ground or not.
                   A peer's pose costs the wire nothing — see Someone's note on their move. */
                pose: (o.hop > 0.02 ? 'fly' : o.moving ? 'run' : 'idle') as Stance,
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
                down: knocked,
                up: shownYou.up,
                pose: poseOfMine(shownYou),
                lunge: lungeOf(shownYou, myMoves),
                /**
                 * ⚠️ A DIVE LEANS DOWN, NOT AT THE CURSOR. lungePush shoves the drawing along
                 * its aim, and a dive's aim is wherever you were pointing — so the creature
                 * threw a sideways swing while plummeting, which is the ground animation
                 * played in the air. Reported as "i can attack in the air but it triggers the
                 * animation which appears to be a ground attack". The move IS downward; the
                 * pose should say the same thing the physics does.
                 */
                aim: shownYou.dive ? { x: 0, y: 1 } : shownYou.aim,
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
                      (one.down ? ' is-down' : '') +
                      /* ⚠️ A DODGE YOU CANNOT SEE IS A DODGE YOU CANNOT LEARN TO TIME. The
                         0.26s of safety is the whole feature, so the creature has to look
                         untouchable for exactly as long as it is. */
                      (one.mine && dodging ? ' is-rolling' : '') +
                      /* committed, and visibly so — the same reason the boss squashes to turn */
                      (one.mine && casting ? ' is-casting' : '')
                    }
                    style={{
                      left: `${at.x * 100}%`,
                      top: `${at.y * 100}%`,
                      zIndex: depthOf(one.at),
                      /* the swing moves the picture, never the creature — see the scrap's note */
                      transform: (() => {
                        const size = petSize(one.art)
                        const p = lungePush(one.lunge, one.aim, one.art, size)
                        /* ⚠️ THE PICTURE GOES UP AND THE POSITION DOES NOT, which is the whole
                           of the height axis. one.at is still where the creature stands, so its
                           depth, its hitboxes and its shadow all stay on the ground it left.
                           ⚠️ AND AGAINST THE DRAWN BODY, not petSize. The height is in
                           pet-heights and petSize is the box the drawing is fitted INTO, which
                           for these creatures is three and a half times taller than the ink —
                           so 0.62 of a creature came out at 106px over a body 49px tall. Same
                           trap lungePush hit from the other side; petBox is the answer both
                           times, because it is the only thing here that knows how big the
                           creature actually is. */
                        const lift = one.up * petBox(one.art, size).h
                        return `translate(calc(-50% + ${p.x.toFixed(1)}px), calc(-100% + ${(
                          footRoom(one.art) * 100
                        ).toFixed(1)}% + ${(p.y - lift).toFixed(1)}px))`
                      })(),
                    }}
                  >
                    <PetView
                      art={one.art}
                      size={petSize(one.art)}
                      facing={one.facing}
                      show={one.show}
                      /* ⚠️ a peer's pose is read from what their message already says: they
                         are moving or they are not, and they are off the ground or not. The
                         wire gains nothing — see Someone. */
                      stance={one.pose}
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
                    <span className="park-name">{one.down ? `${one.name} — down` : one.name}</span>
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
          {/**
           * ⚠️ THE GROUND AGAIN, on the same layer as the swing telegraph and for the same
           * reason — what is about to hurt you belongs underfoot, where it is in the world
           * rather than floating over it. A patch that is live is drawn hard; one still winding
           * up grows into place, which is the whole of how a cast is read.
           */}
          {walking &&
            myPatches.map((p, i) => {
              const at = onScreen(p.at, camAt)
              return (
                <span
                  key={'mine' + i}
                  className={'park-patch is-mine' + (p.live ? ' is-live' : '')}
                  aria-hidden
                  style={{
                    left: `${at.x * 100}%`,
                    top: `${at.y * 100}%`,
                    width: `${((p.r * 2) / FIELD_ASPECT) * 100}%`,
                    height: `${p.r * 2 * 100}%`,
                    transform: `translate(-50%, -50%) scale(${(0.5 + p.ready * 0.5).toFixed(3)})`,
                    opacity: p.live ? 0.9 : 0.2 + p.ready * 0.5,
                  }}
                />
              )
            })}
          {walking &&
            patches.map((p, i) => {
              const at = onScreen(p.at, camAt)
              return (
                <span
                  key={i}
                  className={'park-patch' + (p.live ? ' is-live' : '')}
                  aria-hidden
                  style={{
                    left: `${at.x * 100}%`,
                    top: `${at.y * 100}%`,
                    width: `${((p.r * 2) / FIELD_ASPECT) * 100}%`,
                    height: `${p.r * 2 * 100}%`,
                    transform: `translate(-50%, -50%) scale(${(0.5 + p.ready * 0.5).toFixed(3)})`,
                    opacity: p.live ? 0.9 : 0.2 + p.ready * 0.5,
                  }}
                />
              )
            })}
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
              up={bossShown.up}
              scale={bossShown.scale}
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
              {/* ⚠️ SAYS WHAT TO DO, because the reference below already says what the place
                  is. This used to open with "a field three screens across" and the fact list
                  now says that too — one statement each. */}
              <p className="muted">Take a minion for a walk. Everybody in the park sees them.</p>
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

      {/*
        ⚠️ ON A PHONE YOU COULD WALK INTO THE PARK AND DO NOTHING ELSE. Four arrows and no way
        to swing, roll, guard, jump or throw anything — every one of the eleven controls added
        over the last month was a keyboard key, and "the park's existing line" was the excuse
        each time. It is the wrong line for a site whose whole audience is somebody's family
        opening it on a phone: they could watch a boss hit them and had no answer to it.

        ⚠️ FIVE, NOT ELEVEN. A phone cannot hold the keyboard's whole hand, so this is the set
        that makes the fight playable rather than complete: the quick swing you throw without
        thinking, the heavy you mean, and the three answers. The aimed swings are the deliberate
        omission — they need a direction held at the same time, which is a second thumb nobody
        has, and the neutral pair covers the fight. The casts get the belt instead, which was
        already on screen naming them.

        ⚠️ AND GUARD IS A HOLD, like its key. The others fire on the way down; this one is down
        for as long as your thumb is, which is the whole of what makes a parry a parry.
      */}
      {walking && (
        <div className="park-pad">
          <div className="park-pad-walk">
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
          <div className="park-pad-do">
            {(
              [
                ['quick', '✦', 'Quick swing'],
                ['heavy', '✸', 'Heavy swing'],
                ['roll', '↻', 'Roll'],
                ['guard', '🛡', 'Guard — hold it'],
                ['jump', '⤒', 'Jump'],
              ] as const
            ).map(([k, glyph, label]) => (
              <button
                key={k}
                className={'pet-play-key is-' + k}
                aria-label={label}
                onPointerDown={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  if (k === 'quick') hitting.current.quick = true
                  else if (k === 'heavy') hitting.current.heavy = true
                  else if (k === 'roll') rolling.current = true
                  else if (k === 'guard') bracing.current = true
                  else hopping.current = true
                }}
                onPointerUp={() => {
                  if (k === 'quick') hitting.current.quick = false
                  else if (k === 'heavy') hitting.current.heavy = false
                  else if (k === 'roll') rolling.current = false
                  else if (k === 'guard') bracing.current = false
                  else hopping.current = false
                }}
                onPointerCancel={() => {
                  if (k === 'quick') hitting.current.quick = false
                  else if (k === 'heavy') hitting.current.heavy = false
                  else if (k === 'roll') rolling.current = false
                  else if (k === 'guard') bracing.current = false
                  else hopping.current = false
                }}
                onPointerLeave={() => {
                  if (k === 'quick') hitting.current.quick = false
                  else if (k === 'heavy') hitting.current.heavy = false
                  else if (k === 'roll') rolling.current = false
                  else if (k === 'guard') bracing.current = false
                  else hopping.current = false
                }}
              >
                {glyph}
              </button>
            ))}
          </div>
        </div>
      )}

      {/*
        ⚠️ A RECORD YOU CANNOT LOOK AT IS A RECORD THAT ONLY EXISTS WHEN YOU HAPPEN TO PICK
        THE SAME CREATURE AGAIN. The line before a fight tells you about THAT one; this is the
        "look what we have done" that is the actual reason to keep any of it, and on a site
        for somebody's family that is most of the point.

        ⚠️ AND IT IS NOT THERE UNTIL THERE IS SOMETHING IN IT, so a first visit is not a table
        of noughts explaining a feature nobody has used yet.
      */}
      {myWins.length > 0 && (
        <details className="park-won">
          <summary>
            Beaten: <strong>{myWins.length}</strong>{' '}
            {myWins.length === 1 ? 'creature' : 'creatures'}
          </summary>
          <ul>
            {[...myWins]
              .sort((a, b) => b.at - a.at)
              .map((w) => (
                <li key={w.name}>
                  <strong>{w.name}</strong>
                  <span>
                    {w.beaten === 1 ? 'once' : `${w.beaten} times`} · quickest {said(w.best)}
                    {w.fell === 0 ? ' without going down' : ''}
                  </span>
                </li>
              ))}
          </ul>
        </details>
      )}
      {/* ⚠️ role=alert, not status: this is the one line on the page that is about something
          happening RIGHT NOW, and it is gone in a second and a half. */}
      {walking && bossCasting && (
        <p className="park-warning" role="alert">
          {CAST[bossCasting].says}
        </p>
      )}

      {/* ⚠️ A PROBLEM IS SAID OUT LOUD. A room that silently fails to connect is a room that
          looks like an empty park, and somebody waits in it for a friend who cannot arrive. */}
      {state.current.trouble && (
        <p className="muted park-trouble" role="status">
          {state.current.trouble}
        </p>
      )}
      {/* ⚠️ THE REASON, NOT THE ESSAY. This ran to three sentences explaining why a picture
          cannot be filtered and that Snake is open to everybody. The fact is the reason. */}
      {!authed && !walking && (
        <p className="muted park-trouble" role="status">
          Members only — in here your creature is drawn on everybody else's screen.{' '}
          <a href="#signin">Sign in</a>.
        </p>
      )}
      {tooBig && !walking && (
        <p className="muted park-trouble" role="status">
          {mine?.name} has too many strokes to send to everybody in the park. Take a simpler one.
        </p>
      )}

      {/*
        ⚠️ WHAT IS HAPPENING SITS ABOVE THE FIELD AND WHAT YOU CAN DO SITS BELOW IT, which is
        the ordering this page kept losing. "You are at the ring" is a live line and had ended
        up underneath two hundred pixels of key reference, because every addition went at the
        bottom and nobody read the page top to bottom afterwards. Three groups now: what is
        happening now, above; what you have done, here; what the controls are, below.
      */}
      {/*
        ⚠️ A REFERENCE, NOT AN ESSAY, AND THAT IS A REPAIR RATHER THAN A PREFERENCE. This was
        one paragraph of 468 words describing fourteen keys, and it got that way honestly —
        every new control appended a sentence or two and nobody ever read the whole thing back.
        Four hundred and sixty-eight words of prose is not how anybody finds out what Q does,
        least of all the people this site is actually for.

        ⚠️ AND IT IS RENDERED FROM WHAT THE HANDLER TESTS. Walking and swinging were already
        tables; rolling, guarding, jumping and casting are PARK_KEYS now, so the letters on
        screen cannot drift from the letters that work. The descriptions still have to be
        written by hand — but a wrong description is a thing you notice, and a wrong key is not.
      */}
      <dl className="park-keys">
        <div>
          <dt>
            <kbd>WASD</kbd> <kbd>←</kbd> <kbd>→</kbd> <kbd>↑</kbd> <kbd>↓</kbd>
          </dt>
          <dd>Walk</dd>
        </div>
        <div>
          <dt>
            <kbd>F</kbd> <kbd>G</kbd>
          </dt>
          <dd>Swing — quick, and heavy</dd>
        </div>
        <div>
          <dt>
            <kbd>W</kbd>/<kbd>S</kbd> + <kbd>F</kbd>/<kbd>G</kbd>
          </dt>
          <dd>Aim it high or low — six moves in all</dd>
        </div>
        <div>
          <dt>
            <kbd>1</kbd> <kbd>2</kbd> <kbd>3</kbd>
          </dt>
          <dd>
            Your three big moves, on one shared wait — <kbd>{keyName(PARK_KEYS.cast)}</kbd> throws
            the first
          </dd>
        </div>
        <div>
          <dt>
            <kbd>{keyName(PARK_KEYS.roll)}</kbd>
          </dt>
          <dd>Roll — a quarter-second where nothing can touch you</dd>
        </div>
        <div>
          <dt>
            <kbd>{keyName(PARK_KEYS.guard)}</kbd>
          </dt>
          <dd>
            Guard, held — front only, and a quarter gets through. Time it to the blow to parry: no
            damage, attacker wide open.
          </dd>
        </div>
        <div>
          <dt>
            <kbd>{keyName(PARK_KEYS.jump)}</kbd>
          </dt>
          <dd>
            Jump — clears anything drawn low, never an overhead. Wings glide if you hold it. Swing
            in the air to dive.
          </dd>
        </div>
      </dl>
      {/*
        ⚠️ ONLY WHAT LOOKING CANNOT TELL YOU. This was a 140-word tour, then a shorter one that
        still described the map, the landmarks and the size of the field — all of which are on
        the screen already. Evan: "this website is me to my friends and family, i wouldn't
        explain all of that." So the test for a line here is whether somebody would still be
        wondering after walking around for a minute: who the see-through ones are (nobody else
        sees them, so they cannot ask), and whose boss it is and when it leaves. Everything else
        the park shows them.
      */}
      {strolling.length > 0 && (
        <p className="muted park-about">Faded minions are your own. Only you see them.</p>
      )}
      <p className="muted park-about">
        A boss is one of your minions, big — <em>everybody</em> can hit it, and it goes when you do.
        The dummy hits back and cannot hurt you.
      </p>
      {/* ⚠️ Only the part a mouse changes. The key table above already says what the six moves
          and the three casts are; repeating them for a second input would be the tour this
          room had cut out of it. */}
      <p className="muted park-about">
        With a mouse: it aims, left swings quick, right swings heavy.
      </p>
      {/* ⚠️ A rule you cannot see: the trees are above a plain jump. That the ring and the
          rocks are raised at all is visible the moment you walk onto one, so it is not said. */}
      <p className="muted park-about">
        The ring and the rocks can be stood on. The far trees need wings.
      </p>
    </div>
  )
}
