import { describe, expect, it } from 'vitest'
import {
  BLUE,
  DX,
  DY,
  GREEN,
  LEVELS,
  PARS,
  RED,
  fitPlaced,
  packCells,
  packSegments,
  parse,
  readSaved,
  solve,
  solved,
  trace,
  turn,
  type Dir,
  type Piece,
} from './beams'

const mirror = (t: 0 | 1): Piece => ({ kind: 'mirror', turn: t })
const splitter = (t: 0 | 1): Piece => ({ kind: 'splitter', turn: t })
const filter = (c: number): Piece => ({ kind: 'filter', turn: 0, colour: c })

describe('how light turns', () => {
  it('reflects off "/" and "\\" the way a mirror at that angle does', () => {
    for (const d of [0, 1, 2, 3] as Dir[]) {
      // on screen, y grows downward: "/" maps (dx, dy) to (−dy, −dx), and "\\" to (dy, dx)
      const a = turn(d, 0)
      expect([DX[a], DY[a]]).toEqual([-DY[d] || 0, -DX[d] || 0])
      const b = turn(d, 1)
      expect([DX[b], DY[b]]).toEqual([DY[d], DX[d]])
      // and a mirror turned back the way it came returns the beam along its path
      expect(turn(((turn(d, 0) + 2) % 4) as Dir, 0)).toBe((d + 2) % 4)
    }
  })
})

describe('tracing', () => {
  const open = (light = [RED]) => parse('t', '', ['.....', '>...1', '.....'], light, [])

  it('runs to a target and lights it, and stops at a wall or the edge', () => {
    const l = open()
    const t = trace(l, {})
    expect(t.received).toEqual([RED])
    expect(t.segments).toEqual([{ x0: 0.5, y0: 1.5, x1: 4.5, y1: 1.5, colour: RED }])
    const w = parse('w', '', ['>.#.1'], [RED], [])
    expect(trace(w, {}).segments[0].x1).toBe(2) // the wall's near edge
    expect(trace(w, {}).received).toEqual([0])
    const e = parse('e', '', ['>....', '....1'], [RED], [])
    expect(trace(e, {}).segments[0].x1).toBe(5) // the board's edge
  })

  it('a splitter sends the beam on and a copy aside; a filter keeps its own colour only', () => {
    const l = parse('s', '', ['..1..', '>....', '.....'], [RED], [])
    const t = trace(l, { '2,1': splitter(0) })
    expect(t.received).toEqual([RED])
    expect(t.segments.length).toBe(3) // in, on, and up
    const f = parse('f', '', ['>...2'], [7], [])
    expect(trace(f, { '2,0': filter(GREEN) }).received).toEqual([GREEN])
    expect(trace(f, { '2,0': filter(BLUE) }).received).toEqual([BLUE])
    // a filter of a colour the beam does not carry stops it
    const r = parse('r', '', ['>...2'], [RED], [])
    expect(trace(r, { '2,0': filter(GREEN) }).received).toEqual([0])
    expect(trace(r, { '2,0': filter(GREEN) }).segments.length).toBe(1)
  })

  it('adds colours, and a target wants exactly its own', () => {
    // red from the left and green from above meet in the target: yellow
    const y = parse('y', '', ['..v..', '.....', '>.3..'], [GREEN, RED], [])
    expect(trace(y, {}).received).toEqual([RED | GREEN])
    expect(solved(y, trace(y, {}))).toBe(true)
    // the same light into a red target is too much, not more than enough
    const r = parse('r', '', ['..v..', '.....', '>.1..'], [GREEN, RED], [])
    expect(solved(r, trace(r, {}))).toBe(false)
    expect(solved(r, trace(r, { '2,1': mirror(0) }))).toBe(true)
  })

  it('ends a closed loop instead of following it for ever', () => {
    // a ring of three mirrors and a splitter, the light let in from above: what goes round comes
    // back through the splitter, which sends a copy round again — for ever, unless something stops it
    const l = parse('loop', '', ['.v...', '.....', '.....', '.....', '....1'], [RED], [])
    const placed = {
      '1,1': splitter(0),
      '3,1': mirror(1),
      '3,3': mirror(0),
      '1,3': mirror(1),
    }
    const t = trace(l, placed)
    expect(t.segments.length).toBeLessThan(20)
    // and it really is a ring: the light went down the left, along the bottom and up the right
    expect(t.segments.some((g) => g.x0 === 3.5 && g.y0 === 3.5 && g.y1 === 1.5)).toBe(true)
  })
})

describe('the levels', () => {
  it('every level is dark until something is placed, and solvable with its own stock', () => {
    expect(PARS.length).toBe(LEVELS.length)
    LEVELS.forEach((l, i) => {
      expect(solved(l, trace(l, {})), l.name).toBe(false)
      const s = solve(l)
      expect(s, l.name).not.toBeNull()
      // the fewest pieces is the par the page shows
      expect(Object.keys(s!).length, l.name).toBe(PARS[i])
      // and the solution really is one, asked of the tracer itself
      expect(solved(l, trace(l, s!)), l.name).toBe(true)
      // and needs no more than the stock offers
      expect(fitPlaced(l, s)).toEqual(s)
    })
  })

  it('no level can be done with fewer pieces than its par', () => {
    LEVELS.forEach((l, i) => expect(solve(l, PARS[i] - 1), l.name).toBeNull())
  })

  it('the names are distinct, and every level has a hint', () => {
    expect(new Set(LEVELS.map((l) => l.name)).size).toBe(LEVELS.length)
    for (const l of LEVELS) expect(l.hint.length).toBeGreaterThan(10)
  })

  it('refuses a level drawn wrong', () => {
    expect(() => parse('x', '', ['>..', '..'], [RED], [])).toThrow(/wide/)
    expect(() => parse('x', '', ['>.?'], [RED], [])).toThrow(/what/)
    expect(() => parse('x', '', ['>.1'], [], [])).toThrow(/emitters/)
  })
})

describe('kept in this browser', () => {
  it('round-trips bests, the level and its pieces, with every field set', () => {
    const level = 4
    const l = LEVELS[level]
    const placed = solve(l)!
    const saved = { best: { [LEVELS[0].name]: 1, [l.name]: 5 }, level, placed }
    expect(readSaved(JSON.stringify(saved))).toEqual(saved)
  })

  it('drops what the level could not hold, and junk', () => {
    const l = LEVELS[0] // one mirror, a 7 × 5 board
    const r = readSaved(
      JSON.stringify({
        best: { 'First light': 1, Nope: 3, 'Round the wall': -1 },
        level: 0,
        placed: {
          '0,3': mirror(0), // the emitter's own cell
          '6,0': mirror(0), // the target's
          '9,9': mirror(0), // off the board
          '2,2': { kind: 'mirror', turn: 3 },
          '3,3': mirror(1),
          '4,3': mirror(0), // a second mirror when the stock is one
          '5,3': splitter(0), // a kind this level has none of
        },
      }),
    )
    expect(r.best).toEqual({ 'First light': 1 })
    expect(r.placed).toEqual({ '3,3': mirror(1) })
    expect(readSaved('nope')).toEqual({ best: {}, level: 0, placed: {} })
    expect(readSaved(JSON.stringify({ level: 99 })).level).toBe(0)
    void l
  })
})

describe('for the GPU', () => {
  it('packs each cell as (kind, turn, colour, flags) and each beam as two vec4s', () => {
    const l = LEVELS[8] // fixed in place
    const placed = solve(l)!
    const t = trace(l, placed)
    const cells = packCells(l, placed, t, '4,3')
    expect(cells.length).toBe(l.w * l.h * 4)
    const at = (x: number, y: number) => [...cells.slice((y * l.w + x) * 4, (y * l.w + x) * 4 + 4)]
    expect(at(3, 1)).toEqual([2, 1, 0, 1]) // a fixed "\" mirror
    expect(at(4, 3)).toEqual([4, 0, RED, 4]) // the placed red filter, selected
    expect(at(0, 1)).toEqual([5, 0, 7, 1]) // the white emitter, facing east
    expect(at(6, 3)).toEqual([6, RED, RED, 3]) // the red target, lit
    const segs = packSegments(t.segments, 999)
    expect(segs.length).toBe(t.segments.length * 8)
    expect([...segs.slice(4, 8)]).toEqual([1, 1, 1, 1]) // the first beam is white
  })
})
