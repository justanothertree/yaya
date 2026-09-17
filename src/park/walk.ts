import { PET_TALL } from '../pets/play'

/**
 * Walking about a park, seen from above.
 *
 * ⚠️ A SIBLING OF play.ts, NOT A REUSE OF IT. The platformer's step is the right shape for a
 * side-on world and the wrong one for this: there is no gravity here, no jump, no ledge and no
 * floor, and "up" is a direction you walk rather than one you fall from. Sharing stepBody would
 * have meant a gravity of zero, a jump nobody presses and a ledge list that is always empty —
 * a function pretending to be two functions. What they DO share is the unit and the feel: 0–1
 * across and down, speeds in world-widths per second, the same acceleration-and-drag shape, so
 * a creature walking here moves like the same creature walking there.
 *
 * ⚠️ PURE, LIKE ITS SIBLINGS, because requestAnimationFrame never fires in the browser pane —
 * and because this one has a second reason: everything here also has to run against positions
 * that arrived over a network, from a person on another machine at an unknown moment. Being
 * able to ask "where is this peer, 140ms after their last packet" without a browser is what
 * makes that testable at all.
 */

export type Spot = { x: number; y: number }

export type Walker = {
  x: number
  y: number
  vx: number
  vy: number
  /** -1 left, 1 right — the last way it actually moved, so a still creature keeps facing */
  facing: number
  /** true while it is actually going somewhere, for the run cycle */
  moving: boolean
}

export type Steer = { left: boolean; right: boolean; up: boolean; down: boolean }

export const STILL: Steer = { left: false, right: false, up: false, down: false }

/**
 * ⚠️ THE CORRECTION WAS THE WRONG WAY ROUND, and it was reported as walking through quicksand
 * going up and down. The field is 16:10, so one unit of y is a SHORTER distance on screen than
 * one unit of x — which means the same number moves you visibly SLOWER up the screen, not faster.
 * The old note here reasoned that out backwards and then slowed y by a further 0.62 on top, so
 * north ended up about two and a half times slower than east to look at.
 *
 * So the number is built rather than picked. `aspect` undoes the shape of the box; the 0.82 is
 * the part that is a choice — a little slower up and down still reads as a field you are looking
 * down at rather than a flat grid, and it is gentle enough not to feel like being held back.
 */
const ASPECT = 16 / 10

export const PARK = {
  /** what vertical speed is multiplied by, so up and down reads right on screen */
  squash: ASPECT * 0.82,
  /** a creature stands this tall; the park's own bounds keep its feet on the grass */
  tall: PET_TALL,
}

export const TUNE = {
  speed: 0.38,
  accel: 3.4,
  drag: 6.5,
  /** below this it is standing still, not creeping */
  quiet: 0.012,
}

export const restingWalker = (x = 0.5, y = 0.6): Walker => ({
  x,
  y,
  vx: 0,
  vy: 0,
  facing: 1,
  moving: false,
})

/**
 * One step.
 *
 * ⚠️ EIGHT WAYS, AND A DIAGONAL IS NOT FASTER. Pressing two keys adds two full-speed vectors,
 * which is how every naive top-down game ends up with a diagonal that is 41% quicker than any
 * straight line — the one bug in this genre everybody ships once. The wish is normalised before
 * it is used.
 *
 * @param dt seconds, clamped for the same reason play.ts clamps it: a backgrounded tab hands
 * you several seconds at once, and a creature that teleports is worse than one that stutters.
 */
export function stepWalker(w: Walker, steer: Steer, dt: number, speed = 1): Walker {
  const t = Math.max(0, Math.min(0.05, dt))
  let wx = (steer.right ? 1 : 0) - (steer.left ? 1 : 0)
  let wy = (steer.down ? 1 : 0) - (steer.up ? 1 : 0)
  const len = Math.hypot(wx, wy)
  if (len > 1) {
    wx /= len
    wy /= len
  }

  const top = TUNE.speed * speed
  const pull = (v: number, want: number, cap: number) => {
    if (want !== 0) {
      const next = v + want * TUNE.accel * t
      return Math.max(-cap, Math.min(cap, next))
    }
    /* towards zero rather than multiplied, so it arrives — see the same note in play.ts */
    const drop = TUNE.drag * t
    return Math.abs(v) <= drop ? 0 : v - Math.sign(v) * drop
  }

  const vx = pull(w.vx, wx, top)
  const vy = pull(w.vy, wy, top * PARK.squash)

  /* ⚠️ half a creature in from every edge, measured in the axis it applies to: the park is
     wider than it is tall, so the same inset in x and y would not look like the same margin */
  const padX = 0.03
  const x = Math.max(padX, Math.min(1 - padX, w.x + vx * t))
  const y = Math.max(PARK.tall * 0.6, Math.min(0.97, w.y + vy * t))

  return {
    x,
    y,
    vx,
    vy,
    facing: vx > TUNE.quiet ? 1 : vx < -TUNE.quiet ? -1 : w.facing,
    moving: Math.hypot(vx, vy) > TUNE.quiet,
  }
}

/**
 * How fast the creature's own clock runs, so its legs match the ground.
 *
 * ⚠️ MOTION YOU CAUSED IS NOT MOTION THAT HAPPENS AT YOU, the same split the playground makes:
 * a creature standing still stands still when somebody has asked for less movement, and walking
 * is untouched, because walking is the thing you came to do.
 */
export const walkEffort = (w: Walker, still: boolean): number => {
  const speed = Math.hypot(w.vx, w.vy)
  if (still && speed < TUNE.quiet) return 0
  return 0.35 + (speed / TUNE.speed) * 1.3
}

/**
 * Where a peer is right now, given where they last said they were.
 *
 * ⚠️ NOBODY ELSE'S POSITION ARRIVES SIXTY TIMES A SECOND. Fifteen packets a second against
 * sixty frames means three frames in four have no news, and drawing the last packet on all of
 * them is a peer that jerks forward and stops, forward and stops — the single thing that makes
 * a networked game look broken when nothing is wrong with it. Easing towards the last known
 * position spreads that gap over the frames that have nothing to say.
 *
 * ⚠️ IT EASES, IT DOES NOT PREDICT. Extrapolating along their last velocity looks smoother right
 * up to the moment somebody stops or turns, and then it walks them through a wall and snaps them
 * back. Being a fraction of a second behind the truth is the cheaper lie.
 *
 * ⚠️ AND IT IS FRAMERATE-INDEPENDENT: 1 - e^(-k·t), not a fixed fraction per frame, or peers
 * glide at different speeds on different machines. Same shape as the playground's camera.
 */
export function easeTo(shown: Spot, target: Spot, dt: number, rate = 14): Spot {
  const k = 1 - Math.exp(-rate * Math.max(0, Math.min(0.05, dt)))
  return { x: shown.x + (target.x - shown.x) * k, y: shown.y + (target.y - shown.y) * k }
}

/**
 * A long way from where we thought: stop easing and just be there.
 *
 * ⚠️ A RECONNECT, A TAB WAKING UP, OR SOMEBODY ARRIVING is not a walk, and easing across the
 * whole park at walking pace shows a creature sliding through everything in between for a
 * second and a half. Beyond a third of the park it is not a journey anybody made.
 */
export const TELEPORT = 0.33

export const farFrom = (a: Spot, b: Spot): boolean => Math.hypot(a.x - b.x, a.y - b.y) > TELEPORT

/**
 * Who is in front of whom.
 *
 * ⚠️ FEET, NOT MIDDLES. In a top-down world the thing lower on the screen is nearer the camera,
 * and a creature's y is where it stands — so sorting by y is the whole of the depth problem, and
 * sorting by anything else puts a creature standing behind a bench in front of it.
 */
export const depthOf = (w: Spot): number => Math.round(w.y * 10000)
