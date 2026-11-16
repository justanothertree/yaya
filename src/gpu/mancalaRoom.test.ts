import { describe, expect, it } from 'vitest'
import { choose, legal, score, storeOf, total, type Rules } from './mancala'
import { MAX_SOWINGS, mancalaRules, readRules, replay, type MancalaGame } from './mancalaRoom'

/** a seeded stand-in for Math.random, so a game is the same on every run */
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

/** a whole game, the toy's own computer on both sides, every board through the wire */
function playThrough(rules: Rules, seed: number) {
  const R = mancalaRules(rules)
  const rnd = seeded(seed)
  let g = R.fresh('versus')
  const seen: MancalaGame[] = []
  let kept = 0
  while (R.turn(g) !== null) {
    const side = R.turn(g) as 0 | 1
    const pit = choose(g.b, side, seed % 2 ? 'fair' : 'easy', g.rules, rnd)
    expect(R.legal(g, pit, side)).toBe(true)
    g = R.apply(g, pit, side)
    if (g.turn === side) kept++
    seen.push(g)
  }
  return { R, g, seen, kept }
}

// every field something other than its default: five pits, three seeds, no captures
const ODD: Rules = { pits: 5, seeds: 3, captures: false }

describe('mancala on the wire', () => {
  it('survives the round trip for every board a real game passes through, at any rules', () => {
    for (const [k, rules] of [
      ODD,
      { pits: 6, seeds: 4, captures: true },
      { pits: 4, seeds: 6, captures: true },
    ].entries()) {
      const { R, seen } = playThrough(rules, k + 1)
      for (const g of seen) {
        const wire = JSON.parse(JSON.stringify(R.encode(g)))
        const back = R.decode(wire)!
        expect(back).not.toBeNull()
        expect(back.rules).toEqual(rules)
        expect(back.b).toEqual(g.b)
        expect(back.turn).toBe(g.turn)
        expect(R.encode(back)).toEqual(wire)
      }
    }
  })

  it('keeps the rules a game was started with, whichever rules decode it', () => {
    const { R, g } = playThrough(ODD, 3)
    // a host's five-pit game read by somebody whose own toy is set to six
    const theirs = mancalaRules({ pits: 6, seeds: 4, captures: true })
    expect(theirs.decode(R.encode(g))!.rules).toEqual(ODD)
  })

  it('refuses rules the toy does not offer, and a sowing that is not one where it stands', () => {
    expect(readRules({ pits: 7, seeds: 4, captures: true })).toBeNull()
    expect(readRules({ pits: 6, seeds: 2, captures: true })).toBeNull()
    expect(readRules({ pits: 6, seeds: 4, captures: 'yes' })).toBeNull()
    const rules = { pits: 6, seeds: 4, captures: true }
    expect(replay(rules, [0])).not.toBeNull()
    expect(replay(rules, [7])).toBeNull() // side 1's pit, on side 0's turn
    expect(replay(rules, [6])).toBeNull() // a store is not a pit
    expect(replay(rules, [2, 2])).toBeNull() // 2 ends in the store, so side 0 goes again: pit 2 is empty
    expect(replay(rules, [1.5])).toBeNull()
    expect(replay(rules, Array(MAX_SOWINGS + 1).fill(0))).toBeNull()
  })
})

describe('mancala as a room game', () => {
  it('ending in your own store keeps the turn', () => {
    const R = mancalaRules({ pits: 6, seeds: 4, captures: true })
    // four seeds from the third pit land the last one in side 0's store
    const g = R.apply(R.fresh('versus'), 2, 0)
    expect(g.b[storeOf(g.b, 0)]).toBe(1)
    expect(R.turn(g)).toBe(0)
    expect(R.legal(g, 7, 1)).toBe(false)
    const { kept } = playThrough(ODD, 5)
    expect(kept).toBeGreaterThan(0)
  })

  it('ends with every seed in a store, and the bigger store wins', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const rules = [ODD, { pits: 6, seeds: 4, captures: true }][seed % 2]
      const { R, g } = playThrough(rules, seed)
      // asked of the board: the pits are empty and the stores hold every seed there ever was
      expect(legal(g.b, 0).length * legal(g.b, 1).length).toBe(0)
      const [a, b] = score(g.b)
      expect(a + b).toBe(total(g.b))
      expect(a + b).toBe(rules.pits * rules.seeds * 2)
      expect(R.result!(g)).toBe(a > b ? 0 : b > a ? 1 : 'draw')
    }
  })

  it('together: the computer plays side 1 with the toy’s own levels', () => {
    const R = mancalaRules(ODD)
    expect(R.modes).toEqual(['versus', 'together'])
    expect(R.computer!.side).toBe(1)
    expect(R.computer!.levels).toEqual(['easy', 'fair', 'hard'])
    const g = R.apply(R.fresh('together'), 0, 0)
    if (g.turn === 1) expect(R.legal(g, R.computer!.choose(g, 'hard'), 1)).toBe(true)
    expect(R.begun!(R.fresh('versus'))).toBe(false)
    expect(R.begun!(g)).toBe(true)
  })
})
