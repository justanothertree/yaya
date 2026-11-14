import { describe, expect, it } from 'vitest'
import { choose, count, moves, start } from './reversi'
import { readReversiGame, reversiRules, type ReversiGame } from './reversiRoom'
import { outcomeFor, type Room } from '../lab/social/room'

const rules = reversiRules(6)
/** a whole game, both sides chosen by reversi.ts's own computer, through the room's rules */
function playOut(seed = 1): ReversiGame {
  let s = seed
  const rand = () => (s = (s * 16807) % 2147483647) / 2147483647
  let g = rules.fresh('versus')
  for (let guard = 0; guard < 200 && g.turn !== null; guard++) {
    const m = choose(g.b, g.turn, 'easy', rand)
    expect(rules.legal(g, m, g.turn === 1 ? 0 : 1)).toBe(true)
    g = rules.apply(g, m, g.turn === 1 ? 0 : 1)
    // every board a game reaches survives the wire
    expect(readReversiGame(JSON.parse(JSON.stringify(rules.encode(g))))).toEqual(g)
  }
  return g
}

describe('reversi as a room game', () => {
  it('plays a whole game to the end, every board surviving the wire, and names the winner', () => {
    const g = playOut(7)
    expect(g.turn).toBeNull()
    const [d, l] = count(g.b)
    expect(rules.result!(g)).toBe(d > l ? 0 : l > d ? 1 : 'draw')
  })
  it('passes are the toy’s: a side with no move is skipped, not stuck', () => {
    // dark to move on a board where light then has nothing: dark moves again
    const cells = start(6).cells.map(() => 0 as 0 | 1 | 2)
    cells[0] = 1
    cells[1] = 2
    const g: ReversiGame = { b: { n: 6, cells }, turn: 1 }
    expect(rules.legal(g, 2, 0)).toBe(true)
    const after = rules.apply(g, 2, 0)
    expect(after.turn).toBeNull() // nobody can move: three dark discs, nothing to bracket
  })
  it('refuses a move out of turn, on a filled square, or that turns nothing', () => {
    const g = rules.fresh('versus')
    expect(rules.legal(g, moves(g.b, 1)[0], 1)).toBe(false) // light, on dark's turn
    expect(rules.legal(g, 14, 0)).toBe(false) // a starting disc
    expect(rules.legal(g, 0, 0)).toBe(false) // a corner that brackets nothing
    expect(rules.readMove(3.5)).toBeNull()
    expect(rules.readMove(-1)).toBeNull()
  })
  it('refuses a board no game reaches, or one it could not play on', () => {
    const ok = rules.encode(rules.fresh('versus')) as { n: number; cells: number[]; turn: number }
    expect(readReversiGame(ok)).not.toBeNull()
    for (const bad of [
      null,
      { ...ok, n: 7 },
      { ...ok, cells: ok.cells.slice(1) },
      { ...ok, cells: ok.cells.map((c, i) => (i === 0 ? 3 : c)) },
      { ...ok, cells: ok.cells.map(() => 0) },
      { ...ok, turn: 0 }, // called over with moves left
      { ...ok, turn: 5 },
    ])
      expect(readReversiGame(bad), JSON.stringify(bad)).toBeNull()
  })
  it('the computer plays light, with the toy’s own choice, and a game has begun after one move', () => {
    const g = rules.fresh('together')
    expect(rules.begun!(g)).toBe(false)
    const after = rules.apply(g, moves(g.b, 1)[0], 0)
    expect(rules.begun!(after)).toBe(true)
    expect(rules.computer!.side).toBe(1)
    const m = rules.computer!.choose(after, 'hard')
    expect(rules.legal(after, m, 1)).toBe(true)
  })
  it('a finished game is each seat’s own result, and together it is the team’s', () => {
    const g = playOut(3)
    const r = rules.result!(g)
    const room = (mode: 'versus' | 'together', me: string): Room<ReversiGame> => ({
      sub: 'reversi',
      me,
      seq: 9,
      from: 'ann',
      seats: ['ann', 'bo'],
      mode,
      level: 2,
      next: 1,
      game: g,
      present: [],
      missing: {},
    })
    const v = (me: string) => outcomeFor(rules, room('versus', me))
    if (r === 'draw') expect([v('ann'), v('bo')]).toEqual(['drawn', 'drawn'])
    else expect([v('ann'), v('bo')]).toEqual(r === 0 ? ['won', 'lost'] : ['lost', 'won'])
    // together, both seats play dark and share dark's result; a watcher has none
    const t = outcomeFor(rules, room('together', 'bo'))
    expect(t).toBe(outcomeFor(rules, room('together', 'ann')))
    expect(t).toBe(r === 'draw' ? 'drawn' : r === 0 ? 'won' : 'lost')
    expect(outcomeFor(rules, room('versus', 'cy'))).toBeNull()
  })
})
