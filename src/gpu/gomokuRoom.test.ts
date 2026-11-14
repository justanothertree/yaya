import { describe, expect, it } from 'vitest'
import { newGame } from './gomoku'
import { gomokuRules } from './gomokuRoom'

const rules = gomokuRules(13)
/** black along row 0, white along row 2: black's fifth stone wins */
const FIVE = [0, 26, 1, 27, 2, 28, 3, 29, 4]

describe('five in a row as a room game, sent as its moves', () => {
  it('replays a game to a five, names the winner, and survives the wire', () => {
    let g = rules.fresh('versus')
    for (const i of FIVE) {
      const by = rules.turn(g) as 0 | 1
      expect(rules.legal(g, i, by)).toBe(true)
      g = rules.apply(g, i, by)
    }
    expect(g.over).toBe(true)
    expect(rules.turn(g)).toBeNull()
    expect(rules.result!(g)).toBe(0)
    expect(rules.decode(JSON.parse(JSON.stringify(rules.encode(g))))).toEqual(g)
  })
  it('refuses a stone on a stone, out of turn, off the board, or after the game', () => {
    const g = rules.apply(rules.fresh('versus'), 84, 0)
    expect(rules.legal(g, 84, 1)).toBe(false)
    expect(rules.legal(g, 85, 0)).toBe(false)
    expect(rules.legal(g, 169, 1)).toBe(false)
    for (const bad of [
      null,
      { n: 15, moves: [] },
      { n: 13, moves: [0, 0] },
      { n: 13, moves: [169] },
      { n: 13, moves: [...FIVE, 50] },
      { n: 11, moves: Array.from({ length: 122 }, (_, i) => i) },
    ])
      expect(rules.decode(bad), JSON.stringify(bad)?.slice(0, 50)).toBeNull()
  })
  it('the board is the size it was sent at, not the receiver’s', () => {
    const small = gomokuRules(11)
    const g = small.apply(small.fresh('versus'), 60, 0)
    expect(rules.decode(small.encode(g))).toEqual(g)
    expect(rules.decode(small.encode(g))!.n).toBe(11)
  })
  it('the computer plays white, legally, and a game has begun at the first stone', () => {
    const g0 = rules.fresh('together')
    expect(rules.begun!(g0)).toBe(false)
    const g1 = rules.apply(g0, 84, 0)
    expect(rules.begun!(g1)).toBe(true)
    const m = rules.computer!.choose(g1, 'hard')
    expect(rules.legal(g1, m, 1)).toBe(true)
    expect(newGame(13).turn).toBe(1)
  })
})
