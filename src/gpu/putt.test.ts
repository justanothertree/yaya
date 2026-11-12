import { describe, expect, it } from 'vitest'
import { rng } from './bricks'
import {
  BALL,
  COURSE,
  EMPTY,
  H,
  MAX_HOLES,
  PICK_UP,
  W,
  field,
  pack,
  playHole,
  readHole,
  readSaved,
  roll,
  tileOf,
  writeHole,
  type Hole,
  type Saved,
} from './putt'

/** a plain hole for physics: an open box of grass, with whatever the test writes into it */
const box = (edit: (rows: string[][]) => void = () => {}): Hole => {
  const rows: string[][] = Array.from({ length: H }, (_, y) =>
    Array.from({ length: W }, (_, x) =>
      x === 0 || y === 0 || x === W - 1 || y === H - 1 ? 'x' : 'g',
    ),
  )
  rows[12][5] = 't'
  rows[2][5] = 'o'
  edit(rows)
  return readHole(rows.map((r) => r.join('')).join(''))!
}
const UP = -Math.PI / 2
const DOWN = Math.PI / 2

describe('holes as text', () => {
  it('round-trips every built-in hole, packed and unpacked', () => {
    for (const h of COURSE) {
      const flat = writeHole(h)
      expect(flat).toHaveLength(W * H)
      const back = readHole(pack(flat), h.name)!
      expect(back).toEqual(h)
      expect(pack(flat).length).toBeLessThan(flat.length)
    }
  })
  it('refuses a hole with no tee, two cups, or a cup nobody can reach', () => {
    const flat = writeHole(COURSE[0])
    expect(readHole(flat.replace('t', 'g'))).toBeNull()
    expect(readHole(flat.replace('gggg', 'gogg'))).toBeNull()
    // wall the cup in: The straight's cup is at (5, 2); fill its row and the one below with wall
    const sealed = [...flat]
    for (let x = 0; x < W; x++) sealed[3 * W + x] = 'x'
    expect(readHole(sealed.join(''))).toBeNull()
    expect(readHole('x150')).toBeNull()
    expect(readHole('nonsense')).toBeNull()
    expect(readHole('x9999')).toBeNull()
  })
})

describe('rolling', () => {
  const h = box()
  it('goes further the harder it is struck, and stops', () => {
    const ends = [0.1, 0.2, 0.3].map((p) => roll(h, h.tee, UP, p).end.y)
    expect(ends[0]).toBeGreaterThan(ends[1])
    expect(ends[1]).toBeGreaterThan(ends[2])
    expect(roll(h, h.tee, UP, 0.1).sunk).toBe(false)
  })
  it('drops in when it arrives gently, and runs over when it arrives fast', () => {
    // a tee three tiles below the cup: the gentlest putt that gets there drops, a full one runs on
    const near = box((rows) => {
      rows[12][5] = 'g'
      rows[5][5] = 't'
    })
    let dropped = 0
    for (let p = 0.05; p <= 1.0001; p += 0.01) if (roll(near, near.tee, UP, p).sunk) dropped++
    expect(dropped).toBeGreaterThan(0)
    expect(roll(near, near.tee, UP, 1).sunk).toBe(false)
    expect(roll(near, near.tee, UP, 0.05).sunk).toBe(false)
  })
  it('bounces back off a wall, losing some pace', () => {
    // straight down from the tee at the wall two tiles below: it touches it, then comes back up
    const r = roll(h, h.tee, DOWN, 0.35, true)
    const ys = r.frames.filter((_, i) => i % 2 === 1)
    const lowest = Math.max(...ys)
    expect(lowest).toBeCloseTo(H - 1 - BALL, 1)
    expect(r.end.y).toBeLessThan(lowest - 1)
  })
  it('drags in sand: the same putt stops sooner', () => {
    const sandy = box((rows) => {
      for (let y = 4; y <= 10; y++) for (let x = 1; x < W - 1; x++) rows[y][x] = 's'
    })
    const onGrass = roll(h, h.tee, UP, 0.5).end.y
    const inSand = roll(sandy, sandy.tee, UP, 0.5).end.y
    expect(inSand).toBeGreaterThan(onGrass + 1)
  })
  it('splashes in water and goes back to where it was played from', () => {
    const wet = box((rows) => {
      // a gap at the left end: a hole whose cup no ball can reach is not a hole at all
      for (let x = 2; x < W - 1; x++) rows[8][x] = 'w'
    })
    const r = roll(wet, wet.tee, UP, 0.6)
    expect(r.wet).toBe(true)
    expect(r.end).toEqual(wet.tee)
  })
  it('never comes to rest inside a wall or off the board, however it is struck', () => {
    const rand = rng(5)
    for (const hole of COURSE)
      for (let i = 0; i < 60; i++) {
        const r = roll(hole, hole.tee, rand() * Math.PI * 2, rand())
        expect(tileOf(hole, r.end)).not.toBe('x')
        expect(r.end.x).toBeGreaterThan(0)
        expect(r.end.y).toBeGreaterThan(0)
      }
  })
})

describe('the way to the cup', () => {
  it('is measured round walls and never across water', () => {
    const f = field(COURSE[3]) // the pond
    const h = COURSE[3]
    expect(Number.isFinite(f.at(h.tee))).toBe(true)
    // straight up from the tee is about ten tiles; round the water it is much further
    expect(f.at(h.tee)).toBeGreaterThan(Math.hypot(h.tee.x - h.cup.x, h.tee.y - h.cup.y) + 3)
    expect(f.at({ x: 2.5, y: 5.5 })).toBe(Infinity) // in the water
  })
  it('counts sand as longer than grass', () => {
    const plain = box()
    const sandy = box((rows) => {
      for (let x = 1; x < W - 1; x++) rows[7][x] = 's'
    })
    expect(field(sandy).at(sandy.tee)).toBeGreaterThan(field(plain).at(plain.tee) + 1)
  })
})

describe('the computer', () => {
  it('finishes every built-in hole, never past the pick-up', () => {
    for (const h of COURSE) {
      const r = playHole(h, 'fair', rng(9))
      expect(r.strokes).toBeLessThanOrEqual(PICK_UP)
      expect(r.putts.at(-1)!.roll.sunk || r.strokes === PICK_UP).toBe(true)
    }
  })
  it('takes fewer strokes level by level over the course', () => {
    const round = (lv: 'easy' | 'fair' | 'hard') => {
      let t = 0
      for (const h of COURSE)
        for (let s = 0; s < 4; s++) t += playHole(h, lv, rng(s * 7 + 1)).strokes
      return t / 4
    }
    // measured over six seeds: Easy 18.3, Fair 14.7, Hard 11.7 strokes a round
    const easy = round('easy')
    const fair = round('fair')
    const hard = round('hard')
    expect(fair).toBeLessThan(easy - 1.5)
    expect(hard).toBeLessThan(fair - 1.5)
  }, 60_000)
})

describe('what is kept', () => {
  it('round-trips every field that is not a default', () => {
    const s: Saved = {
      level: 'hard',
      theme: 'candy',
      guide: false,
      holes: [writeHole(COURSE[2]), pack(writeHole(COURSE[4]))],
      record: {
        easy: { won: 3, lost: 1, tied: 2, best: 19 },
        fair: { won: 2, lost: 5, tied: 1, best: 16 },
        hard: { won: 1, lost: 7, tied: 3, best: 14 },
      },
    }
    for (const k of Object.keys(s) as (keyof Saved)[]) expect(s[k]).not.toEqual(EMPTY[k])
    expect(readSaved(JSON.stringify(s))).toEqual(s)
  })
  it('drops holes it cannot read and keeps no more than it can show', () => {
    const good = writeHole(COURSE[1])
    const r = readSaved(JSON.stringify({ holes: [good, 'x150', 7, ...Array(20).fill(good)] }))
    expect(r.holes).toHaveLength(MAX_HOLES)
    expect(r.holes.every((x) => x === good)).toBe(true)
    expect(readSaved('[]')).toEqual(EMPTY)
    expect(readSaved('{')).toEqual(EMPTY)
  })
})
