import { describe, expect, it } from 'vitest'
import {
  BAR,
  EMPTY,
  OFF,
  apply,
  choose,
  pips,
  plays,
  readSaved,
  result,
  startPos,
  stepsFor,
  type Level,
  type Pos,
  type Who,
} from './backgammon'
import { rng } from './bricks'

/** a position with checkers where they are asked to be: [point, count] with count + for side 1, − for side 2 */
const pos = (pts: [number, number][], extra: Partial<Pos> = {}): Pos => {
  const board = Array(24).fill(0)
  for (const [i, c] of pts) board[i] = c
  return { board, bar: [0, 0, 0], off: [0, 0, 0], ...extra }
}
const count = (p: Pos, w: Who) =>
  p.board.reduce((a, c) => a + (w === 1 ? Math.max(0, c) : Math.max(0, -c)), 0) +
  p.bar[w] +
  p.off[w]

describe('the board', () => {
  it('starts with fifteen each, 167 pips apiece, mirrored', () => {
    const p = startPos()
    expect(count(p, 1)).toBe(15)
    expect(count(p, 2)).toBe(15)
    expect(pips(p, 1)).toBe(167)
    expect(pips(p, 2)).toBe(167)
    for (let i = 0; i < 24; i++) expect(p.board[i] + p.board[23 - i]).toBe(0)
  })
})

describe('the rules', () => {
  it('3–1 from the start can make the five point, and every play keeps fifteen checkers', () => {
    const list = plays(startPos(), 1, [3, 1])
    const five = list.find(
      (pl) => pl.pos.board[4] === 2 && pl.pos.board[7] === 2 && pl.pos.board[5] === 4,
    )
    expect(five).toBeDefined()
    for (const pl of list) expect(count(pl.pos, 1)).toBe(15)
    // a double moves four times
    expect(plays(startPos(), 1, [6, 6]).every((pl) => pl.steps.length === 4)).toBe(true)
  })
  it('a point held by two or more is closed; one alone is hit and goes to the bar', () => {
    const p = pos([
      [10, 1],
      [7, -2],
      [8, -1],
    ])
    expect(stepsFor(p, 1, 3)).toEqual([])
    const [hit] = stepsFor(p, 1, 2)
    expect(hit).toEqual({ from: 10, to: 8, die: 2, hit: true })
    const after = apply(p, 1, hit)
    expect(after.bar[2]).toBe(1)
    expect(after.board[8]).toBe(1)
  })
  it('a checker on the bar must come in before anything else moves', () => {
    const p = pos(
      [
        [12, 3],
        [20, -2],
      ],
      { bar: [0, 1, 0], off: [0, 11, 13] },
    )
    // side 1 enters on 24 − die: a 4 lands on point 20, which is closed; a 2 lands on 22
    expect(stepsFor(p, 1, 4)).toEqual([])
    expect(stepsFor(p, 1, 2)).toEqual([{ from: BAR, to: 22, die: 2, hit: false }])
    for (const pl of plays(p, 1, [4, 2])) expect(pl.steps[0].from).toBe(BAR)
  })
  it('both dice must be played when any way allows it', () => {
    // the 6 first is blocked from 13 (point 7 closed), but 5 then 6 from the other checker works
    const p = pos(
      [
        [13, 1],
        [20, 1],
        [7, -2],
        [9, -2],
      ],
      { off: [0, 13, 11] },
    )
    for (const pl of plays(p, 1, [6, 5])) expect(pl.steps).toHaveLength(2)
  })
  it('when only one die can be played, it must be the larger if that can be played', () => {
    // one checker on point 13 (index 12): a 6 reaches 6, a 5 reaches 7, and either way the other
    // die would land on index 1, which is closed — so only one die can be played, and it must be the 6
    const p = pos(
      [
        [12, 1],
        [1, -2],
      ],
      { off: [0, 14, 13] },
    )
    const list = plays(p, 1, [5, 6])
    expect(list.length).toBeGreaterThan(0)
    expect(list).toHaveLength(1)
    expect(list[0].steps).toEqual([{ from: 12, to: 6, die: 6, hit: false }])
  })
  it('bears off exactly, or with a bigger die only from the furthest point', () => {
    const p = pos(
      [
        [4, 1],
        [1, 2],
      ],
      { off: [0, 12, 0] },
    )
    // a 5 from point 5 (index 4) bears off exactly; a 6 does too, as nothing is further back
    expect(stepsFor(p, 1, 5).some((s) => s.from === 4 && s.to === OFF)).toBe(true)
    expect(stepsFor(p, 1, 6).some((s) => s.from === 4 && s.to === OFF)).toBe(true)
    // but a 6 may not bear off from point 2 while point 5 is still occupied
    expect(stepsFor(p, 1, 6).some((s) => s.from === 1)).toBe(false)
    // and nothing bears off while a checker is outside home
    const out = pos(
      [
        [4, 1],
        [10, 1],
      ],
      { off: [0, 13, 0] },
    )
    expect(stepsFor(out, 1, 5).some((s) => s.to === OFF)).toBe(false)
  })
  it('scores a win 1, a gammon 2, a backgammon 3', () => {
    expect(result(pos([[20, -3]], { off: [0, 15, 12] }))).toEqual({ winner: 1, points: 1 })
    expect(result(pos([[20, -15]], { off: [0, 15, 0] }))).toEqual({ winner: 1, points: 2 })
    expect(
      result(
        pos(
          [
            [3, -1],
            [20, -14],
          ],
          { off: [0, 15, 0] },
        ),
      ),
    ).toEqual({ winner: 1, points: 3 })
    expect(result(startPos())).toBeNull()
  })
})

describe('the computer', () => {
  const game = (hiSide: Who, hi: Level, lo: Level, seed: number) => {
    const dice = rng(seed)
    const pick = rng(seed + 1)
    let p = startPos()
    let w: Who = 1
    for (let t = 0; t < 600 && !result(p); t++) {
      const d: [number, number] = [1 + Math.floor(dice() * 6), 1 + Math.floor(dice() * 6)]
      p = choose(p, w, d, w === hiSide ? hi : lo, pick).pos
      w = w === 1 ? 2 : 1
    }
    return result(p)
  }
  const wins = (hi: Level, lo: Level, n: number) => {
    let won = 0
    for (let s = 1; s <= n; s++)
      for (const seat of [1, 2] as Who[])
        if (game(seat, hi, lo, 99991 + s * 31)?.winner === seat) won++
    return won / (2 * n)
  }
  // measured on these dice: fair beat easy 87%; hard beat fair 60%, +0.36 points a game, over 500
  it('fair beats easy, and hard beats fair, from either seat, on the same dice', () => {
    expect(wins('fair', 'easy', 60)).toBeGreaterThan(0.75)
    expect(wins('hard', 'fair', 150)).toBeGreaterThan(0.55)
  }, 60000)
  it('every game ends, and every play the computer makes is one the rules allow', () => {
    const dice = rng(5)
    let p = startPos()
    let w: Who = 1
    let turns = 0
    for (; turns < 600 && !result(p); turns++) {
      const d: [number, number] = [1 + Math.floor(dice() * 6), 1 + Math.floor(dice() * 6)]
      const chosen = choose(p, w, d, 'hard')
      expect(
        plays(p, w, d).some((pl) => JSON.stringify(pl.pos) === JSON.stringify(chosen.pos)),
      ).toBe(true)
      p = chosen.pos
      expect(count(p, 1)).toBe(15)
      expect(count(p, 2)).toBe(15)
      w = w === 1 ? 2 : 1
    }
    expect(result(p)).not.toBeNull()
  })
})

describe('backgammon saves', () => {
  it('round-trips every field away from its default', () => {
    const s = {
      level: 'hard',
      board: 'marble',
      checkers: 'sweet',
      hints: false,
      pips: false,
      record: {
        easy: { won: 3, lost: 1, points: 5, against: 1 },
        fair: { won: 4, lost: 6, points: 7, against: 9 },
        hard: { won: 1, lost: 8, points: 2, against: 12 },
      },
    }
    expect(readSaved(JSON.stringify(s))).toEqual(s)
    expect(readSaved('nope')).toEqual(EMPTY)
  })
})
