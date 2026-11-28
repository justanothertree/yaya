import { describe, expect, it } from 'vitest'
import {
  EMPTY,
  SIZES,
  chord,
  counts,
  layBoard,
  neighbours,
  newGame,
  over,
  readSaved,
  reveal,
  solve,
  toggleFlag,
  type Game,
  type Size,
} from './mines'
import { rng } from './bricks'
import { beatHash, readBeat } from '../lab/beat'

const centre = (s: Size) => Math.floor(s.h / 2) * s.w + Math.floor(s.w / 2)
/** mines anywhere at all, the way a board is laid before it is checked */
function anyBoard(s: Size, seed: number): boolean[] {
  const rand = rng(seed)
  const mine = Array<boolean>(s.w * s.h).fill(false)
  let laid = 0
  while (laid < s.mines) {
    const i = Math.floor(rand() * mine.length)
    if (!mine[i]) {
      mine[i] = true
      laid++
    }
  }
  return mine
}

describe('the grid', () => {
  it('a corner has three neighbours, an edge five, the middle eight', () => {
    const s = SIZES.small
    expect(neighbours(s, 0)).toHaveLength(3)
    expect(neighbours(s, 4)).toHaveLength(5)
    expect(neighbours(s, centre(s))).toHaveLength(8)
    const mine = Array(81).fill(false)
    mine[0] = mine[2] = true
    expect(counts(s, mine)[1]).toBe(2)
    expect(counts(s, mine)[10]).toBe(2)
  })
})

describe('reasoning', () => {
  // the solver throws if it ever reasons that a mine is safe, so laying thousands of boards that
  // are NOT checked first is the test of every rule it uses
  it('never calls a mine safe, on 3,000 boards laid anyhow', () => {
    let solved = 0
    for (let seed = 1; seed <= 1000; seed++)
      for (const s of [SIZES.small, SIZES.medium, { w: 8, h: 8, mines: 14 }]) {
        const mine = anyBoard(s, seed)
        const start = mine.findIndex((m, i) => !m && neighbours(s, i).every((j) => !mine[j]))
        if (start < 0) continue
        if (solve(s, mine, start)) solved++
      }
    // and it finishes a good share of them: a solver that gave up on everything would pass the line above
    expect(solved).toBeGreaterThan(900)
  })
  it('finishes a board only when every safe square can be reached', () => {
    // two wide and three tall, one mine in the bottom row: both numbers above it see the same two
    // squares and say 1, and nothing anywhere tells the two apart — a coin toss
    expect(solve({ w: 2, h: 3, mines: 1 }, [false, false, false, false, true, false], 0)).toBe(
      false,
    )
    expect(solve({ w: 3, h: 1, mines: 1 }, [false, false, true], 0)).toBe(true)
  })
})

describe('laying a board', () => {
  it('keeps the first square and its neighbours clear, lays every mine, and is the same from the same seed', () => {
    for (const s of Object.values(SIZES))
      for (let seed = 1; seed <= 8; seed++) {
        const start = centre(s)
        const { mine, fair } = layBoard(s, seed, start)
        expect(fair).toBe(true)
        expect(mine.filter(Boolean)).toHaveLength(s.mines)
        for (const j of [start, ...neighbours(s, start)]) expect(mine[j]).toBe(false)
        expect(solve(s, mine, start)).toBe(true)
        expect(layBoard(s, seed, start).mine).toEqual(mine)
      }
  })
})

describe('a game', () => {
  const opened = (g: Game) => g.open.filter(Boolean).length
  it('the first square lays the board and opens an area; opening every safe square wins', () => {
    const s = SIZES.small
    let g = reveal(newGame(s, 7), 40)
    expect(g.mine).not.toBeNull()
    expect(opened(g)).toBeGreaterThanOrEqual(9)
    for (let i = 0; i < 81; i++) if (!g.mine![i]) g = reveal(g, i)
    expect(g.won).toBe(true)
    expect(over(g)).toBe(true)
  })
  it('a mine ends it, and nothing opens after', () => {
    let g = reveal(newGame(SIZES.small, 7), 40)
    const m = g.mine!.indexOf(true)
    g = reveal(g, m)
    expect(g.boom).toBe(m)
    const safe = g.mine!.findIndex((x, i) => !x && !g.open[i])
    expect(reveal(g, safe)).toBe(g)
  })
  it('a flag stops a square opening; a number with its mines flagged opens the rest around it', () => {
    let g = reveal(newGame(SIZES.small, 3), 40)
    // an open number touching exactly one hidden mine
    const n = g.open.findIndex((o, i) => o && g.count[i] > 0)
    const mines = neighbours(g.size, n).filter((j) => g.mine![j])
    expect(chord(g, n)).toBe(g)
    for (const j of mines) {
      g = toggleFlag(g, j)
      expect(reveal(g, j)).toBe(g)
    }
    const before = opened(g)
    const after = chord(g, n)
    expect(after.boom).toBe(-1)
    expect(opened(after)).toBeGreaterThanOrEqual(before)
    for (const j of neighbours(g.size, n)) if (!g.mine![j]) expect(after.open[j]).toBe(true)
  })
  it('a wrong flag, chorded, opens the mine it was hiding', () => {
    let g = reveal(newGame(SIZES.small, 3), 40)
    const n = g.open.findIndex(
      (o, i) =>
        o && g.count[i] === 1 && neighbours(g.size, i).some((j) => !g.open[j] && !g.mine![j]),
    )
    const wrong = neighbours(g.size, n).find((j) => !g.open[j] && !g.mine![j])!
    g = chord(toggleFlag(g, wrong), n)
    expect(g.boom).toBeGreaterThanOrEqual(0)
  })
})

describe('mines saves', () => {
  it('round-trips every field away from its default', () => {
    const s = {
      size: 'large',
      theme: 'night',
      mark: 'star',
      best: { small: 123, medium: 4567, large: 89012 },
      won: 7,
      played: 20,
      today: { day: 3999999999, tenths: 812 },
    }
    expect(readSaved(JSON.stringify(s))).toEqual(s)
  })
  it('a broken store loses only what is bad', () => {
    expect(readSaved('{{')).toEqual(EMPTY)
    expect(
      readSaved(
        JSON.stringify({ size: 'huge', best: { small: -4, medium: 900 }, won: 9, played: 2 }),
      ),
    ).toEqual({
      ...EMPTY,
      best: { medium: 900 },
      won: 2,
      played: 2,
    })
  })
})

/** SHA-256 of a value's JSON, hex: the same only if every byte of the board is */
const sha = async (x: unknown) =>
  [
    ...new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(x))),
    ),
  ]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')

describe('a "beat my board" link lays the same board', () => {
  /* ⚠️ A BOARD IS ITS SEED, ITS SIZE AND THE SQUARE IT OPENED FROM: `layBoard` keeps the first
     square and its neighbours clear, so the same seed opened somewhere else is another board.
     Pinned from node v22 and bun 1.4.4, which agree (27 Nov 2026). */
  it('is pinned, byte for byte', async () => {
    expect(await sha(reveal(newGame(SIZES.large, 4_294_967_295), 241))).toBe(
      '3a12ae423d48382e18354385468208444cacb99d9ce128e4268f8ce16d40bebe',
    )
  })
  it('the link’s seed, size and first square lay what they lay by hand', () => {
    const b = readBeat(
      beatHash({ game: 'mines', seed: 4_294_967_295, size: 'large', start: 241, tenths: 1234 }),
    )
    if (b?.game !== 'mines') throw new Error('the link did not read back')
    const linked = reveal(newGame(SIZES[b.size], b.seed), b.start)
    expect(linked).toEqual(reveal(newGame(SIZES.large, 4_294_967_295), 241))
    expect(linked.mine).not.toEqual(reveal(newGame(SIZES.large, 4_294_967_295), 240).mine)
  })
})
