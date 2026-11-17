import { describe, expect, it } from 'vitest'
import { ALL, chooseDice, chooseWay, sum } from './shut'
import { shutRules as R, replay, roll, type ShutGame } from './shutRoom'

function seeded(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}
const loaded = (...faces: number[]) => {
  let k = 0
  return () => (faces[k++ % faces.length] - 1) / 6 + 0.01
}
const bit = (...tiles: number[]) => tiles.reduce((s, t) => s | (1 << (t - 1)), 0)
/** both boxes played out, each decision Fair's, rolled as the server rolls; bounded */
function playOut(seed: number) {
  const rnd = seeded(seed)
  let g = roll(R.fresh(), rnd)
  for (let k = 0; k < 200 && g.turn !== null; k++) {
    const up = g.up[g.turn]
    const m =
      g.due === 'dice'
        ? { dice: chooseDice(up, 'fair') }
        : {
            shut: chooseWay(
              up,
              g.dice.reduce((s, d) => s + d, 0),
              'fair',
              rnd,
            ),
          }
    g = roll(R.apply(g, m), rnd)
  }
  if (g.turn !== null) throw new Error('the game never finished')
  return g
}

describe('shut the box by turns: the server rolls', () => {
  it('shuts only tiles that add up to the roll, and lets one die be chosen once 7, 8 and 9 are down', () => {
    let g = roll(R.fresh(), loaded(4, 5))
    expect(g.dice).toEqual([4, 5])
    expect(R.legal(g, { shut: bit(9) })).toBe(true)
    expect(R.legal(g, { shut: bit(8) })).toBe(false)
    expect(R.legal(g, { dice: 1 })).toBe(false)
    g = roll(R.apply(g, { shut: bit(9) }), loaded(3, 5))
    g = roll(R.apply(g, { shut: bit(8) }), loaded(3, 4))
    g = R.apply(g, { shut: bit(7) })
    // 7, 8 and 9 down: the side chooses its dice before the server rolls them
    expect(g.due).toBe('dice')
    g = roll(R.apply(g, { dice: 1 }), loaded(6))
    expect(g.dice).toEqual([6])
    expect(g.up[0]).toBe(bit(1, 2, 3, 4, 5, 6))
  })

  it('ends a box on a roll its tiles cannot make, and plays the other side’s next', () => {
    // 9 down, then 1 + 1 = 2: the 2 is up, so shut it; then 6 + 6 = 12 with 8 and 4 left: 8 + 4
    let g: ShutGame = roll(R.fresh(), loaded(4, 5))
    g = roll(R.apply(g, { shut: bit(9) }), loaded(1, 1))
    g = roll(R.apply(g, { shut: bit(2) }), loaded(6, 6))
    g = roll(R.apply(g, { shut: bit(8, 4) }), loaded(6, 6, 2, 3))
    // 12 again: 7 + 5 is up, so it is a roll; shut 7 + 5, and the box goes on
    expect(g.turn).toBe(0)
    g = R.apply(g, { shut: bit(7, 5) })
    // 7, 8 and 9 down, so two dice are chosen; 1 3 6 left cannot make 12, so the box ends and
    // the other side's first roll is 2 + 3
    expect(g.due).toBe('dice')
    g = roll(R.apply(g, { dice: 2 }), loaded(6, 6, 2, 3))
    expect(g.turn).toBe(1)
    expect(sum(g.up[0])).toBe(1 + 3 + 6)
    expect(g.dice).toEqual([2, 3])
  })

  it('round-trips whole games through the wire, every field as it was', () => {
    let ones = 0
    for (let seed = 1; seed <= 12; seed++) {
      const g = playOut(seed)
      const back = R.decode(JSON.parse(JSON.stringify(R.encode(g))))!
      expect(back).not.toBeNull()
      expect(g.up.some((u) => u !== ALL)).toBe(true)
      ones += g.log.filter((e) => 'dice' in e && e.dice === 1).length
      for (const k of ['up', 'turn', 'due', 'n', 'dice', 'log'] as const)
        expect(back[k]).toEqual(g[k])
    }
    // a fixture that never chose one die would leave that path unplayed
    expect(ones).toBeGreaterThan(0)
  })

  it('refuses a log no rolls and decisions could make', () => {
    const g = playOut(2)
    const w = R.encode(g) as { log: number[][] }
    expect(
      replay({
        log: [
          [4, 5],
          [0, bit(8)],
        ],
      }),
    ).toBeNull()
    expect(replay({ log: [[4]] })).toBeNull()
    expect(
      replay({
        log: [
          [4, 5],
          [9, 1],
        ],
      }),
    ).toBeNull()
    expect(
      replay({
        log: [
          [4, 5],
          [4, 5],
        ],
      }),
    ).toBeNull()
    expect(replay({ log: [[7, 5]] })).toBeNull()
    expect(replay({ log: [...w.log, [3, 3]] })).toBeNull()
    expect(R.readMove({ shut: 0 })).toBeNull()
    expect(R.readMove({ shut: 1024 })).toBeNull()
    expect(R.readMove({ dice: 3 })).toBeNull()
  })
})
