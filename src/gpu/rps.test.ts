import { describe, expect, it } from 'vitest'
import {
  EMPTY,
  MOVES,
  beats,
  flip,
  pick,
  readSaved,
  recent,
  result,
  seeded,
  type Move,
  type Round,
} from './rps'

/** play n rounds of a scripted player against the computer; the share it wins, draws and loses */
function match(player: (h: Round[], rand: () => number) => Move, n: number, seed = 1) {
  const rand = seeded(seed)
  const mine = seeded(seed * 31 + 7)
  const h: Round[] = []
  const tally = { won: 0, drawn: 0, lost: 0 }
  for (let i = 0; i < n; i++) {
    // the computer commits first, from the past only
    const { it } = pick(recent(h), rand)
    const me = player(h, mine)
    const r = result(it, me)
    if (r > 0) tally.won++
    else if (r < 0) tally.lost++
    else tally.drawn++
    h.push({ me, it })
  }
  return { won: tally.won / n, drawn: tally.drawn / n, lost: tally.lost / n }
}

describe('who beats whom', () => {
  it('rock blunts scissors, paper covers rock, scissors cut paper', () => {
    expect(result(0, 2)).toBe(1)
    expect(result(1, 0)).toBe(1)
    expect(result(2, 1)).toBe(1)
    for (const m of MOVES) {
      expect(result(m, m)).toBe(0)
      expect(result(beats(m), m)).toBe(1)
      expect(result(m, beats(m))).toBe(-1)
    }
  })
})

describe('the mind-reader', () => {
  it('cannot beat somebody who is truly random', () => {
    const r = match((_, rand) => Math.floor(rand() * 3) as Move, 3000, 4)
    // a third each, give or take what 3,000 coin-flips wander by (about ±2.6% at 3σ)
    for (const share of [r.won, r.drawn, r.lost]) {
      expect(share).toBeGreaterThan(0.3)
      expect(share).toBeLessThan(0.37)
    }
  })
  it('beats a player who always plays the same thing, almost every time', () => {
    expect(match(() => 0, 200).won).toBeGreaterThan(0.9)
  })
  it('finds a cycle, and a cycle backwards', () => {
    expect(match((h) => (h.length % 3) as Move, 300).won).toBeGreaterThan(0.8)
    expect(match((h) => ((3 - (h.length % 3)) % 3) as Move, 300).won).toBeGreaterThan(0.8)
  })
  it('finds a player who answers its last move with what would have beaten it, even a sloppy one', () => {
    // a third of the time this player does something random. ⚠️ THE NOISE IS THE POINT: a perfect
    // answerer is a fixed cycle that every guesser finds (98% with or without the one that watches
    // the computer's own last move); with noise, only that one keeps up — measured 72-74% with it
    // and 53-60% without
    const answer = (h: Round[], rand: () => number) =>
      rand() < 0.33 ? (Math.floor(rand() * 3) as Move) : h.length ? beats(h[h.length - 1].it) : 0
    for (const seed of [1, 2, 3]) expect(match(answer, 300, seed).won).toBeGreaterThan(0.65)
  })
  it('finds win-stay, lose-shift — the habit studies of real players report', () => {
    const wsls = (h: Round[]) => {
      if (!h.length) return 1 as Move
      const last = h[h.length - 1]
      return result(last.me, last.it) >= 0 ? last.me : beats(last.me)
    }
    expect(match(wsls, 300).won).toBeGreaterThan(0.6)
  })
  it('notices when a habit changes, and stops expecting the old one', () => {
    // 60 rounds of rock, then 60 of paper: over the second half it should still win most
    const r = match((h) => (h.length < 60 ? 0 : 1), 120)
    expect(r.won).toBeGreaterThan(0.75)
  })
  it('says what it expected and why, or nothing when it guessed', () => {
    const rand = seeded(2)
    expect(pick([], rand).expected).toBeNull()
    const h: Round[] = Array.from({ length: 8 }, () => ({ me: 0 as Move, it: 1 as Move }))
    const p = pick(h, rand)
    expect(p.expected).toBe(0)
    expect(p.it).toBe(1)
    expect(p.reason).toBe('you play rock most')
  })
})

describe('the coin', () => {
  it('comes down heads half the time', () => {
    const rand = seeded(9)
    let heads = 0
    for (let i = 0; i < 10000; i++) if (flip(rand) === 'heads') heads++
    expect(heads / 10000).toBeGreaterThan(0.485)
    expect(heads / 10000).toBeLessThan(0.515)
  })
})

describe('rps saves', () => {
  it('round-trips every field set away from its default, and drops each alone', () => {
    const s = {
      matchesWon: 3,
      matchesLost: 5,
      won: 61,
      lost: 70,
      drawn: 40,
      streak: 7,
      calls: 50,
      right: 27,
    }
    expect(readSaved(JSON.stringify(s))).toEqual(s)
    for (const k of Object.keys(s) as (keyof typeof s)[]) {
      const rest: Record<string, unknown> = { ...s }
      delete rest[k]
      const back = readSaved(JSON.stringify(rest))
      // without the calls, right calls cannot outnumber them, so they fall to zero too
      expect(back[k], k).toBe(EMPTY[k])
      for (const j of Object.keys(s) as (keyof typeof s)[])
        if (j !== k && !(k === 'calls' && j === 'right')) expect(back[j], `${k}→${j}`).toBe(s[j])
    }
  })
  it('a broken store loses only what is bad', () => {
    expect(readSaved('nope')).toEqual(EMPTY)
    expect(readSaved(JSON.stringify({ won: 2.5, lost: -1, drawn: 4 }))).toEqual({
      ...EMPTY,
      drawn: 4,
    })
  })
})
