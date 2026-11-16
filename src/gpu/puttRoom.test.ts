import { describe, expect, it } from 'vitest'
import { rng } from './bricks'
import { COURSE, PICK_UP, roll, stroke } from './putt'
import { MAX_PUTTS, puttRules as R, readPutt, totals, type PuttGame } from './puttRoom'

const wire = (ps: [number, number][]) => ({ putts: ps })
/** a putt so soft it barely moves: never in, never wet, a stroke every time */
const TAP: [number, number] = [0, 0.02]

/**
 * A whole round through the room's own rules, every putt of it: seat 0 the computer on Easy (the
 * cheapest to ask, and it holes out), seat 1 putting at random. Not Hard or Fair: their search
 * is several hundred rolls a putt, and a round of it is the kind of test that times out on a busy
 * runner.
 */
function playThrough(seed: number) {
  const rand = rng(seed)
  let g = R.fresh()
  const seen: PuttGame[] = [g]
  while (R.turn(g) !== null) {
    const side = R.turn(g) as 0 | 1
    const p =
      side === 0
        ? stroke(COURSE[g.hole], g.at, 'easy', rand)
        : { angle: rand() * Math.PI * 2, power: 0.1 + rand() * 0.6 }
    expect(R.legal(g, p, side)).toBe(true)
    expect(R.legal(g, p, side === 0 ? 1 : 0)).toBe(false)
    g = R.apply(g, p, side)
    seen.push(g)
  }
  return { g, seen }
}

describe('putt on the wire', () => {
  it('replays to the very same round from its putts, at every putt of real rounds', () => {
    let sunk = 0
    for (const seed of [1, 2]) {
      const { g, seen } = playThrough(seed)
      expect(g.card.every((c) => c[0] !== null && c[1] !== null)).toBe(true)
      for (const d of seen) {
        if (d.last?.roll.sunk) sunk++
        const w = JSON.parse(JSON.stringify(R.encode(d)))
        const back = R.decode(w)!
        expect(back.card).toEqual(d.card)
        expect([back.hole, back.up, back.strokes]).toEqual([d.hole, d.up, d.strokes])
        expect(back.at).toEqual(d.at)
        expect(back.last?.roll.end).toEqual(d.last?.roll.end)
        expect(R.encode(back)).toEqual(w)
      }
      const [a, b] = totals(g)
      expect(R.result!(g)).toBe(a < b ? 0 : b < a ? 1 : 'draw')
      // a putt after the last hole is not part of any round: refused, though the list is short
      const w = R.encode(g) as { putts: number[][] }
      expect(w.putts.length).toBeLessThan(MAX_PUTTS)
      expect(R.decode({ putts: [...w.putts, TAP] })).toBeNull()
    }
    // the rounds were worth replaying: balls dropped, not only picked up
    expect(sunk).toBeGreaterThan(3)
  })

  it('has seat 0 putt out, then seat 1 the same hole, then seat 0 the next', () => {
    let g = R.fresh()
    for (let i = 0; i < PICK_UP - 1; i++) g = R.apply(g, { angle: TAP[0], power: TAP[1] }, 0)
    expect([g.up, g.hole, g.strokes]).toEqual([0, 0, PICK_UP - 1])
    g = R.apply(g, { angle: TAP[0], power: TAP[1] }, 0)
    // picked up at PICK_UP: the card says so, and seat 1 is on the same tee
    expect(g.card[0]).toEqual([PICK_UP, null])
    expect([g.up, g.hole, g.strokes]).toEqual([1, 0, 0])
    expect(g.at).toEqual(COURSE[0].tee)
    for (let i = 0; i < PICK_UP; i++) g = R.apply(g, { angle: TAP[0], power: TAP[1] }, 1)
    expect(g.card[0]).toEqual([PICK_UP, PICK_UP])
    expect([g.up, g.hole]).toEqual([0, 1])
    expect(g.at).toEqual(COURSE[1].tee)
  })

  it('costs a stroke for water and plays again from the same spot, as the toy does', () => {
    // find a putt into water from a tee on the course
    let found: { hole: number; angle: number; power: number } | null = null
    for (let hole = 0; hole < COURSE.length && !found; hole++)
      for (let a = 0; a < 72 && !found; a++)
        for (const power of [0.3, 0.5, 0.7]) {
          const angle = (a / 72) * Math.PI * 2
          if (roll(COURSE[hole], COURSE[hole].tee, angle, power).wet) {
            found = { hole, angle, power }
            break
          }
        }
    expect(found).not.toBeNull()
    // walk the round to that hole with taps, then putt into the water
    let g = R.fresh()
    while (g.hole < found!.hole) g = R.apply(g, { angle: TAP[0], power: TAP[1] })
    const before = g.at
    g = R.apply(g, { angle: found!.angle, power: found!.power })
    expect(g.last!.roll.wet).toBe(true)
    expect(g.strokes).toBe(2)
    expect(g.at).toEqual(before)
  })

  it('ends the round after the last hole, the lower total winning', () => {
    const taps = Array.from({ length: COURSE.length * 2 * PICK_UP }, () => TAP)
    const g = R.decode(wire(taps))!
    expect(g.up).toBeNull()
    expect(totals(g)).toEqual([COURSE.length * PICK_UP, COURSE.length * PICK_UP])
    expect(R.result!(g)).toBe('draw')
    expect(R.legal(g, { angle: 0, power: 0.5 })).toBe(false)
    expect(R.decode(wire([...taps, TAP]))).toBeNull()
    expect(taps.length).toBe(MAX_PUTTS)
  })

  it('refuses a putt outside what any putter here could send', () => {
    expect(readPutt([1.5, 0.4])).toEqual({ angle: 1.5, power: 0.4 })
    for (const bad of [[0, 0], [0, 1.01], [11, 0.5], [NaN, 0.5], ['0', 0.5], [0], null, 4])
      expect(readPutt(bad)).toBeNull()
  })

  it('refuses a round that is not a list of putts', () => {
    expect(R.decode(null)).toBeNull()
    expect(R.decode({})).toBeNull()
    expect(R.decode(wire([[0, 2]]))).toBeNull()
  })

  it('lets the computer take its putt together', () => {
    let g = R.fresh()
    for (let i = 0; i < PICK_UP; i++) g = R.apply(g, { angle: TAP[0], power: TAP[1] }, 0)
    expect(R.turn(g)).toBe(R.computer!.side)
    expect(R.legal(g, R.computer!.choose(g, 'easy'), 1)).toBe(true)
  })
})
