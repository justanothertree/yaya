import { describe, expect, it } from 'vitest'
import { rng } from './bricks'
import { FIELD_W, fly, gunner, mirror, newField, type Level } from './artillery'
import {
  MAX_SHOTS,
  artilleryRules as R,
  readShot,
  replay,
  type ArtilleryGame,
} from './artilleryRoom'

/** a whole game between two gunners through the room's own rules, every position along the way */
function playThrough(seed: number, levels: [Level, Level] = ['fair', 'easy']) {
  const rand = rng(seed ^ 0x2545f491)
  let g = replay(seed, [])!
  const seen: ArtilleryGame[] = [g]
  while (R.turn(g) !== null) {
    const side = R.turn(g) as 0 | 1
    const s = gunner(g.f, levels[side], rand)
    expect(R.legal(g, s, side)).toBe(true)
    expect(R.legal(g, s, side === 0 ? 1 : 0)).toBe(false)
    g = R.apply(g, s, side)
    seen.push(g)
  }
  return { g, seen }
}

describe('artillery on the wire', () => {
  it('replays to the very same field from its seed and shots, at every shot of real games', () => {
    for (let seed = 1; seed <= 4; seed++) {
      const { g, seen } = playThrough(seed)
      expect(g.f.winner).not.toBeNull()
      for (const d of seen) {
        const wire = JSON.parse(JSON.stringify(R.encode(d)))
        const back = R.decode(wire)!
        // the whole field: every height, both guns, the wind, whose turn, the seed it drifts from
        expect(back.f).toEqual(d.f)
        expect(back.last).toEqual(d.last)
        expect(R.encode(back)).toEqual(wire)
      }
    }
  })

  it('is a few hundred bytes a game, where the field alone is thousands', () => {
    const { g } = playThrough(7)
    expect(JSON.stringify(R.encode(g)).length).toBeLessThan(1000)
    expect(JSON.stringify(g.f.ground).length).toBeGreaterThan(3000)
  })

  it('names the winner, and the game ends there', () => {
    const { g } = playThrough(3, ['hard', 'easy'])
    expect(R.result!(g)).toBe(g.f.winner)
    expect(R.turn(g)).toBeNull()
    expect(R.legal(g, { angle: 45, charge: 0.5 })).toBe(false)
    // and a shot sent after the end does not replay
    const wire = R.encode(g) as { seed: number; shots: number[][] }
    expect(R.decode({ ...wire, shots: [...wire.shots, [45, 0.5]] })).toBeNull()
  })

  it('refuses a shot outside the limits the toy’s own controls keep', () => {
    expect(readShot([45, 0.5])).toEqual({ angle: 45, charge: 0.5 })
    expect(readShot({ angle: 5, charge: 1 })).toEqual({ angle: 5, charge: 1 })
    for (const bad of [
      [4.9, 0.5],
      [85.1, 0.5],
      [45, 0.09],
      [45, 1.01],
      [NaN, 0.5],
      [45, Infinity],
      ['45', 0.5],
      [45],
      null,
      7,
    ])
      expect(readShot(bad)).toBeNull()
  })

  it('refuses a game that is not a seed and shots', () => {
    expect(R.decode(null)).toBeNull()
    expect(R.decode({ seed: 5 })).toBeNull()
    expect(R.decode({ seed: -1, shots: [] })).toBeNull()
    expect(R.decode({ seed: 1.5, shots: [] })).toBeNull()
    expect(R.decode({ seed: 2 ** 31, shots: [] })).toBeNull()
    expect(R.decode({ seed: 9, shots: [[45, 2]] })).toBeNull()
    expect(R.decode({ seed: 9, shots: [[45, 0.5]] })).not.toBeNull()
    // a list as long as no game is, made of shots that harm nobody, each found where it stands
    let g = replay(9, [])!
    const calm: number[][] = []
    while (calm.length < MAX_SHOTS) {
      let found: number[] | null = null
      for (let a = 85; a >= 5 && !found; a -= 5)
        for (let c = 1; c >= 0.1 && !found; c -= 0.15) {
          const next = R.apply(g, { angle: a, charge: c })
          if (next.last!.hurt[0] === 0 && next.last!.hurt[1] === 0) {
            found = [a, c]
            g = next
          }
        }
      expect(found).not.toBeNull()
      calm.push(found!)
    }
    const long = R.decode({ seed: 9, shots: calm })!
    expect(long).not.toBeNull()
    expect(R.decode({ seed: 9, shots: [...calm, calm[0]] })).toBeNull()
    // and a game that long is over, a draw
    expect(R.turn(long)).toBeNull()
    expect(R.result!(long)).toBe('draw')
  })

  it('lets the computer take the right gun’s shot together', () => {
    let g = replay(11, [])!
    g = R.apply(g, { angle: 40, charge: 0.4 }, 0)
    expect(R.turn(g)).toBe(R.computer!.side)
    const s = R.computer!.choose(g, 'hard')
    expect(R.legal(g, s, 1)).toBe(true)
  })
})

describe('the field seen from the other side', () => {
  it('flies the right gun’s shot as the left gun’s on the mirror, wind and all', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const f = { ...newField(seed), wind: ((seed % 7) - 3) / 10 }
      const m = mirror(f)
      const angle = 25 + (seed % 9) * 6
      const charge = 0.45 + (seed % 5) * 0.1
      const a = fly(f, 1, angle, charge)
      const b = fly(m, 0, angle, charge)
      expect(b.burst === null).toBe(a.burst === null)
      if (a.burst && b.burst) {
        expect(b.burst.x).toBeCloseTo(FIELD_W - a.burst.x, 6)
        expect(b.burst.y).toBeCloseTo(a.burst.y, 6)
        expect(b.struck).toBe(a.struck === null ? null : a.struck === 0 ? 1 : 0)
      }
    }
  })

  it('swaps the guns’ life and whose turn it is, and is its own undoing', () => {
    const f = { ...newField(4), turn: 1 as const, winner: 0 as const }
    f.guns = [
      { x: f.guns[0].x, life: 55 },
      { x: f.guns[1].x, life: 10 },
    ]
    const m = mirror(f)
    expect(m.guns.map((g) => g.life)).toEqual([10, 55])
    expect(m.turn).toBe(0)
    expect(m.winner).toBe(1)
    const back = mirror(m)
    expect(back.ground).toEqual(f.ground)
    expect(back.wind).toBe(f.wind)
    expect(back.turn).toBe(f.turn)
    expect(back.winner).toBe(f.winner)
    back.guns.forEach((g, i) => expect(g.x).toBeCloseTo(f.guns[i].x, 12))
  })
})
