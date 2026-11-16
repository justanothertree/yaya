import { describe, expect, it } from 'vitest'
import { LINES, choose, type Game } from './cube'
import { cubeRules as R } from './cubeRoom'

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

function playThrough(seed: number) {
  const rnd = seeded(seed)
  let g = R.fresh('versus')
  const seen: Game[] = [g]
  while (R.turn(g) !== null) {
    const side = R.turn(g) as 0 | 1
    const i = choose(g, seed % 2 ? 'fair' : 'easy', rnd)
    expect(R.legal(g, i, side)).toBe(true)
    g = R.apply(g, i, side)
    seen.push(g)
  }
  return { g, seen }
}

describe('the cube on the wire', () => {
  it('survives the round trip for every position of real games', () => {
    for (let seed = 1; seed <= 6; seed++)
      for (const g of playThrough(seed).seen) {
        const wire = JSON.parse(JSON.stringify(R.encode(g)))
        const back = R.decode(wire)!
        expect(Array.from(back.cells)).toEqual(Array.from(g.cells))
        expect(back.turn).toBe(g.turn)
        expect(R.encode(back)).toEqual(wire)
      }
  })

  it('refuses a cell taken, a cell off the cube, and a mark after four in a line', () => {
    expect(R.decode({ moves: [5, 5] })).toBeNull()
    expect(R.decode({ moves: [64] })).toBeNull()
    expect(R.decode({ moves: [1.5] })).toBeNull()
    // crosses take the top row of the top layer (0-3) while noughts play the second layer
    expect(R.decode({ moves: [0, 16, 1, 17, 2, 18, 3] })!.over).toBe(true)
    expect(R.decode({ moves: [0, 16, 1, 17, 2, 18, 3, 19] })).toBeNull()
    expect(R.decode({ moves: 'all' })).toBeNull()
  })
})

describe('the cube as a room game', () => {
  it('ends with four in a line for the winner, or a full cube for a draw', () => {
    const seen = new Set<string>()
    for (let seed = 1; seed <= 12; seed++) {
      const { g } = playThrough(seed)
      const r = R.result!(g)
      seen.add(String(r))
      if (r === 'draw') {
        expect(g.moves).toHaveLength(64)
        continue
      }
      // asked of the cells, not of the stored winner
      const mark = r === 0 ? 1 : 2
      expect(LINES.some((l) => l.every((i) => g.cells[i] === mark))).toBe(true)
    }
    expect(seen.has('0') && seen.has('1')).toBe(true)
  })

  it('together: the computer plays noughts', () => {
    expect(R.modes).toEqual(['versus', 'together'])
    const g = R.apply(R.fresh('together'), 21, 0)
    expect(R.turn(g)).toBe(1)
    expect(R.legal(g, R.computer!.choose(g, 'easy'), 1)).toBe(true)
    expect(R.legal(g, 21, 1)).toBe(false)
    expect(R.begun!(g)).toBe(true)
  })
})
