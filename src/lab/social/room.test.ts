import { describe, expect, it } from 'vitest'
import {
  HOLD_MS,
  act,
  hostOf,
  myTurn,
  openRoom,
  present,
  receive,
  seatOf,
  waitingFor,
  type Room,
  type Rules,
  type Wire,
} from './room'

/* a game small enough to read: take 1 or 2 from the pile in turn; whoever reaches 10 wins */
type G = { total: number; turn: 0 | 1 }
const race: Rules<G, number> = {
  fresh: () => ({ total: 0, turn: 0 }),
  turn: (g) => (g.total >= 10 ? null : g.turn),
  legal: (g, m) => g.total < 10 && (m === 1 || m === 2),
  apply: (g, m) => ({ total: g.total + m, turn: g.turn === 0 ? 1 : 0 }),
  encode: (g) => ({ ...g }),
  decode: (x) => {
    const o = x as Partial<G> | null
    return o && Number.isInteger(o.total) && (o.turn === 0 || o.turn === 1)
      ? { total: o.total!, turn: o.turn! }
      : null
  },
  readMove: (x) => (x === 1 || x === 2 ? x : null),
}

/** several people on one toy, and the wire between them */
function party(ids: string[]) {
  const rooms = new Map<string, Room<G>>()
  const wire: { from: string; body: Wire }[] = []
  let now = 0
  for (const id of ids) {
    const s = openRoom(race, 'race', id)
    rooms.set(id, s.room)
    wire.push(...s.out.map((body) => ({ from: id, body })))
  }
  const send = (from: string, out: Wire[]) => wire.push(...out.map((body) => ({ from, body })))
  const net = {
    rooms,
    wire,
    get: (id: string) => rooms.get(id)!,
    /** everybody sees everybody else in `ids` */
    see(here: string[] = [...rooms.keys()]) {
      for (const id of here) {
        const s = present(race, net.get(id), here, now)
        rooms.set(id, s.room)
        send(id, s.out)
      }
    },
    /** deliver everything queued, to everyone but its sender, until the wire is quiet */
    flush(alive: string[] = [...rooms.keys()]) {
      for (let guard = 0; wire.length && guard < 1000; guard++) {
        const { from, body } = wire.shift()!
        for (const id of alive) {
          if (id === from) continue
          const s = receive(race, net.get(id), from, body)
          rooms.set(id, s.room)
          send(id, s.out)
        }
      }
    },
    do(id: string, a: Parameters<typeof act<G, number>>[2]) {
      const s = act(race, net.get(id), a)
      rooms.set(id, s.room)
      send(id, s.out)
    },
    at: (ms: number) => (now = ms),
    agree: (ids2: string[] = [...rooms.keys()]) => {
      const first = net.get(ids2[0])
      return ids2.every((id) => {
        const r = net.get(id)
        return (
          r.seq === first.seq &&
          JSON.stringify([r.seats, r.game]) === JSON.stringify([first.seats, first.game])
        )
      })
    },
  }
  return net
}

describe('a room for two players, with anyone else watching', () => {
  it('two sit, play a whole game, and everybody — the watcher too — ends on the same room', () => {
    const n = party(['ann', 'bo', 'cy'])
    n.see()
    n.flush()
    n.do('bo', { t: 'sit', seat: 0 })
    n.do('cy', { t: 'sit', seat: 1 })
    n.flush()
    expect(n.get('ann').seats).toEqual(['bo', 'cy'])
    // bo and cy alternate 2s until somebody reaches 10
    for (let i = 0; i < 10 && race.turn(n.get('ann').game) !== null; i++) {
      const who = race.turn(n.get('ann').game) === 0 ? 'bo' : 'cy'
      expect(myTurn(race, n.get(who))).toBe(true)
      n.do(who, { t: 'move', move: 2 })
      n.flush()
    }
    expect(n.get('ann').game.total).toBe(10)
    expect(n.agree()).toBe(true)
  })
  it('the host is the lowest id present, seated or not, and everyone agrees who it is', () => {
    const n = party(['cy', 'ann', 'bo'])
    n.see()
    for (const id of ['ann', 'bo', 'cy']) expect(hostOf(n.get(id))).toBe('ann')
  })
  it('refuses a move out of turn, a move from a watcher, and an illegal move', () => {
    const n = party(['ann', 'bo', 'cy'])
    n.see()
    n.flush()
    n.do('ann', { t: 'sit', seat: 0 })
    n.do('bo', { t: 'sit', seat: 1 })
    n.flush()
    const before = n.get('ann').seq
    n.do('bo', { t: 'move', move: 1 }) // not bo's turn
    n.do('cy', { t: 'move', move: 1 }) // a watcher
    n.flush()
    expect(n.get('ann').seq).toBe(before)
    // and a crafted message straight onto the wire fares no better
    n.wire.push({ from: 'cy', body: { sub: 'race', t: 'move', at: before, move: 1 } })
    n.wire.push({ from: 'ann', body: { sub: 'race', t: 'move', at: before, move: 5 } })
    // and the host's own illegal move goes nowhere either
    n.do('ann', { t: 'move', move: 5 })
    // bo is seated, but it is not his turn: the host refuses it even straight off the wire
    n.wire.push({ from: 'bo', body: { sub: 'race', t: 'move', at: before, move: 1 } })
    n.flush()
    expect(n.get('ann').game.total).toBe(0)
  })
  it('ignores a move made against a board that has since changed', () => {
    const n = party(['ann', 'bo'])
    n.see()
    n.flush()
    n.do('bo', { t: 'sit', seat: 0 })
    n.do('ann', { t: 'sit', seat: 1 })
    n.flush()
    n.do('bo', { t: 'move', move: 2 })
    n.flush()
    n.do('ann', { t: 'move', move: 1 })
    n.flush()
    // bo's move is on its way when ann (the host) starts a new game — which is bo's turn again,
    // so only the board it was made against tells the host it is not a move for this game
    n.do('bo', { t: 'move', move: 2 })
    const inFlight = n.wire.splice(0)
    n.do('ann', { t: 'new' })
    n.wire.push(...inFlight)
    n.flush()
    expect(n.get('ann').game.total).toBe(0)
    expect(n.agree()).toBe(true)
  })
  it('a repeated or late state changes nothing, and a lost one is mended by the next', () => {
    const n = party(['ann', 'bo'])
    n.see()
    n.flush()
    n.do('ann', { t: 'sit', seat: 0 })
    n.flush()
    const old = {
      sub: 'race',
      t: 'state' as const,
      seq: 1,
      seats: ['ann', null] as [string, null],
      mode: 'versus' as const,
      level: 0,
      next: 0 as const,
      game: { total: 0, turn: 0 },
    }
    n.do('bo', { t: 'sit', seat: 1 })
    n.flush()
    n.do('ann', { t: 'move', move: 2 })
    // lose this one entirely
    n.wire.length = 0
    n.do('bo', { t: 'move', move: 1 }) // bo still thinks it is ann's turn: refused locally
    n.do('ann', { t: 'new' }) // the next state carries everything
    n.flush()
    expect(n.agree()).toBe(true)
    // the stale state arrives now
    n.wire.push({ from: 'ann', body: old })
    n.flush()
    expect(n.get('bo').seats).toEqual(['ann', 'bo'])
  })
  it('two people taking the same seat at once: one gets it, and everybody agrees which', () => {
    const n = party(['ann', 'bo', 'cy'])
    n.see()
    n.flush()
    n.do('bo', { t: 'sit', seat: 0 })
    n.do('cy', { t: 'sit', seat: 0 })
    n.flush()
    // the host hears bo first, so bo has it; cy's ask arrives at a taken seat and is refused
    expect(n.get('ann').seats).toEqual(['bo', null])
    expect(n.agree()).toBe(true)
  })
  it('a seat somebody holds is not taken from them', () => {
    const n = party(['ann', 'bo', 'cy'])
    n.see()
    n.flush()
    n.do('bo', { t: 'sit', seat: 0 })
    n.flush()
    n.do('cy', { t: 'sit', seat: 0 })
    n.do('ann', { t: 'sit', seat: 0 }) // the host too
    n.flush()
    expect(n.get('cy').seats).toEqual(['bo', null])
  })
  it('somebody arriving late says hello and is handed the room', () => {
    const n = party(['ann', 'bo'])
    n.see()
    n.flush()
    n.do('ann', { t: 'sit', seat: 0 })
    n.do('bo', { t: 'sit', seat: 1 })
    n.flush()
    n.do('ann', { t: 'move', move: 2 })
    n.flush()
    const s = openRoom(race, 'race', 'dee')
    n.rooms.set('dee', s.room)
    n.wire.push(...s.out.map((body) => ({ from: 'dee', body })))
    n.see()
    n.flush()
    expect(n.get('dee').game.total).toBe(2)
    expect(n.agree()).toBe(true)
  })
})

describe('two hosts for a moment', () => {
  it('when a call splits in two, each half crowns a host; once they meet, the lower id’s room wins', () => {
    const n = party(['ann', 'bo', 'cy', 'dee'])
    n.see()
    n.flush()
    n.do('bo', { t: 'sit', seat: 0 })
    n.do('cy', { t: 'sit', seat: 1 })
    n.flush()
    // {ann, bo} and {cy, dee} stop seeing each other; each half has its own host (ann, cy)
    n.see(['ann', 'bo'])
    n.see(['cy', 'dee'])
    // and each changes the room once, to the same seq: bo stands up in one, cy in the other
    n.do('bo', { t: 'stand' })
    n.flush(['ann', 'bo'])
    n.do('cy', { t: 'stand' })
    n.flush(['cy', 'dee'])
    expect(n.get('ann').seq).toBe(n.get('cy').seq)
    expect(n.get('ann').seats).not.toEqual(n.get('cy').seats)
    // together again: ann is host of the whole call, and her room is the one everybody keeps
    n.see()
    n.flush()
    expect(n.agree()).toBe(true)
    expect(n.get('dee').seats).toEqual([null, 'cy'])
    // and a copy of cy's room from before, arriving late at dee alone, does not split them again
    const late = {
      sub: 'race',
      t: 'state' as const,
      seq: n.get('dee').seq,
      seats: ['bo', null] as [string, null],
      mode: 'versus' as const,
      level: 0,
      next: 0 as const,
      game: { total: 0, turn: 0 as const },
    }
    n.wire.push({ from: 'cy', body: late })
    n.flush(['dee'])
    expect(n.get('dee').seats).toEqual([null, 'cy'])
  })
})

describe('when somebody goes', () => {
  const seated = () => {
    const n = party(['ann', 'bo', 'cy'])
    n.see()
    n.flush()
    n.do('bo', { t: 'sit', seat: 0 })
    n.do('cy', { t: 'sit', seat: 1 })
    n.flush()
    n.do('bo', { t: 'move', move: 1 })
    n.flush()
    return n
  }
  it('a missing player pauses the game, and coming back carries on', () => {
    const n = seated()
    n.see(['ann', 'bo']) // cy's tab is gone
    expect(waitingFor(n.get('bo'), race)).toBe('cy')
    expect(myTurn(race, n.get('bo'))).toBe(false)
    n.see(['ann', 'bo', 'cy'])
    n.flush()
    expect(waitingFor(n.get('bo'), race)).toBeNull()
    n.do('cy', { t: 'move', move: 2 })
    n.flush()
    expect(n.get('ann').game.total).toBe(3)
  })
  it('the host leaving hands the room to the next lowest id, which carries on from where it was', () => {
    const n = seated()
    // ann was host; she goes, bo becomes host with the room he already holds
    n.see(['bo', 'cy'])
    n.flush(['bo', 'cy'])
    expect(hostOf(n.get('bo'))).toBe('bo')
    n.do('cy', { t: 'move', move: 2 })
    n.flush(['bo', 'cy'])
    expect(n.get('bo').game.total).toBe(3)
    expect(n.agree(['bo', 'cy'])).toBe(true)
  })
  it('a seat is held for a minute, then freed for somebody watching', () => {
    const n = seated()
    n.at(0)
    n.see(['ann', 'bo'])
    n.at(HOLD_MS - 1)
    n.see(['ann', 'bo'])
    n.flush(['ann', 'bo'])
    expect(n.get('ann').seats[1]).toBe('cy')
    n.at(HOLD_MS)
    n.see(['ann', 'bo'])
    n.flush(['ann', 'bo'])
    expect(n.get('bo').seats).toEqual(['bo', null])
    n.do('ann', { t: 'sit', seat: 1 })
    n.flush(['ann', 'bo'])
    expect(n.get('bo').seats).toEqual(['bo', 'ann'])
  })
})

describe('somebody else’s message', () => {
  it('nothing malformed is believed', () => {
    const n = party(['ann', 'bo'])
    n.see()
    n.flush()
    const r = n.get('bo')
    for (const body of [
      null,
      'state',
      { sub: 'other', t: 'state', seq: 9, seats: [null, null], game: { total: 0, turn: 0 } },
      { sub: 'race', t: 'state', seq: 9, seats: ['x'], game: { total: 0, turn: 0 } },
      { sub: 'race', t: 'state', seq: 9, seats: [null, null], game: { total: 'lots', turn: 0 } },
      { sub: 'race', t: 'state', seq: 1.5, seats: [null, null], game: { total: 0, turn: 0 } },
      { sub: 'race', t: 'sit', seat: 3 },
    ])
      expect(receive(race, r, 'ann', body).room).toBe(r)
    expect(seatOf(r)).toBeNull()
  })
})

/* what an arrival cost BEFORE the fix, counted on this file's own wire on 23 Nov 2026: a higher id
   joining a game is 3 sends, four people filling a fresh toy lowest first is 10. The fix may add
   nothing to either. */
const HIGH_ID_ARRIVAL = 3
const FRESH_FOUR = 10

describe('somebody with a lower id joining a game in progress', () => {
  /**
   * Presence makes them host the moment their `where` lands — before their own room exists,
   * because the toy's code mounts after. Their room is fresh, so until somebody hands them the real
   * one they would lead from an empty board and refuse every move. Who answers their hello is the
   * whole fix: the host as it was before they arrived, or whoever published the room we hold.
   */
  type Net = ReturnType<typeof party>
  /** Bo and Cy sitting at a game three moves in */
  const playing = () => {
    const n = party(['bo', 'cy'])
    n.see()
    n.flush()
    n.do('bo', { t: 'sit', seat: 0 })
    n.flush()
    n.do('cy', { t: 'sit', seat: 1 })
    n.flush()
    n.do('bo', { t: 'move', move: 2 })
    n.flush()
    return n
  }
  /** `x`'s `where` lands: everybody already on the toy counts them present */
  const arrives = (n: Net, x: string, also: string[] = []) => {
    const here = [...n.rooms.keys(), x, ...also]
    for (const id of n.rooms.keys()) {
      const s = present(race, n.get(id), here, 0)
      n.rooms.set(id, s.room)
      n.wire.push(...s.out.map((body) => ({ from: id, body })))
    }
    n.flush()
  }
  /** `x`'s toy mounts: its room opens, says hello and sees who is here */
  const opens = (n: Net, x: string, here: string[]) => {
    const o = openRoom(race, 'race', x)
    n.rooms.set(x, o.room)
    n.wire.push(...o.out.map((body) => ({ from: x, body })))
    const s = present(race, o.room, here, 0)
    n.rooms.set(x, s.room)
    n.wire.push(...s.out.map((body) => ({ from: x, body })))
    n.flush()
  }
  /** Cy moves: does it land, on everybody's board? */
  const cyMoves = (n: Net) => {
    const before = n.get('cy').game.total
    n.do('cy', { t: 'move', move: 1 })
    n.flush()
    return n.get('cy').game.total === before + 1 && n.agree()
  }

  it('one arriving after their where: handed the room, and the game goes on', () => {
    const n = playing()
    arrives(n, 'ann')
    opens(n, 'ann', ['ann', 'bo', 'cy'])
    expect(n.get('ann').seq).toBe(n.get('bo').seq)
    expect(n.get('ann').game.total).toBe(2)
    expect(cyMoves(n)).toBe(true)
  })
  it('two arriving together, in either order their toys open', () => {
    for (const order of [
      ['a1', 'a2'],
      ['a2', 'a1'],
    ]) {
      const n = playing()
      arrives(n, 'a1', ['a2'])
      arrives(n, 'a2', ['a1'])
      for (const x of order) opens(n, x, ['a1', 'a2', 'bo', 'cy'])
      expect(n.agree()).toBe(true)
      expect(cyMoves(n)).toBe(true)
    }
  })
  it('the host who published the room has gone: whoever leads now hands it on', () => {
    const n = playing()
    /* Bo leaves; Cy leads, holding the room Bo last published */
    n.rooms.delete('bo')
    const s = present(race, n.get('cy'), ['cy'], 0)
    n.rooms.set('cy', s.room)
    expect(n.get('cy').from).toBe('bo')
    arrives(n, 'ann')
    opens(n, 'ann', ['ann', 'cy'])
    expect(n.get('ann').game.total).toBe(2)
    expect(n.agree()).toBe(true)
  })
  it('somebody whose hello arrives before their where is handed the room as before', () => {
    const n = playing()
    opens(n, 'ann', ['ann', 'bo', 'cy'])
    arrives(n, 'ann')
    expect(n.get('ann').game.total).toBe(2)
    expect(cyMoves(n)).toBe(true)
  })
  it('costs nothing more: a higher id arriving, and a fresh toy filling up', () => {
    /* every message anybody puts on the wire, counted where it is queued */
    const counting = (n: Net) => {
      const push = n.wire.push.bind(n.wire)
      const c = { sent: 0 }
      n.wire.push = (...xs) => {
        c.sent += xs.length
        return push(...xs)
      }
      return c
    }
    const n = playing()
    const c = counting(n)
    arrives(n, 'dee')
    opens(n, 'dee', ['bo', 'cy', 'dee'])
    expect(n.get('dee').game.total).toBe(2)
    expect(c.sent).toBe(HIGH_ID_ARRIVAL)
    const f = party([])
    const d = counting(f)
    const ids: string[] = []
    for (const x of ['a', 'b', 'c', 'd']) {
      ids.push(x)
      arrives(f, x)
      opens(f, x, [...ids])
    }
    expect(f.agree()).toBe(true)
    expect(d.sent).toBe(FRESH_FOUR)
  })
})
