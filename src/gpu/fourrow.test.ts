import { describe, expect, it } from 'vitest'
import {
  EMPTY,
  choose,
  drop,
  full,
  lineAt,
  newGrid,
  open,
  other,
  readSaved,
  recordGame,
  type Grid,
  type Level,
  type Who,
} from './fourrow'

const seeded = (seed: number) => {
  let s = seed >>> 0 || 1
  return () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    return (s >>> 0) / 2 ** 32
  }
}
const play = (g: Grid, moves: number[], first: Who = 1) => {
  let who = first
  for (const c of moves) {
    g = drop(g, c, who)
    who = other(who)
  }
  return g
}
function game(hi: Level, lo: Level, seat: Who, seed: number) {
  const rand = seeded(seed)
  let g = drop(newGrid('classic'), Math.floor(rand() * 7), 1)
  let who: Who = 2
  for (;;) {
    const c = choose(g, who, who === seat ? hi : lo, rand)
    g = drop(g, c, who)
    if (lineAt(g, c)) return who === seat ? 1 : -1
    if (full(g)) return 0
    who = other(who)
  }
}

describe('the grid', () => {
  it('a disc falls to the lowest free space, and a full column takes no more', () => {
    let g = newGrid('small')
    g = drop(g, 2, 1)
    g = drop(g, 2, 2)
    expect(g.cells[0 * g.cols + 2]).toBe(1)
    expect(g.cells[1 * g.cols + 2]).toBe(2)
    for (let k = 0; k < 3; k++) g = drop(g, 2, 1)
    expect(open(g)).not.toContain(2)
    expect(() => drop(g, 2, 1)).toThrow()
  })
  it('finds a line across, down and both diagonals — and not three', () => {
    const across = play(newGrid('classic'), [0, 0, 1, 1, 2, 2, 3])
    expect(lineAt(across, 3)).toHaveLength(4)
    const down = play(newGrid('classic'), [4, 5, 4, 5, 4, 5, 4])
    expect(lineAt(down, 4)).toHaveLength(4)
    // a rising diagonal: 1 at (0,0) (1,1) (2,2) (3,3)
    const rise = play(newGrid('classic'), [0, 1, 1, 2, 2, 3, 2, 3, 3, 6, 3])
    expect(lineAt(rise, 3)).toHaveLength(4)
    const fall = play(newGrid('classic'), [6, 5, 5, 4, 4, 3, 4, 3, 3, 0, 3])
    expect(lineAt(fall, 3)).toHaveLength(4)
    const three = play(newGrid('classic'), [0, 0, 1, 1, 2])
    expect(lineAt(three, 2)).toBeNull()
  })
  it('five in a row needs five', () => {
    const g = play(newGrid('wide', 5), [0, 0, 1, 1, 2, 2, 3, 3])
    const four = drop(g, 4, 1)
    expect(lineAt(drop(play(newGrid('wide', 4), [0, 0, 1, 1, 2, 2]), 3, 1), 3)).not.toBeNull()
    expect(lineAt(four, 4)).not.toBeNull()
    expect(lineAt(drop(play(newGrid('wide', 5), [0, 0, 1, 1, 2, 2]), 3, 1), 3)).toBeNull()
  })
})

describe('the computer', () => {
  it('wins when it can, and blocks a win in one', () => {
    const g = play(newGrid('classic'), [0, 6, 1, 6, 2])
    for (const level of ['easy', 'fair', 'hard'] as Level[])
      expect(choose(g, 1, level, seeded(1))).toBe(3)
    for (const level of ['fair', 'hard'] as Level[]) expect(choose(g, 2, level, seeded(2))).toBe(3)
  })
  // From both seats over twelve seeded games on the classic grid: fair beat easy 10–2 and hard beat
  // fair 9–0 (three drawn); hard's slowest move took 150 ms. Seeded, so the same every run.
  it('each level beats the one below it, from either seat', () => {
    const tally = (hi: Level, lo: Level) => {
      let w = 0
      let l = 0
      for (let g = 0; g < 4; g++)
        for (const seat of [1, 2] as Who[]) {
          const r = game(hi, lo, seat, 60 + g)
          if (r > 0) w++
          if (r < 0) l++
        }
      return [w, l]
    }
    const [fw, fl] = tally('fair', 'easy')
    expect(fw).toBeGreaterThan(fl + 3)
    const [hw, hl] = tally('hard', 'fair')
    expect(hw).toBeGreaterThan(hl + 3)
  }, 60000)
})

describe('four in a row saves', () => {
  it('a game moves the record on; the fastest win only counts a win', () => {
    let r = EMPTY.record.hard
    r = recordGame(r, 'won', 14)
    r = recordGame(r, 'drawn', 21)
    r = recordGame(r, 'won', 9)
    r = recordGame(r, 'lost', 6)
    expect(r).toEqual({ won: 2, lost: 1, drawn: 1, fastest: 9 })
  })
  it('round-trips every field away from its default', () => {
    const s = {
      level: 'hard',
      size: 'wide',
      need: 5,
      discs: 'candy',
      frame: 'night',
      record: {
        easy: { won: 3, lost: 1, drawn: 2, fastest: 7 },
        fair: { won: 4, lost: 5, drawn: 1, fastest: 9 },
        hard: { won: 1, lost: 8, drawn: 3, fastest: 15 },
      },
    }
    expect(readSaved(JSON.stringify(s))).toEqual(s)
  })
  it('a broken store loses only what is bad', () => {
    expect(readSaved('{')).toEqual(EMPTY)
    expect(readSaved(JSON.stringify({ size: 'huge', need: 6, frame: 'wood' }))).toEqual({
      ...EMPTY,
      frame: 'wood',
    })
  })
})
