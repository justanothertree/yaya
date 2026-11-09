import { describe, expect, it } from 'vitest'
import {
  BUST,
  EMPTY,
  TARGET,
  chooseKeep,
  newTurn,
  options,
  readSaved,
  rollOn,
  scoreOf,
  seeded,
  setAside,
  wantsBank,
  type Turn,
} from './dice'

describe('scoring', () => {
  it('scores the table on the page', () => {
    const cases: [number[], number | null][] = [
      [[1], 100],
      [[5], 50],
      [[1, 1], 200],
      [[1, 5], 150],
      [[2, 2, 2], 200],
      [[1, 1, 1], 1000],
      [[6, 6, 6], 600],
      [[4, 4, 4, 4], 800],
      [[4, 4, 4, 4, 4], 1600],
      [[4, 4, 4, 4, 4, 4], 3200],
      [[1, 1, 1, 1], 2000],
      [[3, 3, 3, 5], 350],
      [[1, 2, 3, 4, 5, 6], 1500],
      [[2, 2, 3, 3, 6, 6], 750],
      [[2, 2, 2, 3, 3, 3], 500],
      [[3], null],
      [[1, 3], null],
      [[2, 2], null],
      [[], null],
    ]
    for (const [dice, want] of cases) expect(scoreOf(dice), dice.join('')).toBe(want)
  })
  it('the chance n dice score nothing matches the published fractions', () => {
    // 1 die: 4/6. 2: 16/36. 3: 60/216. 4: 204/1296. 5: 600/7776. 6: 144/6^6 + the six-dice
    // combinations; the widely published figures are these, to four places
    const published = [0, 4 / 6, 16 / 36, 60 / 216, 204 / 1296, 600 / 7776, 0.0231]
    for (let n = 1; n <= 5; n++) expect(BUST[n], `${n} dice`).toBeCloseTo(published[n], 10)
    expect(BUST[6]).toBeCloseTo(published[6], 4)
  })
  it('lists every scoring choice in a roll', () => {
    const o = options([1, 5, 3])
    expect(o.map((x) => x.points).sort((a, b) => a - b)).toEqual([50, 100, 150])
  })
})

describe('a turn', () => {
  it('set-aside dice must all score, and the points add up', () => {
    const t: Turn = { roll: [1, 5, 3, 3, 2, 6], points: 0, free: 6, bust: false }
    expect(setAside(t, [2])).toBeNull()
    expect(setAside(t, [0, 2])).toBeNull()
    const a = setAside(t, [0, 1])!
    expect(a.points).toBe(150)
    expect(a.free).toBe(4)
    expect(a.roll).toEqual([3, 3, 2, 6])
  })
  it('scoring with all six frees all six again', () => {
    const t: Turn = { roll: [2, 2, 2, 1, 5, 5], points: 300, free: 6, bust: false }
    const a = setAside(t, [0, 1, 2, 3, 4, 5])!
    expect(a.points).toBe(300 + 200 + 100 + 100)
    expect(a.free).toBe(6)
  })
  it('a roll with nothing in it is a bust', () => {
    // find a seed whose second roll busts and check it is flagged
    for (let seed = 1; seed < 500; seed++) {
      const rand = seeded(seed)
      const t = newTurn(rand)
      if (t.bust) continue
      const next = rollOn({ ...t, free: 1 }, rand)
      if (next.roll[0] !== 1 && next.roll[0] !== 5) {
        expect(next.bust).toBe(true)
        return
      }
    }
    throw new Error('no busting roll found')
  })
})

/** a whole game between two strategies; returns the winner's index */
function game(
  players: ((t: Turn, mine: number, theirs: number) => boolean)[],
  rand: () => number,
): number {
  const total = [0, 0]
  for (let turn = 0; turn < 400; turn++) {
    const p = turn % 2
    let t = newTurn(rand)
    while (!t.bust) {
      t = setAside(t, chooseKeep(t.roll))!
      if (players[p](t, total[p], total[1 - p])) {
        total[p] += t.points
        break
      }
      t = rollOn(t, rand)
    }
    if (total[p] >= TARGET) return p
  }
  return -1
}

describe('the computer', () => {
  it('only ever keeps dice that score', () => {
    const rand = seeded(3)
    for (let i = 0; i < 2000; i++) {
      const t = newTurn(rand)
      if (t.bust) continue
      expect(scoreOf(chooseKeep(t.roll).map((k) => t.roll[k]))).not.toBeNull()
    }
  })
  it('keeps one single 1 rather than 1 and 5 when that leaves more to roll', () => {
    expect(chooseKeep([1, 5, 2, 2, 4, 6])).toEqual([0])
    // but a straight is all six, and a triple is never broken up
    expect(chooseKeep([1, 5, 2, 3, 4, 6])).toHaveLength(6)
    expect(chooseKeep([3, 3, 3, 2, 4, 6])).toEqual([0, 1, 2])
  })
  it('beats a timid player who banks at 300, and a reckless one who banks at 2,000', () => {
    const rand = seeded(11)
    const timid = (t: Turn) => t.points >= 300
    const reckless = (t: Turn) => t.points >= 2000
    let vsTimid = 0
    let vsReckless = 0
    const n = 600
    for (let i = 0; i < n; i++) {
      // alternate who goes first, so first-move advantage cancels; the computer is player a
      const a = i % 2
      if (game(a ? [timid, wantsBank] : [wantsBank, timid], rand) === a) vsTimid++
      if (game(a ? [reckless, wantsBank] : [wantsBank, reckless], rand) === a) vsReckless++
    }
    expect(vsTimid / n).toBeGreaterThan(0.55)
    expect(vsReckless / n).toBeGreaterThan(0.55)
  })
})

describe('dice saves', () => {
  it('round-trips every field set away from its default, and drops each alone', () => {
    const s = { won: 4, lost: 6, bestTurn: 3450, fewestTurns: 14 }
    expect(readSaved(JSON.stringify(s))).toEqual(s)
    for (const k of Object.keys(s) as (keyof typeof s)[]) {
      const rest: Record<string, unknown> = { ...s }
      delete rest[k]
      expect(readSaved(JSON.stringify(rest))).toEqual({ ...s, [k]: EMPTY[k] })
    }
    expect(readSaved('{"won":"many"}')).toEqual(EMPTY)
  })
})
