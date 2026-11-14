import { describe, expect, it } from 'vitest'
import { dark, solve } from './lamps'
import { MAX_PRESSES, lampsGame, lampsRules, startOf } from './lampsRoom'

const DAY = 20_400
const rules = lampsRules(DAY, 5, 'plus')
const par = solve(startOf(DAY, 5, 'plus'), 5, 'plus')!

describe('lamps as a room game', () => {
  it('together: one board, either seat, and presses land the same in any order', () => {
    let a = rules.fresh('together')
    let b = rules.fresh('together')
    expect(a.boards).toHaveLength(1)
    const half = Math.ceil(par.length / 2)
    const ann = par.slice(0, half)
    const bo = par.slice(half)
    // Ann's presses then Bo's, against Bo's then Ann's, interleaved by seat as they arrive
    for (const i of ann) a = rules.apply(a, i, 0)
    for (const i of bo) a = rules.apply(a, i, 0)
    for (const i of [...bo].reverse()) b = rules.apply(b, i, 0)
    for (const i of [...ann].reverse()) b = rules.apply(b, i, 0)
    expect(dark(a.lit[0])).toBe(true)
    expect(a.lit).toEqual(b.lit)
    expect(rules.result!(a)).toBe(0)
    expect(rules.turn(a)).toBeNull()
    expect(rules.legal(a, 0, 0)).toBe(false) // no pressing a board that is out
  })
  it('a race: each seat presses its own copy, and the first dark wins', () => {
    let g = rules.fresh('versus')
    expect(g.boards).toHaveLength(2)
    expect(g.lit[0]).toEqual(g.lit[1])
    for (const i of par.slice(0, -1)) g = rules.apply(g, i, 1)
    g = rules.apply(g, par[0], 0) // Ann's one press touches only her board
    expect(g.boards[0]).toEqual([par[0]])
    expect(rules.turn(g)).toBe('any')
    g = rules.apply(g, par[par.length - 1], 1)
    expect(g.winner).toBe(1)
    expect(rules.result!(g)).toBe(1)
    expect(rules.legal(g, 0, 0)).toBe(false)
  })
  it('a board travels as its presses, and comes back as the same game', () => {
    let g = rules.fresh('versus')
    for (const i of [3, 7, 3, 12]) g = rules.apply(g, i, 0)
    g = rules.apply(g, 9, 1)
    expect(rules.decode(JSON.parse(JSON.stringify(rules.encode(g))))).toEqual(g)
    // the board is made from the day, size and pattern sent, not the receiver's own
    const other = lampsRules(DAY + 1, 4, 'cross')
    expect(other.decode(rules.encode(g))).toEqual(g)
  })
  it('refuses a game nobody played', () => {
    const ok = rules.encode(rules.fresh('versus')) as Record<string, unknown>
    for (const bad of [
      null,
      { ...ok, size: 8 },
      { ...ok, pattern: 'star' },
      { ...ok, day: 1.5 },
      { ...ok, boards: [[], [], []] },
      { ...ok, boards: [[25], []] }, // off a 5×5 board
      { ...ok, boards: [[...par, 0], []] }, // pressed on after it went dark
      { ...ok, boards: [par, par] }, // both out first
      { ...ok, boards: [Array(MAX_PRESSES + 1).fill(0), []] },
    ])
      expect(rules.decode(bad), JSON.stringify(bad)?.slice(0, 60)).toBeNull()
    expect(lampsGame(DAY, 5, 'plus', [par])!.winner).toBe(0)
  })
  it('a game has begun at the first press, and a seat’s presses stop at the cap', () => {
    const g = rules.fresh('together')
    expect(rules.begun!(g)).toBe(false)
    expect(rules.begun!(rules.apply(g, 0, 1))).toBe(true)
    // a board with the most presses it may carry takes no more (pressing 0 twice is a no-op)
    const full = lampsGame(DAY, 5, 'plus', [Array(MAX_PRESSES).fill(0)])!
    expect(rules.legal(full, 1, 0)).toBe(false)
  })
})
