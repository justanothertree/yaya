import { describe, expect, it } from 'vitest'
import {
  EMPTY,
  PASS,
  QUEEN,
  TWO_CLUBS,
  chooseCard,
  choosePass,
  deal,
  handOver,
  legal,
  passTo,
  playCard,
  points,
  readSaved,
  score,
  startHand,
  winnerOf,
  type Hand,
  type Level,
} from './hearts'
import { card } from './poker'
import { rng } from './bricks'

/** a hand with these cards, the trick so far, and whose turn */
const at = (hands: string[][], extra: Partial<Hand> = {}): Hand => ({
  ...startHand(
    hands.map((h) => h.map(card)),
    null,
    'hold',
  ),
  ...extra,
})

describe('the deal and the pass', () => {
  it('thirteen each, every card once; three passed to the right seat; the two of clubs leads', () => {
    const hs = deal(rng(4))
    expect(hs.every((h) => h.length === 13)).toBe(true)
    expect(new Set(hs.flat()).size).toBe(52)
    for (const way of PASS) {
      const passed = hs.map((h) => h.slice(0, 3))
      const h = startHand(hs, passed, way)
      for (let i = 0; i < 4; i++) {
        expect(h.hands[i]).toHaveLength(13)
        if (way !== 'hold') for (const c of passed[i]) expect(h.hands[passTo(i, way)]).toContain(c)
      }
      expect(h.hands[h.leader]).toContain(TWO_CLUBS)
    }
  })
})

describe('the rules of play', () => {
  it('the first lead is the two of clubs, and a suit must be followed', () => {
    const h = at([
      ['2c', '3c', 'Ah'],
      ['4c', 'Kd', 'Qs'],
      ['5d', '6h', '7s'],
      ['8c', '9c', 'Td'],
    ])
    expect(legal(h)).toEqual([TWO_CLUBS])
    const after = playCard(h, TWO_CLUBS)
    expect(legal(after)).toEqual([card('4c')])
  })
  it('no points on the first trick when anything else can be played', () => {
    let h = at([['2c', '3d'], ['Qs', 'Ah', '5d'], ['6d'], ['7d']])
    h = playCard(h, TWO_CLUBS)
    expect(legal(h).sort()).toEqual([card('5d')])
  })
  it('hearts are not led until broken, unless hearts are all you hold', () => {
    const base = { tricks: 3, leader: 0, turn: 0 }
    expect(legal(at([['2h', '3d'], [], [], []], base))).toEqual([card('3d')])
    expect(legal(at([['2h', '5h'], [], [], []], base)).sort()).toEqual(
      [card('2h'), card('5h')].sort(),
    )
    expect(legal(at([['2h', '3d'], [], [], []], { ...base, broken: true })).length).toBe(2)
  })
  it('the highest card of the suit led takes the trick; another suit never does', () => {
    const t = [
      { seat: 0, card: card('5d') },
      { seat: 1, card: card('Ah') },
      { seat: 2, card: card('9d') },
      { seat: 3, card: card('2d') },
    ]
    expect(winnerOf(t)).toBe(2)
  })
  it('a hand takes 26 points in all, and one player taking them all puts 26 on everyone else', () => {
    for (let k = 0; k < 40; k++) {
      const rand = rng(k)
      let h = startHand(deal(rand), null, 'hold')
      while (!handOver(h)) h = playCard(h, chooseCard(h, 'easy', rand))
      expect(h.played).toHaveLength(52)
      expect(new Set(h.played).size).toBe(52)
      const s = score(h)
      expect([26, 78]).toContain(s.reduce((a, x) => a + x, 0))
    }
    const moon: Hand = {
      ...at([[], [], [], []]),
      tricks: 13,
      taken: [[...Array(13)].map((_, r) => r * 4 + 1).concat([QUEEN]), [], [], []],
    }
    expect(score(moon)).toEqual([0, 26, 26, 26])
    expect(points(QUEEN)).toBe(13)
  })
})

describe('the computer', () => {
  it('passes the queen of spades when it holds few spades', () => {
    const hand = ['Qs', '3s', 'Ah', 'Kh', '2c', '3c', '4c', '5c', '6d', '7d', '8d', '9d', 'Td'].map(
      card,
    )
    expect(choosePass(hand, 'fair')).toContain(QUEEN)
  })
  // measured over 400 and 200 hands, one seat at the level, three below it: fair took 2.3 points a
  // hand against easy's 8.2; hard took 5.2 against fair's 7.5
  it('each level takes fewer points than the level below it at the same table', () => {
    const run = (hi: Level, lo: Level, hands: number) => {
      let me = 0
      let them = 0
      for (let k = 0; k < hands; k++) {
        const rand = rng(1000 + k)
        const levels: Level[] = [0, 1, 2, 3].map((i) => (i === k % 4 ? hi : lo))
        const hs = deal(rand)
        let h = startHand(
          hs,
          hs.map((x, i) => choosePass(x, levels[i], rand)),
          PASS[k % 4],
        )
        while (!handOver(h)) h = playCard(h, chooseCard(h, levels[h.turn], rand))
        const s = score(h)
        me += s[k % 4]
        them += (s.reduce((a, x) => a + x, 0) - s[k % 4]) / 3
      }
      return { me: me / hands, them: them / hands }
    }
    const fe = run('fair', 'easy', 120)
    expect(fe.me).toBeLessThan(fe.them - 3)
    const hf = run('hard', 'fair', 120)
    expect(hf.me).toBeLessThan(hf.them - 1)
  }, 60000)
})

describe('hearts saves', () => {
  it('round-trips every field away from its default', () => {
    const s = {
      level: 'hard',
      felt: 'red',
      back: 'stars',
      end: 50,
      record: {
        easy: { won: 3, played: 5, moons: 1 },
        fair: { won: 4, played: 9, moons: 0 },
        hard: { won: 1, played: 8, moons: 2 },
      },
    }
    expect(readSaved(JSON.stringify(s))).toEqual(s)
    expect(readSaved('x')).toEqual(EMPTY)
  })
})
