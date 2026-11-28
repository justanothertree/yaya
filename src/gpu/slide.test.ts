import { describe, expect, it } from 'vitest'
import {
  DIFFICULTY,
  EMPTY_SAVED,
  LEVELS,
  SEEDS,
  fitBoard,
  generate,
  packTiles,
  parse,
  readSaved,
  slide,
  solve,
  stars,
  swipe,
  won,
  type Board,
  type Difficulty,
  type Dir,
  type State,
} from './slide'
import { beatHash, readBeat } from '../lab/beat'

const DIRS: Dir[] = ['up', 'down', 'left', 'right']
const begin = (b: Board): State => ({ at: b.start, got: 0 })
const play = (b: Board, moves: Dir[]) => moves.reduce((s, d) => slide(b, s, d).to, begin(b))

/** can it be done in exactly `depth` pushes or fewer — by plain depth-first search, sharing
 *  nothing with the breadth-first solver it checks */
function within(b: Board, s: State, depth: number): boolean {
  if (won(b, s)) return true
  if (depth === 0) return false
  return DIRS.some((d) => {
    const { to, path } = slide(b, s, d)
    return path.length > 0 && within(b, to, depth - 1)
  })
}

describe('a push', () => {
  const b = parse(
    'test',
    `
    ########
    #S.*G.,#
    #......#
    ########`,
  )
  it('slides to the wall, collecting a coin and passing over the goal on the way', () => {
    const { to, path } = slide(b, begin(b), 'right')
    expect(path.map(([x]) => x)).toEqual([2, 3, 4, 5, 6])
    expect(to).toEqual({ at: [6, 1], got: 1 }) // the snow at 6 stops it — it is the last cell anyway
    expect(won(b, to)).toBe(false)
  })
  it('stops ON snow, not before it', () => {
    const s = parse('s', `#####\n#S,.#\n#####`)
    expect(slide(s, begin(s), 'right').to.at).toEqual([2, 1])
  })
  it('a push into a wall goes nowhere and is not a move', () => {
    const { to, path } = slide(b, begin(b), 'up')
    expect(path).toEqual([])
    expect(to).toEqual(begin(b))
  })
  it('the edge of the board is a wall', () => {
    const open = parse('o', `S..\n...`)
    expect(slide(open, begin(open), 'right').to.at).toEqual([2, 0])
    expect(slide(open, begin(open), 'left').path).toEqual([])
  })
})

describe('the solver', () => {
  it('every level can be done, its answer wins when played, and nothing shorter does', () => {
    for (const l of LEVELS) {
      const p = solve(l)
      expect(p, l.name).not.toBeNull()
      expect(won(l, play(l, p!)), l.name).toBe(true)
      expect(within(l, begin(l), p!.length - 1), `${l.name} in ${p!.length - 1}`).toBe(false)
      expect(within(l, begin(l), p!.length)).toBe(true)
    }
  })
  it('agrees with depth-first search on generated boards — fewest pushes, exactly', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const b = generate(seed, 'easy')!
      const n = solve(b)!.length
      expect(within(b, begin(b), n - 1), `seed ${seed}`).toBe(false)
      expect(within(b, begin(b), n)).toBe(true)
    }
  })
  it('from part-way, the first push it suggests leaves one fewer to go — what a hint relies on', () => {
    const l = LEVELS[5]
    let s = begin(l)
    let left = solve(l)!.length
    while (left > 0) {
      const [d] = solve(l, s)!
      s = slide(l, s, d).to
      expect(solve(l, s)!.length).toBe(left - 1)
      left--
    }
    expect(won(l, s)).toBe(true)
  })
  it('says so when a board cannot be done', () => {
    expect(solve(parse('no', `#####\n#S#G#\n#####`))).toBeNull()
    // the coin is in a pocket nothing can stop in front of
    expect(solve(parse('no2', `#######\n#S...G#\n###*###\n#######`))).toBeNull()
  })
  it('levels use what they teach: snow is stopped on, and every coin is taken', () => {
    for (const l of LEVELS.slice(1)) {
      let s = begin(l)
      let snow = 0
      for (const d of solve(l)!) {
        s = slide(l, s, d).to
        if (l.tiles[s.at[1] * l.w + s.at[0]] === 'snow') snow++
      }
      expect(snow, l.name).toBeGreaterThan(0)
    }
  })
})

describe('endless boards', () => {
  it('fall in their band, every time, and the same seed gives the same board', () => {
    for (const d of Object.keys(DIFFICULTY) as Difficulty[]) {
      const { min, max, coins } = DIFFICULTY[d]
      for (let seed = 1; seed <= 40; seed++) {
        const b = generate(seed, d)
        expect(b, `${d} ${seed}`).not.toBeNull()
        const n = solve(b!)!.length
        expect(n).toBeGreaterThanOrEqual(min)
        expect(n).toBeLessThanOrEqual(max)
        expect(b!.coins.length).toBe(coins)
      }
      expect(generate(7, d)).toEqual(generate(7, d))
    }
    const tiles = new Set(
      Array.from({ length: 20 }, (_, i) => generate(i + 1, 'medium')!.tiles.join('')),
    )
    expect(tiles.size).toBe(20)
  })
})

describe('what is kept, and the stage', () => {
  it('reads back what it wrote, every field away from its default', () => {
    const saved = {
      best: { 'First push': 4, Collector: 12 },
      endless: { easy: 3, medium: 1, hard: 7 },
    }
    expect(readSaved(JSON.stringify(saved))).toEqual(saved)
  })
  it('a damaged record loses only what is damaged', () => {
    expect(
      readSaved(
        JSON.stringify({
          best: { 'First push': 0, Island: 2.5, Nowhere: 3, Collector: 11 },
          endless: { easy: -1, hard: 2 },
        }),
      ),
    ).toEqual({ best: { Collector: 11 }, endless: { easy: 0, medium: 0, hard: 2 } })
    expect(readSaved('{')).toEqual(EMPTY_SAVED)
    expect(readSaved(null)).toEqual(EMPTY_SAVED)
  })
  it('stars, swipes, and a coin taken leaves the board', () => {
    expect([6, 7, 8, 9].map((n) => stars(6, n))).toEqual([3, 2, 2, 1])
    expect(swipe(40, 5, 24)).toBe('right')
    expect(swipe(-3, -40, 24)).toBe('up')
    expect(swipe(10, 10, 24)).toBeNull()
    const l = LEVELS[5]
    const before = packTiles(l, 0)
    const after = packTiles(l, 1)
    const [x, y] = l.coins[0]
    expect(before[y * l.w + x]).toBe(4)
    expect(after[y * l.w + x]).toBe(0)
    const f = fitBoard([600, 400], l.w, l.h)
    expect(f.ox + l.w * f.s).toBeLessThanOrEqual(600)
    expect(f.oy + l.h * f.s).toBeLessThanOrEqual(400)
  })
})

/** a fingerprint of anything JSON can say, through WebCrypto: node:crypto is not typed for src/ */
const sha256 = async (x: unknown) =>
  [
    ...new Uint8Array(
      await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(x))),
    ),
  ]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')

describe('the board a “beat my board” link names', () => {
  const kinds = Object.keys(DIFFICULTY) as Difficulty[]
  it('is the board its seed has always made, at every difficulty', async () => {
    // node v22.23.4 and bun 1.4.4 agree on this figure (27 Nov 2026); a change to generate() turns
    // it red, and a deliberate one must give links a version (docs/2026-11-27-lab-beat-my-board.md)
    expect(await sha256(kinds.map((d) => generate(99_998, d)))).toBe(
      'ab97c595ff7a6b56c99676637155e6d2a77eea5728e7a0df06e86d9df156a4f8',
    )
  })
  it('is the sender’s board, built from what the link carries', () => {
    const b = readBeat(beatHash({ game: 'slide', seed: 99_998, difficulty: 'hard', pushes: 23 }))
    expect(b?.game).toBe('slide')
    if (b?.game !== 'slide') return
    expect(generate(b.seed, b.difficulty)).toEqual(generate(99_998, 'hard'))
  })
  it('every seed the toy deals is one a link can carry, and both ends make a board', () => {
    // every seed from 1 to SEEDS was swept at every difficulty on 27 Nov 2026: 299,997 boards, no
    // null (docs/2026-11-27-lab-beat-my-board.md); the ends are asked again here on every run
    for (const d of kinds) {
      expect(generate(1, d), d).not.toBeNull()
      expect(generate(SEEDS, d), d).not.toBeNull()
      expect(
        readBeat(beatHash({ game: 'slide', seed: SEEDS, difficulty: d, pushes: 99 })),
      ).not.toBeNull()
    }
  })
})
