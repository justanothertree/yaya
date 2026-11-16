import { describe, expect, it } from 'vitest'
import {
  EMPTY,
  FENCES,
  choose,
  dist,
  fenceIdeas,
  fenceOk,
  fenceTrouble,
  match,
  newGame,
  path,
  play,
  readSaved,
  steps,
  type Game,
  type Move,
  type Saved,
  type Sq,
} from './fences'

const sorted = (xs: Sq[]) => xs.map(([r, c]) => `${r},${c}`).sort()
/** a game with the pawns put where a test wants them, and the given side to move */
const placed = (a: Sq, b: Sq, turn: 0 | 1 = 0, n: 7 | 9 = 9): Game => ({
  ...newGame(n),
  pos: [a, b],
  turn,
})
const fence = (o: 'h' | 'v', r: number, c: number): Move => ({ kind: 'fence', o, r, c })
/** put fences down without spending anyone's turn or count */
const fenced = (g: Game, ...fs: ['h' | 'v', number, number][]): Game => {
  const h = g.h.slice()
  const v = g.v.slice()
  for (const [o, r, c] of fs) (o === 'h' ? h : v)[r * (g.n - 1) + c] = 1
  return { ...g, h, v }
}

describe('steps', () => {
  it('starts in the middle of each edge, and steps one square any open way', () => {
    const g = newGame(9)
    expect(g.pos).toEqual([
      [8, 4],
      [0, 4],
    ])
    expect(sorted(steps(g))).toEqual(
      sorted([
        [7, 4],
        [8, 3],
        [8, 5],
      ]),
    )
  })
  it('hops over the other side when they stand in the way', () => {
    const g = placed([5, 4], [4, 4])
    expect(sorted(steps(g))).toContain('3,4')
    expect(sorted(steps(g))).not.toContain('4,4')
  })
  it('steps aside past them when a fence is behind them', () => {
    // a flat fence under (3,4)-(3,5): from (4,4) there is no going up to (3,4)
    const g = fenced(placed([5, 4], [4, 4]), ['h', 3, 4])
    const s = sorted(steps(g))
    expect(s).toContain('4,3')
    expect(s).toContain('4,5')
    expect(s).not.toContain('3,4')
  })
  it('steps aside past them at the edge of the board too', () => {
    const g = placed([1, 4], [0, 4])
    expect(sorted(steps(g))).toEqual(
      sorted([
        [0, 3],
        [0, 5],
        [2, 4],
        [1, 3],
        [1, 5],
      ]),
    )
  })
  it('does not cross a fence, from either side of it', () => {
    const g = fenced(placed([5, 4], [0, 0]), ['v', 4, 4])
    // a standing fence right of (4,4) and (5,4)
    expect(sorted(steps(g))).not.toContain('5,5')
    const back = fenced(placed([5, 5], [0, 0]), ['v', 4, 4])
    expect(sorted(steps(back))).not.toContain('5,4')
  })
})

describe('fences', () => {
  it('costs one from your stock, and lengthens the other side’s way', () => {
    const g = newGame(9)
    const before = dist(g, 1)
    // straight under the computer's pawn, across its way down
    const after = play(g, fence('h', 0, 3))
    expect(after.left).toEqual([FENCES[9] - 1, FENCES[9]])
    expect(after.turn).toBe(1)
    expect(dist(after, 1)).toBeGreaterThan(before)
  })
  it('may not cross another fence or half-overlap one of its own lie', () => {
    const g = play(newGame(9), fence('h', 3, 3))
    expect(fenceTrouble(g, 'v', 3, 3)).toBe('cross') // the same crossing
    expect(fenceTrouble(g, 'h', 3, 2)).toBe('overlap')
    expect(fenceOk(g, 'h', 3, 2)).toBe(false) // shares a square's edge
    expect(fenceOk(g, 'h', 3, 4)).toBe(false)
    expect(fenceOk(g, 'h', 3, 5)).toBe(true) // end to end is fine
    expect(fenceOk(g, 'v', 2, 3)).toBe(true) // a T-junction is fine
  })
  it('may never shut anyone in', () => {
    // standing fences either side of (0,3)-(0,4), where the computer waits; a flat one under
    // both would close the box. It crosses nothing and overlaps nothing — on an open board it is
    // allowed — so the only reason to refuse it here is that it shuts the computer in.
    const open = placed([8, 4], [0, 4])
    expect(fenceOk(open, 'h', 0, 3)).toBe(true)
    const g = fenced(open, ['v', 0, 2], ['v', 0, 4])
    expect(dist(g, 1)).toBeLessThan(Infinity)
    expect(fenceTrouble(g, 'h', 0, 3)).toBe('shut')
    expect(play(g, fence('h', 0, 3))).toBe(g)
    // and it is the same for shutting yourself in: (7,4)-(8,4) walled either side, then capped
    const mineOpen = placed([8, 4], [0, 0])
    expect(fenceOk(mineOpen, 'h', 6, 4)).toBe(true)
    const mine = fenced(mineOpen, ['v', 7, 3], ['v', 7, 4])
    expect(fenceOk(mine, 'h', 6, 4)).toBe(false)
  })
  it('stops when you have none left, and stays on the board', () => {
    const g = { ...newGame(9), left: [0, 10] as [number, number] }
    expect(fenceTrouble(g, 'h', 4, 4)).toBe('spent')
    const h = newGame(9)
    expect(fenceTrouble(h, 'h', 8, 0)).toBe('off')
    expect(fenceTrouble(h, 'v', -1, 0)).toBe('off')
    const won = { ...h, winner: 1 as const }
    expect(fenceTrouble(won, 'h', 4, 4)).toBe('over')
  })
})

describe('the race', () => {
  it('measures the way the same whether by distance or by path', () => {
    const g = fenced(newGame(9), ['h', 4, 3], ['h', 4, 5], ['v', 2, 2], ['h', 6, 0])
    for (const w of [0, 1] as const) expect(path(g, w).length).toBe(dist(g, w))
    // and the path is a walk of single open steps
    const way = [g.pos[0], ...path(g, 0)]
    for (let i = 1; i < way.length; i++)
      expect(Math.abs(way[i][0] - way[i - 1][0]) + Math.abs(way[i][1] - way[i - 1][1])).toBe(1)
  })
  it('is won by reaching the far edge, and nothing moves after', () => {
    const g = placed([1, 0], [7, 8])
    const won = play(g, { kind: 'step', to: [0, 0] })
    expect(won.winner).toBe(0)
    expect(play(won, { kind: 'step', to: [6, 8] })).toBe(won)
  })
  it('refuses a step that is not one, and hands back the same game', () => {
    const g = newGame(9)
    expect(play(g, { kind: 'step', to: [6, 4] })).toBe(g)
    expect(play(g, { kind: 'step', to: [7, 3] })).toBe(g)
  })
  it('suggests fences only where they touch the other side’s way, and only legal ones', () => {
    const g = newGame(9)
    const ideas = fenceIdeas(g, 1)
    expect(ideas.length).toBeGreaterThan(0)
    for (const m of ideas) {
      expect(m.kind).toBe('fence')
      if (m.kind === 'fence') expect(fenceOk(g, m.o, m.r, m.c)).toBe(true)
      expect(dist(play(g, m), 1)).toBeGreaterThanOrEqual(dist(g, 1))
    }
  })
})

describe('the computer', () => {
  it('takes a winning step at every level', () => {
    for (const lv of ['easy', 'fair', 'hard'] as const) {
      const g = placed([4, 4], [7, 2], 1)
      const m = choose(g, lv, () => 0.1)
      expect(m).toEqual({ kind: 'step', to: [8, 2] })
    }
  })
  it('only ever plays legal moves, and every game ends', () => {
    for (let s = 0; s < 6; s++) {
      const r = match('easy', 'hard', s, s % 2 ? 7 : 9)
      expect(r.winner).not.toBeNull()
    }
  })
  it('is stronger level by level, from both seats', () => {
    // seeds alternate who moves first; each pairing is played from both chairs
    const rate = (a: 'easy' | 'fair' | 'hard', b: 'easy' | 'fair' | 'hard', games: number) => {
      let won = 0
      for (let s = 0; s < games; s++) {
        if (match(a, b, 2 * s + 1).winner === 0) won++
        if (match(b, a, 2 * s + 2).winner === 1) won++
      }
      return won / (2 * games)
    }
    // measured on these seeds: Fair beats Easy 32 of 40, Hard beats Fair 27 of 40
    expect(rate('fair', 'easy', 20)).toBeGreaterThan(0.7)
    expect(rate('hard', 'fair', 20)).toBeGreaterThan(0.6)
  }, 60_000)
})

describe('what is kept', () => {
  it('round-trips every field that is not a default', () => {
    const s: Saved = {
      level: 'hard',
      size: 7,
      theme: 'sand',
      guide: false,
      record: {
        easy: { won: 3, lost: 1, best: 12 },
        fair: { won: 2, lost: 5, best: 19 },
        hard: { won: 1, lost: 7, best: 31 },
      },
    }
    for (const k of Object.keys(s) as (keyof Saved)[]) expect(s[k]).not.toEqual(EMPTY[k])
    expect(readSaved(JSON.stringify(s))).toEqual(s)
  })
  it('falls back field by field on anything it does not recognise', () => {
    expect(readSaved(null)).toEqual(EMPTY)
    expect(readSaved('not json')).toEqual(EMPTY)
    expect(readSaved('[1]')).toEqual(EMPTY)
    const r = readSaved(
      JSON.stringify({
        level: 'brutal',
        size: 11,
        theme: 'hedge',
        guide: 1,
        record: { easy: { won: -2, best: 1.5 } },
      }),
    )
    expect(r).toEqual(EMPTY)
  })
})
