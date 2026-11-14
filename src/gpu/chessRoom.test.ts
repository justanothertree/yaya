import { describe, expect, it } from 'vitest'
import { fromFen, moves, play } from './chess'
import { MAX_MOVES, chessRules, replay, uci } from './chessRoom'

const SCHOLAR = ['e2e4', 'e7e5', 'f1c4', 'b8c6', 'd1h5', 'g8f6', 'h5f7']

describe('chess as a room game, sent as its moves', () => {
  it('replays a game to its end, and names the winner by chess.ts’s own rules', () => {
    const g = replay(SCHOLAR)!
    expect(g.over).toEqual({ winner: 'w', why: 'checkmate' })
    expect(g.turns.at(-1)!.name).toBe('Qxf7#')
    expect(chessRules.turn(g)).toBeNull()
    expect(chessRules.result!(g)).toBe(0)
    // and the wire carries exactly the moves, which come back as the same game
    expect(chessRules.decode(JSON.parse(JSON.stringify(chessRules.encode(g))))).toEqual(g)
  })
  it('refuses a list with any move that is not legal where it stands', () => {
    for (const bad of [
      ['e2e5'], // a pawn cannot go three
      ['e7e5'], // black first
      ['e2e4', 'e7e5', 'e1e3'], // a king two squares
      [...SCHOLAR, 'a7a6'], // a move after mate
      ['e2e4', 'xx'],
    ])
      expect(chessRules.decode({ moves: bad }), bad.join(' ')).toBeNull()
    expect(chessRules.decode(null)).toBeNull()
    expect(chessRules.decode({ moves: 'e2e4' })).toBeNull()
    expect(chessRules.decode({ moves: Array(MAX_MOVES + 1).fill('e2e4') })).toBeNull()
  })
  it('writes promotion into the move, and only the piece asked for is made', () => {
    // white pawn on b7, kings far apart: b7b8 needs a piece named
    const p = fromFen('7k/1P6/8/8/8/8/8/K7 w - - 0 1')
    const codes = moves(p)
      .filter((m) => m.from === 9)
      .map(uci)
      .sort()
    expect(codes).toEqual(['b7b8b', 'b7b8n', 'b7b8q', 'b7b8r'])
    expect(chessRules.readMove('b7b8k')).toBeNull()
    expect(chessRules.readMove('b7b8q')).toBe('b7b8q')
    expect(play(p, moves(p).find((m) => uci(m) === 'b7b8n')!).sq[1]).toBe('N')
  })
  it('a move is legal only for the side to move, and only once the game is going', () => {
    const g = chessRules.fresh('versus')
    expect(chessRules.begun!(g)).toBe(false)
    expect(chessRules.legal(g, 'e2e4', 0)).toBe(true)
    expect(chessRules.legal(g, 'e2e4', 1)).toBe(false)
    expect(chessRules.legal(g, 'e7e5', 1)).toBe(false)
    const after = chessRules.apply(g, 'e2e4', 0)
    expect(chessRules.begun!(after)).toBe(true)
    expect(chessRules.turn(after)).toBe(1)
  })
  it('the computer plays black, legally, with the game’s history in mind', () => {
    let g = chessRules.fresh('together')
    for (let i = 0; i < 6; i++) {
      const by = chessRules.turn(g) as 0 | 1
      const code =
        by === 1 ? chessRules.computer!.choose(g, 'easy') : uci(moves(g.turns.at(-1)!.pos)[0])
      expect(chessRules.legal(g, code, by)).toBe(true)
      g = chessRules.apply(g, code, by)
    }
    expect(g.list).toHaveLength(6)
  })
})
