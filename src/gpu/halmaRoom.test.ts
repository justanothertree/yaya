import { describe, expect, it } from 'vitest'
import { DRAW_AFTER, choose, goalOf, moves, newGame } from './halma'
import { halmaRules as R, replay, type HalmaGame } from './halmaRoom'

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
  const seen: HalmaGame[] = [d]
  while (R.turn(d) !== null) {
    const side = R.turn(d) as 0 | 1
    const m = choose(d.g, 'fair', rnd)
    expect(R.legal(d, m, side)).toBe(true)
    d = R.apply(d, m, side)
    seen.push(d)
  }
  return { d, seen }
}

describe('chinese checkers on the wire', () => {
  it('survives the round trip for every position of real games', () => {
    for (let seed = 1; seed <= 3; seed++) {
      const { seen } = playThrough(seed)
      for (const d of seen.filter((_, i) => i % 5 === 0 || i === seen.length - 1)) {
        const wire = JSON.parse(JSON.stringify(R.encode(d)))
        const back = R.decode(wire)!
        expect(Array.from(back.g.cells)).toEqual(Array.from(d.g.cells))
        expect(back.g.turn).toBe(d.g.turn)
        expect(R.encode(back)).toEqual(wire)
      }
    }
  })

  it('refuses a landing no step or hop reaches, out of turn, and malformed moves', () => {
    const first = moves(newGame(1))[0]
    expect(replay([[first.from, first.to]])).not.toBeNull()
    expect(replay([[first.from, first.from]])).toBeNull()
    expect(
      replay([
        [first.from, first.to],
        [first.to, first.from],
      ]),
    ).toBeNull() // seat 1's turn now
    expect(replay([[999, 0]])).toBeNull()
    expect(replay(['a'])).toBeNull()
    expect(R.decode({ moves: 'x' })).toBeNull()
    expect(replay(Array(DRAW_AFTER + 1).fill([first.from, first.to]))).toBeNull()
  })

  it('plays the board’s own chain of hops, whatever path the sender claims', () => {
    const d = R.fresh('versus')
    const m = moves(d.g)[0]
    expect(R.apply(d, { ...m, path: [1, 2, 3] }, 0).last!.path).toEqual(m.path)
  })
})

describe('chinese checkers as a room game', () => {
  it('ends with a point filled, and the side that filled it wins', () => {
    const seen = new Set<string>()
    for (let seed = 1; seed <= 6; seed++) {
      const { d } = playThrough(seed)
      const r = R.result!(d)
      seen.add(String(r))
      if (r === 'draw') continue
      const side = r === 0 ? 1 : 2
      // asked of the board: every hole of the goal is filled
      expect(goalOf(side).every((i) => d.g.cells[i] !== 0)).toBe(true)
      expect(goalOf(side).some((i) => d.g.cells[i] === side)).toBe(true)
    }
    expect(seen.has('0') || seen.has('1')).toBe(true)
  })

  it('together: the computer races from the far point', () => {
    expect(R.modes).toEqual(['versus', 'together'])
    const d0 = R.fresh('together')
    const d = R.apply(d0, moves(d0.g)[0], 0)
    expect(R.turn(d)).toBe(1)
    expect(R.legal(d, R.computer!.choose(d, 'easy'), 1)).toBe(true)
    expect(R.begun!(d)).toBe(true)
  })
})
