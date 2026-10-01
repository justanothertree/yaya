import { describe, expect, it } from 'vitest'
import { FLOCK, onCamera, ringOf, seeded, stepSwarm, type Mob } from './swarm'
import { frameAt } from '../pets/bake'

/**
 * A crowd of small things that want to reach you.
 *
 * ⚠️ THE WHOLE MODULE IS PURE SO THAT THIS CAN EXIST. A swarm is the one thing in the park that
 * cannot be checked by looking — fifty creatures moving at sixty a second all look plausible, and
 * "they clumped into a column" and "they spread around you" are the same screenshot at the wrong
 * moment. Asked of the arithmetic, both are one number.
 */

const near = (a: { x: number; y: number }, b: { x: number; y: number }) =>
  Math.hypot(a.x - b.x, a.y - b.y)

describe('a wave arrives the same way on every machine', () => {
  /**
   * ⚠️ THIS IS THE MULTIPLAYER ANSWER, AND IT IS THE REASON FOR THE SEED. Fifty minions cannot
   * each be a message — cast.ts opens by saying nothing new goes over the wire, and it holds that
   * line for a boss's whole repertoire. A wave that spawns from a seed everyone already has is
   * derived rather than sent. If this is ever not identical, two people are fighting different
   * fights on the same field.
   */
  it('and the same seed is the same wave, exactly', () => {
    const at = { x: 0, y: 0 }
    const a = ringOf(50, 1234, at, 10)
    const b = ringOf(50, 1234, at, 10)
    expect(JSON.stringify(b)).toBe(JSON.stringify(a))
  })

  it('and a different seed is a different one', () => {
    const at = { x: 0, y: 0 }
    expect(JSON.stringify(ringOf(20, 1, at, 10))).not.toBe(JSON.stringify(ringOf(20, 2, at, 10)))
  })

  /** ⚠️ and the generator itself is a generator, not an accident that happens to vary */
  it('and the numbers are spread across the range', () => {
    const rng = seeded(99)
    const n = 4000
    let lo = 1
    let hi = 0
    let sum = 0
    for (let i = 0; i < n; i++) {
      const v = rng()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
      lo = Math.min(lo, v)
      hi = Math.max(hi, v)
      sum += v
    }
    expect(sum / n).toBeGreaterThan(0.45)
    expect(sum / n).toBeLessThan(0.55)
    expect(lo).toBeLessThan(0.02)
    expect(hi).toBeGreaterThan(0.98)
  })

  /**
   * ⚠️ A RING WITH NO GAP IN IT. n random angles leave clumps and holes, and a hole in a ring is
   * a safe side nobody chose to leave open — so they are spread evenly and then jittered. Checked
   * by asking that every direction has somebody coming from it.
   */
  it('and they come from every side', () => {
    const mobs = ringOf(24, 7, { x: 0, y: 0 }, 10)
    const eighths = new Set(
      mobs.map((m) => Math.floor(((Math.atan2(m.y, m.x) + Math.PI) / (Math.PI * 2)) * 8)),
    )
    expect(eighths.size).toBe(8)
  })

  it('and they start off at the distance they were asked for', () => {
    for (const m of ringOf(30, 3, { x: 5, y: 5 }, 10)) {
      const d = near(m, { x: 5, y: 5 })
      expect(d).toBeGreaterThan(10 * 0.8)
      expect(d).toBeLessThan(10 * 1.2)
    }
  })
})

describe('and then comes for you', () => {
  const run = (mobs: Mob[], seek: { x: number; y: number }, secs: number) => {
    let m = mobs
    for (let i = 0; i < secs * 60; i++) m = stepSwarm(m, seek, 1 / 60)
    return m
  }

  /**
   * ⚠️ AND STOPS NEXT TO YOU RATHER THAN INSIDE YOU — see Flock.reach. Nobody should end up at
   * the target's own coordinate: a crowd that converges on a point is a knot, and being stood
   * inside fifty things is not the same experience as being surrounded by them.
   */
  it('and crowds around you rather than into you', () => {
    const seek = { x: 0, y: 0 }
    const after = run(ringOf(40, 21, seek, 10), seek, 8)
    const closest = Math.min(...after.map((m) => near(m, seek)))
    expect(closest, 'something climbed inside the target').toBeGreaterThan(FLOCK.reach * 0.5)
  })

  it('closes the distance', () => {
    const seek = { x: 0, y: 0 }
    const start = ringOf(40, 11, seek, 10)
    const after = run(start, seek, 3)
    const was = start.reduce((n, m) => n + near(m, seek), 0) / start.length
    const now = after.reduce((n, m) => n + near(m, seek), 0) / after.length
    expect(now).toBeLessThan(was * 0.6)
  })

  /**
   * ⚠️ AND ARRIVES AS A CROWD RATHER THAN AS A COLUMN, which is the only reason separation is in
   * there. Without it every one of them takes the same straight line and fifty creatures are one
   * creature drawn fifty times — the thing that would make a swarm look broken while every
   * individual part of it was working.
   */
  it('and spreads out instead of stacking into one', () => {
    const seek = { x: 0, y: 0 }
    const after = run(ringOf(40, 12, seek, 10), seek, 6)
    let worst = Infinity
    for (let i = 0; i < after.length; i++)
      for (let j = i + 1; j < after.length; j++) worst = Math.min(worst, near(after[i], after[j]))
    /* they may crowd closer than `apart`, but they must not become the same creature */
    expect(worst).toBeGreaterThan(FLOCK.apart * 0.5)
  })

  /** ⚠️ and two in exactly the same place part, rather than staying welded together forever */
  it('and two in the same spot push apart', () => {
    const both: Mob[] = [
      { x: 1, y: 1, vx: 0, vy: 0 },
      { x: 1, y: 1, vx: 0, vy: 0 },
    ]
    const after = run(both, { x: 0, y: 0 }, 2)
    expect(near(after[0], after[1])).toBeGreaterThan(FLOCK.apart * 0.7)
  })

  /** ⚠️ and nobody runs away: a seek that pushed harder than it pulled would be a rout */
  it('and none of them ends up further away than it started', () => {
    const seek = { x: 0, y: 0 }
    const after = run(ringOf(30, 13, seek, 10), seek, 5)
    for (const m of after) expect(near(m, seek)).toBeLessThan(12)
  })

  it('and a zero step changes nothing', () => {
    const mobs = ringOf(5, 2, { x: 0, y: 0 }, 4)
    expect(stepSwarm(mobs, { x: 0, y: 0 }, 0)).toBe(mobs)
  })
})

describe('what is worth drawing', () => {
  /**
   * ⚠️ DRAWING IS CULLED AND THINKING IS NOT. The tempting version is the other way round, and it
   * is wrong: a minion that stops steering off screen arrives in a clump the moment it returns,
   * having spent that whole time not walking. Thinking fifty is free; drawing them is what cost
   * 42ms for ten before any of this existed.
   */
  it('keeps what is on screen and drops what is not', () => {
    const at = { x: 0, y: 0 }
    expect(onCamera({ x: 1, y: 1, vx: 0, vy: 0 }, at, 5, 3)).toBe(true)
    expect(onCamera({ x: 9, y: 1, vx: 0, vy: 0 }, at, 5, 3)).toBe(false)
    expect(onCamera({ x: 1, y: 9, vx: 0, vy: 0 }, at, 5, 3)).toBe(false)
  })

  it('and an off-screen one is still walking toward you', () => {
    const seek = { x: 0, y: 0 }
    const away = [{ x: 40, y: 0, vx: 0, vy: 0 }]
    expect(onCamera(away[0], seek, 5, 3)).toBe(false)
    let m = away
    for (let i = 0; i < 120; i++) m = stepSwarm(m, seek, 1 / 60)
    expect(m[0].x).toBeLessThan(40)
  })
})

describe('which frame of a baked strip', () => {
  /** ⚠️ the one part of baking with an off-by-one in it — invisible on screen at sixty a second */
  it('runs forward and wraps, and never leaves the strip', () => {
    expect(frameAt(8, 0)).toBe(0)
    expect(frameAt(8, 0.5)).toBe(4)
    expect(frameAt(8, 0.999)).toBe(7)
    expect(frameAt(8, 1)).toBe(0)
    expect(frameAt(8, 3.25)).toBe(2)
    for (const t of [-0.1, 0, 7.77, 1e6]) {
      const f = frameAt(8, t)
      expect(f).toBeGreaterThanOrEqual(0)
      expect(f).toBeLessThanOrEqual(7)
    }
  })

  it('and a one-frame strip is always frame zero', () => {
    expect(frameAt(1, 0.4)).toBe(0)
    expect(frameAt(0, 0.4)).toBe(0)
  })
})
