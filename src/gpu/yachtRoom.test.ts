import { describe, expect, it } from 'vitest'
import { CATS, chooseBox, chooseKeep, total } from './yacht'
import { yachtRules as R, replay, roll, type YachtGame } from './yachtRoom'

function seeded(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}
/** dice that come up as listed */
const loaded = (...faces: number[]) => {
  let k = 0
  return () => (faces[k++ % faces.length] - 1) / 6 + 0.01
}
/** a whole game, both sides deciding as Hard does, rolled as the server rolls; bounded */
function playOut(seed: number) {
  const rnd = seeded(seed)
  let y = roll(R.fresh(), rnd)
  for (let k = 0; k < 400 && !y.g.over; k++) {
    const { dice, cards, rolls, turn } = y.g
    const keep = rolls > 0 ? chooseKeep(dice, cards[turn], rolls, 'hard') : null
    const m =
      keep && !keep.every(Boolean) ? { hold: keep } : { box: chooseBox(dice, cards[turn], 'hard') }
    y = roll(R.apply(y, m), rnd)
  }
  if (!y.g.over) throw new Error('the game never finished')
  return y
}

describe('yacht by turns: the server rolls', () => {
  it('rolls at the start of a turn and after every hold, keeping the held dice, three rolls at most', () => {
    let y = roll(R.fresh(), loaded(6, 6, 2, 3, 6))
    expect(y.g.dice).toEqual([6, 6, 2, 3, 6])
    expect(R.legal(y, { box: 'yacht' })).toBe(true)
    y = R.apply(y, { hold: [true, true, false, false, true] })
    expect(y.need).toBe(true)
    // before the server rolls, nothing more may be decided
    expect(R.legal(y, { box: 'sixes' })).toBe(false)
    y = roll(y, loaded(6, 1))
    expect(y.g.dice).toEqual([6, 6, 6, 1, 6])
    y = roll(R.apply(y, { hold: [true, true, true, false, true] }), loaded(6))
    expect(y.g.dice).toEqual([6, 6, 6, 6, 6])
    expect(y.g.rolls).toBe(0)
    // no roll left: only a box
    expect(R.legal(y, { hold: [true, false, false, false, false] })).toBe(false)
    y = R.apply(y, { box: 'yacht' })
    expect(y.g.cards[0].yacht).toBe(50)
    expect(y.g.turn).toBe(1)
    // the same box twice is refused, when it comes round again
    expect(R.legal({ ...y, g: { ...y.g, turn: 0, rolls: 2 } }, { box: 'yacht' })).toBe(false)
    // holding all five rolls nothing, so it is not a move
    const z = roll(R.fresh(), loaded(1, 2, 3, 4, 5))
    expect(R.legal(z, { hold: [true, true, true, true, true] })).toBe(false)
  })

  it('round-trips whole games through the wire, every field as it was', () => {
    for (let seed = 1; seed <= 8; seed++) {
      const y = playOut(seed)
      const back = R.decode(JSON.parse(JSON.stringify(R.encode(y))))!
      expect(back).not.toBeNull()
      // a finished game: both cards full, held marks and rolls left in it
      for (const c of y.g.cards) expect(Object.keys(c).sort()).toEqual([...CATS].sort())
      expect(total(y.g.cards[0]) + total(y.g.cards[1])).toBeGreaterThan(0)
      expect(y.log.some((e) => 'hold' in e)).toBe(true)
      for (const k of ['g', 'need', 'log'] as const) expect(back[k]).toEqual(y[k])
    }
  })

  it('refuses a log no rolls and decisions could make', () => {
    const y: YachtGame = playOut(3)
    const w = R.encode(y) as { log: number[][] }
    // a roll that moves a held die; a roll when none is due; a seven
    expect(
      replay({
        log: [
          [6, 6, 2, 3, 6],
          [0, 1, 1, 0, 0, 1],
          [5, 6, 1, 1, 6],
        ],
      }),
    ).toBeNull()
    expect(
      replay({
        log: [
          [6, 6, 2, 3, 6],
          [1, 1, 1, 1, 1],
        ],
      }),
    ).toBeNull()
    expect(replay({ log: [[7, 6, 2, 3, 6]] })).toBeNull()
    // a decision before any roll, holding all five, a box that is not one, a box filled twice
    expect(replay({ log: [[9, 0]] })).toBeNull()
    expect(
      replay({
        log: [
          [6, 6, 2, 3, 6],
          [0, 1, 1, 1, 1, 1],
        ],
      }),
    ).toBeNull()
    expect(
      replay({
        log: [
          [6, 6, 2, 3, 6],
          [9, 12],
        ],
      }),
    ).toBeNull()
    expect(
      replay({
        log: [
          [6, 6, 2, 3, 6],
          [9, 0],
          [1, 1, 1, 1, 1],
          [9, 0],
          [1, 1, 1, 1, 1],
          [9, 0],
        ],
      }),
    ).toBeNull()
    // anything after the game is over
    expect(replay({ log: [...w.log, [1, 1, 1, 1, 1]] })).toBeNull()
    expect(R.readMove({ hold: [true, false] })).toBeNull()
    expect(R.readMove({ box: 'bonus' })).toBeNull()
    expect(R.readMove({ box: 'full' })).toEqual({ box: 'full' })
  })
})
