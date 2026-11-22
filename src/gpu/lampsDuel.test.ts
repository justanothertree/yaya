import { afterEach, describe, expect, it, vi } from 'vitest'
import { solve } from './lamps'
import {
  boardOf,
  duelRules,
  parOf,
  pressesBoth,
  readDuelSettings,
  replayPublic,
  whoseMove,
  type DuelGame,
} from './lampsDuel'

afterEach(() => vi.restoreAllMocks())

/**
 * A press, written here from the toy's own words rather than imported: the lamp and its four
 * neighbours beside it (plus) or on its diagonals (cross), each switched, none past the edge.
 */
function myPress(lit: boolean[], n: number, i: number, pattern: 'plus' | 'cross') {
  const out = lit.slice()
  const r = Math.floor(i / n)
  const c = i % n
  const near =
    pattern === 'plus'
      ? [
          [r, c],
          [r - 1, c],
          [r + 1, c],
          [r, c - 1],
          [r, c + 1],
        ]
      : [
          [r, c],
          [r - 1, c - 1],
          [r - 1, c + 1],
          [r + 1, c - 1],
          [r + 1, c + 1],
        ]
  for (const [y, x] of near)
    if (y >= 0 && x >= 0 && y < n && x < n) out[y * n + x] = !out[y * n + x]
  return out
}
/** a solve's lamps at the end, pressed here: undo is the press before it, pressed again */
function myEnd(start: boolean[], n: number, pattern: 'plus' | 'cross', a: number[]) {
  const done: number[] = []
  let lit = start
  for (const x of a) {
    const i = x === -1 ? done.pop()! : x
    if (x !== -1) done.push(x)
    lit = myPress(lit, n, i, pattern)
  }
  return lit
}

/** a duel past the yes, with this seed */
function accepted(size: 4 | 5 | 6 | 7, pattern: 'plus' | 'cross', seed: number) {
  const R = duelRules(size, pattern)
  vi.spyOn(Math, 'random').mockReturnValue(seed / 2 ** 32)
  const g = R.hidden!.accept(R.fresh(), null, 'versus')!
  vi.restoreAllMocks()
  return { R, g }
}
const parSolve = (g: DuelGame) => solve(boardOf(g)!, g.size, g.pattern)!

describe('lamps as a duel by turns: the same board, the first solve sealed', () => {
  it('reads its settings: 5×5 beside by default, any of the toy’s sizes and patterns, nothing else', () => {
    expect(readDuelSettings({})).toEqual({ size: 5, pattern: 'plus' })
    expect(readDuelSettings({ size: 7, pattern: 'cross' })).toEqual({ size: 7, pattern: 'cross' })
    expect(readDuelSettings({ size: 8 })).toBeNull()
    expect(readDuelSettings({ size: '5' })).toBeNull()
    expect(readDuelSettings({ pattern: 'diagonal' })).toBeNull()
  })

  it('makes its board with the yes, from a seed nobody saw before it, and the friend solves first', () => {
    const R = duelRules(5, 'plus')
    expect(whoseMove(R.fresh())).toBeNull()
    const a = accepted(5, 'plus', 123456789).g
    const b = accepted(5, 'plus', 987654321).g
    expect(a.seed).toBe(123456789)
    expect(boardOf(a)).not.toEqual(boardOf(b))
    expect(boardOf(a)!.some(Boolean)).toBe(true)
    expect(whoseMove(a)).toBe(1)
  })

  it('seals the friend’s solve: nothing of it travels, the history keeps nothing, only they see it', () => {
    const { R, g } = accepted(6, 'cross', 42424242)
    const mine = [...parSolve(g)]
    expect(R.legal(g, { solve: mine }, 0)).toBe(false)
    expect(R.legal(g, { solve: mine }, 1)).toBe(true)
    const s = R.apply(g, { solve: mine })
    expect(whoseMove(s)).toBe(0)
    expect(R.encode(s)).toEqual({ seed: 42424242, solves: [null, null], sealed: true })
    expect(R.hidden!.secret(s)).toEqual({ pending: mine })
    expect(R.hidden!.mine(s, 1, 1)).toEqual(mine)
    expect(R.hidden!.mine(s, 0, 0)).toBeNull()
    expect(R.hidden!.logged({ solve: mine })).toEqual({})
  })

  it('shows both once the challenger’s is in: fewer presses win, an undo counts, the same is a draw', () => {
    for (const [size, pattern, seed] of [
      [4, 'plus', 11],
      [5, 'cross', 2024],
      [7, 'plus', 77777],
    ] as const) {
      const { R, g } = accepted(size, pattern, seed)
      const par = parSolve(g)
      // every solve used here switches the board off, by this file's own presses
      const fumbled = [par[0], -1, ...par]
      const pressedTwice = [par[0], par[0], ...par]
      for (const a of [par, fumbled, pressedTwice])
        expect(myEnd(boardOf(g)!, size, pattern, a).some(Boolean)).toBe(false)
      expect(parOf(g)).toBe(par.length)

      const after = (friend: number[], challenger: number[]) =>
        R.apply(R.apply(g, { solve: friend }), { solve: challenger })
      const won = after(fumbled, par)
      expect(R.encode(won)).toEqual({ seed, solves: [par, fumbled], sealed: false })
      expect(pressesBoth(won)).toEqual([par.length, par.length + 2])
      expect(R.result!(won)).toBe(0)
      expect(R.result!(after(par, pressedTwice))).toBe(1)
      expect(R.result!(after(par, par))).toBe('draw')
      expect(whoseMove(won)).toBeNull()
    }
  })

  it('refuses a solve that leaves a lamp lit, goes dark early, or presses past the board', () => {
    const { R, g } = accepted(5, 'plus', 31337)
    const par = parSolve(g)
    const cases: [string, number[]][] = [
      ['one press short', par.slice(1)],
      ['dark before the last press', [...par, par[0]]],
      ['dark, then a lamp pressed twice', [...par, par[0], par[0]]],
      ['a lamp past the edge', [...par.slice(0, -1), 25]],
      ['an undo with nothing to undo', [-1, ...par]],
      ['nothing at all', []],
      ['past the most a solve may carry', [...Array.from({ length: 400 }, () => 0), ...par]],
    ]
    for (const [why, a] of cases) {
      if (why === 'one press short')
        expect(myEnd(boardOf(g)!, 5, 'plus', a).some(Boolean), why).toBe(true)
      expect(R.legal(g, { solve: a }, 1), why).toBe(false)
    }
    expect(R.readMove({ solve: [1, 2.5] })).toBeNull()
    expect(R.readMove({ solve: par, extra: 1 })).toBeNull()
    expect(R.readMove({ solve: par })).toEqual({ solve: par })
  })

  it('travels and comes back: sealed with its secret, and finished with both shown', () => {
    const { R, g } = accepted(6, 'plus', 5550123)
    const par = parSolve(g)
    const sealed = R.apply(g, { solve: [par[1], -1, ...par] })
    const back = R.decode(JSON.parse(JSON.stringify(R.encode(sealed))))!
    expect(back).toEqual({ ...sealed, pending: null })
    expect(R.hidden!.join(back, R.hidden!.secret(sealed))).toEqual(sealed)
    const done = R.apply(sealed, { solve: par })
    expect(R.decode(JSON.parse(JSON.stringify(R.encode(done))))).toEqual(done)
  })

  it('refuses a state or a secret that could not have happened', () => {
    const { R, g } = accepted(5, 'plus', 8080)
    const par = parSolve(g)
    const done = R.encode(R.apply(R.apply(g, { solve: par }), { solve: par })) as {
      seed: number
      solves: number[][]
      sealed: boolean
    }
    expect(replayPublic(5, 'plus', done)).not.toBeNull()
    // shown while still sealed; one shown without the other; one that does not switch it off
    expect(replayPublic(5, 'plus', { ...done, sealed: true })).toBeNull()
    expect(replayPublic(5, 'plus', { ...done, solves: [par, null] })).toBeNull()
    expect(replayPublic(5, 'plus', { ...done, solves: [par, par.slice(1)] })).toBeNull()
    // the same solves read on another seed's board, or before there is one
    expect(replayPublic(5, 'plus', { ...done, seed: done.seed + 1 })).toBeNull()
    expect(replayPublic(5, 'plus', { ...done, seed: null })).toBeNull()
    expect(replayPublic(5, 'plus', { seed: null, solves: [null, null], sealed: true })).toBeNull()
    expect(replayPublic(5, 'plus', { ...done, extra: 1 })).toBeNull()

    const open = R.decode(R.encode(g))!
    const sealed = R.decode(R.encode(R.apply(g, { solve: par })))!
    expect(R.hidden!.join(open, { pending: null })).not.toBeNull()
    expect(R.hidden!.join(open, { pending: par })).toBeNull()
    expect(R.hidden!.join(sealed, { pending: null })).toBeNull()
    expect(R.hidden!.join(sealed, { pending: par.slice(1) })).toBeNull()
  })
})
