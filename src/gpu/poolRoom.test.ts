import { describe, expect, it } from 'vitest'
import { R, TH, TW } from './pool'
import { poolRules, readPoolGame, readShot, type PoolGame } from './poolRoom'

/** a whole game, the toy's own computer playing both sides, every table through the wire */
function playThrough(level: string, max = 200) {
  let g = poolRules.fresh('versus')
  const tables: unknown[] = []
  for (let k = 0; k < max && poolRules.turn(g) !== null; k++) {
    const shot = poolRules.computer!.choose(g, level)
    expect(poolRules.legal(g, shot, g.turn)).toBe(true)
    g = poolRules.apply(g, shot, g.turn)
    tables.push(JSON.parse(JSON.stringify(poolRules.encode(g))))
  }
  return { g, tables }
}

describe('a pool table on the wire', () => {
  it('survives the round trip for every table a real game passes through', () => {
    // ⚠️ the first version refused real tables: a ball that went down resting past the cushion
    // line, two balls left resting a fifth of a width into each other, and the cue ball down on
    // the shot that ends the game. Twelve games here; sixty were swept when the bounds were set.
    for (let k = 0; k < 12; k++) {
      const { g, tables } = playThrough(['easy', 'fair', 'hard'][k % 3])
      expect(g.winner).not.toBeNull()
      for (const t of tables) {
        const back = readPoolGame(t)
        expect(back).not.toBeNull()
        expect(poolRules.encode(back!)).toEqual(t)
      }
    }
  })

  it('accepts the cue ball down only once the game is over', () => {
    const t = poolRules.encode(poolRules.fresh('versus')) as Record<string, unknown>
    const balls = (t.balls as number[][]).map((b) => (b[0] === 0 ? [0, -R, -R, 1] : b))
    expect(readPoolGame({ ...t, balls })).toBeNull()
    expect(readPoolGame({ ...t, balls, winner: 1 })).not.toBeNull()
  })

  it('refuses a table no game could be in', () => {
    const t = poolRules.encode(poolRules.fresh('versus')) as Record<string, unknown>
    const balls = t.balls as number[][]
    const bad: unknown[] = [
      { ...t, balls: balls.slice(1) },
      { ...t, balls: balls.map((b) => (b[0] === 3 ? [5, b[1], b[2], b[3]] : b)) },
      { ...t, balls: balls.map((b) => [b[0], TW / 2, TH / 2, 0]) },
      { ...t, balls: balls.map((b) => (b[0] === 4 ? [4, TW + 1, TH / 2, 0] : b)) },
      { ...t, groups: ['solids', 'solids'] },
      { ...t, groups: ['solids', null] },
      { ...t, turn: 2 },
      { ...t, balls: balls.map((b) => (b[0] === 8 ? [8, b[1], b[2], 1] : b)) },
      { ...t, said: 'x'.repeat(300) },
    ]
    for (const b of bad) expect(readPoolGame(b)).toBeNull()
  })
})

describe('a shot', () => {
  it('is an aim, a strength over nothing and at most full, and both halves of a spot', () => {
    expect(readShot({ a: 1, p: 0.5 })).toEqual({ a: 1, p: 0.5 })
    expect(readShot({ a: 1, p: 1, x: 0.5, y: 0.5 })).toEqual({ a: 1, p: 1, x: 0.5, y: 0.5 })
    for (const bad of [
      { a: 1, p: 0 },
      { a: 1, p: 1.01 },
      { a: 99, p: 0.5 },
      { a: 1, p: 0.5, x: 1 },
      null,
    ])
      expect(readShot(bad)).toBeNull()
  })

  it('is played by pool.ts on the server, and carries the table it was played on', () => {
    const g0 = poolRules.fresh('versus')
    const g1 = poolRules.apply(g0, { a: Math.PI * 0.001, p: 1 }, 0) as PoolGame
    expect(g1.last).toEqual({ a: Math.PI * 0.001, p: 1 })
    expect(g1.prev).toEqual(g0.balls)
    expect(g1.broken).toBe(true)
  })

  it('may put the cue ball only with it in hand, and only where it touches nothing', () => {
    const g0 = poolRules.fresh('versus')
    expect(poolRules.legal(g0, { a: 0, p: 0.5, x: 0.4, y: 0.4 }, 0)).toBe(false)
    const inHand = { ...g0, inHand: true }
    expect(poolRules.legal(inHand, { a: 0, p: 0.5, x: 0.4, y: 0.4 }, 0)).toBe(true)
    const rack = g0.balls.find((b) => b.n === 1)!
    expect(poolRules.legal(inHand, { a: 0, p: 0.5, x: rack.x, y: rack.y }, 0)).toBe(false)
    expect(poolRules.legal(g0, { a: 0, p: 0.5 }, 1)).toBe(false) // not seat 1's turn
  })
})
