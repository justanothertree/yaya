import { describe, expect, it } from 'vitest'
import code from './pinball.wgsl?raw'
import {
  BALLS,
  BALL_R,
  BUMPER_KICK,
  BUMPER_R,
  DEFAULT_TABLE,
  FLIP,
  FRAME,
  HZ,
  LANE_X,
  LIMITS,
  MAX_SPEED,
  PIN,
  SCORE,
  TARGET_R,
  W,
  H,
  WALL_R,
  addPart,
  buildable,
  distanceAt,
  erase,
  flipperSeg,
  itemsOf,
  newGame,
  packPin,
  plunge,
  readTable,
  restFlippers,
  segmentsOf,
  step,
  swing,
  tableFit,
  type Game,
  type Table,
  type V2,
} from './pinball'
import { wgslLayout } from './wgslLayout'

const empty: Table = { name: 'Empty', walls: [], bumpers: [], targets: [] }
const none = { left: false, right: false }
/** a ball put in play at p with velocity v */
const inPlay = (t: Table, p: V2, v: V2 = [0, 0]): Game => {
  const g = newGame(t)
  g.waiting = false
  Object.assign(g.ball, { x: p[0], y: p[1], vx: v[0], vy: v[1] })
  return g
}
const run = (
  g: Game,
  t: Table,
  seconds: number,
  held: (g: Game, s: number) => { left: boolean; right: boolean } = () => none,
) => {
  const f = restFlippers()
  const seen: Game['hits'] = []
  let maxY = -Infinity
  for (let k = 0; k < seconds * HZ; k++) {
    step(g, t, f, held(g, k / HZ))
    seen.push(...g.hits)
    maxY = Math.max(maxY, g.ball.y)
    if (g.over) break
  }
  return { seen, maxY }
}

describe('the flippers', () => {
  it('swing up fast and fall back slower, stopping at their ends', () => {
    const f = restFlippers()
    swing(f, { left: true, right: false }, 0.01)
    expect(f.left).toBeCloseTo(FLIP.rest + FLIP.swing * 0.01, 9)
    expect(f.leftV).toBeCloseTo(FLIP.swing, 6)
    for (let k = 0; k < 20; k++) swing(f, { left: true, right: false }, 0.01)
    expect(f.left).toBe(FLIP.up)
    expect(f.leftV).toBe(0)
    swing(f, { left: false, right: false }, 0.01)
    expect(f.leftV).toBeCloseTo(-FLIP.fall, 6)
    expect(f.right).toBe(FLIP.rest)
  })
  it('are mirror images: the right one points left and lifts the same way', () => {
    const f = restFlippers()
    const l = flipperSeg(f, 'left')
    const r = flipperSeg(f, 'right')
    const mid = (FLIP.left[0] + FLIP.right[0]) / 2
    expect(r.b[0] - mid).toBeCloseTo(mid - l.b[0], 9)
    expect(r.b[1]).toBeCloseTo(l.b[1], 9)
    // the drain between the tips is wider than a ball, so an untouched ball can be lost
    expect(r.b[0] - l.b[0] - 2 * FLIP.r).toBeGreaterThan(2 * BALL_R)
    swing(f, { left: true, right: true }, 1)
    expect(flipperSeg(f, 'right').b[1]).toBeCloseTo(flipperSeg(f, 'left').b[1], 9)
    expect(flipperSeg(f, 'left').b[1]).toBeGreaterThan(l.b[1])
  })
  it('a ball resting on a flipper is fired up the table by a flip', () => {
    const g = inPlay(empty, [3.4, 4])
    const { maxY, seen } = run(g, empty, 2, (_, s) => ({ left: s > 0.6, right: false }))
    expect(maxY).toBeGreaterThan(14)
    expect(seen.some((h) => h.kind === 'flipper')).toBe(true)
  })
  it('a ball left alone drains between them, and the third drain ends the game', () => {
    const g = inPlay(empty, [4.6, 8])
    const { seen } = run(g, empty, 30, () => none)
    expect(seen.filter((h) => h.kind === 'drain')).toHaveLength(1)
    expect(g.balls).toBe(BALLS - 1)
    expect(g.waiting).toBe(true)
    g.balls = 1
    plunge(g, 1)
    run(g, empty, 30)
    expect(g.over).toBe(true)
  })
})

describe('the ball', () => {
  it('never passes through a wall or a flipper, at the top speed from every direction', () => {
    // the drawn walls and the frame both: fired at the default table's walls from all round
    const t = DEFAULT_TABLE
    for (let a = 0; a < 360; a += 15) {
      const v: V2 = [
        Math.cos((a * Math.PI) / 180) * MAX_SPEED,
        Math.sin((a * Math.PI) / 180) * MAX_SPEED,
      ]
      const g = inPlay(t, [4.6, 10], v)
      const f = restFlippers()
      for (let k = 0; k < 2 * HZ; k++) {
        step(g, t, f, { left: k % 400 < 200, right: k % 300 < 150 })
        if (g.waiting) break
        const b = g.ball
        expect(b.x, `fired at ${a}°`).toBeGreaterThan(-BALL_R)
        expect(b.x, `fired at ${a}°`).toBeLessThan(W + BALL_R)
        expect(b.y, `fired at ${a}°`).toBeLessThan(H)
      }
    }
  })
  it('a full plunge goes round the orbit into the table; a feeble one falls back to the plunger', () => {
    const g = newGame(empty)
    plunge(g, 1)
    let entered = false
    const f = restFlippers()
    for (let k = 0; k < 2 * HZ && !entered; k++) {
      step(g, empty, f, none)
      entered = g.ball.x < LANE_X - 0.5
    }
    expect(entered).toBe(true)
    const weak = newGame(empty)
    plunge(weak, 0.35)
    for (let k = 0; k < 3 * HZ && !weak.waiting; k++) step(weak, empty, f, none)
    expect(weak.waiting).toBe(true)
    expect(weak.balls).toBe(BALLS)
  })
  it('a bumper kicks the ball away at its own speed, scores and flashes', () => {
    const t: Table = { ...empty, bumpers: [[4.6, 10]] }
    const g = inPlay(t, [4.6, 10 + BUMPER_R + BALL_R + 0.3], [0, -2])
    const f = restFlippers()
    let hit = false
    for (let k = 0; k < HZ && !hit; k++) {
      step(g, t, f, none)
      hit = g.hits.some((h) => h.kind === 'bumper')
    }
    expect(hit).toBe(true)
    expect(g.ball.vy).toBeGreaterThan(BUMPER_KICK * 0.9)
    expect(g.score).toBe(SCORE.bumper)
    expect(g.flash[0]).toBeGreaterThan(0)
  })
  it('targets light once each, and lighting the last pays the bonus and puts them all out', () => {
    const t: Table = {
      ...empty,
      targets: [
        [3, 10],
        [6, 10],
      ],
    }
    const g = inPlay(t, [3, 10.8], [0, -3])
    run(g, t, 0.4)
    expect(g.lit).toEqual([true, false])
    expect(g.score).toBe(SCORE.target)
    // the same target again scores nothing
    Object.assign(g.ball, { x: 3, y: 10.8, vx: 0, vy: -3 })
    run(g, t, 0.4)
    expect(g.score).toBe(SCORE.target)
    Object.assign(g.ball, { x: 6, y: 10.8, vx: 0, vy: -3 })
    run(g, t, 0.4)
    expect(g.score).toBe(2 * SCORE.target + SCORE.bonus)
    expect(g.lit).toEqual([false, false])
  })
  it('playing beats not playing: flipping when the ball comes down keeps it longer than doing nothing', () => {
    const life = (play: boolean) => {
      const g = newGame(DEFAULT_TABLE)
      plunge(g, 1)
      const f = restFlippers()
      let k = 0
      for (; k < 120 * HZ && g.balls === BALLS; k++) {
        const b = g.ball
        const low = b.y < 3.4 && b.vy < 0
        step(
          g,
          DEFAULT_TABLE,
          f,
          play ? { left: low && b.x < 4.6, right: low && b.x >= 4.6 } : none,
        )
      }
      return k / HZ
    }
    const idle = life(false)
    expect(idle).toBeLessThan(15)
    expect(life(true)).toBeGreaterThan(idle * 4)
  })
})

describe('building', () => {
  it('parts go only where a part may go: not in the lane, the orbit, or down by the flippers', () => {
    expect(buildable([4, 10])).toBe(true)
    expect(buildable([9.6, 10])).toBe(false)
    expect(buildable([4.6, 2.5])).toBe(false)
    expect(buildable([9.2, 16.2])).toBe(false)
    expect(addPart(empty, 'bumper', [4.6, 2.5]).why).toMatch(/flippers/)
    expect(addPart(empty, 'bumper', [4, 10]).table.bumpers).toEqual([[4, 10]])
  })
  it('a drawn wall is thinned to a point every so often, and dropped where it leaves the table', () => {
    const stroke: V2[] = Array.from({ length: 40 }, (_, k) => [1 + k * 0.1, 10])
    const t = addPart(empty, 'wall', [...stroke, [9.9, 10]]).table
    expect(t.walls).toHaveLength(1)
    expect(t.walls[0].length).toBeGreaterThan(5)
    expect(t.walls[0].every(buildable)).toBe(true)
    expect(addPart(empty, 'wall', [[9.6, 10]]).why).toMatch(/Draw a wall/)
  })
  it('stops at the limits and says so', () => {
    let t = empty
    for (let k = 0; k < LIMITS.bumpers; k++) t = addPart(t, 'bumper', [1 + k * 0.6, 10]).table
    const r = addPart(t, 'bumper', [4, 12])
    expect(r.table).toBe(t)
    expect(r.why).toMatch(/12 bumpers/)
  })
  it('erases the part nearest the tap', () => {
    const t: Table = { ...DEFAULT_TABLE }
    expect(erase(t, [3.2, 11.9]).bumpers).toHaveLength(2)
    expect(erase(t, [2.25, 8.6]).targets).toHaveLength(3)
    expect(erase(t, [1.0, 5.5]).walls).toHaveLength(2)
    expect(erase(t, [5, 6])).toBe(t)
  })
})

describe('a table as a file', () => {
  const made: Table = {
    name: 'Mine',
    walls: [
      [
        [1.5, 5],
        [2.5, 6.5],
        [3.1, 7.25],
      ],
    ],
    bumpers: [[5.5, 12.25]],
    targets: [
      [2, 9],
      [7.5, 9.5],
    ],
  }
  it('comes back field for field', () => {
    expect(readTable(JSON.stringify(made))).toEqual(made)
    expect(readTable(JSON.stringify(DEFAULT_TABLE))).toEqual(DEFAULT_TABLE)
  })
  it('refuses what is not a table, or a part where none may go, saying why', () => {
    const bad = (o: object) => readTable(JSON.stringify({ ...made, ...o }))
    expect(readTable('x'.repeat(60_000))).toMatch(/too big/)
    expect(readTable('nope')).toMatch(/not JSON/)
    expect(readTable('{}')).toMatch(/name/)
    expect(bad({ bumpers: [[9.6, 10]] })).toMatch(/bumpers/)
    expect(bad({ targets: [[4.6, 1]] })).toMatch(/targets/)
    expect(bad({ targets: [['4', 10]] })).toMatch(/targets/)
    expect(bad({ walls: [[[3, 5]]] })).toMatch(/walls/)
    expect(
      bad({
        walls: [
          [
            [3, 5],
            [Infinity, 6],
          ],
        ],
      }),
    ).toMatch(/walls/)
    expect(bad({ bumpers: Array.from({ length: 13 }, () => [4, 10]) })).toMatch(/bumpers/)
    expect(
      bad({
        walls: Array.from({ length: 10 }, () =>
          Array.from({ length: 20 }, (_, k) => [1 + k * 0.3, 10]),
        ),
      }),
    ).toMatch(/more wall/)
  })
})

describe('for the GPU', () => {
  it('the uniform agrees with the shader about where every field lives, and is written where read', () => {
    const wgsl = wgslLayout(code, 'Table')
    const { bytes, ...rest } = PIN
    expect(wgsl.offsets).toEqual(rest)
    expect(wgsl.bytes).toBe(bytes)
    const f = restFlippers()
    const v = new DataView(
      packPin({
        w: 400,
        h: 700,
        ball: [3, 4],
        pull: 0.5,
        flippers: f,
        segs: 20,
        items: 7,
        time: 2,
        building: true,
      }),
    )
    const fl = (o: number) => v.getFloat32(o, true)
    const u = (o: number) => v.getUint32(o, true)
    expect([u(0), u(4), u(8), u(12)]).toEqual([400, 700, 160, 288])
    expect([fl(PIN.ball), fl(PIN.ball + 4), fl(PIN.pull)]).toEqual([3, 4, 0.5])
    const l = flipperSeg(f, 'left')
    expect([0, 4, 8, 12].map((k) => fl(PIN.flipL + k))).toEqual([...l.a, ...l.b].map(Math.fround))
    expect([u(PIN.segs), u(PIN.items), fl(PIN.time), u(PIN.building)]).toEqual([20, 7, 2, 1])
  })
  it('carries the shader’s copies of the sizes', () => {
    const num = (name: string) => Number(new RegExp(`const ${name} = ([0-9.]+);`).exec(code)?.[1])
    expect(
      ['W', 'H', 'BALL_R', 'WALL_R', 'BUMPER_R', 'TARGET_R', 'FLIP_R', 'LANE_X'].map(num),
    ).toEqual([W, H, BALL_R, WALL_R, BUMPER_R, TARGET_R, FLIP.r, LANE_X])
  })
  it('lists bumpers then targets, glowing while struck or lit', () => {
    const g = newGame(DEFAULT_TABLE)
    g.flash[1] = 0.15
    g.lit[2] = true
    const it = itemsOf(DEFAULT_TABLE, g)
    expect(it).toHaveLength((3 + 4) * 4)
    expect(it.slice(4, 8)).toEqual([6.0, 11.8, 0, 1])
    expect(it.slice(12 + 8, 12 + 12)).toEqual([5.8, 9.0, 1, 1])
  })
  it('fits the table upright, middle to middle, y up', () => {
    expect(tableFit([550, 950], [275, 475])).toEqual([W / 2, H / 2])
    expect(tableFit([550, 950], [275, 25])[1]).toBeCloseTo(H, 9)
  })
  it('the field it bakes is the distance this file measures', () => {
    // nearest is the lane's wall, 4.2 away, less the wall's own thickness
    expect(distanceAt(empty, [5, 10])).toBeCloseTo(LANE_X - 5 - WALL_R, 9)
    expect(segmentsOf(DEFAULT_TABLE).length).toBe(FRAME.length + 2 + 2 + 2)
    expect(distanceAt(DEFAULT_TABLE, [3.2, 11.8])).toBeCloseTo(-BUMPER_R, 9)
    expect(distanceAt(DEFAULT_TABLE, [2.2, 8.6])).toBeCloseTo(-TARGET_R, 9)
  })
})

describe('a bumper pays for a hit, not for a ball that cannot get away', () => {
  /** three or four bumpers close round a ball: it is kicked from one into the next every step */
  const cage = (n: number, r: number): Table => ({
    ...empty,
    bumpers: Array.from(
      { length: n },
      (_, k): V2 => [
        4.6 + Math.cos((k * 2 * Math.PI) / n + Math.PI / 2) * r,
        10 + Math.sin((k * 2 * Math.PI) / n + Math.PI / 2) * r,
      ],
    ),
  })
  const sit = (t: Table, at: V2, seconds: number) => {
    const g = inPlay(t, at)
    const { seen } = run(g, t, seconds)
    return { g, paid: seen.filter((h) => h.kind === 'bumper').length }
  }
  it('a ball wedged in a triangle of bumpers scores each bumper once, not once a step', () => {
    // before this rule: 8,640 hits and 864,000 points in these three seconds
    const { g, paid } = sit(cage(3, 0.75), [4.6, 10], 3)
    expect(g.ball.y).toBeGreaterThan(9)
    expect(paid).toBeLessThanOrEqual(3)
    expect(g.score).toBeLessThanOrEqual(3 * SCORE.bumper)
  })
  it('a ball rattling inside a cage of four, never getting clear, stops paying', () => {
    // before: 23,400 points in three seconds, the ball never more than a third of a unit from home
    const { paid } = sit(cage(4, 0.95), [4.6, 10], 3)
    expect(paid).toBeLessThanOrEqual(4)
  })
  it('a ball that bounces off a bumper and comes back pays every time it comes back', () => {
    const t: Table = { ...empty, bumpers: [[4.6, 9]] }
    const g = inPlay(t, [4.6, 11])
    const f = restFlippers()
    let touching = false
    let arrivals = 0
    let paid = 0
    for (let k = 0; k < 4 * HZ && !g.waiting; k++) {
      step(g, t, f, none)
      paid += g.hits.filter((h) => h.kind === 'bumper').length
      const now = Math.hypot(g.ball.x - 4.6, g.ball.y - 9) < BUMPER_R + BALL_R + 0.01
      if (now && !touching) arrivals++
      touching = now
    }
    expect(arrivals).toBeGreaterThanOrEqual(2)
    expect(paid).toBe(arrivals)
  })
  it('two bumpers far enough apart for the ball to fly between them pay on every hit', () => {
    // one above the other: the lower kicks the ball up, the upper kicks it back down, and every
    // arrival is a real hit after 1.7 units of flight
    const t: Table = {
      ...empty,
      bumpers: [
        [4.6, 7],
        [4.6, 10.3],
      ],
    }
    const g = inPlay(t, [4.6, 8.6], [0, -2])
    const f = restFlippers()
    let paid = 0
    let arrivals = 0
    const touching = [false, false]
    for (let k = 0; k < 1.5 * HZ && !g.waiting; k++) {
      step(g, t, f, none)
      paid += g.hits.filter((h) => h.kind === 'bumper').length
      t.bumpers.forEach((p, i) => {
        const now = Math.hypot(g.ball.x - p[0], g.ball.y - p[1]) < BUMPER_R + BALL_R + 0.01
        if (now && !touching[i]) arrivals++
        touching[i] = now
      })
    }
    expect(arrivals).toBeGreaterThanOrEqual(6)
    expect(paid).toBe(arrivals)
    expect(g.score).toBe(paid * SCORE.bumper)
  })
})
