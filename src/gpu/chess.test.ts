import { describe, expect, it } from 'vitest'
import {
  EMPTY,
  START,
  choose,
  fromFen,
  moves,
  outcome,
  perft,
  play,
  posKey,
  readSaved,
  san,
  sqOf,
  toFen,
  type Level,
  type Pos,
  type Side,
} from './chess'
import { rng } from './bricks'

const byName = (p: Pos, name: string) => {
  const m = moves(p).find((x) => san(p, x).replace(/[+#]$/, '') === name.replace(/[+#]$/, ''))
  if (!m) throw new Error(`no ${name} in ${toFen(p)}`)
  return m
}
const line = (fen: string, names: string[]) =>
  names.reduce((p, n) => play(p, byName(p, n)), fromFen(fen))

describe('every legal move, counted', () => {
  // the published figures for these positions, which every correct move generator reproduces —
  // castling through check, en passant that exposes the king, promotions with and without a take
  it.each([
    ['the start', START, [20, 400, 8902]],
    [
      'Kiwipete',
      'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
      [48, 2039],
    ],
    ['position 3', '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', [14, 191, 2812]],
    [
      'position 4',
      'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1',
      [6, 264, 9467],
    ],
    ['position 5', 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8', [44, 1486]],
  ] as [string, string, number[]][])('%s', (_, fen, counts) => {
    counts.forEach((n, k) => expect(perft(fromFen(fen), k + 1)).toBe(n))
  })
  it('reads and writes positions the usual way', () => {
    for (const fen of [
      START,
      'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1',
      '8/8/8/3pP3/8/8/8/4K2k w - d6 0 3',
    ])
      expect(toFen(fromFen(fen))).toBe(fen)
  })
})

describe('the names of moves', () => {
  it('says them the way a scoresheet does', () => {
    const p = fromFen(START)
    expect(moves(p).map((m) => san(p, m))).toContain('Nf3')
    const q = line(START, ['e4', 'd5'])
    expect(san(q, byName(q, 'exd5'))).toBe('exd5')
    const c = fromFen('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1')
    expect(moves(c).map((m) => san(c, m))).toEqual(expect.arrayContaining(['O-O', 'O-O-O']))
    const n = fromFen('4k3/8/8/8/8/8/8/1N1NK3 w - - 0 1')
    expect(moves(n).map((m) => san(n, m))).toEqual(expect.arrayContaining(['Nbc3', 'Ndc3']))
    const promo = fromFen('4k3/P7/8/8/8/8/8/4K3 w - - 0 1')
    expect(moves(promo).map((m) => san(promo, m))).toEqual(
      expect.arrayContaining(['a8=Q+', 'a8=N']),
    )
  })
})

describe('how a game ends', () => {
  it("checkmate: the fool's mate", () => {
    const p = line(START, ['f3', 'e5', 'g4', 'Qh4#'])
    expect(outcome(p)).toEqual({ winner: 'b', why: 'checkmate' })
  })
  it('stalemate, fifty moves, three times the same, and too little to mate are draws', () => {
    expect(outcome(fromFen('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1'))).toEqual({
      winner: null,
      why: 'stalemate',
    })
    expect(outcome(fromFen('4k3/8/8/8/8/8/R7/4K3 w - - 100 80'))).toMatchObject({
      why: 'fifty moves',
    })
    expect(outcome(fromFen('4k3/8/8/8/8/8/8/2B1K3 w - - 0 1'))).toMatchObject({
      why: 'too little to mate',
    })
    let p = fromFen('4k3/8/8/8/8/8/R7/4K3 w - - 0 1')
    const seen = [posKey(p)]
    for (const n of ['Kd1', 'Kd8', 'Ke1', 'Ke8', 'Kd1', 'Kd8', 'Ke1', 'Ke8']) {
      p = play(p, byName(p, n))
      seen.push(posKey(p))
    }
    expect(outcome(p, seen)).toMatchObject({ winner: null, why: 'repetition' })
    expect(outcome(fromFen(START))).toBeNull()
  })
})

describe('the computer', () => {
  it('mates in one when it can, and takes a queen left hanging', () => {
    const mate = fromFen('6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1')
    for (const lv of ['fair', 'hard'] as Level[]) {
      const m = choose(mate, lv, rng(1))
      expect(outcome(play(mate, m))).toMatchObject({ why: 'checkmate' })
    }
    const queen = fromFen('4k3/8/8/3q4/8/8/3R4/4K3 w - - 0 1')
    for (const lv of ['fair', 'hard'] as Level[])
      expect(choose(queen, lv, rng(2)).to).toBe(sqOf('d5'))
  })
  it('never plays a move the rules do not allow, and a game against itself ends', () => {
    const rand = rng(9)
    let p = fromFen(START)
    const seen = [posKey(p)]
    for (let k = 0; k < 400 && !outcome(p, seen); k++) {
      const m = choose(p, 'fair', rand, seen)
      expect(moves(p)).toContainEqual(m)
      p = play(p, m)
      seen.push(posKey(p))
    }
    expect(outcome(p, seen)).not.toBeNull()
  })
  // measured over twelve games from both seats: fair beat easy 12–0, hard scored 7½ of 12 against fair
  it('fair beats easy and hard outscores fair, from either side of the board', () => {
    const score = (hi: Level, lo: Level, games: number) => {
      let pts = 0
      for (let s = 1; s <= games; s++)
        for (const side of ['w', 'b'] as Side[]) {
          const rand = rng(s)
          let p = fromFen(START)
          const seen = [posKey(p)]
          let o = outcome(p, seen)
          for (let k = 0; k < 300 && !o; k++) {
            p = play(p, choose(p, p.turn === side ? hi : lo, rand, seen))
            seen.push(posKey(p))
            o = outcome(p, seen)
          }
          pts += !o || o.winner === null ? 0.5 : o.winner === side ? 1 : 0
        }
      return pts
    }
    expect(score('fair', 'easy', 3)).toBeGreaterThanOrEqual(5)
    expect(score('hard', 'fair', 4)).toBeGreaterThan(4)
  }, 180000)
})

describe('chess saves', () => {
  it('round-trips every field away from its default', () => {
    const s = {
      level: 'hard',
      board: 'blue',
      set: 'coral',
      hints: false,
      record: {
        easy: { won: 3, lost: 1, drawn: 2 },
        fair: { won: 4, lost: 6, drawn: 1 },
        hard: { won: 1, lost: 8, drawn: 3 },
      },
    }
    expect(readSaved(JSON.stringify(s))).toEqual(s)
    expect(readSaved('{')).toEqual(EMPTY)
  })
})
