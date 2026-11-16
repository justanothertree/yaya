import { describe, expect, it } from 'vitest'
import { at, choose, colOf, moves, rowOf } from './draughts'
import { MAX_MOVES, draughtsRules as rules, replay, type DraughtsGame } from './draughtsRoom'

/** a game played by draughts.ts's own computers, through the room's rules, to its end */
function playOut(seed: number): DraughtsGame {
  let s = seed
  const rand = () => (s = (s * 16807) % 2147483647) / 2147483647
  let d = rules.fresh('versus')
  for (let k = 0; k < MAX_MOVES && rules.turn(d) !== null; k++) {
    const by = rules.turn(d) as 0 | 1
    const path = choose(d.g, 'easy', rand).path
    expect(rules.legal(d, path, by)).toBe(true)
    d = rules.apply(d, path, by)
  }
  return d
}

describe('draughts as a room game, sent as the paths its pieces took', () => {
  it('plays a whole game, every move surviving the wire, and names the result', () => {
    const d = playOut(11)
    expect(rules.turn(d)).toBeNull()
    expect(rules.decode(JSON.parse(JSON.stringify(rules.encode(d))))).toEqual(d)
    const w = d.g.winner
    expect(rules.result!(d)).toBe(w === 3 ? 'draw' : w === 1 ? 0 : 1)
  })
  it('a take that is there must be taken: a quiet step is refused, here and off the wire', () => {
    // play on until the side to move has a take
    let d = rules.fresh('versus')
    let s = 5
    const rand = () => (s = (s * 16807) % 2147483647) / 2147483647
    while (!moves(d.g)[0]?.taken.length) {
      const by = rules.turn(d) as 0 | 1
      d = rules.apply(d, choose(d.g, 'easy', rand).path, by)
    }
    const by = rules.turn(d) as 0 | 1
    // a real step: one of its men, one square diagonally forward onto an empty square
    const fwd = by === 0 ? -1 : 1
    const quiet = d.g.board
      .map((p, i) => [p, i] as const)
      .filter(([p]) => p === (by === 0 ? 1 : 2))
      .flatMap(([, i]) => [-1, 1].map((dc) => [i, at(rowOf(i) + fwd, colOf(i) + dc)]))
      .find(([, to]) => to >= 0 && !d.g.board[to])!
    expect(quiet).toBeDefined()
    expect(rules.legal(d, quiet, by)).toBe(false)
    expect(replay([...d.list, quiet])).toBeNull()
    // the take itself, landing by landing, is the move
    const take = moves(d.g)[0]
    expect(rules.legal(d, take.path, by)).toBe(true)
    expect(rules.legal(d, take.path, by === 0 ? 1 : 0)).toBe(false)
  })
  it('refuses what is not a list of paths, or a path from the wrong side', () => {
    for (const bad of [
      null,
      { moves: 'x' },
      { moves: [[21]] },
      { moves: [[21, 32]] },
      { moves: [[8, 12]] }, // the top side moving first
      { moves: Array(MAX_MOVES + 1).fill([21, 17]) },
    ])
      expect(rules.decode(bad), JSON.stringify(bad)?.slice(0, 40)).toBeNull()
    expect(rules.readMove([1.5, 2])).toBeNull()
  })
  it('the computer plays the top side, legally; a game has begun at the first move', () => {
    const d0 = rules.fresh('together')
    expect(rules.begun!(d0)).toBe(false)
    const d1 = rules.apply(d0, moves(d0.g)[0].path, 0)
    expect(rules.begun!(d1)).toBe(true)
    expect(rules.turn(d1)).toBe(1)
    expect(rules.legal(d1, rules.computer!.choose(d1, 'fair'), 1)).toBe(true)
  })
})
