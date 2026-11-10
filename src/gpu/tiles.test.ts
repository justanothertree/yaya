import { describe, expect, it } from 'vitest'
import {
  EMPTY,
  LAYOUTS,
  cleared,
  dealWithPlan,
  free,
  pairs,
  readSaved,
  shuffleWithPlan,
  take,
  type Board,
  type Place,
} from './tiles'

const at = (places: Place[]) => ({ places, filled: places.map(() => true) })
describe('which tiles are free', () => {
  it('a tile with one on top is not; nor one held on both sides; one open side is enough', () => {
    const row = at([
      { x: 0, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
      { x: 4, y: 0, z: 0 },
    ])
    expect([0, 1, 2].map((i) => free(row.places, row.filled, i))).toEqual([true, false, true])
    // half a tile across the two below covers both
    const stack = at([
      { x: 0, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
      { x: 1, y: 0, z: 1 },
    ])
    expect([0, 1, 2].map((i) => free(stack.places, stack.filled, i))).toEqual([false, false, true])
    // a neighbour half a row up or down still blocks; a whole row away does not
    const off = at([
      { x: 0, y: 1, z: 0 },
      { x: 2, y: 0, z: 0 },
      { x: 4, y: 1, z: 0 },
    ])
    expect(free(off.places, off.filled, 1)).toBe(false)
    const far = at([
      { x: 0, y: 2, z: 0 },
      { x: 2, y: 0, z: 0 },
      { x: 4, y: 0, z: 0 },
    ])
    expect(free(far.places, far.filled, 1)).toBe(true)
  })
})

describe('dealing', () => {
  it('every deal of every layout can be cleared, the way it was built, by the rules alone', () => {
    for (const l of LAYOUTS)
      for (let seed = 1; seed <= 25; seed++) {
        const { board, plan } = dealWithPlan(l, seed)
        // two of each kind it uses, in pairs
        const counts = new Map<number, number>()
        board.kind.forEach((k) => counts.set(k, (counts.get(k) ?? 0) + 1))
        for (const n of counts.values()) expect(n % 2).toBe(0)
        let b: Board = board
        for (const [i, j] of plan) {
          const next = take(b, i, j)
          expect(next).not.toBe(b)
          b = next
        }
        expect(cleared(b)).toBe(true)
      }
  })
  it('the same seed gives the same deal, another seed another', () => {
    expect(dealWithPlan(LAYOUTS[0], 9).board.kind).toEqual(dealWithPlan(LAYOUTS[0], 9).board.kind)
    expect(dealWithPlan(LAYOUTS[0], 10).board.kind).not.toEqual(
      dealWithPlan(LAYOUTS[0], 9).board.kind,
    )
  })
})

describe('play', () => {
  it('only a free matching pair can be taken', () => {
    const { board } = dealWithPlan(LAYOUTS[1], 3)
    const [i, j] = pairs(board)[0] ?? []
    if (i !== undefined) expect(cleared(take(board, i, j))).toBe(false)
    // a tile under another cannot be taken, whatever matches it
    const buried = board.layout.places.findIndex(
      (_, k) => !free(board.layout.places, board.filled, k),
    )
    const twin = board.kind.findIndex((k, n) => n !== buried && k === board.kind[buried])
    expect(take(board, buried, twin)).toBe(board)
    expect(take(board, i, i)).toBe(board)
  })
  it('a shuffle keeps the same tiles, and the board can still be cleared from there', () => {
    const { board, plan } = dealWithPlan(LAYOUTS[2], 4)
    let b = board
    for (const [i, j] of plan.slice(0, 10)) b = take(b, i, j)
    const { board: s, plan: again } = shuffleWithPlan(b, 77)
    const bag = (x: Board) => x.kind.filter((_, i) => x.filled[i]).sort((p, q) => p - q)
    expect(bag(s)).toEqual(bag(b))
    expect(s.filled).toEqual(b.filled)
    expect(s.kind).not.toEqual(b.kind)
    let c: Board = s
    for (const [i, j] of again) {
      const next = take(c, i, j)
      expect(next).not.toBe(c)
      c = next
    }
    expect(cleared(c)).toBe(true)
  })
})

describe('tiles saves', () => {
  it('round-trips every field away from its default', () => {
    const s = {
      layout: 'twin',
      style: 'night',
      glow: true,
      best: { pyramid: 301, arches: 222 },
      today: { day: 3999999999, seconds: 245 },
      cleared: 7,
    }
    expect(readSaved(JSON.stringify(s))).toEqual(s)
    expect(readSaved(JSON.stringify({ layout: 'moon', best: { moon: 5 } }))).toEqual(EMPTY)
  })
})
