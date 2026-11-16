import { describe, expect, it } from 'vitest'
import { chain, choose, type Player } from './hex'
import { SWAP, hexRules, replay } from './hexRoom'

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

/** a whole game on the toy's own easy computer, both sides, swapping when it may */
function playThrough(n: number, swapRule: boolean, seed: number) {
  const R = hexRules(n, swapRule)
  const rnd = seeded(seed)
  let g = R.fresh('versus')
  const seen = [g]
  while (R.turn(g) !== null) {
    const side = R.turn(g) as 0 | 1
    const m =
      swapRule && g.moves.length === 1 && seed % 2
        ? SWAP
        : choose(g.b, (side + 1) as Player, 'easy', rnd)
    expect(R.legal(g, m, side)).toBe(true)
    g = R.apply(g, m, side)
    seen.push(g)
  }
  return { R, g, seen }
}

describe('hex on the wire', () => {
  it('survives the round trip for every position, at every size, with and without the swap', () => {
    for (const [k, n] of [7, 9, 11].entries())
      for (const swapRule of [true, false]) {
        const { R, seen } = playThrough(n, swapRule, k * 2 + (swapRule ? 1 : 0))
        for (const g of seen) {
          const wire = JSON.parse(JSON.stringify(R.encode(g)))
          const back = R.decode(wire)!
          expect(back.b).toEqual(g.b)
          expect(back.turn).toBe(g.turn)
          expect(back.swapRule).toBe(swapRule)
          expect(R.encode(back)).toEqual(wire)
        }
      }
  })

  it('keeps the size and the swap rule a game was started with', () => {
    const { R, g } = playThrough(7, true, 1)
    expect(hexRules(11, false).decode(R.encode(g))!.b.n).toBe(7)
    expect(hexRules(11, false).decode(R.encode(g))!.swapRule).toBe(true)
  })

  it('refuses a stone on a stone, a swap where none may be, and a size the toy does not offer', () => {
    expect(replay(7, true, [3, 3])).toBeNull()
    expect(replay(7, false, [3, SWAP])).toBeNull() // no swap rule
    expect(replay(7, true, [SWAP])).toBeNull() // nothing to swap yet
    expect(replay(7, true, [3, 4, SWAP])).toBeNull() // too late
    expect(replay(7, true, [3, SWAP])).not.toBeNull()
    expect(replay(7, true, [49])).toBeNull()
    expect(hexRules(7, true).decode({ n: 8, swap: true, moves: [] })).toBeNull()
    expect(hexRules(7, true).decode({ n: 7, swap: 'yes', moves: [] })).toBeNull()
  })
})

describe('hex as a room game', () => {
  it('ends when a side joins its edges, and that side wins', () => {
    const seen = new Set<string>()
    for (let seed = 1; seed <= 12; seed++) {
      const { R, g } = playThrough(7, seed % 3 === 0, seed)
      const r = R.result!(g)
      // asked of the board: the winner's stones join its own two edges
      expect(chain(g.b.cells, g.b.n, r === 0 ? 1 : 2)).not.toBeNull()
      seen.add(String(r))
    }
    expect(seen.has('0') && seen.has('1')).toBe(true)
  })

  it('swaps the first stone to the second player, mirrored to their side', () => {
    const R = hexRules(7, true)
    let g = R.apply(R.fresh('versus'), 1 * 7 + 3, 0) // row 1, column 3
    expect(R.legal(g, SWAP, 1)).toBe(true)
    expect(R.legal(g, SWAP, 0)).toBe(false)
    g = R.apply(g, SWAP, 1)
    expect(g.b.cells[3 * 7 + 1]).toBe(2) // row 3, column 1: blue
    expect(g.b.cells.filter(Boolean)).toHaveLength(1)
    expect(R.turn(g)).toBe(0)
  })

  it('together: the computer plays blue, and swaps a strong first stone as the toy does', () => {
    const R = hexRules(7, true)
    const middle = R.apply(R.fresh('together'), 3 * 7 + 3, 0)
    expect(R.computer!.choose(middle, 'easy')).toBe(SWAP)
    const corner = R.apply(R.fresh('together'), 0, 0)
    expect(R.computer!.choose(corner, 'easy')).not.toBe(SWAP)
    expect(R.modes).toEqual(['versus', 'together'])
    expect(R.begun!(middle)).toBe(true)
  })
})
