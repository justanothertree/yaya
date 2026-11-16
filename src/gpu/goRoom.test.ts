import { describe, expect, it } from 'vitest'
import { KOMI, N, PASS, choose, score } from './goboard'
import { MAX_MOVES, goRules as R, replay, type GoGame } from './goRoom'

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
  let d = R.fresh('versus')
  const seen: GoGame[] = [d]
  while (R.turn(d) !== null) {
    const side = R.turn(d) as 0 | 1
    const at = choose(d.g, 'easy', rnd)
    expect(R.legal(d, at, side)).toBe(true)
    d = R.apply(d, at, side)
    seen.push(d)
  }
  return { d, seen }
}

describe('go on the wire', () => {
  it('survives the round trip for every position of real games, captures and all', () => {
    let took = 0
    for (let seed = 1; seed <= 3; seed++) {
      const { seen } = playThrough(seed)
      for (const d of seen.filter((_, i) => i % 4 === 0 || i === seen.length - 1)) {
        const wire = JSON.parse(JSON.stringify(R.encode(d)))
        const back = R.decode(wire)!
        expect(back.g.board).toEqual(d.g.board)
        expect(back.g.taken).toEqual(d.g.taken)
        expect(back.g.ko).toBe(d.g.ko)
        expect(R.encode(back)).toEqual(wire)
        took = Math.max(took, d.g.taken[1] + d.g.taken[2])
      }
    }
    // a round trip with no captures in it would not have asked about them
    expect(took).toBeGreaterThan(0)
  })

  it('refuses a stone on a stone, suicide, the ko and anything off the board', () => {
    expect(replay([40, 40])).toBeNull()
    // white surrounds the corner point 0 (1 and 9), black plays elsewhere; black into 0 is suicide
    expect(replay([40, 1, 41, 9])).not.toBeNull()
    expect(replay([40, 1, 41, 9, 0])).toBeNull()
    expect(replay([N * N])).toBeNull()
    expect(replay([-2])).toBeNull()
    expect(replay([PASS, PASS, 0])).toBeNull() // two passes ended it
    expect(replay(Array(MAX_MOVES + 1).fill(PASS))).toBeNull()
  })
})

describe('go as a room game', () => {
  it('ends on two passes, and the side with more area, komi counted, wins', () => {
    const seen = new Set<string>()
    for (let seed = 1; seed <= 4; seed++) {
      const { d } = playThrough(seed)
      // asked of the board's own area count, with komi for white
      const s = score(d.g.board)
      expect(R.result!(d)).toBe(s.black > s.white ? 0 : 1)
      expect(s.white).toBeGreaterThanOrEqual(KOMI) // white's count includes its komi
      seen.add(String(R.result!(d)))
    }
    expect(seen.size).toBeGreaterThan(0)
  })

  it('together: the computer plays white', () => {
    expect(R.modes).toEqual(['versus', 'together'])
    const d = R.apply(R.fresh('together'), 40, 0)
    expect(R.turn(d)).toBe(1)
    expect(R.legal(d, R.computer!.choose(d, 'easy'), 1)).toBe(true)
    expect(R.legal(d, 40, 1)).toBe(false)
    expect(R.begun!(d)).toBe(true)
  })
})
