import { describe, expect, it } from 'vitest'
import {
  EMPTY,
  FLEETS,
  aim,
  allSunk,
  blankSeen,
  density,
  fire,
  fits,
  randomFleet,
  readSaved,
  recordBattle,
  shipCells,
  type Fleet,
  type Level,
} from './seabattle'

const seeded = (seed: number) => {
  let s = seed >>> 0 || 1
  return () => {
    s ^= s << 13
    s ^= s >>> 17
    s ^= s << 5
    return (s >>> 0) / 2 ** 32
  }
}
const touches = (n: number, a: number, b: number) =>
  Math.abs(Math.floor(a / n) - Math.floor(b / n)) <= 1 && Math.abs((a % n) - (b % n)) <= 1

/** shots a level needs to sink a seeded fleet */
function battle(
  level: Level,
  seed: number,
  n = 10,
  sizes: readonly number[] = FLEETS.classic,
  apart = true,
) {
  const rand = seeded(seed)
  const fleet = randomFleet(n, sizes, apart, rand)
  const seen = blankSeen(n)
  let shots = 0
  while (!allSunk(fleet, seen)) {
    fire(fleet, seen, aim(seen, sizes, apart, level, rand))
    shots++
  }
  return shots
}

describe('fleets', () => {
  it('a ship stays on the sea', () => {
    expect(shipCells(10, 7, 3, true)).toEqual([7, 8, 9])
    expect(shipCells(10, 8, 3, true)).toBeNull()
    expect(shipCells(10, 75, 3, false)).toEqual([75, 85, 95])
    expect(shipCells(10, 85, 3, false)).toBeNull()
  })
  it('ships may not overlap, and with "apart" may not touch, corners included', () => {
    const fleet: Fleet = [{ id: 0, size: 2, cells: [0, 1] }]
    expect(fits(10, fleet, [1, 2], false)).toBe(false)
    expect(fits(10, fleet, [2, 3], false)).toBe(true)
    expect(fits(10, fleet, [2, 3], true)).toBe(false)
    expect(fits(10, fleet, [12, 13], true)).toBe(false)
    expect(fits(10, fleet, [3, 4], true)).toBe(true)
    // a ship moved within the fleet is not in its own way
    expect(fits(10, fleet, [1, 2], false, 0)).toBe(true)
  })
  it('a random fleet is every ship asked for, laid by the rules', () => {
    for (let seed = 1; seed <= 40; seed++)
      for (const [name, sizes] of Object.entries(FLEETS)) {
        const n = name === 'classic' && seed % 2 ? 10 : 8
        const fleet = randomFleet(n, sizes, true, seeded(seed))
        expect(fleet.map((s) => s.size)).toEqual([...sizes])
        const all = fleet.flatMap((s) => s.cells)
        expect(new Set(all).size).toBe(all.length)
        for (const a of fleet)
          for (const b of fleet)
            if (a !== b)
              for (const x of a.cells) for (const y of b.cells) expect(touches(n, x, y)).toBe(false)
      }
  })
})

describe('shooting', () => {
  it('reports a miss, a hit and a sinking, and never the same square twice', () => {
    const fleet: Fleet = [{ id: 0, size: 2, cells: [11, 12] }]
    const seen = blankSeen(10)
    expect(fire(fleet, seen, 0)).toBe('miss')
    expect(fire(fleet, seen, 11)).toBe('hit')
    expect(allSunk(fleet, seen)).toBe(false)
    expect(fire(fleet, seen, 12)).toBe('sunk')
    expect(seen.sunk).toEqual([{ size: 2, cells: [11, 12] }])
    expect(allSunk(fleet, seen)).toBe(true)
    expect(() => fire(fleet, seen, 12)).toThrow()
  })
  it('reads where ships can still be: not on a miss, not beside a sunk ship, and around a wound', () => {
    const fleet: Fleet = [
      { id: 0, size: 2, cells: [0, 1] },
      { id: 1, size: 3, cells: [55, 56, 57] },
    ]
    const seen = blankSeen(10)
    fire(fleet, seen, 0)
    fire(fleet, seen, 1)
    fire(fleet, seen, 33)
    const heat = density(seen, [2, 3], true)
    expect(heat[33]).toBe(0)
    expect(heat[2]).toBe(0)
    expect(heat[11]).toBe(0)
    fire(fleet, seen, 56)
    const wound = density(seen, [2, 3], true)
    const hottest = wound.indexOf(Math.max(...wound))
    expect([46, 55, 57, 66]).toContain(hottest)
  })
})

describe('the computer', () => {
  it('chooses from what it has seen and nothing else', () => {
    // the same view of the sea gives the same shot, whatever fleet is really there
    const seen = blankSeen(10)
    const a = aim(seen, FLEETS.classic, true, 'hard', seeded(4))
    const b = aim(seen, FLEETS.classic, true, 'hard', seeded(4))
    expect(a).toBe(b)
    expect(aim.length).toBe(5)
  })
  // Measured over thirty seeded fleets each (classic, 10×10, ships apart): easy needed 71.8 shots
  // on average, fair 54.2 and hard 39.2, and hard's worst was 51. Seeded, so the same every run.
  it('each level needs fewer shots than the one below it', () => {
    const mean = (level: Level) => {
      let t = 0
      for (let g = 0; g < 10; g++) t += battle(level, 900 + g)
      return t / 10
    }
    const easy = mean('easy')
    const fair = mean('fair')
    const hard = mean('hard')
    expect(fair).toBeLessThan(easy - 8)
    expect(hard).toBeLessThan(fair - 8)
    expect(hard).toBeLessThan(45)
  })
})

describe('sea battle saves', () => {
  it('a battle moves the record on; the fewest shots only counts a win', () => {
    let r = EMPTY.record.hard
    r = recordBattle(r, true, 61)
    r = recordBattle(r, false, 30)
    r = recordBattle(r, true, 48)
    expect(r).toEqual({ won: 2, lost: 1, fewest: 48 })
  })
  it('round-trips every field away from its default', () => {
    const s = {
      level: 'hard',
      size: 8,
      fleet: 'swarm',
      apart: false,
      again: true,
      theme: 'arctic',
      record: {
        easy: { won: 3, lost: 1, fewest: 40 },
        fair: { won: 4, lost: 5, fewest: 52 },
        hard: { won: 1, lost: 8, fewest: 61 },
      },
    }
    expect(readSaved(JSON.stringify(s))).toEqual(s)
  })
  it('a broken store loses only what is bad', () => {
    expect(readSaved('{')).toEqual(EMPTY)
    expect(readSaved(JSON.stringify({ size: 12, fleet: 'armada', again: true }))).toEqual({
      ...EMPTY,
      again: true,
    })
  })
})
