import { describe, expect, it } from 'vitest'
import {
  aimFromKeys,
  aimFromOctant,
  aimFromPoint,
  canBeHurt,
  footSpan,
  GUARD,
  guarded,
  octantOf,
  PARK_TALL,
  mauled,
  parries,
  pressedTo,
  restingStriker,
  stepDown,
  stepStrike,
  toScreen,
  type Aimed,
  type Striker,
} from './strike'
import { restingWalker } from './walk'
import { PET_TALL } from '../pets/play'
import { POUNCE, type Attack } from '../pets/attack'

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

/**
 * How big a target a creature makes in the park.
 *
 * ⚠️ THIS WENT UNTESTED AND WAS WRONG THE WHOLE TIME, which is the pair of facts that belong
 * together. footSpan held two units: its DEPTH converted pet-heights to this screen (FOOT.deep ×
 * PARK_TALL) and its WIDTH never did, so the horizontal half of every footprint came out 1/0.44
 * too big and a creature was most of a body wider to hit than it looked. It is the mistake
 * strike.ts has its loudest note about, in the one function that most quietly decides fights.
 *
 * ⚠️ AND THE TEST THAT CATCHES IT ASKS THE SIMPLEST QUESTION, not the arithmetic: is the thing
 * that has to be hit SMALLER than the creature you can see? It must be — 0.8 of it — and under
 * the old sum it was 1.82 times bigger. Measured against the creature's drawn width, which comes
 * from PARK_TALL and the drawing's own proportions, not from the conversion being checked.
 */
describe('the footprint a creature makes', () => {
  /** how wide a creature is drawn on this screen, in screen-heights — height times its shape */
  const drawnWide = (ratio: number) => PARK_TALL * ratio
  const span = (ratio: number, scale = 1) => footSpan(PET_TALL * ratio, scale, 1, 0) * 2

  it('is narrower than the creature, never wider', () => {
    for (const ratio of [0.5, 1, 1.6, 3]) {
      expect(span(ratio), `a ${ratio}:1 creature`).toBeLessThan(drawnWide(ratio))
    }
  })

  it('and is four fifths of it, which is the only number in there', () => {
    for (const ratio of [0.5, 1, 1.6, 3]) {
      expect(span(ratio)).toBeCloseTo(drawnWide(ratio) * 0.8, 10)
    }
  })

  /** ⚠️ and it grows with a boss exactly as the boss does, rather than faster */
  it('and scales with the creature', () => {
    for (const scale of [1, 2.05, 3.05]) {
      expect(span(1, scale)).toBeCloseTo(drawnWide(1) * 0.8 * scale, 10)
    }
  })

  /**
   * ⚠️ AND IT IS SHALLOW, which is the half that was always right: seen from above a creature
   * covers a shallow patch, and treating it as a circle means picking which lie to tell.
   */
  it('and is far shallower than it is wide', () => {
    const across = footSpan(PET_TALL, 1, 1, 0)
    const deep = footSpan(PET_TALL, 1, 0, 1)
    expect(deep).toBeLessThan(across / 2)
  })
})

/**
 * A standoff is a distance something has to cross, and the thing that crosses it decides it.
 *
 * ⚠️ THIS IS THE TEST FOR A WAVE THAT COULD NEITHER BE HIT NOR HIT BACK, and it is here rather
 * than in ParkRoom because the whole mistake was a number picked in a component out of the one
 * constant that was to hand. Ten minions converged on the player, drew correctly, stood in a
 * ring — and twelve swings felled none of them while the player took no damage. Both hit tests
 * were right. The ring was at PARK_TALL × scale × 1.6, a swing reaches move.reach × PARK_TALL
 * plus the target's footprint, and nothing had ever asked whether the second was bigger than the
 * first. It is not, for any move in the band.
 *
 * ⚠️ MEASURED THROUGH THE REAL CONSTANTS AND THE REAL BANDS, never against a repeat of the sum.
 * The question is not "is pressedTo what I typed" — it is "is the ring inside the swing", which
 * is two different functions disagreeing or agreeing, and no arithmetic shared between them.
 */
describe('a crowd standing where a swing can reach it', () => {
  /** the reach band every drawn move is clamped into — see movesOf */
  const REACH = [0.5, 1.6] as const
  /** the scale band a minion is ranged into — see minion.ts */
  const SCALE = [0.7, 1.15] as const
  /** a creature's drawing is somewhere in here, tall and thin through squat and wide */
  const RATIOS = [0.5, 0.8, 1.2, 2] as const

  /** how far a swing of this reach carries, in screen-heights, against a target that wide */
  const swingGets = (reach: number, theirWide: number) =>
    reach * PARK_TALL + footSpan(theirWide, 1, 1, 0)

  it('stands closer than the shortest swing in the game carries', () => {
    for (const mine of RATIOS)
      for (const theirs of RATIOS)
        for (const scale of SCALE) {
          const myWide = PET_TALL * mine
          const theirWide = PET_TALL * theirs * scale
          const ring = pressedTo(myWide, theirWide, 0, 1)
          expect(
            ring,
            `a ${mine}:1 player swinging at a ${theirs}:1 minion at ${scale}x`,
          ).toBeLessThan(swingGets(REACH[0], theirWide))
        }
  })

  /**
   * ⚠️ AND INSIDE CONTACT FROM EVERY DIRECTION, which is the half the picked number also got
   * wrong and the reason the ring is YOUR span rather than the sum of both. A footprint is
   * shallower than it is wide, so the sum is only the touching distance sideways: a crowd that
   * wanted it would press on you from the left and stand off a visible gap from above.
   */
  it('and inside touching distance whichever way it comes at you', () => {
    for (const mine of RATIOS)
      for (const theirs of RATIOS) {
        const myWide = PET_TALL * mine
        const theirWide = PET_TALL * theirs
        const ring = pressedTo(myWide, theirWide, 0, 1)
        /* ⚠️ EVERY DIRECTION, NOT THE TWO AXES. "The shallow one is the smallest" is the claim
           being made, so checking it at 0° and 90° would be asserting it rather than testing
           it — the whole reason the first version of this was wrong is that it reasoned about
           which term was biggest instead of sweeping. */
        for (let i = 0; i < 16; i++) {
          const a = (i / 16) * Math.PI * 2
          const ux = Math.cos(a)
          const uy = Math.sin(a)
          const touching = footSpan(myWide, 1, ux, uy) + footSpan(theirWide, 1, ux, uy)
          expect(
            ring,
            `${mine}:1 and ${theirs}:1 at ${Math.round((a * 180) / Math.PI)}°`,
          ).toBeLessThanOrEqual(touching)
        }
      }
  })

  /** ⚠️ and two of a kind do not stack, which is the one thing pressedTo is exactly right for */
  it('while two of the same minion stand a body apart', () => {
    for (const theirs of RATIOS) {
      const wide = PET_TALL * theirs
      expect(pressedTo(wide, wide)).toBeCloseTo(footSpan(wide, 1, 1, 0) * 2, 10)
    }
  })
})

/**
 * Being hit has to give you back the controls before the next blow can land.
 *
 * ⚠️ THIS IS THE SECOND HALF OF THE WAVE'S FIRST RUN, and it is the one that could not have
 * been reasoned out. The ring was fixed, the minions reached the player, the player started
 * taking damage — and a held attack key produced ZERO live swings in 2.4 seconds of being
 * surrounded, against seventeen with the field empty. canBeHurt was `stun <= 0`, so the safety
 * window and the no-control window were the same number: the frame the stagger ends, the next
 * minion lands, and the fight is a cutscene.
 *
 * ⚠️ AND IT IS CHECKED AS A LOOP RATHER THAN AS A COMPARISON, because "safe > stun" is the
 * arithmetic the fix is made of and would agree with itself. What is asked here is the thing
 * that was actually wrong: step a striker with something touching it EVERY FRAME, and count
 * the frames in which it could have swung.
 */
describe('a crowd that leaves you frames to fight in', () => {
  const MOVE: Attack = { ...POUNCE, live: [0.3, 0.6], span: 1 }
  const touch: Attack = {
    ...MOVE,
    bite: 6,
    shove: 1,
  }

  /** every frame: if it can be hurt, it is — which is what standing in a wave means */
  const mobbed = (frames: number) => {
    let s: Striker = { ...restingStriker(restingWalker(0.5, 0.5)), safe: 0 }
    let free = 0
    let hits = 0
    for (let i = 0; i < frames; i++) {
      if (canBeHurt(s)) {
        s = mauled(s, { x: 0.52, y: 0.5 }, touch)
        hits++
      }
      /* could a press have been taken on this frame? the same three the swing gate reads */
      if (s.stun <= 0 && s.swing <= 0 && s.hold <= 0) free++
      s = stepStrike(s, { quick: false, heavy: false, up: false, down: false }, [MOVE], 1 / 60)
    }
    return { free, hits }
  }

  it('lets you act, rather than staggering you for ever', () => {
    const { free, hits } = mobbed(300)
    expect(hits, 'it is still hitting you').toBeGreaterThan(3)
    /* ⚠️ A SHARE, NOT A COUNT — the question is whether the fight is playable, and one free
       frame in five seconds is the lock with a rounding error in it. */
    expect(free / 300, 'frames you could have pressed in').toBeGreaterThan(0.3)
  })

  /** ⚠️ and the grace is longer than the stagger for every blow, not just a typical one */
  it('and the window outlasts the stagger whatever hit you', () => {
    for (const shove of [0.2, 1, 3, 8])
      for (const bite of [1, 6, 20]) {
        const hit = mauled(
          restingStriker(restingWalker(0.5, 0.5)),
          { x: 0.52, y: 0.5 },
          {
            ...MOVE,
            bite,
            shove,
          },
        )
        expect(hit.safe, `shove ${shove}, bite ${bite}`).toBeGreaterThan(hit.stun)
      }
  })

  /** ⚠️ and you stand up with it, which is what makes a knockdown survivable in a crowd */
  it('and you get up with a window too', () => {
    let s = restingStriker(restingWalker(0.5, 0.5))
    s = { ...s, hurt: 999 }
    let down = 0
    let got: Striker = s
    /* down, then all the way back up */
    for (let i = 0; i < 400; i++) {
      const r = stepDown(down, got, 1 / 60)
      down = r.down
      got = r.s
      if (r.went === 'up') break
    }
    expect(down).toBe(0)
    expect(got.safe).toBeGreaterThan(0)
  })
})
