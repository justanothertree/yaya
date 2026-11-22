import { afterEach, describe, expect, it, vi } from 'vitest'
import { choices, decide, rank, STYLES, type Action } from './poker'
import { holdemRules as R, replayPublic, shuffleOf, whoseMove, type HoldemGame } from './holdemRoom'

afterEach(() => vi.restoreAllMocks())
function seeded(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}
const styles = { easy: STYLES.rock, fair: STYLES.wild, hard: STYLES.steady } as const
/** a server's match, both seats played by the toy's own players, cheaply */
function playOut(seed: number, levels: [keyof typeof styles, keyof typeof styles]) {
  const rnd = seeded(seed)
  vi.spyOn(Math, 'random').mockImplementation(rnd)
  let g = R.hidden!.accept(R.fresh(), null, 'versus')!
  const moments: HoldemGame[] = []
  const totals: number[] = []
  /** each hand finished by a decision, with what it did to each stack */
  const hands: { shown: (number[] | null)[]; board: number[]; delta: number[] }[] = []
  let start = g.t.seats.map((x) => x.chips + x.put)
  for (let k = 0; k < 4000 && whoseMove(g) !== null; k++) {
    const s = whoseMove(g)!
    const m: Action = decide(g.t, styles[levels[s]], rnd, 40)
    expect(R.legal(g, m, s), JSON.stringify(m)).toBe(true)
    const before = g.past.length
    g = R.apply(g, m)
    if (g.past.length > before) {
      const h = g.past[g.past.length - 1]
      hands.push({ ...h, delta: g.t.seats.map((x, i) => x.chips - start[i]) })
    }
    g = R.roll(g, rnd)
    if (g.cur.actions.length === 0) start = g.t.seats.map((x) => x.chips + x.put)
    totals.push(g.t.seats.reduce((a, x) => a + x.chips + x.put, 0))
    if (k % 4 === 1) moments.push(g)
  }
  vi.restoreAllMocks()
  expect(whoseMove(g)).toBeNull()
  return { g, moments, totals, hands }
}

describe('hold’em by turns: the deck and the hole cards kept back', () => {
  it('can make the toy’s own shuffle deal any deck, card for card', () => {
    const rnd = seeded(3)
    for (let k = 0; k < 50; k++) {
      const target = Array.from({ length: 52 }, (_, i) => i).sort(() => rnd() - 0.5)
      expect(shuffleOf(target)).toEqual(target)
    }
  })

  it('deals with the yes: two each, the blinds posted, nothing of either hand or the deck travelling', () => {
    const g = R.hidden!.accept(R.fresh(), null, 'versus')!
    expect(g.t.seats[0].hole).toHaveLength(2)
    expect(g.t.seats[1].hole).toHaveLength(2)
    expect(g.t.seats[0].put + g.t.seats[1].put).toBe(30)
    expect(JSON.stringify(R.encode(g))).not.toMatch(/hole|deck/)
    expect(R.hidden!.mine(g, 0, 0)).toEqual(g.t.seats[0].hole)
    // and what a browser makes of what travels is the same table, but for the cards
    const back = R.decode(JSON.parse(JSON.stringify(R.encode(g))))!
    for (const k of [
      'board',
      'street',
      'toAct',
      'current',
      'minRaise',
      'dealer',
      'big',
      'small',
      'hand',
    ] as const)
      expect(back.t[k]).toEqual(g.t[k])
    expect(back.t.seats.map((s) => [s.chips, s.bet, s.put, s.folded])).toEqual(
      g.t.seats.map((s) => [s.chips, s.bet, s.put, s.folded]),
    )
  })

  it('takes only the decisions the toy offers, exactly: no folding what could be checked, no odd raises', () => {
    const g = R.hidden!.accept(R.fresh(), null, 'versus')!
    const s = whoseMove(g)!
    const c = choices(g.t)
    expect(R.legal(g, { kind: 'check' }, s)).toBe(c.canCheck)
    expect(R.legal(g, { kind: 'call' }, s)).toBe(!c.canCheck)
    expect(R.legal(g, { kind: 'raise', to: c.minTo }, s)).toBe(true)
    expect(R.legal(g, { kind: 'raise', to: c.minTo - 1 }, s)).toBe(false)
    expect(R.legal(g, { kind: 'raise', to: c.maxTo + 1 }, s)).toBe(false)
    expect(R.legal(g, { kind: 'call' }, (1 - s) as 0 | 1)).toBe(false)
  })

  it('refuses a fold where a check is free, live and in a record', () => {
    const { moments } = playOut(7, ['fair', 'easy'])
    const free = moments.filter((x) => whoseMove(x) !== null && choices(x.t).canCheck)
    expect(free.length).toBeGreaterThan(0)
    for (const m of free.slice(0, 5)) {
      expect(R.legal(m, { kind: 'fold' }, whoseMove(m)!)).toBe(false)
      const w = R.encode(m) as { cur: { actions: Action[]; board: number[] } }
      expect(
        R.decode({ ...w, cur: { ...w.cur, actions: [...w.cur.actions, { kind: 'fold' }] } }),
      ).toBeNull()
    }
  })

  it('plays whole matches: no chip made or lost, every showdown paid to the better hand, the last with chips wins', () => {
    const winners = new Set<string>()
    let showdowns = 0
    for (let seed = 1; seed <= 6; seed++) {
      const { g, totals, hands } = playOut(seed, [
        (['easy', 'fair', 'hard'] as const)[seed % 3],
        (['hard', 'easy', 'fair'] as const)[seed % 3],
      ])
      expect(totals.every((n) => n === 2000)).toBe(true)
      for (const h of hands) {
        if (!h.shown[0] || !h.shown[1]) continue
        showdowns++
        expect(h.board).toHaveLength(5)
        const [a, b] = [rank([...h.shown[0], ...h.board]), rank([...h.shown[1], ...h.board])]
        // the better hand took what it could win, the worse lost what it put in, a tie moved nothing
        if (a === b) expect(h.delta).toEqual([0, 0])
        else {
          const w = a > b ? 0 : 1
          expect(h.delta[w]).toBeGreaterThan(0)
          expect(h.delta[1 - w]).toBe(-h.delta[w])
        }
      }
      const chips = g.t.seats.map((s) => s.chips)
      expect(chips[0] + chips[1]).toBe(2000)
      expect(Math.min(...chips)).toBe(0)
      winners.add(String(R.result!(g)))
      // each showdown in the record, ranked again, paid the better hand — played through again from
      // the record by a browser, the stacks come out as the server's
      const back = R.decode(JSON.parse(JSON.stringify(R.encode(g))))!
      expect(back.t.seats.map((s) => s.chips)).toEqual(chips)
    }
    expect(showdowns).toBeGreaterThan(5)
    expect(winners).toEqual(new Set(['0', '1']))
  }, 120000)

  it('travels and comes back as it was, mid-hand, every field', () => {
    const { moments } = playOut(4, ['fair', 'hard'])
    const busy = moments.filter(
      (m) => m.past.length > 0 && m.cur.actions.length > 0 && m.t.street !== 'done',
    )
    expect(busy.length).toBeGreaterThan(0)
    for (const m of busy.slice(0, 8)) {
      const back = R.decode(JSON.parse(JSON.stringify(R.encode(m))))!
      expect(back).not.toBeNull()
      const j = R.hidden!.join(back, JSON.parse(JSON.stringify(R.hidden!.secret(m))))!
      expect(j).not.toBeNull()
      expect(j.past).toEqual(m.past)
      expect(j.cur).toEqual(m.cur)
      expect(j.t).toEqual(m.t)
      expect(back.lastBy).toEqual(m.lastBy)
      expect(back.lastBy).not.toBeNull()
    }
  }, 60000)

  it('refuses a decision the toy did not offer, a showdown with its cards missing, and a deck that is not one', () => {
    const { moments } = playOut(5, ['fair', 'fair'])
    const m = moments.find(
      (x) => x.past.some((h) => h.shown[0]) && x.cur.actions.length > 0 && x.t.street !== 'done',
    )!
    const w = R.encode(m) as {
      past: { actions: Action[]; board: number[]; shown: (number[] | null)[] }[]
      cur: { actions: Action[]; board: number[] }
    }
    const sd = w.past.findIndex((h) => h.shown[0])
    // a showdown with one player's cards taken away
    expect(
      R.decode({
        ...w,
        past: w.past.map((h, i) => (i === sd ? { ...h, shown: [null, h.shown[1]] } : h)),
      }),
    ).toBeNull()
    // a hand's first decision swapped for a raise of one chip more than everything
    const raised = w.past.map((h, i) =>
      i === 0
        ? { ...h, actions: [{ kind: 'raise' as const, to: 1_000_000 }, ...h.actions.slice(1)] }
        : h,
    )
    expect(R.decode({ ...w, past: raised })).toBeNull()
    // a card on the board that is also in a hand shown
    const twice = w.past.map((h, i) =>
      i === sd ? { ...h, board: [h.shown[0]![0], ...h.board.slice(1)] } : h,
    )
    expect(R.decode({ ...w, past: twice })).toBeNull()
    expect(
      replayPublic({
        ...w,
        cur: {
          ...w.cur,
          actions: [...w.cur.actions, { kind: 'fold' }, { kind: 'fold' }, { kind: 'fold' }],
        },
      }),
    ).toBeNull()
    const back = R.decode(w)!
    const sec = R.hidden!.secret(m) as { holes: number[][]; deck: number[] }
    expect(R.hidden!.join(back, sec)).not.toBeNull()
    expect(
      R.hidden!.join(back, { ...sec, deck: [...sec.deck.slice(1), sec.holes[0][0]] }),
    ).toBeNull()
    expect(R.readMove({ kind: 'raise', to: 2.5 })).toBeNull()
    expect(R.readMove({ kind: 'allin' })).toBeNull()
  }, 60000)

  it('the computer reads only its own two cards and the board: deal the other pair otherwise, same decision', () => {
    for (const level of ['easy', 'fair', 'hard'])
      for (let seed = 1; seed <= 4; seed++) {
        const { moments } = playOut(seed + 30, ['fair', 'fair'])
        for (const m of moments
          .filter((x) => x.t.street !== 'done' && x.t.toAct === 1)
          .slice(0, 3)) {
          const seen = new Set([...m.t.seats[1].hole, ...m.t.board])
          const others = Array.from({ length: 52 }, (_, c) => c).filter(
            (c) => !seen.has(c) && !m.t.seats[0].hole.includes(c),
          )
          const t2 = structuredClone(m.t)
          t2.seats[0].hole = others.slice(seed, seed + 2)
          const ask = (x: HoldemGame) => {
            vi.spyOn(Math, 'random').mockImplementation(seeded(seed * 3))
            const a = R.computer!.choose(x, level)
            vi.restoreAllMocks()
            return a
          }
          expect(ask({ ...m, t: t2 }), `${level} ${seed}`).toEqual(ask(m))
        }
      }
  }, 120000)
})
