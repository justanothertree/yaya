import { describe, expect, it } from 'vitest'
import {
  aimFromKeys,
  aimFromOctant,
  aimFromPoint,
  canBeHurt,
  GUARD,
  guarded,
  octantOf,
  parries,
  restingStriker,
  toScreen,
  type Aimed,
  type Striker,
} from './strike'
import { restingWalker } from './walk'

/**
 * Which way you are pointing, and whether a blow gets through.
 *
 * ⚠️ THE AIM IS THE ONE PIECE OF COMBAT STATE THAT CROSSES THE WIRE, and it crosses as a single
 * digit. The relay carries `d` clamped to 0..7 and the other end rebuilds a direction from it —
 * so everything a peer's swing covers, on your screen, is derived from one number somebody else
 * sent. If that round trip is lossy or the rebuilt vector is not a unit one, every hit test
 * against it is quietly scaled and nobody can see why.
 *
 * ⚠️ AND THE GUARD IS THE ONLY THING BETWEEN A BOSS AND A CHILD'S CREATURE. It covers a
 * direction rather than a circle, which is what makes position matter; a guard that faced the
 * wrong way would be a defence that is up, paid for, and does nothing.
 */

const striker = (over: Partial<Striker> = {}): Striker => ({
  ...restingStriker(restingWalker(0.5, 0.5)),
  ...over,
})

/** where a thing at this angle from you stands, in world units, for a screen-space angle */
const fromAngle = (deg: number, at = { x: 0.5, y: 0.5 }) => {
  const a = (deg * Math.PI) / 180
  /* ⚠️ built in SCREEN space and converted back, because the arc is measured on screen — the
     park squashes y, so a world-space angle is not the angle a player sees or aims at */
  const unit = toScreen(1, 0)
  const sx = Math.cos(a)
  const sy = Math.sin(a)
  return { x: at.x + (sx / unit.sx) * 0.1, y: at.y + (sy / (toScreen(0, 1).sy || 1)) * 0.1 }
}

describe('the aim, which is all the wire carries', () => {
  it('survives being sent as one digit', () => {
    for (let n = 0; n < 8; n++) {
      expect(octantOf(aimFromOctant(n)), `octant ${n}`).toBe(n)
    }
  })

  /**
   * ⚠️ AND EVERY DIRECTION OFF THE WIRE IS A UNIT VECTOR. inSwipe projects along the aim, so a
   * vector of any other length silently scales how far a swing reaches — a peer whose aim came
   * back at 1.4 would hit from half again as far away, on your screen only.
   */
  it('and comes back the length a direction has to be', () => {
    for (let n = -20; n < 20; n++) {
      const a = aimFromOctant(n)
      expect(Math.hypot(a.x, a.y), `octant ${n}`).toBeCloseTo(1, 10)
    }
  })

  it('and a number the wire should never have sent still becomes a direction', () => {
    for (const n of [8, 9, -1, -8, 100, 2.4, -0.6]) {
      const a = aimFromOctant(n)
      expect(Number.isFinite(a.x) && Number.isFinite(a.y), `octant ${n}`).toBe(true)
      expect(octantOf(a)).toBeGreaterThanOrEqual(0)
      expect(octantOf(a)).toBeLessThan(8)
    }
  })

  it('and an octant is one of eight, whatever angle went in', () => {
    for (let deg = 0; deg < 360; deg += 7) {
      const a = (deg * Math.PI) / 180
      const n = octantOf({ x: Math.cos(a), y: Math.sin(a) })
      expect(Number.isInteger(n)).toBe(true)
      expect(n).toBeGreaterThanOrEqual(0)
      expect(n).toBeLessThan(8)
    }
  })

  it('and the eight are eight different directions', () => {
    const seen = new Set(Array.from({ length: 8 }, (_, n) => JSON.stringify(aimFromOctant(n))))
    expect(seen.size).toBe(8)
  })

  it('and the keys point where the keys say', () => {
    const fallback: Aimed = { x: 1, y: 0 }
    const right = aimFromKeys({ right: true, left: false, up: false, down: false }, fallback)
    expect(right.x).toBeGreaterThan(0)
    const up = aimFromKeys({ right: false, left: false, up: true, down: false }, fallback)
    expect(up.y).toBeLessThan(0)
    const held = aimFromKeys({ right: false, left: false, up: false, down: false }, fallback)
    expect(held, 'nothing held keeps the aim you had').toEqual(fallback)
  })

  it('and the pointer points away from you, not at a corner of the screen', () => {
    const fallback: Aimed = { x: 1, y: 0 }
    const right = aimFromPoint(120, 0, fallback)
    expect(right.x).toBeGreaterThan(0.9)
    expect(Math.hypot(right.x, right.y), 'it is a direction').toBeCloseTo(1, 6)
    expect(aimFromPoint(0, 0, fallback), 'no distance keeps the aim you had').toEqual(fallback)
  })
})

describe('a guard covers a direction, not a circle', () => {
  it('is nothing at all when it is not up', () => {
    const at = fromAngle(0)
    expect(guarded(striker({ braced: false }), at)).toBe(false)
    expect(guarded(striker({ braced: true, guard: 0 }), at), 'a spent guard is no guard').toBe(
      false,
    )
  })

  it('and meets what it is looking at', () => {
    const me = striker({ braced: true, aim: { x: 1, y: 0 } })
    expect(guarded(me, fromAngle(0))).toBe(true)
  })

  /**
   * ⚠️ AND NOT WHAT IS BEHIND YOU, which is the whole point of it. GUARD.arc is the cosine of
   * 100°, so it covers everything except a 160° wedge at your back — generous, because a fight
   * you can lose by being circled is a fight about the camera. But it is not a circle, and a
   * boss walking round you must be able to get behind it.
   */
  it('and not what is behind it', () => {
    const me = striker({ braced: true, aim: { x: 1, y: 0 } })
    expect(guarded(me, fromAngle(180)), 'straight behind').toBe(false)
    expect(guarded(me, fromAngle(150)), 'over the shoulder').toBe(false)
    expect(guarded(me, fromAngle(-150))).toBe(false)
  })

  it('and the edge of the wedge is where GUARD.arc says it is', () => {
    const me = striker({ braced: true, aim: { x: 1, y: 0 } })
    const edge = (Math.acos(GUARD.arc) * 180) / Math.PI
    expect(edge, 'the arc is a hundred degrees each way').toBeCloseTo(100, 0)
    expect(guarded(me, fromAngle(edge - 4)), 'just inside').toBe(true)
    expect(guarded(me, fromAngle(edge + 4)), 'just outside').toBe(false)
  })

  it('and turning to face a blow is what makes it land on the guard', () => {
    const behind = fromAngle(180)
    expect(guarded(striker({ braced: true, aim: { x: 1, y: 0 } }), behind)).toBe(false)
    expect(guarded(striker({ braced: true, aim: { x: -1, y: 0 } }), behind), 'now turn').toBe(true)
  })

  /** ⚠️ on top of you is met: there is no direction to have got wrong */
  it('and something standing on you is met however you face', () => {
    const me = striker({ braced: true, aim: { x: 1, y: 0 } })
    expect(guarded(me, { x: me.x, y: me.y })).toBe(true)
  })
})

describe('a parry is a guard with timing on it', () => {
  it('is the same arc, and only in the first moment', () => {
    const at = fromAngle(0)
    const early = striker({ braced: true, braceFor: GUARD.parry * 0.5 })
    const late = striker({ braced: true, braceFor: GUARD.parry + 0.05 })
    expect(parries(early, at)).toBe(true)
    expect(parries(late, at), 'a guard held a while is a block, not a parry').toBe(false)
  })

  /**
   * ⚠️ IT CANNOT BE A WAY ROUND THE ARC. A parry that worked from behind would make holding the
   * key the answer to everything, which is the thing the arc exists to prevent.
   */
  it('and never catches what the guard would not have', () => {
    const behind = fromAngle(180)
    const perfect = striker({ braced: true, braceFor: 0 })
    expect(guarded(perfect, behind)).toBe(false)
    expect(parries(perfect, behind)).toBe(false)
  })

  it('and a parry is always a block too', () => {
    for (const deg of [0, 45, 90, 135, 180, 225, 270]) {
      const at = fromAngle(deg)
      const me = striker({ braced: true, braceFor: 0 })
      if (parries(me, at)) expect(guarded(me, at), `${deg}° parried without blocking`).toBe(true)
    }
  })
})

describe('what cannot be touched', () => {
  it('is a creature mid-dodge or still stunned', () => {
    expect(canBeHurt(striker())).toBe(true)
    expect(canBeHurt(striker({ dodge: 0.1 })), 'a dodge answers by not being there').toBe(false)
    expect(canBeHurt(striker({ stun: 0.1 })), 'already staggered').toBe(false)
  })

  /**
   * ⚠️ A DODGE IS FREE IF YOU TIME IT AND USELESS IF YOU DO NOT, which is what makes the guard
   * worth its cost. The two answers must not collapse into one: a dodge that also blocked would
   * make the guard the strictly worse option and delete half the fight.
   */
  it('and being untouchable is not the same as guarding', () => {
    const rolling = striker({ dodge: 0.1, braced: false })
    expect(canBeHurt(rolling)).toBe(false)
    expect(guarded(rolling, fromAngle(0)), 'a roll is not a block').toBe(false)
  })
})
