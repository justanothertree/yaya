import { describe, expect, it } from 'vitest'
import {
  COLS,
  EMPTY,
  LIVES,
  MAPS,
  ROWS,
  SPEC,
  START_COINS,
  at,
  build,
  canBuild,
  dailyMap,
  held,
  newGame,
  onPath,
  readSaved,
  sell,
  step,
  upgrade,
  waveOf,
  type Game,
  type GameMap,
  type Kind,
} from './towers'

const run = (g: Game, seconds: number, each?: (g: Game, t: number) => Game) => {
  for (let t = 0; t < seconds * 60 && !g.over; t++) {
    if (each) g = each(g, t)
    g = step(g, 1 / 60).game
  }
  return g
}
/** a steady player: build where a tower covers the most path, upgrade when there is money to spare */
function pilot(g: Game, kind: Kind = 'dart'): Game {
  let best: { c: number; r: number; cover: number } | null = null
  for (let c = 0; c < COLS; c++)
    for (let r = 0; r < ROWS; r++) {
      if (!canBuild(g, c, r, kind)) continue
      let cover = 0
      for (let d = 0; d < g.map.path.length; d += 0.5) {
        const p = at(g.map, d)
        if (Math.hypot(p.x - c - 0.5, p.y - r - 0.5) <= 2.3) cover++
      }
      if (!best || cover > best.cover) best = { c, r, cover }
    }
  if (best) return build(g, best.c, best.r, kind)
  const up = g.towers.filter((t) => t.level < 2).sort((a, b) => a.level - b.level)[0]
  if (up && g.coins >= SPEC[up.kind].cost[up.level + 1] + 40) return upgrade(g, up.c, up.r)
  return g
}

describe('maps', () => {
  const valid = (m: GameMap) => {
    const p = m.path
    expect(p[0].c).toBe(0)
    expect(p[p.length - 1].c).toBe(COLS - 1)
    for (let k = 1; k < p.length; k++)
      expect(Math.abs(p[k].c - p[k - 1].c) + Math.abs(p[k].r - p[k - 1].r)).toBe(1)
    expect(new Set(p.map((x) => `${x.c},${x.r}`)).size).toBe(p.length)
    for (const x of p) expect(x.c >= 0 && x.c < COLS && x.r >= 0 && x.r < ROWS).toBe(true)
  }
  it('every path runs edge to edge, a cell at a time, never crossing itself', () => {
    for (const m of MAPS) valid(m)
    for (let s = 1; s <= 30; s++) valid(dailyMap(s * 977))
  })
  it("today's field is everyone's, and a distance along the path lands on cell centres", () => {
    expect(dailyMap(42).path).toEqual(dailyMap(42).path)
    const m = MAPS[0]
    expect(at(m, 3)).toEqual({ x: m.path[3].c + 0.5, y: m.path[3].r + 0.5 })
  })
})

describe('building', () => {
  it('not on the path, not on another tower, not without the money; upgrades cost more and stop at three levels; selling returns two thirds', () => {
    let g = newGame(MAPS[0])
    const p = g.map.path[2]
    expect(canBuild(g, p.c, p.r, 'dart')).toBe(false)
    const spot = { c: 0, r: 0 }
    expect(onPath(g.map, spot.c, spot.r)).toBe(false)
    g = build(g, spot.c, spot.r, 'dart')
    expect(g.coins).toBe(START_COINS - SPEC.dart.cost[0])
    expect(build(g, spot.c, spot.r, 'frost')).toBe(g)
    g = { ...g, coins: 1000 }
    g = upgrade(upgrade(g, 0, 0), 0, 0)
    expect(g.towers[0].level).toBe(2)
    expect(upgrade(g, 0, 0)).toBe(g)
    const spent = SPEC.dart.cost.reduce((a, x) => a + x, 0)
    expect(sell(g, 0, 0).coins - g.coins).toBe(Math.floor((spent * 2) / 3))
    expect(build({ ...newGame(MAPS[0]), coins: 10 }, 0, 0, 'cannon').towers).toEqual([])
  })
})

describe('the creatures', () => {
  it('waves grow, runners join on the third and brutes on the fifth', () => {
    expect(waveOf(2).length).toBeGreaterThan(waveOf(1).length)
    expect(waveOf(2)).not.toContain('runner')
    expect(waveOf(3)).toContain('runner')
    expect(waveOf(4)).not.toContain('brute')
    expect(waveOf(5)).toContain('brute')
  })
  it('walk the path at their pace, and every one that gets through costs a life', () => {
    let g = newGame(MAPS[0])
    g = run(g, 9) // the first wave starts and its first creature has set off
    expect(g.wave).toBe(1)
    const len = g.map.path.length - 0.5
    // a walker crosses the whole path in its length over its speed (1.1 a second), give or take a frame
    g = run(g, len / 1.1 + 0.5)
    expect(g.lives).toBeLessThan(LIVES)
  })
  it('a tower kills what comes within reach and is paid for it; frost slows; a cannon hits several at once', () => {
    let g = newGame(MAPS[0])
    g = { ...g, coins: 1000 }
    for (const p of [
      { c: 3, r: 2 },
      { c: 5, r: 2 },
      { c: 3, r: 0 },
    ])
      g = build(g, p.c, p.r, 'dart')
    g = run(g, 40)
    expect(g.kills).toBeGreaterThan(0)
    expect(g.coins).toBeGreaterThan(1000 - 3 * SPEC.dart.cost[0])
    // frost: the same creature, chilled, covers less ground
    const walker = {
      id: 1,
      kind: 'walker' as const,
      d: 2,
      life: 1e6,
      full: 1e6,
      speed: 1.1,
      chill: 0,
      bounty: 0,
    }
    const plain = step({ ...newGame(MAPS[0]), rest: 99, foes: [walker] }, 0.1).game.foes[0].d
    const cold = step({ ...newGame(MAPS[0]), rest: 99, foes: [{ ...walker, chill: 1 }] }, 0.1).game
      .foes[0].d
    expect(cold - 2).toBeCloseTo((plain - 2) * (1 - SPEC.frost.slow), 6)
    // cannon: two creatures together, one shot, both hurt
    const pair = [walker, { ...walker, id: 2, d: 2.2 }]
    const near = at(MAPS[0], 2)
    const c = Math.floor(near.x) + 1
    const r = Math.floor(near.y)
    const boom = step(
      {
        ...newGame(MAPS[0]),
        rest: 99,
        foes: pair,
        towers: [{ kind: 'cannon', c, r, level: 0, wait: 0, spent: 0 }],
      },
      0.01,
    ).game
    expect(boom.foes.every((f) => f.life < 1e6)).toBe(true)
    // and a frost tower's shot is what chills them
    const iced = step(
      {
        ...newGame(MAPS[0]),
        rest: 99,
        foes: pair,
        towers: [{ kind: 'frost', c, r, level: 0, wait: 0, spent: 0 }],
      },
      0.01,
    ).game
    expect(iced.foes.every((f) => f.chill > 0)).toBe(true)
  })
})

describe('a whole game', () => {
  // measured: no towers holds 2 waves; a steady player of darts held 22-25 on every map and two
  // days' fields; the creatures toughen 18% a wave, so every game ends
  it('with no towers it is over almost at once; a steady player holds many waves, and still loses in the end', () => {
    expect(held(run(newGame(MAPS[0]), 600))).toBeLessThanOrEqual(3)
    for (const m of [...MAPS, dailyMap(1813764870)]) {
      const g = run(newGame(m), 3600, (x, t) => (t % 30 === 0 ? pilot(x) : x))
      expect(g.over).toBe(true)
      expect(held(g)).toBeGreaterThanOrEqual(15)
    }
  }, 60000)
})

describe('towers saves', () => {
  it('round-trips every field away from its default', () => {
    const s = {
      map: 'today',
      theme: 'snow',
      fast: true,
      best: { meadow: 12, river: 30 },
      today: { day: 3999999999, waves: 17 },
    }
    expect(readSaved(JSON.stringify(s))).toEqual(s)
    expect(readSaved(JSON.stringify({ map: 'moon', best: { moon: 9 } }))).toEqual(EMPTY)
  })
})
