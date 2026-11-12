import { describe, expect, it } from 'vitest'
import { card } from './poker'
import {
  EMPTY,
  TARGET,
  canPlay,
  chooseDiscard,
  choosePeg,
  deal,
  discard,
  match,
  parts,
  peg,
  pegScore,
  readSaved,
  score,
  show,
  type Round,
  type Saved,
} from './cribbage'

/** cards written the poker way: 5h, Js, Td, Ac */
const cs = (s: string) => s.split(' ').map(card)

describe('counting a hand', () => {
  it('counts the best hand there is as 29', () => {
    // three fives and the jack of spades, with the five of spades cut
    expect(score(cs('5h 5c 5d Js'), card('5s'))).toBe(29)
  })
  it('counts fifteens, pairs and a double run', () => {
    // 4 5 5 6 with a ten cut: runs 4-5-6 twice (6), the pair (2), 4+5+6 twice and 5+10 twice (8)
    expect(score(cs('4s 5h 5c 6d'), card('Ts'))).toBe(16)
    const kinds = parts(cs('4s 5h 5c 6d'), card('Ts')).map((p) => p.what)
    expect(kinds.filter((k) => k === 'run')).toHaveLength(2)
    expect(kinds.filter((k) => k === 'fifteen')).toHaveLength(4)
  })
  it('counts the ace low and the court cards as ten', () => {
    // A 2 3 is a run; K Q J is a run; K+5 is fifteen
    expect(score(cs('As 2h 3c 9d'), card('8s'))).toBe(3 + 2) // run of three, and 9+3+2+A = 15
    expect(score(cs('Ks Qh Jc 2d'), card('7s'))).toBe(3)
    expect(score(cs('Ks 5h 8c 2d'), card('9s'))).toBe(4) // K+5 and 5+8+2
  })
  it('scores a flush of four in the hand but needs five in the crib', () => {
    const hand = cs('2h 4h 6h 8h')
    expect(score(hand, card('Ks'))).toBe(4)
    expect(score(hand, card('Ks'), true)).toBe(0)
    expect(score(hand, card('Qh'))).toBe(5)
    expect(score(hand, card('Qh'), true)).toBe(5)
  })
  it('gives his nobs for the jack of the starter’s suit', () => {
    // a hand with nothing else in it: no fifteen, pair, run or flush
    expect(score(cs('Jd 7s 9c Kh'), card('Ad'))).toBe(1)
    expect(score(cs('Jd 7s 9c Kh'), card('Ac'))).toBe(0)
  })
})

describe('the pegging', () => {
  const peg1 = (s: string) => pegScore(cs(s))
  it('scores fifteen, thirty-one, pairs and runs as each card goes down', () => {
    expect(peg1('5h Ts').points).toBe(2)
    expect(peg1('7h 7s').points).toBe(2)
    expect(peg1('7h 7s 7c').points).toBe(6)
    expect(peg1('7h 7s 7c 7d').points).toBe(12)
    expect(peg1('3h 5s 4c').points).toBe(3)
    expect(peg1('3h 5s 4c 6d').points).toBe(4) // a run of four, in any order; the count is 18
    expect(peg1('Th Ts Tc As').points).toBe(2) // thirty-one
    expect(peg1('2h 3s 2c').points).toBe(0) // a pair broken by a card is no pair
  })
  /** a hand already discarded, with the given cards left to peg and the count so far */
  const pegging = (mine: string, theirs: string, pile: string, turn: 0 | 1): Round => ({
    ...deal(1, 0),
    hands: [mine ? cs(mine) : [], theirs ? cs(theirs) : []],
    kept: [cs('2s 3s 4s 5s'), cs('2h 3h 4h 5h')],
    phase: 'peg',
    pile: pile ? cs(pile) : [],
    turn,
    scores: [0, 0],
  })
  it('gives a go to the last to play when neither side can, and the other side leads again', () => {
    // the count is 21; the computer plays a five for 26; you hold a king and cannot follow,
    // and its two would make 28 — so it plays on, then neither can and it pegs one for the go
    let r = pegging('Ks', '5h 2c', 'Th As Ts', 1)
    r = peg(r, card('5h'))
    expect(r.turn).toBe(1) // you said go; it plays on
    r = peg(r, card('2c'))
    expect(r.scores[1]).toBe(1)
    expect(r.said).toContain('go')
    expect(r.pile).toEqual([])
    expect(r.turn).toBe(0)
    expect(canPlay(r, 0)).toEqual([card('Ks')])
  })
  it('pegs the go for you when your own card was the last that fitted', () => {
    // 28 on the table: your two makes 30, the computer's four would make 34, and your nine 39
    let r = pegging('9s 2d', '4h', 'Th Ts 8c', 0)
    r = peg(r, card('2d'))
    expect(r.scores[0]).toBe(1)
    expect(r.pile).toEqual([])
    expect(r.turn).toBe(1) // the computer leads the new count
  })
  it('scores thirty-one as two and nothing more, then the other side leads', () => {
    let r = pegging('As 9c', '4h', 'Th Ts Tc', 0)
    r = peg(r, card('As'))
    expect(r.scores[0]).toBe(2)
    expect(r.pile).toEqual([])
    expect(r.turn).toBe(1)
  })
  it('pegs one for the last card, then it is time for the show', () => {
    let r = pegging('', '4h', 'Th', 1)
    r = peg(r, card('4h'))
    expect(r.scores[1]).toBe(1)
    expect(r.phase).toBe('show')
  })
  it('refuses a card that would pass thirty-one, or one that is not yours', () => {
    const r = pegging('Ks 2c', '4h', 'Th Ts 2s', 0) // 22: the king would make 32
    expect(peg(r, card('Ks'))).toBe(r)
    expect(peg(r, card('4h'))).toBe(r) // the computer's card, on your turn
    expect(peg(r, card('2c'))).not.toBe(r)
  })
})

describe('a hand from deal to show', () => {
  it('turns a jack starter into two for the dealer', () => {
    let seed = 0
    let r = deal(seed, 1)
    while (r.starter >> 2 !== 9) r = deal(++seed, 1) // poker ranks: 9 is the jack
    const after = discard(r, [r.hands[0][0], r.hands[0][1]], [r.hands[1][0], r.hands[1][1]])
    expect(after.scores).toEqual([0, 2])
    expect(after.crib).toHaveLength(4)
    expect(after.hands[0]).toHaveLength(4)
  })
  it('counts the side that did not deal first, and stops at 121', () => {
    const r: Round = {
      ...deal(3, 1),
      phase: 'show',
      kept: [cs('5h 5c 5d Js'), cs('5s Th Tc Kd')],
      crib: cs('2s 3s 4s 6s'),
      starter: card('Qs'),
      scores: [110, 115],
    }
    const done = show(r)
    expect(done.winner).toBe(0)
    expect(done.scores[0]).toBe(TARGET)
    expect(done.scores[1]).toBe(115) // the dealer never got to count
    expect(done.phase).toBe('over')
    // and counting twice does nothing
    const plain = show({ ...r, scores: [0, 0] })
    expect(plain.phase).toBe('done')
    expect(show(plain)).toBe(plain)
  })
  it('refuses a discard of cards you do not hold', () => {
    const r = deal(4, 0)
    expect(discard(r, [r.hands[1][0], r.hands[1][1]], [r.hands[1][2], r.hands[1][3]])).toBe(r)
  })
})

describe('the computer', () => {
  it('throws two of its own cards and pegs only what it may', () => {
    for (let s = 0; s < 20; s++) {
      let r = deal(s, (s & 1) as 0 | 1)
      for (const lv of ['easy', 'fair', 'hard'] as const) {
        const d = chooseDiscard(r, 1, lv)
        expect(new Set(d).size).toBe(2)
        expect(d.every((c) => r.hands[1].includes(c))).toBe(true)
      }
      r = discard(r, chooseDiscard(r, 0, 'fair'), chooseDiscard(r, 1, 'hard'))
      while (r.phase === 'peg') {
        const c = choosePeg(r, r.turn === 0 ? 'fair' : 'hard')
        expect(canPlay(r, r.turn)).toContain(c)
        r = peg(r, c)
      }
      expect(['show', 'over']).toContain(r.phase)
    }
  })
  it('keeps the four that score best: never breaks up a 29', () => {
    const r: Round = { ...deal(5, 1), hands: [cs('2c 7d 9h Kc 3s 8d'), cs('5h 5c 5d Js 9c Kh')] }
    const thrown = chooseDiscard(r, 1, 'fair')
    expect(thrown.sort()).toEqual([card('9c'), card('Kh')].sort())
  })
  it('is stronger level by level, from both seats', () => {
    /** the share of games won and the average winning margin, playing each seed from both chairs */
    const play = (a: 'easy' | 'fair' | 'hard', b: 'easy' | 'fair' | 'hard', n: number) => {
      let won = 0
      let margin = 0
      for (let s = 0; s < n; s++) {
        const x = match(a, b, 2 * s + 1)
        const y = match(b, a, 2 * s + 2)
        won += (x.winner === 0 ? 1 : 0) + (y.winner === 1 ? 1 : 0)
        margin += x.scores[0] - x.scores[1] + y.scores[1] - y.scores[0]
      }
      return { won: won / (2 * n), margin: margin / (2 * n) }
    }
    expect(play('fair', 'easy', 15).won).toBeGreaterThan(0.8)
    // Cribbage is mostly the cards, so a hundred games is a noisy count of wins: Hard won 55% of
    // these and 61% and 65.5% of two hundred others. The MARGIN is the steadier reading — +4.2
    // points a game here, against -3.6 for a Hard that pegs at random, which is what this test
    // is for — so it is asked about both.
    const hard = play('hard', 'fair', 50)
    expect(hard.margin).toBeGreaterThan(1.5)
    expect(hard.won).toBeGreaterThan(0.5)
  }, 60_000)
})

describe('what is kept', () => {
  it('round-trips every field that is not a default', () => {
    const s: Saved = {
      level: 'hard',
      board: 'mint',
      spell: false,
      record: {
        easy: { won: 3, lost: 1, skunks: 1, best: 12 },
        fair: { won: 2, lost: 5, skunks: 0, best: 24 },
        hard: { won: 1, lost: 7, skunks: 2, best: 29 },
      },
    }
    for (const k of Object.keys(s) as (keyof Saved)[]) expect(s[k]).not.toEqual(EMPTY[k])
    expect(readSaved(JSON.stringify(s))).toEqual(s)
  })
  it('falls back on anything it does not recognise, and no hand is over 29', () => {
    expect(readSaved('nope')).toEqual(EMPTY)
    expect(readSaved(JSON.stringify({ record: { hard: { best: 31 } } })).record.hard.best).toBe(29)
  })
})
