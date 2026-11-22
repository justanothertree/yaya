import {
  computerTurn,
  myTurn,
  outcomeFor,
  seatOf,
  teamSide,
  waitingFor,
  whoseMove,
  type Action,
  type Mode,
  type Room,
  type Rules,
} from './room'

/**
 * A two-seat game as a toy shows it, whoever keeps it. Today that is a call's room (useLabRoom);
 * a match saved between friends (docs/2026-11-14-lab-async-matches-plan.md) will give the same
 * shape, so the seats, the status line and the result words are written once for both.
 *
 * Pure: everything here is a question about a table, answered without React, so table.test.ts
 * can ask every case the line can be in.
 */
export type Table<G, M> = {
  /** whether the table can be played on now: the call's game is running */
  live: boolean
  /** the room now, or the last one there was; null before there has been one */
  room: Room<G> | null
  act: (a: Action<M>) => void
  /** names of everybody at the table, by id */
  names: Record<string, string>
}

/** what a toy says in its own words, where the table's would not do */
export type TableWords<G> = {
  /** what "together" means on this toy: "together against the computer" */
  together?: string
  /** the toy's own words after a finished game's result, punctuation and all: ", 34 to 30" */
  score?: (g: G) => string | null
  /** what the line says while either seat may move at any time */
  anyTime?: string
}

/** who is who at a table, as every toy and the table's line word it */
export function tableSeats<G, M>(table: Table<G, M>, rules: Rules<G, M>) {
  const room = table.room
  const who = (id: string | null) =>
    id === null ? 'Empty seat' : room && id === room.me ? 'You' : (table.names[id] ?? 'A friend')
  const mySeat = room ? seatOf(room) : null
  const waiting = room && table.live ? waitingFor(room, rules) : null
  /**
   * ⚠️ ONLY A PLAYER LEFT ALONE IS OFFERED TO CARRY ON (Evan, 14 Nov): seated, the game still
   * going, and either the other player gone or the call's game stopped. A watcher has no game of
   * theirs to carry on.
   */
  const leftAlone =
    !!room &&
    mySeat !== null &&
    rules.turn(room.game) !== null &&
    (!table.live || (waiting !== null && waiting !== room.me))
  return { room, who, mySeat, waiting, leftAlone }
}

/** what is happening at the table now, in one line: whose move, who is missing, who won */
export function tableLine<G, M>(
  table: Table<G, M>,
  rules: Rules<G, M>,
  words: TableWords<G> = {},
): string {
  const { room, who, mySeat, waiting, leftAlone } = tableSeats(table, rules)
  const modes = rules.modes ?? ['versus']
  const together = words.together ?? 'together against the computer'
  if (!room) return 'Joining the call’s game…'
  if (!table.live)
    return leftAlone
      ? 'The call’s game has stopped — carry on from here.'
      : 'The call’s game has stopped.'
  if (waiting) return `Waiting for ${who(waiting)}…`
  const seated = room.seats.filter((s) => s !== null)
  if (!seated.length)
    return modes.length > 1
      ? `Take a seat, then pick ⚔️ Versus or 🤝 Together (${together}). Anyone else watches.`
      : 'Take a seat to play; anyone else in the call watches.'
  if (room.mode === 'versus' && seated.length < 2)
    return mySeat === null
      ? 'Take the other seat to play.'
      : 'Waiting for somebody to take the other seat.'
  if (rules.turn(room.game) === null) {
    const r = rules.result?.(room.game) ?? null
    const tail = words.score?.(room.game) ?? ''
    if (r === 'draw') return `A draw${tail}.`
    if (r === null) return 'Game over.'
    if (room.mode === 'together') {
      const mine = outcomeFor(rules, room)
      const team = seated.map(who).join(' and ')
      if (rules.computer)
        return r === teamSide(rules)
          ? `🏆 ${mine ? 'You beat' : `${team} beat`} the computer together${tail}!`
          : `The computer wins${tail}.`
      return `🏆 ${mine ? 'You did it together' : `${team} did it`}${tail}!`
    }
    const winner = room.seats[r]
    return `🏆 ${who(winner)} ${winner === room.me ? 'win' : 'wins'}${tail}!`
  }
  if (computerTurn(rules, room)) return 'The computer is thinking…'
  if (rules.turn(room.game) === 'any') return words.anyTime ?? 'Play whenever you like.'
  if (myTurn(rules, room))
    return room.mode === 'together' ? 'Your move for the team.' : 'Your turn.'
  return `${who(whoseMove(rules, room))}’s turn.`
}

/**
 * A finished call game's rematch by turns (docs/2026-11-14-lab-async-matches-plan.md, "Starting a
 * match"): the friend in the other seat, the same toy, and the same mode — together, against the
 * computer at the level they were playing. Null while the game goes on, for anybody not seated,
 * with nobody else seated, or on a toy that has no matches (`byTurns`, which the caller answers
 * from the match names so a toy in a call never loads every match's rules).
 *
 * Whoever asks becomes the challenger, so moves first; a rematch asked by the second seat swaps
 * the sides, as the plan has it.
 */
export function rematchOf<G, M>(
  table: Table<G, M>,
  rules: Rules<G, M>,
  byTurns: (sub: string) => boolean,
): { friend: string; mode: Mode; level: string | null } | null {
  const room = table.room
  if (!room || !byTurns(room.sub) || rules.turn(room.game) !== null) return null
  const mine = seatOf(room)
  if (mine === null) return null
  const friend = room.seats[mine === 0 ? 1 : 0]
  if (!friend || friend === room.me) return null
  if (room.mode !== 'together') return { friend, mode: 'versus', level: null }
  if (!(rules.modes ?? ['versus']).includes('together')) return null
  const level = rules.computer?.levels[room.level]
  return level === undefined ? null : { friend, mode: 'together', level }
}
