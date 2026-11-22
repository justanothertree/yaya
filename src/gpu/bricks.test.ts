import { describe, expect, it } from 'vitest'
import {
  BALL_R,
  BLANK_WALL,
  COLS,
  EMPTY,
  H,
  LIVES,
  MAX_ANGLE,
  MAX_BALLS,
  MAX_LIVES,
  PADDLE_W,
  PADDLE_Y,
  ROWS,
  W,
  advance,
  ballSpeed,
  brickBox,
  bricksLeft,
  daySeed,
  launch,
  newGame,
  readSaved,
  readWall,
  rng,
  wallPattern,
  type Game,
  type Power,
} from './bricks'

const hits = (p: string) => [...p].reduce((a, ch) => a + (ch === 'g' ? 1 : Number(ch)), 0)
/** a game with one brick of `hp` at a cell, and one ball under it going straight up */
const single = (cell: number, hp = 1): Game => {
  const wall = [...BLANK_WALL]
  wall[cell] = String(hp)
  const g = newGame(1, wall.join(''))
  for (const b of g.bricks) if (b) b.drop = null
  const box = brickBox(cell)
  g.balls = [{ x: (box.x0 + box.x1) / 2, y: box.y1 + 0.1, vx: 0, vy: -ballSpeed(g), stuck: false }]
  return g
}
/** advance a few seconds in frames, the paddle under the first ball */
const run = (g: Game, seconds: number) => {
  const ev = []
  for (let t = 0; t < seconds; t += 1 / 60) ev.push(...advance(g, 1 / 60, g.balls[0]?.x ?? W / 2))
  return ev
}
/** a person's way of playing: get under the lowest falling ball, and aim somewhere new each time */
function play(g: Game, seconds: number, seed: number, frame = 1 / 60, each?: (g: Game) => void) {
  const rand = rng(seed)
  let aim = 0
  const events = []
  for (let t = 0; t < seconds && !g.over; t += frame) {
    launch(g)
    const f = g.balls.filter((b) => b.vy > 0).sort((a, b) => b.y - a.y)[0] ?? g.balls[0]
    const ev = advance(g, frame, f ? f.x + aim * g.paddle.w * 0.45 : W / 2)
    if (ev.some((e) => e.kind === 'paddle')) aim = rand() * 2 - 1
    events.push(...ev)
    each?.(g)
  }
  return events
}

describe('walls', () => {
  it('come the same from the same seed, mirrored, never thin, tougher as they go', () => {
    let early = 0
    let late = 0
    for (let seed = 1; seed <= 30; seed++) {
      expect(wallPattern(seed, 3)).toBe(wallPattern(seed, 3))
      for (let round = 1; round <= 6; round++) {
        const p = wallPattern(seed, round)
        expect(p).toMatch(/^[0-3g]{80}$/)
        expect(p.replace(/0/g, '').length).toBeGreaterThanOrEqual(16)
        for (let r = 0; r < ROWS; r++)
          for (let c = 0; c < COLS; c++) expect(p[r * COLS + c]).toBe(p[r * COLS + COLS - 1 - c])
      }
      early += hits(wallPattern(seed, 1)) / wallPattern(seed, 1).replace(/0/g, '').length
      late += hits(wallPattern(seed, 6)) / wallPattern(seed, 6).replace(/0/g, '').length
    }
    // the hits a brick takes, on average: about one on the first wall, near three by the sixth
    expect(early / 30).toBeLessThan(1.3)
    expect(late / 30).toBeGreaterThan(2)
  })
  it("today's walls are everyone's, and tomorrow's are different", () => {
    expect(daySeed(new Date(2026, 10, 10, 8))).toBe(daySeed(new Date(2026, 10, 10, 23)))
    expect(daySeed(new Date(2026, 10, 10))).not.toBe(daySeed(new Date(2026, 10, 11)))
  })
  it('a drawn wall travels as 80 characters, and anything else is refused', () => {
    const drawn = '3g' + '0'.repeat(78)
    expect(readWall(drawn)).toBe(drawn)
    expect(readWall(BLANK_WALL)).toBeNull()
    expect(readWall(drawn.slice(1))).toBeNull()
    expect(readWall(drawn.replace('3', '4'))).toBeNull()
    expect(readWall(null)).toBeNull()
  })
})

describe('the ball', () => {
  it('leaves the paddle straight up from the middle and at the steepest angle from the edge', () => {
    for (const [off, angle] of [
      [0, 0],
      [1, MAX_ANGLE],
      [-0.5, -MAX_ANGLE / 2],
    ]) {
      const g = newGame(1)
      g.balls = [
        {
          x: W / 2 + (off * PADDLE_W) / 2,
          y: PADDLE_Y - BALL_R - 0.004,
          vx: 0,
          vy: 0.7,
          stuck: false,
        },
      ]
      const ev = advance(g, 1 / 60, W / 2)
      expect(ev.some((e) => e.kind === 'paddle')).toBe(true)
      const b = g.balls[0]
      expect(Math.atan2(b.vx, -b.vy)).toBeCloseTo(angle, 5)
      expect(Math.hypot(b.vx, b.vy)).toBeCloseTo(ballSpeed(g), 6)
    }
  })
  it('stays on the field, never runs flat, and never sits inside a brick, even at 20 frames a second', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const g = newGame(seed)
      play(g, 240, seed, 0.05, (g) => {
        for (const b of g.balls) {
          expect(b.x).toBeGreaterThanOrEqual(BALL_R - 1e-9)
          expect(b.x).toBeLessThanOrEqual(W - BALL_R + 1e-9)
          expect(b.y).toBeGreaterThanOrEqual(BALL_R - 1e-9)
          if (!b.stuck) expect(Math.abs(b.vy) / Math.hypot(b.vx, b.vy)).toBeGreaterThan(0.29)
          g.bricks.forEach((k, i) => {
            if (!k) return
            const box = brickBox(i)
            const inside = b.x > box.x0 && b.x < box.x1 && b.y > box.y0 && b.y < box.y1
            expect(inside).toBe(false)
          })
        }
      })
    }
  }, 60000)
})

describe('bricks and points', () => {
  it('a tough brick takes a hit for 5, then breaks for its toughness, and the ball comes back', () => {
    const cell = 3 * COLS + 4
    const g = single(cell, 2)
    let ev = run(g, 0.25)
    expect(ev).toContainEqual({ kind: 'hit', at: cell })
    expect(g.score).toBe(5)
    expect(g.balls[0].vy).toBeGreaterThan(0)
    // send it up again
    g.balls[0].vy = -Math.abs(g.balls[0].vy)
    ev = run(g, 0.25)
    expect(ev).toContainEqual({ kind: 'break', at: cell, points: 20 })
  })
  it('each brick broken before the ball touches the paddle again is worth more', () => {
    const g = single(2 * COLS + 4)
    g.bricks[4 * COLS + 4] = { hp: 1, max: 1, gold: false, drop: null }
    // between the two, going up: the upper brick turns it down onto the lower one
    g.balls[0].y = brickBox(3 * COLS + 4).y1
    const ev = run(g, 0.4)
    const broken = ev.filter((e) => e.kind === 'break')
    expect(broken.map((e) => (e.kind === 'break' ? e.points : 0))).toEqual([10, 20])
  })
  it('clearing the wall pays a bonus, brings the next wall and puts the ball back on the paddle', () => {
    const g = single(3 * COLS + 4)
    const ev = run(g, 0.25)
    expect(ev).toContainEqual({ kind: 'clear', bonus: 250 + 50 * LIVES })
    expect(g.round).toBe(2)
    expect(bricksLeft(g)).toBe(1)
    expect(g.balls).toHaveLength(1)
    expect(g.balls[0].stuck).toBe(true)
  })
})

describe('lives and drops', () => {
  it('the last ball lost costs a life and serves again; the last life ends it', () => {
    const g = newGame(1)
    g.balls = [{ x: 0.05, y: H - 0.01, vx: 0, vy: 0.8, stuck: false }]
    g.paddle.x = 0.9
    expect(advance(g, 0.05, 0.9).map((e) => e.kind)).toContain('lost')
    expect(g.lives).toBe(LIVES - 1)
    expect(g.balls[0].stuck).toBe(true)
    g.lives = 1
    g.balls = [{ x: 0.05, y: H - 0.01, vx: 0, vy: 0.8, stuck: false }]
    expect(advance(g, 0.05, 0.9).map((e) => e.kind)).toContain('over')
    expect(g.over).toBe(true)
  })
  const caught = (kind: Power, setup?: (g: Game) => void) => {
    const g = newGame(1)
    g.balls = [{ x: 0.5, y: 0.6, vx: 0.2, vy: -0.6, stuck: false }]
    setup?.(g)
    g.drops = [{ x: g.paddle.x, y: PADDLE_Y - 0.01, kind }]
    const ev = advance(g, 1 / 60, g.paddle.x)
    expect(ev).toContainEqual({ kind: 'catch', power: kind })
    return g
  }
  it('multi makes three of every ball, up to six', () => {
    expect(caught('multi').balls).toHaveLength(3)
    const g = caught('multi', (g) => {
      g.balls = [0.2, 0.4, 0.6].map((x) => ({ x, y: 0.6, vx: 0.2, vy: -0.6, stuck: false }))
    })
    expect(g.balls).toHaveLength(MAX_BALLS)
  })
  it('wide lasts twelve seconds, and a life never takes you past five', () => {
    const g = caught('wide')
    expect(g.paddle.w).toBeGreaterThan(PADDLE_W)
    g.balls = [{ x: 0.5, y: 0.5, vx: 0, vy: 0, stuck: true }]
    for (let t = 0; t < 12.1; t += 0.05) advance(g, 0.05, 0.5)
    expect(g.paddle.w).toBe(PADDLE_W)
    expect(caught('life', (g) => (g.lives = MAX_LIVES)).lives).toBe(MAX_LIVES)
    expect(caught('life').lives).toBe(LIVES + 1)
  })
})

describe('a whole game', () => {
  // measured: a player who aims somewhere new each time clears the first wall in 62–133 s on the
  // first six seeds, and never goes a minute without breaking something
  it('every first wall can be cleared, and nothing stalls for long', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const g = newGame(seed)
      let last = 0
      let dry = 0
      const rand = rng(seed + 99)
      let aim = 0
      for (let t = 0; t < 400 && g.round === 1; t += 1 / 60) {
        launch(g)
        const f = g.balls.filter((b) => b.vy > 0).sort((a, b) => b.y - a.y)[0] ?? g.balls[0]
        const ev = advance(g, 1 / 60, f ? f.x + aim * g.paddle.w * 0.45 : W / 2)
        if (ev.some((e) => e.kind === 'paddle')) aim = rand() * 2 - 1
        if (ev.some((e) => e.kind === 'break')) last = g.time
        dry = Math.max(dry, g.time - last)
      }
      expect(g.round).toBe(2)
      expect(dry).toBeLessThan(90)
    }
  }, 60000)
})

describe('bricks saves', () => {
  it('round-trips every field away from its default', () => {
    const s = {
      palette: 'earth',
      paddle: 3,
      trail: false,
      sound: false,
      best: 12345,
      today: { day: 3999999999, best: 4321 },
      furthest: 7,
      drawn: '3g'.repeat(40),
      drawnBest: 987,
    }
    expect(readSaved(JSON.stringify(s))).toEqual(s)
  })
  it('a broken store loses only what is bad', () => {
    expect(readSaved('[')).toEqual(EMPTY)
    expect(readSaved(JSON.stringify({ paddle: 9, drawn: 'xyz', best: 40 }))).toEqual({
      ...EMPTY,
      best: 40,
    })
  })
})
