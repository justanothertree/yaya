import type { Spot } from './walk'

/**
 * Creatures going about their business while you walk.
 *
 * ⚠️ THEY ARE YOUR OWN OTHER MINIONS, NOT INVENTED PEOPLE. The park's real problem is that eight
 * people are mostly offline, and an empty field is a hard sell — but the cheap fix, filling it
 * with strangers who do not exist, is the one thing a place built for a small group of friends
 * should not do. Somebody walking up to say hello to a person who is not there is worse than a
 * quiet park. So the creatures wandering about are the ones you drew and are not currently
 * walking: honest about what they are, nobody is impersonated, and the art stays hand-drawn,
 * which is the premise of the whole game.
 *
 * ⚠️ NOBODY ELSE SEES YOURS AND YOU DO NOT SEE THEIRS. They cost the relay nothing and the
 * network nothing, because they are not shared state — they are a pure function of the clock.
 * The alternative, syncing them, would mean the park's busiest traffic was scenery.
 *
 * ⚠️ NO SIMULATION, NO STATE, NO STEP. A wanderer's position is worked out from the time and
 * nothing else, so there is no accumulating drift, no bounds to escape, nothing to reset when a
 * tab sleeps, and the whole thing can be checked by asking where they are at any moment. It is
 * also why `Math.sin` is fine here where it would not be in a fight: nothing agrees with anybody
 * about these, so nothing can disagree.
 */

/** How far from the middle of the park they roam, in world units. */
const ROAM = { x: 0.33, y: 0.3 }
const MIDDLE = { x: 0.5, y: 0.53 }

/**
 * Above this they are walking; below it they have stopped to look at something.
 *
 * ⚠️ PICKED OFF THE DISTRIBUTION, not guessed. The warped clock's rate runs from 0 to about
 * 0.21 with a median of 0.064, and the first value here — 0.004 — left them walking 96% of the
 * time, which reads as four creatures on rails rather than four having a wander. 0.02 sits just
 * under the lower quartile and puts them still about a sixth of the time: often enough to notice
 * one stop, rare enough that the park is not a room full of statues.
 */
const STIRRING = 0.02

/**
 * How far along its path a wanderer is at this moment.
 *
 * ⚠️ TIME THAT SPEEDS UP AND SLOWS DOWN, rather than a constant march. A creature tracing a curve
 * at a fixed rate reads as a machine on rails; one that dawdles, stops to look at something and
 * then hurries off reads as alive. Warping the clock does that with no state at all — when the
 * warp's slope passes through zero the creature simply stops, which is also how `moving` is known.
 */
const along = (i: number, t: number) => {
  const own = t * (0.05 + i * 0.011) + i * 2.9
  return own + 0.9 * Math.sin(own * 0.7 + i) + 0.45 * Math.sin(own * 1.9 + i * 2.1)
}

/** The rate of the above, which is how fast it is going and therefore whether it is going at all. */
const pace = (i: number, t: number) => {
  const d = 0.0008
  return (along(i, t + d) - along(i, t - d)) / (2 * d)
}

/** Where wanderer `i` is at time `t` seconds, and which way it is looking. */
export function wanderAt(i: number, t: number): { at: Spot; facing: number; moving: boolean } {
  const u = along(i, t)
  /* ⚠️ two turns that do not divide into each other, so the path never closes into a loop you
     can watch repeat — 1 and 0.61 wander the whole field instead of tracing one oval for ever */
  const x = MIDDLE.x + ROAM.x * Math.sin(u)
  const y = MIDDLE.y + ROAM.y * Math.sin(u * 0.61 + i * 1.3)
  const d = 0.0008
  const ahead = MIDDLE.x + ROAM.x * Math.sin(along(i, t + d))
  const speed = Math.abs(pace(i, t))
  return {
    at: { x, y },
    facing: ahead > x ? 1 : ahead < x ? -1 : 1,
    moving: speed > STIRRING,
  }
}

/**
 * How many of your creatures are out.
 *
 * ⚠️ CAPPED, because somebody with forty minions should not get forty of them milling about — a
 * park with a crowd in it is as hard to find a person in as an empty one is to enjoy.
 */
export const MAX_WANDERERS = 4
