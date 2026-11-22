import { describe, expect, it } from 'vitest'
import {
  EMPTY,
  jump,
  layout,
  left,
  moves,
  newGame,
  over,
  perfect,
  readSaved,
  solve,
  undo,
  type Game,
  type Saved,
} from './pegs'

const hole = (kind: Game['kind'], r: number, c: number) =>
  layout(kind).holes.findIndex((h) => h.r === r && h.c === c)
const play = (g: Game, ms: [number, number, number][]) => ms.reduce(jump, g)

describe('the boards', () => {
  it('have their holes and their jumps, and start with one hole empty', () => {
    const e = layout('english')
    expect(e.holes).toHaveLength(33)
    // every jump is along a line of three holes, so each counts both ways
    expect(e.jumps).toHaveLength(76)
    expect(left(newGame('english'))).toBe(32)
    expect(newGame('english').pegs[hole('english', 3, 3)]).toBe(false)
    const t = layout('triangle')
    expect(t.holes).toHaveLength(15)
    expect(t.jumps).toHaveLength(36)
    expect(newGame('triangle').pegs[hole('triangle', 0, 0)]).toBe(false)
    expect(newGame('triangle', 7).pegs[7]).toBe(false)
    expect(newGame('triangle', 7).start).toBe(7)
  })
  it('turn and flip onto themselves', () => {
    expect(layout('english').syms).toHaveLength(8)
    expect(layout('triangle').syms).toHaveLength(6)
    for (const k of ['english', 'triangle'] as const) {
      const L = layout(k)
      const set = new Set(L.jumps.map((j) => j.join()))
      for (const m of L.syms) {
        // a symmetry moves every hole somewhere different and carries jumps to jumps
        expect(new Set(m).size).toBe(L.holes.length)
      }
      // and every one is a different turn
      expect(new Set(L.syms.map((m) => m.join())).size).toBe(L.syms.length)
      for (const m of L.syms) {
        for (const [f, o, t] of L.jumps) expect(set.has([m[f], m[o], m[t]].join())).toBe(true)
      }
    }
  })
})

describe('a jump', () => {
  it('goes over a peg into an empty hole, and takes the peg off', () => {
    const g = newGame('english')
    // at the start the four pegs two away from the centre are the only ones that can move
    expect(moves(g)).toHaveLength(4)
    const m = moves(g)[0]
    const after = jump(g, m)
    expect(after.pegs[m[0]]).toBe(false)
    expect(after.pegs[m[1]]).toBe(false)
    expect(after.pegs[m[2]]).toBe(true)
    expect(left(after)).toBe(31)
    // and only a real one: no peg to move, nothing to jump over, or nowhere to land, changes nothing
    expect(jump(after, m)).toBe(after)
    const [f, o, t] = moves(after)[0]
    const bare = { ...after, pegs: after.pegs.map((p, i) => (i === o ? false : p)) }
    expect(jump(bare, [f, o, t])).toBe(bare)
    expect(jump(after, [m[2], m[1], m[0]])).toBe(after)
  })
  it('can be taken back, one at a time, to where the game began', () => {
    let g = newGame('triangle')
    for (let i = 0; i < 5; i++) g = jump(g, moves(g)[0])
    for (let i = 0; i < 5; i++) g = undo(g)
    expect(g).toEqual(newGame('triangle'))
    expect(undo(g)).toBe(g)
  })
  it('ends the game when none is left, perfectly with one peg in the hole that began empty', () => {
    const s = solve(newGame('triangle'), true)
    if (typeof s !== 'object') throw new Error('the triangle should solve')
    const done = play(newGame('triangle'), s.moves)
    expect(over(done)).toBe(true)
    expect(left(done)).toBe(1)
    expect(perfect(done)).toBe(true)
    // one peg left anywhere else is a finish, not a perfect one
    const any = solve(newGame('triangle', hole('triangle', 2, 1)), false)
    if (typeof any !== 'object') throw new Error('one peg should be possible')
    const end = play(newGame('triangle', hole('triangle', 2, 1)), any.moves)
    expect(left(end)).toBe(1)
    expect(perfect(end)).toBe(false)
  })
})

describe('the solver', () => {
  it('finds a way to one peg home from the usual starts, and every jump in it is real', () => {
    for (const k of ['english', 'triangle'] as const) {
      const s = solve(newGame(k), true)
      expect(typeof s).toBe('object')
      if (typeof s !== 'object') continue
      let g = newGame(k)
      for (const m of s.moves) {
        expect(moves(g)).toContainEqual(m)
        g = jump(g, m)
      }
      expect(perfect(g)).toBe(true)
      expect(s.moves).toHaveLength(layout(k).holes.length - 2)
    }
  })
  it('says when there is no way at all', () => {
    // the triangle's three inner holes cannot end with the last peg back in them: a known result,
    // and the search proves it by running out of positions
    for (const [r, c] of [
      [2, 1],
      [3, 1],
      [3, 2],
    ])
      expect(solve(newGame('triangle', hole('triangle', r, c)), true)).toBe('none')
    // two pegs that can never meet
    const apart = {
      ...newGame('english'),
      pegs: layout('english').holes.map((_, i) => i === 0 || i === 32),
    }
    expect(solve(apart)).toBe('none')
  })
  it('turns a dead end only in ways that leave the home hole where it is', () => {
    // from (1,0) the last peg can end back home; counting a dead end for another corner as one for
    // this corner said it could not
    const g = newGame('triangle', hole('triangle', 1, 0))
    expect(typeof solve(g, true)).toBe('object')
    expect(typeof solve(newGame('triangle', hole('triangle', 3, 3)), true)).toBe('object')
  })
  it('remembers dead ends, so that proving there is no way is quick', () => {
    // measured: 848 positions with the memory, 322,323 without
    expect(solve(newGame('triangle', hole('triangle', 2, 1)), true, 2000)).toBe('none')
  })
  it('owns up when it runs out of time', () => {
    expect(solve(newGame('english', hole('english', 0, 2)), true, 1000)).toBe('unsure')
  })
})

describe('what is kept', () => {
  it('round-trips every field that is not a default', () => {
    const s: Saved = {
      board: 'triangle',
      look: 'glow',
      best: { english: 2, triangle: 1 },
      perfects: { english: 3, triangle: 7 },
    }
    for (const k of Object.keys(s) as (keyof Saved)[]) expect(s[k]).not.toEqual(EMPTY[k])
    expect(readSaved(JSON.stringify(s))).toEqual(s)
  })
  it('falls back on anything it does not recognise', () => {
    expect(readSaved('{"board":"european","best":{"english":40}}')).toEqual(EMPTY)
    expect(readSaved('7')).toEqual(EMPTY)
  })
})
