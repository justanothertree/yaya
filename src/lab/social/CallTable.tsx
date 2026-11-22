import { useState } from 'react'
import { idle, type Mode, type Rules, type Seat } from './room'
import { rematchOf, tableLine, tableSeats, type Table, type TableWords } from './table'
import { challenge } from '../matches/cloud'
import { MATCH_NAMES } from '../matches/names'
import { matchHash } from '../matches/words'

/** whether a toy has matches by turns: from the names, never the rules (names.ts says why) */
const byTurns = (sub: string) => Object.hasOwn(MATCH_NAMES, sub)

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
  /** a finished game's settings for a rematch by turns — the board's size, say; none by default */
  matchSettings?: (g: G) => Record<string, unknown>
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

  /* a finished game's rematch by turns: the other seat, challenged to the same toy */
  const rematch = rematchOf(table, rules, byTurns)
  const [asking, setAsking] = useState(false)
  const [refused, setRefused] = useState<string | null>(null)
  const askRematch = async () => {
    if (!rematch || !room) return
    setAsking(true)
    setRefused(null)
    try {
      const settings = {
        ...(p.matchSettings?.(room.game) ?? {}),
        ...(rematch.level ? { level: rematch.level } : {}),
      }
      const v = await challenge(rematch.friend, room.sub, rematch.mode, settings)
      location.hash = matchHash(room.sub, v.id)
    } catch (e) {
      setRefused(e instanceof Error ? e.message : 'The rematch could not be sent.')
    } finally {
      setAsking(false)
    }
  }

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
      {rematch && (
        <div className="lab-controls">
          <button className="btn btn-ghost" disabled={asking} onClick={() => void askRematch()}>
            {asking ? 'Sending…' : `🎲 Rematch ${who(rematch.friend)} by turns`}
          </button>
          {refused && <span className="muted">{refused}</span>}
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
