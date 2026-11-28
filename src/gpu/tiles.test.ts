import { describe, expect, it } from 'vitest'
import {
  EMPTY,
  LAYOUTS,
  cleared,
  dealWithPlan,
  free,
  pairs,
  deal,
  readSaved,
  shuffle,
  shuffleWithPlan,
  take,
  type Board,
  type Place,
} from './tiles'
import { beatHash, dealRand, readBeat } from '../lab/beat'

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

/** SHA-256 of a value's JSON, hex: the same only if every byte of the deal is */
const sha = async (x: unknown) =>
  [
    ...new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(x))),
    ),
  ]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
/** the k-th press of Shuffle on a deal: TilesDemo's reshuffle, from the deal's own seed */
const reshuffle = (b: Board, dealSeed: number, k: number) =>
  shuffle(b, Math.floor(dealRand(dealSeed, k, 0)() * 2 ** 32))

describe('a "beat my deal" link deals the same tiles, and the same shuffles', () => {
  const twin = LAYOUTS.find((l) => l.id === 'twin')!
  /* pinned from node v22 and bun 1.4.4, which agree (27 Nov 2026) */
  it('is pinned, byte for byte, the deal and its first two shuffles', async () => {
    expect(await sha(deal(twin, 3_000_000_001))).toBe(
      '4dc0e62ec3674aa8537418cdead481024c9a927c79dc788475866abc352d1da1',
    )
    const { board, plan } = dealWithPlan(twin, 3_000_000_001)
    const one = take(board, plan[0][0], plan[0][1])
    expect(await sha(reshuffle(one, 3_000_000_001, 0))).toBe(
      'fe2b3568ee1576e12104979d374e78255ecfd1538741eb870c64b869790a2b6a',
    )
    expect(await sha(reshuffle(one, 3_000_000_001, 1))).toBe(
      '22bfe7dc394ea34b3ab52795136f03d5e24f2f1f45801b1ea3ac62acd63ff05b',
    )
  })
  it('the link’s seed and layout deal what they deal by hand', () => {
    const b = readBeat(beatHash({ game: 'tiles', seed: 3_000_000_001, layout: 'twin', secs: 431 }))
    if (b?.game !== 'tiles') throw new Error('the link did not read back')
    expect(deal(LAYOUTS.find((l) => l.id === b.layout)!, b.seed)).toEqual(deal(twin, 3_000_000_001))
  })
  it('the same deal and press give the same shuffle; another press gives another', () => {
    const { board, plan } = dealWithPlan(twin, 3_000_000_001)
    let b: Board = board
    for (const [i, j] of plan.slice(0, 6)) b = take(b, i, j)
    expect(reshuffle(b, 3_000_000_001, 0)).toEqual(reshuffle(b, 3_000_000_001, 0))
    expect(reshuffle(b, 3_000_000_001, 2)).toEqual(reshuffle(b, 3_000_000_001, 2))
    expect(reshuffle(b, 3_000_000_001, 1).kind).not.toEqual(reshuffle(b, 3_000_000_001, 0).kind)
    expect(reshuffle(b, 3_000_000_002, 0).kind).not.toEqual(reshuffle(b, 3_000_000_001, 0).kind)
    // the multiply by 2^32 is exact: the stream's numbers are whole 32-bit states over 2^32
    for (let k = 0; k < 50; k++) {
      const x = dealRand(3_000_000_001, k, 0)() * 2 ** 32
      expect(Number.isInteger(x) && x > 0 && x < 2 ** 32, `press ${k}`).toBe(true)
    }
  })
})
