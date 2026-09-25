import { describe, expect, it } from 'vitest'
import {
  aloft,
  DODGE,
  HOP,
  overHead,
  PARK_TALL,
  restingStriker,
  stepAir,
  stepDodge,
  type Striker,
} from './strike'
import { restingWalker } from './walk'
import type { Attack } from '../pets/attack'
import { canSee, inWall, slideAround, SOLID, wallOf } from './solid'

/**
 * Jumping, dodging and bumping into things.
 *
 * ⚠️ THE PARK'S ANIMATION FRAME DOES NOT FIRE IN THE BROWSER PANE, which is the reason every
 * one of these functions is pure and the reason none of them was ever checked. A jump arc, a
 * dodge's reach and the shape of a wall are all answerable with arithmetic; for a long time
 * the only way anybody asked was by playing.
 */

const standing = (over: Partial<Striker> = {}): Striker => ({
  ...restingStriker(restingWalker(0.5, 0.5)),
  ...over,
})

/** run a jump to its landing and report what it did, at whatever frame length */
const jump = (dt: number, hold = false, s = standing()) => {
  let now = { ...s }
  let peak = 0
  let time = 0
  let air = stepAir(now, true, dt, hold, 0)
  now = air.s
  for (let i = 0; i < 5000; i++) {
    air = stepAir(now, false, dt, hold, 0)
    now = air.s
    time += dt
    peak = Math.max(peak, now.up)
    if (air.landed) break
  }
  return { peak, time, s: now }
}

describe('a landing is noticed however the arc lands', () => {
  /**
   * ⚠️ THE ONE THE TESTS FOUND. A jump lasts exactly HOP.time, so at 60, 120 or 240
   * frames a second the arc reaches the floor precisely on a frame boundary — and aloft()
   * stopped calling it airborne a hair BEFORE stepAir's own landing branch could report it.
   * It sat at up=0 with vz=-4.96 forever, `landed` never fired, and `dive` was never cleared,
   * which is what stops a second dive.
   */
  it.each([1 / 60, 1 / 120, 1 / 240, 1 / 90, 0.017])('at dt %s', (dt) => {
    const flight = jump(dt)
    expect(flight.time).toBeLessThan(HOP.time + 0.1)
    expect(flight.s.vz).toBe(0)
    expect(flight.s.dive).toBe(false)
    expect(aloft(flight.s)).toBe(false)
  })

  /**
   * ⚠️ THIS ONE IS THE ORDINARY PATH, AND IT SAYS SO. Two earlier versions of it
   * claimed to cover the boundary case and did not: the first jumped, and the jump path clears
   * `dive` on its own; the second fell from a height that lands through the normal branch. The
   * boundary is covered by the parameterised test above, which reds at exactly 1/60, 1/120 and
   * 1/240 without the fix. What is left here is worth keeping on its own — a dive has to clear
   * when you arrive, or diveNow refuses the next one forever — so it stays, honestly labelled.
   */
  it('and a dive clears when you land, so the next one is allowed', () => {
    const dt = 1 / 120
    let s = standing({ dive: true, vz: -HOP.drop, up: 0.62 })
    for (let i = 0; i < 2000; i++) {
      const air = stepAir(s, false, dt, false, 0)
      s = air.s
      if (air.landed) break
    }
    expect(s.dive, 'a dive flag left set refuses the next dive').toBe(false)
    expect(s.vz).toBe(0)
    expect(aloft(s)).toBe(false)
  })
})

describe('a jump is the same jump however fast the machine draws', () => {
  /**
   * ⚠️ THIS IS WHY stepAir USES THE CLOSED FORM RATHER THAN EULER. `up += vz * t` after
   * updating vz undershoots the top of the arc by an amount that depends on the frame length —
   * 0.610 against 0.620 at 240 a second, worse at 60 — which would make how high you jump
   * depend on the machine. And `clear` is a HEIGHT, so that is the difference between a swing
   * passing under you and not.
   */
  it('so its peak is HOP.up at 60, at 144 and at 240 a second', () => {
    const slow = jump(1 / 60).peak
    const mid = jump(1 / 144).peak
    const fast = jump(1 / 240).peak
    for (const [name, got] of [
      ['60', slow],
      ['144', mid],
      ['240', fast],
    ] as const) {
      expect(Math.abs(got - HOP.up), `peak at ${name}fps: ${got}`).toBeLessThan(0.01)
    }
    expect(Math.abs(slow - fast)).toBeLessThan(0.005)
  })

  it('and it takes about as long as HOP.time says', () => {
    expect(Math.abs(jump(1 / 120).time - HOP.time)).toBeLessThan(0.05)
  })

  it('and it spends most of that above the height that clears a low swing', () => {
    const dt = 1 / 240
    let now = stepAir(standing(), true, dt, false, 0).s
    let clear = 0
    for (let i = 0; i < 5000; i++) {
      const air = stepAir(now, false, dt, false, 0)
      now = air.s
      if (now.up >= HOP.clear) clear += dt
      if (air.landed) break
    }
    expect(clear).toBeGreaterThan(0.3)
    expect(clear).toBeLessThan(HOP.time)
  })

  it('and a better jumper goes higher, by the trait and not by its square', () => {
    /* traitsOf means "26% higher", so the launch speed goes up by the ROOT of the trait —
       the note on LEAP. A trait applied straight would give 1.59x here. */
    const plain = jump(1 / 240).peak
    const springy = jump(1 / 240, false, standing({ jump: 1.26 })).peak
    expect(springy / plain).toBeCloseTo(1.26, 1)
  })
})

describe('you cannot jump out of', () => {
  it.each([
    ['a swing', { swing: 0.3 }],
    ['a stun', { stun: 0.3 }],
    ['a hold', { hold: 0.3 }],
    ['a dodge', { dodge: 0.2 }],
    ['a stance', { braced: true }],
  ])('%s', (_what, over) => {
    const air = stepAir(standing(over as Partial<Striker>), true, 1 / 60, false, 0)
    expect(air.went).toBe(false)
    expect(aloft(air.s)).toBe(false)
  })

  /**
   * ⚠️ AND THE FLOOR AFTER LANDING IS SHORT ENOUGH NOT TO BE FELT. It was half a second —
   * as long as the whole jump — which is one jump a second and a refusal every time you
   * pressed again on landing. A jump is an EDGE, so holding the key has never repeated; what
   * is left for this to do is stop the landing frame producing a second jump.
   */
  /**
   * ⚠️ WAITED OUT IN REAL FRAMES, because both stepAir and stepDodge clamp dt to 0.05.
   * The first version of this handed them `HOP.rest + 0.01` in one step to fast-forward the
   * cooldown, which arrives as 0.05 and does almost nothing — a test that would have called a
   * broken cooldown broken and a working one broken too.
   */
  it('and the rest after landing is a couple of frames, not half a second', () => {
    expect(HOP.rest).toBeLessThan(0.15)
    const landed = jump(1 / 240).s
    expect(landed.hopRest).toBeGreaterThan(0)
    /* still held one frame after touching down */
    expect(stepAir(landed, true, 1 / 240, false, 0).went).toBe(false)
    /* and free again a hair after HOP.rest, counted out at a real frame length */
    let s = landed
    for (let t = 0; t < HOP.rest + 0.02; t += 1 / 240) s = stepAir(s, false, 1 / 240, false, 0).s
    expect(stepAir(s, true, 1 / 240, false, 0).went).toBe(true)
  })
})

describe('what a jump answers', () => {
  const swing = (lift: number): Attack => ({
    name: 'x',
    from: 'body',
    span: 0.5,
    live: [0.2, 0.3],
    reach: 1,
    rise: 0,
    bite: 1,
    shove: 0,
    lift,
    rest: 0,
  })

  it('a low swing passes underneath once you are clear of the floor', () => {
    const up = standing({ up: HOP.clear })
    expect(overHead(up, swing(HOP.under))).toBe(true)
  })

  it('and one drawn higher than that does not', () => {
    const up = standing({ up: HOP.clear })
    expect(overHead(up, swing(HOP.under + 0.2))).toBe(false)
  })

  it('and standing on the floor answers nothing', () => {
    expect(overHead(standing(), swing(HOP.under))).toBe(false)
  })
})

describe('a dodge', () => {
  const roll = (aim = { x: 1, y: 0 }) => {
    let s = stepDodge(standing(), true, aim, 1 / 240).s
    for (let i = 0; i < 2000 && s.dodge > 0; i++) s = stepDodge(s, false, aim, 1 / 240).s
    return s
  }

  it('covers DODGE.reach creatures, and it is 1.3 not 8', () => {
    /* the bug this replaced: pet-heights used as screen-heights put the roll 5.5x too far,
       a dodge that crossed most of the field. Measured back through the world's own shape. */
    const s = roll()
    const wentPet = ((s.x - 0.5) * 3 * 1.6) / PARK_TALL
    expect(wentPet).toBeCloseTo(DODGE.reach, 1)
    expect(wentPet).toBeLessThan(2)
  })

  it('and goes where it is aimed, not where you are facing', () => {
    expect(roll({ x: -1, y: 0 }).x).toBeLessThan(0.5)
    expect(roll({ x: 0, y: 1 }).y).toBeGreaterThan(0.5)
  })

  it('and most of the ground goes early, so it snaps out and settles', () => {
    const dt = 1 / 240
    let s = stepDodge(standing(), true, { x: 1, y: 0 }, dt).s
    const start = s.dodge
    let half = 0
    for (let i = 0; i < 2000 && s.dodge > 0; i++) {
      s = stepDodge(s, false, { x: 1, y: 0 }, dt).s
      if (half === 0 && s.dodge <= start / 2) half = s.x - 0.5
    }
    expect(half / (s.x - 0.5)).toBeGreaterThan(0.6)
  })

  /* ⚠️ a dodge that cancelled a recovery would make every attack safe, which is the one thing
     the whole fight is built on not being */
  it('and cannot be used to cancel a swing, a stun or a hold', () => {
    for (const over of [{ swing: 0.3 }, { stun: 0.3 }, { hold: 0.3 }]) {
      expect(stepDodge(standing(over), true, { x: 1, y: 0 }, 1 / 60).went).toBe(false)
    }
  })

  it('and has to be paid for before the next one', () => {
    const spent = roll()
    const aim = { x: 1, y: 0 }
    expect(spent.dodgeRest).toBeGreaterThan(0)
    expect(stepDodge(spent, true, aim, 1 / 60).went).toBe(false)
    /* counted out in frames, for the same reason as the jump above */
    let s = spent
    for (let t = 0; t < DODGE.rest + 0.02; t += 1 / 240) s = stepDodge(s, false, aim, 1 / 240).s
    expect(stepDodge(s, true, aim, 1 / 240).went).toBe(true)
  })
})

describe('a wall', () => {
  const box = { x0: 0.4, y0: 0.4, x1: 0.6, y1: 0.6 }
  const soft = wallOf(box.x0, box.y0, box.x1, box.y1, 'blob')
  const drawn = wallOf(box.x0, box.y0, box.x1, box.y1, 'stamp', 1)

  /**
   * ⚠️ THE SHRINK IS FOR BLOBS, AND A DRAWING IS NOT A BLOB. SOLID takes a third off, which is
   * right for the park's soft-edged landmarks — stopping a creature a full radius out from a
   * smudge is stopping them at nothing visible — and wrong for a stamped picture, which has an
   * outline. Reported as being able to walk round the edges of a solid.
   */
  it('made of a drawing is solid to the edge of its own box', () => {
    expect(drawn.x0).toBeCloseTo(box.x0, 10)
    expect(drawn.x1).toBeCloseTo(box.x1, 10)
  })

  it('and one of the park own blobs keeps its two thirds', () => {
    expect(soft.x1 - soft.x0).toBeCloseTo((box.x1 - box.x0) * SOLID, 10)
    expect(soft.x0).toBeGreaterThan(box.x0)
  })

  it('and both stay centred on what was drawn', () => {
    for (const w of [soft, drawn]) {
      expect((w.x0 + w.x1) / 2).toBeCloseTo((box.x0 + box.x1) / 2, 10)
      expect((w.y0 + w.y1) / 2).toBeCloseTo((box.y0 + box.y1) / 2, 10)
    }
  })

  it('is somewhere you are inside, or not', () => {
    expect(inWall({ x: 0.5, y: 0.5 }, [drawn])).toBeTruthy()
    expect(inWall({ x: 0.2, y: 0.5 }, [drawn])).toBeNull()
    expect(inWall({ x: 0.5, y: 0.5 }, [])).toBeNull()
  })
})

describe('walking into a wall', () => {
  const wall = [wallOf(0.4, 0.3, 0.6, 0.7, 'slab', 1)]

  it('stops you outside it', () => {
    const got = slideAround({ x: 0.3, y: 0.5 }, { x: 0.5, y: 0.5 }, wall)
    expect(inWall(got, wall)).toBeNull()
    expect(got.x).toBeLessThanOrEqual(0.4)
  })

  /**
   * ⚠️ ONE AXIS AT A TIME, WHICH IS THE WHOLE POINT. Walking into a wall face-on stops you
   * dead in that axis and leaves the other untouched — so holding two directions against a
   * wall still slides you along it, which is what a person expects and what a refusal to move
   * at all would not give.
   */
  it('but sliding along it still moves you', () => {
    const got = slideAround({ x: 0.3, y: 0.4 }, { x: 0.5, y: 0.5 }, wall)
    expect(got.x).toBeLessThanOrEqual(0.4)
    expect(got.y).toBeGreaterThan(0.4)
  })

  it('and with nothing in the way it changes nothing', () => {
    const to = { x: 0.8, y: 0.2 }
    expect(slideAround({ x: 0.3, y: 0.5 }, to, [])).toEqual(to)
    expect(slideAround({ x: 0.3, y: 0.5 }, to, wall)).toEqual(to)
  })

  it('and however many overlap, you end up out of all of them', () => {
    const pile = [
      wallOf(0.4, 0.3, 0.6, 0.7, 'a', 1),
      wallOf(0.45, 0.35, 0.65, 0.75, 'b', 1),
      wallOf(0.5, 0.4, 0.7, 0.8, 'c', 1),
    ]
    const got = slideAround({ x: 0.2, y: 0.2 }, { x: 0.55, y: 0.5 }, pile)
    expect(inWall(got, pile)).toBeNull()
  })
})

describe('seeing past a wall', () => {
  const wall = [wallOf(0.45, 0.3, 0.55, 0.7, 'screen', 1)]

  it('is blocked when it is between you', () => {
    expect(canSee({ x: 0.2, y: 0.5 }, { x: 0.8, y: 0.5 }, wall)).toBe(false)
  })

  it('and clear when it is not', () => {
    expect(canSee({ x: 0.2, y: 0.1 }, { x: 0.8, y: 0.1 }, wall)).toBe(true)
    expect(canSee({ x: 0.2, y: 0.5 }, { x: 0.4, y: 0.5 }, wall)).toBe(true)
  })

  it('and always clear with nothing in the way', () => {
    expect(canSee({ x: 0, y: 0 }, { x: 1, y: 1 }, [])).toBe(true)
  })

  /* ⚠️ a box does not get in the way of itself — the note canSee carries */
  it('and standing inside one does not blind you to yourself', () => {
    expect(canSee({ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 }, wall)).toBe(true)
  })
})
