import { describe, expect, it } from 'vitest'
import {
  HOLD_MS,
  act,
  canMove,
  computerTurn,
  finishedOf,
  idle,
  myTurn,
  openRoom,
  outcomeFor,
  playComputer,
  present,
  receive,
  waitingFor,
  winnersOf,
  type Room,
  type Rules,
  type Wire,
} from './room'
import { solve } from '../../gpu/lamps'
import { lampsRules, startOf } from '../../gpu/lampsRoom'

/*
 * The lobby on top of the two-seat room: versus or together, a computer the host plays, and a game
 * anybody may move in. The race to 10 again (room.test.ts), now with a computer that always takes
 * 1 from side 1, so a team move and a computer move can be told apart by size.
 */
type G = { total: number; turn: 0 | 1; log: string }
const race: Rules<G, number> = {
  fresh: () => ({ total: 0, turn: 0, log: '' }),
  turn: (g) => (g.total >= 10 ? null : g.turn),
  legal: (g, m) => g.total < 10 && (m === 1 || m === 2),
  apply: (g, m, by) => ({ total: g.total + m, turn: g.turn === 0 ? 1 : 0, log: g.log + by + m }),
  encode: (g) => ({ ...g }),
  decode: (x) => {
    const o = x as Partial<G> | null
    return o &&
      Number.isInteger(o.total) &&
      (o.turn === 0 || o.turn === 1) &&
      typeof o.log === 'string'
      ? { total: o.total!, turn: o.turn!, log: o.log! }
      : null
  },
  readMove: (x) => (x === 1 || x === 2 ? x : null),
  modes: ['versus', 'together'],
  computer: {
    side: 1,
    levels: ['soft', 'hard'],
    choose: (_g, level) => (level === 'hard' ? 2 : 1),
  },
  result: (g) => (g.total >= 10 ? (g.turn === 0 ? 1 : 0) : null),
}

/* a game with no turns: everybody adds to one pile, and 'any' seat may at any time */
type P = { pile: number[] }
const pile: Rules<P, number> = {
  fresh: () => ({ pile: [] }),
  turn: (g) => (g.pile.length >= 6 ? null : 'any'),
  legal: (g, m) => g.pile.length < 6 && Number.isInteger(m),
  apply: (g, m) => ({ pile: [...g.pile, m] }),
  encode: (g) => ({ pile: g.pile }),
  decode: (x) => {
    const o = x as Partial<P> | null
    return o && Array.isArray(o.pile) ? { pile: o.pile as number[] } : null
  },
  readMove: (x) => (Number.isInteger(x) ? (x as number) : null),
  modes: ['together'],
}

/** `took` hears every room a client is handed, with the one it replaces, as useLabRoom's take() */
function party<T, M>(
  rules: Rules<T, M>,
  ids: string[],
  took?: (id: string, prev: Room<T>, next: Room<T>) => void,
) {
  const held = new Map<string, Room<T>>()
  const rooms = {
    get: (id: string) => held.get(id),
    set(id: string, next: Room<T>) {
      const prev = held.get(id)
      if (prev && took) took(id, prev, next)
      held.set(id, next)
    },
    keys: () => held.keys(),
  }
  const wire: { from: string; body: Wire }[] = []
  let now = 0
  for (const id of ids) {
    const s = openRoom(rules, 'x', id)
    rooms.set(id, s.room)
    wire.push(...s.out.map((body) => ({ from: id, body })))
  }
  const send = (from: string, out: Wire[]) => wire.push(...out.map((body) => ({ from, body })))
  const n = {
    get: (id: string) => rooms.get(id)!,
    wire,
    see(here: string[] = [...rooms.keys()]) {
      for (const id of here) {
        const s = present(rules, n.get(id), here, now)
        rooms.set(id, s.room)
        send(id, s.out)
      }
    },
    flush(alive: string[] = [...rooms.keys()]) {
      for (let guard = 0; wire.length && guard < 1000; guard++) {
        const { from, body } = wire.shift()!
        for (const id of alive) {
          if (id === from) continue
          const s = receive(rules, n.get(id), from, body)
          rooms.set(id, s.room)
          send(id, s.out)
        }
      }
    },
    do(id: string, a: Parameters<typeof act<T, M>>[2]) {
      const s = act(rules, n.get(id), a)
      rooms.set(id, s.room)
      send(id, s.out)
    },
    /** what a host's timer does: the computer's move, if it is due */
    computer(id: string) {
      const s = playComputer(rules, n.get(id))
      rooms.set(id, s.room)
      send(id, s.out)
    },
    at: (ms: number) => (now = ms),
    agree: (ids2: string[] = [...rooms.keys()]) =>
      ids2.every(
        (id) =>
          JSON.stringify(n.get(id)).replace(
            /"me":"\w+"|"present":\[[^\]]*\]|"from":"\w+"|"missing":\{[^}]*\}/g,
            '',
          ) ===
          JSON.stringify(n.get(ids2[0])).replace(
            /"me":"\w+"|"present":\[[^\]]*\]|"from":"\w+"|"missing":\{[^}]*\}/g,
            '',
          ),
      ),
  }
  return n
}

const seated = <T, M>(rules: Rules<T, M>) => {
  const n = party(rules, ['ann', 'bo', 'cy'])
  n.see()
  n.flush()
  n.do('bo', { t: 'sit', seat: 0 })
  n.do('cy', { t: 'sit', seat: 1 })
  n.flush()
  return n
}

describe('the lobby', () => {
  it('starts in versus, and a seated player picks together, with a level, for everybody', () => {
    const n = seated(race)
    expect(n.get('ann').mode).toBe('versus')
    n.do('cy', { t: 'mode', mode: 'together', level: 1 })
    n.flush()
    for (const id of ['ann', 'bo', 'cy']) {
      expect(n.get(id).mode).toBe('together')
      expect(n.get(id).level).toBe(1)
    }
    expect(n.agree()).toBe(true)
  })
  it('a watcher cannot pick, nor can anybody mid-game, nor a mode or level the toy lacks', () => {
    const n = seated(race)
    n.do('ann', { t: 'mode', mode: 'together', level: 0 }) // ann is watching (and host)
    n.flush()
    expect(n.get('bo').mode).toBe('versus')
    n.do('bo', { t: 'move', move: 2 })
    n.flush()
    expect(idle(race, n.get('bo'))).toBe(false)
    n.do('bo', { t: 'mode', mode: 'together', level: 0 })
    n.flush()
    expect(n.get('bo').mode).toBe('versus')
    expect(n.get('bo').game.total).toBe(2)
    // a new game makes it idle again, and then a pick is allowed — but only a real level
    n.do('bo', { t: 'new' })
    n.flush()
    n.do('bo', { t: 'mode', mode: 'together', level: 2 })
    n.flush()
    expect(n.get('ann').mode).toBe('versus')
    n.wire.push({ from: 'bo', body: { sub: 'x', t: 'mode', mode: 'solo' as never, level: 0 } })
    n.flush()
    expect(n.get('ann').mode).toBe('versus')
  })
  it('a toy with versus only refuses together, and a state claiming it is not believed', () => {
    const versusOnly: Rules<G, number> = { ...race, modes: undefined, computer: undefined }
    const n = seated(versusOnly)
    n.do('bo', { t: 'mode', mode: 'together', level: 0 })
    n.flush()
    expect(n.get('cy').mode).toBe('versus')
    const r = n.get('cy')
    const forged = {
      sub: 'x',
      t: 'state',
      seq: 99,
      seats: ['bo', 'cy'],
      mode: 'together',
      level: 0,
      next: 0,
      game: race.fresh(),
    }
    expect(receive(versusOnly, r, 'ann', forged).room).toBe(r)
  })
})

describe('together against the computer', () => {
  const team = () => {
    const n = seated(race)
    n.do('bo', { t: 'mode', mode: 'together', level: 0 })
    n.flush()
    return n
  }
  it('the two seats take the side’s moves in turn, and the host plays the computer between', () => {
    const n = team()
    // bo first (next = 0); cy may not
    expect(myTurn(race, n.get('bo'))).toBe(true)
    expect(myTurn(race, n.get('cy'))).toBe(false)
    n.do('cy', { t: 'move', move: 2 })
    n.flush()
    expect(n.get('ann').game.total).toBe(0)
    n.do('bo', { t: 'move', move: 2 })
    n.flush()
    // the computer's turn: nobody may move, and only the host's timer plays it
    expect(computerTurn(race, n.get('ann'))).toBe(true)
    expect(canMove(race, n.get('cy'), 'cy')).toBe(false)
    n.computer('bo') // not the host: nothing
    n.flush()
    expect(n.get('ann').game.total).toBe(2)
    n.computer('ann')
    n.flush()
    expect(n.get('cy').game.log).toBe('0211')
    // now cy, not bo
    expect(myTurn(race, n.get('cy'))).toBe(true)
    expect(myTurn(race, n.get('bo'))).toBe(false)
    n.do('cy', { t: 'move', move: 2 })
    n.flush()
    n.computer('ann')
    n.flush()
    expect(n.get('bo').game.log).toBe('02110211')
    expect(n.agree()).toBe(true)
  })
  it('plays at the level picked', () => {
    const n = seated(race)
    n.do('bo', { t: 'mode', mode: 'together', level: 1 })
    n.flush()
    n.do('bo', { t: 'move', move: 1 })
    n.flush()
    n.computer('ann')
    n.flush()
    expect(n.get('cy').game.log).toBe('0112')
  })
  it('the host leaving mid-game: the next host plays the computer from where it was', () => {
    const n = team()
    n.do('bo', { t: 'move', move: 2 })
    n.flush()
    n.see(['bo', 'cy'])
    n.flush(['bo', 'cy'])
    n.computer('bo')
    n.flush(['bo', 'cy'])
    expect(n.get('cy').game.log).toBe('0211')
    expect(n.agree(['bo', 'cy'])).toBe(true)
  })
  it('waits only for the teammate whose move it is, and one left alone takes every move', () => {
    const n = team()
    n.at(0)
    n.see(['ann', 'bo']) // cy goes; it is bo's move, so nothing waits
    expect(waitingFor(n.get('bo'), race)).toBeNull()
    n.do('bo', { t: 'move', move: 1 })
    n.flush(['ann', 'bo'])
    n.computer('ann')
    n.flush(['ann', 'bo'])
    // now it is cy's move, and cy is gone
    expect(waitingFor(n.get('bo'), race)).toBe('cy')
    expect(myTurn(race, n.get('bo'))).toBe(false)
    n.at(HOLD_MS)
    n.see(['ann', 'bo'])
    n.flush(['ann', 'bo'])
    expect(n.get('bo').seats).toEqual(['bo', null])
    expect(myTurn(race, n.get('bo'))).toBe(true)
    n.do('bo', { t: 'move', move: 2 })
    n.flush(['ann', 'bo'])
    expect(n.get('ann').game.total).toBe(4)
  })
  it('the computer does not play to an empty room', () => {
    const n = party(race, ['ann', 'bo'])
    n.see()
    n.flush()
    n.do('bo', { t: 'sit', seat: 0 })
    n.flush()
    n.do('bo', { t: 'mode', mode: 'together', level: 0 })
    n.flush()
    n.do('bo', { t: 'move', move: 1 })
    n.flush()
    n.do('bo', { t: 'stand' })
    n.flush()
    expect(computerTurn(race, n.get('ann'))).toBe(false)
    n.computer('ann')
    expect(n.get('ann').game.total).toBe(1)
  })
})

describe('a game anybody may move in', () => {
  it('both seats move whenever they like, in the order the host hears them, and nothing waits', () => {
    const n = party(pile, ['ann', 'bo', 'cy'])
    n.see()
    n.flush()
    n.do('bo', { t: 'sit', seat: 0 })
    n.do('cy', { t: 'sit', seat: 1 })
    n.flush()
    n.do('bo', { t: 'mode', mode: 'together', level: 0 })
    n.flush()
    // three each, sent at once; the host applies them as they come
    for (let i = 0; i < 3; i++) {
      n.do('bo', { t: 'move', move: i })
      n.do('cy', { t: 'move', move: 10 + i })
    }
    n.flush()
    expect(n.get('ann').game.pile).toHaveLength(6)
    expect(n.agree()).toBe(true)
    // a watcher still cannot
    n.do('ann', { t: 'new' })
    n.flush()
    expect(n.get('bo').game.pile).toHaveLength(6)
    // and a partner gone never stops the other
    n.do('bo', { t: 'new' })
    n.flush()
    n.see(['ann', 'bo'])
    expect(waitingFor(n.get('bo'), pile)).toBeNull()
    n.do('bo', { t: 'move', move: 7 })
    n.flush(['ann', 'bo'])
    expect(n.get('ann').game.pile).toEqual([7])
  })
})

/*
 * Who won, for the party tour (bus.ts): the same finished game as online.ts's record, said for the
 * table rather than for one player. Every room below is built with its seats in an order that is
 * NOT the ids' order, a watcher as `me`, and a sub of its own, so nothing here can pass by sorting
 * or by defaulting.
 */
const tableOf = <T, M>(rules: Rules<T, M>, over: Partial<Room<T>>): Room<T> => ({
  sub: 'gomoku',
  me: 'dee',
  seq: 7,
  from: 'cy',
  seats: ['bo', 'ann'],
  mode: 'versus',
  level: 0,
  next: 0,
  game: rules.fresh(),
  present: ['ann', 'bo', 'cy'],
  missing: {},
  ...over,
})
/* the race to 10, where whoever reaches it wins: `turn` after the last move is the loser's side */
const over = (loser: 0 | 1): G => ({ total: 10, turn: loser, log: 'x' })
const going: G = { total: 9, turn: 1, log: '' }
const drawn: Rules<G, number> = { ...race, result: (g) => (g.total >= 10 ? 'draw' : null) }
const DAY = 20_400
const lamps = lampsRules(DAY, 5, 'plus')
const par = solve(startOf(DAY, 5, 'plus'), 5, 'plus')!

/**
 * outcomeFor reads a player's seat and the team's side; winnersOf lists ids. Two paths sharing no
 * arithmetic, so asking both about everybody at the table — the watcher too — checks each.
 */
function agreesWithOutcome<T, M>(rules: Rules<T, M>, room: Room<T>) {
  const w = winnersOf(rules, room)!
  for (const id of ['ann', 'bo', 'cy', 'dee']) {
    const seated = room.seats.includes(id)
    const said = !seated ? null : w.how === 'draw' ? 'drawn' : w.won.includes(id) ? 'won' : 'lost'
    expect([id, outcomeFor(rules, room, id)]).toEqual([id, said])
  }
}

describe('who won a game at a call table (winnersOf)', () => {
  it('versus: the winning seat’s player, whichever seat it is', () => {
    const one = tableOf(race, { game: over(0) })
    expect(winnersOf(race, one)).toEqual({ how: 'win', won: ['ann'] })
    const zero = tableOf(race, { game: over(1) })
    expect(winnersOf(race, zero)).toEqual({ how: 'win', won: ['bo'] })
    agreesWithOutcome(race, one)
    agreesWithOutcome(race, zero)
  })
  it('a draw names nobody', () => {
    const r = tableOf(drawn, { game: over(0) })
    expect(winnersOf(drawn, r)).toEqual({ how: 'draw', won: [] })
    agreesWithOutcome(drawn, r)
  })
  it('together: both players when the side wins, in seat order, and nobody when the computer does', () => {
    /* race's computer plays side 1, so the team is side 0 */
    const won = tableOf(race, { mode: 'together', game: over(1) })
    expect(winnersOf(race, won)).toEqual({ how: 'win', won: ['bo', 'ann'] })
    const lost = tableOf(race, { mode: 'together', game: over(0) })
    expect(winnersOf(race, lost)).toEqual({ how: 'cpu', won: [] })
    const alone = tableOf(race, { mode: 'together', seats: [null, 'ann'], game: over(1) })
    expect(winnersOf(race, alone)).toEqual({ how: 'win', won: ['ann'] })
    for (const r of [won, lost, alone]) agreesWithOutcome(race, r)
  })
  it('Lamps together, solved by both, and the Lamps race, won by the seat that went dark first', () => {
    let one = lamps.fresh('together')
    for (const i of par) one = lamps.apply(one, i, 0)
    const together = tableOf(lamps, { sub: 'lamps', mode: 'together', game: one })
    expect(winnersOf(lamps, together)).toEqual({ how: 'win', won: ['bo', 'ann'] })
    let duel = lamps.fresh('versus')
    duel = lamps.apply(duel, par[0], 0)
    for (const i of par) duel = lamps.apply(duel, i, 1)
    const raced = tableOf(lamps, { sub: 'lamps', game: duel })
    expect(winnersOf(lamps, raced)).toEqual({ how: 'win', won: ['ann'] })
    agreesWithOutcome(lamps, together)
    agreesWithOutcome(lamps, raced)
  })
  it('nothing for a game still going, or a toy that keeps no result', () => {
    expect(winnersOf(race, tableOf(race, { game: going }))).toBeNull()
    const quiet: Rules<G, number> = { ...race, result: undefined }
    expect(winnersOf(quiet, tableOf(quiet, { game: over(0) }))).toBeNull()
  })
})

describe('the game a state finished (finishedOf)', () => {
  /* every field away from its default: a late seq, seats out of id order, together, the third
     level, and a computer on side 0 so the team is side 1 — the side race's own computer is not */
  const flipped: Rules<G, number> = {
    ...race,
    computer: { side: 0, levels: ['soft', 'firm', 'hard'], choose: () => 1 },
  }
  const before = tableOf(flipped, {
    mode: 'together',
    level: 2,
    seq: 40,
    game: going,
  })
  const after = { ...before, seq: 41, game: over(0) }
  it('is the whole game, every field read from the state that finished it', () => {
    expect(finishedOf(flipped, before, after)).toEqual({
      sub: 'gomoku',
      g: 41,
      mode: 'together',
      seats: ['bo', 'ann'],
      how: 'win',
      won: ['bo', 'ann'],
    })
    /* the team is side 1 here, so a finish on side 0's move is the computer's */
    const theirs = { ...after, game: over(1) }
    expect(finishedOf(flipped, before, theirs)).toMatchObject({ how: 'cpu', won: [] })
  })
  it('fires only on the state one seq on from a game still going', () => {
    expect(finishedOf(flipped, before, after)).not.toBeNull()
    /* a finished board arriving — somebody handed the room, or a state missed on the way */
    expect(finishedOf(flipped, null, after)).toBeNull()
    expect(finishedOf(flipped, { ...before, seq: 39 }, after)).toBeNull()
    expect(finishedOf(flipped, { ...before, seq: 0, game: flipped.fresh() }, after)).toBeNull()
    /* the next state of the same finished board: somebody stands up after the game */
    const stood = { ...after, seq: 42, seats: [null, 'ann'] as Room<G>['seats'] }
    expect(finishedOf(flipped, after, stood)).toBeNull()
  })
})

describe('the online record is kept exactly as before (finishedOf in useLabRoom)', () => {
  /* useLabRoom's take() before finishedOf, word for word, and after it */
  const was = <T, M>(rules: Rules<T, M>, prev: Room<T>, next: Room<T>) =>
    next.seq === prev.seq + 1 && rules.turn(prev.game) !== null ? outcomeFor(rules, next) : null
  const now = <T, M>(rules: Rules<T, M>, prev: Room<T>, next: Room<T>) =>
    finishedOf(rules, prev, next) ? outcomeFor(rules, next) : null

  it('over whole games — versus, together won and lost, a stand and a new game after — for everyone', () => {
    const kept: string[] = []
    const n = party(race, ['ann', 'bo', 'cy'], (id, prev, next) => {
      const a = was(race, prev, next)
      expect(now(race, prev, next)).toBe(a)
      if (a) kept.push(`${id}:${next.mode}:${a}`)
    })
    n.see()
    n.flush()
    n.do('bo', { t: 'sit', seat: 0 })
    n.do('cy', { t: 'sit', seat: 1 })
    n.flush()
    /* each seated move takes the next of `moves`, and the host's computer plays between */
    const play = (moves = [2]) => {
      for (let i = 0; i < 20 && race.turn(n.get('ann').game) !== null; i++) {
        n.computer('ann')
        n.flush()
        for (const who of ['bo', 'cy']) {
          n.do(who, { t: 'move', move: moves[Math.min(i, moves.length - 1)] })
          n.flush()
        }
      }
    }
    play()
    n.do('cy', { t: 'stand' })
    n.flush()
    n.do('cy', { t: 'sit', seat: 1 })
    n.flush()
    n.do('bo', { t: 'mode', mode: 'together', level: 0 })
    n.flush()
    play()
    n.do('bo', { t: 'new' })
    n.flush()
    n.do('bo', { t: 'mode', mode: 'together', level: 1 })
    n.flush()
    /* 2, the computer 2, 2, the computer 2, 1, and the computer's 2 reaches ten */
    play([2, 2, 1])
    /* two finished games each for the two players, and the watcher keeps nothing */
    expect(kept).toEqual([
      'bo:versus:won',
      'cy:versus:lost',
      'bo:together:won',
      'cy:together:won',
      'bo:together:lost',
      'cy:together:lost',
    ])
  })
})
