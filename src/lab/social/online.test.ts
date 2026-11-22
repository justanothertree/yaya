import { describe, expect, it } from 'vitest'
import { ONLINE_KEY, onlineLine, readOnline, recordOnline } from './online'

const kept = (o: unknown) => (k: string) => (k === ONLINE_KEY ? JSON.stringify(o) : null)

describe('games finished in a call, kept per toy', () => {
  it('adds a game to the right toy, mode and result, and reads back exactly what it wrote', () => {
    let o = recordOnline({}, 'reversi', 'versus', 'won')
    o = recordOnline(o, 'reversi', 'versus', 'lost')
    o = recordOnline(o, 'reversi', 'versus', 'drawn')
    o = recordOnline(o, 'reversi', 'together', 'won')
    o = recordOnline(o, 'chess', 'together', 'lost')
    expect(o).toEqual({
      reversi: { versus: { won: 1, lost: 1, drawn: 1 }, together: { won: 1, lost: 0, drawn: 0 } },
      chess: { together: { won: 0, lost: 1, drawn: 0 } },
    })
    expect(readOnline(JSON.stringify(o))).toEqual(o)
  })
  it('refuses what it did not write', () => {
    expect(readOnline(null)).toEqual({})
    expect(readOnline('{')).toEqual({})
    expect(readOnline('[1]')).toEqual({})
    expect(
      readOnline(
        JSON.stringify({
          'Bad Id': { versus: { won: 1 } },
          ok: { versus: { won: -1, lost: 1.5, drawn: 'x' }, other: { won: 3 } },
          fine: { together: { won: 2 } },
        }),
      ),
    ).toEqual({ fine: { together: { won: 2, lost: 0, drawn: 0 } } })
  })
  it('words the online part of a card, and says nothing until something is won', () => {
    const o = {
      reversi: { versus: { won: 3, lost: 1, drawn: 1 }, together: { won: 1, lost: 2, drawn: 0 } },
      lamps: { together: { won: 4, lost: 0, drawn: 0 } },
      chess: { versus: { won: 0, lost: 2, drawn: 0 } },
    }
    expect(onlineLine(kept(o), 'reversi')).toBe(
      'beat friends in 3 of 5 online games (1 drawn), won 1 of 3 online games together against the computer',
    )
    expect(onlineLine(kept(o), 'lamps', 'on the day’s board')).toBe(
      'won 4 of 4 online games together on the day’s board',
    )
    expect(onlineLine(kept(o), 'chess')).toBeNull()
    expect(onlineLine(kept(o), 'go')).toBeNull()
    expect(onlineLine(() => null, 'reversi')).toBeNull()
  })
})
