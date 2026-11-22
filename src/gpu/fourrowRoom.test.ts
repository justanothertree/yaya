import { describe, expect, it } from 'vitest'
import { fourRowRules, type FourGame } from './fourrowRoom'
import { newGrid } from './fourrow'

const rules = fourRowRules('classic', 4)

describe('Four in a row as a room game', () => {
  it('seat 0 is the first colour and moves first; seats alternate', () => {
    let g = rules.fresh()
    expect(rules.turn(g)).toBe(0)
    g = rules.apply(g, 3)
    expect(rules.turn(g)).toBe(1)
    expect(g.g.cells[3]).toBe(1)
  })
  it('a column that is full, or not there, is not a move', () => {
    let g = rules.fresh()
    for (let i = 0; i < 6; i++) g = rules.apply(g, 0)
    expect(rules.legal(g, 0)).toBe(false)
    expect(rules.legal(g, 7)).toBe(false)
    expect(rules.legal(g, -1)).toBe(false)
    expect(rules.legal(g, 1)).toBe(true)
  })
  it('four in a row ends the game with the line, and nobody moves after', () => {
    let g = rules.fresh()
    for (const c of [0, 0, 1, 1, 2, 2, 3]) g = rules.apply(g, c)
    expect(rules.turn(g)).toBeNull()
    expect(g.line).toEqual([0, 1, 2, 3])
    expect(g.winner).toBe(1)
    expect(rules.legal(g, 4)).toBe(false)
  })
  it('a full grid with no line is a draw', () => {
    // a whole 6x5 game that never lines up four (found by search, then pinned)
    const small = fourRowRules('small', 4)
    let g = small.fresh()
    const order = [
      3, 3, 0, 5, 0, 5, 5, 2, 4, 5, 2, 2, 0, 0, 2, 5, 3, 4, 4, 4, 2, 4, 0, 3, 1, 3, 1, 1, 1, 1,
    ]
    for (const c of order) if (small.turn(g) !== null) g = small.apply(g, c)
    expect(g.moves).toBe(30)
    expect(g.winner).toBe(0)
    expect(small.turn(g)).toBeNull()
  })
})

describe('the board on the wire', () => {
  /* a board where every field is something other than its default (CLAUDE.md §2) */
  const played = (): FourGame => {
    const wide = fourRowRules('wide', 5)
    let g = wide.fresh()
    for (const c of [4, 4, 5, 3, 6]) g = wide.apply(g, c)
    return g
  }
  it('round-trips a board that is not the default in any field', () => {
    const g = played()
    expect(rules.decode(JSON.parse(JSON.stringify(rules.encode(g))))).toEqual(g)
    let won = rules.fresh()
    for (const c of [0, 0, 1, 1, 2, 2, 3]) won = rules.apply(won, c)
    expect(rules.decode(JSON.parse(JSON.stringify(rules.encode(won))))).toEqual(won)
  })
  it('refuses a board that could not have been played', () => {
    const good = rules.encode(played()) as Record<string, unknown>
    const bad: Record<string, unknown>[] = [
      { ...good, cols: 99 },
      { ...good, need: 9 },
      { ...good, cells: (good.cells as number[]).slice(1) },
      { ...good, cells: (good.cells as number[]).map((c, i) => (i === 0 ? 7 : c)) },
      // a disc floating above an empty space
      { ...good, cells: (good.cells as number[]).map((c, i) => (i === 4 ? 0 : c)) },
      { ...good, heights: (good.heights as number[]).map(() => 0) },
      { ...good, turn: 3 },
      // two of one colour more than the other, with the count of moves to match: somebody
      // moved twice
      {
        ...good,
        cells: (good.cells as number[]).map((c, i) => (i === 0 ? 1 : c)),
        heights: (good.heights as number[]).map((h, i) => (i === 0 ? 1 : h)),
        moves: (good.moves as number) + 1,
      },
      { ...good, line: [999] },
      { ...good, moves: -1 },
    ]
    for (const b of bad) expect(rules.decode(b)).toBeNull()
    // a win whose "line" includes the loser's disc
    let won = rules.fresh()
    for (const c of [0, 0, 1, 1, 2, 2, 3]) won = rules.apply(won, c)
    const w = rules.encode(won) as Record<string, unknown>
    expect(rules.decode({ ...w, line: [0, 1, 2, 7] })).toBeNull()
    expect(rules.decode(w)).not.toBeNull()
    expect(rules.decode(null)).toBeNull()
    expect(rules.decode('board')).toBeNull()
  })
  it('reads a move as a column number and nothing else', () => {
    expect(rules.readMove(3)).toBe(3)
    for (const m of [3.5, '3', -1, 9, null, {}]) expect(rules.readMove(m)).toBeNull()
  })
  it('a fresh board is the toy’s own new grid', () => {
    expect(rules.fresh().g).toEqual(newGrid('classic', 4))
  })
})
