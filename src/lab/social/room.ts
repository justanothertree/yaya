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
 * lowest id carries on from the last state it had. A newcomer's `hello` is answered by the host as
 * it was before they arrived, or by whoever published the room we hold (answersHello): a newcomer
 * with a lower id is host the moment they are present, and holds nothing yet.
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
 * VERSUS OR TOGETHER (docs/2026-11-14-lab-online-modes-plan.md)
 *
 * A seated player picks the mode, between games only, so nobody changes the game under somebody
 * else's move. VERSUS is seat against seat. TOGETHER is both seats on one side: against the
 * computer, when the toy has one, the two of them take the side's moves in turn (`next` says
 * whose), and the HOST'S browser plays the computer — it is a seat, not a person, so whoever is
 * host carries it on. A toy whose turn is 'any' (Lamps) lets either seat move at any time.
 *
 *
 * WHEN SOMEBODY GOES
 *
 * A seated player who is no longer present pauses the game — the room says who it is waiting for.
 * Back within a minute, it carries on. Gone longer, the host frees the seat, and anybody watching
 * can take it; a teammate left alone takes every move of the side. A game where anybody may move
 * at any time never waits. Nothing is lost: every client holds the room, and the toy can always be
 * played alone from where it stands (step 7's "carry on against the computer").
 */

export type Seat = 0 | 1
export type Seats = [string | null, string | null]
export type Mode = 'versus' | 'together'
export const MODES: readonly Mode[] = ['versus', 'together']

export type Rules<G, M> = {
  /** a new game; `mode` for a toy whose together game is a different game (Lamps' one board) */
  fresh: (mode?: Mode) => G
  /** which side moves, 'any' when either seat may, or null when the game is over */
  turn: (g: G) => Seat | 'any' | null
  /** `by` is the side moving: the mover's seat in versus, the team's side together */
  legal: (g: G, m: M, by?: Seat) => boolean
  apply: (g: G, m: M, by?: Seat) => G
  /** to and from the wire: plain data only, and decode refuses anything malformed */
  encode: (g: G) => unknown
  decode: (x: unknown) => G | null
  readMove: (x: unknown) => M | null
  /** the modes this toy offers; versus alone when absent */
  modes?: readonly Mode[]
  /** together against the computer: the side it plays, its levels (easiest first) and its choice */
  computer?: { side: Seat; levels: readonly string[]; choose: (g: G, level: string) => M }
  /** who won a finished game — a side, or 'draw' — for the record each player keeps */
  result?: (g: G) => Seat | 'draw' | null
  /** whether a game has had a move; when absent, a game is begun if it differs from a fresh one */
  begun?: (g: G) => boolean
  /**
   * For a toy with dice, played only by turns: the server's roll. lab-move calls it as a match
   * begins, after every move and before the computer chooses, so no roll is known before the
   * server makes it. Never called in a browser; a call room has no toy that rolls.
   */
  roll?: (g: G, rand: () => number) => G
  /**
   * Together, for a toy where each friend holds their own place at the table (Hearts, Spades):
   * which of the two friends moves next, as the table says — at a table of four the friends do
   * not simply take turns. Without it, they do. Only lab-move asks it.
   */
  friendTurn?: (g: G) => Seat | null
  /**
   * For a toy where one side must not see something of the other's (a fleet, a hand), played
   * only by turns: what the server keeps back in the match's `secret`, which no RPC ever returns.
   * The game `encode` gives is the part anybody in the match may see; `join` puts the hidden part
   * back on the server, and a player is shown only their own side's through `mine`.
   */
  hidden?: {
    /** the hidden part of a game, for the match's `secret` */
    secret: (g: G) => unknown
    /** a game read from its state with its hidden part put back, or null if they do not belong */
    join: (g: G, secret: unknown) => G | null
    /**
     * What one side may see of the hidden part: its own. `seat` is the player asking — the same
     * as `side` versus; together, which of the two friends, for a toy where each holds their own
     */
    mine: (g: G, side: Seat, seat?: Seat) => unknown
    /** what the match's history keeps of a move, anything hidden in it taken out */
    logged: (m: M) => unknown
    /** a fresh game with what accepting brought (the friend's fleet), or null if it brought none */
    accept: (g: G, brought: unknown, mode: Mode) => G | null
  }
}

export type Room<G> = {
  sub: string
  me: string
  seq: number
  /** who sent the state we hold — breaks a tie between two hosts' equal seqs */
  from: string
  seats: Seats
  mode: Mode
  /** the computer's level, as an index into rules.computer.levels */
  level: number
  /** together: which seat takes the side's next move */
  next: Seat
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
  | { sub: string; t: 'mode'; mode: Mode; level: number }
  | {
      sub: string
      t: 'state'
      seq: number
      seats: Seats
      mode: Mode
      level: number
      next: Seat
      game: unknown
    }

export type Action<M> =
  | { t: 'sit'; seat: Seat }
  | { t: 'stand' }
  | { t: 'move'; move: M }
  | { t: 'new' }
  | { t: 'mode'; mode: Mode; level: number }

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
    mode: 'versus',
    level: 0,
    next: 0,
    game: rules.fresh('versus'),
    present: [],
    missing: {},
  }
  return { room, out: [{ sub, t: 'hello' }] }
}

/**
 * Who hosts, from ids alone: the lowest of mine and everybody present's, seated or not. Everyone
 * works it out from the same presence, so there is no election and nothing to agree on, and ids
 * are unique, so it is always exactly one person.
 *
 * In plain values rather than a room, like answersHello below, because more than a two-seat room
 * asks it: answersHello asks it of everybody but a newcomer, and a live table of four chairs
 * (docs/2026-11-23-lab-live-tables.md) will ask it of everybody on its toy. One answer, written
 * once, so two of them can never pick different hosts from the same people.
 */
export const lowest = (me: string, present: readonly string[]) => [me, ...present].sort()[0]

export const hostOf = (room: Room<unknown>) => lowest(room.me, room.present)

/**
 * Whether I hand a newcomer the room: I was host before they arrived, or I published the room we
 * all hold.
 *
 * ⚠️ NOT "AM I HOST", WHICH WAS THE RULE AND BROKE GAMES IN PROGRESS. Presence makes somebody with
 * a lower id host the moment their `where` lands — before their own room exists, because the toy's
 * code mounts after. The old host stopped answering, nobody else ever had, and the newcomer led
 * from an empty board: their state was older than everybody's and ignored, while every move went
 * to them and was refused as made against a board that had changed. A game between two friends
 * stopped the moment a third, with a lower id, came to watch.
 *
 * The host-before half covers one newcomer. The publisher half covers two arriving together (each
 * is "before" the other) and a host who left the room in somebody else's hands. A newcomer who is
 * not host costs nothing more: whoever was host already answered. Measured in room.test.ts on
 * 23 Nov 2026: three sends for a higher id joining, ten for four filling a fresh toy, as before.
 *
 * In plain values rather than a room, because the party tour (bus.ts) asks the same question of
 * a different set: the riders on the Lab, where a room asks everybody on its toy.
 */
export const answersHello = (
  me: string,
  present: readonly string[],
  from: string,
  seq: number,
  lastFrom: string,
) => {
  /* me and everybody here but the newcomer: the host among us is who hosted before they came */
  const before = present.filter((id) => id !== from)
  return lowest(me, before) === me || (seq > 0 && lastFrom === me)
}

/** a newer state wins; at an equal seq (two hosts for a moment), the lower sender's */
export const newer = (seq: number, from: string, heldSeq: number, heldFrom: string) =>
  seq > heldSeq || (seq === heldSeq && from < heldFrom)
export const isHost = (room: Room<unknown>) => hostOf(room) === room.me
export const seatOf = (room: Room<unknown>, id = room.me): Seat | null =>
  room.seats[0] === id ? 0 : room.seats[1] === id ? 1 : null

export const otherSeat = (s: Seat): Seat => (s === 0 ? 1 : 0)
/** the side the two seats play together: the one the computer does not */
export const teamSide = <G, M>(rules: Rules<G, M>): Seat =>
  rules.computer ? otherSeat(rules.computer.side) : 0
const both = (room: Room<unknown>) => room.seats[0] !== null && room.seats[1] !== null

/** whether it is the computer's move: together, against it, with somebody seated */
export function computerTurn<G, M>(rules: Rules<G, M>, room: Room<G>): boolean {
  return (
    room.mode === 'together' &&
    !!rules.computer &&
    rules.turn(room.game) === rules.computer.side &&
    room.seats.some((s) => s !== null)
  )
}

/** the seated player whose move it is, when the game turns on one; null for 'any' or nobody */
export function whoseMove<G, M>(rules: Rules<G, M>, room: Room<G>): string | null {
  const t = rules.turn(room.game)
  if (t === null || t === 'any' || computerTurn(rules, room)) return null
  if (room.mode === 'versus') return room.seats[t]
  return both(room) ? room.seats[room.next] : (room.seats[0] ?? room.seats[1])
}

/**
 * Who the game is waiting for: a seated player who is not here, or null. In versus, either player
 * gone stops the game; together, only the one whose move it is; and a game anybody may move in at
 * any time never waits, nor does a finished one.
 */
export function waitingFor<G, M>(room: Room<G>, rules: Rules<G, M>): string | null {
  // a finished game waits for nobody: the loser leaving afterwards must not take the result away
  if (rules.turn(room.game) === null) return null
  const here = new Set([room.me, ...room.present])
  if (room.mode === 'together') {
    const d = whoseMove(rules, room)
    return d !== null && !here.has(d) ? d : null
  }
  if (rules.turn(room.game) === 'any') return null
  return room.seats.find((s) => s !== null && !here.has(s)) ?? null
}

/** may `id` move: seated, and the move theirs — by side in versus, by `next` together */
export function canMove<G, M>(rules: Rules<G, M>, room: Room<G>, id: string): boolean {
  const seat = seatOf(room, id)
  const t = rules.turn(room.game)
  if (seat === null || t === null) return false
  if (t === 'any') return true
  if (computerTurn(rules, room)) return false
  return whoseMove(rules, room) === id
}

/** the side a move by this seat is made for */
const sideFor = <G, M>(rules: Rules<G, M>, room: Room<G>, seat: Seat): Seat =>
  room.mode === 'together' ? teamSide(rules) : seat

/** may I move now: my move, and nobody missing */
export function myTurn<G, M>(rules: Rules<G, M>, room: Room<G>): boolean {
  return canMove(rules, room, room.me) && !waitingFor(room, rules)
}

/** whether a game is between games: over, or not yet begun — when the mode may change */
export const idle = <G, M>(rules: Rules<G, M>, room: Room<G>) =>
  rules.turn(room.game) === null ||
  (rules.begun
    ? !rules.begun(room.game)
    : JSON.stringify(rules.encode(room.game)) ===
      JSON.stringify(rules.encode(rules.fresh(room.mode))))

/**
 * How a finished game went for one player, or null if it is not finished, they were watching, or
 * the toy keeps no result. Together, the side's result is both players' result.
 */
export function outcomeFor<G, M>(
  rules: Rules<G, M>,
  room: Room<G>,
  id = room.me,
): 'won' | 'lost' | 'drawn' | null {
  const seat = seatOf(room, id)
  const r = rules.result?.(room.game) ?? null
  if (seat === null || r === null || rules.turn(room.game) !== null) return null
  if (r === 'draw') return 'drawn'
  return r === (room.mode === 'together' ? teamSide(rules) : seat) ? 'won' : 'lost'
}

/** how a finished game went for the table: a seat's win, a draw, or the computer's win */
export type Winners = { how: 'win' | 'draw' | 'cpu'; won: string[] }

/**
 * Who won a finished game, by id, or null while it is going or the toy keeps no result.
 *
 * outcomeFor answers for one player; this answers for the table, so the party tour can say "Ann
 * won" to somebody who was watching. Versus, the winning seat's player. Together, the side is
 * both players: when it wins they both have — two friends who solve Lamps together have each
 * solved it — and when it does not, it was the computer, and nobody seated won. A seat that is
 * empty at the finish wins nothing, because there is nobody to name.
 */
export function winnersOf<G, M>(rules: Rules<G, M>, room: Room<G>): Winners | null {
  const r = rules.result?.(room.game) ?? null
  if (r === null || rules.turn(room.game) !== null) return null
  if (r === 'draw') return { how: 'draw', won: [] }
  const seated = (ids: (string | null)[]) => ids.filter((s): s is string => s !== null)
  if (room.mode === 'versus') return { how: 'win', won: seated([room.seats[r]]) }
  return r === teamSide(rules) ? { how: 'win', won: seated(room.seats) } : { how: 'cpu', won: [] }
}

/** a game that has just finished at a call table, as everyone who saw it finish can tell it */
export type Finished = Winners & {
  sub: string
  /** the seq of the state that finished it: one game, whoever reports it */
  g: number
  mode: Mode
  seats: Seats
}

/**
 * The game that `next` finished, or null when it finished nothing.
 *
 * ⚠️ ONE SEQ ON FROM A GAME STILL GOING, NEVER A FINISHED BOARD SEEN. Somebody arriving (or coming
 * back) is handed the room as it is, finished game and all, and a stand or a mode change after
 * the finish is a new state of the same finished board; only a state one seq on from a game still
 * going is the end of a game this browser was in. useLabRoom keeps this browser's record from it
 * (online.ts) and tells the party tour (gameOver.ts), so the two can never disagree about which
 * states finished a game.
 */
export function finishedOf<G, M>(
  rules: Rules<G, M>,
  prev: Room<G> | null,
  next: Room<G>,
): Finished | null {
  if (!prev || next.seq !== prev.seq + 1 || rules.turn(prev.game) === null) return null
  const w = winnersOf(rules, next)
  if (!w) return null
  return { sub: next.sub, g: next.seq, mode: next.mode, seats: [...next.seats], ...w }
}

/** the host's answer to a change: the room one seq on, sent whole */
function publish<G, M>(rules: Rules<G, M>, room: Room<G>, patch: Partial<Room<G>>): Step<G> {
  const next = { ...room, ...patch, seq: room.seq + 1, from: room.me }
  return { room: next, out: [stateOf(rules, next)] }
}
/** the room as it goes out on the wire */
const stateOf = <G, M>(rules: Rules<G, M>, room: Room<G>): Wire => ({
  sub: room.sub,
  t: 'state',
  seq: room.seq,
  seats: room.seats,
  mode: room.mode,
  level: room.level,
  next: room.next,
  game: rules.encode(room.game),
})

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
    return publish(rules, room, { game: rules.fresh(room.mode), next: 0 })
  }
  if (a.t === 'mode') {
    // a seated player, between games, a mode this toy has, and a level its computer has
    const levels = rules.computer?.levels.length ?? 1
    if (seat === null || !idle(rules, room) || !(rules.modes ?? ['versus']).includes(a.mode))
      return none
    if (!Number.isInteger(a.level) || a.level < 0 || a.level >= levels) return none
    return publish(rules, room, {
      mode: a.mode,
      level: a.level,
      next: 0,
      game: rules.fresh(a.mode),
    })
  }
  // a move: the player whose move it is, nobody missing, legal on this board
  if (seat === null || !canMove(rules, room, from) || waitingFor(room, rules)) return none
  const by = sideFor(rules, room, seat)
  if (!rules.legal(room.game, a.move, by)) return none
  const flip = room.mode === 'together' && rules.turn(room.game) !== 'any'
  return publish(rules, room, {
    game: rules.apply(room.game, a.move, by),
    next: flip ? otherSeat(seat) : room.next,
  })
}

/**
 * The computer's move, played by the host: the toy's own choice at the room's level, checked like
 * anybody's. Nothing when it is not the computer's turn, or this browser is not the host.
 */
export function playComputer<G, M>(rules: Rules<G, M>, room: Room<G>): Step<G> {
  const none = { room, out: [] }
  const c = rules.computer
  if (!c || !isHost(room) || !computerTurn(rules, room)) return none
  const m = c.choose(room.game, c.levels[room.level] ?? c.levels[0])
  if (!rules.legal(room.game, m, c.side)) return none
  return publish(rules, room, { game: rules.apply(room.game, m, c.side) })
}

/** something I did here: the host does it, anybody else asks the host */
export function act<G, M>(rules: Rules<G, M>, room: Room<G>, a: Action<M>): Step<G> {
  if (isHost(room)) return decide(rules, room, room.me, a)
  const sub = room.sub
  if (a.t === 'move') {
    const seat = seatOf(room)
    if (seat === null || !myTurn(rules, room)) return { room, out: [] }
    if (!rules.legal(room.game, a.move, sideFor(rules, room, seat))) return { room, out: [] }
    return { room, out: [{ sub, t: 'move', at: room.seq, move: a.move }] }
  }
  if (a.t === 'mode') return { room, out: [{ sub, t: 'mode', mode: a.mode, level: a.level }] }
  return { room, out: [a.t === 'sit' ? { sub, t: 'sit', seat: a.seat } : { sub, t: a.t }] }
}

const isSeat = (v: unknown): v is Seat => v === 0 || v === 1
/** two seats off the wire: each an id or nobody — the party tour's game reports name them too */
export const readSeats = (v: unknown): Seats | null =>
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
    const mode = MODES.includes(b.mode as Mode) ? (b.mode as Mode) : null
    const levels = rules.computer?.levels.length ?? 1
    const level =
      Number.isInteger(b.level) && (b.level as number) >= 0 && (b.level as number) < levels
        ? (b.level as number)
        : null
    if (typeof b.seq !== 'number' || !Number.isInteger(b.seq) || !seats || game === null)
      return none
    if (mode === null || level === null || !isSeat(b.next)) return none
    if (!(rules.modes ?? ['versus']).includes(mode)) return none
    if (!newer(b.seq, from, room.seq, room.from)) return none
    return { room: { ...room, seq: b.seq, from, seats, mode, level, next: b.next, game }, out: [] }
  }
  if (b.t === 'hello')
    return answersHello(room.me, room.present, from, room.seq, room.from)
      ? { room, out: [stateOf(rules, room)] }
      : none
  if (!isHost(room)) return none
  if (b.t === 'sit')
    return isSeat(b.seat) ? decide(rules, room, from, { t: 'sit', seat: b.seat }) : none
  if (b.t === 'stand' || b.t === 'new') return decide(rules, room, from, { t: b.t })
  if (b.t === 'mode')
    return MODES.includes(b.mode as Mode) && typeof b.level === 'number'
      ? decide(rules, room, from, { t: 'mode', mode: b.mode as Mode, level: b.level })
      : none
  if (b.t === 'move') {
    const move = rules.readMove(b.move)
    /* a move made against a board that has since changed is not this board's move — unless the
       game is one anybody may move in at any time, whose moves do not depend on each other (two
       presses in Lamps land the same in either order), so a quick second press is not stale */
    if (move === null) return none
    if (b.at !== room.seq && rules.turn(room.game) !== 'any') return none
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
  if (!wasHost || arrived) out.push(stateOf(rules, next))
  return { room: next, out }
}
