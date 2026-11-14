/**
 * A two-seat game room for a Lab toy, shared by everyone in a call who has that toy open.
 *
 * Pure: the room is a value, and every input — somebody's message, who is present, the clock, a
 * button pressed here — returns the next room and the messages to broadcast. room.test.ts plays
 * whole games between several of these over an in-memory network, with people leaving, messages
 * repeated and arriving late, and two people taking one seat at the same moment.
 *
 *
 * WHO DECIDES
 *
 * One HOST: whoever on the toy has the lowest user id, seated or not. Everybody computes the same
 * answer from the same presence, so there is no election and nothing to agree on. The host alone
 * changes the room; everyone else asks (`sit`, `stand`, `move`, `new`) and the host answers with
 * `state` — the whole room: seats, a sequence number and the game. When the host leaves, the next
 * lowest id carries on from the last state it had.
 *
 * ⚠️ WHOLE STATE, NOT MOVES. A board game is under a kilobyte, so each change sends the room
 * entire. A lost message is then repaired by the next one, a repeated or late one is recognised by
 * its older `seq` and ignored, and somebody arriving says `hello` and is sent the room. No log to
 * replay and no gap to fill.
 *
 * ⚠️ THE RULES ARE THE TOY'S OWN. A move is checked by the toy's pure module (fourrow.ts's drop,
 * and so on): the host refuses anything not legal, from anyone but the player whose turn it is,
 * or made against a board that has since changed (`at` is the seq the mover saw).
 *
 *
 * WHEN SOMEBODY GOES
 *
 * A seated player who is no longer present pauses the game — the room says who it is waiting for.
 * Back within a minute, it carries on. Gone longer, the host frees the seat, and anybody watching
 * can take it. Nothing is lost: every client holds the room, and the toy can always be played
 * alone from where it stands (step 7's "carry on against the computer").
 */

export type Seat = 0 | 1
export type Seats = [string | null, string | null]

export type Rules<G, M> = {
  fresh: () => G
  /** whose turn it is, or null when the game is over */
  turn: (g: G) => Seat | null
  legal: (g: G, m: M) => boolean
  apply: (g: G, m: M) => G
  /** to and from the wire: plain data only, and decode refuses anything malformed */
  encode: (g: G) => unknown
  decode: (x: unknown) => G | null
  readMove: (x: unknown) => M | null
}

export type Room<G> = {
  sub: string
  me: string
  seq: number
  /** who sent the state we hold — breaks a tie between two hosts' equal seqs */
  from: string
  seats: Seats
  game: G
  /** everyone else on this toy, by id */
  present: string[]
  /** since when (ms) each seated player has been missing */
  missing: Record<string, number>
}

/** what goes out on the wire, as the body of a party `lab` message */
export type Wire =
  | { sub: string; t: 'hello' }
  | { sub: string; t: 'sit'; seat: Seat }
  | { sub: string; t: 'stand' }
  | { sub: string; t: 'move'; at: number; move: unknown }
  | { sub: string; t: 'new' }
  | { sub: string; t: 'state'; seq: number; seats: Seats; game: unknown }

export type Action<M> =
  | { t: 'sit'; seat: Seat }
  | { t: 'stand' }
  | { t: 'move'; move: M }
  | { t: 'new' }

/** how long a seat is held for somebody who has gone */
export const HOLD_MS = 60_000

type Step<G> = { room: Room<G>; out: Wire[] }

export function openRoom<G, M>(rules: Rules<G, M>, sub: string, me: string): Step<G> {
  const room: Room<G> = {
    sub,
    me,
    seq: 0,
    from: me,
    seats: [null, null],
    game: rules.fresh(),
    present: [],
    missing: {},
  }
  return { room, out: [{ sub, t: 'hello' }] }
}

export const hostOf = (room: Room<unknown>) => [room.me, ...room.present].sort()[0]
export const isHost = (room: Room<unknown>) => hostOf(room) === room.me
export const seatOf = (room: Room<unknown>, id = room.me): Seat | null =>
  room.seats[0] === id ? 0 : room.seats[1] === id ? 1 : null

/** who the game is waiting for: a seated player who is not here, or null */
export function waitingFor(room: Room<unknown>): string | null {
  const here = new Set([room.me, ...room.present])
  return room.seats.find((s) => s !== null && !here.has(s)) ?? null
}

/** may I move now: my seat, my turn, and nobody missing */
export function myTurn<G, M>(rules: Rules<G, M>, room: Room<G>): boolean {
  const seat = seatOf(room)
  return seat !== null && rules.turn(room.game) === seat && !waitingFor(room)
}

/** the host's answer to a change: the room one seq on, sent whole */
function publish<G, M>(rules: Rules<G, M>, room: Room<G>, patch: Partial<Room<G>>): Step<G> {
  const next = { ...room, ...patch, seq: room.seq + 1, from: room.me }
  return {
    room: next,
    out: [
      {
        sub: room.sub,
        t: 'state',
        seq: next.seq,
        seats: next.seats,
        game: rules.encode(next.game),
      },
    ],
  }
}

/** the host acting on a request — its own, or somebody else's */
function decide<G, M>(rules: Rules<G, M>, room: Room<G>, from: string, a: Action<M>): Step<G> {
  const none = { room, out: [] }
  const seat = seatOf(room, from)
  if (a.t === 'sit') {
    if (seat !== null || room.seats[a.seat] !== null) return none
    const seats: Seats = [...room.seats]
    seats[a.seat] = from
    return publish(rules, room, { seats })
  }
  if (a.t === 'stand') {
    if (seat === null) return none
    const seats: Seats = [...room.seats]
    seats[seat] = null
    return publish(rules, room, { seats })
  }
  if (a.t === 'new') {
    // only a seated player starts a new game: a watcher cannot wipe a game in progress
    if (seat === null) return none
    return publish(rules, room, { game: rules.fresh() })
  }
  // a move: the player whose turn it is, nobody missing, legal on this board
  if (seat === null || rules.turn(room.game) !== seat || waitingFor(room)) return none
  if (!rules.legal(room.game, a.move)) return none
  return publish(rules, room, { game: rules.apply(room.game, a.move) })
}

/** something I did here: the host does it, anybody else asks the host */
export function act<G, M>(rules: Rules<G, M>, room: Room<G>, a: Action<M>): Step<G> {
  if (isHost(room)) return decide(rules, room, room.me, a)
  const sub = room.sub
  if (a.t === 'move') {
    if (!myTurn(rules, room) || !rules.legal(room.game, a.move)) return { room, out: [] }
    return { room, out: [{ sub, t: 'move', at: room.seq, move: a.move }] }
  }
  return { room, out: [a.t === 'sit' ? { sub, t: 'sit', seat: a.seat } : { sub, t: a.t }] }
}

const isSeat = (v: unknown): v is Seat => v === 0 || v === 1
const readSeats = (v: unknown): Seats | null =>
  Array.isArray(v) &&
  v.length === 2 &&
  v.every((s) => s === null || (typeof s === 'string' && s.length > 0 && s.length <= 64))
    ? (v as Seats)
    : null

/** somebody else's message, off the wire — everything in it checked before it is believed */
export function receive<G, M>(
  rules: Rules<G, M>,
  room: Room<G>,
  from: string,
  body: unknown,
): Step<G> {
  const none = { room, out: [] }
  const b = body as Partial<Record<string, unknown>> | null
  if (!b || b.sub !== room.sub || typeof b.t !== 'string') return none
  if (b.t === 'state') {
    const seats = readSeats(b.seats)
    const game = rules.decode(b.game)
    if (typeof b.seq !== 'number' || !Number.isInteger(b.seq) || !seats || game === null)
      return none
    // a newer room wins; at an equal seq (two hosts for a moment), the lower id's
    if (b.seq < room.seq || (b.seq === room.seq && from >= room.from)) return none
    return { room: { ...room, seq: b.seq, from, seats, game }, out: [] }
  }
  if (!isHost(room)) return none
  if (b.t === 'hello')
    return {
      room,
      out: [
        {
          sub: room.sub,
          t: 'state',
          seq: room.seq,
          seats: room.seats,
          game: rules.encode(room.game),
        },
      ],
    }
  if (b.t === 'sit')
    return isSeat(b.seat) ? decide(rules, room, from, { t: 'sit', seat: b.seat }) : none
  if (b.t === 'stand' || b.t === 'new') return decide(rules, room, from, { t: b.t })
  if (b.t === 'move') {
    const move = rules.readMove(b.move)
    // a move made against a board that has since changed is not this board's move
    if (move === null || b.at !== room.seq) return none
    return decide(rules, room, from, { t: 'move', move })
  }
  return none
}

/**
 * Who else is on this toy now, at time `now`. A newly arrived host sends the room it holds; the
 * host frees the seat of anybody gone longer than HOLD_MS.
 */
export function present<G, M>(
  rules: Rules<G, M>,
  room: Room<G>,
  ids: string[],
  now: number,
): Step<G> {
  const others = [...new Set(ids)].filter((id) => id !== room.me).sort()
  const wasHost = isHost(room)
  const here = new Set([room.me, ...others])
  const missing: Record<string, number> = {}
  for (const s of room.seats) if (s && !here.has(s)) missing[s] = room.missing[s] ?? now
  const next: Room<G> = { ...room, present: others, missing }
  const out: Wire[] = []
  if (!isHost(next)) return { room: next, out }
  // freed seats, for anybody gone too long
  const gone = next.seats.map((s) =>
    s && missing[s] !== undefined && now - missing[s] >= HOLD_MS ? s : null,
  )
  if (gone.some(Boolean))
    return publish(rules, next, {
      seats: next.seats.map((s, i) => (gone[i] ? null : s)) as Seats,
    })
  // a host who has just become one, or somebody new arrived: everybody hears the room as it is
  const arrived = others.some((id) => !room.present.includes(id))
  if (!wasHost || arrived)
    out.push({
      sub: room.sub,
      t: 'state',
      seq: next.seq,
      seats: next.seats,
      game: rules.encode(next.game),
    })
  return { room: next, out }
}
