import { describe, expect, it } from 'vitest'
import { choose, goalRow, type Move } from './fences'
import { MAX_MOVES, fencesRules, readMove, replay } from './fencesRoom'

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

function playThrough(n: 7 | 9, seed: number) {
  const R = fencesRules(n)
  const rnd = seeded(seed)
  let d = R.fresh('versus')
  const seen = [d]
  while (R.turn(d) !== null && d.list.length < MAX_MOVES) {
    const side = R.turn(d) as 0 | 1
    const m = choose(d.g, seed % 2 ? 'fair' : 'easy', rnd)
    expect(R.legal(d, m, side)).toBe(true)
    d = R.apply(d, m, side)
    seen.push(d)
  }
  return { R, d, seen }
}

describe('fences on the wire', () => {
  it('survives the round trip for every position, on both boards', () => {
    for (const n of [7, 9] as const)
      for (let seed = 1; seed <= 3; seed++) {
        const { R, seen } = playThrough(n, seed + n)
        for (const d of seen.filter((_, i) => i % 3 === 0 || i === seen.length - 1)) {
          const wire = JSON.parse(JSON.stringify(R.encode(d)))
          const back = R.decode(wire)!
          expect(back.g.pos).toEqual(d.g.pos)
          expect(back.g.left).toEqual(d.g.left)
          expect(Array.from(back.g.h)).toEqual(Array.from(d.g.h))
          expect(Array.from(back.g.v)).toEqual(Array.from(d.g.v))
          expect(R.encode(back)).toEqual(wire)
        }
      }
  })

  it('reads a step or a fence, and nothing else', () => {
    expect(readMove(['s', 7, 4])).toEqual({ kind: 'step', to: [7, 4] })
    expect(readMove(['h', 2, 3])).toEqual({ kind: 'fence', o: 'h', r: 2, c: 3 })
    expect(readMove({ kind: 'fence', o: 'v', r: 1, c: 1 } as Move)).toEqual({
      kind: 'fence',
      o: 'v',
      r: 1,
      c: 1,
    })
    for (const bad of [['x', 1, 1], ['s', -1, 0], ['h', 9, 0], ['s', 1.5, 2], ['s', 1], 'step'])
      expect(readMove(bad)).toBeNull()
  })

  it('refuses a step that is not a step, a fence on a fence, and a fence that shuts a side in', () => {
    const R = fencesRules(9)
    const start = R.fresh('versus').g
    const [r, c] = start.pos[0]
    expect(replay(9, [['s', r - 1, c]])).not.toBeNull()
    expect(replay(9, [['s', r - 2, c]])).toBeNull() // two squares at once
    expect(
      replay(9, [
        ['h', 3, 3],
        ['h', 3, 3],
      ]),
    ).toBeNull() // on a fence
    expect(
      replay(9, [
        ['h', 3, 3],
        ['v', 3, 3],
      ]),
    ).toBeNull() // across one
    // the bottom side walls its own start square in on both sides (the computer stepping down
    // meanwhile); a flat fence capping it would leave it no way through, so it cannot be sent
    const walled = [
      ['v', 7, 3],
      ['s', 1, 4],
      ['v', 7, 4],
      ['s', 2, 4],
    ]
    expect(replay(9, walled)).not.toBeNull()
    expect(replay(9, [...walled, ['h', 6, 4]])).toBeNull()
    expect(replay(9, [...walled, ['h', 6, 0]])).not.toBeNull() // the same fence elsewhere is fine
    expect(R.decode({ n: 8, moves: [] })).toBeNull()
  })
})

describe('fences as a room game', () => {
  it('ends with a side on its own goal row, and that side wins', () => {
    const seen = new Set<string>()
    for (let seed = 1; seed <= 8; seed++) {
      const { R, d } = playThrough(seed % 2 ? 7 : 9, seed)
      const r = R.result!(d)
      if (r === null) continue
      // asked of the board: the winner stands on its goal row
      expect(d.g.pos[r as 0 | 1][0]).toBe(goalRow(d.g, r as 0 | 1))
      seen.add(String(r))
    }
    expect(seen.size).toBeGreaterThan(0)
  })

  it('together: the computer races from the top', () => {
    const R = fencesRules(7)
    expect(R.modes).toEqual(['versus', 'together'])
    const d0 = R.fresh('together')
    const [r, c] = d0.g.pos[0]
    const d = R.apply(d0, { kind: 'step', to: [r - 1, c] }, 0)
    expect(R.turn(d)).toBe(1)
    expect(R.legal(d, R.computer!.choose(d, 'easy'), 1)).toBe(true)
    expect(R.begun!(d)).toBe(true)
  })
})
