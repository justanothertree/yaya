import { PET_TALL } from '../pets/play'
import { driveAt, hurtHalf, slotFor, type Aim, type Attack } from '../pets/attack'
import type { Box } from '../pets/rig'
import { holdInPark, SQUASH, VIEW, type Spot, type Steer, type Walker } from './walk'

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
  /**
   * Which way the swing being thrown is pointed, as a unit vector in screen-heights.
   *
   * ⚠️ FIXED WHEN THE SWING STARTS, never after. It is the aim you committed to, so turning
   * or walking mid-swing cannot drag the hitbox round after somebody — the same promise the
   * frozen position and the locked facing already make, extended to the one axis that was still
   * free because there was only ever one.
   */
  aim: Aimed
  /** seconds left of a dodge, 0 when not rolling — see stepDodge */
  dodge: number
  /** seconds before another may be thrown, so it is an answer and not a way of walking */
  dodgeRest: number
  /**
   * How high off the FIELD it is, in pet-heights — not off whatever it is standing on.
   *
   * ⚠️ AN ALTITUDE, NOT A TIMER, AND THE ARC DID NOT CHANGE. This was seconds-left of a fixed
   * parabola, which cannot answer "am I above that ledge yet" — the question every plane in
   * ground.ts asks. It is a position and a speed now, under a constant gravity chosen to
   * reproduce the old curve exactly: a jump still peaks at HOP.up and still takes HOP.time,
   * because for a parabola those two numbers ARE a gravity and a launch speed. See LEAP.
   */
  up: number
  /** how fast it is rising, pet-heights a second; negative is falling */
  vz: number
  /** how high the ground is under it — 0 on the grass, see ground.ts */
  ground: number
  /** seconds before another jump, so it is an answer rather than a way of getting about */
  hopRest: number
  /**
   * How slowly it can let itself down, 1 being not at all and 0.34 being a pair of wings. The
   * same traitsOf number the platformer glides on.
   */
  glide: number
  /** seconds of float left in this jump, spent by holding the key on the way down */
  float: number
  /**
   * How high this one jumps, 1 being the plain arc — wings buy more. From traitsOf, the same
   * function the platformer has used since the pets room existed.
   *
   * ⚠️ IT LIVES ON THE STRIKER BECAUSE overHead ASKS IT. Clearing a low attack is a question
   * about height, so a creature that jumps higher is safe sooner and for longer, and if that
   * fact lived anywhere but here the two would drift — the one-door rule the rest of this file
   * follows. Defaults to 1, so a boss or a peer we know nothing about behaves exactly as before.
   */
  jump: number
  /** 1 for a whole guard, 0 for a broken one — see stepGuard */
  guard: number
  /** seconds this guard has been up, which is what makes a parry a parry — see GUARD.parry */
  braceFor: number
  /** seconds left of a parry landing, for the room to punish with and the arc to flash */
  parried: number
  /** true while the guard is actually up */
  braced: boolean
  /** seconds left of the flash a met blow leaves, so the room has an edge to draw */
  guardLit: number
}

export type StrikeInput = { quick: boolean; heavy: boolean; up: boolean; down: boolean }

export const restingStriker = (w: Walker, jump = 1, glide = 1): Striker => ({
  ...w,
  jump,
  glide,
  float: 0,
  swing: 0,
  move: 0,
  spent: false,
  rest: 0,
  stun: 0,
  hold: 0,
  hurt: 0,
  heldQ: false,
  heldH: false,
  aim: { x: 1, y: 0 },
  dodge: 0,
  dodgeRest: 0,
  up: 0,
  vz: 0,
  ground: 0,
  hopRest: 0,
  guard: 1,
  braceFor: 0,
  parried: 0,
  braced: false,
  guardLit: 0,
})

/**
 * How long a dodge lasts, how far it goes, and how long before another.
 *
 * ⚠️ LONGER THAN THE THING IT ANSWERS IS NOT THE POINT — SHORTER IS. A boss's dangerous
 * window is 111 to 456ms; a dodge that outlasted it would be an off switch. 0.26s of
 * invulnerability inside a 400ms telegraph means the dodge has to be TIMED, which is the whole
 * reason to have one rather than just walking.
 *
 * ⚠️ AND IT COVERS MORE GROUND THAN THE DEPTH OF A SWING, or it would move you within the
 * thing you were trying to leave. 1.3 pet-heights against a cap of 0.28 of the field.
 */
export const DODGE = { time: 0.26, rest: 0.55, reach: 1.3 }

/**
 * One step of rolling out of the way.
 *
 * ⚠️ PURE, and the only place a dodge exists, so "how long am I safe for" is a question that
 * can be asked without a browser — the park's animation frame does not fire in the pane this is
 * checked in.
 *
 * ⚠️ IT DOES NOT TOUCH VELOCITY, for the same reason `driven` does not: a displacement stops
 * when the dodge does, where a velocity would leave you skating out of it. The distance is eased
 * so it leaves quickly and settles, which is what makes it read as a roll rather than a teleport.
 */
export function stepDodge(
  s: Striker,
  want: boolean,
  aim: Aimed,
  dt: number,
): { s: Striker; went: boolean } {
  const t = Math.max(0, Math.min(0.05, dt))
  if (s.dodge > 0) {
    const left = Math.max(0, s.dodge - t)
    /* eased: most of the ground is covered early, so it snaps out and settles */
    const gone = 1 - left / DODGE.time
    const was = 1 - s.dodge / DODGE.time
    const ease = (v: number) => 1 - Math.pow(1 - v, 2)
    /* ⚠️ PET-HEIGHTS INTO SCREEN-HEIGHTS BEFORE across(), which is what PARK_TALL is for.
       Without it the roll came out 8.12 pet-heights instead of 1.3 — five and a half times too
       far, a dodge that crossed most of the field. `driven` already does this correctly; this
       is the same sum written a second time and got wrong, which is its own argument. */
    const step = (ease(gone) - ease(was)) * DODGE.reach
    const to = stepFrom(s, s.aim, step)
    const { x, y } = holdInPark(to.x, to.y)
    return {
      s: { ...s, x, y, dodge: left, dodgeRest: left > 0 ? s.dodgeRest : DODGE.rest },
      went: false,
    }
  }
  const rest = Math.max(0, s.dodgeRest - t)
  /* ⚠️ not while committed to a swing: a dodge that cancelled a recovery would make every
     attack safe, which is the one thing the whole fight is built on not being */
  if (!want || rest > 0 || s.swing > 0 || s.stun > 0 || s.hold > 0)
    return { s: { ...s, dodgeRest: rest }, went: false }
  return { s: { ...s, dodge: DODGE.time, aim, dodgeRest: 0 }, went: true }
}

/**
 * Can this creature be hurt right now?
 *
 * ⚠️ ONE DOOR, because there are five places that ask and they must agree. Being knocked
 * about already granted a moment of safety — that is what makes a knockdown survivable rather
 * than a loop — and a dodge is the same promise, bought on purpose instead of paid for in
 * damage. Adding the second condition at four of the five call sites is exactly the bug this
 * module has shipped twice.
 */
export const canBeHurt = (s: Striker): boolean => s.stun <= 0 && s.dodge <= 0

/**
 * How much standing your ground is worth, and what it costs.
 *
 * ⚠️ THE SECOND HALF OF A PAIR, and it only means anything because the first half exists. A
 * dodge answers a blow by not being there: it is free if you time it and useless if you do not.
 * A guard answers the same blow by being there on purpose: it always works and it always costs,
 * which makes it the option you take when you could not read the attack. Having only the timed
 * one meant every mistake was the same mistake.
 *
 * ⚠️ IT DOES NOT STOP A BLOW, IT SOFTENS ONE. A quarter still gets through, so holding it
 * through a fight loses the fight slowly — and the pool drains on its own while it is up, so
 * holding it through a fight also loses the guard. Both of those are on purpose: a defence with
 * no clock is a defence with no decision in it.
 *
 * ⚠️ AND IT FACES ONE WAY. Everything else here became omnidirectional — the aim, the swings,
 * the casts, the boss's turn — and a guard that covered all of it would be the one thing in the
 * fight that does not care where you are standing. It covers everything but a wedge behind you,
 * which is what makes circling a boss while braced a thing you can get wrong.
 */
/**
 * Leaving the ground, in a game with no ground to leave.
 *
 * ⚠️ THE THIRD ANSWER, AND IT HAD TO BE A DIFFERENT SHAPE FROM THE OTHER TWO. A dodge is
 * timed and beats anything; a guard is untimed and beats everything a bit. Both of those are
 * about WHEN. A jump is about WHAT: it beats the things that travel along the floor and nothing
 * else, so the fissure you jump is the one attack the roll and the stance are worst against.
 *
 * ⚠️ AND WHAT COUNTS AS LOW IS ALREADY IN THE DRAWING. Attack.lift is how high above the
 * creature's middle the ink was drawn — that is what makes a hit the up-attack rather than the
 * down-attack, and it is the same question "can I get over this" is asking. Nothing new is
 * classified, nobody has to tag a move, and a creature whose every hit is drawn overhead is
 * simply one you cannot jump. Where you drew it is the move, one rule further on.
 *
 * ⚠️ YOU CAN WALK IN THE AIR AND YOU CANNOT FIGHT. Keeping the walk is the whole point —
 * jumping a wave while crossing it is the move — and taking the swing away is what stops this
 * being a free half-second added to every approach.
 */
export const HOP = {
  /** how high the picture rises, in pet-heights */
  up: 0.62,
  /** how long the whole jump takes */
  time: 0.5,
  /** and how long before another */
  rest: 0.5,
  /**
   * ⚠️ CLEAR OF THE FLOOR ONCE THIS HIGH, and the height is the rule rather than a window
   * beside it. A separate "safe from 0.12s to 0.38s" is a second copy of the arc that can drift
   * from the one being drawn, and then the creature is visibly in the air and taking a hit. At
   * 0.26 of 0.62 the safe part is 0.376s of a 0.5s jump, which has to be aimed at something.
   */
  clear: 0.26,
  /**
   * ⚠️ AN ATTACK THIS LOW OR LOWER PASSES UNDERNEATH, and the number is placed inside the
   * spread that actually occurs rather than the one the formula could produce. Across 36 real
   * moves off three drawings, lift runs 0.20 to 0.76 with its middle at 0.38 — against the
   * theoretical 0.1–0.85 a "low third" would have been 0.35 and caught nothing much; measured,
   * 0.35 is the low third. This is the third dial in this module to be set this way after two
   * were found pinned against their own floor.
   */
  under: 0.35,
  /**
   * Most seconds a pair of wings can stretch a descent.
   *
   * ⚠️ IT DOES NOT CURRENTLY BIND, AND IT IS STILL RIGHT TO HAVE. traitsOf gives 0.34 for any
   * number of wings, and a descent at 0.34 takes 0.735s against this 0.85 — so the arc runs
   * out before the budget does and about 0.11s goes unspent every jump. The cap is here for
   * the day some part glides harder than a wing: a rate with no budget is not traversal, it is
   * immunity to every low swing for as long as a key is held, and finding that out later would
   * mean finding it out in somebody's fight.
   *
   * ⚠️ MEASURED, what wings actually buy: 0.99s in the air against a plain jump's 0.50, and
   * 0.81s above `clear` against 0.38 — so a bit over twice as long out of reach of anything
   * drawn low, in exchange for being unable to attack, guard or roll for all of it. The roll
   * is still the better answer to one blow; this is for crossing ground and for the second.
   */
  glide: 0.85,
  /**
   * How fast a wing lets it down, pet-heights a second, against a free fall that reaches 4.96.
   *
   * ⚠️ SET FROM THE MEASUREMENT RATHER THAN CHOSEN. Before altitude was a position this was a
   * factor on the clock, and it produced 0.99s in the air against a plain jump's 0.50. A
   * terminal speed is the honest shape of the same thing — a wing finds air, it does not
   * weaken gravity — so this is the number that reproduces that airtime.
   */
  sink: 0.95,
}

/**
 * How high off the ground, in pet-heights.
 *
 * ⚠️ A PARABOLA RATHER THAN A PHYSICS. play.ts has real gravity because the platformer is
 * about falling; here nothing falls, there is no floor to land on and no ledge to miss, so an
 * arc that starts and ends at nought is the whole of the behaviour. Same argument walk.ts makes
 * for not sharing stepBody.
 */
/**
 * How far through the arc, 0 on the ground and 1 at the top — the shape without the size.
 *
 * ⚠️ THIS IS WHAT GOES ON THE WIRE, not the height. A height would be measured against the
 * sender's own jump, so a winged creature's peak would clamp against a constant built for a
 * plain one and arrive looking like a normal hop. A fraction means the same thing for every
 * creature, and the other end already has the drawing to work out how tall that fraction is —
 * the rule Someone's `move` note states: send one small number, derive the meaning both sides.
 */
/**
 * ⚠️ THE ARC IS A GRAVITY AND A LAUNCH SPEED, which is why swapping the timer for a position
 * cost nothing. A projectile's airtime is 2v/g and its peak is v²/2g; solve those for HOP.up
 * and HOP.time and you get exactly one answer. So a plain jump still rises 0.62 pet-heights
 * and still takes half a second — the same curve, now expressed as something that can be asked
 * where it is rather than how long it has left.
 */
export const LEAP = (4 * HOP.up) / HOP.time
export const GRAV = (2 * LEAP) / HOP.time

/**
 * How far through its own jump something is, 0 on its feet and 1 at the top of its arc.
 *
 * ⚠️ STILL WHAT GOES ON THE WIRE, and still for the reason it always was: a height is measured
 * against the sender's own jump, and a fraction means the same for every creature. The far end
 * adds the ground under them itself — it knows where they are standing and ground.ts is not a
 * secret — so a peer on the rocks is drawn on the rocks without a byte being spent saying so.
 */
export const airFrac = (s: Striker): number => {
  const over = s.up - s.ground
  if (over <= 0) return 0
  return Math.max(0, Math.min(1, over / (HOP.up * s.jump)))
}

/** Off the ground at all — the one question the room asks before letting you start something. */
export const aloft = (s: Striker): boolean => s.up > s.ground + 1e-6 || s.vz > 0

/**
 * Did this one go under you?
 *
 * ⚠️ ASKED BY shoved AND BY mauled, the same two doors the guard uses, so a blow cannot pass
 * under your feet and shove you anyway.
 */
/**
 * Is this attack passing somewhere other than where the target is?
 *
 * ⚠️ MEASURED AGAINST THE ATTACKER'S FEET, NOT THE TARGET'S OWN GROUND. Height was a question
 * with one side to it while everything stood on the grass: your own height was the only thing
 * a swing could miss over. Now the rocks are somewhere to stand and the boss climbs them too,
 * so what decides a miss is the DIFFERENCE, and it works both ways — a boss swinging from the
 * trees passes over your head exactly as your jump passes over its sweep.
 *
 * ⚠️ AND THE OLD RULE IS THE FIRST LINE, UNCHANGED. Everything on the grass makes `fromUp` 0
 * and `rise` your own height, so a fight between two things on the same ground is bit for bit
 * the fight that was tuned. The two new lines only fire when something is genuinely elsewhere.
 *
 * ⚠️ A STEP IS NOT AN ESCAPE, and the numbers say so rather than a rule saying it: the tallest
 * lift is 0.85 and a body is 1, so nothing you can climb onto — the highest is 0.72 — lifts
 * you clear of a swing from below on its own. It takes a leap, or a boss that has leapt. A
 * plateau you could stand on to be safe would be a camping spot rather than a place.
 */
/** A creature is one pet-height tall, which is what makes a height difference a miss. */
export const BODY = 1

export const overHead = (s: Striker, a: Attack, fromUp = 0): boolean => {
  const rise = s.up - fromUp
  /* ducked under, or jumped over, a thing that swings low — the original rule, unchanged */
  if (rise >= HOP.clear && a.lift <= HOP.under) return true
  /* clean above the whole swing, which takes a real height difference */
  if (rise >= a.lift + BODY) return true
  /* and it is swinging over your head from somewhere far enough up */
  return rise <= -BODY
}

/**
 * One step of being in the air.
 *
 * ⚠️ PURE, like everything else here: the arc, the safe window and the reach of a jump all
 * have to be answerable without a browser, because the park's animation frame does not fire in
 * the pane any of it is checked in.
 *
 * ⚠️ NOT OUT OF A ROLL, A STANCE OR A SWING. Each of the three answers costs you the other
 * two while it runs, or the right play is always to press all of them.
 */
/**
 * One step of being off the ground: a jump, a fall off a ledge, and a glide are one thing.
 *
 * ⚠️ THEY WERE NEVER THREE DIFFERENT EVENTS, they just looked like it while altitude was a
 * countdown. Rising is a positive vz, falling off the rocks is a vz of zero over ground that
 * has dropped away, and a glide is a cap on how fast either of them comes down. One integrator
 * answers all three, which is why adding ledges added no second way to be in the air.
 *
 * @param want true on the frame the key goes DOWN — a jump is an edge, not a state
 * @param held true for as long as it is down, which is what a glide is asked with
 * @param floor how high the ground is where it is standing — see groundAt
 */
export function stepAir(
  s: Striker,
  want: boolean,
  dt: number,
  held = want,
  floor = 0,
): { s: Striker; went: boolean } {
  const t = Math.max(0, Math.min(0.05, dt))

  /**
   * ⚠️ THE GROUND WENT AWAY, WHICH IS NOT A SEPARATE BRANCH. Walking off the rocks leaves a
   * creature above a floor that has dropped, which the airborne path below already handles
   * with vz at nought — a fall is the top of a jump without the jump. It gets a float budget
   * here because it did not get one on takeoff, and gliding down from somewhere is most of
   * what a wing is for; without this line a creature could glide off a jump and not off a
   * cliff, which is exactly backwards.
   */
  const steppedOff = s.vz === 0 && floor < s.ground - 1e-6 && s.up > floor + 1e-6
  const float = steppedOff && s.glide < 1 ? HOP.glide : s.float

  /* ⚠️ the same question aloft() asks, and it has to stay that way — on the frame a jump
     starts, up is still the floor and only vz says it has left. Two ideas of "in the air" is
     how something ends up able to cast on the first frame of a jump. */
  if (aloft({ ...s, ground: floor })) {
    /**
     * ⚠️ A CAP ON THE WAY DOWN, NOT A WEAKER GRAVITY. A glide is a wing finding air, which is
     * a terminal speed — and it only applies while falling, so the climb is untouched and
     * nobody hangs at the top. `float` is the budget; see HOP.glide for why a rate alone is
     * not an ability but a place to live.
     */
    const floating = held && s.vz < 0 && s.glide < 1 && float > 0
    /**
     * ⚠️ THE EXACT KINEMATIC STEP, NOT EULER. `up += vz * t` after updating vz undershoots the
     * top of the arc by an amount that depends on the frame length — 0.610 against 0.620 at
     * 240 a second, worse at 60 — which would make how high you jump depend on how fast the
     * machine is drawing, and `clear` is a height. Constant acceleration has a closed form and
     * it costs one extra term.
     */
    const vz = floating ? Math.max(s.vz - GRAV * t, -HOP.sink) : s.vz - GRAV * t
    const up = floating ? s.up + vz * t : s.up + s.vz * t - 0.5 * GRAV * t * t

    /* ⚠️ landed on whatever is under it NOW, which is how a jump onto the rocks becomes
       standing on the rocks without anything anywhere saying the word "rocks". */
    if (vz <= 0 && up <= floor) {
      return {
        s: { ...s, up: floor, vz: 0, ground: floor, float: 0, hopRest: HOP.rest },
        went: false,
      }
    }
    return {
      s: { ...s, up, vz, ground: floor, float: Math.max(0, float - (floating ? t : 0)) },
      went: false,
    }
  }

  const rest = Math.max(0, s.hopRest - t)
  const stuck = rest > 0 || s.swing > 0 || s.stun > 0 || s.hold > 0 || s.dodge > 0 || s.braced
  if (!want || stuck) return { s: { ...s, up: floor, ground: floor, hopRest: rest }, went: false }
  /* a fresh budget every jump, and none at all for a creature with nothing to glide on */
  return {
    s: {
      ...s,
      up: floor,
      ground: floor,
      /**
       * ⚠️ THE SQUARE ROOT IS NOT A FLOURISH. A peak is v²/2g, so scaling the launch speed by
       * the jump trait scales the HEIGHT by its square — a 1.26 creature would have gone 1.59
       * times as high, which is not what the trait says and not what shipped. traitsOf means
       * "26% higher", so the launch speed goes up by the root of it and the height by it.
       */
      vz: LEAP * Math.sqrt(s.jump),
      hopRest: 0,
      float: s.glide < 1 ? HOP.glide : 0,
    },
    went: true,
  }
}

export const GUARD = {
  /** seconds it can be held up with nothing landing on it */
  hold: 3.2,
  /** seconds an untouched guard takes to come back from nothing */
  mend: 5,
  /**
   * ⚠️ YOU CANNOT RAISE ONE BELOW THIS, or a break is not a gap. Without it the answer to
   * being broken is to tap the key again and get a sliver of guard back on the next frame,
   * which turns the one real punishment here into a stutter.
   */
  least: 0.22,
  /** the fraction of a met blow that gets through anyway */
  soak: 0.25,
  /** guard spent per point of damage stopped */
  cost: 0.018,
  /** what is left of a met blow's shove */
  slide: 0.4,
  /** seconds of being wide open after it breaks */
  broken: 1.2,
  /** the cosine of the half-angle it covers: everything but a 160° wedge behind you */
  arc: Math.cos((100 * Math.PI) / 180),
  /**
   * ⚠️ THE FOURTH ANSWER, AND IT WAS ASKED FOR BY NAME. "in a fihgting system i like counter
   * play, so if every move can be avoided with an i frame or A COUNTER or you have time to run
   * away or jump" — the i-frame is the roll, running away is the walk, the jump is the jump,
   * and the counter was the one of the four that never got built.
   *
   * ⚠️ IT IS THE SAME KEY, NOT A NEW ONE. A guard raised in the last moment before a blow
   * lands takes nothing at all and opens the thing that threw it; raised any earlier it is
   * simply the guard it always was. That is the whole mechanic — one button whose value is
   * decided entirely by WHEN, on top of one whose value was decided by WHERE. Nothing new to
   * learn, and the thing you were already practising against the sparring dummy is the thing
   * that earns it.
   *
   * ⚠️ AND FISHING FOR IT COSTS. A guard thrown up early is up: you cannot walk, swing or cast
   * while it is, and it drains whether anything hits it or not. Missing the window is not free,
   * which is what stops the answer to everything being "mash Q".
   *
   * 0.16s against a boss's 400ms wind-up — tighter than the roll's 0.26s, because it refuses
   * the blow completely rather than merely surviving it.
   */
  parry: 0.16,
}

/** seconds a landed parry stays visible, and stays readable by the room */
const PARRY_SHOW = 0.3

/**
 * Is this blow arriving where the guard is pointing?
 *
 * ⚠️ IN SCREEN-HEIGHTS, like every other angle in this file, because the field is 16:10 and a
 * direction measured in world units is not the direction it looks like. See toScreen.
 *
 * ⚠️ EXPORTED AND ASKED BY shoved, so the shove and the damage can never disagree about
 * whether something was met — they are two halves of one blow.
 */
/**
 * Was this blow met at the very moment the guard came up?
 *
 * ⚠️ BUILT ON guarded RATHER THAN BESIDE IT, so a parry can never cover an angle a guard does
 * not. The facing rule is the guard's and the timing rule is this one, and a counter has to
 * satisfy both.
 */
export const parries = (s: Striker, from: Spot): boolean =>
  guarded(s, from) && s.braceFor <= GUARD.parry

export const guarded = (s: Striker, from: Spot): boolean => {
  if (!s.braced || s.guard <= 0) return false
  const { sx, sy } = toScreen(s.x - from.x, s.y - from.y)
  const d = Math.hypot(sx, sy)
  /* on top of you is met: there is no direction to have got wrong */
  if (d < 1e-6) return true
  /* the way you would have to look to see it coming, against the way you are looking */
  return (-sx / d) * s.aim.x + (-sy / d) * s.aim.y >= GUARD.arc
}

/**
 * One step of holding the line.
 *
 * ⚠️ PURE, for the reason everything else in this file is: the park's animation frame does not
 * fire in the pane this is checked in, so "how many of this boss's hits does a full guard stop"
 * has to be a question something can be asked directly.
 *
 * ⚠️ IT DOES NOT TOUCH VELOCITY. The room hands stepWalker STILL while you are braced, so you
 * decelerate into the stance rather than stopping dead — and a blow that gets through still
 * slides you, because shoved set a velocity and nothing here takes it away.
 *
 * ⚠️ AND A BLOCKED BLOW MUST NOT DROP THE GUARD, which is why hold is not in the test below
 * while stun is. The contact freeze is both creatures' and lasts a twentieth of a second; being
 * staggered is the thing that means you lost the exchange.
 *
 * @param aim where the guard should point, or null to keep the one it has
 */
export function stepGuard(s: Striker, want: boolean, aim: Aimed | null, dt: number): Striker {
  const t = Math.max(0, Math.min(0.05, dt))
  const guardLit = Math.max(0, s.guardLit - t)
  const open = s.stun <= 0 && s.dodge <= 0
  const up = s.braced
    ? want && open && s.guard > 0
    : want && open && s.swing <= 0 && s.guard >= GUARD.least
  const parried = Math.max(0, s.parried - t)
  if (!up)
    return {
      ...s,
      braced: false,
      guardLit,
      parried,
      braceFor: 0,
      guard: Math.min(1, s.guard + t / GUARD.mend),
    }
  return {
    ...s,
    braced: true,
    guardLit,
    parried,
    /* ⚠️ counted from the frame it went up, which is the only clock a parry can be judged on */
    braceFor: s.braced ? s.braceFor + t : 0,
    guard: Math.max(0, s.guard - t / GUARD.hold),
    aim: aim ?? s.aim,
  }
}

/**
 * Which way the keys are pointing, as a unit vector in screen-heights.
 *
 * ⚠️ NO CONVERSION, because a steer is ALREADY a screen intention — somebody holding
 * down-and-right means down-and-right on the screen in front of them, not in world units that
 * the field's shape would then bend. Converting it would be the aspect trap in reverse.
 */
export function aimFromKeys(steer: Steer, fallback: Aimed): Aimed {
  const dx = (steer.right ? 1 : 0) - (steer.left ? 1 : 0)
  const dy = (steer.down ? 1 : 0) - (steer.up ? 1 : 0)
  if (!dx && !dy) return fallback
  const len = Math.hypot(dx, dy)
  return { x: dx / len, y: dy / len }
}

/**
 * Which way the pointer is, from wherever the creature is standing.
 *
 * ⚠️ PIXELS NEED NO CONVERSION, which is the whole reason this is three lines. An aim is a
 * unit vector in SCREEN-heights — see aimFromKeys, which does no conversion either — and
 * screen-heights are isotropic in pixels. A pixel delta off the field is therefore already in
 * the right space, and putting an `across`/`down` anywhere near it would bend the angle by the
 * field's 16:10 exactly as toScreen's note warns.
 *
 * ⚠️ AND IT REFUSES TO ANSWER WHEN THE POINTER IS ON YOU. Under a few pixels the direction is
 * noise, and an aim that flickers is worse than an aim that holds still — so the last one
 * stands, the same way aimFromKeys keeps the facing when nothing is held.
 */
export function aimFromPoint(dxPx: number, dyPx: number, fallback: Aimed): Aimed {
  const len = Math.hypot(dxPx, dyPx)
  if (len < 6) return fallback
  return { x: dxPx / len, y: dyPx / len }
}

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
 * The world, measured in the one unit that is the same in both directions.
 *
 * ⚠️ A DIAGONAL IS ONLY A DIAGONAL ON SCREEN. x is a fraction of the world's WIDTH and y of
 * its HEIGHT, and the field is 16:10 — so equal steps in x and y are not equal distances to look
 * at, and an attack pointed at (1,1) in world units comes out at 32 degrees rather than 45. Every
 * piece of geometry with an angle in it therefore happens in screen-heights and converts on the
 * way in and out. This is the same trap `across` and `down` exist for, one dimension further on.
 */
export const toScreen = (dx: number, dy: number) => ({
  sx: (dx / VIEW.w) * ASPECT,
  sy: dy / VIEW.h,
})

/** Eight ways, because a keyboard has eight and a drawing has two. */
export type Aimed = { x: number; y: number }

/**
 * Pet-heights straight into world units.
 *
 * ⚠️ THESE EXIST BECAUSE THE SAME MISTAKE HAPPENED THREE TIMES. `across` and `down` take
 * SCREEN-HEIGHTS, and almost nothing in this game is written in screen-heights — a reach, a
 * footprint, a dodge, a lunge and every cast are all in PET-heights, which is PARK_TALL of a
 * screen. So the correct call has always been `across(v * PARK_TALL)`, and leaving the factor
 * out silently multiplies a distance by five and a half.
 *
 * It cost: a dodge that crossed most of the field, and a boss's mark and wave landing past the
 * edge of the world so that two of its three big attacks could never hit anybody at all. Both
 * looked exactly like working code.
 *
 * ⚠️ AND THE UNIT IS NOW IN THE NAME, which is the actual fix. `across(x * PARK_TALL)` reads
 * as fine whether or not the PARK_TALL is there; `outBy(x)` has nowhere to put a wrong one.
 * `across` and `down` stay for the handful of places that genuinely hold screen-heights.
 */
export const outBy = (petHeights: number): number => across(petHeights * PARK_TALL)
export const downBy = (petHeights: number): number => down(petHeights * PARK_TALL)

/** A point that many pet-heights along an aim — the shape every cast and every dash needs. */
export const stepFrom = (from: Spot, aim: Aimed, petHeights: number): Spot => ({
  x: from.x + outBy(petHeights * aim.x),
  y: from.y + downBy(petHeights * aim.y),
})

/**
 * The nearest of the eight compass directions, as a unit vector in screen-heights.
 *
 * ⚠️ SNAPPED, NOT FREE. The creature itself can only face left or right — PetView mirrors,
 * it does not rotate — so a freely-aimed attack would point somewhere its owner visibly is not.
 * Eight is what the keys give you and what a player can mean on purpose; anything finer would be
 * a direction nobody chose and nobody could read.
 */
export function aimOf(dx: number, dy: number, fallback: Aimed = { x: 1, y: 0 }): Aimed {
  const { sx, sy } = toScreen(dx, dy)
  const len = Math.hypot(sx, sy)
  if (len < 1e-6) return fallback
  const a = Math.round(Math.atan2(sy, sx) / (Math.PI / 4)) * (Math.PI / 4)
  return { x: Math.cos(a), y: Math.sin(a) }
}

/**
 * An aim as one number, for the wire.
 *
 * ⚠️ AN OCTANT RATHER THAN TWO FLOATS, because the aim is snapped to eight anyway — sending
 * a vector would be sending precision that does not exist, twice a message, fifteen times a
 * second. It also clamps trivially at the relay, which matters: every field in a park message is
 * squared off there rather than trusted.
 *
 * ⚠️ AND IT HAS TO TRAVEL AT ALL. A remote creature's swing is re-derived on your machine
 * from what it sent; with only a facing, its diagonal attack would be diagonal on its own screen
 * and horizontal on yours — two machines disagreeing about what hit you, which is the one
 * disagreement a fight cannot survive.
 */
export const octantOf = (aim: Aimed): number => {
  const a = Math.atan2(aim.y, aim.x)
  return ((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8
}

export const aimFromOctant = (n: number): Aimed => {
  const a = (((Math.round(n) % 8) + 8) % 8) * (Math.PI / 4)
  return { x: Math.cos(a), y: Math.sin(a) }
}

/**
 * What a swing covers, as a patch pointed the way it was thrown.
 *
 * ⚠️ AN ORIENTED REGION RATHER THAN A BOX, which is the whole of what omnidirectional
 * fighting needs. An axis-aligned rectangle can point four ways at best and the park only ever
 * used two of them, so every fight was left-right in a world you can walk round in circles.
 *
 * ⚠️ STILL THE SAME reach AND depth, so nothing about balance moved: `reach` is how far
 * along the aim it goes and `half` is how wide across it is, both in screen-heights, and both
 * come from the same numbers the axis-aligned version used — including the dodge-room cap.
 */
export type Swipe = {
  /** where it comes from, in world units */
  from: Spot
  /** unit direction, in screen-heights */
  aim: Aimed
  /** along the aim, in screen-heights */
  reach: number
  /** either side of the aim, in screen-heights */
  half: number
  /** it comes out both ways along the aim, so facing does not matter */
  both: boolean
}

/**
 * How tall a creature stands here, as a fraction of the field's height.
 *
 * ⚠️ THE PICTURE READS THIS TOO, and it did not used to. The factor was written twice — here
 * and again in ParkRoom's petSize — under a comment saying a hitbox sized from a different
 * number than the picture is a hitbox nobody can see. Two copies of a number that must agree
 * is the same thing one step later, so petSize asks for this one now and the park has a single
 * zoom.
 *
 * ⚠️ 0.44, DOWN FROM 0.8 IN TWO STEPS. At 0.8 a creature stood 16% of the screen's height,
 * which is a long way zoomed in for a game you look down on — Evan, on why SUPERVIVE reads
 * better: "you are zoomed out a bit". 0.52 was better and still not enough ("it could be a bit
 * more zoomed out"), so 0.44: a creature stands 8.8% and a screen is 55 body-lengths across
 * where it started at 30.
 *
 * ⚠️ AND EVERY DISTANCE IN THE PARK FOLLOWS IT, which is what makes this a zoom rather than a
 * rebalance. Reach, footprint, dodge, lunge and every cast are in PET-heights and converted
 * through this, so the fight keeps exactly the shape it was tuned to and only gets smaller.
 * The walk is NOT in pet-heights — it is screenfuls a second — so TUNE.speed came down with
 * it, or the same creature would cross its own body a third again as fast as it used to.
 */
export const PARK_TALL = PET_TALL * 0.44

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
  y: downBy(FOOT.deep * scale) / 2,
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
  return areaOf(at, facing, a, scale)
}

/**
 * Where a swing is ABOUT to land, and how far through its wind-up it is.
 *
 * ⚠️ THE GAME HAS TO SAY WHAT THE DEBUG VIEW SAYS. Reported after playing it: "I would only
 * ever play with the hitboxes turned on because that's currently required to win." A debug
 * overlay being load-bearing is the clearest possible statement that the presentation is not
 * carrying the information the simulation has — the boss telegraphs for 320ms and nothing on
 * screen tells you what the telegraph is FOR, so the only readable thing was the red rectangle.
 *
 * ⚠️ THE SAME GEOMETRY, NOT A SECOND ONE. areaOf is shared with strikeArea, so the patch
 * that lights up is the patch that will hurt — by construction, the way the overlay is. A
 * telegraph that drew its own idea of the box would be the maker-preview bug all over again.
 *
 * ⚠️ NULL ONCE IT IS LIVE, because from that moment the real box takes over and two things
 * drawing the same patch is one thing too many.
 */
export function strikeTell(
  at: Spot,
  facing: number,
  a: Attack,
  gone: number,
  scale = 1,
): { box: Box; ready: number } | null {
  const f = gone / a.span
  if (f >= a.live[0] || a.live[0] <= 0) return null
  return { box: areaOf(at, facing, a, scale), ready: Math.max(0, Math.min(1, f / a.live[0])) }
}

/**
 * The patch a swing is hurting right now, pointed the way it was thrown.
 *
 * ⚠️ THE SAME live WINDOW AND THE SAME NUMBERS as the box it replaces — only the direction
 * is new. Reach along the aim, depth either side of it, the dodge-room cap still applying to the
 * depth because depth is still the axis you step out through.
 */
export function strikeSwipe(
  at: Spot,
  aim: Aimed,
  a: Attack,
  gone: number,
  scale = 1,
): Swipe | null {
  const f = gone / a.span
  if (f < a.live[0] || f > a.live[1]) return null
  return swipeOf(at, aim, a, scale)
}

/** Where a swing is ABOUT to land, and how far through its wind-up it is — see strikeTell. */
export function swipeTell(
  at: Spot,
  aim: Aimed,
  a: Attack,
  gone: number,
  scale = 1,
): { swipe: Swipe; ready: number } | null {
  const f = gone / a.span
  if (f >= a.live[0] || a.live[0] <= 0) return null
  return { swipe: swipeOf(at, aim, a, scale), ready: Math.max(0, Math.min(1, f / a.live[0])) }
}

function swipeOf(at: Spot, aim: Aimed, a: Attack, scale: number): Swipe {
  const grow = Math.pow(Math.max(0.05, scale), 0.45)
  /* ⚠️ the field is one screen-height tall by definition, so DODGE_ROOM — a fraction of that
     height — is already in these units and halves into a half-depth directly */
  const capped = Math.min(hurtHalf(a, PARK_DEEP) * PARK_TALL * grow, DODGE_ROOM / 2)
  return {
    from: at,
    aim,
    reach: a.reach * PARK_TALL * scale,
    half: capped,
    both: !!a.both,
  }
}

/**
 * How far a creature's footprint extends along one direction, in screen-heights.
 *
 * ⚠️ AN ELLIPSE, NOT A CIRCLE, and the first version of this got it wrong. Seen from above a
 * creature covers a shallow patch — that is what FOOT.deep is for — so in screen-heights the
 * footprint is about 0.098 across and 0.025 deep, four to one. Treating it as one radius meant
 * picking which lie to tell: the larger made every creature four times deeper to hit than it
 * looks, the smaller made it impossible to catch side-on.
 *
 * ⚠️ THE EXACT EXTENT IS ONE LINE, so there is no reason to approximate. For radii (a, b)
 * the support of an ellipse along a unit direction is hypot(a·ux, b·uy) — which gives the wide
 * answer along x, the shallow one along y, and the right thing at every angle between.
 */
export const footSpan = (wide: number, scale: number, ux: number, uy: number): number => {
  const rx = (wide * 0.8 * scale) / 2
  const ry = (FOOT.deep * PARK_TALL * scale) / 2
  return Math.hypot(rx * ux, ry * uy)
}

/**
 * Is this creature caught by that swing?
 *
 * ⚠️ MEASURED ALONG THE AIM AND ACROSS IT, with the target's own footprint expanding the
 * region in each of those two directions by however much it actually reaches that way. That is
 * what stops an attack from the corner covering more ground than the same attack from the side,
 * which is the unfairness this whole direction exists to remove.
 */
export function inSwipe(at: Spot, wide: number, s: Swipe, scale = 1): boolean {
  const { sx, sy } = toScreen(at.x - s.from.x, at.y - s.from.y)
  const along = sx * s.aim.x + sy * s.aim.y
  const side = Math.abs(sx * -s.aim.y + sy * s.aim.x)
  const padAlong = footSpan(wide, scale, s.aim.x, s.aim.y)
  const padSide = footSpan(wide, scale, -s.aim.y, s.aim.x)
  const back = s.both ? -(s.reach + padAlong) : -padAlong
  return along >= back && along <= s.reach + padAlong && side <= s.half + padSide
}

function areaOf(at: Spot, facing: number, a: Attack, scale: number): Box {
  const reach = outBy(a.reach * scale)
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
  const deep = Math.min(downBy(hurtHalf(a, PARK_DEEP) * grow), (VIEW.h * DODGE_ROOM) / 2)
  const x0 = a.both ? at.x - reach : facing > 0 ? at.x : at.x - reach
  return {
    x0,
    y0: at.y - deep,
    x1: x0 + (a.both ? reach * 2 : reach),
    y1: at.y + deep,
  }
}

/**
 * Carry a creature along with the move it is throwing.
 *
 * ⚠️ PURE, AND ONE OF THEM, so the player and the boss travel by the same rule. Two copies of
 * "a lunge moves you" is two copies that can disagree about how far, and this module has already
 * paid for that once with three different ideas of how deep a hitbox was.
 *
 * ⚠️ THROUGH holdInPark, because walking is no longer the only thing that moves a creature
 * and a second mover with its own idea of the edges is a second way to end up outside them.
 *
 * ⚠️ IT DOES NOT TOUCH VELOCITY. The drive is a displacement for exactly as long as the move
 * is live, so it stops dead when the move does rather than leaving the creature skating — which
 * is what setting vx would do, and what would make a lunge into a shove you gave yourself.
 */
export function driven(s: Striker, a: Attack | undefined, dt: number): Striker {
  if (!a) return s
  const speed = driveAt(a, a.span - s.swing)
  if (!speed) return s
  const t = Math.max(0, Math.min(0.05, dt))
  /* ⚠️ ALONG THE AIM, not along the facing. A lunge thrown up-and-left has to travel
     up-and-left, or the one shape whose identity is that it travels would travel somewhere the
     attack is not — see Striker.aim. Screen-heights out, world units in, one axis each. */
  const to = stepFrom(s, s.aim, speed * t)
  const { x, y } = holdInPark(to.x, to.y)
  return { ...s, x, y }
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
/**
 * ⚠️ BRACED COUNTS, and it belongs in here rather than at the four places that ask. "Busy"
 * is the one question the room asks before letting you steer, swing or cast, and a guard is
 * exactly a state where none of those three are yours — putting it at the call sites is how
 * you end up able to cast out of a stance you cannot walk out of.
 */
export const busy = (s: Striker): boolean => s.swing > 0 || s.stun > 0 || s.hold > 0 || s.braced

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
 * How much further a hurt creature flies.
 *
 * ⚠️ THE FIELD HAS PROMISED THIS SINCE IT WAS WRITTEN AND NOTHING DELIVERED IT. Attack.shove
 * is documented as "how hard it launches, BEFORE the damage already taken is counted", and
 * nothing anywhere counted it — every blow threw you exactly as far on your last point of
 * health as on your first. A comment describing a mechanic that does not exist is the worst
 * kind, because the next person reads it and builds against it.
 *
 * ⚠️ AND IT IS THE ONE MECHANIC THE STATED REFERENCE IS BUILT ON. "Think super smash bros,
 * but top down" — the thing that makes that game feel like that game is that the longer a
 * fight goes the further you get thrown, so the same attack that nudged you at the start
 * sends you across the field at the end. It turns the end of a fight into a different fight
 * without changing a single attack.
 *
 * ⚠️ POSITION AND TIME, NEVER DEATH. There is no ring-out in the park and there is not going
 * to be one — you go down at PLAYER_LIFE and get back up, which is the deal stepDown's note
 * makes. So being flung further costs you your spacing and the second it takes to get it back,
 * which against a boss in its last stand is quite enough.
 *
 * ⚠️ 0.85 IS A VELOCITY, AND THE DISTANCE GOES AS ITS SQUARE. stepWalker's drag subtracts a
 * fixed amount per second rather than a fraction — constant deceleration — so a launch twice
 * as fast travels four times as far, and the 1.85x multiplier here comes out as 3.74x on the
 * ground. Measured, not assumed: 0.19 pet-heights flung at full health against 0.71 at the
 * brink. That is kept rather than corrected, because a heavier hit SHOULD feel more than
 * proportionally heavier and 3.74 times a very small number is still under one creature's
 * height. The number is written here so the next person changing it knows which one they are
 * changing.
 *
 * ⚠️ AND THE STAGGER SCALES WITH IT FOR FREE, because stun is already computed from power.
 * That is the right shape — a bigger launch should be a longer recovery — and it comes out at
 * 0.22s at full health against 0.32s at the brink rather than anything dramatic.
 */
/**
 * ⚠️ THE SCRAP HAS ITS OWN, AND THEY ARE NOT THE SAME NUMBER ON PURPOSE. fight.ts's launchOf
 * is `shove * (0.6 + hurt/90)`: it starts BELOW baseline and has no ceiling, because that game
 * has no health bar and nothing ends until somebody leaves the stage — the launch growing
 * without limit IS the win condition. Here there is a pool that fills, no edge to fall off,
 * and going down is a setback rather than a loss, so this starts at 1 and stops at 1.85.
 * Two games, two jobs, one idea; written down at both ends so the next person finds the other.
 */
export const KNOCK = 0.85

/** The launch multiplier for how battered this creature already is, 1 to 1 + KNOCK. */
export const flung = (s: Striker): number =>
  1 + Math.max(0, Math.min(1, s.hurt / PLAYER_LIFE)) * KNOCK

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

/**
 * ⚠️ A NEIGHBOUR'S SHOVE IS SOFTENED BY A GUARD BUT DOES NOT SPEND ONE. Standing braced and
 * being bumped by a friend should feel like being braced; it should not be a way to take
 * somebody's defence off them before the boss swings. Only mauled spends the pool.
 */
export function shoved(s: Striker, from: Spot, a: Attack, fromUp = 0): Striker {
  /* straight over the top, or clean under: no push, no stagger, nothing to react to. The
     height it was thrown FROM matters as much as the height you are at — see overHead. */
  if (overHead(s, a, fromUp)) return s
  /* met on the frame it went up: nothing lands at all — see GUARD.parry */
  if (parries(s, from)) return { ...s, parried: PARRY_SHOW }
  const dx = s.x - from.x
  const dy = s.y - from.y
  const len = Math.hypot(dx, dy) || 1
  const met = guarded(s, from)
  /* ⚠️ the damage already taken, at last — see KNOCK and Attack.shove's own description */
  const power = a.shove * SHOVE * (met ? GUARD.slide : 1) * flung(s)
  /* ⚠️ the same shape stepWalker uses for its own speeds — x in world units, y scaled by
     SQUASH — so being shoved north looks as fast as being shoved east */
  return {
    ...s,
    vx: (dx / len) * power * VIEW.w,
    vy: (dy / len) * power * VIEW.w * SQUASH,
    swing: met ? s.swing : 0,
    /* met, you keep your feet: a stagger would drop the guard on the first thing it stopped */
    stun: met ? s.stun : 0.1 + power * 0.22,
    hold: 0.05 + a.bite * 0.004,
    /**
     * ⚠️ A BLOCK HAS TO LOOK LIKE ONE HERE TOO. guardLit was set by mauled and not by this,
     * which was invisible while only a boss could be blocked — and then the sparring dummy
     * arrived, which shoves and never mauls. So the one thing in the park built for LEARNING
     * the guard was the one thing that gave you nothing back when the guard worked. Found by
     * watching a practice run land eight blows on a raised guard with no flash at all.
     */
    guardLit: met ? 0.22 : s.guardLit,
  }
}

/**
 * The same blow, from something that is allowed to hurt you.
 *
 * ⚠️ ONLY A BOSS CALLS THIS, which is the whole distinction shoved's note is about. It is a
 * separate function rather than a flag because the call site is where somebody will look to ask
 * "can this take my health off", and a `true` sitting in an argument list does not answer that.
 */
/**
 * ⚠️ THE GUARD IS ANSWERED HERE AND NOWHERE ELSE, for the reason canBeHurt gives above: five
 * places land a boss's blow and they must all agree. A guard checked at the call sites is a
 * guard that works against a swing and not against a wave, which is worse than not having one.
 */
export const mauled = (s: Striker, from: Spot, a: Attack, fromUp = 0): Striker => {
  if (overHead(s, a, fromUp)) return s
  /* ⚠️ AND NOT A POINT OF DAMAGE, NOT A DROP OF GUARD. A parry that still chipped you would
     be a guard with extra steps; the reason to risk the timing is that it costs nothing. */
  if (parries(s, from)) return { ...s, parried: PARRY_SHOW }
  const p = shoved(s, from, a, fromUp)
  if (!guarded(s, from)) return { ...p, hurt: p.hurt + a.bite }
  const stopped = a.bite * (1 - GUARD.soak)
  const guard = Math.max(0, p.guard - stopped * GUARD.cost)
  const broke = guard <= 0
  return {
    ...p,
    hurt: p.hurt + a.bite * GUARD.soak,
    guard,
    guardLit: 0.22,
    braced: broke ? false : p.braced,
    /* ⚠️ a break is the punishment, and it has to be worse than not guarding: wide open, on
       the ground the boss is standing on, for longer than any single stagger */
    stun: broke ? GUARD.broken : p.stun,
    swing: broke ? 0 : p.swing,
  }
}
