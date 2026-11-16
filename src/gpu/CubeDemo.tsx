import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import {
  CUBE_KEY,
  LEVELS,
  LOOKS,
  choose,
  newGame,
  place,
  readSaved,
  undo,
  winsAt,
  type Game,
  type Level,
  type Saved,
  type Side,
} from './cube'
import { useKept } from './kept'

type Mode = 'bot' | 'two'
const LEVEL_NAMES: Record<Level, string> = { easy: 'Easy', fair: 'Fair', hard: 'Hard' }
const LOOK_NAMES: Record<Saved['look'], string> = { glass: 'Glass', chalk: 'Chalk', neon: 'Neon' }
const MARK = ['', '✕', '◯']
const SIDE = ['', 'Crosses', 'Noughts']
const ONE = ['', 'a cross', 'a nought']
const LAYER = ['Top', 'Second', 'Third', 'Bottom']
const COLS = 'ABCD'
/** a cell as people say it: its layer, then its column letter and row number */
const cellName = (i: number) =>
  `${LAYER[Math.floor(i / 16)].toLowerCase()} layer ${COLS[i % 4]}${(Math.floor(i / 4) % 4) + 1}`

export function CubeDemo() {
  const [saved, setSaved] = useKept(CUBE_KEY, readSaved)
  const [mode, setMode] = useState<Mode>('bot')
  const [level, setLevel] = useState<Level>(saved.level)
  const [game, setGame] = useState<Game>(() => newGame())
  /** which side you play against the computer: crosses first, then turn about game by game */
  const [you, setYou] = useState<Side>(1)
  const [cursor, setCursor] = useState(0)
  const [line, setLine] = useState(
    'Four in a line wins — in one layer, straight down through all four, or slanting through them. You are crosses and go first.',
  )
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const recorded = useRef(false)

  const computerTurn = mode === 'bot' && !game.over && game.turn !== you
  const yours = !game.over && (mode === 'two' || game.turn === you)
  const nameOf = (s: Side) => (mode === 'bot' ? (s === you ? 'You' : 'The computer') : SIDE[s])
  const lastMove = game.moves[game.moves.length - 1]
  const winning = new Set(game.line)
  /** the cells that would complete four, side by side: one cell can be both */
  const threat = ([1, 2] as Side[]).map(
    (s) => new Set(saved.hints && !game.over ? winsAt(game.cells, s) : []),
  )

  const settle = (g: Game) => {
    setGame(g)
    if (!g.over) {
      setLine(
        mode === 'bot'
          ? g.turn === you
            ? `Your move. The computer played the ${cellName(g.moves[g.moves.length - 1])}.`
            : 'The computer is thinking…'
          : `${SIDE[g.turn]} to move.`,
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
        ? 'All sixty-four cells are full: a draw.'
        : mode === 'bot'
          ? g.winner === you
            ? `🏆 Four in a line in ${Math.ceil(g.moves.length / 2)} moves — you win!`
            : 'Four in a line for the computer. It wins.'
          : `🏆 ${SIDE[g.winner]} win.`,
    )
  }

  useEffect(() => {
    if (!computerTurn) return
    const t = window.setTimeout(() => settle(place(game, choose(game, level))), 380)
    return () => window.clearTimeout(t)
    // the game is what starts the computer's move
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [computerTurn, game])

  const fresh = (m: Mode = mode, lv: Level = saved.level) => {
    recorded.current = false
    const nextYou: Side = m === 'bot' && m === mode && game.moves.length ? (you === 1 ? 2 : 1) : 1
    setMode(m)
    setLevel(lv)
    setYou(nextYou)
    setGame(newGame())
    setLine(
      m === 'two'
        ? 'Crosses go first.'
        : nextYou === 1
          ? 'You are crosses and go first.'
          : 'You are noughts this time; the computer, crosses, goes first…',
    )
  }
  const tap = (i: number) => {
    if (!yours || game.cells[i]) return
    settle(place(game, i))
  }
  const takeBack = () => {
    if (!game.moves.length) return
    // against the computer, your move and its answer come back together
    const k = mode === 'bot' ? (game.turn === you || game.over ? 2 : 1) : 1
    const g = undo(game, Math.min(k, game.moves.length))
    if (mode === 'bot' && g.turn !== you) return
    recorded.current = false
    setGame(g)
    setLine('Taken back.')
  }
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const l = Math.floor(cursor / 16)
    const r = Math.floor(cursor / 4) % 4
    const c = cursor % 4
    let next = -1
    if (e.key === 'ArrowLeft') next = l * 16 + r * 4 + Math.max(0, c - 1)
    else if (e.key === 'ArrowRight') next = l * 16 + r * 4 + Math.min(3, c + 1)
    else if (e.key === 'ArrowUp') next = l * 16 + Math.max(0, r - 1) * 4 + c
    else if (e.key === 'ArrowDown') next = l * 16 + Math.min(3, r + 1) * 4 + c
    else if (e.key === 'PageUp' || e.key === '[') next = Math.max(0, l - 1) * 16 + r * 4 + c
    else if (e.key === 'PageDown' || e.key === ']') next = Math.min(3, l + 1) * 16 + r * 4 + c
    else if (e.key === 'u' || e.key === 'U') takeBack()
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
    <div className={`lab-keys cq-room is-${saved.look}`}>
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
        <button className="btn btn-ghost" onClick={() => fresh()}>
          ↻ New game
        </button>
      </div>
      <div className="dice-scores">
        {([1, 2] as Side[]).map((s) => (
          <div key={s} className={`dice-score${game.turn === s && !game.over ? ' is-up' : ''}`}>
            <span>{mode === 'bot' ? `${nameOf(s)} · ${SIDE[s].toLowerCase()}` : SIDE[s]}</span>
            <strong>{game.cells.filter((x) => x === s).length}</strong>
            <span className="muted">placed</span>
          </div>
        ))}
      </div>
      <p className="mc-line" aria-live="polite">
        {line}
      </p>

      <div
        className="cq-cube"
        role="group"
        aria-label="The cube, four layers of four by four. Arrow keys move in a layer, Page Up and Page Down (or [ and ]) change layer, Enter places a mark, U takes back."
        onKeyDown={onKey}
      >
        {LAYER.map((name, l) => (
          <div key={l} className="cq-layer">
            <span className="cq-name" aria-hidden>
              {name}
            </span>
            <div className="cq-grid">
              {Array.from({ length: 16 }, (_, k) => {
                const i = l * 16 + k
                const v = game.cells[i]
                const t = ([1, 2] as Side[]).filter((s) => threat[s - 1].has(i))
                return (
                  <button
                    key={i}
                    ref={(el) => {
                      refs.current[i] = el
                    }}
                    className={[
                      'cq-cell',
                      v ? `is-s${v}` : '',
                      i === lastMove ? 'is-last' : '',
                      winning.has(i) ? 'is-win' : '',
                      ...t.map((s) => `is-t${s}`),
                    ]
                      .filter(Boolean)
                      .join(' ')}
                    tabIndex={i === cursor ? 0 : -1}
                    aria-label={`${cellName(i)}: ${v ? ONE[v] : 'empty'}${i === lastMove ? ', last move' : ''}${winning.has(i) ? ', in the four' : ''}${t.length ? `, would complete four for ${t.map((s) => SIDE[s].toLowerCase()).join(' and ')}` : ''}`}
                    onFocus={() => setCursor(i)}
                    onClick={() => {
                      setCursor(i)
                      tap(i)
                    }}
                  >
                    <span aria-hidden>{v ? MARK[v] : ''}</span>
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>
      <div className="lab-controls">
        <button
          className="btn btn-ghost"
          onClick={takeBack}
          disabled={!game.moves.length || computerTurn}
        >
          ↶ Take back
        </button>
        <button
          className="btn btn-ghost"
          aria-pressed={saved.hints}
          onClick={() => setSaved((s) => ({ ...s, hints: !s.hints }))}
        >
          Show threes
        </button>
      </div>
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
          <h3 className="fw-h">Cube</h3>
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
        The cube is drawn as its four layers side by side, top to bottom. Four of your marks in a
        line wins: across, down or corner to corner within a layer; straight down through the same
        cell of every layer; or slanting from the top layer to the bottom one, a step at a time.
        There are seventy-six lines, and the corners and the eight middle cells each lie on seven.
        Every level takes a win and blocks one; Fair and Hard also look for a run of threats that
        cannot all be answered. Show threes rings each cell that would complete a line. Keys: arrows
        move, Page Up and Page Down (or [ and ]) change layer, Enter places a mark, U takes back.
      </p>
    </div>
  )
}
