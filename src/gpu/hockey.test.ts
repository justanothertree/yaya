import { describe, expect, it } from 'vitest'
import {
  CORNER_R,
  EMPTY,
  GOAL_W,
  MAX_SPEED,
  PADDLE_R,
  PUCK_R,
  SKILL,
  TABLE_H,
  TABLE_W,
  YOUR_SPEED,
  advance,
  brain,
  clampToHalf,
  contain,
  crossing,
  newTable,
  readSaved,
  recordMatch,
  type Event,
  type Level,
  type Table,
  type Vec,
} from './hockey'

const seeded = (seed: number) => {
  let s = seed >>> 0 || 1
  return () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    return (s >>> 0) / 2 ** 32
  }
}
/** paddles parked out of the way, at home in front of each goal */
const parked: [Vec, Vec] = [
  { x: 0.5, y: TABLE_H - 0.06 },
  { x: 0.5, y: 0.06 },
]
const loose = (puck: Partial<Table['puck']>): Table => {
  const t = newTable()
  t.puck = { x: 0.5, y: 0.8, vx: 0, vy: 0, ...puck }
  t.paddles = [
    { x: 0.5, y: TABLE_H - 0.06, vx: 0, vy: 0 },
    { x: 0.5, y: 0.06, vx: 0, vy: 0 },
  ]
  return t
}
const onTable = (t: Table) =>
  t.puck.x >= PUCK_R - 1e-9 &&
  t.puck.x <= TABLE_W - PUCK_R + 1e-9 &&
  t.puck.y >= PUCK_R - 1e-9 &&
  t.puck.y <= TABLE_H - PUCK_R + 1e-9 &&
  contain(t.puck.x, t.puck.y, PUCK_R - 1e-7) === null

/** run a table on for some seconds, a frame at a time */
const run = (t: Table, seconds: number, wants: [Vec, Vec], speeds: [number, number]) => {
  const events: Event[] = []
  for (let s = 0; s < seconds; s += 1 / 60) events.push(...advance(t, 1 / 60, wants, speeds).events)
  return events
}

function match(a: Level, b: Level, seed: number, to = 5) {
  const rand = seeded(seed)
  const t = newTable(seed % 2 ? 0 : 1)
  const A = brain(0, a, rand)
  const B = brain(1, b, rand)
  let time = 0
  let off = 0
  while (Math.max(...t.score) < to && time < 240) {
    const dt = 1 / 60
    advance(t, dt, [A(t, dt), B(t, dt)], [SKILL[a].speed, SKILL[b].speed])
    if (!onTable(t)) off++
    time += dt
  }
  return { score: t.score, time, off }
}

describe('the table', () => {
  it('a shot into the mouth is a goal, and the puck waits on the side that conceded', () => {
    const t = loose({ x: 0.5, y: 0.4, vx: 0, vy: -2 })
    const aside = parked.map((p) => ({ ...p, x: 0.15 })) as [Vec, Vec]
    t.paddles[0] = { ...aside[0], vx: 0, vy: 0 }
    t.paddles[1] = { ...aside[1], vx: 0, vy: 0 }
    const events = run(t, 0.5, aside, [0, 0])
    expect(events).toContainEqual({ kind: 'goal', scorer: 0 })
    expect(t.score).toEqual([1, 0])
    expect(t.puck.y).toBeLessThan(TABLE_H / 2)
    expect(t.pause).toBeGreaterThan(0)
  })
  it('wide of the mouth the end is a wall', () => {
    const x = 0.5 + GOAL_W / 2 + 0.06
    const t = loose({ x, y: 0.4, vx: 0, vy: -2 })
    run(t, 0.5, parked, [0, 0])
    expect(t.score).toEqual([0, 0])
    expect(t.puck.vy).toBeGreaterThan(0)
  })
  it('a rounded corner sends a puck out along the wall, not back the way it came', () => {
    const t = loose({ x: 0.2, y: 0.25, vx: -2, vy: -2 })
    run(t, 0.4, [parked[0], { x: 0.9, y: 0.4 }], [0, 0])
    expect(onTable(t)).toBe(true)
    // it left the corner travelling along one of its walls, not diagonally back out
    expect(Math.abs(Math.abs(t.puck.vx) - Math.abs(t.puck.vy))).toBeGreaterThan(0.2)
    const c = contain(0, 0, PUCK_R)!
    expect(Math.hypot(c.x - CORNER_R, c.y - CORNER_R)).toBeCloseTo(CORNER_R - PUCK_R, 9)
  })
  it('a puck at full speed cannot pass through a paddle, however long the frame', () => {
    const t = loose({ x: 0.5, y: 0.9, vx: 0, vy: MAX_SPEED })
    t.paddles[0] = { x: 0.5, y: 1.2, vx: 0, vy: 0 }
    advance(t, 1 / 15, [{ x: 0.5, y: 1.2 }, parked[1]], [0, 0])
    expect(t.puck.y).toBeLessThan(1.2)
    expect(t.puck.vy).toBeLessThan(0)
  })
  it('a moving paddle drives a still puck away, and no shot is faster than the limit', () => {
    const t = loose({ x: 0.5, y: 1.0 })
    t.paddles[0] = { x: 0.5, y: 1.3, vx: 0, vy: 0 }
    const events = run(t, 0.1, [{ x: 0.5, y: 0.6 }, parked[1]], [YOUR_SPEED, 0])
    expect(t.puck.vy).toBeLessThan(-2)
    expect(Math.hypot(t.puck.vx, t.puck.vy)).toBeLessThanOrEqual(MAX_SPEED + 1e-9)
    expect(events.some((e) => e.kind === 'paddle' && e.side === 0)).toBe(true)
  })
  it('each paddle keeps to its own half and off the walls', () => {
    for (const p of [
      { x: -1, y: -1 },
      { x: 2, y: 3 },
      { x: 0.5, y: 0.8 },
      { x: 0, y: TABLE_H },
    ]) {
      const a = clampToHalf(0, p)
      const b = clampToHalf(1, p)
      expect(a.y).toBeGreaterThanOrEqual(TABLE_H / 2)
      expect(b.y).toBeLessThanOrEqual(TABLE_H / 2)
      for (const q of [a, b]) expect(contain(q.x, q.y, PADDLE_R - 1e-7)).toBeNull()
    }
  })
  it('reads where the puck will cross a line, bounces and all, the way the table plays it', () => {
    const rand = seeded(3)
    for (let k = 0; k < 20; k++) {
      const t = loose({ x: 0.2 + rand() * 0.6, y: 1.1, vx: (rand() - 0.5) * 6, vy: -1.5 })
      const line = 0.5
      const x = crossing(t.puck, line, 10)!
      let prev = t.puck.y
      for (let i = 0; i < 2000 && t.puck.y > line; i++) {
        prev = t.puck.y
        advance(
          t,
          1 / 480,
          [
            { x: 0.9, y: TABLE_H },
            { x: 0.9, y: 0 },
          ],
          [0, 0],
        )
      }
      expect(prev).toBeGreaterThan(line)
      expect(t.puck.x).toBeCloseTo(x, 1)
    }
  })
})

describe('the computer', () => {
  // measured over twelve seeded matches to 5 each: pro beat rookie 12–0 and club 12–0, club beat
  // rookie 11–1; between equals the longest took 158 s (pro v pro). Before the computer learned
  // corner and bank shots, two pros rallied four minutes without a goal. Seeded, so the same
  // every run.
  it('every match between computers ends, with the puck on the table throughout', () => {
    for (const [a, b] of [
      ['rookie', 'rookie'],
      ['club', 'club'],
      ['pro', 'pro'],
    ] as [Level, Level][])
      for (let g = 0; g < 3; g++) {
        const m = match(a, b, 40 + g)
        expect(Math.max(...m.score), `${a} v ${b}`).toBe(5)
        expect(m.off).toBe(0)
      }
  }, 30000)
  it('each level beats the one below it', () => {
    const wins = (a: Level, b: Level) =>
      Array.from({ length: 4 }, (_, g) => match(a, b, 77 + g)).filter(
        (m) => m.score[0] > m.score[1],
      ).length
    expect(wins('club', 'rookie')).toBeGreaterThanOrEqual(3)
    expect(wins('pro', 'club')).toBeGreaterThanOrEqual(3)
  }, 30000)
})

describe('hockey saves', () => {
  it('a match moves the record on, and a loss ends the streak', () => {
    let r = EMPTY.record.club
    r = recordMatch(r, 5, 2, 95.4)
    r = recordMatch(r, 5, 4, 71.6)
    expect(r).toEqual({ won: 2, lost: 0, streak: 2, bestStreak: 2, best: 3, fastest: 72 })
    r = recordMatch(r, 1, 5, 30)
    expect(r).toEqual({ won: 2, lost: 1, streak: 0, bestStreak: 2, best: 3, fastest: 72 })
  })
  it('round-trips every field away from its default', () => {
    const s = {
      level: 'pro',
      table: 'ice',
      colour: 4,
      to: 7,
      trail: false,
      sound: false,
      record: {
        rookie: { won: 3, lost: 1, streak: 2, bestStreak: 3, best: 5, fastest: 41 },
        club: { won: 1, lost: 4, streak: 0, bestStreak: 1, best: 2, fastest: 88 },
        pro: { won: 1, lost: 9, streak: 1, bestStreak: 1, best: 1, fastest: 203 },
      },
    }
    expect(readSaved(JSON.stringify(s))).toEqual(s)
  })
  it('a broken store loses only what is bad', () => {
    expect(readSaved('{')).toEqual(EMPTY)
    expect(readSaved(JSON.stringify({ level: 'legend', colour: 99, to: 4, sound: false }))).toEqual(
      {
        ...EMPTY,
        sound: false,
      },
    )
  })
})
