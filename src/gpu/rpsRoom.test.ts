import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Move } from './rps'
import {
  capOf,
  readRpsSettings,
  replayPublic,
  rpsRules,
  whoseMove,
  wins,
  type RpsGame,
} from './rpsRoom'

const R = rpsRules(3)
function seeded(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}
/** who wins a round, written here: rock blunts scissors, scissors cut paper, paper wraps rock */
const WINS: Record<string, number> = {
  '0,2': 1,
  '2,1': 1,
  '1,0': 1,
  '2,0': -1,
  '1,2': -1,
  '0,1': -1,
}
const outcome = (a: Move, b: Move) => (a === b ? 0 : WINS[`${a},${b}`])
/** a round played through the rules: the challenger seals, the friend answers */
const round = (g: RpsGame, a: Move, b: Move) => R.apply(R.apply(g, { play: a }), { play: b })

afterEach(() => vi.restoreAllMocks())

describe('rock, paper, scissors by turns: first to so many, the first move of a round sealed', () => {
  it('reads its first-to and nothing else', () => {
    expect(readRpsSettings({})).toEqual({ firstTo: 3 })
    expect(readRpsSettings({ firstTo: 10 })).toEqual({ firstTo: 10 })
    for (const bad of [{ firstTo: 4 }, { firstTo: '3' }, { firstTo: 0 }])
      expect(readRpsSettings(bad)).toBeNull()
  })

  it('seals the challenger’s move until the friend answers, then shows the round whole', () => {
    let g = R.fresh()
    expect(whoseMove(g)).toBe(0)
    expect(R.legal(g, { play: 1 }, 1)).toBe(false)
    g = R.apply(g, { play: 2 })
    // what travels says a move is waiting, and nothing of which
    expect(R.encode(g)).toEqual({ rounds: [], sealed: true })
    expect(R.hidden!.secret(g)).toEqual({ pending: 2 })
    expect(R.hidden!.mine(g, 0)).toBe(2)
    expect(R.hidden!.mine(g, 1)).toBeNull()
    expect(whoseMove(g)).toBe(1)
    expect(R.legal(g, { play: 0 }, 0)).toBe(false)
    g = R.apply(g, { play: 0 })
    expect(R.encode(g)).toEqual({ rounds: [[2, 0]], sealed: false })
    expect(R.hidden!.secret(g)).toEqual({ pending: null })
    expect(R.hidden!.logged({ play: 1 })).toEqual({})
  })

  it('plays to the first to win so many, the winner by a count made here', () => {
    const seen = new Set<string>()
    for (let seed = 1; seed <= 200; seed++) {
      const rnd = seeded(seed)
      const n = [3, 5, 10][seed % 3]
      const C = rpsRules(n)
      // a lopsided pair now and then, so both sides win some matches
      const lean = seed % 4
      const move = (side: number): Move =>
        lean === side + 1 && rnd() < 0.3 ? (side ? 1 : 0) : (Math.floor(rnd() * 3) as Move)
      let g = C.fresh()
      const w = [0, 0]
      for (let k = 0; k < 1000 && whoseMove(g) !== null; k++) {
        const a = move(0)
        const b = move(1)
        g = C.apply(C.apply(g, { play: a }), { play: b })
        const o = outcome(a, b)
        if (o > 0) w[0]++
        if (o < 0) w[1]++
        if (Math.max(...w) >= n) break
      }
      expect(whoseMove(g)).toBeNull()
      expect(wins(g)).toEqual(w)
      expect(Math.max(...w)).toBe(n)
      expect(C.result!(g)).toBe(w[0] === n ? 0 : 1)
      seen.add(String(C.result!(g)))
    }
    expect(seen).toEqual(new Set(['0', '1']))
    // a run of draws ends where it stands at the cap, a draw
    let g = R.fresh()
    for (let k = 0; k < capOf(3); k++) g = round(g, 1, 1)
    expect(whoseMove(g)).toBeNull()
    expect(R.result!(g)).toBe('draw')
  })

  it('travels and comes back as it was, and refuses what no match could be', () => {
    let g = round(round(R.fresh(), 0, 2), 1, 1)
    g = R.apply(g, { play: 2 })
    const wire = JSON.parse(JSON.stringify(R.encode(g)))
    const back = R.decode(wire)!
    expect(back).toEqual({ ...g, pending: null })
    expect(R.hidden!.join(back, R.hidden!.secret(g))).toEqual(g)
    // a sealed move the state does not say is waiting, or a waiting one with nothing sealed
    expect(R.hidden!.join(back, { pending: null })).toBeNull()
    expect(R.hidden!.join(R.decode({ ...wire, sealed: false })!, { pending: 2 })).toBeNull()
    expect(R.hidden!.join(back, { pending: 3 })).toBeNull()
    // a move that is no move, a round too short, a sealed move showing, rounds after it was won
    expect(R.decode({ rounds: [[0, 3]], sealed: false })).toBeNull()
    expect(R.decode({ rounds: [[0]], sealed: false })).toBeNull()
    expect(R.decode({ ...wire, pending: 2 })).toBeNull()
    expect(replayPublic(3, { rounds: Array(4).fill([0, 2]), sealed: false })).toBeNull()
    expect(replayPublic(3, { rounds: Array(3).fill([0, 2]), sealed: true })).toBeNull()
    expect(R.readMove({ play: 1, peek: true })).toBeNull()
    expect(R.readMove({ play: 3 })).toBeNull()
    expect(R.readMove({ play: 2 })).toEqual({ play: 2 })
  })

  it('the computer answers from the finished rounds only — whatever is sealed, the same answer', () => {
    for (const level of ['easy', 'fair', 'hard'])
      for (let seed = 1; seed <= 30; seed++) {
        const rnd = seeded(seed)
        let g = R.fresh()
        for (let k = 0; k < seed % 8; k++)
          g = round(g, (k % 3) as Move, Math.floor(rnd() * 3) as Move)
        const answers = ([0, 1, 2] as Move[]).map((p) => {
          // the same random numbers each time: only the sealed move differs
          const r = seeded(seed * 7 + 1)
          vi.spyOn(Math, 'random').mockImplementation(r)
          const a = R.computer!.choose(R.apply(g, { play: p }), level)
          vi.restoreAllMocks()
          return a
        })
        expect(answers[1], `${level} ${seed}`).toEqual(answers[0])
        expect(answers[2], `${level} ${seed}`).toEqual(answers[0])
      }
  })

  it('offers three computers: one with a habit to find, one by chance, one that finds yours', () => {
    /** decisive rounds the player won, over many, against a level */
    const share = (level: string, player: (g: RpsGame, rnd: () => number) => Move) => {
      const rnd = seeded(42)
      vi.spyOn(Math, 'random').mockImplementation(seeded(43))
      let won = 0
      let decided = 0
      for (let m = 0; m < 30; m++) {
        let g = rpsRules(10).fresh()
        const C = rpsRules(10)
        for (let k = 0; k < 400 && whoseMove(g) !== null; k++) {
          g = C.apply(g, { play: player(g, rnd) })
          g = C.apply(g, C.computer!.choose(g, level))
          const [a, b] = g.rounds[g.rounds.length - 1]
          const o = outcome(a, b)
          if (o) decided++
          if (o > 0) won++
        }
      }
      vi.restoreAllMocks()
      return won / decided
    }
    // somebody who has noticed Easy goes round the circle: they play what beats its next move
    const spotter = (g: RpsGame, rnd: () => number): Move => {
      const last = g.rounds[g.rounds.length - 1]
      return last ? (((((last[1] + 1) % 3) + 1) % 3) as Move) : (Math.floor(rnd() * 3) as Move)
    }
    // somebody with a habit: rock, four times in five
    const rocky = (_: RpsGame, rnd: () => number): Move =>
      rnd() < 0.8 ? 0 : (Math.floor(rnd() * 3) as Move)
    expect(share('easy', spotter)).toBeGreaterThan(0.7)
    expect(Math.abs(share('fair', spotter) - 0.5)).toBeLessThan(0.06)
    expect(Math.abs(share('fair', rocky) - 0.5)).toBeLessThan(0.06)
    expect(share('hard', rocky)).toBeLessThan(0.3)
    // and Hard is no worse than chance against the spotter, whose moves follow its own
    expect(share('hard', spotter)).toBeLessThan(0.56)
  })
})
