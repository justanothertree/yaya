import type { Drawing } from '../draw/strokes'
import { attacksOf, moveTable, petWide, type Attack } from '../pets/attack'
import { rigOf } from '../pets/rig'
import { restingWalker, VIEW, type Spot } from './walk'
import { footOf, PARK_TALL, restingStriker, type StrikeInput, type Striker } from './strike'

/**
 * A boss.
 *
 * ⚠️ IT IS A MINION, AND THAT IS THE WHOLE DESIGN. Not a new kind of thing in the library, not a
 * second drawing format, not a second wizard to learn — "boss" is a ROLE a creature is placed in,
 * the way "the one you are walking" is a role. The same drawing that fights in a scrap stands in
 * the park as a boss, scaled up, given a pool of health instead of three lives, and driven by
 * something that actually plays.
 *
 * ⚠️ WHICH MEANS FIGHTING A BOSS IS FIGHTING SOMETHING SOMEBODY DREW, and that is the point
 * rather than a compromise. Every other bet in this module has been that the drawing decides — a
 * layer name is a skeleton, a layer name is a move, where you draw a hit is what the hit does. A
 * boss that needed its own format would be the first thing here that a drawing could not be.
 *
 * ⚠️ AND IT IS THE CHEAP ANSWER AS WELL AS THE RIGHT ONE. Everything a boss needs beyond a minion
 * is size, health and an opponent worth fighting — three things, none of which is a format.
 */

export type Boss = Striker & {
  name: string
  art: Drawing
  /** how many times taller than an ordinary creature it stands */
  scale: number
  /** what is left of it */
  life: number
  lifeMax: number
  /** seconds since it last decided anything, so it commits instead of twitching */
  think: number
  /** which way it last chose to go */
  lean: number
}

/**
 * How big, and how much of it there is.
 *
 * ⚠️ SIZE IS NOT DIFFICULTY, and keeping them apart is what stops a boss being a wall. A creature
 * three times as tall covers nine times the ground and reaches three times as far — that alone
 * would make it unbeatable rather than hard. So the health is set against how long a fight should
 * take rather than against how big the thing is.
 */
export const BOSS = { scale: 2.6, life: 520, guard: 0.45 }

export const bossTall = (b: Boss) => PARK_TALL * b.scale

export function makeBoss(name: string, art: Drawing, at: Spot): Boss {
  return {
    ...restingStriker(restingWalker(at.x, at.y)),
    name,
    art,
    scale: BOSS.scale,
    life: BOSS.life,
    lifeMax: BOSS.life,
    think: 0,
    lean: -1,
    facing: -1,
  }
}

export const bossMoves = (art: Drawing): Attack[] => moveTable(attacksOf(rigOf(art)))
export const bossWide = (art: Drawing): number => petWide(art)

/** Its footprint, which is its own size rather than everybody's. */
export const bossFoot = (b: Boss) => {
  const foot = footOf(bossWide(b.art))
  return { x: foot.x * b.scale, y: foot.y * b.scale }
}

/**
 * What a boss does next.
 *
 * ⚠️ IT ACTUALLY PLAYS, unlike the practice opponent in the scrap. That one was written to be
 * something to learn against and is deliberately poor — it closes, it swings, it goes home. A
 * boss is the thing you are meant to lose to the first few times, so this keeps its distance,
 * picks the move that fits the distance rather than the one that comes up, and commits to a
 * decision for a beat instead of changing its mind every frame.
 *
 * ⚠️ STILL AN INPUT, though, and still steered through the same stepStrike a person is. It cannot
 * do anything you could not: no extra speed, no attacks from nowhere, no turning mid-swing. An
 * opponent that cheats in ways nobody can see is one everybody can feel.
 */
export function bossThink(
  b: Boss,
  target: Spot,
  moves: Attack[],
): { steer: { left: boolean; right: boolean; up: boolean; down: boolean }; hit: StrikeInput } {
  const dx = target.x - b.x
  const dy = target.y - b.y
  const away = Math.abs(dx)

  /* its own reach, which is bigger than a creature's because it is */
  const quick = moves[0]
  const reach = ((quick?.reach ?? 0.9) * PARK_TALL * b.scale) / (16 / 10)
  const step = reach * VIEW.w

  /* ⚠️ a beat of commitment: re-deciding every frame is what makes a thing look like a machine */
  const beat = Math.floor(b.think * 1.6)
  const backOff = beat % 5 === 0

  const wantX = backOff ? -Math.sign(dx) : away > step * 0.8 ? Math.sign(dx) : 0
  /* ⚠️ depth is closed first: a swing reaches sideways, so standing on the wrong line is the one
     position from which nothing it does can possibly land */
  const wantY = Math.abs(dy) > bossFoot(b).y * 1.3 ? Math.sign(dy) : 0

  const lined = Math.abs(dy) < bossFoot(b).y * 2.2
  const inRange = away < step * 1.05 && lined
  /* far but lined up: the long move. Close: the quick one. */
  const heavy = inRange && away > step * 0.55

  return {
    steer: {
      left: wantX < 0,
      right: wantX > 0,
      up: wantY < 0,
      down: wantY > 0,
    },
    hit: {
      quick: inRange && !heavy && beat % 2 === 0,
      heavy: inRange && heavy && beat % 3 === 0,
      /* it aims down for its long move, the same key a person would hold */
      up: false,
      down: heavy,
    },
  }
}

/** A blow landed on it. */
export const wounded = (b: Boss, a: Attack): Boss => ({
  ...b,
  /* ⚠️ a boss is not staggered by every tap, or it could be stunlocked by one person mashing —
     it takes the damage and keeps coming, which is most of what makes it a boss */
  life: Math.max(0, b.life - a.bite),
  hold: 0.05 + a.bite * 0.003,
  hurt: b.hurt + a.bite,
})

export const beaten = (b: Boss): boolean => b.life <= 0
