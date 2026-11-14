import {
  computerTurn,
  idle,
  myTurn,
  outcomeFor,
  teamSide,
  whoseMove,
  type Mode,
  type Rules,
  type Seat,
} from './room'
import type { LabRoom } from './useLabRoom'
import { useCallWords } from './callWords'

/**
 * The lobby and the line under the board for any toy played in a call (room.ts): versus or
 * together, the computer's level, the two seats, a new game, carrying on alone, and what is
 * happening now — the same controls and the same words on every toy that plays online.
 *
 * Everything here asks the room; nothing decides. A button that would be refused (a watcher
 * picking a mode, anybody picking mid-game) is not shown, and the line says why it is not.
 */
type Props<G, M> = {
  lab: LabRoom<G, M>
  rules: Rules<G, M>
  /** what each side is called on this toy: "Dark", "Light" */
  sides: [string, string]
  /** each side's colour, for the swatch on its seat */
  ink?: [string, string]
  /** the computer's levels as the toy names them */
  levelNames?: Record<string, string>
  /** what "together" means on this toy, for the button and the line */
  together?: string
  /** the toy's own words after a finished game's result, punctuation and all: ", 34 to 30" */
  score?: (g: G) => string | null
  /** what the line says while either seat may move at any time */
  anyTime?: string
  /** the toy's carry-on, offered only to a seated player left alone */
  onCarryOn?: () => void
}

export function CallTable<G, M>(p: Props<G, M>) {
  const { lab, rules, sides } = p
  const { room, who, mySeat, waiting, leftAlone } = useCallWords(lab, rules)
  const modes = rules.modes ?? ['versus']
  const together = p.together ?? 'together against the computer'
  const levels = rules.computer?.levels ?? []
  const canPick = !!room && lab.live && mySeat !== null && idle(rules, room)
  const seatName = (s: Seat) =>
    room?.mode === 'together' ? (s === 0 ? 'Join first' : 'Join second') : `Sit as ${sides[s]}`

  const line = (): string => {
    if (!room) return 'Joining the call’s game…'
    if (!lab.live)
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
      const score = p.score?.(room.game)
      const tail = score ?? ''
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
    if (rules.turn(room.game) === 'any') return p.anyTime ?? 'Play whenever you like.'
    if (myTurn(rules, room))
      return room.mode === 'together' ? 'Your move for the team.' : 'Your turn.'
    return `${who(whoseMove(rules, room))}’s turn.`
  }

  const pick = (mode: Mode, level = room?.level ?? 0) => lab.act({ t: 'mode', mode, level })

  return (
    <>
      {room && lab.live && (
        <div className="lab-controls call-table">
          {modes.length > 1 && canPick && (
            <div className="lab-group" role="group" aria-label="How to play">
              <button
                className="btn btn-ghost"
                aria-pressed={room.mode === 'versus'}
                onClick={() => pick('versus')}
              >
                ⚔️ Versus
              </button>
              <button
                className="btn btn-ghost"
                aria-pressed={room.mode === 'together'}
                onClick={() => pick('together')}
              >
                🤝 Together
              </button>
            </div>
          )}
          {canPick && room.mode === 'together' && levels.length > 1 && (
            <div className="lab-group" role="group" aria-label="How well the computer plays">
              {levels.map((l, i) => (
                <button
                  key={l}
                  className="btn btn-ghost"
                  aria-pressed={room.level === i}
                  onClick={() => pick('together', i)}
                >
                  {p.levelNames?.[l] ?? l}
                </button>
              ))}
            </div>
          )}
          <div className="lab-group" role="group" aria-label="Seats">
            {([0, 1] as const).map((seat) =>
              room.seats[seat] === null && mySeat === null ? (
                <button
                  key={seat}
                  className="btn btn-ghost"
                  onClick={() => lab.act({ t: 'sit', seat })}
                >
                  <span className="rv-discs">
                    {p.ink && room.mode === 'versus' && (
                      <span aria-hidden style={{ background: p.ink[seat] }} />
                    )}
                    {seatName(seat)}
                  </span>
                </button>
              ) : null,
            )}
            {mySeat !== null && (
              <button className="btn btn-ghost" onClick={() => lab.act({ t: 'stand' })}>
                Stand up
              </button>
            )}
          </div>
          {mySeat !== null && (
            <button className="btn btn-ghost" onClick={() => lab.act({ t: 'new' })}>
              ↻ New game
            </button>
          )}
        </div>
      )}
      {leftAlone && p.onCarryOn && (
        <div className="lab-controls">
          <button className="btn" onClick={p.onCarryOn}>
            Carry on {rules.computer ? 'against the computer' : 'alone'}
          </button>
        </div>
      )}
      <p className="mc-line" aria-live="polite">
        {line()}
        {room && lab.live && room.mode === 'together' && rules.computer && (
          <span className="muted">
            {' '}
            · the computer on {p.levelNames?.[levels[room.level]] ?? levels[room.level]}
          </span>
        )}
      </p>
      {room && lab.live && (
        <p className="muted call-seats">
          {room.mode === 'versus'
            ? `${sides[0]}: ${who(room.seats[0])} · ${sides[1]}: ${who(room.seats[1])}`
            : `Together: ${room.seats.filter(Boolean).map(who).join(' and ') || 'nobody yet'}`}
          {room.present.length + 1 - room.seats.filter(Boolean).length > 0 &&
            ` · ${room.present.length + 1 - room.seats.filter(Boolean).length} watching`}
        </p>
      )}
    </>
  )
}
