import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import {
  GOMOKU_KEY,
  LEVELS,
  LOOKS,
  SIZES,
  choose,
  newGame,
  place,
  readSaved,
  undo,
  type Game,
  type Level,
  type Saved,
  type Side,
  type Size,
} from './gomoku'
import { useKept } from './kept'
import { gomokuRules } from './gomokuRoom'
import { useLabRoom } from '../lab/social/useLabRoom'
import { CallTable } from '../lab/social/CallTable'
import { useCallWords } from '../lab/social/callWords'
import { myTurn, teamSide } from '../lab/social/room'

/** 'call': the room shared with friends in your call (src/lab/social/useLabRoom.ts) */
type Mode = 'bot' | 'two' | 'call'
const LEVEL_NAMES: Record<Level, string> = { easy: 'Easy', fair: 'Fair', hard: 'Hard' }
const LOOK_NAMES: Record<Saved['look'], string> = { wood: 'Wood', paper: 'Paper', night: 'Night' }
const COLOUR = ['', 'Black', 'White']
const COLS = 'ABCDEFGHJKLMN'
const pointName = (n: number, i: number) => `${COLS[i % n]}${n - Math.floor(i / n)}`

export function GomokuDemo() {
  const [saved, setSaved] = useKept(GOMOKU_KEY, readSaved)
  const [mode, setMode] = useState<Mode>('bot')
  const [level, setLevel] = useState<Level>(saved.level)
  const [game, setGame] = useState<Game>(() => newGame(saved.size))
  /** which colour you play against the computer: black first, then turn about game by game */
  const [you, setYou] = useState<Side>(1)
  const [cursor, setCursor] = useState(() => Math.floor((saved.size * saved.size) / 2))
  const [line, setLine] = useState(
    'Five in a row — across, down or on a diagonal — wins. You are black and go first.',
  )
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const recorded = useRef(false)

  /* ── the call's room: the host's size starts each game, which then travels as its moves */
  const roomRules = useMemo(() => gomokuRules(saved.size), [saved.size])
  const lab = useLabRoom('gomoku', roomRules)
  const words = useCallWords(lab, roomRules)
  const room = mode === 'call' ? lab.room : null
  /** the side I place for: my seat's in versus, the team's (black) together */
  const mySide: Side =
    room?.mode === 'together' ? ((teamSide(roomRules) + 1) as Side) : words.mySeat === 1 ? 2 : 1
  /** the board on screen: the call's in a call, else this one */
  const shown = room ? room.game : game

  const n = shown.n
  const computerTurn = mode === 'bot' && !game.over && game.turn !== you
  const yours = room
    ? lab.live && myTurn(roomRules, room)
    : mode !== 'call' && !game.over && (mode === 'two' || game.turn === you)
  const nameOf = (s: Side) =>
    room
      ? room.mode === 'together'
        ? s === mySide
          ? 'Together'
          : 'The computer'
        : words.who(room.seats[s - 1])
      : mode === 'bot'
        ? s === you
          ? 'You'
          : 'The computer'
        : COLOUR[s]
  const lastMove = shown.moves[shown.moves.length - 1]
  const winning = new Set(shown.line)

  const settle = (g: Game) => {
    setGame(g)
    if (!g.over) {
      setLine(
        mode === 'bot'
          ? g.turn === you
            ? `Your move. The computer played ${pointName(n, g.moves[g.moves.length - 1])}.`
            : 'The computer is thinking…'
          : `${COLOUR[g.turn]} to move.`,
      )
      return
    }
    if (mode === 'bot' && !recorded.current) {
      recorded.current = true
      const r = !g.winner ? 'drawn' : g.winner === you ? 'won' : 'lost'
      setSaved((s) => ({
        ...s,
        record: { ...s.record, [level]: { ...s.record[level], [r]: s.record[level][r] + 1 } },
      }))
    }
    setLine(
      !g.winner
        ? 'The board is full: a draw.'
        : mode === 'bot'
          ? g.winner === you
            ? `🏆 Five in a row in ${Math.ceil(g.moves.length / 2)} moves — you win!`
            : 'Five in a row for the computer. It wins.'
          : `🏆 ${COLOUR[g.winner]} wins.`,
    )
  }

  useEffect(() => {
    if (!computerTurn) return
    const t = window.setTimeout(() => settle(place(game, choose(game, level))), 380)
    return () => window.clearTimeout(t)
    // the game is what starts the computer's move
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [computerTurn, game])

  const fresh = (m: Mode = mode, lv: Level = saved.level, size: Size = saved.size) => {
    recorded.current = false
    const nextYou: Side = m === 'bot' && m === mode && game.moves.length ? (you === 1 ? 2 : 1) : 1
    setMode(m)
    setLevel(lv)
    setYou(nextYou)
    setGame(newGame(size))
    setCursor(Math.floor((size * size) / 2))
    setLine(
      m === 'two'
        ? 'Black goes first.'
        : nextYou === 1
          ? 'You are black and go first.'
          : 'You are white this time; the computer, black, goes first…',
    )
  }
  const tap = (i: number) => {
    if (!yours || shown.cells[i]) return
    if (room) return lab.act({ t: 'move', move: i })
    settle(place(game, i))
  }
  /**
   * ⚠️ A SEATED PLAYER LEFT ALONE carries on against the computer from the board on screen,
   * keeping their colour — or starts a new game if that one was over.
   */
  const carryOn = () => {
    const r = room ?? lab.room
    if (!r || r.game.over) return fresh('bot')
    recorded.current = false
    setMode('bot')
    setLevel(saved.level)
    setYou(mySide)
    setGame(r.game)
    setLine(r.game.turn === mySide ? 'Your move.' : 'The computer is thinking…')
  }
  const takeBack = () => {
    if (!game.moves.length) return
    // against the computer, your move and its answer come back together
    const k = mode === 'bot' ? (game.turn === you || game.over ? 2 : 1) : 1
    const g = undo(game, Math.min(k, game.moves.length))
    recorded.current = false
    setGame(g)
    setLine('Taken back.')
  }
  // the call's board may be another size than this one: the keyboard's place stays on it
  const at = cursor < n * n ? cursor : Math.floor((n * n) / 2)
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const r = Math.floor(at / n)
    const c = at % n
    let next = -1
    if (e.key === 'ArrowLeft') next = r * n + Math.max(0, c - 1)
    else if (e.key === 'ArrowRight') next = r * n + Math.min(n - 1, c + 1)
    else if (e.key === 'ArrowUp') next = Math.max(0, r - 1) * n + c
    else if (e.key === 'ArrowDown') next = Math.min(n - 1, r + 1) * n + c
    else if (!room && (e.key === 'u' || e.key === 'U')) takeBack()
    else return
    e.preventDefault()
    e.stopPropagation()
    if (next >= 0) {
      setCursor(next)
      refs.current[next]?.focus()
    }
  }

  const record = saved.record[saved.level]
  return (
    <div className={`lab-keys gm-room is-${saved.look}`}>
      <div className="lab-controls">
        <div className="lab-group" role="group" aria-label="Opponent">
          <button
            className="btn btn-ghost"
            aria-pressed={mode === 'bot'}
            onClick={() => fresh('bot')}
          >
            Against the computer
          </button>
          <button
            className="btn btn-ghost"
            aria-pressed={mode === 'two'}
            onClick={() => fresh('two')}
          >
            Two players
          </button>
          {(lab.live || mode === 'call') && (
            <button
              className="btn btn-ghost"
              aria-pressed={mode === 'call'}
              onClick={() => setMode('call')}
            >
              👥 With the call
            </button>
          )}
        </div>
        {mode === 'bot' && (
          <div className="lab-group" role="group" aria-label="How well the computer plays">
            {LEVELS.map((l) => (
              <button
                key={l}
                className="btn btn-ghost"
                aria-pressed={saved.level === l}
                onClick={() => {
                  setSaved((s) => ({ ...s, level: l }))
                  if (!game.moves.length || game.over) fresh(mode, l)
                }}
              >
                {LEVEL_NAMES[l]}
              </button>
            ))}
          </div>
        )}
        {mode !== 'call' && (
          <div className="lab-group" role="group" aria-label="Board size">
            {SIZES.map((s) => (
              <button
                key={s}
                className="btn btn-ghost"
                aria-pressed={saved.size === s}
                onClick={() => {
                  setSaved((x) => ({ ...x, size: s }))
                  fresh(mode, saved.level, s)
                }}
              >
                {s}×{s}
              </button>
            ))}
          </div>
        )}
        {mode !== 'call' && (
          <button className="btn btn-ghost" onClick={() => fresh()}>
            ↻ New game
          </button>
        )}
      </div>
      {mode === 'call' && (
        <CallTable
          lab={lab}
          rules={roomRules}
          sides={['Black', 'White']}
          ink={['#17191e', '#f4f3ee']}
          levelNames={LEVEL_NAMES}
          score={(g) => (g.winner ? ` in ${Math.ceil(g.moves.length / 2)} moves` : null)}
          onCarryOn={carryOn}
        />
      )}
      <div className="dice-scores">
        {([1, 2] as Side[]).map((s) => (
          <div key={s} className={`dice-score${shown.turn === s && !shown.over ? ' is-up' : ''}`}>
            <span>
              {nameOf(s)} · {COLOUR[s].toLowerCase()}
            </span>
            <strong>{shown.cells.filter((x) => x === s).length}</strong>
            <span className="muted">stones</span>
          </div>
        ))}
      </div>
      {mode !== 'call' && (
        <p className="mc-line" aria-live="polite">
          {line}
        </p>
      )}

      <div
        className="gm-board"
        style={{ ['--gm-n' as string]: n }}
        role="group"
        aria-label={`The board, ${n} by ${n}. Arrow keys move, Enter places a stone${room ? '' : ', U takes back'}.`}
        onKeyDown={onKey}
      >
        {Array.from({ length: n * n }, (_, i) => {
          const v = shown.cells[i]
          return (
            <button
              key={i}
              ref={(el) => {
                refs.current[i] = el
              }}
              className={[
                'gm-pt',
                v ? `is-s${v}` : '',
                i === lastMove ? 'is-last' : '',
                winning.has(i) ? 'is-win' : '',
                i % n === 0 ? 'edge-l' : '',
                i % n === n - 1 ? 'edge-r' : '',
                i < n ? 'edge-t' : '',
                i >= n * (n - 1) ? 'edge-b' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              tabIndex={i === at ? 0 : -1}
              aria-label={`${pointName(n, i)}: ${v ? `${COLOUR[v].toLowerCase()} stone` : 'empty'}${i === lastMove ? ', last move' : ''}${winning.has(i) ? ', in the five' : ''}`}
              onFocus={() => setCursor(i)}
              onClick={() => {
                setCursor(i)
                tap(i)
              }}
            >
              <span aria-hidden />
            </button>
          )
        })}
      </div>
      {mode !== 'call' && (
        <div className="lab-controls">
          <button
            className="btn btn-ghost"
            onClick={takeBack}
            disabled={!game.moves.length || computerTurn}
          >
            ↶ Take back
          </button>
        </div>
      )}
      {mode === 'bot' && (
        <p className="sun-reading">
          <span className="muted">
            On {LEVEL_NAMES[saved.level]}: won {record.won}, lost {record.lost}
            {record.drawn ? `, drawn ${record.drawn}` : ''}
          </span>
        </p>
      )}
      <div className="fw-panel">
        <section aria-label="Looks">
          <h3 className="fw-h">Board</h3>
          <div className="lab-controls" role="group" aria-label="Look">
            {LOOKS.map((l) => (
              <button
                key={l}
                className="btn btn-ghost"
                aria-pressed={saved.look === l}
                onClick={() => setSaved((s) => ({ ...s, look: l }))}
              >
                {LOOK_NAMES[l]}
              </button>
            ))}
          </div>
        </section>
      </div>
      <p className="muted lab-hint">
        Take turns placing a stone on any empty point. Five or more of your colour in a line —
        across, down or on a diagonal — wins; black moves first, and you swap colours each game
        against the computer. Every level takes a win and stops a five; Fair and Hard also stop an
        open three before it becomes an open four, and Hard looks at your best answer before it
        moves. Keys: arrows move, Enter places a stone, U takes a move back.
      </p>
    </div>
  )
}
