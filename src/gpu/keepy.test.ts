import { describe, expect, it } from 'vitest'
import { rng } from './bricks'
import {
  EMPTY,
  GRAVITY,
  H,
  HIGH,
  JOINS,
  R,
  REACH,
  RISE,
  W,
  ZONE,
  autoplay,
  breezeAt,
  kickLowest,
  kickSpeed,
  newWorld,
  readSaved,
  step,
  tap,
  type Ball,
  type Saved,
  type World,
} from './keepy'

const ball = (x: number, y: number, vx = 0, vy = -0.5): Ball => ({ x, y, vx, vy, wait: 0, spin: 0 })
const world = (balls: Ball[], kind: World['kind'] = 'beach'): World => ({
  ...newWorld(kind),
  balls,
})
const run = (w: World, seconds: number, dt = 1 / 600) => {
  for (let t = 0; t < seconds - 1e-9 && !w.over; t += dt) w = step(w, dt)
  return w
}

describe('a ball', () => {
  it('falls as the ground pulls it, and the game is over when it lands', () => {
    for (const kind of ['balloon', 'beach', 'football'] as const) {
      const g = GRAVITY[kind]
      const w0 = world([ball(0.5, 1, 0, 0)], kind)
      // from rest at 1 to touching the ground at R takes sqrt(2 (1 - R) / g)
      const t = Math.sqrt((2 * (1 - R)) / g)
      expect(run(w0, t - 0.01).over).toBe(false)
      expect(run(w0, t + 0.01).over).toBe(true)
    }
    expect(GRAVITY.balloon).toBeLessThan(GRAVITY.beach)
    expect(GRAVITY.beach).toBeLessThan(GRAVITY.football)
  })
  it('bounces off the walls and the top, and keeps inside the field', () => {
    let w = world([ball(0.1, 0.8, -2, 0.5)])
    w = run(w, 0.1)
    expect(w.balls[0].vx).toBeGreaterThan(0)
    expect(w.balls[0].x).toBeGreaterThanOrEqual(R)
    w = run(world([ball(0.9, 0.8, 2, 0.5)]), 0.1)
    expect(w.balls[0].vx).toBeLessThan(0)
    expect(w.balls[0].x).toBeLessThanOrEqual(W - R)
    w = run(world([ball(0.5, H - 0.1, 0, 3)]), 0.1)
    expect(w.balls[0].vy).toBeLessThan(0)
    expect(w.balls[0].y).toBeLessThanOrEqual(H - R)
  })
  it('knocks another without making or losing sideways or upward push', () => {
    const p = ball(0.5, 0.8, 0.3, -0.2)
    const q = ball(0.5 + R * 1.5, 0.8 + R * 0.5, -0.4, 0.1)
    const before = [p.vx + q.vx, p.vy + q.vy]
    const w = step(world([p, q]), 1e-9)
    expect(w.balls[0].vx + w.balls[1].vx).toBeCloseTo(before[0], 6)
    expect(w.balls[0].vy + w.balls[1].vy).toBeCloseTo(before[1], 6)
    expect(Math.hypot(w.balls[0].x - w.balls[1].x, w.balls[0].y - w.balls[1].y)).toBeCloseTo(
      R * 2,
      9,
    )
  })
})

describe('a kick', () => {
  it('sends a ball up as far as RISE, whatever it weighs', () => {
    for (const kind of ['balloon', 'beach', 'football'] as const) {
      const k = tap(world([ball(0.5, 0.3)], kind), { x: 0.5, y: 0.3 })!
      let w = k.world
      let top = 0
      for (let i = 0; i < 4000 && w.balls[0].vy >= 0; i++) {
        w = step(w, 1 / 2000)
        top = Math.max(top, w.balls[0].y)
      }
      expect(top - 0.3).toBeCloseTo(RISE, 2)
      expect(kickSpeed(kind)).toBeCloseTo(Math.sqrt(2 * GRAVITY[kind] * RISE), 9)
    }
  })
  it('goes away from the side it was tapped on', () => {
    const w = world([ball(0.5, 0.4)])
    expect(tap(w, { x: 0.5 - R, y: 0.4 })!.world.balls[0].vx).toBeGreaterThan(0.2)
    expect(tap(w, { x: 0.5 + R, y: 0.4 })!.world.balls[0].vx).toBeLessThan(-0.2)
    expect(tap(w, { x: 0.5, y: 0.4 })!.world.balls[0].vx).toBe(0)
  })
  it('reaches only a falling ball within a finger of the tap, and not twice at once', () => {
    const w = world([ball(0.5, 0.4)])
    expect(tap(w, { x: 0.5 + REACH * 1.05, y: 0.4 })).toBeNull()
    expect(tap(w, { x: 0.5 + REACH * 0.95, y: 0.4 })).not.toBeNull()
    expect(tap(world([ball(0.5, 0.4, 0, 0.5)]), { x: 0.5, y: 0.4 })).toBeNull()
    const kicked = tap(w, { x: 0.5, y: 0.4 })!.world
    // knocked back down by another ball straight after, it still cannot be kicked again at once
    const back = { ...kicked, balls: [{ ...kicked.balls[0], vy: -1 }] }
    expect(tap(back, { x: 0.5, y: 0.4 })).toBeNull()
    // and once the moment has passed, it can
    const later = run({ ...kicked, balls: [{ ...kicked.balls[0], y: 1, vy: -0.2 }] }, 0.26)
    expect(later.over).toBe(false)
    expect(tap(later, { x: later.balls[0].x, y: later.balls[0].y })).not.toBeNull()
  })
  it('scores one, or two from high up', () => {
    expect(tap(world([ball(0.5, 0.4)]), { x: 0.5, y: 0.4 })!.points).toBe(1)
    expect(tap(world([ball(0.5, HIGH + 0.05)]), { x: 0.5, y: HIGH + 0.05 })!.points).toBe(2)
  })
  it('brings in another ball at each mark', () => {
    let w = world([ball(0.5, 0.4)])
    for (let k = 1; k <= 41; k++) {
      w = { ...w, balls: w.balls.map((b, i) => (i === 0 ? { ...b, vy: -0.5, wait: 0 } : b)) }
      w = tap(w, { x: w.balls[0].x, y: w.balls[0].y })!.world
      const want = 1 + JOINS.filter((j) => j <= k).length
      expect(w.balls).toHaveLength(want)
    }
  })
  it('from the keyboard, takes the lowest falling ball inside the zone', () => {
    const w = world([ball(0.3, ZONE - 0.1), ball(0.7, ZONE - 0.3), ball(0.5, 0.1, 0, 0.5)])
    const k = kickLowest(w, 1)!
    expect(k.ball).toBe(1)
    expect(k.world.balls[1].vx).toBeCloseTo(0.55, 9)
    expect(kickLowest(world([ball(0.5, ZONE + 0.05)]), 0)).toBeNull()
  })
})

describe('the breeze', () => {
  it('is still when it is off, the same for the same seed, and moves a light ball most', () => {
    expect(breezeAt(newWorld('beach', false, 3), 5)).toBe(0)
    expect(breezeAt(newWorld('beach', true, 3), 5)).toBe(breezeAt(newWorld('beach', true, 3), 5))
    const seed = 7
    const at = (kind: World['kind']) => {
      const w0 = newWorld(kind, true, seed)
      return run({ ...w0, t: 1, balls: [ball(0.5, 1, 0, 0)] }, 0.2).balls[0].vx
    }
    expect(Math.abs(at('balloon'))).toBeGreaterThan(Math.abs(at('beach')))
    expect(Math.abs(at('beach'))).toBeGreaterThan(Math.abs(at('football')))
  })
})

describe('can be played', () => {
  it('a steady player keeps the light balls up for two minutes, breeze or none', () => {
    // measured: the balloon and the beach ball stay up for three minutes on every seed tried, with
    // all three balls in play; the football, heaviest, sometimes beats it
    for (const kind of ['balloon', 'beach'] as const)
      for (const breeze of [false, true]) {
        const w = autoplay(newWorld(kind, breeze, 101), 120, 0.3, rng(1))
        expect(w.over).toBe(false)
        expect(w.balls).toHaveLength(3)
      }
  })
})

describe('what is kept', () => {
  it('round-trips every field that is not a default', () => {
    const s: Saved = {
      ball: 'football',
      field: 'night',
      breeze: true,
      best: {
        balloon: { calm: 40, breezy: 31 },
        beach: { calm: 22, breezy: 12 },
        football: { calm: 9, breezy: 4 },
      },
      played: 17,
    }
    for (const k of Object.keys(s) as (keyof Saved)[]) expect(s[k]).not.toEqual(EMPTY[k])
    expect(readSaved(JSON.stringify(s))).toEqual(s)
  })
  it('falls back on anything it does not recognise', () => {
    expect(readSaved('{"ball":"bowling","breeze":1,"played":-3}')).toEqual(EMPTY)
    expect(readSaved('null')).toEqual(EMPTY)
  })
})
