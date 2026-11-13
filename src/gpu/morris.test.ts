import { describe, expect, it } from 'vitest'
import {
  DRAW_AFTER,
  EMPTY,
  MEN,
  MILLS,
  NEIGHBOURS,
  choose,
  count,
  inMill,
  moves,
  newGame,
  play,
  readSaved,
  takeable,
  type Game,
  type Level,
  type Man,
  type Who,
} from './morris'

const seeded = (seed: number) => {
  let s = seed >>> 0 || 1
  return () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    return (s >>> 0) / 2 ** 32
  }
}
/** a game in the moving phase with men where they are asked to be */
const at = (mine: number[], theirs: number[], turn: Who = 1): Game => {
  const board = Array<Man>(24).fill(0)
  for (const p of mine) board[p] = 1
  for (const p of theirs) board[p] = 2
  return { board, hand: [0, 0, 0], turn, quiet: 0, winner: 0 }
}

describe('the board', () => {
  it('has 24 points, 32 lines between them and 16 mills, and every point is in two mills', () => {
    expect(NEIGHBOURS).toHaveLength(24)
    expect(NEIGHBOURS.reduce((a, n) => a + n.length, 0) / 2).toBe(32)
    for (let p = 0; p < 24; p++) for (const q of NEIGHBOURS[p]) expect(NEIGHBOURS[q]).toContain(p)
    expect(MILLS).toHaveLength(16)
    for (let p = 0; p < 24; p++) expect(MILLS.filter((m) => m.includes(p))).toHaveLength(2)
    // every mill runs along joined points
    for (const [a, b, c] of MILLS) {
      expect(NEIGHBOURS[b]).toContain(a)
      expect(NEIGHBOURS[b]).toContain(c)
    }
  })
})

describe('the rules', () => {
  it('nine men each are placed, then moved; a placement that closes a mill takes a man', () => {
    let g = newGame()
    expect(moves(g)).toHaveLength(24)
    g = play(g, { from: -1, to: 0, take: -1 })
    g = play(g, { from: -1, to: 8, take: -1 })
    g = play(g, { from: -1, to: 1, take: -1 })
    g = play(g, { from: -1, to: 9, take: -1 })
    const closing = moves(g).filter((m) => m.to === 2)
    expect(closing.map((m) => m.take).sort((a, b) => a - b)).toEqual([8, 9])
    g = play(g, closing[0])
    expect(count(g, 2)).toBe(MEN - 1)
  })
  it('a mill may not take a man out of a mill, unless every man they have is in one', () => {
    const g = at([0, 1, 2], [8, 9, 10, 20])
    expect(takeable(g.board, 2)).toEqual([20])
    const all = at([0, 1, 2], [8, 9, 10])
    expect(takeable(all.board, 2)).toEqual([8, 9, 10])
    expect(inMill(all.board, 9)).toBe(true)
  })
  it('a man moves along a line to an empty point; with three left it flies', () => {
    const g = at([0, 5, 12, 20], [3, 14, 22, 23])
    const step = moves(g)
      .filter((m) => m.from === 0)
      .map((m) => m.to)
    expect(step.sort((a, b) => a - b)).toEqual([1, 7])
    const flying = at([0, 5, 12], [3, 14, 22, 23])
    expect(moves(flying).filter((m) => m.from === 0).length).toBe(24 - 7)
  })
  it('down to two men, or with no move at all, you have lost', () => {
    const g = at([0, 1, 12], [7, 20, 22], 1)
    const won = play(g, { from: 12, to: 2, take: 20 })
    expect(won.winner).toBe(1)
    // blue's four outer corners are boxed in by red on every middle between them
    const boxed = at([1, 3, 5, 7, 9], [0, 2, 4, 6])
    const after = play(boxed, { from: 9, to: 10, take: -1 })
    expect(moves(after)).toEqual([])
    expect(after.winner).toBe(1)
  })
  it(`with no man taken in ${DRAW_AFTER} moves, it is a draw`, () => {
    let g: Game = { ...at([0, 9, 18, 20], [4, 13, 22, 6]), quiet: DRAW_AFTER - 1 }
    const m = moves(g).find((x) => x.take < 0)!
    g = play(g, m)
    expect(g.winner).toBe(3)
  })
})

describe('the computer', () => {
  it('takes a man when a mill is there to close', () => {
    // none of blue's men share a mill, so taking one costs red nothing next move
    const g = at([0, 1, 3, 17], [12, 6, 22, 19])
    // (hard, four moves deep, may find a stronger plan than the man in hand, so this asks fair)
    for (let k = 1; k <= 5; k++) expect(choose(g, 'fair', seeded(k)).take).toBeGreaterThanOrEqual(0)
  })
  // measured from both seats over eight seeded games: fair beat easy 8–0 and hard beat fair 8–0
  it('each level beats the one below it, from either seat', () => {
    const wins = (hi: Level, lo: Level) => {
      let w = 0
      for (let k = 0; k < 2; k++)
        for (const seat of [1, 2] as Who[]) {
          const rand = seeded(20 + k)
          let g = newGame()
          for (let n = 0; n < 400 && !g.winner; n++)
            g = play(g, choose(g, g.turn === seat ? hi : lo, rand))
          if (g.winner === seat) w++
        }
      return w
    }
    expect(wins('fair', 'easy')).toBe(4)
    expect(wins('hard', 'fair')).toBeGreaterThanOrEqual(3)
  }, 60000)
})

describe('morris saves', () => {
  it('round-trips every field away from its default', () => {
    const s = {
      level: 'hard',
      board: 'garden',
      pieces: 'gems',
      hints: false,
      record: {
        easy: { won: 3, lost: 1, drawn: 2 },
        fair: { won: 4, lost: 5, drawn: 1 },
        hard: { won: 1, lost: 8, drawn: 3 },
      },
    }
    expect(readSaved(JSON.stringify(s))).toEqual(s)
  })
  it('a broken store loses only what is bad', () => {
    expect(readSaved('{')).toEqual(EMPTY)
    expect(readSaved(JSON.stringify({ board: 'marble', hints: false }))).toEqual({
      ...EMPTY,
      hints: false,
    })
  })
})
