import { afterEach, describe, expect, it, vi } from 'vitest'
import { chooseBid, chooseCard, type Hand } from './spades'
import {
  dealerOf,
  readSpadesSettings,
  spadesRules,
  teams,
  whoseMove,
  type SpadesGame,
  type SpadesMove,
} from './spadesRoom'

afterEach(() => vi.restoreAllMocks())
function seeded(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}
/* a hand counted here: who takes each trick with spades trumping, and what the bids then score */
const suit = (c: number) => c & 3
const rank = (c: number) => c >> 2
function tricksWon(order: number[], first: number) {
  const won = [0, 0, 0, 0]
  let lead = first
  for (let t = 0; t < 13; t++) {
    const trick = order.slice(t * 4, t * 4 + 4)
    let best = 0
    for (let i = 1; i < 4; i++) {
      const [b, c] = [trick[best], trick[i]]
      const beats = suit(c) === suit(b) ? rank(c) > rank(b) : suit(c) === 0
      if (beats) best = i
    }
    lead = (lead + best) % 4
    won[lead]++
  }
  return won
}
function scoreHere(hands: { bids: number[]; won: number[] }[]) {
  const t = [
    { score: 0, bags: 0 },
    { score: 0, bags: 0 },
  ]
  for (const { bids, won } of hands)
    for (const team of [0, 1]) {
      const seats = [team, team + 2]
      let need = 0
      let got = 0
      for (const s of seats)
        if (bids[s] === 0) {
          t[team].score += won[s] === 0 ? 100 : -100
          t[team].bags += won[s]
        } else {
          need += bids[s]
          got += won[s]
        }
      if (need === 0) t[team].bags += got
      else if (got >= need) {
        t[team].score += need * 10 + (got - need)
        t[team].bags += got - need
      } else t[team].score -= need * 10
      while (t[team].bags >= 10) {
        t[team].bags -= 10
        t[team].score -= 100
      }
    }
  return t
}
type Mode = 'versus' | 'together'
function playOut(
  seed: number,
  level: 'easy' | 'fair' | 'hard',
  mode: Mode = 'versus',
  target = 200,
) {
  const R = spadesRules(target, level)
  const rnd = seeded(seed)
  vi.spyOn(Math, 'random').mockImplementation(rnd)
  let g = R.hidden!.accept(R.fresh(mode), null, mode)!
  const moments: SpadesGame[] = []
  for (let k = 0; k < 3000 && whoseMove(g) !== null; k++) {
    const s = whoseMove(g)!
    const m: SpadesMove = g.h.bids.some((b) => b === null)
      ? { bid: chooseBid(g.h, 'fair', rnd) }
      : { play: chooseCard(g.h, 'fair', rnd) }
    expect(R.legal(g, m, s)).toBe(true)
    g = R.roll(R.apply(g, m), rnd)
    if (k % 3 === 1) moments.push(g)
  }
  vi.restoreAllMocks()
  expect(whoseMove(g)).toBeNull()
  return { g, moments, R }
}

describe('spades by turns: partnerships, the computer filling the table', () => {
  it('reads its target and level and nothing else', () => {
    expect(readSpadesSettings({})).toEqual({ target: 300, level: 'fair' })
    expect(readSpadesSettings({ target: 500, level: 'hard' })).toEqual({
      target: 500,
      level: 'hard',
    })
    for (const bad of [{ target: 250 }, { target: '300' }, { level: 'expert' }])
      expect(readSpadesSettings(bad)).toBeNull()
  })

  it('seats the friends by mode: versus each beside a computer partner, together as partners', () => {
    const R = spadesRules(200, 'fair')
    let v = R.hidden!.accept(R.fresh('versus'), null, 'versus')!
    expect(v.h.dealer).toBe(3)
    expect(whoseMove(v)).toBe(0)
    expect((R.hidden!.mine(v, 1, 1) as { seat: number; hand: number[] }).seat).toBe(1)
    expect((R.hidden!.mine(v, 1, 1) as { hand: number[] }).hand).toEqual(v.dealt![1])
    v = R.apply(v, { bid: 3 })
    expect(whoseMove(v)).toBe(1)
    // the bids are public: the challenger's is in what travels, the hands are not
    const wire = R.encode(v) as { bids: (number | null)[] }
    expect(wire.bids).toEqual([3, null, null, null])
    expect(JSON.stringify(wire)).not.toMatch(/dealt|hands/)
    const t = R.hidden!.accept(R.fresh('together'), null, 'together')!
    expect((R.hidden!.mine(t, 0, 1) as { seat: number }).seat).toBe(2)
    const t2 = R.roll(R.apply(t, { bid: 2 }), seeded(1))
    // the computer at seat 1 has bid in the roll: Bo, at seat 2, is next
    expect(t2.h.bids[1]).not.toBeNull()
    expect(whoseMove(t2)).toBe(0)
    expect(R.friendTurn!(t2)).toBe(1)
  })

  it('plays whole games, the partnerships’ scores what the bids and tricks make, as counted here', () => {
    const winners = new Set<string>()
    for (let seed = 1; seed <= 6; seed++) {
      const mode: Mode = seed % 2 ? 'versus' : 'together'
      const { g, R } = playOut(seed, 'fair', mode)
      const hands = g.past.map((p, k) => ({
        bids: p.bids,
        won: tricksWon(p.order, (dealerOf(k) + 1) % 4),
      }))
      const want = scoreHere(hands)
      expect(teams(g)).toEqual(want)
      const w = want[0].score > want[1].score ? 0 : want[1].score > want[0].score ? 1 : 'draw'
      expect(R.result!(g)).toBe(w)
      winners.add(String(w))
    }
    expect(winners.size).toBeGreaterThan(1)
  })

  it('travels and comes back as it was, mid-bid and mid-hand, every field', () => {
    // to 500, so a missed nil (a team at minus half the target ends the game) does not end it early
    const { moments, R } = playOut(3, 'fair', 'versus', 500)
    const busy = moments.filter((m) => m.past.length > 0 && !m.over)
    expect(busy.some((m) => m.h.bids.some((b) => b === null))).toBe(true)
    expect(busy.some((m) => m.h.played.length > 4)).toBe(true)
    for (const m of busy.slice(0, 8)) {
      const back = R.decode(JSON.parse(JSON.stringify(R.encode(m))))!
      expect(back).not.toBeNull()
      const j = R.hidden!.join(back, JSON.parse(JSON.stringify(R.hidden!.secret(m))))!
      expect(j).not.toBeNull()
      for (const k of ['past', 'together', 'dealt', 'over'] as const) expect(j[k]).toEqual(m[k])
      for (const k of [
        'hands',
        'dealer',
        'bids',
        'trick',
        'leader',
        'turn',
        'won',
        'broken',
        'tricks',
        'void',
        'played',
      ] as const)
        expect((j.h as Hand)[k]).toEqual((m.h as Hand)[k])
    }
  })

  it('refuses a finished hand no legal play makes, bids out of turn, and a deal that is not one', () => {
    const { moments, R } = playOut(5, 'fair', 'versus', 500)
    const m = moments.find((x) => x.past.length > 0 && !x.over && x.h.played.length > 4)!
    const w = R.encode(m) as Record<string, unknown> & {
      past: { bids: number[]; order: number[] }[]
      bids: number[]
      played: number[]
    }
    let broke = false
    for (let i = 4; i < 52 && !broke; i++) {
      const p = [...w.past[0].order]
      ;[p[1], p[i]] = [p[i], p[1]]
      if (R.decode({ ...w, past: [{ ...w.past[0], order: p }, ...w.past.slice(1)] }) === null)
        broke = true
    }
    expect(broke).toBe(true)
    // a finished hand's bids changed: still a hand, but other scores — and not this match's
    const rebid = { ...w.past[0], bids: w.past[0].bids.map((b) => (b + 1) % 14) }
    const other = R.decode({ ...w, past: [rebid, ...w.past.slice(1)] })
    if (other) expect(teams(other)).not.toEqual(teams(m))
    // a bid made with an earlier bidder's still to come; a card played while bids are still owed
    const dealer = dealerOf(m.past.length)
    const firstBidder = (dealer + 1) % 4
    const holes = [...w.bids]
    holes[firstBidder] = null as unknown as number
    expect(R.decode({ ...w, bids: holes, played: [] })).toBeNull()
    expect(R.decode({ ...w, bids: [null, null, null, null] })).toBeNull()
    const back = R.decode(w)!
    const sec = R.hidden!.secret(m) as { dealt: number[][] }
    expect(R.hidden!.join(back, sec)).not.toBeNull()
    expect(
      R.hidden!.join(back, { dealt: [sec.dealt[1], sec.dealt[0], sec.dealt[2], sec.dealt[3]] }),
    ).toBeNull()
    expect(
      R.hidden!.join(back, {
        dealt: sec.dealt.map((h, i) => (i === 0 ? [sec.dealt[1][0], ...h.slice(1)] : h)),
      }),
    ).toBeNull()
    expect(R.readMove({ bid: 14 })).toBeNull()
    expect(R.readMove({ bid: 2.5 })).toBeNull()
    expect(R.readMove({ play: 3, bid: 2 })).toBeNull()
  })

  it('the computers the room plays read only their own cards and the table', () => {
    let checked = 0
    for (let seed = 1; seed <= 4; seed++) {
      const level = seed % 2 ? 'easy' : 'hard'
      const { moments, R } = playOut(seed + 20, level)
      for (const m of moments.filter((x) => !x.over && x.h.played.length > 0).slice(0, 2)) {
        const card = chooseCard(m.h, 'fair', seeded(seed))
        const g = R.apply(m, { play: card })
        if (g.over || g.h.turn < 2) continue
        const bot = g.h.turn
        const unseen = g.h.hands.flatMap((x, i) => (i === bot ? [] : x))
        const rnd = seeded(seed + 1)
        const mixed = unseen
          .map((c) => [rnd(), c] as const)
          .sort((a, b) => a[0] - b[0])
          .map((x) => x[1])
        let at = 0
        const other: SpadesGame = {
          ...g,
          h: {
            ...g.h,
            hands: g.h.hands.map((x, i) => (i === bot ? x : mixed.slice(at, (at += x.length)))),
          },
        }
        const next = (x: SpadesGame) => R.roll(x, seeded(seed * 11)).h.played[g.h.played.length]
        expect(next(other), `seed ${seed}`).toBe(next(g))
        checked++
      }
    }
    expect(checked).toBeGreaterThan(1)
  }, 60000)
})
