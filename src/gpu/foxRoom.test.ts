import { describe, expect, it } from 'vitest'
import { IDLE_LIMIT, TAKE_TO_WIN, choose, foxMoves, gooseMoves, newGame } from './fox'
import { foxRules as R, replay, type FoxGame } from './foxRoom'

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
  const seen: FoxGame[] = [d]
  while (R.turn(d) !== null) {
    const side = R.turn(d) as 0 | 1
    const m = choose(d.g, seed % 2 ? 'fair' : 'easy', rnd)
    expect(R.legal(d, m, side)).toBe(true)
    d = R.apply(d, m, side)
    seen.push(d)
  }
  return { d, seen }
}

describe('fox and geese on the wire', () => {
  it('survives the round trip for every position of real games', () => {
    for (let seed = 1; seed <= 4; seed++)
      for (const d of playThrough(seed).seen.filter((_, i) => i % 3 === 0)) {
        const wire = JSON.parse(JSON.stringify(R.encode(d)))
        const back = R.decode(wire)!
        expect([...back.g.geese].sort()).toEqual([...d.g.geese].sort())
        expect(back.g.fox).toBe(d.g.fox)
        expect(back.g.taken).toBe(d.g.taken)
        expect(back.g.idle).toBe(d.g.idle)
        expect(R.encode(back)).toEqual(wire)
      }
  })

  it('refuses a goose stepping backwards, the fox moving first, and paths that are not moves', () => {
    const g = newGame()
    const step = gooseMoves(g)[0]
    expect(replay([step.path])).not.toBeNull()
    expect(replay([[...step.path].reverse()])).toBeNull()
    expect(replay([foxMoves(g)[0].path])).toBeNull() // the geese move first
    expect(replay([[0]])).toBeNull()
    expect(replay(['x'])).toBeNull()
    expect(R.decode({ moves: 7 })).toBeNull()
  })

  it('takes the geese the board says a jump takes, whatever the sender claims', () => {
    const d0 = R.fresh('versus')
    const m = gooseMoves(d0.g)[0]
    const d = R.apply(d0, { path: m.path, takes: [1, 2, 3] }, 0)
    expect(d.g.geese.size).toBe(d0.g.geese.size)
    expect(d.g.taken).toBe(0)
  })
})

describe('fox and geese as a room game', () => {
  it('ends with the fox taking enough, the geese trapping it, or a draw, as the board says', () => {
    const seen = new Set<string>()
    for (let seed = 1; seed <= 10; seed++) {
      const { d } = playThrough(seed)
      const r = R.result!(d)
      seen.add(String(r))
      // the fox wins by taking enough, by the geese shuffling without stepping forward, or by
      // leaving the geese no move: asked of the board, never of the stored winner
      if (r === 1)
        expect(
          d.g.taken >= TAKE_TO_WIN || d.g.idle >= IDLE_LIMIT || gooseMoves(d.g).length === 0,
        ).toBe(true)
      // the geese win by leaving the fox nowhere to go
      if (r === 0) expect(foxMoves(d.g)).toHaveLength(0)
    }
    expect(seen.size).toBeGreaterThan(1)
  })

  it('seats are sides: the geese first, then the fox; together the computer is the fox', () => {
    const d0 = R.fresh('together')
    expect(R.turn(d0)).toBe(0)
    expect(R.computer!.side).toBe(1)
    const d = R.apply(d0, gooseMoves(d0.g)[0], 0)
    expect(R.turn(d)).toBe(1)
    expect(R.legal(d, R.computer!.choose(d, 'easy'), 1)).toBe(true)
    expect(R.legal(d, R.computer!.choose(d, 'easy'), 0)).toBe(false)
  })
})
