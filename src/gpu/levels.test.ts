import { describe, expect, it } from 'vitest'
import {
  COLS,
  EMPTY,
  ROOMS,
  ROWS,
  WAIT,
  at,
  begin,
  decode,
  encode,
  fromText,
  move,
  platesOf,
  readSaved,
  solve,
  type Dir,
  type Level,
} from './levels'

const U: Dir = 0
const R: Dir = 1
const D: Dir = 2
const L: Dir = 3
const W: Dir = WAIT

const play = (level: Level, path: Dir[]) => {
  let s = begin(level)!
  for (const d of path) s = move(s, d, platesOf(level))
  return s
}
/** a room from its first few rows, walled below */
const room = (rows: string[]) =>
  fromText('t', [...rows, ...Array(ROWS - rows.length).fill('############')])

describe('the rooms that ship', () => {
  it('every one is solvable, and its solution really wins when played', () => {
    for (const r of ROOMS) {
      const sol = solve(r)
      expect(sol.par, r.name).not.toBeNull()
      if (sol.par === null) continue
      expect(play(r, sol.path).over, r.name).toBe('won')
      expect(sol.path.length, r.name).toBe(sol.par)
    }
  })
})

describe('the rules', () => {
  it('walls stop you and cost nothing', () => {
    const s = begin(room(['############', '#S#........#', '#E.........#']))!
    expect(move(s, U, [])).toBe(s)
    expect(move(s, R, [])).toBe(s)
    expect(move(s, D, []).moves).toBe(1)
  })
  it('a crate is pushed one step, and fills a hole it is pushed into', () => {
    const s = move(begin(room(['############', '#SCO.E.....#']))!, R, [])
    expect(s.grid[at(3, 1)]).toBe('floor')
    expect(s.grid[at(2, 1)]).toBe('floor')
    expect(s.p).toBe(at(2, 1))
    // two crates in a row do not move
    const t = begin(room(['############', '#SCC.E.....#']))!
    expect(move(t, R, [])).toBe(t)
  })
  it('you cannot walk into a hole', () => {
    const s = begin(room(['############', '#SO.E......#']))!
    expect(move(s, R, [])).toBe(s)
  })
  it('ice slides you until something stops you, picking up on the way', () => {
    // two squares of ice, then a coin on plain floor: the slide stops on the coin
    const s = move(begin(room(['############', '#SII$I#..E.#']))!, R, [])
    expect(s.p).toBe(at(4, 1))
    expect(s.coinsLeft).toBe(0)
    // all ice to the wall is one move, however far
    const t = move(begin(room(['############', '#SIIII#..E.#']))!, R, [])
    expect(t.p).toBe(at(5, 1))
    expect(t.moves).toBe(1)
  })
  it('a key opens one door of its colour; the gold key opens either', () => {
    const s = play(room(['############', '#SrRRE.....#']), [R, R, R])
    expect(s.p).toBe(at(3, 1))
    expect(move(s, R, [])).toBe(s)
    expect(play(room(['############', '#SgBE......#']), [R, R, R]).over).toBe('won')
  })
  it('the exit opens only once every coin is taken', () => {
    const r = room(['############', '#SE$.......#'])
    expect(play(r, [R]).over).toBe(null)
    expect(play(r, [R, R, L]).over).toBe('won')
  })
  it('spikes are up after odd moves: end an odd move on them and it is over', () => {
    const r = room(['############', '#S^.^E.....#'])
    expect(play(r, [R]).over).toBe('spiked')
    // waiting a turn first lands on them when they are down
    expect(play(r, [W, R]).over).toBe(null)
    expect(play(r, [W, R, R, R, R]).over).toBe('won')
    // and waiting on them while they rise is as bad as stepping on
    expect(play(r, [W, R, W]).over).toBe('spiked')
  })
  it('without waiting, a square is always reached on the same parity — why waiting exists', () => {
    // a chessboard: every step changes colour, so this spike is always up when you get there
    const sol = solve(room(['############', '#S^.......E#']))
    expect(sol.par).not.toBeNull()
    if (sol.par !== null) expect(sol.path).toContain(W)
  })
  it('a gate is open while something stands on a plate, a crate included', () => {
    const r = room(['#...########', '#S.C..G.E..#', '#..P.......#'])
    // with nothing on the plate, the gate stops you
    expect(play(r, [R, R, U, R, R, D, R, R, R]).p).not.toBe(at(8, 1))
    // up and round to stand above the crate, push it down onto the plate, then walk through
    const s = play(r, [U, R, R, D])
    expect(s.grid[at(3, 2)]).toBe('crateOnPlate')
    const t = play(r, [U, R, R, D, R, R, R, R, R])
    expect(t.over).toBe('won')
  })
  it('the solver finds the shortest way, and says when there is none', () => {
    expect(solve(room(['############', '#S...E.....#'])).par).toBe(4)
    expect(solve(room(['############', '#S#E.......#'])).par).toBe(null)
    expect(solve(room(['############', '#S..........'])).par).toBe(null)
  })
})

describe('a room as a link', () => {
  const r: Level = { ...ROOMS[1], name: 'Ünïcode ✓ room', theme: 'space' }
  it('round-trips every square, the name and the theme, and stays short', () => {
    expect(decode(encode(r))).toEqual(r)
    expect(encode(r).length).toBeLessThan(120)
  })
  it('turns away anything malformed, including a room with no start or two', () => {
    const good = encode(r)
    expect(decode(good.slice(0, -4))).toBeNull()
    expect(decode('x'.repeat(80))).toBeNull()
    const twoStarts: Level = { ...r, grid: r.grid.map((t, i) => (i === at(10, 7) ? 'start' : t)) }
    expect(decode(encode(twoStarts))).toBeNull()
    expect(COLS * ROWS).toBe(108)
  })
})

describe('levels saves', () => {
  it('round-trips every field away from its default', () => {
    const s = {
      draft: encode(ROOMS[2]),
      kept: [encode(ROOMS[0]), encode(ROOMS[3])],
      best: { [encode(ROOMS[0])]: 31 },
      hero: { colour: 6, hat: 'crown' },
    }
    expect(readSaved(JSON.stringify(s))).toEqual(s)
  })
  it('a broken store loses only what is bad', () => {
    expect(readSaved('{')).toEqual(EMPTY)
    const back = readSaved(
      JSON.stringify({
        kept: ['bad', encode(ROOMS[0])],
        best: { nope: 3 },
        hero: { colour: 99, hat: 'wizard' },
      }),
    )
    expect(back).toEqual({ ...EMPTY, kept: [encode(ROOMS[0])] })
  })
})
