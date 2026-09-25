import { describe, expect, it } from 'vitest'
import {
  CAM,
  camWant,
  depthOf,
  easeTo,
  farFrom,
  holdInPark,
  MARKS,
  onScreen,
  PARK,
  restingWalker,
  stepCam,
  stepWalker,
  STILL,
  TELEPORT,
  TUNE,
  VIEW,
  walkEffort,
  SQUASH,
  type Steer,
  type Walker,
} from './walk'
import { ASPECT } from './strike'

/** the world in the one unit both axes can be compared in — screen-heights */
const WIDE = PARK.across * ASPECT
const TALL = PARK.down
/** how far something actually travelled, rather than how far its two numbers changed */
const wentFrom = (from: { x: number; y: number }, w: Walker) =>
  Math.hypot((w.x - from.x) * WIDE, (w.y - from.y) * TALL)
const speedOf = (w: Walker) => Math.hypot(w.vx * WIDE, w.vy * TALL)

/**
 * Walking about, and what the camera does while you do.
 *
 * ⚠️ THE CAMERA WAS BEHIND, WHICH IS THE WRONG WAY ROUND, and the note on CAM records what it
 * cost: an eased follow settles at v/k behind whatever it chases, so a creature at top speed sat
 * 5.4% of a screen BACK from the middle — drifting towards the edge it was walking at, showing
 * least of the direction it was going. That is the opposite of what a top-down game wants, and
 * it is the kind of thing that is felt long before it is noticed.
 */

const press = (over: Partial<Steer> = {}): Steer => ({ ...STILL, ...over })

const run = (w: Walker, steer: Steer, seconds: number, dt = 1 / 120, speed = 1) => {
  let now = w
  for (let t = 0; t < seconds; t += dt) now = stepWalker(now, steer, dt, speed)
  return now
}

describe('walking', () => {
  it('goes the way it is steered', () => {
    expect(run(restingWalker(0.5, 0.5), press({ right: true }), 1).x).toBeGreaterThan(0.5)
    expect(run(restingWalker(0.5, 0.5), press({ left: true }), 1).x).toBeLessThan(0.5)
    expect(run(restingWalker(0.5, 0.5), press({ down: true }), 1).y).toBeGreaterThan(0.5)
    expect(run(restingWalker(0.5, 0.5), press({ up: true }), 1).y).toBeLessThan(0.5)
  })

  it('and stands still when nothing is held', () => {
    const after = run(restingWalker(0.5, 0.5), STILL, 1)
    expect(after.x).toBeCloseTo(0.5, 6)
    expect(after.y).toBeCloseTo(0.5, 6)
    expect(after.moving).toBe(false)
  })

  /**
   * ⚠️ UP AND DOWN IS DELIBERATELY A LITTLE SLOWER, and SQUASH says so out loud: it is
   * (across/down) × ASPECT × 0.82, where everything but the 0.82 is the shape of the world and
   * the 0.82 is the choice — "a little slower up and down still reads as a field you are
   * looking down at". Measured through painted distance rather than through SQUASH itself.
   */
  it('and walking up the screen is 0.82 of walking across it', () => {
    const from = { x: 0.5, y: 0.5 }
    const across = wentFrom(from, run(restingWalker(0.5, 0.5), press({ right: true }), 3))
    const down = wentFrom(from, run(restingWalker(0.5, 0.5), press({ down: true }), 3))
    expect(down / across).toBeCloseTo(0.82, 1)
    expect(SQUASH).toBeCloseTo((PARK.across / PARK.down) * ASPECT * 0.82, 10)
  })

  /**
   * ⚠️ AND HOLDING TWO DIRECTIONS IS FASTER THAN ONE, WHICH IS A FINDING. This is the
   * oldest bug in top-down movement — two full-speed vectors added give you 1.41x along the
   * diagonal — and stepWalker plainly means to avoid it: it normalises the steer the moment
   * `len > 1`, which has no other purpose. But the normalisation only reaches the ACCELERATION
   * term; the speed CAP handed to `pull` stays the full `top` on each axis, so both axes ramp
   * up more gently and then arrive at full speed anyway.
   *
   * Measured in screen-heights a second, over three seconds at 240 frames: straight 0.3392,
   * diagonal 0.4387 — 1.29x. Not the full 1.41 only because SQUASH makes the vertical 0.82 of
   * the horizontal.
   *
   * ⚠️ AND THE OBVIOUS FIX OVERSHOOTS, which is why this is a finding and not a patch.
   * Scaling the cap by the wish as well as the acceleration — the one-liner — was tried and
   * measured: it lands the diagonal at 0.914x straight, not 1.0. Because SQUASH deliberately
   * makes the vertical 0.82 of the horizontal, capping both axes at 0.707 gives
   * hypot(1, 0.82) × 0.707 = 0.914, so "normalise the steer" and "the diagonal is as fast as
   * walking across" stop being the same instruction the moment the two axes are not equal.
   *
   * Which of those two the park wants is a question about feel, not a bug with an answer — and
   * how fast you cross the park is the most-felt number in the game, with two directions held
   * most of the time. So this asserts what IS, and turns red the day somebody decides.
   */
  it('though holding two directions is currently about 1.3x faster than one', () => {
    const straight = run(restingWalker(0.5, 0.5), press({ right: true }), 3, 1 / 240)
    const diagonal = run(restingWalker(0.5, 0.5), press({ right: true, down: true }), 3, 1 / 240)
    const ratio = speedOf(diagonal) / speedOf(straight)
    expect(ratio, `diagonal is ${ratio.toFixed(3)}x straight`).toBeGreaterThan(1.2)
    expect(ratio).toBeLessThan(Math.SQRT2)
  })

  it('and the steer IS normalised, which is what says the speed-up is unintended', () => {
    /* a diagonal accelerates more gently than a straight line: that is the normalisation
       working on the ramp. It is only the cap it never reaches. */
    const one = stepWalker(restingWalker(0.5, 0.5), press({ right: true }), 1 / 240)
    const two = stepWalker(restingWalker(0.5, 0.5), press({ right: true, down: true }), 1 / 240)
    expect(Math.abs(two.vx)).toBeLessThan(Math.abs(one.vx))
  })

  /**
   * ⚠️ AND IT HAS WEIGHT, which is most of what "it does not feel smooth" meant. At the old
   * numbers a creature reached top speed in 0.104s and stopped dead in 0.058s — a sprite being
   * teleported rather than movement with mass.
   */
  it('and takes a moment to get going rather than snapping to speed', () => {
    const one = stepWalker(restingWalker(0.5, 0.5), press({ right: true }), 1 / 120)
    const top = run(restingWalker(0.5, 0.5), press({ right: true }), 2)
    expect(Math.abs(one.vx)).toBeLessThan(Math.abs(top.vx) * 0.5)
  })

  it('and a moment to stop', () => {
    const moving = run(restingWalker(0.5, 0.5), press({ right: true }), 2)
    const letGo = stepWalker(moving, STILL, 1 / 120)
    expect(Math.abs(letGo.vx)).toBeGreaterThan(0)
    expect(Math.abs(letGo.vx)).toBeLessThan(Math.abs(moving.vx))
  })

  it('and tops out at the speed it is tuned to, in screenfuls a second', () => {
    const top = run(restingWalker(0.5, 0.5), press({ right: true }), 3)
    expect(Math.abs(top.vx) / VIEW.w).toBeCloseTo(TUNE.speed, 2)
  })

  it('and a faster creature is faster', () => {
    const plain = run(restingWalker(0.2, 0.5), press({ right: true }), 2, 1 / 120, 1)
    const quick = run(restingWalker(0.2, 0.5), press({ right: true }), 2, 1 / 120, 1.4)
    expect(quick.x).toBeGreaterThan(plain.x)
  })

  it('and faces the way it moved, not the way it is pressed', () => {
    const right = run(restingWalker(0.5, 0.5), press({ right: true }), 0.5)
    expect(right.facing).toBe(1)
    /* let go: it keeps facing where it last went rather than flipping to neutral */
    expect(stepWalker(right, STILL, 1 / 120).facing).toBe(1)
  })

  it('and the same walk at any frame length ends up in the same place', () => {
    const slow = run(restingWalker(0.2, 0.5), press({ right: true }), 2, 1 / 60)
    const fast = run(restingWalker(0.2, 0.5), press({ right: true }), 2, 1 / 240)
    expect(Math.abs(slow.x - fast.x)).toBeLessThan(0.01)
  })
})

describe('the edges of the park', () => {
  it('hold you inside it', () => {
    for (const [x, y] of [
      [-5, 0.5],
      [9, 0.5],
      [0.5, -2],
      [0.5, 4],
    ]) {
      const held = holdInPark(x, y)
      expect(held.x).toBeGreaterThanOrEqual(0)
      expect(held.x).toBeLessThanOrEqual(1)
      expect(held.y).toBeGreaterThanOrEqual(0)
      expect(held.y).toBeLessThanOrEqual(1)
    }
  })

  it('and leave the middle alone', () => {
    const held = holdInPark(0.5, 0.5)
    expect(held.x).toBeCloseTo(0.5, 6)
    expect(held.y).toBeCloseTo(0.5, 6)
  })

  /**
   * ⚠️ MARGINS ARE A FRACTION OF A SCREEN, CONVERTED — an inset in world units would be three
   * times as generous in a three-screen park as it was in a one-screen one.
   */
  it('and keep you a little clear of the very edge', () => {
    expect(holdInPark(-5, -5).x).toBeGreaterThan(0)
    expect(holdInPark(9, 9).x).toBeLessThan(1)
  })

  it('and walking at a wall does not push you out of the world', () => {
    const far = run(restingWalker(0.5, 0.5), press({ right: true, down: true }), 30)
    expect(far.x).toBeLessThanOrEqual(1)
    expect(far.y).toBeLessThanOrEqual(1)
  })
})

describe('the camera', () => {
  /**
   * ⚠️ IT LOOKS AHEAD, AND THAT IS THE FIX. `lead` is seconds of travel, so a creature moving
   * has the frame biased towards where it is going rather than where it has been.
   */
  it('leads a moving creature rather than trailing it', () => {
    const still = { ...restingWalker(0.5, 0.5), vx: 0, vy: 0 }
    const going = { ...restingWalker(0.5, 0.5), vx: TUNE.speed * VIEW.w, vy: 0 }
    const parked = stepCam(camWant(still), still, 1 / 60, true)
    const ahead = stepCam(camWant(going), going, 1 / 60, true)
    expect(ahead.x).toBeGreaterThan(parked.x)
    expect(CAM.lead).toBeGreaterThan(0)
  })

  it('and never shows anything outside the park', () => {
    for (const [x, y] of [
      [0, 0],
      [1, 1],
      [0.5, 0.5],
      [-1, 5],
    ]) {
      const cam = camWant({ x, y })
      expect(cam.x).toBeGreaterThanOrEqual(0)
      expect(cam.y).toBeGreaterThanOrEqual(0)
      expect(cam.x + VIEW.w).toBeLessThanOrEqual(1 + 1e-9)
      expect(cam.y + VIEW.h).toBeLessThanOrEqual(1 + 1e-9)
    }
  })

  it('and puts somebody in the middle of the frame when it can', () => {
    const me = { x: 0.5, y: 0.5 }
    const cam = camWant(me)
    const p = onScreen(me, cam)
    expect(p.x).toBeCloseTo(0.5, 6)
    expect(p.y).toBeCloseTo(0.5, 6)
  })

  it('and eases towards where it wants to be rather than snapping', () => {
    const me = { ...restingWalker(0.8, 0.8), vx: 0, vy: 0 }
    const from = { x: 0, y: 0 }
    const one = stepCam(from, me, 1 / 60, false)
    const want = camWant(me)
    expect(one.x).toBeGreaterThan(from.x)
    expect(one.x).toBeLessThan(want.x)
  })

  it('and goes straight there when asked to be still', () => {
    const me = { ...restingWalker(0.8, 0.8), vx: 0, vy: 0 }
    expect(stepCam({ x: 0, y: 0 }, me, 1 / 60, true)).toEqual(camWant(me))
  })

  it('and catching up takes longer from further away', () => {
    const me = { ...restingWalker(0.5, 0.5), vx: 0, vy: 0 }
    const near = stepCam({ x: 0.3, y: 0.3 }, me, 1 / 60, false)
    const far = stepCam({ x: 0, y: 0 }, me, 1 / 60, false)
    expect(near.x - 0.3).toBeLessThan(far.x - 0)
  })
})

describe('reading a position on screen', () => {
  it('is 0 to 1 across the frame', () => {
    const cam = { x: 0.3, y: 0.3 }
    const p = onScreen({ x: 0.3, y: 0.3 }, cam)
    expect(p.x).toBeCloseTo(0, 6)
    const q = onScreen({ x: 0.3 + VIEW.w, y: 0.3 + VIEW.h }, cam)
    expect(q.x).toBeCloseTo(1, 6)
    expect(q.y).toBeCloseTo(1, 6)
  })

  it('and goes negative for something behind the frame', () => {
    expect(onScreen({ x: 0.1, y: 0.5 }, { x: 0.3, y: 0.3 }).x).toBeLessThan(0)
  })
})

describe('how hard the legs are working', () => {
  it('is nothing when standing still and asked to be quiet', () => {
    expect(walkEffort(restingWalker(0.5, 0.5), true)).toBe(0)
  })

  /**
   * ⚠️ MOTION YOU CAUSED IS NOT MOTION THAT HAPPENS AT YOU, which is the split the playground
   * makes too: walking is the thing you came to do, so it is untouched by reduced motion.
   */
  it('but walking still works the legs even then', () => {
    const going = { ...restingWalker(0.5, 0.5), vx: TUNE.speed * VIEW.w }
    expect(walkEffort(going, true)).toBeGreaterThan(0)
  })

  it('and faster legs go faster', () => {
    const slow = { ...restingWalker(0.5, 0.5), vx: TUNE.speed * VIEW.w * 0.3 }
    const fast = { ...restingWalker(0.5, 0.5), vx: TUNE.speed * VIEW.w }
    expect(walkEffort(fast, false)).toBeGreaterThan(walkEffort(slow, false))
  })
})

describe('the odds and ends the room leans on', () => {
  /* ⚠️ it eases a SPOT, and dt comes before the rate — I had both the wrong way round */
  it('easeTo arrives rather than creeping forever', () => {
    let at = { x: 0, y: 0 }
    const to = { x: 1, y: 1 }
    for (let i = 0; i < 400; i++) at = easeTo(at, to, 1 / 60)
    expect(at.x).toBeCloseTo(1, 4)
    expect(at.y).toBeCloseTo(1, 4)
  })

  it('and never overshoots what it is easing towards', () => {
    let at = { x: 0, y: 0 }
    const to = { x: 1, y: 1 }
    for (let i = 0; i < 400; i++) {
      at = easeTo(at, to, 1 / 60)
      expect(at.x).toBeLessThanOrEqual(1 + 1e-9)
    }
  })

  /**
   * ⚠️ AND IT IS FRAMERATE-INDEPENDENT — 1 - e^(-k·t), not a fixed fraction per frame,
   * or peers glide at different speeds on different machines.
   */
  it('and gets to the same place whatever the frame length', () => {
    const chase = (dt: number) => {
      let at = { x: 0, y: 0 }
      for (let t = 0; t < 0.5; t += dt) at = easeTo(at, { x: 1, y: 1 }, dt)
      return at.x
    }
    expect(Math.abs(chase(1 / 60) - chase(1 / 240))).toBeLessThan(0.02)
  })

  /**
   * ⚠️ A JUMP RATHER THAN A GLIDE PAST SOME DISTANCE, so a peer whose packet was lost does not
   * sail smoothly across the whole park when the next one arrives.
   */
  it('and farFrom knows when something has moved too far to have walked', () => {
    expect(farFrom({ x: 0.5, y: 0.5 }, { x: 0.5 + TELEPORT * 2, y: 0.5 })).toBe(true)
    expect(farFrom({ x: 0.5, y: 0.5 }, { x: 0.5 + TELEPORT * 0.1, y: 0.5 })).toBe(false)
  })

  it('and depth is how far down the screen you are, so nearer is in front', () => {
    expect(depthOf({ x: 0.5, y: 0.9 })).toBeGreaterThan(depthOf({ x: 0.5, y: 0.1 }))
  })

  it('and the built-in park has landmarks, all of them inside it', () => {
    expect(MARKS.length).toBeGreaterThan(0)
    for (const m of MARKS) {
      expect(m.at.x).toBeGreaterThanOrEqual(0)
      expect(m.at.x).toBeLessThanOrEqual(1)
      expect(m.at.y).toBeGreaterThanOrEqual(0)
      expect(m.at.y).toBeLessThanOrEqual(1)
      expect(m.size).toBeGreaterThan(0)
      expect(m.name.length).toBeGreaterThan(0)
    }
  })

  it('and no two landmarks share a name, because a Mark is keyed by one', () => {
    const names = MARKS.map((m) => m.name)
    expect(new Set(names).size).toBe(names.length)
  })

  it('and the world is the shape the rest of the code believes it is', () => {
    expect(VIEW.w).toBeCloseTo(1 / PARK.across, 10)
    expect(VIEW.h).toBeCloseTo(1 / PARK.down, 10)
  })
})
