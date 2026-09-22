import type { Stance } from '../pets/rig'

/**
 * What a creature is doing, as the few facts that decide how it stands.
 *
 * ⚠️ ONE LADDER FOR ALL THREE OF THEM, and that is the entire reason this is a module rather
 * than a function inside the room. The park draws you, your neighbours and the boss, and each
 * one knew about its own state in its own place — so the player got six stances, a peer got
 * three, and the boss got none at all and stood idle through a fight it was winning. Three
 * implementations of "what is it doing" is how a boss ends up casting in the idle pose.
 *
 * ⚠️ BOOLEANS, NOT A STRIKER. A peer is not a Striker and a Boss is not either; what the three
 * have in common is the questions, not the type. Each caller answers the ones it can and leaves
 * the rest — a boss cannot glide and never will, so it simply does not say.
 *
 * ⚠️ PURE, so the order can be checked without a browser. The park's frame does not fire in
 * the pane any of this is verified in.
 */
export type Doing = {
  /** on the floor, out of the fight */
  down?: boolean
  /** committed downwards out of the air */
  dive?: boolean
  /** mid-dodge, the quarter second nothing can touch */
  roll?: boolean
  /** a swing is out */
  swing?: boolean
  /** off the ground at all */
  aloft?: boolean
  /** off the ground AND holding wings out — only meaningful with aloft */
  gliding?: boolean
  /** stunned, or frozen by contact */
  hurt?: boolean
  /** winding up one of the big moves */
  cast?: boolean
  /**
   * Telegraphing: about to do something, and deliberately not moving while it does.
   *
   * ⚠️ THIS IS WHAT `alert` WAS FOR, and nothing had ever used it. rig.ts has described it
   * as "the pose before it does something" since the pets room existed, and the one thing in
   * the park that spends whole moments about to do something — a boss winding up a charge or
   * crouching before a leap — stood in the idle pose to do it. A tell nobody can see is not a
   * tell, which is the same argument the turning class already won.
   */
  warning?: boolean
  /** guard up */
  braced?: boolean
  /** actually going somewhere */
  moving?: boolean
}

/**
 * How it stands.
 *
 * ⚠️ ORDER IS THE WHOLE LOGIC. The most committed thing a creature is doing wins, because that
 * is the one a player has to read: a dive while also technically moving is a dive, and a roll
 * while also technically swinging is a roll, because you cannot throw a swing out of a dodge —
 * a striker that is both is one whose swing is being carried through the roll.
 *
 * ⚠️ DOWN OUTRANKS EVERYTHING, including a swing that was still in flight when it landed.
 * Being on the floor is the one state where what you were trying to do stopped mattering.
 */
export function poseOf(d: Doing): Stance {
  if (d.down) return 'sleep'
  if (d.dive) return 'dive'
  if (d.roll) return 'roll'
  if (d.swing) return 'pounce'
  if (d.aloft) return d.gliding ? 'glide' : 'fly'
  if (d.hurt) return 'hurt'
  if (d.cast) return 'cast'
  /* ⚠️ under hurt, because being hit interrupts a wind-up and the pose should say so */
  if (d.warning) return 'alert'
  if (d.braced) return 'crouch'
  if (d.moving) return 'run'
  return 'idle'
}
