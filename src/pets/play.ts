import type { Part, Stance } from './rig'

/**
 * A pet you can walk about, jump, and drop off things.
 *
 * ⚠️ A PURE FUNCTION OF THE STATE AND THE TIME SINCE THE LAST ONE, for the same reason paintPet
 * is a pure function of time: requestAnimationFrame never runs in the browser pane, so a physics
 * loop living inside a component is a physics loop nobody can check. Written like this, "what
 * happens if you hold right for half a second from standing" is a question with an answer, asked
 * without a browser at all.
 *
 * ⚠️ AND IT NEEDS NO NEW DRAWING. The rig already reads a run, a crouch and a braced pose out of
 * the layer names, and paintPet already takes a facing — so walking is `run` with the clock going,
 * standing still is `idle`, holding down is `crouch`, and being in the air is `alert`, which the
 * rig describes as the pose before something happens. A creature somebody drew in four minutes is
 * a platformer character without drawing a single frame of one.
 *
 * ⚠️ 0–1 ACROSS AND DOWN, like everything else in this codebase that has to survive being shown
 * at a size nobody has decided yet. y = 1 is the floor. Gravity is in world-heights per second
 * squared, so the game plays identically on a phone and a wall display.
 */

export type Body = {
  x: number
  y: number
  vx: number
  vy: number
  /** standing on something, so it may jump */
  onGround: boolean
  /** -1 left, 1 right — the last way it actually moved, not the way it is pressed */
  facing: number
  /** seconds since it left the ground, for the coyote rule below */
  fell: number
}

export type Input = { left: boolean; right: boolean; jump: boolean; down: boolean }

/** A one-way platform: you land on top of it and jump up through it. */
export type Ledge = { x: number; y: number; w: number }

export const FLOOR = 1

/**
 * How wide the world is, in screenfuls.
 *
 * ⚠️ IT IS BIGGER THAN THE WINDOW, and that is the whole of this change. Yesterday's note on
 * the treats worked out that no treat could be made glider-only: a pet's reach is its whole body,
 * a fifth of a screen tall, so anything a winged pet could get to on one screen was already inside
 * a plain one's hitbox — and a gap wider than a jump does not fit across one screen either. The
 * conclusion was that gating wants a bigger world, so here is one.
 *
 * ⚠️ WIDE RATHER THAN TALL, because a horizontal camera is one number and a vertical one is
 * a second set of decisions about when to follow you up. A gap is also the honest way to ask for
 * wings: staying up is exactly what wings are for, and a gap says so without a word of UI.
 *
 * ⚠️ x IS STILL 0–1 PER SCREEN. The unit did not change, there is just more of it — so
 * gravity, jumps and speeds are all still the numbers they were tuned to, and y is untouched.
 */
export const WORLD = { w: 3 }

/**
 * ⚠️ TUNED IN WORLD HEIGHTS, and the jump is the one that matters: 1.55 against a gravity of 4.6
 * is a rise of about a quarter of the screen and a hang of roughly two thirds of a second, which
 * is what reads as a jump rather than a hop or a balloon. Everything else was fitted around it.
 */
export const TUNE = {
  speed: 0.62,
  accel: 5.2,
  /** how hard it stops when nothing is held — a slide, not a wall */
  drag: 7.5,
  gravity: 4.6,
  jump: 1.55,
  /** falling faster than rising, which every platformer does and nobody notices until it is gone */
  fallBoost: 1.35,
  /** terminal speed, so a long drop stays catchable */
  maxFall: 2.6,
  crouchSpeed: 0.26,
  /** how long after walking off an edge a jump still works */
  coyote: 0.1,
}

/**
 * What a particular creature is good at, read out of what it is made of.
 *
 * ⚠️ THIS IS WHAT MAKES CHOOSING ONE A CHOICE. Until now every pet handled identically, so
 * picking between them was a toggle with nothing on either side of it — the roster was a costume
 * change. The module's whole bet is that a drawing's layer names are its skeleton; this is the
 * same bet carried one step further, that they also say what the thing can DO. A creature with
 * wings should get down gently. One with four legs should be quicker than one with none.
 *
 * ⚠️ AND NOBODY HAS TO BE TOLD. You do not pick a class or tick a box — you drew wings, so
 * it glides. The same four minutes in the paint room that made the pet made its abilities, and a
 * person who never reads a word of this still gets a winged thing that handles like one.
 *
 * ⚠️ MODIFIERS, NOT VALUES, so the feel of the game is still TUNE's to set in one place.
 * Every one of these multiplies something already tuned rather than replacing it, and a pet with
 * no recognised parts multiplies everything by one and plays exactly as the game plays.
 */
export type Traits = { speed: number; jump: number; gravity: number; glide: number }

export const PLAIN: Traits = { speed: 1, jump: 1, gravity: 1, glide: 1 }

export function traitsOf(parts: Part[]): Traits {
  let legs = 0
  let wings = 0
  let floats = 0
  for (const p of parts) {
    if (p.kind === 'leg') legs++
    else if (p.kind === 'wing') wings++
    else if (p.kind === 'float') floats++
  }
  return {
    /* ⚠️ capped, because somebody WILL draw nine legs and the game should still be playable */
    speed: 1 + Math.min(legs, 4) * 0.09,
    jump: 1 + Math.min(wings, 2) * 0.13,
    /* a halo, a balloon, a cloud — things the rig already calls `float` are lighter here too */
    gravity: floats ? 0.74 : 1,
    /* ⚠️ the one ability you have to USE: hold jump on the way down and wings slow the fall */
    glide: wings ? 0.34 : 1,
  }
}

/** What this creature is good at, in the fewest words that are true. */
export function traitWords(t: Traits): string[] {
  const out: string[] = []
  if (t.glide < 1) out.push('glides')
  if (t.jump > 1) out.push('jumps higher')
  if (t.gravity < 1) out.push('light')
  if (t.speed > 1.18) out.push('fast')
  else if (t.speed > 1) out.push('quick')
  return out
}

export const restingBody = (x = 0.2): Body => ({
  x,
  y: FLOOR,
  vx: 0,
  vy: 0,
  onGround: true,
  facing: 1,
  fell: 0,
})

/**
 * One step of the world.
 *
 * @param dt seconds. Clamped, because a tab that was in the background hands you a dt of several
 * seconds and a pet that teleports through the floor — the one bug every naive loop has.
 */
export function stepBody(
  b: Body,
  input: Input,
  ledges: Ledge[],
  dt: number,
  traits: Traits = PLAIN,
): Body {
  const t = Math.max(0, Math.min(0.05, dt))
  const ducking = input.down && b.onGround
  const want = (input.right ? 1 : 0) - (input.left ? 1 : 0)
  const top = (ducking ? TUNE.crouchSpeed : TUNE.speed) * traits.speed

  let vx = b.vx
  if (want !== 0) {
    vx += want * TUNE.accel * t
    vx = Math.max(-top, Math.min(top, vx))
  } else {
    /* ⚠️ towards zero rather than multiplied, so it actually arrives: a decay never quite stops
       and leaves the pet creeping for ever at a speed too small to see but not to accumulate */
    const drop = TUNE.drag * t
    vx = Math.abs(vx) <= drop ? 0 : vx - Math.sign(vx) * drop
  }

  /**
   * ⚠️ COYOTE TIME, which is not a nicety. The pet is about a tenth of the screen tall and the
   * ledges are thin, so the frame you walk off an edge is a frame you meant to jump on more often
   * than not. A tenth of a second of grace is invisible when it is there and infuriating when it
   * is not.
   */
  const fell = b.onGround ? 0 : b.fell + t
  let vy = b.vy
  if (input.jump && (b.onGround || fell < TUNE.coyote)) vy = -TUNE.jump * traits.jump
  else {
    /**
     * ⚠️ GLIDING IS HELD, NOT AUTOMATIC, which is what makes wings a thing you play rather
     * than a number you have. It only applies on the way DOWN: holding jump on the way up would
     * make a winged pet float upward for as long as you leaned on the key, which is not a jump.
     */
    const gliding = vy > 0 && input.jump && !b.onGround
    const pull =
      TUNE.gravity * traits.gravity * (gliding ? traits.glide : vy > 0 ? TUNE.fallBoost : 1)
    vy += pull * t
  }
  vy = Math.min(TUNE.maxFall * (input.jump && traits.glide < 1 ? traits.glide : 1), vy)

  const x = Math.max(0.02, Math.min(WORLD.w - 0.02, b.x + vx * t))
  const wasY = b.y
  let y = wasY + vy * t
  let onGround = false

  if (y >= FLOOR) {
    y = FLOOR
    vy = 0
    onGround = true
  } else if (vy > 0) {
    /**
     * ⚠️ ONLY WHILE FALLING, AND ONLY FROM ABOVE. A ledge you can also hit from below is a
     * ceiling, and a pet that bonks its head on the thing it is trying to reach reads as broken
     * rather than as strict. Crossing the line this step is the test, not being near it: at 2.6
     * world-heights a second a fast fall covers more than a ledge is thick, so "is it touching"
     * misses entirely.
     */
    for (const l of ledges) {
      if (x < l.x || x > l.x + l.w) continue
      if (wasY <= l.y && y >= l.y) {
        y = l.y
        vy = 0
        onGround = true
        break
      }
    }
  }

  /* ⚠️ the way it MOVED, so a pet shoved into a wall keeps facing the way it is walking rather
     than flickering, and one standing still keeps looking wherever it last went */
  const facing = vx > 0.01 ? 1 : vx < -0.01 ? -1 : b.facing

  return { x, y, vx, vy, onGround, facing, fell: onGround ? 0 : fell }
}

/**
 * What the rig should be doing, from what the body is doing.
 *
 * ⚠️ READ OFF THE BODY, NOT OFF THE KEYS. Holding right against a wall is not running, and
 * letting go mid-stride does not stop the legs the same instant. The velocity already knows.
 */
export function stanceOf(b: Body, input: Input): Stance {
  if (!b.onGround) return 'alert'
  if (input.down) return 'crouch'
  return Math.abs(b.vx) > 0.05 ? 'run' : 'idle'
}

/**
 * How fast the creature's own clock should run.
 *
 * ⚠️ FROM THE SPEED, so the legs match the ground. A run cycle at a fixed rate under a body that
 * is accelerating is the thing that reads as skating, and it is the one giveaway that a character
 * is a picture being moved rather than a thing that is moving.
 */
export const effortOf = (b: Body): number =>
  b.onGround ? 0.35 + (Math.abs(b.vx) / TUNE.speed) * 1.35 : 1.1

/**
 * What a pet that ISN'T being driven wants to do: keep up with the one that is.
 *
 * ⚠️ IT RETURNS AN INPUT, NOT A POSITION, and that is the whole trick. A follower is steered
 * through exactly the same stepBody as you are — same acceleration, same gravity, same one-way
 * ledges, same coyote rule. So it cannot walk through a ledge you have to climb, cannot reach
 * somewhere you cannot, and gets the run and crouch stances for free. Writing "move it towards
 * him" instead would have been a second, worse physics engine that disagrees with the first.
 *
 * ⚠️ SLOTS ALTERNATE BEHIND AND IN FRONT, AND ARE KEPT INSIDE THE WORLD. Queueing them all
 * behind the lead sounds tidier and is not: with the lead near the left wall every slot lands at a
 * negative x, every follower walks into the wall, and they stack in the corner as one smudge —
 * measured exactly that, three pets rendered at left: 2%, which is the clamp. Alternating sides
 * and clamping the slot means the lead can stand anywhere and still be followed by a group you
 * can tell apart.
 *
 * ⚠️ IT JUMPS ONLY WHEN THE LEAD IS GENUINELY ABOVE AND NOT FAR AWAY. A follower that jumps
 * whenever it is below you bounces on the spot the entire time you stand on a ledge, which reads
 * as a fault rather than as keenness.
 */
export function followInput(self: Body, lead: Body, slot = 1): Input {
  const behind = -Math.sign(lead.facing || 1)
  const side = slot % 2 === 1 ? behind : -behind
  const dist = 0.07 + Math.floor((slot - 1) / 2) * 0.08
  const want = Math.max(0.05, Math.min(0.95, lead.x + side * dist))
  const dx = want - self.x
  /* ⚠️ a dead zone wide enough to see, because a follower that stops dead the instant it is
     level twitches every time the lead breathes. Half a pet is about right. */
  const close = Math.abs(dx) < 0.045
  return {
    left: !close && dx < 0,
    right: !close && dx > 0,
    jump: self.onGround && lead.y < self.y - 0.08 && Math.abs(dx) < 0.4,
    down: false,
  }
}

/** Somewhere to get to. */
export type Spot = { x: number; y: number }

/**
 * How close a pet's FEET have to be to a treat to have got it.
 *
 * ⚠️ A BOX AROUND THE WHOLE CREATURE, not a circle around a point. The body's y is the
 * ground it is standing on, so a treat at head height is more than a pet-height away from the
 * number being compared — a plain distance check means walking through a treat at eye level does
 * nothing, which is the sort of thing that reads as the game ignoring you. Up is generous, down is
 * not, because a treat under your feet is one you have already passed.
 */
const REACH_X = 0.05
const REACH_UP = 0.2
const REACH_DOWN = 0.04

export const touching = (b: Body, s: Spot): boolean =>
  Math.abs(b.x - s.x) < REACH_X && b.y - s.y < REACH_UP + 0 && s.y - b.y < REACH_DOWN

/**
 * Who has picked up what.
 *
 * ⚠️ ANY PET COUNTS, not just the one you are driving. The followers are your pets too, and
 * a party that walks through a treat without it counting would be asking you to go back and do it
 * again as the right creature, which is busywork rather than a game.
 *
 * ⚠️ IT RETURNS null WHEN NOTHING CHANGED, so the room can call this every frame and only
 * touch React when something actually happened. Sixty state updates a second to say "still five
 * treats" is the cost of asking the wrong question.
 */
export function collect(bodies: Body[], spots: Spot[], taken: boolean[]): boolean[] | null {
  let hit = false
  const next = spots.map((s, i) => {
    if (taken[i]) return true
    const got = bodies.some((b) => touching(b, s))
    if (got) hit = true
    return got
  })
  return hit ? next : null
}

/** A little course: three ledges you can climb, reachable in order from the floor. */
/**
 * The course, across three screens.
 *
 * ⚠️ THE FIRST SCREEN IS UNCHANGED, so everything measured against it still holds and the
 * opening of the level is the one that was already tuned. What is new is what happens after it.
 *
 * ⚠️ AND THERE IS A GAP AT 1.62 THAT A PLAIN JUMP CANNOT CROSS. That is the point of the
 * wider world: a creature with wings holds jump and glides over it, a creature without has to go
 * the long way round along the floor. Measured rather than hoped — see the note on TREATS.
 */
export const COURSE: Ledge[] = [
  { x: 0.08, y: 0.74, w: 0.22 },
  { x: 0.4, y: 0.54, w: 0.24 },
  { x: 0.72, y: 0.34, w: 0.2 },
  /* the run-up: a shelf you arrive on from the top of the first screen */
  { x: 1.12, y: 0.4, w: 0.3 },
  /* ── the gap ── */
  { x: 2.04, y: 0.46, w: 0.34 },
  { x: 2.52, y: 0.28, w: 0.3 },
]

/**
 * Five things to go and get.
 *
 * ⚠️ PLACED AGAINST THE COURSE, not scattered at random. Two sit on the floor where anybody
 * can have them, two on ledges so you have to climb, and one out past the end of the top ledge
 * where you have to leave the ground and still be going when you arrive. Random placement makes a
 * level that is different every time and interesting none of them.
 *
 * ⚠️ NONE OF THEM IS GATED BY WHAT A CREATURE CAN DO, and it is worth writing down why rather
 * than leaving somebody to try. Brute-forcing every jump timing from the top ledge, a plain pet
 * with no wings reaches even the highest treat — and it is not a placement that can be tuned out.
 * A pet's reach is its whole body, a fifth of the screen tall, and a plain jump from the top ledge
 * peaks at y=0.066; so anything a winged pet can get to is already inside a plain one's hitbox.
 * Gating by height needs a taller world, and gating by distance needs a gap wider than a jump,
 * which does not fit across one screen either.
 *
 * So abilities change how EASILY you go round, not whether you can: a fast creature gets between
 * them quicker, a glider recovers from a missed landing instead of starting again. Making the
 * choice of creature decide what is reachable at all is a level-design job, not a tuning one.
 */
export const TREATS: Spot[] = [
  { x: 0.34, y: FLOOR },
  { x: 0.66, y: FLOOR },
  { x: 0.19, y: 0.74 },
  { x: 0.52, y: 0.54 },
  { x: 0.97, y: 0.12 },
  { x: 1.26, y: 0.4 },
  /* ⚠️ the far side of the gap: this is the one that asks for wings */
  { x: 2.2, y: 0.46 },
  { x: 2.66, y: 0.28 },
  { x: 2.9, y: FLOOR },
]
