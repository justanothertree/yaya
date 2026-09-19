import type { Drawing } from '../draw/strokes'
import type { CastKind } from './cast'
import { bossPace, movesOf, petWide, type Attack } from '../pets/attack'
import { restingWalker, type Spot } from './walk'
import { footOf, outBy, PARK_TALL, restingStriker, type StrikeInput, type Striker } from './strike'
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
  /** seconds left of pivoting to face the other way, 0 when it is settled — see stepTurn */
  turn: number
  /**
   * The big thing it is in the middle of doing, and how long it has been doing it.
   *
   * ⚠️ A CAST IS NOT A SWING, and keeping them separate is what stops the six slots becoming
   * a grab bag. A swing comes off a part somebody drew and is answered by not being in front of
   * it; a cast covers ground the boss cannot reach with its body and is answered by leaving
   * somewhere. They commit differently and they are read differently, so they are two things.
   */
  cast: { kind: CastKind; t: number } | null
}

/**
 * How long a boss takes to come about.
 *
 * ⚠️ SO THAT GETTING BEHIND IT BUYS TIME AND NOT JUST POSITION. Facing snapped the instant
 * the boss was not mid-swing, so slipping to its far side was answered before you arrived — you
 * could be beside it and it was already looking at you. Asked for as wanting to bait on one axis,
 * dodge, and come back in from another angle: the angle only means something if turning costs it
 * something.
 *
 * ⚠️ 0.45s AGAINST A 0.32s WIND-UP, so a turn is worth more than a swing is. That is what
 * makes going round it the better answer than backing straight off, which is the whole of the
 * movement game this is trying to have.
 */
export const TURN_TIME = 0.45

/**
 * ⚠️ A DEADBAND, or standing level with a boss makes it pirouette. Crossing its centre by a
 * pixel is not a decision anybody made, and a creature that spins on the spot while you shuffle
 * is a creature that looks broken rather than one that is being outmanoeuvred.
 */
const TURN_EDGE = 0.012

/**
 * One step of a boss changing which way it looks.
 *
 * ⚠️ PURE, and out here rather than in the room, for the reason everything else in this
 * module is: the park runs on requestAnimationFrame, which does not fire in the pane this is
 * checked in. Called directly it answers "how long is the window if I get behind it".
 */
export function stepTurn(
  b: { x: number; facing: number; turn: number },
  targetX: number,
  committed: boolean,
  dt: number,
): { facing: number; turn: number; turning: boolean } {
  const t = Math.max(0, Math.min(0.05, dt))
  if (b.turn > 0) {
    const left = Math.max(0, b.turn - t)
    return left > 0
      ? { facing: b.facing, turn: left, turning: true }
      : { facing: -b.facing, turn: 0, turning: false }
  }
  /* mid-swing it is already committed to the way it is looking — see the facing lock in the room */
  if (committed) return { facing: b.facing, turn: 0, turning: false }
  const want = targetX < b.x - TURN_EDGE ? -1 : targetX > b.x + TURN_EDGE ? 1 : b.facing
  if (want === b.facing) return { facing: b.facing, turn: 0, turning: false }
  return { facing: b.facing, turn: TURN_TIME, turning: true }
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
    turn: 0,
    cast: null,
    facing: -1,
  }
}

/* ⚠️ ponderous, and temperOf reads the same list — see bossPace */
export const bossMoves = (art: Drawing): Attack[] => movesOf(art).map(bossPace)
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
  /** a big committed thing to start this frame, or null — see castWanted */
  cast: CastKind | null
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
  /* ⚠️ outBy, not a hand-written across() — this was `(long * PARK_TALL * scale) / (16/10)`
     then multiplied by VIEW.w, which is the same sum spelled out and the same place the factor
     goes missing. See outBy. */
  const step = outBy(long * b.scale)

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

  /**
   * ⚠️ A CAST IS THE ANSWER TO STANDING OFF. Every swing this boss has is answered by being
   * somewhere else, so a player who learns the reach can simply live outside it — and a boss you
   * can out-space forever is a boss with nothing to say past the first minute. These reach where
   * it cannot, and the kind follows the distance: something to run out of when you are on top of
   * it, something thrown ahead when you are not, and a rolling line when you are a long way off.
   *
   * ⚠️ ON ITS OWN BEATS, AND NOT MANY. One in seven, and never while it is already swinging,
   * so a cast stays the thing you notice rather than the thing you are always in.
   *
   * ⚠️ SEVEN, UP FROM FOUR, BECAUSE TWO OF THE THREE NEVER USED TO LAND. A mark and a wave
   * were both placed with a conversion that put them off the edge of the world, so the numbers
   * here were set while only the bloom could touch anybody. With all three connecting, one in
   * four took a player from 84% to nothing in about ten seconds. The rate is where that is paid
   * for rather than the damage, because a cast that does not hurt is not worth dodging.
   */
  /**
   * ⚠️ ROTATED, NOT CHOSEN BY DISTANCE ALONE, because distance barely varies. A boss holds
   * station at its own reach — `want` above — so `gap` lives between about 0.5 and 1.0 and never
   * goes near the thresholds a purely spatial rule needs. Watched it: banding the three by range
   * meant the wave could not fire at all, because the boss simply never let anybody get that far
   * away. Each cast takes the next kind in turn, so all three are things you will actually meet.
   *
   * ⚠️ WITH TWO OVERRIDES AT THE ENDS, so the choice still reads as a reaction rather than a
   * cycle: standing on top of it gets the one that grows out from under you, and being a long
   * way off gets the one thrown ahead.
   */
  /**
   * ⚠️ ONE IN FOUR ONCE IT IS CORNERED, up from one in seven. Seven was set so a cast stays
   * the thing you notice rather than the thing you are always in — that is still right for most
   * of a fight, and stops being right for the end of one. The last third is where a boss should
   * be spending everything it has.
   */
  const low = cornered(b.lifeMax > 0 ? b.life / b.lifeMax : 1)
  const every = low ? 4 : 7
  const turn = Math.floor(beat / every) % 3
  const cast: CastKind | null =
    b.cast || b.swing > 0 || beat % every !== 1
      ? null
      : gap < 0.5
        ? t.casts.find((k) => k === 'bloom') || t.casts[0]
        : gap > 2
          ? t.casts.find((k) => k === 'mark') || t.casts[0]
          : /* ⚠️ ITS OWN ORDER, so the one it reaches for first is the one its drawing asked
               for — see Temper.casts. The rotation still visits all three, which is what stops a
               boss being one trick. */
            t.casts[turn]

  return {
    cast,
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
  const out = outBy((reach + 0.25) * scale)
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

/**
 * How little is left before a boss stops pacing itself.
 *
 * ⚠️ A FIGHT WITH NO SHAPE IS A FIGHT WITH NO END IN SIGHT. A boss behaved identically at five
 * per cent as at a hundred, so a long fight was the same fifteen seconds repeated until the bar
 * ran out — nothing told you it was nearly over and nothing made the last bit worth the first.
 *
 * ⚠️ AND THE THING THAT CHANGES IS HOW OFTEN IT COMMITS, NOT HOW FAST IT REACTS. "The attacks
 * are still slightly too fast" was said out loud about this fight, so the one lever deliberately
 * NOT pulled here is speed: the wind-ups, the turn and the beat stay exactly as they are. What
 * goes up is how often the big telegraphed things come, which raises the threat by giving you
 * MORE to read rather than less time to read it.
 *
 * ⚠️ ONE LEVER, ALSO BECAUSE OF WHERE IT IS DECIDED. The cast rate is chosen by the machine
 * running the boss and broadcast as a slot, so a rate change cannot desync. Anything that
 * altered the SHAPE of a cast would have to be re-derived identically by every viewer, and a
 * second copy of this rule living on the other side of the wire is a second copy to get wrong.
 */
export const LAST_STAND = 0.35

/** Is this boss on its last legs? Takes the fraction, so a viewer can ask it of an echo too. */
export const cornered = (left: number): boolean => left > 0 && left <= LAST_STAND
