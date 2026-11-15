import { idle, type Mode, type Rules, type Seat } from './room'
import { tableLine, tableSeats, type Table, type TableWords } from './table'

/**
 * The lobby and the line under the board for any toy played in a call (room.ts): versus or
 * together, the computer's level, the two seats, a new game, carrying on alone, and what is
 * happening now — the same controls and the same words on every toy that plays online.
 *
 * Everything here asks the room; nothing decides. A button that would be refused (a watcher
 * picking a mode, anybody picking mid-game) is not shown, and the line says why it is not.
 */
type Props<G, M> = TableWords<G> & {
  table: Table<G, M>
  rules: Rules<G, M>
  /** what each side is called on this toy: "Dark", "Light" */
  sides: [string, string]
  /** each side's colour, for the swatch on its seat */
  ink?: [string, string]
  /** the computer's levels as the toy names them */
  levelNames?: Record<string, string>
  /** the toy's carry-on, offered only to a seated player left alone */
  onCarryOn?: () => void
}

export function CallTable<G, M>(p: Props<G, M>) {
  const { table, rules, sides } = p
  const { room, who, mySeat, leftAlone } = tableSeats(table, rules)
  const modes = rules.modes ?? ['versus']
  const levels = rules.computer?.levels ?? []
  const canPick = !!room && table.live && mySeat !== null && idle(rules, room)
  const seatName = (s: Seat) =>
    room?.mode === 'together' ? (s === 0 ? 'Join first' : 'Join second') : `Sit as ${sides[s]}`

  const line = () => tableLine(table, rules, p)

  const pick = (mode: Mode, level = room?.level ?? 0) => table.act({ t: 'mode', mode, level })

  return (
    <>
      {room && table.live && (
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
                  onClick={() => table.act({ t: 'sit', seat })}
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
              <button className="btn btn-ghost" onClick={() => table.act({ t: 'stand' })}>
                Stand up
              </button>
            )}
          </div>
          {mySeat !== null && (
            <button className="btn btn-ghost" onClick={() => table.act({ t: 'new' })}>
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
        {room && table.live && room.mode === 'together' && rules.computer && (
          <span className="muted">
            {' '}
            · the computer on {p.levelNames?.[levels[room.level]] ?? levels[room.level]}
          </span>
        )}
      </p>
      {room && table.live && (
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
