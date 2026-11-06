import { describe, expect, it } from 'vitest'
import code from './mobius.wgsl?raw'
import {
  ACES,
  BALL_R,
  CAPTURE,
  COURSE,
  HOLES,
  HOLE_R,
  S,
  SPACES,
  SPACE_IDS,
  WALL_R,
  cross,
  fold,
  launch,
  packCourse,
  roll,
  stepBall,
  toCover,
  type Ball,
  type Hole,
  type Space,
  type V2,
} from './mobius'
import { wgslLayout } from './wgslLayout'

const ball = (x: number, y: number, vx = 0, vy = 0): Ball => ({ x, y, vx, vy, flipped: 0 })
const open: Hole = {
  name: '',
  hint: '',
  tee: [5, 5],
  cup: [-50, -50],
  walls: [],
  spaces: [],
  par: 2,
}

describe('gluing', () => {
  it('a wrap brings the ball back in at the other side, the same way up', () => {
    const b = ball(10.05, 3, 4, 1)
    cross(b, SPACES.cylinder)
    expect(b.x).toBeCloseTo(0.05, 9)
    expect([b.y, b.vx, b.vy, b.flipped]).toEqual([3, 4, 1, 0])
  })
  it('a twist brings it back upside down, moving the mirrored way, and it is now its own mirror image', () => {
    const b = ball(-0.05, 3, -4, 1)
    cross(b, SPACES.mobius)
    expect(b.x).toBeCloseTo(9.95, 9)
    expect([b.y, b.vx, b.vy, b.flipped]).toEqual([7, -4, -1, 1])
    // twice round a Möbius band is the right way up again
    b.x = -0.05
    cross(b, SPACES.mobius)
    expect([b.y, b.vy, b.flipped]).toEqual([3, 1, 0])
  })
  it('the top and bottom of a Klein bottle wrap straight, while its sides twist', () => {
    const b = ball(4, 10.02, 0, 3)
    cross(b, SPACES.klein)
    expect([b.x, b.vx, b.flipped]).toEqual([4, 0, 0])
    expect(b.y).toBeCloseTo(0.02, 9)
  })
  it('a wall edge is never crossed: the ball banks off it', () => {
    const b = ball(S - BALL_R - 0.001, 5, 6, 0)
    for (let k = 0; k < 10; k++) stepBall(b, open, SPACES.room)
    expect(b.x).toBeLessThan(S)
    expect(b.vx).toBeLessThan(0)
  })
})

describe('the cover', () => {
  it('folds every copy back into the course, and a ball rolled straight through the copies agrees with it', () => {
    // a long straight roll in the plane, and the same roll in the course crossing its edges: at each
    // step, the plane's point folded back is where the course's ball is
    for (const id of SPACE_IDS) {
      const sp: Space = SPACES[id]
      if (sp.x === 'wall' || sp.y === 'wall') continue
      const b = ball(2, 3, 7, 5)
      let p: V2 = [2, 3]
      for (let k = 0; k < 2000; k++) {
        b.x += b.vx / 240
        b.y += b.vy / 240
        cross(b, sp)
        p = [p[0] + 7 / 240, p[1] + 5 / 240]
        const f = fold(p, sp)!
        // a point on a seam is the same point read from either side (10 and 0): skip the seam itself
        const onSeam = [b.x, b.y, ...f.at].some((v) => v < 1e-6 || v > S - 1e-6)
        if (onSeam) continue
        expect(Math.hypot(f.at[0] - b.x, f.at[1] - b.y), `${id} step ${k}`).toBeLessThan(1e-6)
        expect(f.flipped, `${id} step ${k}`).toBe(b.flipped)
      }
    }
  })
  it('has no copies beyond a wall edge, and only the course itself in a room', () => {
    expect(fold([5, 5], SPACES.room)?.at).toEqual([5, 5])
    expect(fold([15, 5], SPACES.room)).toBeNull()
    expect(fold([15, 5], SPACES.cylinder)?.at).toEqual([5, 5])
    expect(fold([5, 15], SPACES.cylinder)).toBeNull()
    expect(fold([15, 2], SPACES.mobius)?.at).toEqual([5, 8])
  })
})

describe('the ball', () => {
  it('rolls to a stop at the distance its speed and the green allow (v² / 2a)', () => {
    const r = roll(open, SPACES.room, [1, 5], { angle: 0, power: 0.4 })
    const v = 0.4 * 14
    expect(r.end).toBe('stopped')
    expect(r.ball.x - 1).toBeCloseTo((v * v) / (2 * 2.2), 0)
  })
  it('drops into the cup when slow enough over it, and runs over it when too fast', () => {
    const h = { ...open, cup: [8, 5] as V2 }
    const slow = ball(7.7, 5, 2, 0)
    let r = null
    for (let k = 0; k < 100 && !r; k++) r = stepBall(slow, h, SPACES.room)
    expect(r).toBe('in')
    const fast = ball(7.7, 5, CAPTURE + 4, 0)
    let s = null
    for (let k = 0; k < 40 && s !== 'in'; k++) s = stepBall(fast, h, SPACES.room)
    expect(s).not.toBe('in')
    expect(HOLE_R).toBeGreaterThan(BALL_R)
  })
  it('banks off a wall rather than passing through it', () => {
    const h = { ...open, walls: [[5, 0, 5, 10]] as Hole['walls'] }
    const r = roll(h, SPACES.room, [2, 5], { angle: 0, power: 1 })
    expect(r.path.every(([x]) => x < 5 - WALL_R)).toBe(true)
  })
})

describe('the course', () => {
  it('every hole is aced by its stored shot in its stored space, and the ace is in a space the hole offers', () => {
    expect(ACES).toHaveLength(HOLES.length)
    HOLES.forEach((h, k) => {
      const a = ACES[k]
      expect(h.spaces, h.name).toContain(a.space)
      expect(roll(h, SPACES[a.space], h.tee, a.shot).end, h.name).toBe('in')
      expect(h.walls.length).toBeLessThanOrEqual(16)
    })
  })
  it('the space is the puzzle: the first four holes cannot be aced at all in the other space they offer', () => {
    // a sweep of 120 directions × 23 strengths, in the space that is not the answer
    for (let k = 0; k < 4; k++) {
      const h = HOLES[k]
      const other = h.spaces.find((s) => s !== ACES[k].space)!
      let aces = 0
      for (let a = 0; a < 360; a += 3)
        for (let p = 0.12; p <= 1.0001; p += 0.04)
          if (roll(h, SPACES[other], h.tee, { angle: (a * Math.PI) / 180, power: p }).end === 'in')
            aces++
      expect(aces, `${h.name} in the ${other}`).toBe(0)
    }
  })
  it('a ball left on the tee is not in', () => {
    for (const h of HOLES)
      expect(roll(h, SPACES.room, h.tee, { angle: 0, power: 0 }).end).toBe('stopped')
  })
  it('launch sets the speed the power asks for, along the angle', () => {
    const b = launch([1, 1], { angle: Math.PI / 2, power: 0.5 })
    expect(b.vx).toBeCloseTo(0, 9)
    expect(b.vy).toBeCloseTo(7, 9)
  })
})

describe('for the GPU', () => {
  it('the uniform agrees with the shader about where every field lives, and is written where read', () => {
    const wgsl = wgslLayout(code, 'Course')
    const { bytes, ...rest } = COURSE
    expect(wgsl.offsets).toEqual(rest)
    expect(wgsl.bytes).toBe(bytes)
    const v = new DataView(
      packCourse({
        w: 640,
        h: 360,
        space: SPACES.klein,
        ball: { x: 1, y: 2, vx: 0, vy: 0, flipped: 1 },
        spin: 0.5,
        cup: [7, 8],
        aim: [0.25, -0.75],
        view: [5, 6],
        span: 17,
        walls: 3,
        path: 40,
        time: 9,
      }),
    )
    const f = (o: number) => v.getFloat32(o, true)
    const u = (o: number) => v.getUint32(o, true)
    expect([u(0), u(4), u(COURSE.glue), u(COURSE.glue + 4)]).toEqual([640, 360, 2, 1])
    expect([0, 4, 8, 12].map((k) => f(COURSE.ball + k))).toEqual([1, 2, 0.5, 17])
    expect([f(COURSE.cup), f(COURSE.cup + 4), f(COURSE.aim), f(COURSE.aim + 4)]).toEqual([
      7, 8, 0.25, -0.75,
    ])
    expect([f(COURSE.view), f(COURSE.view + 4)]).toEqual([5, 6])
    expect([u(COURSE.walls), u(COURSE.path), f(COURSE.time), u(COURSE.flipped)]).toEqual([
      3, 40, 9, 1,
    ])
  })
  it('carries the shader’s copies of the sizes', () => {
    const num = (name: string) => Number(new RegExp(`const ${name} = ([0-9.]+);`).exec(code)?.[1])
    expect(['S', 'BALL_R', 'HOLE_R', 'WALL_R'].map(num)).toEqual([S, BALL_R, HOLE_R, WALL_R])
  })
  it('puts the camera’s point at the middle of the stage, y up', () => {
    expect(toCover([800, 400], [5, 5], 20, [400, 200])).toEqual([5, 5])
    const up = toCover([800, 400], [5, 5], 20, [400, 0])
    expect(up[1]).toBeCloseTo(15, 9)
  })
})
