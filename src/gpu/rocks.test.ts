import { describe, expect, it } from 'vitest'
import {
  BULLET_LIFE,
  EMPTY,
  EXTRA_LIFE,
  FIRE_GAP,
  H,
  MAX_BULLETS,
  NO_INPUT,
  POINTS,
  RESPAWN,
  ROCK_R,
  SAFE,
  W,
  gap,
  newShip,
  newWorld,
  readSaved,
  step,
  waveRocks,
  wrap,
  type Rock,
  type Saved,
  type World,
} from './rocks'

const FRAME = 1 / 60
/** a field with only the rocks given, the ship in the middle and past its safe start */
function field(rocks: Partial<Rock>[], extra: Partial<World> = {}): World {
  const w = newWorld('normal', 1)
  return {
    ...w,
    ship: { ...newShip(), safe: 0 },
    rocks: rocks.map((r) => ({
      x: 2,
      y: 2,
      vx: 0,
      vy: 0,
      size: 3,
      spin: 0,
      turn: 0,
      shape: 1,
      ...r,
    })),
    ...extra,
  }
}
const run = (w: World, input = NO_INPUT, secs = 1) => {
  for (let t = 0; t < secs - 1e-9; t += FRAME) w = step(w, input, FRAME).world
  return w
}

describe('the field', () => {
  it('wraps round at every edge, and measures the short way round', () => {
    expect(wrap(-0.5, W)).toBeCloseTo(W - 0.5)
    expect(wrap(W + 1, W)).toBeCloseTo(1)
    expect(gap(0.5, 6, W - 0.5, 6)).toBeCloseTo(1)
    expect(gap(8, 0.2, 8, H - 0.2)).toBeCloseTo(0.4)
    // a ship flying off the right comes in on the left
    let w = field([{ x: 2, y: 10 }], { ship: { ...newShip(), x: W - 0.1, vx: 3, a: 0, safe: 0 } })
    w = step(w, NO_INPUT, 0.1).world
    expect(w.ship!.x).toBeLessThan(1)
  })
  it('starts each wave with more big rocks, none near the ship', () => {
    for (let s = 1; s <= 20; s++) {
      const w = newWorld('normal', s)
      expect(w.rocks).toHaveLength(waveRocks(1))
      for (const r of w.rocks) expect(gap(r.x, r.y, W / 2, H / 2)).toBeGreaterThan(4.5)
    }
    expect(waveRocks(2)).toBeGreaterThan(waveRocks(1))
  })
})

describe('the ship', () => {
  it('turns, thrusts the way it faces, and slows on its own', () => {
    let w = field([{ x: 1, y: 1 }], { ship: { ...newShip(), a: 0, safe: 0 } })
    w = run(w, { ...NO_INPUT, thrust: true }, 0.5)
    expect(w.ship!.vx).toBeGreaterThan(3)
    expect(Math.abs(w.ship!.vy)).toBeLessThan(1e-9)
    const v = w.ship!.vx
    w = run(w, NO_INPUT, 1)
    expect(w.ship!.vx).toBeLessThan(v)
    expect(w.ship!.vx).toBeGreaterThan(0)
    const a = w.ship!.a
    w = run(w, { ...NO_INPUT, right: true }, 0.25)
    expect(w.ship!.a).toBeGreaterThan(a)
  })
  it('fires no faster than its gun allows, no more than five at once, each for a while', () => {
    let w = field([{ x: 1, y: 1 }], { ship: { ...newShip(), a: Math.PI / 2, safe: 0 } })
    const fire = { ...NO_INPUT, fire: true }
    // held down for three gaps between shots: three bullets, all still flying
    w = run(w, fire, FIRE_GAP * 3)
    expect(w.bullets).toHaveLength(3)
    // held for longer: the gun stops at five in the air, and does reach five — a bullet lives
    // longer than five gaps, so the limit is what holds it
    expect(FIRE_GAP * MAX_BULLETS).toBeLessThan(BULLET_LIFE)
    let most = 0
    for (let t = 0; t < 2; t += FRAME) {
      w = step(w, fire, FRAME).world
      most = Math.max(most, w.bullets.length)
    }
    expect(most).toBe(MAX_BULLETS)
    // left alone, every bullet is gone after its life
    w = run(w, NO_INPUT, BULLET_LIFE + 0.05)
    expect(w.bullets).toHaveLength(0)
  })
})

describe('hitting', () => {
  it('splits a rock in two smaller ones and scores it; a small one is simply gone', () => {
    for (const size of [3, 2, 1] as const) {
      const w = field([
        { x: 8, y: 3, size },
        { x: 1, y: 11, size: 3 },
      ])
      const r = step({ ...w, bullets: [{ x: 8, y: 3.2, vx: 0, vy: -2, life: 1 }] }, NO_INPUT, FRAME)
      expect(r.world.score).toBe(POINTS[size])
      expect(r.happened.broke).toHaveLength(1)
      const pieces = r.world.rocks.filter((k) => k.size === size - 1 && gap(k.x, k.y, 8, 3) < 0.5)
      expect(pieces).toHaveLength(size === 1 ? 0 : 2)
      expect(r.world.bullets).toHaveLength(0)
    }
  })
  it('never lets a fast bullet pass through a small rock between frames', () => {
    // a small rock square in the path of a bullet with a ship's full speed behind it, over a slow
    // frame of a twentieth of a second that carries it 1.1 across — from anywhere it starts that
    // the frame carries it right past the rock
    for (let off = 0; off < 0.6; off += 0.02) {
      const w = field([
        { x: 8, y: 6, size: 1 },
        { x: 1, y: 11, size: 3 },
      ])
      const r = step(
        { ...w, bullets: [{ x: 7 + off, y: 6, vx: 22, vy: 0, life: 1 }] },
        NO_INPUT,
        1 / 20,
      )
      expect(r.happened.broke).toHaveLength(1)
    }
  })
  it('costs a life when a rock meets the ship, brings a new one safe once the middle clears, and ends at none', () => {
    // a rock drifting across the middle, away to the side
    let w = field([{ x: W / 2 + 0.5, y: H / 2, size: 2, vx: 2, vy: 0 }], { lives: 2 })
    const r = step(w, NO_INPUT, FRAME)
    expect(r.happened.lost).toBe(true)
    expect(r.world.ship).toBeNull()
    expect(r.world.lives).toBe(1)
    w = r.world
    // no new ship before the wait; then one
    w = run(w, NO_INPUT, RESPAWN * 0.5)
    expect(w.ship).toBeNull()
    // nor while a rock sits in the middle — looked at sooner than a new ship's safe time could run
    // out, since a ship that came anyway would be safe from the rock and still there
    const blocked = run(
      { ...w, rocks: [{ ...w.rocks[0], x: W / 2, y: H / 2, vx: 0 }] },
      NO_INPUT,
      RESPAWN + 1,
    )
    expect(blocked.ship).toBeNull()
    expect(blocked.lives).toBe(1)
    w = run(w, NO_INPUT, RESPAWN + 1)
    expect(w.ship).not.toBeNull()
    expect(w.ship!.safe).toBeGreaterThan(0)
    // while safe, a rock passes through it
    const safe = step(
      { ...w, rocks: [{ ...w.rocks[0], x: w.ship!.x, y: w.ship!.y }] },
      NO_INPUT,
      FRAME,
    )
    expect(safe.happened.lost).toBe(false)
    expect(SAFE).toBeGreaterThan(1)
    // the last life
    const last = field([{ x: W / 2, y: H / 2, size: 3 }], { lives: 1 })
    const end = step(last, NO_INPUT, FRAME).world
    expect(end.over).toBe(true)
    expect(step(end, { ...NO_INPUT, fire: true }, FRAME).world).toBe(end)
  })
  it('gives a ship more every ten thousand, and a new wave when the field is clear', () => {
    const w = field([{ x: 8, y: 3, size: 1 }], { score: EXTRA_LIFE - 50, lives: 2, wave: 3 })
    const r = step({ ...w, bullets: [{ x: 8, y: 3.2, vx: 0, vy: -1, life: 1 }] }, NO_INPUT, FRAME)
    expect(r.happened.extra).toBe(true)
    expect(r.world.lives).toBe(3)
    expect(r.happened.wave).toBe(true)
    expect(r.world.wave).toBe(4)
    expect(r.world.rocks).toHaveLength(waveRocks(4))
    expect(r.world.rocks.every((k) => k.size === 3 && k.x >= 0 && k.x < W)).toBe(true)
  })
})

describe('a game', () => {
  it('is the same from the same seed, faster on a wilder pace, and does not change the world it was given', () => {
    expect(newWorld('normal', 5)).toEqual(newWorld('normal', 5))
    const speed = (w: World) => w.rocks.reduce((s, r) => s + Math.hypot(r.vx, r.vy), 0)
    let calm = 0
    let wild = 0
    for (let s = 1; s <= 20; s++) {
      calm += speed(newWorld('calm', s))
      wild += speed(newWorld('wild', s))
    }
    expect(wild).toBeGreaterThan(calm * 1.5)
    const w = newWorld('normal', 9)
    const before = JSON.stringify(w)
    step(w, { left: true, right: false, thrust: true, fire: true }, 0.1)
    expect(JSON.stringify(w)).toBe(before)
    // a rock is never smaller than the radius drawn for its size, nor bigger
    expect(ROCK_R[3]).toBeGreaterThan(ROCK_R[2])
  })
})

describe('what is kept', () => {
  it('round-trips every field that is not a default', () => {
    const s: Saved = {
      pace: 'wild',
      look: 'paper',
      best: { calm: 3, normal: 12000, wild: 40 },
      games: 7,
    }
    for (const k of Object.keys(s) as (keyof Saved)[]) expect(s[k]).not.toEqual(EMPTY[k])
    expect(readSaved(JSON.stringify(s))).toEqual(s)
    expect(readSaved('{"pace":"fast","look":"gold","best":{"calm":-1}}')).toEqual(EMPTY)
  })
})
