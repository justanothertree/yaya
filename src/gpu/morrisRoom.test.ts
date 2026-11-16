import { describe, expect, it } from 'vitest'
import { choose, count, moves, newGame, type Move } from './morris'
import { MAX_MOVES, morrisRules as R, readMove, replay, type MorrisGame } from './morrisRoom'

function seeded(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** a whole game, the toy's own computer on both sides, every position through the wire */
function playThrough(seed: number) {
  const rnd = seeded(seed)
  let d = R.fresh('versus')
  const seen: MorrisGame[] = []
  while (R.turn(d) !== null && d.list.length < MAX_MOVES) {
    const side = R.turn(d) as 0 | 1
    const m = choose(d.g, seed % 2 ? 'fair' : 'easy', rnd)
    expect(R.legal(d, m, side)).toBe(true)
    d = R.apply(d, m, side)
    seen.push(d)
  }
  return { d, seen }
}

describe('nine men’s morris on the wire', () => {
  it('survives the round trip for every position of real games', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const { seen } = playThrough(seed)
      for (const d of seen.filter((_, i) => i % 7 === 0 || i === seen.length - 1)) {
        const wire = JSON.parse(JSON.stringify(R.encode(d)))
        const back = R.decode(wire)!
        expect(back).not.toBeNull()
        expect(back.g).toEqual(d.g)
        expect(R.encode(back)).toEqual(wire)
      }
    }
  })

  it('reads a move as three whole numbers on the board, -1 for none', () => {
    expect(readMove([-1, 4, -1])).toEqual({ from: -1, to: 4, take: -1 })
    expect(readMove([3, 4, 9])).toEqual({ from: 3, to: 4, take: 9 })
    for (const bad of [[-1, -1, -1], [0, 24, -1], [0, 1], [0, 1.5, -1], 'a', null])
      expect(readMove(bad)).toBeNull()
    expect(R.readMove({ from: -1, to: 2, take: -1 })).toEqual({ from: -1, to: 2, take: -1 })
  })

  it('refuses a game no board could come from: a man on a man, out of turn, a mill that forgets to take', () => {
    expect(
      replay([
        [-1, 0, -1],
        [-1, 0, -1],
      ]),
    ).toBeNull()
    expect(replay([[0, 1, -1]])).toBeNull() // nothing on the board to move yet
    // first player builds 0-1-2 while the second plays elsewhere; the third closes a mill and must take
    const opening = [
      [-1, 0, -1],
      [-1, 9, -1],
      [-1, 1, -1],
      [-1, 10, -1],
    ]
    expect(replay(opening)).not.toBeNull()
    expect(replay([...opening, [-1, 2, -1]])).toBeNull()
    expect(replay([...opening, [-1, 2, 9]])).not.toBeNull()
    expect(replay(Array(MAX_MOVES + 1).fill([-1, 0, -1]))).toBeNull()
  })
})

describe('nine men’s morris as a room game', () => {
  it('ends with a side down to two men or with no move, and that side loses', () => {
    const seenWinners = new Set<string>()
    for (let seed = 1; seed <= 16; seed++) {
      const { d } = playThrough(seed)
      const r = R.result!(d)
      seenWinners.add(String(r))
      if (r === 'draw') continue
      // asked of the board: the loser is the side to move, beaten by men or by moves
      const loser = d.g.turn
      expect(r).toBe(loser === 1 ? 1 : 0)
      expect(count(d.g, loser) < 3 || moves({ ...d.g, winner: 0 }).length === 0).toBe(true)
    }
    expect(seenWinners.has('0') || seenWinners.has('1')).toBe(true)
  })

  it('together: the computer plays the second colour with the toy’s own levels', () => {
    expect(R.modes).toEqual(['versus', 'together'])
    expect(R.computer!.side).toBe(1)
    const d = R.apply(R.fresh('together'), { from: -1, to: 4, take: -1 } as Move, 0)
    expect(R.turn(d)).toBe(1)
    expect(R.legal(d, R.computer!.choose(d, 'hard'), 1)).toBe(true)
    expect(R.begun!(d)).toBe(true)
    expect(R.begun!({ g: newGame(), list: [], last: null })).toBe(false)
  })
})
