import { outBy, downBy } from './strike'
import type { Spot } from './walk'

/**
 * Creatures that LIVE somewhere, rather than being sent at you.
 *
 * ⚠️ WHAT MAKES THIS DIFFERENT FROM A WAVE, which is the whole reason it is its own module.
 * Asked for as "mobs in park that you can agro and farm, like swarm minions but not a wave that
 * hunts you — it exists". A wave is an EVENT: it is called, it comes, it is cleared, and every
 * one of them wants you from the moment it lands. A wild thing is FURNITURE that happens to be
 * alive: it is somewhere, it stays there, and whether it is your problem is your decision. That
 * is the difference between a fight arriving and a fight being available, and it is the one
 * thing a park needs that a wave cannot provide.
 *
 * ⚠️ SO THE INTERESTING STATE IS "HAS IT NOTICED", AND EVERYTHING ELSE FOLLOWS FROM IT. A crowd
 * that all wakes at once is a wave with extra steps; a crowd that never wakes is scenery. Waking
 * a FEW and leading them away from the rest is the whole of farming, and it is why `rouse` wakes
 * by distance from the one that noticed rather than waking the field.
 *
 * ⚠️ AND IT GOES HOME. Without that, pulling three leaves a map permanently emptier until
 * something resets it, and the only way to play twice is to reload — which is the opposite of
 * somewhere you can go back to. Giving up and walking home is what makes the same corner worth
 * returning to, and it costs one countdown.
 *
 * ⚠️ EVERY DISTANCE IN HERE IS IN PET-HEIGHTS, and `apart` is the only thing that converts.
 * The park's two axes are different scales, so a raw hypot of world coordinates is not a
 * distance at all — it is a number that looks like one and is wrong by the aspect ratio. This
 * module has been written once, with one converter, which is the shape `outBy` exists to give
 * (see its note: it has nowhere to put a wrong factor).
 */

/** one of them */
export type Wild = {
  /** which drawing it is — an index into whatever the caller baked, never art itself */
  kit: number
  x: number
  y: number
  vx: number
  vy: number
  /** where it was put, in world units; it keeps near here while nobody bothers it */
  home: Spot
  life: number
  /** awake and coming for you */
  awake: boolean
  /**
   * How long it keeps coming after it can no longer justify it, in seconds.
   *
   * ⚠️ A COUNTDOWN RATHER THAN AN INSTANT GIVE-UP, because the alternative flickers. Judged
   * per frame, a creature at exactly the edge of its range wakes and sleeps and wakes again as
   * you shuffle, which reads as a broken creature rather than a decided one. It also means
   * stepping behind a rock for half a second does not lose it, which is the behaviour anybody
   * who has pulled a group expects.
   */
  cross: number
  /** how fast it is, as a multiple of everybody else — from its own drawing, see minionOf */
  pace: number
  /** its own phase, so a crowd at one spot does not drift as one body */
  seed: number
}

/**
 * The numbers, all in pet-heights and seconds.
 *
 * ⚠️ NOTICE IS SMALLER THAN LEASH ON PURPOSE. If a thing noticed you from further than it is
 * willing to stray, it would wake, take two steps, hit its leash and give up — over and over,
 * for as long as you stood there. Every range below is bigger than the one before it for the
 * same reason: notice < chase, so anything it wakes for is something it can actually reach.
 */
export const WILD = {
  /** how far it drifts from where it was put while nothing has bothered it */
  leash: 2.5,
  /** how close you come before it notices you */
  notice: 5,
  /** how far from home it will follow you before it starts giving up */
  chase: 13,
  /** how long it keeps coming once it has run out of reasons */
  patience: 2.2,
  /** waking one wakes its neighbours this far away, and no further */
  rouse: 4.5,
  /** how fast it ambles while nothing is happening, as a fraction of its chasing pace */
  amble: 0.28,
} as const

/**
 * How far apart two points are, IN PET-HEIGHTS.
 *
 * ⚠️ THE ONLY CONVERSION IN THIS FILE, and it divides rather than multiplies. `outBy(1)` is how
 * much world one pet-height is across and `downBy(1)` is how much it is down — so dividing by
 * them turns a world gap into creatures, which is the unit every threshold above is written in.
 * Done the other way round, as a hand-written aspect factor, this is the exact mistake the park
 * has already made three times (see the note on outBy).
 */
export const apart = (a: Spot, b: Spot): number =>
  Math.hypot((a.x - b.x) / outBy(1), (a.y - b.y) / downBy(1))

/** a fresh one, standing where it was put */
export function wildAt(kit: number, home: Spot, life: number, seed = 0, pace = 1): Wild {
  return {
    kit,
    x: home.x,
    y: home.y,
    vx: 0,
    vy: 0,
    home: { x: home.x, y: home.y },
    life,
    awake: false,
    cross: 0,
    pace,
    seed,
  }
}

/**
 * Who has just noticed you.
 *
 * ⚠️ IT ANSWERS FOR THE WHOLE CROWD AT ONCE, rather than being asked per creature, because
 * waking is contagious and contagion is not a property of one of them. One sees you, and the
 * ones standing near THAT ONE look up too — which is what makes a group a group, and what makes
 * leading three away from six a thing you can do on purpose.
 *
 * ⚠️ FROM THE SEEN ONE, NOT FROM YOU. Spreading it by distance from the PLAYER would be a
 * second, bigger notice radius wearing a disguise: everything inside it wakes, and the shape of
 * the group would be a circle round you rather than round whoever you disturbed.
 */
export function rouse(mobs: Wild[], you: Spot): Wild[] {
  const woke: Spot[] = []
  for (const m of mobs) {
    if (m.awake || m.life <= 0) continue
    if (apart(m, you) <= WILD.notice) woke.push({ x: m.x, y: m.y })
  }
  if (!woke.length) return mobs
  return mobs.map((m) => {
    if (m.awake || m.life <= 0) return m
    const near = woke.some((w) => apart(m, w) <= WILD.rouse)
    return near ? { ...m, awake: true, cross: WILD.patience } : m
  })
}

/**
 * One that has been hit is awake, whatever it had noticed.
 *
 * ⚠️ AND IT ROUSES ITS NEIGHBOURS TOO, through the same door. Hitting one thing in a group and
 * having only that one react is the behaviour that makes a crowd feel like a list rather than a
 * crowd — and it is also the exploit: pick them off one at a time from outside notice range,
 * forever. The shout is the same shout.
 */
export function struck(mobs: Wild[], i: number): Wild[] {
  const hit = mobs[i]
  if (!hit) return mobs
  return mobs.map((m, k) => {
    if (m.life <= 0) return m
    if (k === i) return { ...m, awake: true, cross: WILD.patience }
    if (m.awake) return m
    return apart(m, hit) <= WILD.rouse ? { ...m, awake: true, cross: WILD.patience } : m
  })
}

/**
 * Where a sleeping one wants to be at this moment.
 *
 * ⚠️ A FUNCTION OF TIME, like wander.ts and for the same reason — nothing accumulates, so a
 * tab that sleeps for a minute does not wake up to a creature that has drifted into the sea.
 * It is a target rather than a position, so the creature still has to WALK there and still
 * pushes against its neighbours on the way.
 */
export function restSpot(m: Wild, t: number): Spot {
  const own = t * 0.33 + m.seed * 2.3
  /**
   * ⚠️ THE MAGNITUDE IS CLAMPED, NOT EACH AXIS, and a test caught the difference. Scaling x and
   * y separately by a fraction of the leash lets the DIAGONAL reach that fraction times root
   * two — measured at 2.56 creatures against a leash of 2.5, so the one promise this function
   * makes was broken by about a tenth of a creature in the corners. Clamping the offset's own
   * length makes the bound true by construction rather than by a factor being chosen correctly.
   */
  const ox = WILD.leash * Math.sin(own)
  const oy = WILD.leash * Math.sin(own * 0.73 + 1.1)
  const mag = Math.hypot(ox, oy)
  const fit = mag > WILD.leash ? WILD.leash / mag : 1
  return {
    x: m.home.x + outBy(ox * fit),
    y: m.home.y + downBy(oy * fit),
  }
}

/**
 * What each one is heading for, and whether it is still interested.
 *
 * ⚠️ THE GIVING-UP TEST IS ABOUT ITS HOME, NOT ABOUT YOU. "Too far from where it lives" is a
 * rule somebody can see and use — walk out of the corner and the corner's creatures turn back —
 * whereas "too far from the player" is a rule that does nothing, because the player is the one
 * thing that is never far from the player. Leading a group out and losing them at a fixed line
 * is the whole of pulling.
 */
export function wantsIt(m: Wild, you: Spot, dt: number): Wild {
  if (!m.awake || m.life <= 0) return m
  const strayed = apart(m, m.home) > WILD.chase
  const lost = apart(m, you) > WILD.chase
  if (!strayed && !lost) return m.cross === WILD.patience ? m : { ...m, cross: WILD.patience }
  const cross = m.cross - dt
  return cross > 0 ? { ...m, cross } : { ...m, awake: false, cross: 0 }
}

/**
 * ⚠️ THE EXTRA FIELDS A FIGHT NEEDS, kept here rather than in the room so a wild thing is one
 * type everywhere. `cut` and `zapped` are the same one-hit-per-swing stamps the crowd carries —
 * a single `spent` flag on the swing fells ONE of a group, and no flag at all runs the hit test
 * every frame a swipe is live. `gone` counts a body's fade, and is negative while it is alive.
 */
export type Felled = { cut: number; zapped: number; gone: number }

/**
 * How a wild thing moves. Everything in PET-HEIGHTS and seconds — see `apart`.
 *
 * ⚠️ NOT A `Flock`, AND NOT stepSwarm. That one is the wave's, and its numbers are in
 * screen-heights because that is the space `toHeights` puts a crowd in; this module's thresholds
 * are all in pet-heights, which is the unit the park is actually written in. Converting between
 * the two every frame is a mixing point, and a missing PARK_TALL between those exact two spaces
 * is the mistake this repo has made three times (see docs/2026-10-07-ambient-creatures.md).
 *
 * ⚠️ AND THE THING IT GIVES UP IS NOT NEEDED HERE. A wave is forty things converging on one
 * point, which is why stepSwarm's separation has to be as careful as it is. These are placed by
 * hand, a few at a time, around the spot somebody put them — so "do not stand inside each other"
 * is the whole requirement, and it is three lines.
 */
export type WildTune = {
  /** how fast one travels at full tilt, before its own pace, in pet-heights a second */
  speed: number
  /** how quickly it gets there */
  grip: number
  /** how close two of them get before they push apart */
  apart: number
  /** how close it tries to get to you before it stops closing */
  reach: number
}

/** a direction in PET-HEIGHT space, which is the only space angles mean anything in here */
const toward = (from: Spot, to: Spot): { x: number; y: number; far: number } => {
  const dx = (to.x - from.x) / outBy(1)
  const dy = (to.y - from.y) / downBy(1)
  const far = Math.hypot(dx, dy)
  return far > 1e-9 ? { x: dx / far, y: dy / far, far } : { x: 0, y: 0, far: 0 }
}

/**
 * One step of everything that lives here.
 *
 * ⚠️ AWAKE ONES COME FOR YOU, SLEEPING ONES AMBLE ROUND HOME, and that is the only branch. The
 * target is the difference between the two states; everything after it — the easing, the
 * pushing apart, the clamping — is the same code, because a creature walks the same way whether
 * it is cross or not.
 *
 * ⚠️ POSITION IS WORLD, VELOCITY IS PET-HEIGHTS, AND THE CONVERSION HAPPENS ONCE, here, through
 * outBy/downBy — the same shape `stepFrom` uses in strike.ts. Keeping the velocity in the unit
 * the tune is written in means no number in this file is ever multiplied by an aspect ratio
 * somebody had to remember.
 */
export function stepWilds<T extends Wild>(
  mobs: T[],
  you: Spot,
  t: number,
  dt: number,
  tune: WildTune,
): T[] {
  if (!(dt > 0) || !mobs.length) return mobs
  const out: T[] = new Array(mobs.length)
  for (let i = 0; i < mobs.length; i++) {
    const m = mobs[i]
    if (m.life <= 0) {
      out[i] = m
      continue
    }
    const want = m.awake ? you : restSpot(m, t)
    const to = toward(m, want)
    /**
     * ⚠️ IT STOPS AT `reach` RATHER THAN AT YOUR MIDDLE, for the reason stepSwarm's own note
     * gives at length: something seeking your exact centre ends up standing inside you. Fading
     * the pull to nothing at reach makes you a body it walks up to rather than a point it
     * tries to occupy.
     */
    /**
     * ⚠️ IT GOES NEGATIVE INSIDE `reach`, AND CLAMPING IT AT ZERO WAS NOT ENOUGH — a test
     * caught one standing 0.1 of a creature from the middle of me, which is inside. Fading the
     * pull to nothing only removes the reason to come closer; it does not remove the momentum
     * already carried, and nothing then pushes back out. Reversing it makes the player a body it
     * walks up to rather than a point it ends up occupying, which is the same conclusion
     * stepSwarm's own note reaches about the wave.
     */
    const pull = m.awake
      ? Math.max(-1, Math.min(1, (to.far - tune.reach) / Math.max(1e-6, tune.reach)))
      : 1
    let ax = to.x * pull
    let ay = to.y * pull
    /* do not stand inside each other — the whole of what separation has to do for a few of them */
    for (let k = 0; k < mobs.length; k++) {
      if (k === i || mobs[k].life <= 0) continue
      const off = toward(mobs[k], m)
      if (off.far > 0 && off.far < tune.apart) {
        const push = 1 - off.far / tune.apart
        ax += off.x * push * 1.6
        ay += off.y * push * 1.6
      }
    }
    const mag = Math.hypot(ax, ay)
    const speed = tune.speed * m.pace * (m.awake ? 1 : WILD.amble)
    const wx = mag > 1e-9 ? (ax / mag) * speed : 0
    const wy = mag > 1e-9 ? (ay / mag) * speed : 0
    const ease = Math.min(1, tune.grip * dt)
    const vx = m.vx + (wx - m.vx) * ease
    const vy = m.vy + (wy - m.vy) * ease
    out[i] = {
      ...m,
      vx,
      vy,
      /* ⚠️ the one conversion: pet-heights a second becomes world, on each axis by its own
         measure, which is exactly what outBy and downBy are for */
      x: Math.max(0.02, Math.min(0.98, m.x + outBy(vx * dt))),
      y: Math.max(0.02, Math.min(0.98, m.y + downBy(vy * dt))),
    }
  }
  return out
}
