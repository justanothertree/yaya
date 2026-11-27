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
  it("a seat is freed a minute on whatever its player's id is, the names of an object's own keys included", () => {
    /* review of 26 Nov 2026: `missing` was a plain object, so an id that names one of
       Object.prototype's keys read back an inherited value and its seat was held for ever. Only a
       modified client can be called that, and it is the same minute as anybody's */
    for (const id of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
      /* '00' hosts and watches, below every name here, and '01' plays the other seat */
      const n = party(['00', id, '01'])
      n.see()
      n.flush()
      n.do(id, { t: 'sit', seat: 0 })
      n.do('01', { t: 'sit', seat: 1 })
      n.flush()
      expect(n.get('00').seats, id).toEqual([id, '01'])
      for (const ms of [0, HOLD_MS]) {
        n.at(ms)
        n.see(['00', '01'])
        n.flush(['00', '01'])
      }
      expect(n.get('01').seats, id).toEqual([null, '01'])
      /* and a newcomer handed the room before their first look at who is here, so the `missing`
         they start from is openRoom's own: they become host and free it a minute on */
      const m = party(['01', id])
      m.see()
      m.flush()
      m.do(id, { t: 'sit', seat: 0 })
      m.flush()
      m.rooms.delete(id)
      const o = openRoom(race, 'race', '00')
      m.rooms.set('00', o.room)
      m.wire.push(...o.out.map((body) => ({ from: '00', body })))
      m.flush()
      expect(m.get('00').seats, id).toEqual([id, null])
      for (const ms of [1, HOLD_MS + 1]) {
        m.at(ms)
        m.see(['00', '01'])
        m.flush()
      }
      expect(m.get('01').seats, id).toEqual([null, null])
    }
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
  /**
   * Ann's where lands and her toy mounts, but Bo, who hosted before her, has closed his before her
   * hello reaches him: answersHello made it his to answer
   */
  const unanswered = () => {
    const n = playing()
    arrives(n, 'ann')
    n.rooms.delete('bo')
    opens(n, 'ann', ['ann', 'bo', 'cy'])
    return n
  }
  /** a room as a state on the wire, at its own seq or another */
  const stateOf = (r: Room<G>, seq = r.seq): Wire => ({
    sub: 'race',
    t: 'state',
    seq,
    seats: r.seats,
    mode: r.mode,
    level: r.level,
    next: r.next,
    game: r.game,
  })
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
    /* Cy heard Ann's hello and then Bo's answer to it; and Ann announces her empty room again as
       her roster fills, after that answer (seen on a dev call, 26 Nov 2026). Nobody owes anybody
       at the next tick */
    n.wire.push({ from: 'ann', body: stateOf(openRoom(race, 'race', 'ann').room) })
    n.flush()
    for (const id of ['ann', 'bo', 'cy'])
      expect(present(race, n.get(id), ['ann', 'bo', 'cy'], 5000).out, id).toEqual([])
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
  it('the host before them goes before their hello reaches him: whoever holds the room hands it on at the next tick', () => {
    /* review of 26 Nov 2026 (R1-room): Cy sees Bo still hosting when Ann's hello lands, so by
       answersHello it is Bo's to answer, and Bo has gone. Bo closing the toy, whose `where` then
       reaches Cy by the next tick, and Bo's tab crashing, whose presence lingers for HERE_STALE_MS */
    for (const gone of ['closed', 'crashed']) {
      const n = unanswered()
      // nobody has answered her: she leads from an empty board, and Cy holds the game
      expect(n.get('ann').seq, gone).toBe(0)
      // where.ts's next tick, five seconds on
      const here = gone === 'closed' ? ['ann', 'cy'] : ['ann', 'bo', 'cy']
      for (const id of ['ann', 'cy']) {
        const t = present(race, n.get(id), here, 5000)
        n.rooms.set(id, t.room)
        n.wire.push(...t.out.map((body) => ({ from: id, body })))
      }
      n.flush()
      expect(n.get('ann').game.total, gone).toBe(2)
      expect(n.agree(), gone).toBe(true)
      // and the game goes on under her: Bo's seat is freed a minute after she saw him gone, she
      // sits in it, and it is Cy's move
      for (const ms of [6000, 6000 + HOLD_MS])
        for (const id of ['ann', 'cy']) {
          const t = present(race, n.get(id), ['ann', 'cy'], ms)
          n.rooms.set(id, t.room)
          n.wire.push(...t.out.map((body) => ({ from: id, body })))
          n.flush()
        }
      n.do('ann', { t: 'sit', seat: 0 })
      n.flush()
      expect(n.get('cy').seats, gone).toEqual(['ann', 'cy'])
      expect(cyMoves(n), gone).toBe(true)
      expect(n.get('ann').game.total, gone).toBe(3)
    }
  })
  it('what is owed is paid by that room, or a newer one, reaching me from anybody else', () => {
    const tick = (n: Net) => present(race, n.get('cy'), ['ann', 'cy'], 5000).out
    expect(tick(unanswered())).toHaveLength(1)
    // the same room, from somebody else who held it (Dee, whose tick came first)
    const same = unanswered()
    same.wire.push({ from: 'dee', body: stateOf(same.get('cy')) })
    same.flush(['cy'])
    expect(tick(same)).toEqual([])
    // a newer one, which Cy takes
    const newer = unanswered()
    newer.wire.push({ from: 'dee', body: stateOf(newer.get('cy'), newer.get('cy').seq + 1) })
    newer.flush(['cy'])
    expect(newer.get('cy').from).toBe('dee')
    expect(tick(newer)).toEqual([])
  })
  it('a host carrying on from a room that missed the last state is handed it at the next tick', () => {
    /* Al hosts and watches; the room after Cy's move reaches Cy and is lost on its way to Bo, and
       Al leaves. Bo hosts from the room before it, and says so; Cy holds Al's newer room and owes
       it him. Until now Bo's next room tied Al's at its seq and lost to Al's lower id at Cy, so
       the two of them played on two boards */
    const n = party(['al', 'bo', 'cy'])
    n.see()
    n.flush()
    n.do('bo', { t: 'sit', seat: 0 })
    n.do('cy', { t: 'sit', seat: 1 })
    n.flush()
    n.do('bo', { t: 'move', move: 2 })
    n.flush()
    n.do('cy', { t: 'move', move: 1 })
    n.flush(['al', 'cy'])
    n.wire.length = 0
    n.rooms.delete('al')
    n.see(['bo', 'cy'])
    n.flush()
    expect(n.get('bo').game.total).toBe(2)
    n.see(['bo', 'cy'])
    n.flush()
    expect(n.get('bo').game.total).toBe(3)
    expect(n.agree()).toBe(true)
    n.do('bo', { t: 'move', move: 2 })
    n.flush()
    expect(n.get('cy').game.total).toBe(5)
  })
  it('owing the host and then hosting it: the announcement pays, and nothing goes out again', () => {
    const n = unanswered()
    // Cy owes Ann the game, and Ann closes the toy too before Cy's tick: Cy hosts, and says so
    n.rooms.delete('ann')
    const hosting = present(race, n.get('cy'), ['cy'], 5000)
    expect(hosting.out.map((w) => w.t)).toEqual(['state'])
    // somebody lower's where lands: Cy is not host now, and has nothing left to send
    expect(present(race, hosting.room, ['al', 'cy'], 6000).out).toEqual([])
  })
  it('a late room is not a host behind: the host’s own earlier one, or anybody else’s, costs nothing', () => {
    const n = party(['ann', 'bo', 'cy'])
    n.see()
    n.flush()
    n.do('bo', { t: 'sit', seat: 0 })
    n.flush()
    const early = n.get('cy')
    n.do('cy', { t: 'sit', seat: 1 })
    n.flush()
    n.do('bo', { t: 'move', move: 2 })
    n.flush()
    // a copy of Ann's own earlier room, late, from Ann the host; and the same from Bo, who is not
    for (const from of ['ann', 'bo']) {
      n.wire.push({ from, body: stateOf(early) })
      n.flush(['cy'])
      n.wire.length = 0
      const s = present(race, n.get('cy'), ['ann', 'bo', 'cy'], 5000)
      n.rooms.set('cy', s.room)
      expect(s.out, from).toEqual([])
    }
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
