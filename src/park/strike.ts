import { PET_TALL } from '../pets/play'
import { hurtHalf, slotFor, type Aim, type Attack } from '../pets/attack'
import type { Box } from '../pets/rig'
import { SQUASH, VIEW, type Spot, type Walker } from './walk'

/**
 * Hitting things from above.
 *
 * ⚠️ THE SAME MOVES, A DIFFERENT SHAPE. An Attack is read out of a drawing once and means the
 * same thing everywhere — reach, timing, how much it hurts — which was the entire point of
 * keeping the geometry in attack.ts and the consequences in the game. This is the park's set of
 * consequences: no launching, because there is no up to launch into, and no ring-outs, because
 * there is no edge to fall off. What a hit does here is shove and stagger.
 *
 * ⚠️ TWO WAYS, NOT EIGHT. A creature faces left or right because that is what a hand-drawn pet
 * can do — PetView mirrors, it does not turn — so a swing goes the way the creature is looking
 * and reaches a little way above and below itself. Pretending to eight directions would need
 * eight drawings of every creature, which is the opposite of the promise this whole thing makes.
 *
 * ⚠️ PURE, so a whole exchange can be played out with no browser — the same reason play.ts and
 * fight.ts are, and the only way any of this gets checked at all.
 */

export type Striker = Walker & {
  /** seconds left of the swing being thrown, 0 for none */
  swing: number
  /** which entry of the creature's move table is out */
  move: number
  /** true once this swing has connected, so one swing is one hit */
  spent: boolean
  /** seconds left before another may be thrown */
  rest: number
  /** seconds of being knocked about, during which nothing is steered */
  stun: number
  /** the freeze on contact, for both of them — see fight.ts, same idea and same reason */
  hold: number
  /** damage taken from bosses; a neighbour's shove never adds to it — see mauled */
  hurt: number
  /** the attack buttons as they were last frame, because a swing is a press */
  heldQ: boolean
  heldH: boolean
}

export type StrikeInput = { quick: boolean; heavy: boolean; up: boolean; down: boolean }

export const restingStriker = (w: Walker): Striker => ({
  ...w,
  swing: 0,
  move: 0,
  spent: false,
  rest: 0,
  stun: 0,
  hold: 0,
  hurt: 0,
  heldQ: false,
  heldH: false,
})

/**
 * ⚠️ A CREATURE'S WIDTH IS MEASURED IN SCREEN HEIGHTS AND THE WORLD IS MEASURED IN SCREEN
 * WIDTHS, and mixing the two is the whole of what went wrong first. `petWide` is PET_TALL times
 * the drawing's shape, so it is a fraction of the field's HEIGHT; VIEW.w is a fraction of the
 * world's WIDTH. Multiplying one by the other made a long-tailed creature's footprint 47% of a
 * screen across and let a right-facing swing hit somebody standing behind it.
 *
 * So anything horizontal is divided by the field's own aspect on the way out, and anything
 * vertical is not. These two functions are the only place that conversion happens.
 */
const ASPECT = 16 / 10
export const across = (screenHeights: number) => (screenHeights / ASPECT) * VIEW.w
export const down = (screenHeights: number) => screenHeights * VIEW.h

/**
 * How tall a creature stands here, as a fraction of the field's height.
 *
 * ⚠️ 0.8 OF THE PLATFORMER'S, matching what the park actually draws — see petSize in
 * ParkRoom. A hitbox sized from a different number than the picture is a hitbox nobody can see.
 */
export const PARK_TALL = PET_TALL * 0.8

/**
 * How big a creature is to hit, in world units.
 *
 * ⚠️ A FOOTPRINT, NOT A PORTRAIT. Seen from above a creature covers a patch of grass, and the
 * patch is much shallower than the drawing is tall — the picture stands up off the ground. Depth
 * is therefore its own number rather than the drawing's height, or everything in the park would
 * be hittable from half a screen away in a direction it cannot even see.
 */
export const FOOT = { deep: 0.28 }

/**
 * The shallowest a swing may be from above, as a half-height in pet-heights.
 *
 * ⚠️ NAMED AND EXPORTED so the maker can draw the box this game actually uses — see
 * hurtHalf. It was a bare 0.4 inside strikeArea, which meant nothing outside this file could ask
 * what the park's hitbox really was, and the preview guessed a different number.
 */
export const PARK_DEEP = 0.4

/**
 * The deepest any swing may be, as a fraction of the visible field's height.
 *
 * ⚠️ THE FLOOR YOU ARE ALWAYS LEFT. At 0.28 there is 72% of the screen that a single swing
 * cannot reach, whatever creature threw it, which is what makes stepping out of one a thing you
 * can always do rather than a thing that depends on what the boss was drawn like. A player's own
 * swings come out at about 14% of the screen deep, so this never touches them — it exists for
 * what happens when a drawing is scaled up into a boss.
 */
export const DODGE_ROOM = 0.28

export const footOf = (wide: number, scale = 1): { x: number; y: number } => ({
  x: across(wide * 0.8 * scale) / 2,
  y: down(FOOT.deep * PARK_TALL * scale) / 2,
})

/**
 * The patch a swing is hurting right now, or null if it is not hurting yet.
 *
 * ⚠️ READ OFF THE SAME live WINDOW AS THE FIGHT, so a move that is dangerous for the middle third
 * of its swing is dangerous for the middle third of its swing wherever it is thrown.
 */
export function strikeArea(
  at: Spot,
  facing: number,
  a: Attack,
  gone: number,
  /** ⚠️ a bigger creature reaches further, because its arm IS longer — see the boss */
  scale = 1,
): Box | null {
  const f = gone / a.span
  if (f < a.live[0] || f > a.live[1]) return null
  const reach = across(a.reach * PARK_TALL * scale)
  /**
   * ⚠️ DEPTH IS THE DODGE AXIS, SO IT MUST NOT GROW THE WAY REACH DOES. A bigger creature
   * genuinely has a longer arm, and reach scaling with size is the whole reason a boss is
   * frightening. Depth is a different question: seen from above, stepping out of a swing means
   * crossing it in y, so the deeper the band the less there is anywhere to stand — and scaling
   * it linearly meant a 2.5x boss swung a band 48% of the screen deep and 31% wide. Watched with
   * the boxes on and reported exactly right: "a boss is just attacking a giant rectangle that I'm
   * not sure how to even fight". It was not a fight, it was a room with no floor left.
   *
   * ⚠️ TWO LIMITS, BECAUSE ONE IS NOT ENOUGH. The power curve keeps a big creature's swing
   * meaningfully deeper than a small one's without it being proportional; the cap is the promise
   * that whatever anybody draws, MOST OF THE SCREEN IS ALWAYS SAFE. This is the Smash bargain:
   * Bowser's moves are bigger than Kirby's and the stage does not shrink to match.
   */
  const grow = Math.pow(Math.max(0.05, scale), 0.45)
  const deep = Math.min(down(hurtHalf(a, PARK_DEEP) * PARK_TALL * grow), (VIEW.h * DODGE_ROOM) / 2)
  const x0 = a.both ? at.x - reach : facing > 0 ? at.x : at.x - reach
  return {
    x0,
    y0: at.y - deep,
    x1: x0 + (a.both ? reach * 2 : reach),
    y1: at.y + deep,
  }
}

/** Is this creature standing in that patch? */
export function inArea(at: Spot, wide: number, b: Box, scale = 1): boolean {
  const foot = footOf(wide, scale)
  return (
    at.x + foot.x > b.x0 && at.x - foot.x < b.x1 && at.y + foot.y > b.y0 && at.y - foot.y < b.y1
  )
}

/**
 * One step of somebody who can swing as well as walk.
 *
 * ⚠️ IT DOES NOT STEP THE WALKING. stepWalker owns that and is called by the room either side of
 * this, because a swing is a thing that happens TO a walk rather than instead of one — and two
 * functions that both moved a creature would be two answers to where it is.
 */
export function stepStrike(s: Striker, input: StrikeInput, moves: Attack[], dt: number): Striker {
  const t = Math.max(0, Math.min(0.05, dt))
  if (s.hold > 0)
    return {
      ...s,
      hold: Math.max(0, s.hold - t),
      heldQ: input.quick,
      heldH: input.heavy,
    }

  const stun = Math.max(0, s.stun - t)
  const rest = Math.max(0, s.rest - t)
  let swing = Math.max(0, s.swing - t)
  let move = s.move
  let spent = s.spent

  /* the rising edge only, the same rule the fight follows — holding a button is not a decision */
  const tapQ = input.quick && !s.heldQ
  const tapH = input.heavy && !s.heldH
  if (stun <= 0 && swing <= 0 && rest <= 0 && (tapQ || tapH)) {
    const aim: Aim = input.up ? 'up' : input.down ? 'down' : 'neutral'
    move = Math.min(moves.length - 1, slotFor(tapH, aim))
    swing = moves[move]?.span ?? 0
    spent = false
  }

  return {
    ...s,
    swing,
    move,
    spent,
    stun,
    rest: swing > 0 ? (moves[move]?.rest ?? 0) + swing : rest,
    heldQ: input.quick,
    heldH: input.heavy,
  }
}

/** True while this creature is not steering itself — mid-swing, staggered, or frozen on contact. */
export const busy = (s: Striker): boolean => s.swing > 0 || s.stun > 0 || s.hold > 0

/**
 * What a landed blow does here.
 *
 * ⚠️ SHOVE AND STAGGER, NOT DAMAGE AND DEATH. The park is somewhere people walk about together,
 * and a swing that could take somebody's creature off them would turn the one shared space on the
 * site into somewhere you can be griefed. Between two people it is a push and a moment of being
 * off balance, which is play rather than harm.
 *
 * ⚠️ AND THE BOSS IS THE EXCEPTION THIS ALWAYS MEANT TO MAKE — see mauled. This used to add
 * `a.bite` to `hurt` on every blow including a neighbour's, which was harmless only because
 * nothing read `hurt` at all. Now that a pool reads it, the two have to be different functions,
 * or walking past somebody mid-swing would take your health off.
 */
export const SHOVE = 0.55

/**
 * How much a creature can take from a boss before it goes down.
 *
 * ⚠️ FLAT, AND DELIBERATELY NOT READ FROM THE DRAWING. The boss's own life is already
 * budgeted against how dangerous it is — see BUDGET in temper.ts — so a nastier boss is a
 * shorter fight, not a fight you lose faster from a pool that also moved. Two dials pulling on
 * the same balance is how a fight ends up impossible for the creature that drew it.
 */
export const PLAYER_LIFE = 100

/**
 * How long you are down for before you get back up.
 *
 * ⚠️ A SETBACK, NOT A PUNISHMENT. Going down costs you the seconds and hands the boss a free
 * run at whoever else is fighting it; it does not cost you the creature, the progress, or the
 * walk home. The park is somewhere you can wander into a fight without checking first, and a
 * death that took something off you would make it somewhere you have to be ready for.
 */
export const DOWN_FOR = 3

/**
 * One step of going down and getting back up.
 *
 * ⚠️ OUT HERE RATHER THAN IN THE ROOM, for the reason everything else in this file is: the
 * park runs on requestAnimationFrame, which never fires in the pane the rest of this is checked
 * in, so a knockout that lived inside the loop would be a knockout nobody could ask a question
 * of. Called directly it answers "how many of this boss's hits can I take" with no browser.
 *
 * ⚠️ HELD AS A LONG STUN rather than a flag of its own, because stun already means every
 * single thing being down has to mean — nothing steers (busy), nothing swings, and the guard on
 * every incoming blow is `stun <= 0`, so you cannot be kicked while you are lying there.
 *
 * ⚠️ AND YOU COME BACK WHOLE WHILE THE BOSS DOES NOT. `hurt` is cleared on the way up; the
 * boss keeps every point you took off it. A boss that reset the fight each time it won would be
 * a boss nobody ever finishes.
 *
 * @returns the seconds left, the creature, and whether this step crossed a threshold — 'down'
 * and 'up' happen once each, which is all the room needs to redraw.
 */
export function stepDown(
  down: number,
  s: Striker,
  dt: number,
): { down: number; s: Striker; went: 'down' | 'up' | null } {
  const t = Math.max(0, Math.min(0.05, dt))
  if (down > 0) {
    const left = Math.max(0, down - t)
    return left > 0
      ? { down: left, s: { ...s, swing: 0, stun: Math.max(s.stun, left) }, went: null }
      : { down: 0, s: { ...s, hurt: 0, stun: 0, vx: 0, vy: 0 }, went: 'up' }
  }
  if (s.hurt < PLAYER_LIFE) return { down: 0, s, went: null }
  return { down: DOWN_FOR, s: { ...s, swing: 0, stun: DOWN_FOR }, went: 'down' }
}

export function shoved(s: Striker, from: Spot, a: Attack): Striker {
  const dx = s.x - from.x
  const dy = s.y - from.y
  const len = Math.hypot(dx, dy) || 1
  const power = a.shove * SHOVE
  /* ⚠️ the same shape stepWalker uses for its own speeds — x in world units, y scaled by
     SQUASH — so being shoved north looks as fast as being shoved east */
  return {
    ...s,
    vx: (dx / len) * power * VIEW.w,
    vy: (dy / len) * power * VIEW.w * SQUASH,
    swing: 0,
    stun: 0.1 + power * 0.22,
    hold: 0.05 + a.bite * 0.004,
  }
}

/**
 * The same blow, from something that is allowed to hurt you.
 *
 * ⚠️ ONLY A BOSS CALLS THIS, which is the whole distinction shoved's note is about. It is a
 * separate function rather than a flag because the call site is where somebody will look to ask
 * "can this take my health off", and a `true` sitting in an argument list does not answer that.
 */
export const mauled = (s: Striker, from: Spot, a: Attack): Striker => {
  const p = shoved(s, from, a)
  return { ...p, hurt: p.hurt + a.bite }
}
