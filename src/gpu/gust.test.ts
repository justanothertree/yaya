import { describe, expect, it } from 'vitest'
import code from './gust.wgsl?raw'
import {
  BOUNCE,
  BUMPERS,
  DRAG,
  EMPTY,
  FAN_PUSH,
  FAN_R,
  FAN_SPEED,
  FIRST_TO,
  GOAL,
  H,
  JET,
  KICKOFF,
  PUCK_R,
  REFILL,
  RINK,
  SLOPE,
  TIP,
  W,
  brain,
  breathe,
  goal,
  inHalf,
  REACH,
  FAN_BODY,
  kickoff,
  newMatch,
  packRink,
  rinkFit,
  steer,
  stepPuck,
  type Fan,
  type Puck,
} from './gust'
import { wgslLayout } from './wgslLayout'

const fan = (x: number, y: number, breath = 1): Fan => ({ x, y, blowing: false, breath })
const run = (p: Puck, air: [number, number], seconds: number) => {
  let into = -1
  for (let t = 0; t < seconds && into < 0; t += 1 / 60) into = stepPuck(p, air, 1 / 60)
  return into
}

describe('the rink uniform', () => {
  const wgsl = wgslLayout(code, 'Rink')
  it('agrees with the shader about where every field lives, and writes each where it is read', () => {
    const { bytes, ...rest } = RINK
    expect(wgsl.offsets).toEqual(rest)
    expect(wgsl.bytes).toBe(bytes)
    const v = new DataView(
      packRink({
        w: 640,
        h: 360,
        fans: [
          { x: 11, y: 12, blowing: true, breath: 0.25 },
          { x: 131, y: 72, blowing: false, breath: 0.75 },
        ],
        dt: 0.5,
        time: 3,
        pause: true,
      }),
    )
    const f = (o: number) => v.getFloat32(o, true)
    const u = (o: number) => v.getUint32(o, true)
    expect([u(RINK.size), u(RINK.size + 4), u(RINK.grid), u(RINK.grid + 4)]).toEqual([
      640,
      360,
      W,
      H,
    ])
    expect([0, 4, 8, 12].map((k) => f(RINK.fan0 + k))).toEqual([11, 12, 1, 0.25])
    expect([0, 4, 8, 12].map((k) => f(RINK.fan1 + k))).toEqual([131, 72, 0, 0.75])
    expect([f(RINK.dt), f(RINK.time), u(RINK.pause)]).toEqual([0.5, 3, 1])
  })
  it('carries the shader’s copies of the rules: the same puck, goal, posts and fan', () => {
    const num = (name: string) => Number(new RegExp(`const ${name} = ([0-9.]+);`).exec(code)?.[1])
    expect(
      ['PUCK_R', 'DRAG', 'BOUNCE', 'GOAL', 'FAN_R', 'JET', 'FAN_PUSH', 'SLOPE', 'TIP'].map(num),
    ).toEqual([PUCK_R, DRAG, BOUNCE, GOAL, FAN_R, JET, FAN_PUSH, SLOPE, TIP])
    const posts = /const BUMPERS = array\((.*)\);/.exec(code)?.[1] ?? ''
    expect(
      [...posts.matchAll(/vec3f\(([^)]*)\)/g)].map((m) => m[1].split(',').map(Number)),
    ).toEqual(BUMPERS)
  })
})

describe('the puck', () => {
  it('drops into a goal mouth it has crept up to, rather than sitting on the line', () => {
    const p = { x: SLOPE - 1, y: H / 2, vx: 0, vy: 0 }
    expect(run(p, [0, 0], 3)).toBe(0)
    const q = { x: W - SLOPE + 1, y: H / 2 + 3, vx: 0, vy: 0 }
    expect(run(q, [0, 0], 3)).toBe(1)
    // the slope is only in the mouth: beside it, a slow puck stays where it is
    const r = { x: SLOPE - 1, y: 10, vx: 0, vy: 0 }
    expect(run(r, [0, 0], 3)).toBe(-1)
    expect(r.x).toBe(SLOPE - 1)
  })
  it('sits still in still air and is carried to the air’s own speed', () => {
    const p = kickoff(-1)
    run(p, [0, 0], 2)
    expect([p.x, p.y]).toEqual([W / 2, H / 2])
    const q = { x: 30, y: 20, vx: 0, vy: 0 }
    run(q, [0, 10], 2)
    // drag 3.2/s: after two seconds the puck is within e^-6.4 of the air's speed
    expect(q.vy).toBeCloseTo(10 * (1 - Math.exp(-3.2 * 2)), 0)
  })
  it('bounces off a side wall losing some speed, and never ends up inside it', () => {
    const p = { x: 30, y: PUCK_R + 0.5, vx: 0, vy: -40 }
    stepPuck(p, [0, -40], 1 / 60)
    expect(p.y).toBe(PUCK_R)
    expect(p.vy).toBeGreaterThan(0)
    expect(p.vy).toBeLessThan(40)
  })
  it('bounces off an end wall above the goal, but goes through the goal mouth and scores', () => {
    const high = { x: PUCK_R + 0.5, y: 10, vx: -50, vy: 0 }
    expect(stepPuck(high, [-50, 0], 1 / 60)).toBe(-1)
    expect(high.vx).toBeGreaterThan(0)
    const mid = { x: 20, y: H / 2, vx: -50, vy: 0 }
    expect(run(mid, [-50, 0], 3)).toBe(0)
    const other = { x: W - 20, y: H / 2 + GOAL - PUCK_R, vx: 50, vy: 0 }
    expect(run(other, [50, 0], 3)).toBe(1)
  })
  it('a shot just outside the goal mouth is kept out', () => {
    const p = { x: 20, y: H / 2 + GOAL, vx: -50, vy: 0 }
    expect(run(p, [-50, 0], 3)).toBe(-1)
    expect(p.x).toBeGreaterThanOrEqual(PUCK_R)
  })
  it('goes round a post rather than through it', () => {
    const [bx, by, br] = BUMPERS[0]
    const p = { x: bx - 20, y: by, vx: 40, vy: 0 }
    let closest = Infinity
    for (let k = 0; k < 120; k++) {
      stepPuck(p, [40, 0], 1 / 60)
      closest = Math.min(closest, Math.hypot(p.x - bx, p.y - by))
    }
    expect(closest).toBeGreaterThanOrEqual(br + PUCK_R - 1e-9)
    expect(p.vx).toBeLessThan(40)
  })
})

describe('the fans', () => {
  it('a breath empties in EMPTY seconds of blowing and fills in REFILL', () => {
    const f = fan(10, 10)
    let blown = 0
    while (f.breath > 0 && blown < 10) {
      breathe(f, true, 1 / 60)
      blown += 1 / 60
    }
    expect(blown).toBeCloseTo(EMPTY, 1)
    breathe(f, true, 1 / 60)
    expect(f.blowing).toBe(false)
    let rest = 0
    while (f.breath < 1) {
      breathe(f, false, 1 / 60)
      rest += 1 / 60
    }
    expect(rest).toBeCloseTo(REFILL, 1)
  })
  it('reach 15% of the rink past halfway, so both can stand in the middle, and no faster than FAN_SPEED', () => {
    const f = fan(20, 45)
    steer(f, 0, [W - 5, -30], 0.1)
    expect(Math.hypot(f.x - 20, f.y - 45)).toBeCloseTo(FAN_SPEED * 0.1, 6)
    for (let k = 0; k < 200; k++) steer(f, 0, [W - 5, -30], 0.1)
    expect([f.x, f.y]).toEqual(inHalf(0, [W, 0]))
    // 15% of the rink is 24 cells: Blue reaches x = 104 of 160, and no further
    expect(REACH).toBe(24)
    expect(f.x).toBeCloseTo(W / 2 + 0.15 * W, 6)
    const g = fan(W - 20, 45)
    for (let k = 0; k < 200; k++) steer(g, 1, [0, H + 10], 0.1)
    expect(g.x).toBeCloseTo(W / 2 - 0.15 * W, 6)
    expect(g.y).toBeLessThan(H)
    // the middle belongs to both
    expect(inHalf(0, [W / 2, H / 2])[0]).toBe(W / 2)
    expect(inHalf(1, [W / 2, H / 2])[0]).toBe(W / 2)
  })
  it('cannot pass through a post: driven straight at one, a fan stops against it', () => {
    for (const [bx, by, br] of BUMPERS) {
      const side = bx < W / 2 ? 0 : 1
      const f = fan(bx - 20, by)
      for (let k = 0; k < 120; k++) {
        steer(f, side, [bx + 20, by], 1 / 60)
        expect(Math.hypot(f.x - bx, f.y - by), `post at ${bx},${by}`).toBeGreaterThanOrEqual(
          br + FAN_BODY - 1e-6,
        )
      }
    }
  })
})

describe('the computer', () => {
  it('stands behind the puck as seen from the goal it shoots at, and blows only once there', () => {
    const p = { x: 110, y: 30, vx: 0, vy: 0 }
    const far = fan(W - 10, 80)
    const plan = brain(p, far)
    // its spot, the puck and the left goal are in a line, with the puck between
    const toGoal = Math.atan2(H / 2 - p.y, 0 - p.x)
    const fromSpot = Math.atan2(p.y - plan.at[1], p.x - plan.at[0])
    expect(Math.abs(toGoal - fromSpot)).toBeLessThan(1e-6)
    expect(plan.blow).toBe(false)
    const there = fan(plan.at[0], plan.at[1])
    expect(brain(p, there).blow).toBe(true)
    expect(brain(p, fan(plan.at[0], plan.at[1], 0.1)).blow).toBe(false)
  })
  it('presses forward when the puck is out of reach on the other side, rather than waiting at home', () => {
    // Evan, 9 Nov: "the computer enemy doesn't try to score, he only plays defense"
    const plan = brain({ x: 30, y: 60, vx: 0, vy: 0 }, fan(120, 45))
    expect(plan.at[0]).toBe(W / 2 - REACH)
    expect(plan.at[1]).toBe(60)
    expect(plan.blow).toBe(false) // still beyond its jet
    // and blows once the puck comes within reach of where it presses
    const close = { x: W / 2 - REACH - JET + 4, y: 50, vx: 0, vy: 0 }
    expect(brain(close, fan(W / 2 - REACH, 50)).blow).toBe(true)
  })
  it('guards its goal when the puck is coming at it fast from out of reach', () => {
    // within reach it would meet the puck from behind and blow it back, which is better than
    // waiting; from out of reach, getting home first is all it can do
    const plan = brain({ x: 30, y: 40, vx: 60, vy: 0 }, fan(100, 45))
    expect(plan.at[0]).toBeGreaterThan(W - 20)
    expect(plan.blow).toBe(false)
  })
  it('still shoots from its own side of the line at a puck just over it, within the jet', () => {
    const p = { x: W / 2 - 6, y: H / 2, vx: 0, vy: 0 }
    const plan = brain(p, fan(W - 10, 10))
    expect(plan.at[0]).toBeGreaterThan(W / 2)
    expect(Math.hypot(plan.at[0] - p.x, plan.at[1] - p.y)).toBeLessThanOrEqual(JET)
    expect(brain(p, fan(plan.at[0], plan.at[1])).blow).toBe(true)
  })
})

describe('a match', () => {
  it('scores to the side that did NOT concede, kicks off toward the side that did, and ends at FIRST_TO', () => {
    const m = newMatch()
    expect(m.pause).toBe(KICKOFF)
    const p = { x: -10, y: H / 2, vx: -9, vy: 0 }
    goal(m, 0, p)
    expect(m.score).toEqual([0, 1])
    expect(p).toEqual({ x: W / 2 - 6, y: H / 2, vx: 0, vy: 0 })
    expect(m.pause).toBe(KICKOFF)
    for (let k = 0; k < FIRST_TO - 1; k++) goal(m, 1, p)
    expect(m.score).toEqual([FIRST_TO - 1, 1])
    expect(m.winner).toBe(-1)
    goal(m, 1, p)
    expect(m.winner).toBe(0)
  })
})

describe('the rink on a stage', () => {
  it('fills a wide stage the right way up, the middle at the middle', () => {
    expect(rinkFit([1720, 960], [860, 480])).toEqual([W / 2, H / 2])
    // 10 px a cell: the left end of the rink is 60 px in, its top 30 px down
    const [x, y] = rinkFit([1720, 960], [60, 30])
    expect(x).toBeCloseTo(0, 9)
    expect(y).toBeCloseTo(0, 9)
  })
  it('stands upright on a tall one, Blue’s goal at the bottom, turned and not mirrored', () => {
    const size: [number, number] = [960, 1720]
    expect(rinkFit(size, [480, 860])).toEqual([W / 2, H / 2])
    const bottom = rinkFit(size, [480, 1660])
    const top = rinkFit(size, [480, 60])
    expect(bottom[0]).toBeCloseTo(0, 9)
    expect(top[0]).toBeCloseTo(W, 9)
    // a turn keeps handedness: rink +x is screen up, so rink +y must be screen right
    const right = rinkFit(size, [580, 860])
    expect(right[0]).toBeCloseTo(W / 2, 9)
    expect(right[1]).toBeGreaterThan(H / 2)
  })
})
