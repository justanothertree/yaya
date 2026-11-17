import { describe, expect, it } from 'vitest'
import { rng } from './bricks'
import { SPREAD, START, aimFor, centreOf, land, type Level } from './darts'
import {
  FAR,
  LEGS_TO_WIN,
  MAX_DARTS,
  dartsRules as R,
  readDart,
  tidy,
  type DartsGame,
} from './dartsRoom'
import { matches, sample } from './testMatches'

/** a whole match between two computer hands through the room's own rules, every dart of it */
function playThrough(seed: number, levels: [Level, Level] = ['hard', 'fair']) {
  const rand = rng(seed)
  let g = R.fresh()
  const seen: DartsGame[] = [g]
  while (R.turn(g) !== null) {
    const side = R.turn(g) as 0 | 1
    const p = tidy(land(aimFor(g.leg, levels[side]), SPREAD[levels[side]], rand))
    expect(R.legal(g, p, side)).toBe(true)
    expect(R.legal(g, p, side === 0 ? 1 : 0)).toBe(false)
    g = R.apply(g, p, side)
    seen.push(g)
  }
  return { g, seen }
}
const at = (t: Parameters<typeof centreOf>[0]) => tidy(centreOf(t))
const wire = (ps: { x: number; y: number }[]) => ({ darts: ps.map((p) => [p.x, p.y]) })

describe('darts on the wire', () => {
  it.each(matches([1], [1, 2]))(
    'replays to the very same match from its darts, through a real match (seed $seed, $kind)',
    ({ seed }) => {
      const { g, seen } = playThrough(seed)
      expect(g.over).toBe(true)
      expect(Math.max(...g.legs)).toBe(LEGS_TO_WIN)
      for (const d of sample(seen)) {
        const w = JSON.parse(JSON.stringify(R.encode(d)))
        const back = R.decode(w)!
        expect(back.leg).toEqual(d.leg)
        expect([back.legNo, back.legs, back.over]).toEqual([d.legNo, d.legs, d.over])
        expect(back.board).toEqual(d.board)
        expect(back.last).toEqual(d.last)
        expect(R.encode(back)).toEqual(w)
      }
      expect(R.result!(g)).toBe(g.legs[0] > g.legs[1] ? 0 : 1)
      // a dart after the match is not part of it, though the list is short
      const w = R.encode(g) as { darts: number[][] }
      expect(w.darts.length).toBeLessThan(MAX_DARTS)
      expect(R.decode({ darts: [...w.darts, [0, 0]] })).toBeNull()
    },
  )

  it('scores a dart by where it landed, three to a turn, the board cleared for the next turn', () => {
    const t20 = at({ n: 20, mult: 3 })
    let g = R.fresh()
    g = R.apply(g, t20)
    g = R.apply(g, t20)
    expect(g.leg.scores[0]).toBe(START - 120)
    expect(g.board).toHaveLength(2)
    g = R.apply(g, t20)
    // a hundred and eighty, and the turn handed on with the darts still in the board
    expect(g.leg.scores[0]).toBe(START - 180)
    expect(g.leg.turn).toBe(1)
    expect(g.board).toHaveLength(3)
    g = R.apply(g, at({ n: 1, mult: 1 }))
    expect(g.board).toEqual([{ ...at({ n: 1, mult: 1 }), who: 1 }])
  })

  it('takes a leg on a double out, gives the next leg’s first throw to the other side, and ends at two', () => {
    // nine darts: T20 T20 T20, T20 T20 T20 for seat 0, then T20 T19 D12 — 141 out
    const t20 = at({ n: 20, mult: 3 })
    const miss = { x: 0, y: -FAR }
    const leg = [t20, t20, t20, miss, miss, miss, t20, t20, t20, miss, miss, miss]
    const out = [t20, at({ n: 19, mult: 3 }), at({ n: 12, mult: 2 })]
    let g = R.decode(wire([...leg, ...out]))!
    expect(g.legs).toEqual([1, 0])
    expect(g.legNo).toBe(1)
    expect(g.leg.turn).toBe(1)
    expect(g.leg.scores).toEqual([START, START])
    expect(g.last!.legWon).toBe(true)
    // the second leg the same way round for seat 0, who now throws second
    g = R.decode(wire([...leg, ...out, miss, miss, miss, ...leg, ...out]))!
    expect(g.legs).toEqual([2, 0])
    expect(g.over).toBe(true)
    expect(R.turn(g)).toBeNull()
    expect(R.result!(g)).toBe(0)
  })

  it('holds a landing to the board’s neighbourhood and to a tenth of a millimetre', () => {
    expect(tidy({ x: 12.3456, y: -7.891 })).toEqual({ x: 12.3, y: -7.9 })
    const far = tidy({ x: 3000, y: 4000 })
    expect(Math.hypot(far.x, far.y)).toBeCloseTo(FAR, 0)
    expect(readDart(far)).not.toBeNull()
  })

  it('refuses a dart that is not a landing near the board', () => {
    expect(readDart([1, 2])).toEqual({ x: 1, y: 2 })
    for (const bad of [[FAR + 1, 0], [NaN, 0], [0, Infinity], ['1', 2], [1], null, 5])
      expect(readDart(bad)).toBeNull()
  })

  it('refuses a match that is not a list of darts, or longer than any match', () => {
    expect(R.decode(null)).toBeNull()
    expect(R.decode({})).toBeNull()
    expect(R.decode({ darts: [[FAR * 2, 0]] })).toBeNull()
    expect(R.decode({ darts: Array.from({ length: MAX_DARTS + 1 }, () => [0, -FAR]) })).toBeNull()
    // a match of nothing but misses stops at the bound, and is called a draw
    const misses = R.decode({ darts: Array.from({ length: MAX_DARTS }, () => [0, -FAR]) })!
    expect(R.turn(misses)).toBeNull()
    expect(R.result!(misses)).toBe('draw')
  })

  it('lets the computer throw its dart together', () => {
    let g = R.fresh()
    for (let i = 0; i < 3; i++) g = R.apply(g, { x: 0, y: -FAR }, 0)
    expect(R.turn(g)).toBe(R.computer!.side)
    expect(R.legal(g, R.computer!.choose(g, 'hard'), 1)).toBe(true)
  })
})
