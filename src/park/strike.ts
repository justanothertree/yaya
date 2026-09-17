import { PET_TALL } from '../pets/play'
import { slotFor, type Aim, type Attack } from '../pets/attack'
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
  /** damage taken; the park does nothing with it but a boss will */
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
const across = (screenHeights: number) => (screenHeights / ASPECT) * VIEW.w
const down = (screenHeights: number) => screenHeights * VIEW.h

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

export const footOf = (wide: number): { x: number; y: number } => ({
  x: across(wide * 0.8) / 2,
  y: down(FOOT.deep * PARK_TALL) / 2,
})

/**
 * The patch a swing is hurting right now, or null if it is not hurting yet.
 *
 * ⚠️ READ OFF THE SAME live WINDOW AS THE FIGHT, so a move that is dangerous for the middle third
 * of its swing is dangerous for the middle third of its swing wherever it is thrown.
 */
export function strikeArea(at: Spot, facing: number, a: Attack, gone: number): Box | null {
  const f = gone / a.span
  if (f < a.live[0] || f > a.live[1]) return null
  const reach = across(a.reach * PARK_TALL)
  const deep = down(Math.max(a.rise, 0.4) * PARK_TALL)
  const x0 = a.both ? at.x - reach : facing > 0 ? at.x : at.x - reach
  return {
    x0,
    y0: at.y - deep,
    x1: x0 + (a.both ? reach * 2 : reach),
    y1: at.y + deep,
  }
}

/** Is this creature standing in that patch? */
export function inArea(at: Spot, wide: number, b: Box): boolean {
  const foot = footOf(wide)
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
 * site into somewhere you can be griefed. A boss is the thing that will care about `hurt`; between
 * two people it is a push and a moment of being off balance, which is play rather than harm.
 */
export const SHOVE = 0.55

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
    hurt: s.hurt + a.bite,
  }
}
