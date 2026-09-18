import type { Drawing } from '../draw/strokes'
import { attacksOf, moveTable, petWide, type Attack } from '../pets/attack'
import { rigOf } from '../pets/rig'
import { restingWalker, VIEW, type Spot } from './walk'
import { across, footOf, PARK_TALL, restingStriker, type StrikeInput, type Striker } from './strike'
import { givesGround, goesBig, runsAtYou, temperOf, type Temper } from './temper'

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
  /**
   * What kind of thing it is, read out of its own drawing.
   *
   * ⚠️ CARRIED, NOT LOOKED UP. temperOf walks every stroke; this is read on every frame of
   * the fight. Same bargain as a Part carrying its own strokes.
   */
  temper: Temper
  /** how many times taller than an ordinary creature it stands — its temper's, kept here so
      everything downstream can ask the boss rather than the drawing */
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
 * How big, and how much of there is, WHEN THE DRAWING HAS NOTHING TO SAY.
 *
 * ⚠️ SIZE IS NOT DIFFICULTY, and keeping them apart is what stops a boss being a wall. A creature
 * three times as tall covers nine times the ground and reaches three times as far — that alone
 * would make it unbeatable rather than hard. So the health is set against how long a fight should
 * take rather than against how big the thing is.
 *
 * ⚠️ AND IT IS NOW A FALLBACK RATHER THAN THE ANSWER. Every one of these comes out of the
 * drawing — see temper.ts — because two different pictures that fought identically were a
 * drawing that did not matter. What is left here is the middle of the band, for the places that
 * need a number before they have a creature.
 */
export const BOSS = { scale: 2.6, life: 520, guard: 0.45 }

export const bossTall = (b: Boss) => PARK_TALL * b.scale

export function makeBoss(name: string, art: Drawing, at: Spot): Boss {
  const temper = temperOf(art)
  return {
    ...restingStriker(restingWalker(at.x, at.y)),
    name,
    art,
    temper,
    scale: temper.scale,
    life: temper.life,
    lifeMax: temper.life,
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
): {
  steer: { left: boolean; right: boolean; up: boolean; down: boolean }
  hit: StrikeInput
  /** what to hand stepWalker, so a charge is visibly a charge */
  speed: number
} {
  const t = b.temper
  const dx = target.x - b.x
  const dy = target.y - b.y
  const away = Math.abs(dx)

  /**
   * How far it can hit from, which is bigger than a creature's because IT is.
   *
   * ⚠️ ITS LONGEST MOVE, NOT ITS QUICKEST. This measured the quick one, so a boss made of an
   * enormous tail stood as close as a boss made of a stub and never used the thing it was drawn
   * with — and `range` has always been documented as a share of its LONGEST reach. The creature
   * that can hit you from further away should be standing further away.
   */
  const long = moves.reduce((most, a) => Math.max(most, a.reach), moves[0]?.reach ?? 0.9)
  const reach = (long * PARK_TALL * b.scale) / (16 / 10)
  const step = reach * VIEW.w

  /**
   * ⚠️ A BEAT OF COMMITMENT: re-deciding every frame is what makes a thing look like a machine.
   * How LONG a beat is now comes out of the drawing — a creature whose moves are slow and
   * expensive reads as deliberate, one made of quick jabs reads as twitchy, and before this every
   * boss on the site re-decided on exactly the same 0.625 second tick.
   */
  const beat = Math.floor(b.think / t.beat)
  const charging = runsAtYou(beat, t) && away > step * 1.1

  /**
   * ⚠️ WHERE IT WANTS TO STAND IS ITS OWN REACH, NOT A CONSTANT. A creature made of one long
   * tail should hover at the end of it; one made of a jaw has to be in your face and ought to
   * behave like it knows that. This one number is most of why two bosses feel different to fight.
   */
  const want = step * t.range

  /**
   * ⚠️ GIVING GROUND HAS A FLOOR, AND IT HAD NONE. `givesGround` is a coin weighted by nerve,
   * and a nervous boss (nerve is allowed down to 0.2) came up "back away" on four beats in five
   * — against an approach that only happens when it is already too far out. The drift is one
   * way. Watched in the workbench: a boss landed one hit, turned, and walked to 155% of a screen
   * and kept going, with the health bar frozen at 90% because nothing could reach anything.
   *
   * So backing off is a thing you do IN a fight, not a way out of one: it only applies while the
   * boss is still within half again of where it wants to stand. Past that there is nothing to
   * retreat from and it closes. The character is untouched — a darter still darts when you are
   * on top of it, which is the only place darting means anything.
   */
  const backOff = !charging && away < want * 1.5 && givesGround(beat, t)
  const wantX = backOff ? -Math.sign(dx) : away > want ? Math.sign(dx) : 0

  /**
   * ⚠️ DEPTH IS CLOSED FIRST, EXCEPT WHEN IT IS RUNNING AT YOU. A swing reaches sideways, so
   * standing on the wrong line is the one position from which nothing it does can possibly land —
   * which is why the ordinary walk lines up before it closes. A charge is the deliberate exception:
   * it comes straight at you on the diagonal, which is what makes it something to step out of.
   */
  const deep = bossFoot(b).y
  const wantY = charging ? Math.sign(dy) : Math.abs(dy) > deep * 1.3 ? Math.sign(dy) : 0

  const lined = Math.abs(dy) < deep * 2.2
  const inRange = away < step * 1.05 && lined

  /**
   * WHICH of its six, not which of its two.
   *
   * ⚠️ A BOSS USED TO THROW TWO MOVES AND ONLY TWO. It picked between quick-neutral and
   * heavy-down and nothing else, so four of the six things a creature was drawn with could never
   * appear on a boss at all. Measured over ninety seconds against a creature with a horn, wings, a
   * tail, an arm and legs: slot 0 six times, slot 5 thirty-five times, and its gore, its buffet,
   * its launcher and its sweep exactly never. Somebody drew a horn and their boss would not use it.
   *
   * ⚠️ THE DISTANCE PICKS THE ROLE AND THE DRAWING FILLS IT, which is why this is three lines
   * rather than a table of moves per creature. moveTable already sorted the six by character — up
   * is whatever launches hardest, down is whatever reaches furthest, neutral-heavy is the hardest
   * hitter — so asking for a role asks for whatever THAT creature has that is best at it. A boss
   * with a tail reaches with the tail; one with wings launches with the wings; neither needed a
   * line of code about tails or wings.
   */
  const gap = away / Math.max(1e-6, step)
  const aim: 'up' | 'down' | 'neutral' = gap > 0.72 ? 'down' : gap < 0.42 ? 'up' : 'neutral'
  /* ⚠️ its beat is its drawing: this was a fixed tick, the same rhythm for every creature */
  const swings = inRange && beat % 2 === 0
  const big = goesBig(beat, t)

  return {
    steer: {
      left: charging ? dx < 0 : wantX < 0,
      right: charging ? dx > 0 : wantX > 0,
      up: wantY < 0,
      down: wantY > 0,
    },
    hit: {
      quick: swings && !big,
      heavy: swings && big,
      /* the same two keys a person holds to aim — see slotFor */
      up: swings && aim === 'up',
      down: swings && aim === 'down',
    },
    speed: t.pace * (charging ? 1.5 : 1),
  }
}

/**
 * Somewhere to stand when you are joining a fight that is already going on.
 *
 * ⚠️ BECAUSE THE PARK IS NINE SCREENS AND A BOSS IS IN ONE OF THEM. A shared boss that you
 * have to find is a shared boss you mostly miss — by the time you have walked three screens the
 * fight is over, which is the difference between "we fought that together" and "you told me about
 * it". So joining is a button, and the button puts you at arm's length from the thing.
 *
 * ⚠️ AT THE EDGE OF ITS REACH, NOT ON TOP OF IT. Landing inside a boss's swing would mean
 * being hit for pressing join, so this is just outside what its quick attack covers — close
 * enough to be in the fight, far enough that the first move is yours.
 */
export function ringSpot(b: Spot, n: number, reach = 1, scale = BOSS.scale): Spot {
  /* ⚠️ ITS OWN REACH, NOT A GUESS AT ONE. How far a boss can hit is read out of its drawing
     like everything else about it, and it varies by nearly half between creatures — a fixed
     distance put the joiner INSIDE the swing of a long-armed one, measured at 0.082 against a
     reach of 0.098. The quarter-height on top is the step you get to take before it does.

     ⚠️ AND ITS OWN SIZE, for the same reason: reach is multiplied by scale everywhere it is
     used, and bosses no longer all stand the same height. */
  const out = across((reach + 0.25) * PARK_TALL * scale)
  const side = n % 2 === 0 ? -1 : 1
  /* everybody after the first two stands a little further back, so a crowd is a crowd rather
     than four creatures in the same square foot */
  const back = Math.floor(n / 2) * out * 0.45
  const clamp = (v: number) => Math.max(0.02, Math.min(0.98, v))
  return { x: clamp(b.x + side * (out + back)), y: clamp(b.y + (n % 4 < 2 ? 0.012 : -0.012)) }
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
