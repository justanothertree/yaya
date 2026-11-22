import { afterEach, describe, expect, it, vi } from 'vitest'
import { discard, peg, show, type Round } from './cribbage'
import { cribRules as R, whoseMove, type CribGame, type CribMove } from './cribbageRoom'

afterEach(() => vi.restoreAllMocks())
function seeded(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}
/* a show counted here, not by the toy: ranks ace-low 1..13, court cards ten */
const rk = (c: number) => (c >> 2 === 12 ? 1 : (c >> 2) + 2)
const val = (c: number) => Math.min(10, rk(c))
const st = (c: number) => c & 3
function showOf(hand: number[], starter: number, crib: boolean) {
  const all = [...hand, starter]
  let n = 0
  for (let mask = 1; mask < 32; mask++) {
    let t = 0
    for (let i = 0; i < 5; i++) if (mask & (1 << i)) t += val(all[i])
    if (t === 15) n += 2
  }
  for (let i = 0; i < 5; i++) for (let j = i + 1; j < 5; j++) if (rk(all[i]) === rk(all[j])) n += 2
  // runs: the longest length with any, counted once for every way of making it
  for (let len = 5; len >= 3; len--) {
    let found = 0
    for (let mask = 1; mask < 32; mask++) {
      const pick = all.filter((_, i) => mask & (1 << i))
      if (pick.length !== len) continue
      const r = pick.map(rk).sort((a, b) => a - b)
      if (r.every((x, i) => i === 0 || x === r[i - 1] + 1)) found++
    }
    if (found) {
      n += found * len
      break
    }
  }
  if (hand.every((c) => st(c) === st(hand[0]))) n += st(starter) === st(hand[0]) ? 5 : crib ? 0 : 4
  if (hand.some((c) => rk(c) === 11 && st(c) === st(starter))) n += 1
  return n
}

/** a server's game, every move the computer's at these levels */
function playOut(seed: number, levels: [string, string]) {
  const rnd = seeded(seed)
  vi.spyOn(Math, 'random').mockImplementation(rnd)
  let g = R.hidden!.accept(R.fresh(), null, 'versus')!
  const moments: CribGame[] = []
  for (let k = 0; k < 4000 && whoseMove(g) !== null; k++) {
    const s = whoseMove(g)!
    const m = R.computer!.choose(g, levels[s]) as CribMove
    expect(R.legal(g, m, s)).toBe(true)
    g = R.roll(R.apply(g, m), rnd)
    if (k % 11 === 3) moments.push(g)
  }
  vi.restoreAllMocks()
  expect(whoseMove(g)).toBeNull()
  return { g, moments }
}
/** a laid hand put through the toy up to its show: the scores before the show */
function toShow(h: CribGame['past'][number], scores: [number, number]): Round {
  let r: Round = {
    dealer: h.dealer,
    hands: [
      [...h.kept[0], ...h.crib.slice(0, 2)],
      [...h.kept[1], ...h.crib.slice(2)],
    ],
    kept: [[], []],
    crib: [],
    starter: h.starter,
    phase: 'discard',
    pile: [],
    played: [],
    turn: h.dealer === 0 ? 1 : 0,
    scores,
    winner: null,
    said: '',
  }
  r = discard(r, [h.crib[0], h.crib[1]], [h.crib[2], h.crib[3]])
  for (const p of h.played) r = peg(r, p.card)
  return r
}

describe('cribbage by turns: hands kept back until the show', () => {
  it('deals with the yes: six each, the starter uncut, the challenger to throw first', () => {
    const g = R.hidden!.accept(R.fresh(), null, 'versus')!
    expect(g.r.hands[0]).toHaveLength(6)
    expect(g.r.hands[1]).toHaveLength(6)
    expect(g.r.dealer).toBe(1)
    expect(whoseMove(g)).toBe(0)
    const wire = R.encode(g) as Record<string, unknown>
    expect(wire.starter).toBeNull()
    expect(JSON.stringify(wire)).not.toMatch(/hands|kept|crib/)
    expect(R.hidden!.mine(g, 0)).toEqual({ hand: g.r.hands[0], kept: null, thrown: null })
  })

  it('seals the first throw until the dealer’s, then cuts the starter; the history never names a throw', () => {
    let g = R.hidden!.accept(R.fresh(), null, 'versus')!
    const a = g.r.hands[0].slice(0, 2) as [number, number]
    expect(R.legal(g, { throw: [g.r.hands[1][0], g.r.hands[1][1]] }, 0)).toBe(false)
    expect(R.legal(g, { throw: a }, 1)).toBe(false)
    g = R.apply(g, { throw: a })
    expect(g.thrown).toEqual([true, false])
    expect(g.r.phase).toBe('discard')
    expect(JSON.stringify(R.encode(g))).not.toContain(`[${a[0]},${a[1]}]`)
    expect((R.hidden!.mine(g, 0) as { thrown: number[] }).thrown).toEqual(a)
    expect((R.hidden!.mine(g, 1) as { thrown: unknown }).thrown).toBeNull()
    expect(R.hidden!.logged({ throw: a })).toEqual({ throw: 'face down' })
    g = R.apply(g, { throw: [g.r.hands[1][0], g.r.hands[1][1]] })
    expect(g.r.phase).toBe('peg')
    expect(g.r.crib.slice(0, 2)).toEqual(a)
    expect((R.encode(g) as { starter: number }).starter).toBe(g.r.starter)
    expect(whoseMove(g)).toBe(0)
  })

  it('plays whole games to 121, every show adding what it counts here', () => {
    const winners = new Set<string>()
    let shows = 0
    for (let seed = 1; seed <= 8; seed++) {
      const { g } = playOut(seed, [
        ['easy', 'fair', 'hard'][seed % 3],
        ['hard', 'easy', 'fair'][seed % 3],
      ])
      let scores: [number, number] = [0, 0]
      g.past.forEach((h, k) => {
        const before = toShow(h, scores)
        expect(before.phase).toBe('show')
        const pone = h.dealer === 0 ? 1 : 0
        const want: [number, number] = [...before.scores]
        want[pone] += showOf(h.kept[pone], h.starter, false)
        want[h.dealer] +=
          showOf(h.kept[h.dealer], h.starter, false) + showOf(h.crib, h.starter, true)
        const after = show(before).scores
        if (k < g.past.length - 1 || Math.max(...want) < 121) {
          // a hand that did not end the game: its show adds up in full, as counted here
          expect(after).toEqual(want)
          shows++
        }
        scores = after
      })
      expect(Math.max(...g.r.scores)).toBe(121)
      expect(R.result!(g)).toBe(g.r.winner)
      winners.add(String(g.r.winner))
    }
    expect(shows).toBeGreaterThan(20)
    expect(winners).toEqual(new Set(['0', '1']))
  })

  it('travels and comes back as it was, mid-throw and mid-pegging, every field', () => {
    const { moments } = playOut(4, ['hard', 'fair'])
    const throwing = moments.filter(
      (m) => m.past.length > 0 && m.thrown.filter(Boolean).length === 1,
    )
    const pegging = moments.filter(
      (m) =>
        m.past.length > 0 && m.r.phase === 'peg' && m.r.played.length > 0 && m.r.pile.length > 0,
    )
    expect(throwing.length).toBeGreaterThan(0)
    expect(pegging.length).toBeGreaterThan(0)
    for (const m of [...throwing, ...pegging]) {
      const back = R.decode(JSON.parse(JSON.stringify(R.encode(m))))!
      expect(back).not.toBeNull()
      const j = R.hidden!.join(back, JSON.parse(JSON.stringify(R.hidden!.secret(m))))!
      expect(j).not.toBeNull()
      expect(j.past).toEqual(m.past)
      expect(j.thrown).toEqual(m.thrown)
      expect(j.throws).toEqual(m.throws)
      for (const k of [
        'dealer',
        'hands',
        'phase',
        'pile',
        'played',
        'turn',
        'scores',
        'winner',
        'starter',
      ] as const)
        expect(j.r[k]).toEqual(m.r[k])
      if (m.r.phase === 'peg')
        for (const k of ['kept', 'crib'] as const) expect(j.r[k]).toEqual(m.r[k])
    }
  })

  it('refuses a hand its cards could not have played, scores it did not make, and cards shown early', () => {
    const { moments } = playOut(6, ['fair', 'fair'])
    const m = moments.find(
      (x) => x.past.length > 1 && x.r.phase === 'peg' && x.r.played.length > 1,
    )!
    const w = R.encode(m) as Record<string, unknown> & { past: CribGame['past']; scores: number[] }
    // two cards of a finished hand pegged in the other order, a card in the crib twice
    const swapped = w.past.map((h, k) =>
      k === 0 ? { ...h, played: [h.played[1], h.played[0], ...h.played.slice(2)] } : h,
    )
    expect(R.decode({ ...w, past: swapped })).toBeNull()
    // the right cards in the right order, one of them put down to the wrong player
    const misnamed = w.past.map((h, k) =>
      k === 0
        ? { ...h, played: h.played.map((p, i) => (i === 0 ? { ...p, by: 1 - p.by } : p)) }
        : h,
    )
    expect(R.decode({ ...w, past: misnamed })).toBeNull()
    const twice = w.past.map((h, k) =>
      k === 0 ? { ...h, crib: [h.crib[0], h.crib[0], h.crib[2], h.crib[3]] } : h,
    )
    expect(R.decode({ ...w, past: twice })).toBeNull()
    // the starter shown before the throw, a score below what the counted hands make
    expect(R.decode({ ...w, phase: 'discard', played: [], pile: [] })).toBeNull()
    expect(R.decode({ ...w, scores: [0, 0] })).toBeNull()
    // a point the hand in play did not peg: only the server, replaying it, can tell
    const back = R.decode({ ...w, scores: [w.scores[0] + 1, w.scores[1]] })!
    expect(back).not.toBeNull()
    expect(R.hidden!.join(back, R.hidden!.secret(m))).toBeNull()
    expect(R.hidden!.join(R.decode(w)!, R.hidden!.secret(m))).not.toBeNull()
    // and a secret whose hand is not the one pegged from
    const sec = R.hidden!.secret(m) as { hands: number[][] }
    const other = { ...sec, hands: [sec.hands[1], sec.hands[0]] }
    expect(R.hidden!.join(R.decode(w)!, other)).toBeNull()
    expect(R.readMove({ throw: [3, 3] })).toBeNull()
    expect(R.readMove({ peg: 52 })).toBeNull()
    expect(R.readMove({ peg: 4, throw: [1, 2] })).toBeNull()
  })

  it('the computer reads only its own cards and the table: swap the other side’s, same choice', () => {
    for (const level of ['easy', 'fair', 'hard'])
      for (let seed = 1; seed <= 6; seed++) {
        const { moments } = playOut(seed + 30, ['fair', 'fair'])
        for (const m of moments.filter((x) => whoseMove(x) === 1).slice(0, 4)) {
          const r = m.r
          let other: CribGame
          if (r.phase === 'discard') {
            // the other hand and the uncut starter trade places: none of it is the computer's to see
            const pool = [...r.hands[0], r.starter].reverse()
            other = {
              ...m,
              r: {
                ...r,
                hands: [pool.slice(0, r.hands[0].length), r.hands[1]],
                starter: pool[pool.length - 1],
              },
            }
          } else {
            // the other side's unplayed cards and its two in the crib trade places
            const pool = [...r.hands[0], ...r.crib.slice(0, 2)].reverse()
            other = {
              ...m,
              r: {
                ...r,
                hands: [pool.slice(0, r.hands[0].length), r.hands[1]],
                crib: [...pool.slice(r.hands[0].length), ...r.crib.slice(2)],
              },
            }
          }
          const ask = (x: CribGame) => {
            vi.spyOn(Math, 'random').mockImplementation(seeded(seed * 5))
            const a = R.computer!.choose(x, level)
            vi.restoreAllMocks()
            return a
          }
          expect(ask(other), `${level} ${seed} ${r.phase}`).toEqual(ask(m))
        }
      }
  })
})
