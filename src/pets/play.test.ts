import { describe, expect, it } from 'vitest'
import {
  CLOSED,
  collect,
  COURSE,
  FLOOR,
  PLAIN,
  restingBody,
  stepBody,
  touching,
  TREATS,
  TUNE,
  WORLD,
  type Body,
  type Input,
  type Ledge,
} from './play'

/**
 * The playground's physics.
 *
 * ⚠️ THESE ARE THE CHECKS CLAUDE.md SAYS WERE RUN AND NEVER KEPT. The module's own note
 * explains why it is shaped this way: "with no rAF, a loop that owns its own maths is a loop
 * nobody can check" — so the physics is pure functions, and `stepBody` answers "what happens if
 * you hold right for half a second" with no browser involved. The jump arcs, the one-way
 * ledges, the coyote window and the reachability of every treat were all verified that way,
 * once, by hand.
 */

const NONE: Input = { left: false, right: false, jump: false, down: false }
const press = (over: Partial<Input> = {}): Input => ({ ...NONE, ...over })

/** run the world forward, reporting the highest and lowest it got to */
const run = (
  b: Body,
  input: Input | ((t: number, b: Body) => Input),
  seconds: number,
  ledges: Ledge[] = [],
  dt = 1 / 120,
) => {
  let now = b
  let peak = b.y
  let low = b.y
  let t = 0
  for (; t < seconds; t += dt) {
    const held = typeof input === 'function' ? input(t, now) : input
    now = stepBody(now, held, ledges, dt, PLAIN)
    /* y counts DOWNWARD from the top: FLOOR is the ground and smaller is higher */
    peak = Math.min(peak, now.y)
    low = Math.max(low, now.y)
  }
  return { b: now, peak, low, rose: b.y - peak }
}

describe('standing still', () => {
  it('stays standing still', () => {
    const after = run(restingBody(), NONE, 1).b
    expect(after.y).toBeCloseTo(FLOOR, 6)
    expect(after.onGround).toBe(true)
    expect(after.vx).toBeCloseTo(0, 6)
  })

  it('and a body nobody steers comes to a stop rather than skating', () => {
    const moving = { ...restingBody(), vx: TUNE.speed }
    const after = run(moving, NONE, 1).b
    expect(Math.abs(after.vx)).toBeLessThan(0.02)
  })

  /**
   * ⚠️ DRAG IS A MULTIPLIER SO A LAUNCH CAN SURVIVE IT. At full grip the hardest hit in the
   * game threw somebody almost nowhere — the note on `grip` records the measurement. Lower grip
   * has to mean the body keeps its speed longer.
   */
  it('and on slippery footing it keeps its speed longer', () => {
    const moving = { ...restingBody(0.5), vx: TUNE.speed }
    const sticky = stepBody(moving, NONE, [], 0.2, PLAIN, { grip: 1 })
    const icy = stepBody(moving, NONE, [], 0.2, PLAIN, { grip: 0.1 })
    expect(Math.abs(icy.vx)).toBeGreaterThan(Math.abs(sticky.vx))
  })
})

describe('walking', () => {
  it('goes the way it is held, and faces that way', () => {
    const right = run(restingBody(0.5), press({ right: true }), 0.6).b
    expect(right.x).toBeGreaterThan(0.5)
    expect(right.facing).toBe(1)
    const left = run(restingBody(0.5), press({ left: true }), 0.6).b
    expect(left.x).toBeLessThan(0.5)
    expect(left.facing).toBe(-1)
  })

  it('and tops out at the speed it is tuned to', () => {
    const after = run(restingBody(0.2), press({ right: true }), 3).b
    expect(Math.abs(after.vx)).toBeLessThanOrEqual(TUNE.speed + 1e-6)
    expect(Math.abs(after.vx)).toBeCloseTo(TUNE.speed, 2)
  })

  it('and crouching is slower than walking', () => {
    const walk = run(restingBody(0.5), press({ right: true }), 1).b.x - 0.5
    const creep = run(restingBody(0.5), press({ right: true, down: true }), 1).b.x - 0.5
    expect(creep).toBeGreaterThan(0)
    expect(creep).toBeLessThan(walk)
  })

  /* ⚠️ a closed world has walls, and a body cannot be pushed out through one */
  it('and cannot be walked out of the world', () => {
    const far = run(restingBody(0.2), press({ left: true }), 6, [], 1 / 120).b
    expect(far.x).toBeGreaterThanOrEqual(0)
    const other = run(restingBody(0.2), press({ right: true }), 12, [], 1 / 120).b
    expect(other.x).toBeLessThanOrEqual(WORLD.w)
    expect(CLOSED.walls).toBe(true)
  })
})

describe('a jump', () => {
  /** hold jump for a beat, then let go and let it land */
  const hop = (dt: number, hold = 0.2, ledges: Ledge[] = []) =>
    run(restingBody(0.5), (t) => press({ jump: t < hold }), 2, ledges, dt)

  it('leaves the ground and comes back to it', () => {
    const { b, rose } = hop(1 / 120)
    expect(rose).toBeGreaterThan(0.1)
    expect(b.y).toBeCloseTo(FLOOR, 3)
    expect(b.onGround).toBe(true)
  })

  /**
   * ⚠️ THE SAME HEIGHT WHATEVER THE FRAME LENGTH. dt is clamped inside stepBody because a
   * backgrounded tab hands you several seconds and a pet that teleports through the floor —
   * but within normal frame lengths the arc has to be the arc.
   */
  it('and reaches the same height at 60, 120 and 240 a second', () => {
    const a = hop(1 / 60).rose
    const b = hop(1 / 120).rose
    const c = hop(1 / 240).rose
    expect(Math.abs(a - c)).toBeLessThan(0.05)
    expect(Math.abs(b - c)).toBeLessThan(0.03)
  })

  it('and rises about a quarter of the screen, which is what reads as a jump', () => {
    /* the note on TUNE: 1.55 against a gravity of 4.6 is a rise of about a quarter */
    expect(hop(1 / 240).rose).toBeGreaterThan(0.15)
    expect(hop(1 / 240).rose).toBeLessThan(0.45)
  })

  it('and holding it longer goes higher than tapping it', () => {
    expect(hop(1 / 240, 0.4).rose).toBeGreaterThan(hop(1 / 240, 0.02).rose)
  })

  /**
   * ⚠️ HOLDING JUMP BOUNCES, AND THAT IS THE BEHAVIOUR RATHER THAN A BUG. There is no
   * edge on this key: the moment the body is back on the ground a held jump fires again. In a
   * playground that is right — a child leaning on the key gets a bouncing pet — and it is
   * worth pinning, because the PARK's jump is the opposite (an edge, deliberately) and somebody
   * moving between the two files could easily make one match the other and call it a fix.
   */
  it('and holding it bounces, which is what a playground should do', () => {
    const { b } = run(restingBody(0.5), press({ jump: true }), 3)
    expect(b.y).toBeLessThan(FLOOR)
  })

  it('but letting go brings you down and leaves you down', () => {
    const { b } = run(restingBody(0.5), (t) => press({ jump: t < 0.2 }), 3)
    expect(b.onGround).toBe(true)
    expect(b.y).toBeCloseTo(FLOOR, 3)
  })

  /**
   * ⚠️ FALLING FASTER THAN RISING, which every platformer does and nobody notices until it is
   * gone. The way down has to take less time than the way up.
   */
  it('and comes down faster than it went up', () => {
    const dt = 1 / 240
    let b = restingBody(0.5)
    let up = 0
    let down = 0
    let peak = FLOOR
    let past = false
    for (let t = 0; t < 2; t += dt) {
      b = stepBody(b, press({ jump: t < 0.3 }), [], dt, PLAIN)
      if (!past) {
        if (b.y < peak) {
          peak = b.y
          up += dt
        } else past = true
      } else if (b.y < FLOOR - 1e-9) down += dt
    }
    expect(down).toBeLessThan(up)
    expect(TUNE.fallBoost).toBeGreaterThan(1)
  })
})

describe('the coyote window', () => {
  /**
   * ⚠️ THE ONE RULE THAT IS ENTIRELY ABOUT FEEL. Walking off a ledge and pressing jump a
   * frame later should still jump — without it a platformer feels like it is ignoring you, and
   * with too much of it you can jump out of thin air.
   */
  /**
   * ⚠️ THE CLOCK STARTS THE FRAME IT LEAVES, WHICH IS WHY THIS WATCHES FOR IT. The
   * first version walked for a fixed half second and then waited — by which time it had been
   * off the edge for about 0.15s already and the window was long spent, so a working coyote
   * rule read as broken. A test of a tenth of a second has to know when that tenth began.
   */
  const stepOff = (wait: number) => {
    const dt = 1 / 240
    /* high enough that the longest wait below still happens in mid-air */
    const ledge: Ledge[] = [{ x: 0.5, y: FLOOR - 0.6, w: 0.3 }]
    let b: Body = { ...restingBody(0.6), y: ledge[0].y, onGround: true }
    let left = false
    for (let t = 0; t < 1.5 && !left; t += dt) {
      b = stepBody(b, press({ right: true }), ledge, dt, PLAIN)
      left = !b.onGround
    }
    expect(left, 'never walked off the ledge').toBe(true)
    for (let t = 0; t < wait; t += dt) b = stepBody(b, NONE, ledge, dt, PLAIN)
    expect(b.onGround, 'landed before the window could be tested').toBe(false)
    const before = b.vy
    b = stepBody(b, press({ jump: true }), ledge, dt, PLAIN)
    return { jumped: b.vy < before - 0.5, fell: b.fell }
  }

  it('lets you jump just after stepping off', () => {
    expect(stepOff(0.02).jumped).toBe(true)
  })

  it('but not long after', () => {
    expect(stepOff(TUNE.coyote * 2.5).jumped).toBe(false)
  })

  it('and the window is short enough to be a forgiveness, not a second jump', () => {
    expect(TUNE.coyote).toBeLessThan(0.2)
    expect(TUNE.coyote).toBeGreaterThan(0.03)
  })
})

describe('a one-way ledge', () => {
  const ledge: Ledge[] = [{ x: 0.4, y: FLOOR - 0.25, w: 0.4 }]

  it('is something you land on top of', () => {
    const dt = 1 / 240
    let b: Body = { ...restingBody(0.55), y: FLOOR - 0.8, onGround: false }
    for (let t = 0; t < 1.5; t += dt) b = stepBody(b, NONE, ledge, dt, PLAIN)
    expect(b.y).toBeCloseTo(ledge[0].y, 2)
    expect(b.onGround).toBe(true)
  })

  it('and something you jump up through from underneath', () => {
    const dt = 1 / 240
    const under: Body = { ...restingBody(0.55), y: FLOOR }
    const { peak } = run(under, (t) => press({ jump: t < 0.4 }), 1.2, ledge, dt)
    expect(peak).toBeLessThan(ledge[0].y - 0.02)
  })

  it('and it only catches you where it actually is', () => {
    const dt = 1 / 240
    /* dropped well to the side of it — nothing to land on but the floor */
    let b: Body = { ...restingBody(1.4), y: FLOOR - 0.8, onGround: false }
    for (let t = 0; t < 2; t += dt) b = stepBody(b, NONE, ledge, dt, PLAIN)
    expect(b.y).toBeCloseTo(FLOOR, 2)
  })

  /**
   * ⚠️ AND DROPPING THROUGH ONE IS NOT SOMETHING YOU CAN DO. I wrote a test asserting
   * it was, because every platformer has it and `down` is already an input — but here `down`
   * only crouches, and a ledge catches you whatever you are holding. Written down as the
   * behaviour that exists rather than deleted, because "hold down to drop through" is a
   * reasonable thing to want and this is where it would go.
   */
  it('and holding down crouches on it rather than dropping through', () => {
    const dt = 1 / 240
    let b: Body = { ...restingBody(0.55), y: ledge[0].y, onGround: true }
    for (let t = 0; t < 1.2; t += dt) b = stepBody(b, press({ down: true }), ledge, dt, PLAIN)
    expect(b.y).toBeCloseTo(ledge[0].y, 3)
    expect(b.onGround).toBe(true)
  })
})

describe('the course that ships', () => {
  it('has ledges, and all of them inside the world', () => {
    expect(COURSE.length).toBeGreaterThan(0)
    for (const l of COURSE) {
      expect(l.x).toBeGreaterThanOrEqual(0)
      expect(l.x + l.w).toBeLessThanOrEqual(WORLD.w + 1e-9)
      expect(l.y).toBeLessThan(FLOOR)
      expect(l.w).toBeGreaterThan(0)
    }
  })

  it('and treats, all of them inside the world too', () => {
    expect(TREATS.length).toBeGreaterThan(0)
    for (const t of TREATS) {
      expect(t.x).toBeGreaterThanOrEqual(0)
      expect(t.x).toBeLessThanOrEqual(WORLD.w)
      expect(t.y).toBeLessThanOrEqual(FLOOR)
      expect(t.y).toBeGreaterThan(0)
    }
  })

  /**
   * ⚠️ REACHABILITY IS THE ONE CLAUDE.md SAYS WAS RUN BY HAND, and getting it to mean
   * anything took two goes. The first version allowed a treat 0.35 either side of any surface
   * and a jump's height above it — both numbers picked by eye — and it could not fail: the
   * measured rise is 0.42 against a highest ledge of 0.28, so nothing inside the world is ever
   * too high, and the ledges' 0.35 haloes overlap across the one real gap in the course. A
   * check that cannot fail is not a check.
   *
   * So both numbers are MEASURED now — how high a plain creature gets, and how far it travels
   * doing it — which means the test tracks TUNE rather than restating a guess. And the
   * predicate is asked two questions it must answer no to, so the day it goes vacuous again
   * something says so.
   */
  const reachOf = () => {
    const dt = 1 / 240
    const hop = (input: (t: number) => Input) => {
      let b = restingBody(0.5)
      let peak = FLOOR
      for (let t = 0; t < 1.5; t += dt) {
        b = stepBody(b, input(t), [], dt, PLAIN)
        peak = Math.min(peak, b.y)
      }
      return { rise: FLOOR - peak, went: Math.abs(b.x - 0.5) }
    }
    const up = hop((t) => press({ jump: t < 0.4 }))
    const along = hop((t) => press({ jump: t < 0.4, right: true }))
    return { rise: up.rise, reach: along.went }
  }

  const standsOn = () => [{ x: 0, y: FLOOR, w: WORLD.w }, ...COURSE]

  const canGet = (t: { x: number; y: number }, rise: number, reach: number) =>
    standsOn().some((s) => t.x >= s.x - reach && t.x <= s.x + s.w + reach && s.y - t.y <= rise)

  it('and the jump it is measured against is a real one', () => {
    const { rise, reach } = reachOf()
    expect(rise).toBeGreaterThan(0.15)
    expect(reach).toBeGreaterThan(0.1)
  })

  it('and every treat is within one of something to stand on', () => {
    const { rise, reach } = reachOf()
    for (const t of TREATS) {
      expect(
        canGet(t, rise, reach),
        `treat at ${t.x.toFixed(2)},${t.y.toFixed(2)} is out of reach`,
      ).toBe(true)
    }
  })

  /**
   * ⚠️ AND THE PREDICATE HAS TO BE ABLE TO SAY NO. Without this pair the test above
   * passes whatever the course looks like, which is exactly how the first version of it read
   * as green while meaning nothing.
   */
  it('and the same question refuses somewhere there is nothing to stand on', () => {
    const { rise, reach } = reachOf()
    expect(canGet({ x: WORLD.w + reach + 1, y: FLOOR }, rise, reach)).toBe(false)
    expect(canGet({ x: 1.5, y: -(rise + 2) }, rise, reach)).toBe(false)
  })
})

describe('picking a treat up', () => {
  const at = (x: number, y: number): Body => ({ ...restingBody(x), y })

  it('is a question about being near it', () => {
    expect(touching(at(0.5, 0.5), { x: 0.5, y: 0.5 })).toBe(true)
    expect(touching(at(0.5, 0.5), { x: 2.5, y: 0.5 })).toBe(false)
  })

  const spots = [
    { x: 0.5, y: 0.5 },
    { x: 2.0, y: 0.5 },
  ]

  it('and collecting marks the one you are on and leaves the other', () => {
    expect(collect([at(0.5, 0.5)], spots, [false, false])).toEqual([true, false])
  })

  /**
   * ⚠️ ANY PET COUNTS, not just the one you are driving — the followers are your pets
   * too, and a party that walks through a treat without it counting would be asking you to go
   * back and do it again as the right creature.
   */
  it('and a follower picking one up counts as much as you doing it', () => {
    expect(collect([at(0.1, 1), at(2.0, 0.5)], spots, [false, false])).toEqual([false, true])
  })

  /**
   * ⚠️ null WHEN NOTHING CHANGED, so the room can ask every frame and only touch React
   * when something happened. Sixty state updates a second to say "still five treats" is the
   * cost of asking the wrong question.
   */
  it('and says nothing at all when nothing was picked up', () => {
    expect(collect([at(1.2, 1)], spots, [false, false])).toBeNull()
    expect(collect([at(0.5, 0.5)], spots, [true, true])).toBeNull()
  })
})

describe('traits are modifiers, so the feel stays in one place', () => {
  it('and a plain creature multiplies everything by one', () => {
    expect(PLAIN).toEqual({ speed: 1, jump: 1, gravity: 1, glide: 1 })
  })

  it('and a better jumper gets higher than a plain one', () => {
    const dt = 1 / 240
    const plain = run(restingBody(0.5), (t) => press({ jump: t < 0.3 }), 1.5, [], dt).rose
    let b = restingBody(0.5)
    let peak = FLOOR
    for (let t = 0; t < 1.5; t += dt) {
      b = stepBody(b, press({ jump: t < 0.3 }), [], dt, { ...PLAIN, jump: 1.3 })
      peak = Math.min(peak, b.y)
    }
    expect(FLOOR - peak).toBeGreaterThan(plain)
  })

  /**
   * ⚠️ GLIDING IS HELD, NOT AUTOMATIC, which is what makes wings something you play
   * rather than a number you have — and the first version of this test dropped both creatures
   * with no key held, so neither glided and the two fell identically to the last decimal. A
   * test that passes for the wrong reason is one thing; that one failed for the right one.
   */
  it('and a glider holding jump comes down more gently than a brick', () => {
    const dt = 1 / 240
    const fall = (glide: number, holding: boolean) => {
      let b: Body = { ...restingBody(0.5), y: 0.2, onGround: false }
      for (let t = 0; t < 0.5; t += dt)
        b = stepBody(b, press({ jump: holding }), [], dt, { ...PLAIN, glide })
      return b.y
    }
    expect(fall(0.3, true)).toBeLessThan(fall(1, true))
  })

  it('but a winged creature that does not hold it falls like anything else', () => {
    const dt = 1 / 240
    const fall = (glide: number) => {
      let b: Body = { ...restingBody(0.5), y: 0.2, onGround: false }
      for (let t = 0; t < 0.4; t += dt) b = stepBody(b, NONE, [], dt, { ...PLAIN, glide })
      return b.y
    }
    expect(fall(0.3)).toBeCloseTo(fall(1), 6)
  })
})
