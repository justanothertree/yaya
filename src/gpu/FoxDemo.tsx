import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import {
  FOX_KEY,
  IDLE_LIMIT,
  LEVELS,
  LOOKS,
  N,
  POINTS,
  START_GEESE,
  TAKE_TO_WIN,
  choose,
  dirsAt,
  movesFor,
  newGame,
  over,
  play,
  readSaved,
  type Game,
  type Level,
  type Move,
  type Saved,
  type Side,
} from './fox'
import { useKept } from './kept'

type Mode = 'bot' | 'two'
const LEVEL_NAMES: Record<Level, string> = { easy: 'Easy', fair: 'Fair', hard: 'Hard' }
const LOOK_NAMES: Record<Saved['look'], string> = { meadow: 'Meadow', snow: 'Snow', dusk: 'Dusk' }
const COLS = 'ABCDEFG'
const pointName = (i: number) => `${COLS[i % N]}${N - Math.floor(i / N)}`
/** every line on the board once, from each point to its neighbours further on */
const LINES: [number, number][] = POINTS.flatMap((i) =>
  dirsAt(i)
    .filter(([dr, dc]) => dr > 0 || (dr === 0 && dc > 0))
    .map(([dr, dc]): [number, number] => [i, i + dr * N + dc]),
)

export function FoxDemo() {
  const [saved, setSaved] = useKept(FOX_KEY, readSaved)
  const [mode, setMode] = useState<Mode>('bot')
  const [level, setLevel] = useState<Level>(saved.level)
  const [you, setYou] = useState<Side>(saved.side)
  const [game, setGame] = useState<Game>(newGame)
  const [picked, setPicked] = useState<number | null>(null)
  const [cursor, setCursor] = useState(START_GEESE[0])
  const [line, setLine] = useState(
    saved.side === 'geese'
      ? 'You are the geese, and move first: hem the fox in so it cannot move.'
      : `You are the fox: the geese move first. Jump them, and take ${TAKE_TO_WIN} to win.`,
  )
  const refs = useRef<Map<number, HTMLButtonElement>>(new Map())
  const recorded = useRef(false)

  const done = over(game)
  const computer = mode === 'bot' && !done && game.turn !== you
  const yours = !done && !computer
  const moves = yours ? movesFor(game) : []
  /** where the picked piece can end up, by the move with the most takes there */
  const targets = new Map<number, Move>()
  if (picked !== null)
    for (const m of moves)
      if (m.path[0] === picked) {
        const end = m.path[m.path.length - 1]
        const had = targets.get(end)
        if (!had || m.takes.length > had.takes.length) targets.set(end, m)
      }
  const movable = new Set(moves.map((m) => m.path[0]))
  const lastSet = new Set(game.last)

  const settle = (g: Game, m: Move, who: 'you' | 'computer' | Side) => {
    setGame(g)
    setPicked(null)
    const what =
      g.turn === 'geese' && m.takes.length
        ? `takes ${m.takes.length === 1 ? 'a goose' : `${m.takes.length} geese`}`
        : `moves to ${pointName(m.path[m.path.length - 1])}`
    const subject =
      who === 'you'
        ? 'You'
        : who === 'computer'
          ? 'The computer'
          : who === 'fox'
            ? 'The fox'
            : 'The geese'
    if (!over(g)) {
      setLine(`${subject} ${what}.`)
      return
    }
    const r = g.drawn ? 'drawn' : g.winner === you ? 'won' : 'lost'
    if (mode === 'bot' && !recorded.current) {
      recorded.current = true
      setSaved((s) => ({
        ...s,
        record: { ...s.record, [you]: { ...s.record[you], [r]: s.record[you][r] + 1 } },
      }))
    }
    const how =
      g.winner === 'geese'
        ? 'the fox is hemmed in'
        : g.taken >= TAKE_TO_WIN
          ? `the fox has taken ${g.taken}`
          : g.idle >= IDLE_LIMIT
            ? `the geese went ${IDLE_LIMIT} moves without a step forward`
            : 'the geese cannot move'
    setLine(
      g.drawn
        ? 'A draw: the game ran its length.'
        : mode === 'bot'
          ? r === 'won'
            ? `🏆 You win — ${how}.`
            : `The computer wins — ${how}.`
          : `🏆 The ${g.winner} win${g.winner === 'fox' ? 's' : ''} — ${how}.`,
    )
  }

  useEffect(() => {
    if (!computer) return
    const t = window.setTimeout(() => {
      const m = choose(game, level)
      settle(play(game, m), m, 'computer')
    }, 450)
    return () => window.clearTimeout(t)
    // the game is what starts the computer's move
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [computer, game])

  const fresh = (m: Mode = mode, side: Side = you, lv: Level = saved.level) => {
    recorded.current = false
    setMode(m)
    setYou(side)
    setLevel(lv)
    setGame(newGame())
    setPicked(null)
    setLine(
      m === 'two'
        ? 'The geese move first.'
        : side === 'geese'
          ? 'You are the geese, and move first: hem the fox in so it cannot move.'
          : `You are the fox: the geese move first. Jump them, and take ${TAKE_TO_WIN} to win.`,
    )
  }
  const tap = (i: number) => {
    setCursor(i)
    if (!yours) return
    const m = picked !== null ? targets.get(i) : undefined
    if (m) {
      settle(play(game, m), m, mode === 'bot' ? 'you' : game.turn)
      return
    }
    if (movable.has(i)) {
      setPicked(picked === i ? null : i)
      return
    }
    setPicked(null)
  }
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const d: Record<string, [number, number]> = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
    }
    if (e.key === 'Escape') {
      setPicked(null)
      return
    }
    const v = d[e.key]
    if (!v) return
    e.preventDefault()
    e.stopPropagation()
    // the next point on the board that way, skipping the gaps at the corners
    let r = Math.floor(cursor / N)
    let c = cursor % N
    for (let k = 0; k < N; k++) {
      r += v[0]
      c += v[1]
      if (r < 0 || c < 0 || r >= N || c >= N) return
      if (POINTS.includes(r * N + c)) {
        setCursor(r * N + c)
        refs.current.get(r * N + c)?.focus()
        return
      }
    }
  }

  const left = game.geese.size
  const record = saved.record[you]
  const describe = (i: number) => {
    const what = game.fox === i ? 'the fox' : game.geese.has(i) ? 'a goose' : 'empty'
    const t = targets.get(i)
    return `${pointName(i)}: ${what}${picked === i ? ', picked' : ''}${t ? (t.takes.length ? `, move here taking ${t.takes.length}` : ', move here') : ''}${lastSet.has(i) ? ', last move' : ''}`
  }
  return (
    <div className={`lab-keys fg-room is-${saved.look}`}>
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
          <>
            <div className="lab-group" role="group" aria-label="Your side">
              {(['geese', 'fox'] as Side[]).map((s) => (
                <button
                  key={s}
                  className="btn btn-ghost"
                  aria-pressed={you === s}
                  onClick={() => {
                    setSaved((x) => ({ ...x, side: s }))
                    fresh('bot', s)
                  }}
                >
                  {s === 'geese' ? 'Geese' : '🦊 Fox'}
                </button>
              ))}
            </div>
            <div className="lab-group" role="group" aria-label="How well the computer plays">
              {LEVELS.map((l) => (
                <button
                  key={l}
                  className="btn btn-ghost"
                  aria-pressed={saved.level === l}
                  onClick={() => {
                    setSaved((s) => ({ ...s, level: l }))
                    if (!game.plies || done) fresh(mode, you, l)
                  }}
                >
                  {LEVEL_NAMES[l]}
                </button>
              ))}
            </div>
          </>
        )}
        <button className="btn btn-ghost" onClick={() => fresh()}>
          ↻ New game
        </button>
      </div>
      <div className="dice-scores">
        <div className={`dice-score${game.turn === 'geese' && !done ? ' is-up' : ''}`}>
          <span>Geese{mode === 'bot' ? (you === 'geese' ? ' · you' : ' · computer') : ''}</span>
          <strong>{left}</strong>
          <span className="muted">
            {game.idle ? `${IDLE_LIMIT - game.idle} moves to step forward` : 'left on the board'}
          </span>
        </div>
        <div className={`dice-score${game.turn === 'fox' && !done ? ' is-up' : ''}`}>
          <span>🦊 Fox{mode === 'bot' ? (you === 'fox' ? ' · you' : ' · computer') : ''}</span>
          <strong>{game.taken}</strong>
          <span className="muted">taken of {TAKE_TO_WIN}</span>
        </div>
      </div>
      <p className="mc-line" aria-live="polite">
        {line}
      </p>

      <div
        className="fg-board"
        role="group"
        aria-label="The board. Arrow keys move between points, Enter picks a piece and then where it goes, Escape lets go."
        onKeyDown={onKey}
      >
        <svg className="fg-lines" viewBox={`0 0 ${N} ${N}`} aria-hidden>
          {LINES.map(([a, b]) => (
            <line
              key={`${a}-${b}`}
              x1={(a % N) + 0.5}
              y1={Math.floor(a / N) + 0.5}
              x2={(b % N) + 0.5}
              y2={Math.floor(b / N) + 0.5}
            />
          ))}
          {game.last.length > 1 && (
            <polyline
              className="fg-trail"
              points={game.last.map((i) => `${(i % N) + 0.5},${Math.floor(i / N) + 0.5}`).join(' ')}
            />
          )}
        </svg>
        {POINTS.map((i) => {
          const goose = game.geese.has(i)
          const fox = game.fox === i
          const t = saved.guides ? targets.get(i) : undefined
          return (
            <button
              key={i}
              ref={(el) => {
                if (el) refs.current.set(i, el)
                else refs.current.delete(i)
              }}
              className={[
                'fg-pt',
                goose ? 'is-goose' : '',
                fox ? 'is-fox' : '',
                picked === i ? 'is-picked' : '',
                t ? (t.takes.length ? 'is-take' : 'is-to') : '',
                saved.guides && picked === null && movable.has(i) ? 'is-movable' : '',
                lastSet.has(i) ? 'is-last' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              style={{ gridRow: Math.floor(i / N) + 1, gridColumn: (i % N) + 1 }}
              tabIndex={i === cursor ? 0 : -1}
              aria-label={describe(i)}
              onFocus={() => setCursor(i)}
              onClick={() => tap(i)}
            >
              <span aria-hidden>{fox ? '🦊' : ''}</span>
            </button>
          )
        })}
      </div>

      {mode === 'bot' && (
        <p className="sun-reading">
          <span className="muted">
            As the {you}: won {record.won}, lost {record.lost}
            {record.drawn ? `, drawn ${record.drawn}` : ''}
          </span>
        </p>
      )}
      <div className="fw-panel">
        <section aria-label="Looks and help">
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
            <button
              className="btn btn-ghost"
              aria-pressed={saved.guides}
              onClick={() => setSaved((s) => ({ ...s, guides: !s.guides }))}
            >
              Show moves
            </button>
          </div>
        </section>
      </div>
      <p className="muted lab-hint">
        Seventeen geese and one fox, on a cross of thirty-three points joined by the lines drawn. A
        goose steps along a line to an empty neighbour — sideways or down the board, never back up
        it. The fox steps any way, or jumps a goose to the empty point straight beyond it and takes
        it, and may keep jumping in one move. The geese win by hemming the fox in so it cannot move;
        the fox wins by taking {TAKE_TO_WIN}, or if the geese cannot move — and the geese must step
        forward at least once in every {IDLE_LIMIT} moves, or the fox wins. Pick a piece, then where
        it goes; a run of jumps is one move to its last point. Keys: arrows move between points,
        Enter picks and places, Escape lets go.
      </p>
    </div>
  )
}
