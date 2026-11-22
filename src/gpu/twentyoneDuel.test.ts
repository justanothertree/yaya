import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  BET,
  START,
  chipsOf,
  computerRound,
  offered,
  playRound,
  readTwentyOneSettings,
  replayPublic,
  shoeOf,
  twentyOneRules,
  whoseMove,
  type DuelMove,
  type TwentyOneGame,
} from './twentyoneDuel'
import type { Act } from './twentyone'

afterEach(() => vi.restoreAllMocks())

/* ---- a round scored here, from the toy's own words, sharing nothing with the module ---- */
const value = (c: number) => {
  const r = c >> 2
  return r === 12 ? 1 : Math.min(10, r + 2)
}
const best = (h: number[]) => {
  const v = h.reduce((s, c) => s + value(c), 0)
  return h.some((c) => c >> 2 === 12) && v + 10 <= 21 ? v + 10 : v
}
const soft = (h: number[]) => {
  const v = h.reduce((s, c) => s + value(c), 0)
  return h.some((c) => c >> 2 === 12) && v + 10 <= 21
}
/** a round where the player stands on the two cards dealt: what it wins, by the table's rules */
function standingRound(seed: number): number {
  const s = shoeOf(seed)
  const p = [s[0], s[2]]
  const d = [s[1], s[3]]
  const pbj = best(p) === 21
  const dbj = best(d) === 21
  if (pbj && dbj) return 0
  if (pbj) return 1.5
  if (dbj) return -1
  let k = 4
  // the dealer draws to seventeen and stands on any seventeen, soft or hard (the toy's default)
  while (best(d) < 17) d.push(s[k++])
  const [pv, dv] = [best(p), best(d)]
  if (dv > 21) return 1
  return pv > dv ? 1 : pv < dv ? -1 : 0
}

function seededRandom(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}
function begun(rounds: number, mode: 'versus' | 'together', seed: number) {
  const R = twentyOneRules(rounds)
  vi.spyOn(Math, 'random').mockImplementation(seededRandom(seed))
  const g = R.hidden!.accept(R.fresh(mode), null, mode)!
  vi.restoreAllMocks()
  return { R, g }
}
/** a side plays its rounds a decision at a time, by a computer level's choices */
function playSide(R: ReturnType<typeof twentyOneRules>, g0: TwentyOneGame, level: string) {
  let g = g0
  const s = whoseMove(g)!
  const states: unknown[] = []
  for (let k = 0; k < 500 && whoseMove(g) === s; k++) {
    const r = g.done[s]
    const sofar = g.acts![s][r]
    const next = computerRound(g.seeds![r], level).slice(sofar.length)[0]
    const m: DuelMove = { act: next }
    expect(R.legal(g, m, s), `${level} ${r} ${next}`).toBe(true)
    g = R.apply(g, m)
    states.push(JSON.parse(JSON.stringify(R.encode(g))))
  }
  return { g, states }
}

describe('twenty-one as a duel by turns: duplicate rounds from shoes kept back', () => {
  it('reads its settings: ten rounds by default, five or ten, nothing else', () => {
    expect(readTwentyOneSettings({})).toEqual({ rounds: 10 })
    expect(readTwentyOneSettings({ rounds: 5 })).toEqual({ rounds: 5 })
    expect(readTwentyOneSettings({ rounds: 7 })).toBeNull()
    expect(readTwentyOneSettings({ rounds: '10' })).toBeNull()
  })

  it('plays a round as the table does: dealt player, dealer, player, dealer, paid by the rules', () => {
    let checked = 0
    for (let seed = 1; seed <= 400; seed++) {
      const v = playRound(seed, [])!
      const p = shoeOf(seed)
      expect(v.hands[0].cards.slice(0, 2)).toEqual([p[0], p[2]])
      expect(v.dealer[0]).toBe(p[1])
      // standing at once, where the table offers it, is scored here independently
      const stood = v.over ? v : playRound(seed, ['stand'])!
      expect(stood.won, `seed ${seed}`).toBe(standingRound(seed))
      checked++
    }
    expect(checked).toBe(400)
  })

  it('offers a split only on a pair, plays the split hand next, and turns the dealer on split aces', () => {
    let pairs = 0
    let aces = 0
    for (let seed = 1; seed <= 3000 && (pairs < 5 || aces < 1); seed++) {
      const v = playRound(seed, [])!
      if (v.over) continue
      const [a, b] = v.hands[0].cards
      const pair = value(a) === value(b)
      expect(offered(v).includes('split')).toBe(pair)
      if (!pair) {
        expect(playRound(seed, ['split'])).toBeNull()
        continue
      }
      const s = playRound(seed, ['split'])!
      expect(s.hands).toHaveLength(2)
      expect(s.hands[1].cards[0]).toBe(b)
      if (value(a) === 1) {
        aces++
        expect(s.over).toBe(true)
        expect(playRound(seed, ['split', 'stand'])).toBeNull()
      } else {
        pairs++
        expect(s.active).toBe(0)
        expect(playRound(seed, ['split', 'stand'])!.active).toBe(1)
      }
    }
    expect(pairs).toBe(5)
    expect(aces).toBe(1)
  })

  it('puts a hand split again straight after the one it came from, as the table does', () => {
    let found = 0
    for (let seed = 1; seed <= 200000 && !found; seed++) {
      const v = playRound(seed, [])!
      if (v.over || value(v.hands[0].cards[0]) !== value(v.hands[0].cards[1])) continue
      if (value(v.hands[0].cards[0]) === 1) continue
      const once = playRound(seed, ['split'])!
      if (!offered(once).includes('split')) continue
      const twice = playRound(seed, ['split', 'split'])!
      // the first split's second hand was the second; the new one comes between them
      expect(twice.hands).toHaveLength(3)
      expect(twice.hands[2].cards[0]).toBe(once.hands[1].cards[0])
      expect(twice.hands[1].cards[0]).toBe(once.hands[0].cards[1])
      found = seed
    }
    expect(found).toBeGreaterThan(0)
  })

  it('the computer’s levels are what they say, and the hole card is never in what it sees', () => {
    for (let seed = 1; seed <= 300; seed++) {
      for (const level of ['easy', 'fair', 'hard']) {
        const acts = computerRound(seed, level)
        expect(playRound(seed, acts)!.over).toBe(true)
        if (level !== 'hard') expect(acts.every((a) => a === 'hit' || a === 'stand')).toBe(true)
        // every view it chose from showed the dealer's up card alone
        for (let k = 0; k < acts.length; k++)
          expect(playRound(seed, acts.slice(0, k))!.dealer).toHaveLength(1)
      }
      for (const level of ['easy', 'fair'] as const) {
        const acts = computerRound(seed, level)
        for (let k = 0; k < acts.length; k++) {
          const h = playRound(seed, acts.slice(0, k))!
          const c = h.hands[h.active].cards
          const want =
            level === 'easy' ? (!soft(c) && best(c) >= 12) || best(c) >= 18 : best(c) >= 17
          expect(acts[k], `${level} ${seed} ${k}`).toBe(want ? 'stand' : 'hit')
        }
      }
      const fairActs = computerRound(seed, 'fair')
      const fair = playRound(seed, fairActs)!
      // Fair, given a decision, stands exactly where the dealer would
      if (fairActs.length) expect(best(fair.hands[0].cards) >= 17).toBe(true)
    }
  })

  it('versus: the friend plays every round first, and nothing of it travels but a count', () => {
    const { R, g } = begun(5, 'versus', 7)
    expect(whoseMove(g)).toBe(1)
    expect(g.seeds).toHaveLength(5)
    const first = playSide(R, g, 'hard')
    for (const st of first.states)
      expect(Object.keys(st as object).sort()).toEqual(['done', 'shown', 'together'])
    for (const st of first.states.slice(0, -1)) expect((st as { shown: unknown }).shown).toBeNull()
    expect(first.g.done).toEqual([0, 5])
    expect(whoseMove(first.g)).toBe(0)
    // the challenger sees nothing of the friend's rounds — before, nothing at all, and now only
    // the first of their own, its hole card down — and the friend sees all of their own
    expect(R.hidden!.mine(g, 0, 0)).toEqual([])
    const theirs = R.hidden!.mine(first.g, 0, 0) as { dealer: number[]; over: boolean }[]
    expect(theirs).toHaveLength(1)
    expect(theirs[0]).toEqual(playRound(first.g.seeds![0], []))
    expect((R.hidden!.mine(first.g, 1, 1) as unknown[]).length).toBe(5)
    expect(R.hidden!.logged({ act: 'split' })).toEqual({})
    const end = playSide(R, first.g, 'easy').g
    expect(whoseMove(end)).toBeNull()
    expect(end.shown).not.toBeNull()
    // the result is the chips the rounds won, worked out again from what is shown
    const chips = chipsOf(end.shown!.seeds, end.shown!.acts)!
    const by = (side: 0 | 1) =>
      START +
      BET *
        end.shown!.acts[side].reduce((s, a, r) => s + playRound(end.shown!.seeds[r], a)!.won!, 0)
    expect(chips).toEqual([by(0), by(1)])
    expect(R.result!(end)).toBe(chips[0] > chips[1] ? 0 : chips[1] > chips[0] ? 1 : 'draw')
    expect(R.decode(JSON.parse(JSON.stringify(R.encode(end))))).toEqual({
      ...end,
      seeds: null,
      acts: null,
    })
  })

  it('duplicate: both sides playing the same way on the same shoes come out level', () => {
    for (let seed = 1; seed <= 5; seed++) {
      const { R, g } = begun(10, 'versus', seed)
      const end = playSide(R, playSide(R, g, 'fair').g, 'fair').g
      expect(R.result!(end)).toBe('draw')
      const [a, b] = chipsOf(end.shown!.seeds, end.shown!.acts)!
      expect(a).toBe(b)
    }
  })

  it('together: the friends take alternate rounds, then the computer plays all of its own at once', () => {
    const { R, g } = begun(5, 'together', 11)
    expect(whoseMove(g)).toBe(0)
    let x = g
    const turns: number[] = []
    for (let k = 0; k < 200 && whoseMove(x) === 0; k++) {
      turns.push(R.friendTurn!(x)!)
      const r = x.done[0]
      x = R.apply(x, { act: computerRound(x.seeds![r], 'hard').slice(x.acts![0][r].length)[0] })
      // what the friend whose round it is plays: the even rounds the challenger, the odd the friend
      if (whoseMove(x) === 0) expect(R.friendTurn!(x)).toBe(x.done[0] % 2)
    }
    expect(turns[0]).toBe(0)
    expect(whoseMove(x)).toBe(1)
    let replies = 0
    while (whoseMove(x) === 1) {
      const m = R.computer!.choose(x, 'fair')
      expect(R.legal(x, m, 1)).toBe(true)
      x = R.apply(x, m)
      replies++
    }
    expect(replies).toBeLessThanOrEqual(5)
    expect(whoseMove(x)).toBeNull()
    expect(x.done).toEqual([5, 5])
  })

  it('refuses a decision the table did not offer, a half round sent as a whole one, and a bad state', () => {
    const { R, g } = begun(5, 'versus', 21)
    const r = g.done[1]
    const v = playRound(g.seeds![r], g.acts![1][r])!
    const not = (['hit', 'stand', 'double', 'split'] as Act[]).find((a) => !offered(v).includes(a))
    if (not) expect(R.legal(g, { act: not }, 1)).toBe(false)
    expect(R.legal(g, { act: 'stand' }, 0)).toBe(false)
    expect(R.legal(g, { acts: [] }, 1)).toBe(false)
    // a round that takes more than one decision: half of it is not a whole round
    let many = 0
    for (let seed = 1; !many; seed++) if (computerRound(seed, 'fair').length > 1) many = seed
    const whole = computerRound(many, 'fair')
    const atMany = { ...g, seeds: g.seeds!.map((x, i) => (i === r ? many : x)) }
    expect(R.legal(atMany, { acts: whole.slice(0, 1) }, 1)).toBe(false)
    expect(R.legal(atMany, { acts: whole }, 1)).toBe(true)
    // after a hit, no double
    expect(playRound(many, ['hit'])!.over).toBe(false)
    expect(offered(playRound(many, ['hit'])!)).toEqual(['hit', 'stand'])
    expect(R.legal(atMany, { act: 'hit' }, 1)).toBe(true)
    expect(R.legal(R.apply(atMany, { act: 'hit' }), { act: 'double' }, 1)).toBe(false)
    expect(R.readMove({ act: 'surrender' })).toBeNull()
    expect(R.readMove({ act: 'hit', acts: [] })).toBeNull()

    // the challenger cannot have begun before the friend is through
    expect(replayPublic(5, { done: [1, 2], shown: null, together: false })).toBeNull()
    expect(replayPublic(5, { done: [0, 5], shown: null, together: false })).not.toBeNull()
    expect(replayPublic(5, { done: [5, 5], shown: null, together: false })).toBeNull()
    expect(replayPublic(5, { done: [0, 2], shown: null })).toBeNull()

    const end = playSide(R, playSide(R, g, 'hard').g, 'hard').g
    const w = R.encode(end) as { done: number[]; shown: { seeds: number[]; acts: Act[][][] } }
    expect(replayPublic(5, w)).not.toBeNull()
    // a round shown before its end, and a seed missing
    const played = w.shown.acts[0].findIndex((a) => a.length > 0)
    expect(played).toBeGreaterThanOrEqual(0)
    const cut = w.shown.acts[0].map((a, i) => (i === played ? a.slice(0, -1) : a))
    expect(
      replayPublic(5, { ...w, shown: { ...w.shown, acts: [cut, w.shown.acts[1]] } }),
    ).toBeNull()
    expect(
      replayPublic(5, { ...w, shown: { ...w.shown, seeds: w.shown.seeds.slice(1) } }),
    ).toBeNull()

    // a secret whose play disagrees with the count the state keeps
    const mid = playSide(R, g, 'hard').g
    const sec = R.hidden!.secret(mid) as { seeds: number[]; acts: Act[][][] }
    const back = R.decode(R.encode(mid))!
    expect(R.hidden!.join(back, sec)).toEqual(mid)
    expect(R.hidden!.join(back, { ...sec, acts: [sec.acts[0], sec.acts[1].slice(1)] })).toBeNull()
    expect(R.hidden!.join(back, { ...sec, seeds: sec.seeds.map((s) => s + 1) })).toBeNull()
    // a secret that is real play, but from a round before the state's count
    let early = g
    while (early.done[1] < 2)
      early = R.apply(early, { acts: computerRound(early.seeds![early.done[1]], 'hard') })
    const later = R.apply(early, { acts: computerRound(early.seeds![early.done[1]], 'hard') })
    expect(R.hidden!.join(R.decode(R.encode(later))!, R.hidden!.secret(later))).toEqual(later)
    expect(R.hidden!.join(R.decode(R.encode(later))!, R.hidden!.secret(early))).toBeNull()
  })
})
