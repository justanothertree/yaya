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

/**
 * How big the park is, and what one screenful of it is.
 *
 * ⚠️ A POSITION IS STILL 0–1, AND THAT IS THE WHOLE REASON THIS NEEDED NO NEW PROTOCOL. Growing
 * the world could have meant zone ids on the wire and a relay that knows about them; instead
 * 0–1 simply stops meaning "across the screen" and starts meaning "across the park". Every
 * message, every clamp and every validator is untouched, and an old client and a new one
 * disagree about the size of the world rather than about how to talk.
 *
 * ⚠️ AND ONE WORLD RATHER THAN ROOMS YOU STEP BETWEEN. Screen-to-screen zones are the easier
 * thing to build and the wrong thing for a park: the point of the place is seeing who is about,
 * and zones hide everybody who is not in yours. A camera keeps them on the map even when they are
 * off the edge of your window.
 */
export const PARK = {
  /** how many screenfuls the world is, across and down */
  across: 3,
  down: 3,
  /** a creature stands this tall on screen; the park's bounds keep its feet on the grass */
  tall: PET_TALL,
}

/** One screenful, in world units. */
export const VIEW = { w: 1 / PARK.across, h: 1 / PARK.down }

/**
 * Places in the park, so that nine screens of grass are somewhere rather than anywhere.
 *
 * ⚠️ A WORLD WITH NO LANDMARKS IS A WORLD WITH NO REASON TO GO ANYWHERE. The park has been
 * three screens by three since it grew, and every one of them looks exactly like the others —
 * so "the park is big" has only ever meant "the walk is long". You cannot arrange to meet
 * anybody, you cannot say where you found something, and the little map is nine identical
 * squares with dots on it. This is the first half of the thing asked for as map making and an
 * exploration game: before anywhere can be interesting, somewhere has to be distinguishable.
 *
 * ⚠️ A FIXED TABLE, NOT A SEED, because everybody has to be standing in the same park. A
 * generated layout would need the seed on the wire and agreement about the generator; a list
 * in the code is the same park on every machine for nothing, and it can be edited by hand the
 * day somebody wants to move the pond.
 *
 * ⚠️ AND THEY DECIDE NOTHING. No collision, no bonus, no spawn rule — a landmark that changed
 * the fight would be a fight you have to learn the map to win, and the map is supposed to be
 * the friendly part. They are here to be pointed at.
 */
export type Mark = {
  /** where it sits, in world units across the whole park */
  at: Spot
  /** how wide it is, as a fraction of a screenful — used for the drawing and nothing else */
  size: number
  kind: 'pond' | 'grove' | 'ring' | 'rocks'
  name: string
}

export const MARKS: Mark[] = [
  { at: { x: 0.22, y: 0.26 }, size: 0.34, kind: 'pond', name: 'the pond' },
  { at: { x: 0.76, y: 0.2 }, size: 0.3, kind: 'grove', name: 'the little wood' },
  { at: { x: 0.5, y: 0.52 }, size: 0.26, kind: 'ring', name: 'the ring' },
  { at: { x: 0.18, y: 0.78 }, size: 0.24, kind: 'rocks', name: 'the rocks' },
  { at: { x: 0.82, y: 0.74 }, size: 0.28, kind: 'grove', name: 'the far trees' },
]

/**
 * Which place you are at, or null if you are just in the grass between them.
 *
 * ⚠️ MEASURED ON SCREEN, NOT IN WORLD UNITS, for the same reason every other distance here is:
 * the field is 16:10, so a circle in world units is an ellipse to look at and "near" would mean
 * something different going north than going east.
 */
/**
 * The place nearest to somewhere, which is never null.
 *
 * ⚠️ markAt ASKS "AM I AT ONE", THIS ASKS "WHICH ONE IS THIS NEAR". Two different questions:
 * the first is for telling you where you are standing and has to be able to say "nowhere in
 * particular"; the second is for putting something somewhere nameable and must always answer.
 */
export const nearestMark = (at: Spot): Mark =>
  MARKS.reduce((best, m) => {
    const d = (o: Mark) =>
      Math.hypot((((at.x - o.at.x) / VIEW.w) * 16) / 10, (at.y - o.at.y) / VIEW.h)
    return d(m) < d(best) ? m : best
  }, MARKS[0])

export const markAt = (me: Spot): Mark | null => {
  for (const m of MARKS) {
    const dx = ((me.x - m.at.x) / VIEW.w) * (16 / 10)
    const dy = (me.y - m.at.y) / VIEW.h
    if (Math.hypot(dx, dy) <= m.size) return m
  }
  return null
}

/**
 * ⚠️ BUILT FROM THE SHAPE OF THE WORLD, not picked. Equal speed on SCREEN needs the vertical to
 * be multiplied by (across/down) × the screen's own aspect — and the 0.82 is the only part that
 * is a choice: a little slower up and down still reads as a field you are looking down at.
 */
export const SQUASH = (PARK.across / PARK.down) * ASPECT * 0.82

/**
 * ⚠️ IN SCREENFULS A SECOND, NOT WORLD UNITS. Written in world units these numbers would mean
 * something different every time the park changed size — a walk across one screen would take three
 * times as long the moment the world became three screens wide, which is the version of "bigger"
 * that just means "slower". Everything here is converted at the point of use.
 */
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
 * Keep a creature inside the park.
 *
 * ⚠️ MARGINS ARE A FRACTION OF A SCREEN, converted — an inset in world units would be three
 * times as generous in a three-screen park as it was in a one-screen one.
 *
 * ⚠️ EXPORTED because walking is no longer the only thing that moves a creature: an attack
 * can carry its owner forward now (see Attack.drive), and a second way to move with its own idea
 * of where the edges are is a second way to end up outside them.
 */
export const holdInPark = (x: number, y: number): Spot => {
  const padX = 0.03 * VIEW.w
  return {
    x: Math.max(padX, Math.min(1 - padX, x)),
    y: Math.max(PARK.tall * 0.6 * VIEW.h, Math.min(1 - 0.03 * VIEW.h, y)),
  }
}

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

  /* screenfuls a second into world units a second — see the note on TUNE */
  const per = VIEW.w
  const top = TUNE.speed * speed * per
  const pull = (v: number, want: number, cap: number, accel: number, drag: number) => {
    if (want !== 0) {
      const next = v + want * accel * t
      return Math.max(-cap, Math.min(cap, next))
    }
    /* towards zero rather than multiplied, so it arrives — see the same note in play.ts */
    const drop = drag * t
    return Math.abs(v) <= drop ? 0 : v - Math.sign(v) * drop
  }

  /* ⚠️ the ramp is scaled with the top speed, or a smaller top speed is simply reached sooner
     and a bigger park feels twitchier than a small one for no reason anybody asked for */
  const ax = TUNE.accel * per
  const dx = TUNE.drag * per
  const vx = pull(w.vx, wx, top, ax, dx)
  const vy = pull(w.vy, wy, top * SQUASH, ax * SQUASH, dx * SQUASH)

  const { x, y } = holdInPark(w.x + vx * t, w.y + vy * t)

  const quiet = TUNE.quiet * per
  return {
    x,
    y,
    vx,
    vy,
    /**
     * ⚠️ WHICH WAY YOU MEANT TO GO, NOT WHICH WAY YOU ARE TRAVELLING. These are the same
     * thing whenever you are walking, and they come apart exactly when something has thrown you:
     * a boss's shove sets a velocity pointing away from it while you are steering nothing, so
     * reading the velocity spun the creature round to face away mid-fight. Reported as "when he
     * hits me my guy turns around". A wish is 0 or ±something, so it needs no quiet threshold
     * either — coasting to a stop holds the last facing, same as before.
     */
    facing: wx > 0 ? 1 : wx < 0 ? -1 : w.facing,
    moving: Math.hypot(vx, vy) > quiet,
  }
}

/**
 * Where the window onto the world wants to be: you, in the middle of it.
 *
 * ⚠️ CLAMPED TO THE WORLD, so the edges of the park sit against the edges of the frame rather
 * than scrolling on into nothing — the same rule the platformer's camera follows, and the reason
 * walking into a corner feels like a corner.
 */
export const camWant = (me: Spot): Spot => ({
  x: Math.max(0, Math.min(1 - VIEW.w, me.x - VIEW.w / 2)),
  y: Math.max(0, Math.min(1 - VIEW.h, me.y - VIEW.h / 2)),
})

/** Where something in the world sits in the frame, as a fraction of the frame. */
export const onScreen = (at: Spot, cam: Spot): Spot => ({
  x: (at.x - cam.x) / VIEW.w,
  y: (at.y - cam.y) / VIEW.h,
})

/**
 * How fast the creature's own clock runs, so its legs match the ground.
 *
 * ⚠️ MOTION YOU CAUSED IS NOT MOTION THAT HAPPENS AT YOU, the same split the playground makes:
 * a creature standing still stands still when somebody has asked for less movement, and walking
 * is untouched, because walking is the thing you came to do.
 */
export const walkEffort = (w: Walker, still: boolean): number => {
  /* in screenfuls a second, so the legs match the ground whatever size the park is */
  const speed = Math.hypot(w.vx, w.vy) / VIEW.w
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
export const TELEPORT = 0.33 * VIEW.w

export const farFrom = (a: Spot, b: Spot): boolean => Math.hypot(a.x - b.x, a.y - b.y) > TELEPORT

/**
 * Who is in front of whom.
 *
 * ⚠️ FEET, NOT MIDDLES. In a top-down world the thing lower on the screen is nearer the camera,
 * and a creature's y is where it stands — so sorting by y is the whole of the depth problem, and
 * sorting by anything else puts a creature standing behind a bench in front of it.
 */
export const depthOf = (w: Spot): number => Math.round(w.y * 10000)
