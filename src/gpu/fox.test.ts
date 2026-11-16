import { describe, expect, it } from 'vitest'
import { rng } from './bricks'
import {
  EMPTY,
  IDLE_LIMIT,
  N,
  POINTS,
  START_FOX,
  START_GEESE,
  TAKE_TO_WIN,
  choose,
  dirsAt,
  foxMoves,
  gooseMoves,
  match,
  newGame,
  play,
  readSaved,
  room,
  type Game,
  type Level,
  type Saved,
} from './fox'

const at = (r: number, c: number) => r * N + c
/** a game with the pieces where asked, the given side to move */
const board = (geese: number[], fox: number, turn: Game['turn'] = 'fox'): Game => ({
  ...newGame(),
  geese: new Set(geese),
  fox,
  turn,
})
const warm = (s: number) => {
  const r = rng(s)
  for (let i = 0; i < 8; i++) r()
  return r
}

describe('the board', () => {
  it('is a cross of thirty-three points, its lines running both ways', () => {
    expect(POINTS).toHaveLength(33)
    for (const i of POINTS)
      for (const [dr, dc] of dirsAt(i)) {
        const j = i + dr * N + dc
        expect(POINTS).toContain(j)
        expect(dirsAt(j)).toContainEqual([0 - dr || 0, 0 - dc || 0])
      }
    // the centre is joined eight ways, a point beside it only four, and a corner of an arm three
    expect(dirsAt(at(3, 3))).toHaveLength(8)
    expect(dirsAt(at(3, 2))).toHaveLength(4)
    expect(dirsAt(at(0, 2))).toHaveLength(3)
    // no diagonal from an odd point
    expect(dirsAt(at(1, 2)).some(([dr, dc]) => dr && dc)).toBe(false)
  })
  it('starts with seventeen geese across the top and the fox in the middle, the geese to move', () => {
    const g = newGame()
    expect(START_GEESE).toHaveLength(17)
    expect(g.geese.has(START_FOX)).toBe(false)
    expect(g.turn).toBe('geese')
  })
})

describe('moving', () => {
  it('takes a goose sideways or forward, never back', () => {
    const g = board([at(3, 3)], at(6, 2), 'geese')
    const to = gooseMoves(g).map((m) => m.path[1])
    expect(to).toEqual(expect.arrayContaining([at(3, 2), at(3, 4), at(4, 3), at(4, 2), at(4, 4)]))
    expect(to.some((j) => j < at(3, 0))).toBe(false)
  })
  it('lets the fox jump a goose along a line to the empty point beyond, and on again', () => {
    // geese below the fox and beyond: down twice
    const g = board([at(2, 3), at(4, 3)], at(1, 3))
    const run = foxMoves(g).find((m) => m.takes.length === 2)!
    expect(run.path).toEqual([at(1, 3), at(3, 3), at(5, 3)])
    // and it may stop after the first
    expect(foxMoves(g).some((m) => m.takes.length === 1 && m.path.length === 2)).toBe(true)
    // no jump onto a goose, or off the board
    expect(foxMoves(board([at(2, 3), at(3, 3)], at(1, 3))).some((m) => m.takes.length)).toBe(false)
    expect(
      foxMoves(board([at(1, 3)], at(2, 3))).some(
        (m) => m.path.includes(at(0, 3)) && m.takes.length,
      ),
    ).toBe(true)
    expect(foxMoves(board([at(0, 3)], at(1, 3))).some((m) => m.takes.length)).toBe(false)
  })
  it('lets the fox jump on a diagonal only where one runs', () => {
    // from an even point the diagonal runs; from an odd one it does not
    expect(foxMoves(board([at(3, 3)], at(2, 2))).some((m) => m.path[1] === at(4, 4))).toBe(true)
    expect(foxMoves(board([at(3, 4)], at(2, 3))).some((m) => m.takes.length)).toBe(false)
  })
  it('counts what the fox takes, and ends the game by any of its four ways', () => {
    const jumped = play(board([at(2, 3), at(4, 3), at(6, 2)], at(1, 3)), {
      path: [at(1, 3), at(3, 3), at(5, 3)],
      takes: [at(2, 3), at(4, 3)],
    })
    expect(jumped.taken).toBe(2)
    expect([...jumped.geese]).toEqual([at(6, 2)])
    // enough taken
    const near = { ...board([at(2, 3), at(3, 0), at(3, 1)], at(1, 3)), taken: TAKE_TO_WIN - 1 }
    expect(play(near, foxMoves(near).find((m) => m.takes.length)!).winner).toBe('fox')
    // the fox hemmed in, in the top corner of the arm: every neighbour a goose with a goose behind
    // it along the line, and a goose elsewhere to make the last move
    const shut = board(
      [at(0, 3), at(0, 4), at(1, 2), at(1, 3), at(2, 2), at(2, 4), at(4, 6)],
      at(0, 2),
      'geese',
    )
    expect(play(shut, { path: [at(4, 6), at(4, 5)], takes: [] }).winner).toBe('geese')
    // the geese with no move: one goose on the bottom edge, everything beside it taken by the board
    const stuck = board([at(6, 3), at(6, 2), at(6, 4)], at(0, 3), 'fox')
    expect(play(stuck, { path: [at(0, 3), at(0, 2)], takes: [] }).winner).toBe('fox')
    // and the geese's clock
    let g: Game = { ...board([at(3, 0), at(6, 4)], at(0, 3), 'geese'), idle: IDLE_LIMIT - 1 }
    g = play(g, { path: [at(3, 0), at(3, 1)], takes: [] })
    expect(g.winner).toBe('fox')
    // a step forward winds it back
    const fwd = play(
      { ...board([at(3, 0), at(6, 4)], at(0, 3), 'geese'), idle: 5 },
      {
        path: [at(3, 0), at(4, 0)],
        takes: [],
      },
    )
    expect(fwd.idle).toBe(0)
  })
  it('measures the room the fox has to walk in', () => {
    expect(room(board([], START_FOX))).toBe(32)
    // a fox in the top corner behind a wall across the arm
    expect(room(board([at(1, 2), at(1, 3), at(1, 4)], at(0, 2)))).toBe(2)
  })
})

describe('the computer', () => {
  it('as the fox takes the goose that wins, and as the geese guards one when it can', () => {
    // one more goose wins it: every level takes it. (Short of that, Hard sometimes passes a goose by
    // for a square that threatens more, which a look four moves deep can find worth it)
    const open = {
      ...board([at(2, 3), at(3, 0), at(3, 1), at(3, 5), at(3, 6)], at(1, 3)),
      taken: TAKE_TO_WIN - 1,
    }
    for (const level of ['easy', 'fair', 'hard'] as Level[])
      for (let s = 1; s <= 6; s++)
        expect(play(open, choose(open, level, warm(s))).winner).toBe('fox')
    // a goose with the fox below it and nothing behind: the geese close the hole or step away
    const g = board([at(2, 3), at(1, 2), at(6, 2), at(6, 4)], at(3, 3), 'geese')
    expect(foxMoves(g).some((m) => m.takes.length)).toBe(true)
    for (const level of ['fair', 'hard'] as Level[]) {
      const after = play(g, choose(g, level, warm(3)))
      expect(foxMoves(after).some((m) => m.takes.length)).toBe(false)
    }
  })
  it('plays better level by level, as either side', () => {
    // measured on other games: Fair geese beat an Easy fox 14 in 16 and a Fair fox beat Easy geese
    // 16 in 16; Hard geese beat a Fair fox 14 in 16 and a Hard fox beat Fair geese 16 in 16
    const wins = (geese: Level, fox: Level, side: 'geese' | 'fox', n: number) => {
      let w = 0
      for (let s = 1; s <= n; s++) if (match(geese, fox, warm(s * 17)).winner === side) w++
      return w
    }
    expect(wins('fair', 'easy', 'geese', 6)).toBeGreaterThanOrEqual(4)
    expect(wins('easy', 'fair', 'fox', 6)).toBeGreaterThanOrEqual(5)
    expect(wins('hard', 'fair', 'geese', 6)).toBeGreaterThanOrEqual(4)
    expect(wins('fair', 'hard', 'fox', 6)).toBeGreaterThanOrEqual(4)
  }, 120_000)
})

describe('what is kept', () => {
  it('round-trips every field that is not a default', () => {
    const s: Saved = {
      level: 'hard',
      side: 'fox',
      look: 'dusk',
      guides: false,
      record: { geese: { won: 3, lost: 1, drawn: 1 }, fox: { won: 2, lost: 5, drawn: 2 } },
    }
    for (const k of Object.keys(s) as (keyof Saved)[]) expect(s[k]).not.toEqual(EMPTY[k])
    expect(readSaved(JSON.stringify(s))).toEqual(s)
    expect(readSaved('{"side":"hen","look":"gold","guides":"no"}')).toEqual(EMPTY)
  })
})
