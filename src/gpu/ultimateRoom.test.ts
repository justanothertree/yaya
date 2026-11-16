import { describe, expect, it } from 'vitest'
import { LINES, choose } from './ultimate'
import { replay, ultimateRules as R, type UltimateGame } from './ultimateRoom'

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
  const seen: UltimateGame[] = []
  while (R.turn(d) !== null) {
    const side = R.turn(d) as 0 | 1
    const at = choose(d.g, 'easy', rnd)
    expect(R.legal(d, at, side)).toBe(true)
    d = R.apply(d, at, side)
    seen.push(d)
  }
  return { d, seen }
}

describe('ultimate noughts on the wire', () => {
  it('survives the round trip for every position of real games', () => {
    for (let seed = 1; seed <= 6; seed++)
      for (const d of playThrough(seed).seen) {
        const wire = JSON.parse(JSON.stringify(R.encode(d)))
        const back = R.decode(wire)!
        expect(back.g).toEqual(d.g)
        expect(R.encode(back)).toEqual(wire)
      }
  })

  it('refuses a square taken, a square on the wrong small board, and squares off the board', () => {
    expect(replay([40, 40])).toBeNull()
    // 40 is the middle of the middle board, so the next mark must go in the middle board
    expect(replay([40, 0])).toBeNull()
    expect(replay([40, 36])).not.toBeNull()
    expect(replay([81])).toBeNull()
    expect(replay([1.5])).toBeNull()
    expect(R.decode({ moves: 'all' })).toBeNull()
  })
})

describe('ultimate noughts as a room game', () => {
  it('ends with three small boards in a line, or a draw, and the line’s owner wins', () => {
    const seen = new Set<string>()
    for (let seed = 1; seed <= 16; seed++) {
      const { d } = playThrough(seed)
      const r = R.result!(d)
      seen.add(String(r))
      if (r === 'draw') {
        expect(d.g.boards.every(Boolean)).toBe(true)
        continue
      }
      // asked of the small boards themselves: three of the winner's in a line
      const mark = r === 0 ? 1 : 2
      expect(LINES.some((l) => l.every((k) => d.g.boards[k] === mark))).toBe(true)
    }
    expect(seen.has('0') && seen.has('1')).toBe(true)
  })

  it('together: the computer plays the second mark with the toy’s own levels', () => {
    expect(R.modes).toEqual(['versus', 'together'])
    const d = R.apply(R.fresh('together'), 40, 0)
    expect(R.turn(d)).toBe(1)
    expect(R.legal(d, R.computer!.choose(d, 'easy'), 1)).toBe(true)
    expect(R.legal(d, 41, 0)).toBe(false)
    expect(R.begun!(d)).toBe(true)
  })
})
