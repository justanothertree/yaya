import { describe, expect, it } from 'vitest'
import { BAR, OFF, plays, startPos, type Pos } from './backgammon'
import {
  MAX_TURNS,
  backgammonRules as R,
  replay,
  roll,
  type BackgammonGame,
} from './backgammonRoom'

/** a small seeded generator, so a failing game can be played again */
function seeded(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}
/** dice that come up as listed, for a roll the test means */
const loaded = (...faces: number[]) => {
  let k = 0
  return () => (faces[k++ % faces.length] - 1) / 6 + 0.01
}
const steps = (g: BackgammonGame, rnd: () => number) => {
  const list = plays(g.pos, g.turn!, g.dice!)
  return list[Math.floor(rnd() * list.length)].steps.map((s) => [s.from, s.to] as [number, number])
}
/** a whole game of random legal turns, rolled as the server rolls */
function playOut(seed: number) {
  const rnd = seeded(seed)
  let g = roll(R.fresh(), rnd)
  while (R.turn(g) !== null) g = roll(R.apply(g, steps(g, rnd)), rnd)
  return g
}

describe('backgammon by turns: the server rolls', () => {
  it('opens with one die each, never the same, the higher side starting with both', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const g = roll(R.fresh(), seeded(seed))
      const [a, b] = g.opening!
      expect(a).not.toBe(b)
      expect(g.turn).toBe(a > b ? 1 : 2)
      expect(g.dice).toEqual([Math.max(a, b), Math.min(a, b)])
    }
    // a double is rolled again: 3–3, then 5–2
    const g = roll(R.fresh(), loaded(3, 3, 5, 2))
    expect(g.opening).toEqual([5, 2])
    expect(g.turn).toBe(1)
  })

  it('plays a roll with no move in it as a pass, and rolls for the other side', () => {
    // side 1 on the bar against side 2's closed home board: nothing it rolls can come in
    const board = Array(24).fill(0)
    for (let i = 18; i < 24; i++) board[i] = -2
    board[5] = 14
    const pos: Pos = { board, bar: [0, 1, 0], off: [0, 0, 3] }
    const g: BackgammonGame = {
      pos,
      turn: 1,
      dice: null,
      opening: [4, 2],
      turns: [],
      drawn: false,
    }
    const r = roll(g, loaded(6, 1, 3, 4))
    expect(r.turns).toHaveLength(1)
    expect(r.turns[0]).toEqual({ by: 1, dice: [6, 1], steps: [] })
    expect(r.turn).toBe(2)
    expect(r.dice).toEqual([3, 4])
  })

  it('round-trips a whole game through the wire, every field as it was', () => {
    let hits = 0
    let bars = 0
    for (let seed = 1; seed <= 12; seed++) {
      const g = playOut(seed)
      const back = R.decode(JSON.parse(JSON.stringify(R.encode(g))))!
      expect(back).not.toBeNull()
      // a fixture that is not sitting on defaults: a finished game, with hits and checkers off
      expect(g.turn).toBeNull()
      expect(Math.max(g.pos.off[1], g.pos.off[2])).toBe(15)
      hits += g.turns.flatMap((t) => t.steps).filter((s) => s.hit).length
      bars += g.turns.flatMap((t) => t.steps).filter((s) => s.from === BAR).length
      for (const k of ['pos', 'turn', 'dice', 'opening', 'turns', 'drawn'] as const)
        expect(back[k]).toEqual(g[k])
    }
    expect(hits).toBeGreaterThan(0)
    expect(bars).toBeGreaterThan(0)
  })

  it('round-trips a game part way, the side to move holding the dice the server rolled', () => {
    const rnd = seeded(5)
    let g = roll(R.fresh(), rnd)
    for (let k = 0; k < 9; k++) g = roll(R.apply(g, steps(g, rnd)), rnd)
    const back = R.decode(JSON.parse(JSON.stringify(R.encode(g))))!
    expect(back.dice).toEqual(g.dice)
    expect(back.turn).toBe(g.turn)
    expect(back.pos).toEqual(g.pos)
  })

  it('takes a turn only as the dice allow it, by the rules', () => {
    // the opening 6–1 for side 1: 13 to 7 and 8 to 7 makes the bar point
    const g = roll(R.fresh(), loaded(6, 1))
    expect(g.dice).toEqual([6, 1])
    expect(
      R.legal(
        g,
        [
          [12, 6],
          [7, 6],
        ],
        0,
      ),
    ).toBe(true)
    // one die only, when both can be played
    expect(R.legal(g, [[12, 6]], 0)).toBe(false)
    // a 5 that was not rolled, and the wrong side's checkers
    expect(
      R.legal(
        g,
        [
          [12, 7],
          [7, 6],
        ],
        0,
      ),
    ).toBe(false)
    expect(
      R.legal(
        g,
        [
          [0, 6],
          [11, 12],
        ],
        0,
      ),
    ).toBe(false)
    // and not by the other seat
    expect(
      R.legal(
        g,
        [
          [12, 6],
          [7, 6],
        ],
        1,
      ),
    ).toBe(false)
    // in a browser, a turn played waits for the server's dice
    const played = R.apply(g, [
      [12, 6],
      [7, 6],
    ])
    expect(played.turn).toBe(2)
    expect(played.dice).toBeNull()
    expect(R.legal(played, [[0, 1]], 1)).toBe(false)
  })

  it('refuses a stored game no rolls and turns could make', () => {
    const g = playOut(3)
    const w = R.encode(g) as { open: [number, number]; turns: number[][]; dice: unknown }
    // an opening double; a first turn not played with the opening's dice; a die of seven
    expect(replay({ ...w, open: [4, 4] })).toBeNull()
    expect(
      replay({
        ...w,
        turns: [[w.turns[0][1], w.turns[0][0], ...w.turns[0].slice(2)], ...w.turns.slice(1)],
      }),
    ).toBeNull()
    expect(replay({ ...w, turns: [w.turns[0], [7, 1], ...w.turns.slice(2)] })).toBeNull()
    // a turn moved the wrong way, and one left short of what its dice allowed
    const t1 = w.turns[1]
    expect(
      replay({
        ...w,
        turns: [w.turns[0], [t1[0], t1[1], t1[3], t1[2], ...t1.slice(4)], ...w.turns.slice(2)],
      }),
    ).toBeNull()
    if (t1.length > 4)
      expect(replay({ ...w, turns: [w.turns[0], t1.slice(0, 4), ...w.turns.slice(2)] })).toBeNull()
    // a turn after the game was won, and more turns than any game
    expect(replay({ ...w, turns: [...w.turns, [3, 1]] })).toBeNull()
    expect(
      replay({ open: [5, 2], turns: Array(MAX_TURNS + 1).fill([1, 1]), dice: null }),
    ).toBeNull()
    // a step that is not two points on or off the board
    expect(R.readMove([[OFF, 3]])).toBeNull()
    expect(R.readMove([[3, BAR]])).toBeNull()
    expect(
      R.readMove([
        [3, 2],
        [3, 2],
        [3, 2],
        [3, 2],
        [3, 2],
      ]),
    ).toBeNull()
    expect(R.readMove([[3.5, 2]])).toBeNull()
    // and an unrolled game is a fresh one, nothing else
    expect(replay({ open: null, turns: [], dice: null })).toEqual(R.fresh())
    expect(replay({ open: null, turns: [], dice: [3, 1] })).toBeNull()
    expect(startPos().board.reduce((a, c) => a + Math.abs(c), 0)).toBe(30)
  })
})
