import { hurtBox, inBox, slotFor, type Aim, type Attack, type At } from './attack'
import {
  PET_TALL,
  restingBody,
  stepBody,
  TUNE,
  type Body,
  type Bounds,
  type Input,
  type Ledge,
  type Traits,
  PLAIN,
} from './play'

/**
 * A fight between the things you drew.
 *
 * ⚠️ WHAT AN ATTACK DOES LIVES HERE; WHAT IT IS LIVES IN attack.ts. That split is the whole
 * reason both games can share the drawings: the swipe knows its reach and its timing, and this
 * file is the only thing that has ever heard of damage, launches or stocks. A park importing the
 * same attack gets the same swing and decides for itself that it knocks fruit out of a tree.
 *
 * ⚠️ AND IT IS THE SAME stepBody THE PLATFORMER USES. Gravity, acceleration, one-way ledges and
 * the coyote rule are not re-implemented here — they are called, with `ground: false` so that the
 * stage has edges to fall off. The note on followInput already says what a second physics engine
 * costs, and a fighting game whose jump feels different from the platformer's jump would be two
 * games about the same creature rather than one.
 *
 * ⚠️ PURE, LIKE ITS NEIGHBOUR, because requestAnimationFrame never fires in the browser pane.
 * "Does a long tail out-range a short one", "can a fresh fighter be killed off the top", and "does
 * the AI ever actually connect" are all questions with answers, asked with no browser at all.
 */

export type Fighter = Body & {
  /** damage taken. Not a health bar — the higher it is, the further the next hit sends you */
  hurt: number
  /** lives left; at zero this one is out */
  stocks: number
  /** seconds left of the swing being thrown, 0 for none */
  swing: number
  /** which of this creature's attacks is being thrown */
  move: number
  /** true once the current swing has connected, so one swing is one hit */
  spent: boolean
  /** seconds left unable to act, after being hit */
  stun: number
  /** seconds left before another attack may be thrown */
  rest: number
  /** seconds of mercy after arriving back from a ring-out */
  safe: number
  /**
   * Jumps left in mid-air.
   *
   * ⚠️ WITHOUT THIS, FALLING OFF IS DEATH AT ANY DAMAGE. stepBody only lets you jump from the
   * ground or within the coyote window, which is right for a platformer whose floor runs the whole
   * width of the world and fatal on a stage with edges: the gentlest nudge off the side at 0%
   * would end a stock, and the damage that is supposed to decide when you die would decide
   * nothing. A recovery is what makes being knocked off a problem to solve rather than a result.
   */
  hops: number
  /**
   * ⚠️ Whether jump was down last frame, because an air jump is a PRESS and every other
   * control here is a level. Held, it would spend every hop in three frames.
   */
  held: boolean
  /**
   * Whether each attack button was down last frame.
   *
   * ⚠️ AN ATTACK IS A PRESS, AND IT USED TO BE A LEVEL — which is the whole of "the fight is just
   * holding down the attack to win". Held, the button re-fired the instant the recovery ran out,
   * so the best thing either player could do was lean on it and never let go. Committing to a
   * swing has to be a decision you make again each time, or the recovery a heavy pays for its
   * damage with is a cost nobody ever actually pays.
   */
  heldQ: boolean
  heldH: boolean
  /**
   * Frames of stillness after a hit lands, for both of them at once.
   *
   * ⚠️ THIS IS WHAT MAKES A HIT FEEL LIKE A HIT. Without it a blow is a number changing and a
   * creature sliding — the two bodies pass through the moment of contact at full speed and there
   * is nothing to see. A few hundredths of a second where the world stops is the oldest trick in
   * the genre and the single biggest difference between "it registered" and "something happened".
   *
   * ⚠️ IN THE SIMULATION, NOT THE RENDERER, because both machines have to stop on the same frame
   * for the same length of time. A freeze done in the drawing would desync a bout the first time
   * anybody connected.
   */
  hold: number
}

export type FightInput = Input & { quick: boolean; heavy: boolean }

export const IDLE: FightInput = {
  left: false,
  right: false,
  jump: false,
  down: false,
  quick: false,
  heavy: false,
}

const STILL: Input = { left: false, right: false, jump: false, down: false }

/**
 * ⚠️ ONE SCREEN, NOT THREE. The platformer's world is wider than the window because walking
 * somewhere is what it is about; a fight is about the two of you, and a camera that has to choose
 * who to follow is a camera that is wrong for one of you. Everybody on screen at once, always.
 */
export const RING: Bounds = { w: 1, ground: false, walls: false }

/**
 * The stage.
 *
 * ⚠️ THE MAIN PLATFORM DOES NOT REACH THE EDGES, which is the entire difference from the
 * playground's floor and the reason a fight can end. Three shelves above it give somewhere to go
 * that is not sideways, and all of them are the same one-way ledges the platformer already has —
 * you jump up through them and land on top.
 */
export const STAGE: Ledge[] = [
  { x: 0.13, y: 0.8, w: 0.74 },
  { x: 0.06, y: 0.56, w: 0.2 },
  { x: 0.74, y: 0.56, w: 0.2 },
  { x: 0.4, y: 0.35, w: 0.2 },
]

/** The platform everybody is trying to stay on: the widest thing on the stage. */
export const DECK: Ledge = STAGE.reduce((a, b) => (b.w > a.w ? b : a), STAGE[0])

/**
 * Where the fight stops being the fight.
 *
 * ⚠️ GENEROUS AT THE SIDES AND MEAN UNDERNEATH, because a sideways launch is one you can fight
 * your way back from and a downward one is the fight already lost. `sky` is far enough up that a
 * fresh fighter cannot be killed off the top — checked, rather than assumed; at zero damage no
 * attack in the game launches anywhere near it.
 */
export const OUT = { side: 0.34, sky: -0.85, pit: 1.6 }

/**
 * How slippery a launch is, and how many jumps you get back with.
 *
 * ⚠️ BOTH OF THESE WERE MEASURED, NOT PICKED. At full grip the hardest hit in the game moved
 * a 200%-damaged fighter 0.815 of the stage and the boundary is 0.84 away, so nobody ever died;
 * at this grip a ring-out starts being reachable around 80–120%, which is where it should be. And
 * gliders get a third hop because wings already mean "stays up" everywhere else in this module.
 */
export const GRIP = 0.12
export const hopsOf = (t: Traits): number => (t.glide < 1 ? 3 : 2)

export const STOCKS = 3

/**
 * Where each fighter starts, and returns to.
 *
 * ⚠️ WELL INSIDE THE DECK, because these were a sixth of the stage from its edge and that is
 * less than one hit. Watched in a real round: a kick at 0% damage — the weakest exchange the game
 * has — carries 0.16 of the stage, which was exactly the distance from a spawn to the drop, so a
 * player who had done nothing wrong was over the edge on the first thing that touched them and
 * lost three lives in ten seconds at 7%. Damage is supposed to decide when you die; a spawn point
 * should not.
 */
export const SPAWN = [0.38, 0.62, 0.3, 0.7]

export const freshFighter = (i: number): Fighter => ({
  ...restingBody(SPAWN[i % SPAWN.length]),
  /* ⚠️ read off the deck rather than typed, so moving the platform cannot leave the spawns
     hanging in the air above where it used to be */
  y: DECK.y,
  facing: i % 2 === 0 ? 1 : -1,
  hurt: 0,
  stocks: STOCKS,
  swing: 0,
  move: 0,
  spent: false,
  stun: 0,
  rest: 0,
  safe: 1.2,
  hops: 2,
  held: false,
  heldQ: false,
  heldH: false,
  hold: 0,
})

const at = (f: Fighter): At => ({ x: f.x, y: f.y, facing: f.facing })

/**
 * How hard a hit sends somebody, given what they have already taken.
 *
 * ⚠️ DAMAGE MAKES YOU LIGHTER, IT DOES NOT KILL YOU. Nobody has a health bar that empties, so
 * nothing ever ends because a number reached zero while both creatures were standing on the
 * stage — you lose because you left it. That is the rule the whole game rests on, and it is one
 * line: the launch scales with the damage the target is carrying.
 */
export const launchOf = (a: Attack, hurt: number): number => a.shove * (0.6 + hurt / 90)

/**
 * One step of one fighter.
 *
 * ⚠️ STUNNED MEANS STUNNED. While the stun lasts the input is thrown away entirely rather than
 * damped — a launch you can steer out of is not a launch, and the drag in TUNE only applies when
 * nothing is held, so a player mashing left during their own knockback would otherwise cancel it.
 *
 * ⚠️ AND A SWING COMMITS YOU. You keep the momentum you had, you do not get any more: that is
 * what makes a long recovery a real cost rather than a number in a table. Gravity still applies,
 * so an attack thrown in the air still falls.
 */
export function stepFighter(
  f: Fighter,
  input: FightInput,
  moves: Attack[],
  dt: number,
  traits: Traits = PLAIN,
  ledges: Ledge[] = STAGE,
  bounds: Bounds = RING,
): Fighter {
  const t = Math.max(0, Math.min(0.05, dt))

  /**
   * ⚠️ NOTHING MOVES DURING HITSTOP, INCLUDING GRAVITY. A freeze that only stopped the horizontal
   * would drop both creatures a little on every exchange, which over a long fight is a fighter
   * being quietly walked into the pit by having landed hits.
   */
  if (f.hold > 0) {
    return {
      ...f,
      hold: Math.max(0, f.hold - t),
      held: input.jump,
      heldQ: input.quick,
      heldH: input.heavy,
    }
  }

  const stun = Math.max(0, f.stun - t)
  const rest = Math.max(0, f.rest - t)
  const safe = Math.max(0, f.safe - t)
  let swing = Math.max(0, f.swing - t)
  let move = f.move
  let spent = f.spent

  /* ⚠️ the rising edge only — see heldQ/heldH */
  const tapQ = input.quick && !f.heldQ
  const tapH = input.heavy && !f.heldH
  const busy = stun > 0 || swing > 0
  if (!busy && rest <= 0 && (tapQ || tapH)) {
    /**
     * ⚠️ WHERE YOU WERE POINTING WHEN YOU PRESSED, and only then. Reading the aim every frame
     * would let a swing change its mind halfway through — you would start a sweep, tap up, and
     * the hitbox would become a different move's mid-flight.
     */
    const aim: Aim = input.jump ? 'up' : input.down ? 'down' : 'neutral'
    move = Math.min(moves.length - 1, slotFor(tapH, aim))
    swing = moves[move]?.span ?? 0
    spent = false
  }

  const drive: Input = stun > 0 || swing > 0 ? STILL : input
  const body = stepBody(f, drive, ledges, t, traits, {
    bounds,
    grip: stun > 0 ? GRIP : 1,
  })

  /**
   * The jump you get back with.
   *
   * ⚠️ APPLIED AFTER THE STEP, as an impulse, exactly like the knockback in `trade`. stepBody
   * owns gravity and the ground rules and is not asked to learn about air jumps; this overwrites
   * one number afterwards, which is what an impulse is.
   *
   * ⚠️ AND NOT WHILE STUNNED OR SWINGING, or a recovery would cancel the launch that caused
   * it and the whole damage curve would mean nothing.
   */
  const max = hopsOf(traits)
  let hops = body.onGround ? max : Math.min(f.hops, max)
  let vy = body.vy
  const pressed = input.jump && !f.held
  if (!body.onGround && pressed && hops > 0 && stun <= 0 && swing <= 0) {
    vy = -TUNE.jump * traits.jump * 0.92
    hops--
  }

  /**
   * ⚠️ A SWING POINTS THE WAY IT WAS THROWN, so a creature does not turn round mid-attack and
   * drag its own hitbox across the stage behind it.
   *
   * ⚠️ AND SO DOES A TUMBLE. stepBody takes facing from the way a body is MOVING, which is
   * right for walking and exactly wrong for being hit: knocked to the left, a fighter came to rest
   * facing left — away from whoever hit it — and if it then stood still, nothing ever turned it
   * back. Watched in a mirror match: they traded one hit each, ended up 0.59 apart facing opposite
   * ways, and swung at empty air for the remaining fifty seconds of the round. Being hit does not
   * tell you where to look.
   */
  const facing = swing > 0 || stun > 0 ? f.facing : body.facing

  return {
    ...body,
    vy,
    hops,
    held: input.jump,
    heldQ: input.quick,
    heldH: input.heavy,
    hold: 0,
    facing,
    hurt: f.hurt,
    stocks: f.stocks,
    swing,
    move,
    spent,
    stun,
    rest: swing > 0 ? (moves[move]?.rest ?? 0) + swing : rest,
    safe,
  }
}

/** The region this fighter is hurting right now, or null. */
export function liveBox(f: Fighter, moves: Attack[]) {
  if (f.swing <= 0 || f.spent) return null
  const a = moves[f.move]
  if (!a) return null
  return hurtBox(at(f), a, a.span - f.swing)
}

/**
 * Which part of a swing a creature is in.
 *
 * ⚠️ THE THREE PARTS OF AN ATTACK ARE THE GAME, AND YOU COULD NOT SEE ANY OF THEM. The whole
 * reason a heavy is worth more damage is that you are committed through a wind-up before it and a
 * recovery after it — but on screen every attack was one undifferentiated lunge, so there was
 * nothing to step into and nothing to punish, and both buttons looked the same whatever they did.
 * Reported as needing "more feeling where every action is obvious as to what's happening".
 *
 * ⚠️ DERIVED, NOT STORED. It is a reading of the same swing clock the hit test uses, so what
 * you see lit up is exactly when the hitbox is live — rather than a second animation that agrees
 * with the rules only until one of them is edited.
 */
export type Phase = 'ready' | 'windup' | 'live' | 'recover' | 'stunned' | 'frozen'

/**
 * The least a thing has to be for these two to read it.
 *
 * ⚠️ STRUCTURAL, so the park can use them without being a Fighter. A creature swinging in a
 * top-down field has no stocks and no jumps left and never will — but the three parts of a swing
 * are the three parts of a swing wherever it is thrown, and writing them out twice would be two
 * answers to when a hitbox is live.
 */
export type Swinging = {
  swing: number
  move: number
  spent: boolean
  stun: number
  hold: number
}

export function phaseOf(f: Swinging, moves: Attack[]): Phase {
  if (f.hold > 0) return 'frozen'
  if (f.stun > 0) return 'stunned'
  if (f.swing <= 0) return 'ready'
  const a = moves[f.move]
  if (!a) return 'ready'
  const gone = (a.span - f.swing) / a.span
  if (gone < a.live[0]) return 'windup'
  if (gone > a.live[1] || f.spent) return 'recover'
  return 'live'
}

/** Somebody got hit, and by what. */
export type Blow = { who: number; by: number; attack: Attack; up: boolean }

/**
 * Everybody's swings against everybody's bodies, for this frame.
 *
 * ⚠️ ONE SWING IS ONE HIT, marked on the attacker rather than counted on the target. A hitbox is
 * live for a third of a second, which at sixty frames a second is twenty chances to connect with
 * the same creature — without this a single swipe does twenty times its damage and reads as an
 * instant kill nobody can explain.
 *
 * ⚠️ AND IT RETURNS null WHEN NOTHING HAPPENED, the same bargain `collect` makes: this is asked
 * every frame and must not cost a render to say "no".
 */
export function trade(
  fs: Fighter[],
  moves: Attack[][],
  wides: number[],
): { next: Fighter[]; blows: Blow[] } | null {
  const blows: Blow[] = []
  const next = fs.map((f) => ({ ...f }))

  for (let i = 0; i < fs.length; i++) {
    const box = liveBox(fs[i], moves[i] ?? [])
    if (!box) continue
    const a = moves[i]?.[fs[i].move]
    if (!a) continue
    for (let j = 0; j < fs.length; j++) {
      if (j === i || fs[j].safe > 0 || fs[j].stocks <= 0) continue
      if (!inBox(at(fs[j]), wides[j] ?? PET_TALL, box)) continue

      const power = launchOf(a, fs[j].hurt)
      /* away from the attacker, so a both-sides attack throws each way rather than one way */
      const dir = fs[j].x === fs[i].x ? fs[i].facing || 1 : Math.sign(fs[j].x - fs[i].x)
      next[j].hurt = fs[j].hurt + a.bite
      next[j].vx = dir * power * (1 - a.lift * 0.5)
      next[j].vy = -power * (0.5 + a.lift)
      next[j].onGround = false
      /* ⚠️ the hops come back on a hit, so being launched always leaves you something to
         recover with — otherwise a second hit while already in the air is unanswerable */
      next[j].hops = Math.max(next[j].hops, 1)
      next[j].stun = 0.12 + power * 0.16
      next[j].swing = 0
      next[j].facing = -dir
      next[i].spent = true
      /* ⚠️ BOTH OF THEM, for the same length of time. Freezing only the one who was hit reads as
         them lagging; freezing both reads as the blow landing. */
      const freeze = 0.05 + a.bite * 0.004
      next[i].hold = freeze
      next[j].hold = freeze
      blows.push({ who: j, by: i, attack: a, up: a.lift > 0.5 })
      break
    }
  }
  return blows.length ? { next, blows } : null
}

/** Off the stage and out of the round. */
export const isOut = (f: Fighter): boolean =>
  f.x < -OUT.side || f.x > RING.w + OUT.side || f.y < OUT.sky || f.y > OUT.pit

/**
 * Anybody who left the stage comes back, one life lighter.
 *
 * ⚠️ RETURNS null WHEN NOBODY DID, for the same reason as `trade`. A round is mostly frames in
 * which nobody fell off anything.
 *
 * ⚠️ AND THE LAST STOCK DOES NOT RESPAWN. A fighter on zero is left where it is and stops being
 * stepped, rather than reappearing to be knocked off again by somebody who has already won.
 */
export function respawn(fs: Fighter[], i0 = 0): Fighter[] | null {
  let gone = false
  const next = fs.map((f, i) => {
    if (f.stocks <= 0 || !isOut(f)) return f
    gone = true
    const stocks = f.stocks - 1
    if (stocks <= 0) return { ...f, stocks, stun: 0, swing: 0 }
    return {
      ...freshFighter(i + i0),
      stocks,
      /* ⚠️ dropped in from above rather than placed on the platform, so two fighters cannot
         arrive inside each other after a double ring-out */
      y: 0.2,
      onGround: false,
      safe: 1.4,
    }
  })
  return gone ? next : null
}

/**
 * How long one frame of the fight is.
 *
 * ⚠️ FIXED, AND THAT IS WHAT MAKES THE FIGHT SHAREABLE. Stepping by however long the last
 * animation frame happened to take is fine for one screen and useless for two: the same inputs on
 * a 60Hz laptop and a 144Hz monitor produce different fights within seconds, and no amount of
 * sending positions back and forth can reconcile two worlds that disagree about what happened.
 *
 * ⚠️ THE SIMULATION USES ONLY max, min, abs, floor AND sign — checked, not assumed. Those are
 * exactly specified on IEEE 754 doubles, so they give the same bits in every engine. No sin, cos,
 * exp, hypot or random anywhere in the fight path, which is the other half of why two machines can
 * agree. (walk.ts does use hypot and exp; the park does not need to agree with anybody.)
 */
export const FRAME = 1 / 60

/**
 * One whole frame: everybody steps, swings land, anybody who fell off comes back.
 *
 * ⚠️ state' = f(state, inputs) AND NOTHING ELSE. No clock, no random, no reading anything
 * outside its arguments — which is the exact shape a shared fight needs, and is also why the
 * whole game was testable before it had a screen.
 */
export function stepFight(
  fs: Fighter[],
  inputs: FightInput[],
  moves: Attack[][],
  traits: Traits[],
  wides: number[],
  ledges: Ledge[] = STAGE,
  bounds: Bounds = RING,
): Fighter[] {
  let next = fs.map((f, i) =>
    f.stocks > 0
      ? stepFighter(f, inputs[i] ?? IDLE, moves[i] ?? [], FRAME, traits[i], ledges, bounds)
      : f,
  )
  const swap = trade(next, moves, wides)
  if (swap) next = swap.next
  const back = respawn(next)
  if (back) next = back
  return next
}

/**
 * How many frames one animation frame may catch up.
 *
 * ⚠️ A BACKGROUNDED TAB HANDS YOU SECONDS AT ONCE, and a fixed step turns that into hundreds
 * of frames in one go — which locks the page up and, in a shared fight, fast-forwards one player
 * through a fight the other watched at normal speed. Dropping the excess is the honest answer: the
 * clock is allowed to be behind, the simulation is not allowed to lie.
 */
export const MAX_CATCHUP = 5

/** Who is left standing, or null while more than one of them is. */
export function winnerOf(fs: Fighter[]): number | null {
  const alive = fs.map((f, i) => (f.stocks > 0 ? i : -1)).filter((i) => i >= 0)
  return alive.length === 1 ? alive[0] : alive.length === 0 ? -1 : null
}

/**
 * What a fighter nobody is driving does.
 *
 * ⚠️ IT RETURNS AN INPUT, exactly like followInput, and for exactly the same reason: steered
 * through the same stepFighter as a person, it obeys the same gravity, the same ledges and the
 * same recovery frames, and cannot do anything a player could not. The alternative is an opponent
 * that cheats in ways nobody can see and everybody can feel.
 *
 * ⚠️ IT IS DELIBERATELY NOT GOOD. It closes, it swings when you are in range, and it tries to get
 * back on the stage when it is off it. It does not read your recovery, bait, or edge-guard —
 * something to play against on your own while nobody else is at the keyboard, not an opponent
 * worth beating. `nerve` is how long it dithers before committing, so it can be made gentler.
 */
export function foeInput(
  self: Fighter,
  foe: Fighter,
  moves: Attack[],
  foeWide: number,
  clock: number,
  nerve = 1,
): FightInput {
  const dx = foe.x - self.x
  /**
   * ⚠️ REACH IS IN PET-HEIGHTS AND THIS ONCE MULTIPLIED IT BY A WIDTH, which turned the
   * opponent into a statue. A wide creature's range came out three times too big, so `near` was
   * true from across the stage, so it never walked anywhere — it stood on its spawn swinging, was
   * shoved a little further out by each hit it took, and eventually fell off without either of
   * them having fought. Measured: a 90-second round decided in 11.4s on nine hits and a top
   * damage of 42%, which is nobody landing anything that should have killed.
   */
  const range = (moves[0]?.reach ?? 0.8) * PET_TALL + foeWide / 2
  /* ⚠️ WELL INSIDE ITS REACH, not at the edge of it. Stopping at 0.9 of the maximum put it at
     the exact distance where a hitbox only just grazes, and only during the live third of the
     swing — so it stood there throwing sweeps that reached nothing. */
  const near = Math.abs(dx) < range * 0.7
  const above = self.y - foe.y > 0.12

  /**
   * ⚠️ GETTING HOME COMES FIRST. An opponent that keeps attacking while falling past the stage
   * is one that loses to gravity rather than to you, which is not a fight.
   *
   * ⚠️ AND IT TURNS BACK WHILE STILL ON THE PLATFORM, not once it is past the edge. Read off
   * the stage rather than typed, so moving a ledge cannot quietly strand it.
   */
  const deck = DECK
  const lost = self.x < deck.x + 0.05 || self.x > deck.x + deck.w - 0.05 || self.y > 0.95
  if (lost) {
    /**
     * ⚠️ HEIGHT BEFORE DIRECTION, and getting that the wrong way round is fatal rather than
     * merely bad. This used to steer straight for the middle of the stage from wherever it was,
     * which off the left edge means walking HORIZONTALLY UNDERNEATH the platform — and every
     * ledge here is one-way, so from below there is nothing to land on for the whole width of the
     * stage. Traced: knocked off at x=0.087, it crossed the platform's level twice while still
     * outside it, drifted in under the deck, and fell into the pit at x=0.493 with 35% damage.
     * Three of four ring-outs in that round were the same death, which made the damage curve look
     * broken when nothing about it was.
     *
     * So while it is at or below the deck it heads for the nearest OUTSIDE edge, where there is
     * open air to climb; only once it is properly above does it come back in.
     */
    const under = self.y > deck.y - PET_TALL * 0.5
    const goal = under
      ? self.x < deck.x + deck.w / 2
        ? deck.x - 0.1
        : deck.x + deck.w + 0.1
      : deck.x + deck.w / 2
    return {
      left: self.x > goal + 0.02,
      right: self.x < goal - 0.02,
      /* ⚠️ only on the way DOWN, so it does not spend both hops at the top of a launch while
         it is still higher than the stage and has nothing to climb back to */
      jump: self.vy > 0.1 && Math.floor(clock * 7) % 2 === 0,
      down: false,
      quick: false,
      heavy: false,
    }
  }

  /* a slow square wave, so it commits for a beat instead of twitching every frame */
  const beat = Math.floor(clock * 2.2) % 3 === 0
  /* ⚠️ PULSED, because an air jump is a press: held down it would be spent on the first frame
     off the ground and never again, which is the recovery it most needs it for */
  const pulse = Math.floor(clock * 7) % 2 === 0
  /**
   * ⚠️ IT SWINGS WITH ITS HANDS EMPTY, which is the whole of what it needed to learn about
   * directions. The aim is read off the jump and crouch keys — keys this already presses for its
   * own reasons — so the moment there were directional attacks it began throwing long-recovery
   * up-swings whenever it happened to be jumping, and whiffing them: six stalemates in
   * thirty-six became eighteen.
   *
   * ⚠️ AND TEACHING IT TO AIM DELIBERATELY MADE THAT WORSE, not better. Holding an aim means
   * holding jump or crouch, and neither is free: jump held is a creature bouncing off the stage
   * instead of fighting, crouch held is one walking at four tenths of its speed. Those costs are
   * exactly the trade a direction is MEANT to be for a player — and an opponent that pays them
   * without understanding them simply plays worse.
   */
  const jumpNow = pulse && ((above && self.onGround) || (!self.onGround && foe.y < self.y - 0.25))
  const canHit = near && self.rest <= 0 && !jumpNow
  return {
    left: !near && dx < 0,
    right: !near && dx > 0,
    jump: jumpNow,
    down: false,
    quick: canHit && beat,
    heavy: canHit && !beat && Math.abs(dx) < range * 0.45 * nerve,
  }
}

/** What the rig should be doing, for a fighter rather than a walker. */
export function fightStance(f: Fighter): 'idle' | 'alert' | 'run' | 'crouch' | 'pounce' {
  if (f.swing > 0) return 'pounce'
  if (f.stun > 0) return 'alert'
  if (!f.onGround) return 'alert'
  return Math.abs(f.vx) > 0.05 ? 'run' : 'idle'
}

/**
 * How far a creature throws itself into a swing, in its own heights.
 *
 * ⚠️ THE ATTACK HAD NO MOVEMENT IN IT AT ALL. A swing changed a stance, lit a filter and drew
 * a box in front of the creature — and a box appearing in front of something that is standing
 * perfectly still reads as a ranged attack, because that is exactly what it looks like. Reported
 * as "they all are just forward attacks at a rectangle in front of you".
 *
 * ⚠️ PULL BACK, THROW, DRIFT HOME, which is the oldest shape in animation and the reason the
 * three phases were worth separating in the first place. The wind-up going the WRONG way is what
 * makes the strike read as fast: there is nothing to compare it to otherwise.
 */
export function lungeOf(f: Swinging, moves: Attack[]): number {
  switch (phaseOf(f, moves)) {
    case 'windup':
      return -0.16
    case 'live':
      return 0.44
    case 'recover':
      return 0.16
    case 'stunned':
      return -0.1
    default:
      return 0
  }
}

/** How fast the creature's own clock runs — the same shape as the playground's effortOf. */
export const fightEffort = (f: Fighter, still: boolean): number => {
  if (f.swing > 0) return 2.2
  if (still && f.onGround && Math.abs(f.vx) < 0.02) return 0
  return f.onGround ? 0.35 + (Math.abs(f.vx) / TUNE.speed) * 1.35 : 1.1
}
