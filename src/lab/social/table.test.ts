import { describe, expect, it } from 'vitest'
import type { Room, Rules } from './room'
import { tableLine, tableSeats, type Table } from './table'

/*
 * Every line a table can show, asked of the pure function the toys draw it from. The race to 10
 * from room.test.ts, with a computer on side 1 and a result, and a pile anybody adds to.
 */
type G = { total: number; turn: 0 | 1 }
const race: Rules<G, number> = {
  fresh: () => ({ total: 0, turn: 0 }),
  turn: (g) => (g.total >= 10 ? null : g.turn),
  legal: (g, m) => g.total < 10 && (m === 1 || m === 2),
  apply: (g, m) => ({ total: g.total + m, turn: g.turn === 0 ? 1 : 0 }),
  encode: (g) => g,
  decode: (x) => x as G,
  readMove: (x) => (x === 1 || x === 2 ? x : null),
  modes: ['versus', 'together'],
  computer: { side: 1, levels: ['easy'], choose: () => 1 },
  // whoever moved last reached 10: the side that is NOT on turn
  result: (g) => (g.total === 11 ? 'draw' : g.total >= 10 ? (g.turn === 0 ? 1 : 0) : null),
}
const versusOnly: Rules<G, number> = { ...race, modes: undefined, computer: undefined }
type P = { n: number }
const pile: Rules<P, number> = {
  fresh: () => ({ n: 0 }),
  turn: (g) => (g.n >= 3 ? null : 'any'),
  legal: () => true,
  apply: (g) => ({ n: g.n + 1 }),
  encode: (g) => g,
  decode: (x) => x as P,
  readMove: () => 1,
  modes: ['versus', 'together'],
  result: (g) => (g.n >= 3 ? 0 : null),
}

function table<T>(room: Partial<Room<T>> & { game: T }, live = true): Table<T, number> {
  return {
    live,
    room: {
      sub: 'x',
      me: 'ann',
      seq: 3,
      from: 'ann',
      seats: ['ann', 'bo'],
      mode: 'versus',
      level: 0,
      next: 0,
      present: ['bo', 'cy'],
      missing: {},
      ...room,
    },
    act: () => {},
    names: { bo: 'Bo', cy: 'Cy' },
  }
}
const at = (total: number, turn: 0 | 1 = 0): G => ({ total, turn })

describe('the line under a table', () => {
  it('before there is a room, and once the call has gone', () => {
    expect(tableLine({ live: false, room: null, act: () => {}, names: {} }, race)).toBe(
      'Joining the call’s game…',
    )
    // seated and mid-game: offered to carry on; watching: told only
    expect(tableLine(table({ game: at(4) }, false), race)).toBe(
      'The call’s game has stopped — carry on from here.',
    )
    expect(tableLine(table({ game: at(4), seats: ['bo', 'cy'] }, false), race)).toBe(
      'The call’s game has stopped.',
    )
  })
  it('somebody seated has gone', () => {
    expect(tableLine(table({ game: at(4), present: ['cy'] }), race)).toBe('Waiting for Bo…')
  })
  it('nobody seated, and one seat of two', () => {
    expect(tableLine(table({ game: at(0), seats: [null, null] }), race)).toBe(
      'Take a seat, then pick ⚔️ Versus or 🤝 Together (together against the computer). Anyone else watches.',
    )
    expect(
      tableLine(table({ game: at(0), seats: [null, null] }), race, { together: 'one board' }),
    ).toContain('(one board)')
    expect(tableLine(table({ game: at(0), seats: [null, null] }), versusOnly)).toBe(
      'Take a seat to play; anyone else in the call watches.',
    )
    expect(tableLine(table({ game: at(0), seats: ['ann', null] }), race)).toBe(
      'Waiting for somebody to take the other seat.',
    )
    expect(tableLine(table({ game: at(0), seats: [null, 'bo'] }), race)).toBe(
      'Take the other seat to play.',
    )
  })
  it('whose move it is, in versus and together, and the computer’s', () => {
    expect(tableLine(table({ game: at(4, 0) }), race)).toBe('Your turn.')
    expect(tableLine(table({ game: at(4, 1) }), race)).toBe('Bo’s turn.')
    expect(tableLine(table({ game: at(4, 0), mode: 'together', next: 0 }), race)).toBe(
      'Your move for the team.',
    )
    expect(tableLine(table({ game: at(4, 0), mode: 'together', next: 1 }), race)).toBe('Bo’s turn.')
    expect(tableLine(table({ game: at(4, 1), mode: 'together' }), race)).toBe(
      'The computer is thinking…',
    )
  })
  it('a game anybody may move in, in the toy’s words or the table’s', () => {
    expect(tableLine(table({ game: { n: 1 }, mode: 'together' }), pile)).toBe(
      'Play whenever you like.',
    )
    expect(
      tableLine(table({ game: { n: 1 }, mode: 'together' }), pile, { anyTime: 'Any lamp.' }),
    ).toBe('Any lamp.')
  })
  it('a finished game: who won, from each side of it, with the toy’s own score words', () => {
    const score = () => ', 10 to 8'
    expect(tableLine(table({ game: at(10, 1) }), race, { score })).toBe('🏆 You win, 10 to 8!')
    expect(tableLine(table({ game: at(10, 0) }), race, { score })).toBe('🏆 Bo wins, 10 to 8!')
    expect(tableLine(table({ game: at(10, 1), me: 'cy', present: ['ann', 'bo'] }), race)).toBe(
      '🏆 A friend wins!',
    )
    // the loser leaving afterwards does not take the result away: nobody is waited for after the end
    expect(tableLine(table({ game: at(10, 1), present: ['cy'] }), race, { score })).toBe(
      '🏆 You win, 10 to 8!',
    )
    expect(tableLine(table({ game: at(11, 0) }), race, { score })).toBe('A draw, 10 to 8.')
  })
  it('a finished game together: beaten or not, as a player and as a watcher', () => {
    const won = at(10, 1) // the team (side 0) moved last
    const lost = at(10, 0)
    expect(tableLine(table({ game: won, mode: 'together' }), race)).toBe(
      '🏆 You beat the computer together!',
    )
    expect(
      tableLine(table({ game: won, mode: 'together', me: 'cy', present: ['ann', 'bo'] }), race),
    ).toBe('🏆 A friend and Bo beat the computer together!')
    expect(tableLine(table({ game: lost, mode: 'together' }), race)).toBe('The computer wins.')
    expect(tableLine(table({ game: { n: 3 }, mode: 'together' }), pile)).toBe(
      '🏆 You did it together!',
    )
  })
})

describe('who is who at a table', () => {
  it('names, my seat, and who is waited for', () => {
    const s = tableSeats(table({ game: at(4), present: ['cy'] }), race)
    expect([s.who('ann'), s.who('bo'), s.who('zed'), s.who(null)]).toEqual([
      'You',
      'Bo',
      'A friend',
      'Empty seat',
    ])
    expect(s.mySeat).toBe(0)
    expect(s.waiting).toBe('bo')
    expect(s.leftAlone).toBe(true)
  })
  it('a watcher is never left alone, and a finished game has nobody to carry on', () => {
    expect(tableSeats(table({ game: at(4), me: 'cy' }, false), race).leftAlone).toBe(false)
    expect(tableSeats(table({ game: at(10, 1) }, false), race).leftAlone).toBe(false)
  })
})
