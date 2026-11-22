import { describe, expect, it } from 'vitest'
import {
  EMPTY,
  board,
  choose,
  ends,
  gives,
  isHorizontal,
  lineCount,
  newGame,
  open,
  over,
  play,
  readSaved,
  recordGame,
  safe,
  sides,
  takes,
  type Game,
  type Level,
  type Player,
} from './dots'

const seeded = (seed: number) => {
  let s = seed >>> 0 || 1
  return () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    return (s >>> 0) / 2 ** 32
  }
}
/** the line between two neighbouring dots, found by asking every line where it runs */
const between = (g: Game, r0: number, c0: number, r1: number, c1: number) => {
  for (let l = 0; l < lineCount(g.b); l++) {
    const [a, b, c, d] = ends(g.b, l)
    if (
      (a === r0 && b === c0 && c === r1 && d === c1) ||
      (a === r1 && b === c1 && c === r0 && d === c0)
    )
      return l
  }
  throw new Error('no such line')
}

function match(a: Level, b: Level, size: number, seed: number) {
  const rand = seeded(seed)
  const g = newGame(size, size, seed % 2 ? 0 : 1)
  while (!over(g)) play(g, choose(g, g.turn === 0 ? a : b, rand))
  return g
}

describe('the board', () => {
  it('has the right lines, each running between neighbouring dots', () => {
    const b = board(3, 4)
    expect(lineCount(b)).toBe(4 * 4 + 3 * 5)
    for (let l = 0; l < lineCount(b); l++) {
      const [r0, c0, r1, c1] = ends(b, l)
      expect(Math.abs(r1 - r0) + Math.abs(c1 - c0)).toBe(1)
      expect(isHorizontal(b, l)).toBe(r0 === r1)
      // an edge line borders one box, an inside one two
      const edge = (r0 === r1 && (r0 === 0 || r0 === 3)) || (c0 === c1 && (c0 === 0 || c0 === 4))
      expect(b.boxesOf[l]).toHaveLength(edge ? 1 : 2)
    }
    for (const lines of b.linesOf) expect(new Set(lines).size).toBe(4)
  })
})

describe('the rules', () => {
  it('closing a box scores it and draws again; otherwise the turn passes', () => {
    const g = newGame(2, 2)
    play(g, between(g, 0, 0, 0, 1))
    expect(g.turn).toBe(1)
    play(g, between(g, 0, 0, 1, 0))
    play(g, between(g, 1, 0, 1, 1))
    expect(g.turn).toBe(1)
    expect(takes(g, between(g, 0, 1, 1, 1))).toBe(true)
    const closed = play(g, between(g, 0, 1, 1, 1))
    expect(closed).toEqual([0])
    expect(g.score).toEqual([0, 1])
    expect(g.turn).toBe(1)
    expect(g.owner[0]).toBe(1)
  })
  it('one line can close two boxes at once', () => {
    const g = newGame(1, 2)
    for (const [a, b, c, d] of [
      [0, 0, 0, 1],
      [0, 1, 0, 2],
      [1, 0, 1, 1],
      [1, 1, 1, 2],
      [0, 0, 1, 0],
      [0, 2, 1, 2],
    ])
      play(g, between(g, a, b, c, d))
    const before = g.turn
    expect(play(g, between(g, 0, 1, 1, 1))).toHaveLength(2)
    expect(g.score[before]).toBe(2)
    expect(over(g)).toBe(true)
  })
  it('knows a safe line, a giving one, and how much it gives', () => {
    const g = newGame(1, 3)
    // a box with two sides: the third gives it away
    play(g, between(g, 0, 0, 0, 1))
    play(g, between(g, 1, 0, 1, 1))
    expect(sides(g, 0)).toBe(2)
    expect(safe(g, between(g, 0, 0, 1, 0))).toBe(false)
    expect(safe(g, between(g, 0, 2, 0, 3))).toBe(true)
    expect(gives(g, between(g, 0, 0, 1, 0))).toBe(1)
    expect(gives(g, between(g, 0, 2, 0, 3))).toBe(0)
    expect(() => play(g, between(g, 0, 0, 0, 1))).toThrow()
  })
})

describe('the computer', () => {
  it('never passes up a box at fair or hard', () => {
    const g = newGame(2, 2)
    play(g, between(g, 0, 0, 0, 1))
    play(g, between(g, 0, 0, 1, 0))
    play(g, between(g, 1, 0, 1, 1))
    for (const level of ['fair', 'hard'] as Level[])
      expect(choose(g, level, seeded(1))).toBe(between(g, 0, 1, 1, 1))
  })
  it('every game ends with every box owned and every line drawn', () => {
    for (const size of [3, 5]) {
      const g = match('easy', 'hard', size, 9)
      expect(g.score[0] + g.score[1]).toBe(size * size)
      expect(open(g)).toEqual([])
    }
  })
  // Each seed is played twice, the stronger player in each seat, since whoever moves first matters.
  // Measured over twenty such games on each size: hard beat fair 18–2 on 3×3, 15–2 on 4×4 and
  // 19–1 on 5×5, while fair against fair split 10–10, 9–9 and 10–10 — so the margin is the level,
  // not the seat. Hard's slowest move, on 6×6, took 39 ms. Seeded, so the same every run.
  it('each level beats the one below it, from either seat', () => {
    const wins = (hi: Level, lo: Level, size: number) => {
      let n = 0
      for (let k = 0; k < 8; k++)
        for (const seat of [0, 1] as Player[]) {
          const rand = seeded(500 + k)
          const g = newGame(size, size, 0)
          while (!over(g)) play(g, choose(g, g.turn === seat ? hi : lo, rand))
          if (g.score[seat] > g.score[seat === 0 ? 1 : 0]) n++
        }
      return n
    }
    expect(wins('fair', 'easy', 3)).toBeGreaterThanOrEqual(15)
    // hard wins 11 of these 16 (draws are possible on 4×4); made to play as fair, it wins 7
    expect(wins('hard', 'fair', 4)).toBeGreaterThanOrEqual(10)
  }, 30000)
})

describe('dots saves', () => {
  it('a game moves the record on', () => {
    let r = EMPTY.record.hard
    r = recordGame(r, 10, 6)
    r = recordGame(r, 8, 8)
    r = recordGame(r, 2, 14)
    expect(r).toEqual({ won: 1, lost: 1, drawn: 1, best: 4 })
  })
  it('round-trips every field away from its default', () => {
    const s = {
      level: 'hard',
      size: 6,
      mine: 4,
      theirs: 2,
      fill: 'stripes',
      initial: '🦊',
      initial2: 'Q',
      record: {
        easy: { won: 3, lost: 1, drawn: 2, best: 9 },
        fair: { won: 4, lost: 5, drawn: 1, best: 7 },
        hard: { won: 1, lost: 8, drawn: 3, best: 2 },
      },
    }
    expect(readSaved(JSON.stringify(s))).toEqual(s)
  })
  it('a broken store loses only what is bad, and two players never share a colour', () => {
    expect(readSaved('{')).toEqual(EMPTY)
    expect(
      readSaved(JSON.stringify({ size: 9, mine: 3, theirs: 3, initial: 'AB', level: 'hard' })),
    ).toEqual({
      ...EMPTY,
      level: 'hard',
    })
  })
})
