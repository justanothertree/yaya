import { describe, expect, it } from 'vitest'
import {
  ARENAS,
  EMPTY,
  free,
  living,
  newArena,
  readSaved,
  recordRound,
  room,
  steer,
  tick,
  turnable,
  type Arena,
  type Dir,
  type Level,
} from './trails'

const seeded = (seed: number) => {
  let s = seed >>> 0 || 1
  return () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    return (s >>> 0) / 2 ** 32
  }
}
/** an empty arena with riders where they are asked to be */
const arena = (w: number, h: number, riders: [number, number, Dir][]): Arena => {
  const cells = new Uint8Array(w * h)
  riders.forEach(([x, y], k) => (cells[y * w + x] = 2 + k))
  return {
    w,
    h,
    cells,
    riders: riders.map(([x, y, dir]) => ({ x, y, dir, alive: true })),
    ticks: 0,
  }
}

function duel(a: Level, b: Level, seat: 0 | 1, seed: number) {
  const rand = seeded(seed)
  const ar = newArena('medium', 2, (['open', 'pillars', 'scatter'] as const)[seed % 3], seed)
  while (living(ar) > 1)
    tick(ar, [steer(ar, 0, seat === 0 ? a : b, rand), steer(ar, 1, seat === 1 ? a : b, rand)])
  return ar.riders[seat].alive && !ar.riders[1 - seat].alive
}

describe('the arena', () => {
  it('starts every rider on its own square, facing inward, with blocks kept clear of them', () => {
    for (const layout of ['open', 'pillars', 'scatter'] as const) {
      const a = newArena('small', 4, layout, 3)
      const [w, h] = ARENAS.small
      expect(a.w * a.h).toBe(w * h)
      a.riders.forEach((r, k) => {
        expect(a.cells[r.y * a.w + r.x]).toBe(2 + k)
        // a few squares ahead are open
        for (let s = 1; s <= 3; s++)
          expect(free(a, r.x + [0, 1, 0, -1][r.dir] * s, r.y + [-1, 0, 1, 0][r.dir] * s)).toBe(true)
      })
    }
  })
  it('a rider moves one square a tick and leaves its trail', () => {
    const a = arena(10, 10, [[5, 5, 1]])
    tick(a, [null])
    expect([a.riders[0].x, a.riders[0].y]).toEqual([6, 5])
    expect(a.cells[5 * 10 + 5]).toBe(2)
    expect(a.cells[5 * 10 + 6]).toBe(2)
  })
  it('the edge, a trail or a block puts a rider out', () => {
    const a = arena(5, 5, [[4, 2, 1]])
    expect(tick(a, [null])).toEqual([0])
    expect(a.riders[0].alive).toBe(false)
    const b = arena(5, 5, [[1, 2, 1]])
    b.cells[2 * 5 + 2] = 3
    expect(tick(b, [null])).toEqual([0])
  })
  it('two riders into the same square both go out, whoever is first in the list', () => {
    const a = arena(9, 9, [
      [3, 4, 1],
      [5, 4, 3],
    ])
    expect(tick(a, [null, null]).sort()).toEqual([0, 1])
    expect(living(a)).toBe(0)
  })
  it('a rider cannot turn straight back into itself', () => {
    expect(turnable(1, 3)).toBe(false)
    expect(turnable(1, 0)).toBe(true)
    const a = arena(10, 10, [[5, 5, 1]])
    tick(a, [3])
    expect(a.riders[0].dir).toBe(1)
    expect(a.riders[0].alive).toBe(true)
  })
  it('counts the room a square can reach', () => {
    const a = arena(6, 6, [[0, 0, 1]])
    for (let y = 0; y < 6; y++) a.cells[y * 6 + 3] = 1
    expect(room(a, 1, 0)).toBe(3 * 6 - 1)
    expect(room(a, 4, 4)).toBe(12)
    expect(room(a, 3, 3)).toBe(0)
  })
})

describe('the computer', () => {
  it('never rides into something when it has a way out', () => {
    const rand = seeded(5)
    for (const level of ['easy', 'fair', 'hard'] as Level[])
      for (let g = 0; g < 4; g++) {
        const a = newArena('small', 3, 'scatter', g + 1)
        while (living(a) > 0 && a.ticks < 400) {
          const dirs = a.riders.map((r, k) => (r.alive ? steer(a, k, level, rand) : null))
          a.riders.forEach((r, k) => {
            if (!r.alive) return
            const d = dirs[k]!
            const anyFree = [0, 1, 2, 3].some(
              (e) =>
                turnable(r.dir, e as Dir) &&
                free(a, r.x + [0, 1, 0, -1][e], r.y + [-1, 0, 1, 0][e]),
            )
            if (anyFree) expect(free(a, r.x + [0, 1, 0, -1][d], r.y + [-1, 0, 1, 0][d])).toBe(true)
          })
          tick(a, dirs)
        }
      }
  })
  // Measured: riding alone on the open medium arena, easy lasted 173 ticks on average and fair 837.
  // In duels from both seats over twenty seeded games per arena, hard beat fair 14–6 in the open
  // and 20–0 among pillars and among scattered blocks, where cutting off room matters most; fair
  // against fair split evenly. The slowest choice took 2.5 ms. Seeded, so the same every run.
  it('fills the arena far longer than chance, and each level beats the one below it', () => {
    const lasts = (level: Level) => {
      const a = newArena('medium', 1, 'open')
      const rand = seeded(50)
      while (living(a)) tick(a, [steer(a, 0, level, rand)])
      return a.ticks
    }
    expect(lasts('fair')).toBeGreaterThan(lasts('easy') * 2)
    let wins = 0
    for (let g = 0; g < 10; g++)
      for (const seat of [0, 1] as const) if (duel('hard', 'fair', seat, 80 + g)) wins++
    expect(wins).toBeGreaterThanOrEqual(15)
  }, 30000)
})

describe('trails saves', () => {
  it('a round moves the record on', () => {
    let r = EMPTY.record.hard
    r = recordRound(r, true, 420)
    r = recordRound(r, false, 610)
    expect(r).toEqual({ won: 1, lost: 1, rounds: 2, longest: 610 })
  })
  it('round-trips every field away from its default', () => {
    const s = {
      level: 'hard',
      size: 'large',
      layout: 'scatter',
      rivals: 3,
      speed: 'frantic',
      colour: 4,
      glow: false,
      record: {
        easy: { won: 3, lost: 1, rounds: 4, longest: 900 },
        fair: { won: 4, lost: 5, rounds: 9, longest: 700 },
        hard: { won: 1, lost: 8, rounds: 9, longest: 500 },
      },
    }
    expect(readSaved(JSON.stringify(s))).toEqual(s)
  })
  it('a broken store loses only what is bad', () => {
    expect(readSaved('{')).toEqual(EMPTY)
    expect(readSaved(JSON.stringify({ rivals: 7, size: 'huge', glow: false }))).toEqual({
      ...EMPTY,
      glow: false,
    })
  })
})
