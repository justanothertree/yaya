import { describe, expect, it } from 'vitest'
import { KOMI, N, PASS, choose, legal, neighbours, score } from './goboard'
import { MAX_MOVES, goRules as R, replay, type GoGame } from './goRoom'
import { DRAWN, named, sample } from './testMatches'

function seeded(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/**
 * A whole game through the room's own rules. `random` plays any legal point that does not fill
 * its own eye and passes when there is none: a few milliseconds a game, and it reaches what the
 * computer seldom plays, long capture races, ko, a board filled to the edges. `computer` is the
 * toy's Easy level on both sides, real play at about a second and a half a game, because Easy is
 * 250 playouts a move; three of those were over four seconds of this file under a full run.
 */
function playThrough(seed: number, by: 'computer' | 'random') {
  const rnd = seeded(seed)
  let d = R.fresh('versus')
  const seen: GoGame[] = [d]
  while (R.turn(d) !== null) {
    const side = R.turn(d) as 0 | 1
    let at: number
    if (by === 'computer') at = choose(d.g, 'easy', rnd)
    else {
      const me = d.g.turn
      const ok = legal(d.g).filter((i) => !neighbours(i).every((n) => d.g.board[n] === me))
      at = ok.length ? ok[Math.floor(rnd() * ok.length)] : PASS
    }
    expect(R.legal(d, at, side)).toBe(true)
    d = R.apply(d, at, side)
    seen.push(d)
  }
  return { d, seen }
}

/**
 * By default, random games: seed 1's (forty-six stones taken, two passes) and one from the seed
 * drawn for this run. Nightly, the computer's games for seeds 1 to 4 as well.
 */
const GAMES = [
  ...named([], [1, 2, 3, 4]).map((seed) => ({ seed, by: 'computer' as const })),
  ...named([1], [1, 2, 3]).map((seed) => ({ seed, by: 'random' as const })),
  { seed: DRAWN, by: 'random' as const },
]
/** each game played once, however many tests ask about it */
const played = new Map<string, ReturnType<typeof playThrough>>()
const game = ({ seed, by }: (typeof GAMES)[number]) => {
  const key = `${by} ${seed}`
  return played.get(key) ?? played.set(key, playThrough(seed, by)).get(key)!
}

describe('go on the wire', () => {
  it.each(GAMES)(
    'survives the round trip through a whole game, captures and all (seed $seed, $by)',
    (g) => {
      let took = 0
      for (const d of sample(game(g).seen)) {
        const wire = JSON.parse(JSON.stringify(R.encode(d)))
        const back = R.decode(wire)!
        expect(back.g.board).toEqual(d.g.board)
        expect(back.g.taken).toEqual(d.g.taken)
        expect(back.g.ko).toBe(d.g.ko)
        expect(R.encode(back)).toEqual(wire)
        took = Math.max(took, d.g.taken[1] + d.g.taken[2])
      }
      // a round trip with no captures in it would not have asked about them
      expect(took).toBeGreaterThan(0)
    },
  )

  it('refuses a stone on a stone, suicide, the ko and anything off the board', () => {
    expect(replay([40, 40])).toBeNull()
    // white surrounds the corner point 0 (1 and 9), black plays elsewhere; black into 0 is suicide
    expect(replay([40, 1, 41, 9])).not.toBeNull()
    expect(replay([40, 1, 41, 9, 0])).toBeNull()
    expect(replay([N * N])).toBeNull()
    expect(replay([-2])).toBeNull()
    expect(replay([PASS, PASS, 0])).toBeNull() // two passes ended it
    expect(replay(Array(MAX_MOVES + 1).fill(PASS))).toBeNull()
  })
})

describe('go as a room game', () => {
  it.each(GAMES)(
    'ends on two passes or at the move limit, and the side with more area, komi counted, wins (seed $seed, $by)',
    (g) => {
      const { d } = game(g)
      // two passes end it; a game still going at the limit ends there, scored as it stands, which
      // about one random game in eight reaches
      if (d.g.over) expect(d.g.passes).toBe(2)
      else expect(d.list).toHaveLength(MAX_MOVES)
      // asked of the board's own area count, with komi for white
      const s = score(d.g.board)
      expect(R.result!(d)).toBe(s.black > s.white ? 0 : 1)
      expect(s.white).toBeGreaterThanOrEqual(KOMI) // white's count includes its komi
    },
  )

  it('together: the computer plays white', () => {
    expect(R.modes).toEqual(['versus', 'together'])
    const d = R.apply(R.fresh('together'), 40, 0)
    expect(R.turn(d)).toBe(1)
    expect(R.legal(d, R.computer!.choose(d, 'easy'), 1)).toBe(true)
    expect(R.legal(d, 40, 1)).toBe(false)
    expect(R.begun!(d)).toBe(true)
  })
})
