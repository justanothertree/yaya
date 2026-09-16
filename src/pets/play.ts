import type { Stance } from './rig'

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
export function stepBody(b: Body, input: Input, ledges: Ledge[], dt: number): Body {
  const t = Math.max(0, Math.min(0.05, dt))
  const ducking = input.down && b.onGround
  const want = (input.right ? 1 : 0) - (input.left ? 1 : 0)
  const top = ducking ? TUNE.crouchSpeed : TUNE.speed

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
  if (input.jump && (b.onGround || fell < TUNE.coyote)) vy = -TUNE.jump
  else vy += TUNE.gravity * (vy > 0 ? TUNE.fallBoost : 1) * t
  vy = Math.min(TUNE.maxFall, vy)

  const x = Math.max(0.02, Math.min(0.98, b.x + vx * t))
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

/** A little course: three ledges you can climb, reachable in order from the floor. */
export const COURSE: Ledge[] = [
  { x: 0.08, y: 0.74, w: 0.22 },
  { x: 0.4, y: 0.54, w: 0.24 },
  { x: 0.72, y: 0.34, w: 0.2 },
]
