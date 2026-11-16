import { afterEach, describe, expect, it, vi } from 'vitest'
import { chooseCard, choosePass, type Hand } from './hearts'
import {
  heartsRules,
  readHeartsSettings,
  replayPublic,
  totals,
  whoseMove,
  type HeartsGame,
  type HeartsMove,
} from './heartsRoom'

afterEach(() => vi.restoreAllMocks())
function seeded(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}
/* a hand counted here, not by the toy: who wins each trick, and what it costs */
const suit = (c: number) => c & 3
const rank = (c: number) => c >> 2
const cost = (c: number) => (c === 40 ? 13 : suit(c) === 1 ? 1 : 0)
function countHand(order: number[], first: number) {
  const pts = [0, 0, 0, 0]
  let lead = first
  for (let t = 0; t < 13; t++) {
    const trick = order.slice(t * 4, t * 4 + 4)
    let best = 0
    for (let i = 1; i < 4; i++)
      if (suit(trick[i]) === suit(trick[0]) && rank(trick[i]) > rank(trick[best])) best = i
    const winner = (lead + best) % 4
    pts[winner] += trick.reduce((a, c) => a + cost(c), 0)
    lead = winner
  }
  const moon = pts.indexOf(26)
  return moon >= 0 ? pts.map((_, i) => (i === moon ? 0 : 26)) : pts
}
type Mode = 'versus' | 'together'
/** a server's game: the friends' moves chosen by the toy's own computer too */
function playOut(seed: number, level: 'easy' | 'fair' | 'hard', mode: Mode = 'versus', end = 50) {
  const R = heartsRules(end, level)
  const rnd = seeded(seed)
  vi.spyOn(Math, 'random').mockImplementation(rnd)
  let g = R.hidden!.accept(R.fresh(mode), null, mode)!
  const moments: HeartsGame[] = []
  for (let k = 0; k < 3000 && whoseMove(g) !== null; k++) {
    const s = whoseMove(g)!
    let m: HeartsMove
    if (g.phase === 'pass') {
      const seat = g.passed[0] ? 2 : 0
      const p = choosePass(g.dealt![seat], 'fair', rnd)
      m = { pass: [p[0], p[1], p[2]] }
    } else m = { play: chooseCard(g.h, 'fair', rnd) }
    expect(R.legal(g, m, s)).toBe(true)
    g = R.roll(R.apply(g, m), rnd)
    if (k % 9 === 4) moments.push(g)
  }
  vi.restoreAllMocks()
  expect(whoseMove(g)).toBeNull()
  return { g, moments, R }
}

describe('hearts by turns: four at the table, the friends across from each other', () => {
  it('reads its end and level and nothing else', () => {
    expect(readHeartsSettings({})).toEqual({ end: 100, level: 'fair' })
    expect(readHeartsSettings({ end: 50, level: 'hard' })).toEqual({ end: 50, level: 'hard' })
    for (const bad of [{ end: 75 }, { end: '100' }, { level: 'expert' }])
      expect(readHeartsSettings(bad)).toBeNull()
  })

  it('deals with the yes: the computers pass at once, the friends’ passes sealed until both are in', () => {
    const R = heartsRules(50, 'fair')
    let g = R.hidden!.accept(R.fresh('versus'), null, 'versus')!
    expect(g.phase).toBe('pass')
    expect(g.passes[0]).toBeNull()
    expect(g.passes[2]).toBeNull()
    expect(g.passes[1]).toHaveLength(3)
    expect(g.passes[3]).toHaveLength(3)
    expect(JSON.stringify(R.encode(g))).not.toMatch(/dealt|passes|hands/)
    expect(whoseMove(g)).toBe(0)
    expect(R.friendTurn!(g)).toBe(0)
    const a = g.dealt![0].slice(0, 3) as [number, number, number]
    const b = g.dealt![2].slice(0, 3) as [number, number, number]
    expect(R.legal(g, { pass: b }, 0)).toBe(false)
    g = R.apply(g, { pass: a })
    expect(g.passed).toEqual([true, false])
    expect(whoseMove(g)).toBe(1)
    expect(R.friendTurn!(g)).toBe(1)
    expect(R.hidden!.logged({ pass: a })).toEqual({ pass: 'face down' })
    expect((R.hidden!.mine(g, 1, 1) as { passed: unknown }).passed).toBeNull()
    expect((R.hidden!.mine(g, 0, 0) as { passed: unknown }).passed).toEqual(a)
    g = R.apply(g, { pass: b })
    expect(g.phase).toBe('play')
    // the first hand passes left: seat 0's three went to seat 1, and the two of clubs leads
    expect(a.every((c) => g.h.hands[1].includes(c))).toBe(true)
    expect(g.h.hands[g.first]).toContain(3)
    expect((R.hidden!.mine(g, 1, 1) as { got: number[] }).got).toEqual(g.passes[1])
  })

  it('together, both friends are the team, each shown their own hand and moving in their own seat', () => {
    const R = heartsRules(50, 'fair')
    const g = R.hidden!.accept(R.fresh('together'), null, 'together')!
    expect(g.together).toBe(true)
    expect(whoseMove(g)).toBe(0)
    const ann = R.hidden!.mine(g, 0, 0) as { hand: number[] }
    const bo = R.hidden!.mine(g, 0, 1) as { hand: number[] }
    expect(ann.hand).toEqual(g.dealt![0])
    expect(bo.hand).toEqual(g.dealt![2])
    const after = R.apply(g, { pass: [ann.hand[0], ann.hand[1], ann.hand[2]] })
    expect(whoseMove(after)).toBe(0)
    expect(R.friendTurn!(after)).toBe(1)
  })

  it('plays whole matches, every seat’s points what its tricks say as counted here', () => {
    const winners = new Set<string>()
    let moons = 0
    for (let seed = 1; seed <= 8; seed++) {
      const mode: Mode = seed % 2 ? 'versus' : 'together'
      const { g, R } = playOut(seed, (['easy', 'fair'] as const)[seed % 2], mode)
      const t = [0, 0, 0, 0]
      for (const p of g.past) {
        const pts = countHand(p.order, p.first)
        if (pts.filter((x) => x === 26).length === 3) moons++
        pts.forEach((x, i) => (t[i] += x))
      }
      expect(totals(g)).toEqual(t)
      expect(Math.max(...t)).toBeGreaterThanOrEqual(50)
      const [a, b] = g.together ? [t[0] + t[2], t[1] + t[3]] : [t[0], t[2]]
      expect(R.result!(g)).toBe(a < b ? 0 : b < a ? 1 : 'draw')
      winners.add(String(R.result!(g)))
    }
    expect(winners.size).toBeGreaterThan(1)
    void moons
  })

  it('travels and comes back as it was, mid-hand, every field', () => {
    const { moments, R } = playOut(3, 'fair')
    const busy = moments.filter(
      (m) => m.past.length > 0 && m.phase === 'play' && m.h.played.length > 4,
    )
    expect(busy.length).toBeGreaterThan(0)
    for (const m of busy.slice(0, 6)) {
      const back = R.decode(JSON.parse(JSON.stringify(R.encode(m))))!
      expect(back).not.toBeNull()
      const j = R.hidden!.join(back, JSON.parse(JSON.stringify(R.hidden!.secret(m))))!
      expect(j).not.toBeNull()
      for (const k of ['past', 'phase', 'passed', 'first', 'dealt', 'passes', 'together'] as const)
        expect(j[k]).toEqual(m[k])
      for (const k of [
        'hands',
        'trick',
        'leader',
        'turn',
        'taken',
        'broken',
        'tricks',
        'void',
        'played',
      ] as const)
        expect((j.h as Hand)[k]).toEqual((m.h as Hand)[k])
    }
  })

  it('refuses a finished hand no legal play makes, a wrong lead, and a deal that is not one', () => {
    const { moments, R } = playOut(5, 'fair')
    const m = moments.find((x) => x.past.length > 0 && x.phase === 'play' && x.h.played.length > 4)!
    const w = R.encode(m) as Record<string, unknown> & {
      past: { first: number; order: number[] }[]
      played: number[]
      first: number
    }
    // two cards of a finished hand swapped across tricks: somebody no longer follows suit
    let broke = false
    for (let i = 4; i < 52 && !broke; i++) {
      const p = [...w.past[0].order]
      ;[p[1], p[i]] = [p[i], p[1]]
      if (R.decode({ ...w, past: [{ ...w.past[0], order: p }, ...w.past.slice(1)] }) === null)
        broke = true
    }
    expect(broke).toBe(true)
    // a finished hand put down to another first seat: refused, or its points on other seats
    const back = R.decode(w)!
    const shifted = R.decode({
      ...w,
      past: [{ ...w.past[0], first: (w.past[0].first + 1) % 4 }, ...w.past.slice(1)],
    })
    if (shifted) expect(totals(shifted)).not.toEqual(totals(back))
    expect(R.decode({ ...w, played: [w.played[1], w.played[0], ...w.played.slice(2)] })).toBeNull()
    const sec = R.hidden!.secret(m) as { dealt: number[][]; passes: (number[] | null)[] }
    expect(R.hidden!.join(back, sec)).not.toBeNull()
    // the hand in play put down to another first seat: refused publicly, or on the server
    const wrongLead = R.decode({ ...w, first: (w.first + 1) % 4 })
    expect(wrongLead === null || R.hidden!.join(wrongLead, sec) === null).toBe(true)
    expect(
      R.hidden!.join(back, {
        ...sec,
        dealt: [sec.dealt[1], sec.dealt[0], sec.dealt[2], sec.dealt[3]],
      }),
    ).toBeNull()
    const twice = sec.dealt.map((h, i) => (i === 0 ? [sec.dealt[1][0], ...h.slice(1)] : h))
    expect(R.hidden!.join(back, { ...sec, dealt: twice })).toBeNull()
    expect(replayPublic(50, 'fair', false, { ...w, phase: 'over' })).toBeNull()
    expect(R.readMove({ pass: [1, 1, 2] })).toBeNull()
    expect(R.readMove({ play: 52 })).toBeNull()
  })

  it('the computers read only their own cards and the table: deal the rest otherwise, same card', () => {
    for (const level of ['easy', 'fair', 'hard'] as const)
      for (let seed = 1; seed <= 4; seed++) {
        const { moments } = playOut(seed + 10, 'fair')
        for (const m of moments.filter((x) => x.phase === 'play').slice(0, 4)) {
          // the seat to play; what every other seat holds is what it cannot see
          const h = m.h
          const seat = h.turn
          const unseen = h.hands.flatMap((x, i) => (i === seat ? [] : x))
          const rnd = seeded(seed)
          const mixed = unseen
            .map((c) => [rnd(), c] as const)
            .sort((a, b) => a[0] - b[0])
            .map((x) => x[1])
          let at = 0
          const other: Hand = {
            ...h,
            hands: h.hands.map((x, i) => (i === seat ? x : mixed.slice(at, (at += x.length)))),
          }
          expect(chooseCard(other, level, seeded(seed * 7)), `${level} ${seed}`).toEqual(
            chooseCard(h, level, seeded(seed * 7)),
          )
        }
      }
  })

  it('and so do the computers the room plays: the first card after a friend’s is the same however the rest is dealt', () => {
    let checked = 0
    // Fair plays by habit and draws no random numbers, so it is Easy and Hard that are asked here
    for (let seed = 1; seed <= 6; seed++) {
      const { moments, R } = playOut(seed + 20, seed % 2 ? 'easy' : 'hard')
      for (const m of moments.filter((x) => x.phase === 'play').slice(0, 3)) {
        // the friend plays; now it is a computer's turn, if the trick goes on
        const card = chooseCard(m.h, 'fair', seeded(seed))
        const g = R.apply(m, { play: card })
        if (g.phase !== 'play' || g.h.turn % 2 === 0) continue
        const bot = g.h.turn
        const unseen = g.h.hands.flatMap((x, i) => (i === bot ? [] : x))
        const rnd = seeded(seed + 1)
        const mixed = unseen
          .map((c) => [rnd(), c] as const)
          .sort((a, b) => a[0] - b[0])
          .map((x) => x[1])
        let at = 0
        const other: HeartsGame = {
          ...g,
          h: {
            ...g.h,
            hands: g.h.hands.map((x, i) => (i === bot ? x : mixed.slice(at, (at += x.length)))),
          },
        }
        const next = (x: HeartsGame) => R.roll(x, seeded(seed * 11)).h.played[g.h.played.length]
        expect(next(other), `seed ${seed}`).toBe(next(g))
        checked++
      }
    }
    expect(checked).toBeGreaterThan(3)
  })
})
