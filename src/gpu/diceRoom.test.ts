import { describe, expect, it } from 'vitest'
import { TARGET, chooseKeep, scoreOf } from './dice'
import { MAX_TURNS, diceRules as R, replay, roll, type DiceGame } from './diceRoom'

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
/** a whole game of sensible decisions, rolled as the server rolls */
function playOut(seed: number) {
  const rnd = seeded(seed)
  let g = roll(R.fresh(), rnd)
  // bounded, so a broken rule fails here rather than spinning for ever
  for (let k = 0; k < 5000 && g.turn !== null; k++) {
    const keep = chooseKeep(g.table!)
    const made = g.points + scoreOf(keep.map((k) => g.table![k]))!
    // bank at 350, but never on hot dice: all six free again is always rolled, so it is played
    const hot = g.free - keep.length === 0
    g = roll(R.apply(g, { keep, bank: made >= 350 && !hot }), rnd)
  }
  if (g.turn !== null) throw new Error('the game never finished')
  return g
}

describe('ten thousand by turns: the server rolls', () => {
  it('plays a roll that scores nothing as the end of the turn, and rolls for the other side', () => {
    // 2 2 3 3 4 6: no 1, no 5, no three alike, only two pairs — nothing; then 1 2 3 4 6 6
    const g = roll(R.fresh(), loaded(2, 2, 3, 3, 4, 6, 1, 2, 3, 4, 6, 6))
    expect(g.turns).toBe(1)
    expect(g.turn).toBe(1)
    expect(g.scores).toEqual([0, 0])
    expect(g.table).toEqual([1, 2, 3, 4, 6, 6])
  })

  it('sets aside only dice that score, banks what the turn made, and frees all six on hot dice', () => {
    let g = roll(R.fresh(), loaded(1, 5, 2, 3, 4, 6))
    expect(R.legal(g, { keep: [2], bank: false })).toBe(false)
    expect(R.legal(g, { keep: [0, 2], bank: false })).toBe(false)
    g = R.apply(g, { keep: [0], bank: false })
    expect(g).toMatchObject({ table: null, points: 100, free: 5, turn: 0 })
    // five dice: 5 5 5 1 1 — all of them, hot dice: six free again
    g = roll(g, loaded(5, 5, 5, 1, 1))
    g = R.apply(g, { keep: [0, 1, 2, 3, 4], bank: false })
    expect(g).toMatchObject({ points: 100 + 500 + 200, free: 6 })
    g = roll(g, loaded(1, 2, 3, 4, 6, 6))
    g = R.apply(g, { keep: [0], bank: true })
    expect(g.scores).toEqual([900, 0])
    expect(g.turn).toBe(1)
  })

  it('round-trips whole games through the wire, every field as it was', () => {
    let busts = 0
    let hot = 0
    for (let seed = 1; seed <= 10; seed++) {
      const g = playOut(seed)
      const back = R.decode(JSON.parse(JSON.stringify(R.encode(g))))!
      expect(back).not.toBeNull()
      // a finished game, a winner past the target, with busts and hot dice in it
      expect(g.winner === 0 || g.winner === 1).toBe(true)
      expect(g.scores[g.winner as 0 | 1]).toBeGreaterThanOrEqual(TARGET)
      for (const k of [
        'scores',
        'turn',
        'table',
        'points',
        'free',
        'log',
        'turns',
        'winner',
      ] as const)
        expect(back[k]).toEqual(g[k])
      // a bust is a roll followed straight by another; hot dice, six rolled after rolling on
      g.log.forEach((e, k) => {
        const next = g.log[k + 1]
        if ('roll' in e && next && 'roll' in next) busts++
        const prev = g.log[k - 1]
        if ('roll' in e && e.roll.length === 6 && prev && 'keep' in prev && !prev.bank) hot++
      })
    }
    expect(busts).toBeGreaterThan(0)
    expect(hot).toBeGreaterThan(0)
  })

  it('refuses a log no rolls and decisions could make', () => {
    const g: DiceGame = playOut(4)
    const w = R.encode(g) as { log: number[][] }
    // a die of seven; a roll of the wrong number of dice; two rolls with dice already on the table
    expect(replay({ log: [[7, 1, 1, 1, 1, 1]] })).toBeNull()
    expect(replay({ log: [[1, 1, 1, 1, 1]] })).toBeNull()
    expect(
      replay({
        log: [
          [1, 2, 3, 4, 6, 6],
          [1, 2, 3, 4, 6, 6],
        ],
      }),
    ).toBeNull()
    // a decision with nothing on the table, one keeping a die that does not score, and the same
    // position twice
    expect(replay({ log: [[0, 1, 0]] })).toBeNull()
    expect(
      replay({
        log: [
          [1, 2, 3, 4, 6, 6],
          [0, 1, 1],
        ],
      }),
    ).toBeNull()
    expect(
      replay({
        log: [
          [1, 2, 3, 4, 6, 6],
          [0, 1, 0, 0],
        ],
      }),
    ).toBeNull()
    // anything after the game was won, and a game longer than any
    expect(replay({ log: [...w.log, [1, 1, 1, 1, 1, 1]] })).toBeNull()
    expect(replay({ log: Array(MAX_TURNS * 20 + 1).fill([1, 1, 1, 1, 1, 1]) })).toBeNull()
    // and a decision's own shape
    expect(R.readMove({ keep: [], bank: true })).toBeNull()
    expect(R.readMove({ keep: [6], bank: true })).toBeNull()
    expect(R.readMove({ keep: [0], bank: 'yes' })).toBeNull()
    expect(R.readMove({ keep: [2, 0], bank: false })).toEqual({ keep: [0, 2], bank: false })
  })
})
