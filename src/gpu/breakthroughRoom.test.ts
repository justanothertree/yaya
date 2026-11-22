import { describe, expect, it } from 'vitest'
import { advance, choose, count, moves, type Move } from './breakthrough'
import { breakthroughRules, replay } from './breakthroughRoom'

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

function playThrough(n: number, seed: number) {
  const R = breakthroughRules(n)
  const rnd = seeded(seed)
  let d = R.fresh('versus')
  const seen = [d]
  while (R.turn(d) !== null) {
    const side = R.turn(d) as 0 | 1
    const m = choose(d.g, 'easy', rnd)
    expect(R.legal(d, m, side)).toBe(true)
    d = R.apply(d, m, side)
    seen.push(d)
  }
  return { R, d, seen }
}

describe('breakthrough on the wire', () => {
  it('survives the round trip for every position, on both boards', () => {
    for (const n of [6, 8])
      for (let seed = 1; seed <= 3; seed++) {
        const { R, seen } = playThrough(n, seed + n)
        for (const d of seen) {
          const wire = JSON.parse(JSON.stringify(R.encode(d)))
          const back = R.decode(wire)!
          expect(back.g.board.n).toBe(n)
          expect(Array.from(back.g.board.cells)).toEqual(Array.from(d.g.board.cells))
          expect(back.g.turn).toBe(d.g.turn)
          expect(R.encode(back)).toEqual(wire)
        }
      }
  })

  it('keeps the board size a game was started on', () => {
    const { R, d } = playThrough(6, 2)
    expect(breakthroughRules(8).decode(R.encode(d))!.g.board.n).toBe(6)
  })

  it('refuses a piece moving backwards, onto its own, or straight onto a piece; and unknown sizes', () => {
    const R = breakthroughRules(8)
    const first = moves(R.fresh('versus').g)[0]
    expect(replay(8, [[first.from, first.to]])).not.toBeNull()
    expect(replay(8, [[first.to, first.from]])).toBeNull() // nothing there yet
    expect(replay(8, [[first.from, first.from + 8]])).toBeNull() // backwards, onto its own back row
    expect(
      replay(8, [
        [first.from, first.to],
        [first.from, first.to],
      ]),
    ).toBeNull() // out of turn
    expect(replay(8, ['a'])).toBeNull()
    expect(R.decode({ n: 7, moves: [] })).toBeNull()
    expect(R.readMove({ from: 52, to: 44 })).toEqual({ from: 52, to: 44, take: false })
    expect(R.readMove([52, 64])).toBeNull()
  })
})

describe('breakthrough as a room game', () => {
  it('ends with a piece on the far row or the other side wiped out, and that side wins', () => {
    const seen = new Set<string>()
    for (let seed = 1; seed <= 12; seed++) {
      const { R, d } = playThrough(seed % 2 ? 6 : 8, seed)
      const r = R.result!(d)
      const side = r === 0 ? 1 : 2
      const b = d.g.board
      // asked of the board, not of the stored winner
      const through = Array.from(b.cells).some(
        (x, i) => x === side && advance(b.n, i, side) === b.n - 1,
      )
      expect(through || count(b, side === 1 ? 2 : 1) === 0).toBe(true)
      seen.add(String(r))
    }
    expect(seen.has('0') && seen.has('1')).toBe(true)
  })

  it('works out a take from the board, whatever the sender claims', () => {
    const R = breakthroughRules(6)
    const d = R.fresh('versus')
    const m = moves(d.g)[0]
    const claimed: Move = { ...m, take: true }
    expect(R.apply(d, claimed, 0).last!.take).toBe(false)
  })

  it('together: the computer plays the far side', () => {
    const R = breakthroughRules(6)
    expect(R.modes).toEqual(['versus', 'together'])
    const d = R.apply(R.fresh('together'), moves(R.fresh('together').g)[0], 0)
    expect(R.turn(d)).toBe(1)
    expect(R.legal(d, R.computer!.choose(d, 'easy'), 1)).toBe(true)
    expect(R.begun!(d)).toBe(true)
  })
})
