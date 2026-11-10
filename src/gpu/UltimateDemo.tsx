import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import {
  LEVELS,
  MARK_SETS,
  THEMES,
  ULTIMATE_KEY,
  choose,
  moves,
  newGame,
  play,
  readSaved,
  type Game,
  type Level,
  type MarkSet,
  type Saved,
  type Who,
} from './ultimate'

type Mode = 'bot' | 'two'
const load = (): Saved => {
  try {
    return readSaved(localStorage.getItem(ULTIMATE_KEY))
  } catch {
    return readSaved(null)
  }
}
const LEVEL_NAMES: Record<Level, string> = { easy: 'Easy', fair: 'Fair', hard: 'Hard' }
const MARK_NAMES: Record<MarkSet, string> = {
  classic: 'Crosses and noughts',
  shapes: 'Shapes',
  animals: 'Cats and dogs',
  space: 'Rockets and planets',
}
const THEME_NAMES: Record<Saved['theme'], string> = {
  paper: 'Paper',
  chalk: 'Chalkboard',
  neon: 'Glow',
}
const PLACE = [
  'top left',
  'top middle',
  'top right',
  'middle left',
  'centre',
  'middle right',
  'bottom left',
  'bottom middle',
  'bottom right',
]

/** a square's place on the whole 9 × 9 grid, for walking it with the arrow keys */
const rowOf = (i: number) => Math.floor(Math.floor(i / 9) / 3) * 3 + Math.floor((i % 9) / 3)
const colOf = (i: number) => (Math.floor(i / 9) % 3) * 3 + ((i % 9) % 3)
const indexAt = (row: number, col: number) =>
  (Math.floor(row / 3) * 3 + Math.floor(col / 3)) * 9 + (row % 3) * 3 + (col % 3)

export function UltimateDemo() {
  const [saved, setSaved] = useState<Saved>(load)
  const [mode, setMode] = useState<Mode>('bot')
  const [game, setGame] = useState<Game>(newGame)
  const [you, setYou] = useState<Who>(1)
  const [level, setLevel] = useState<Level>(saved.level)
  const [line, setLine] = useState(
    'You move first. Play anywhere — the square you choose sends the computer to that board.',
  )
  const [cursor, setCursor] = useState(40)
  const [thinking, setThinking] = useState(false)
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const recorded = useRef(false)
  useEffect(() => {
    try {
      localStorage.setItem(ULTIMATE_KEY, JSON.stringify(saved))
    } catch {
      /* private mode: kept for this visit */
    }
  }, [saved])

  const marks = MARK_SETS[saved.marks]
  const nameOf = (w: Who) =>
    mode === 'bot' ? (w === you ? 'You' : 'The computer') : `${marks[w - 1]}`
  const legal = new Set(moves(game))
  const computerTurn = mode === 'bot' && !game.winner && game.turn !== you

  const afterMove = (g: Game, by: Who) => {
    setGame(g)
    if (g.winner) {
      if (mode === 'bot' && !recorded.current) {
        recorded.current = true
        const result = g.winner === 3 ? 'drawn' : g.winner === you ? 'won' : 'lost'
        setSaved((s) => ({
          ...s,
          record: {
            ...s.record,
            [level]: { ...s.record[level], [result]: s.record[level][result] + 1 },
          },
        }))
      }
      setLine(
        g.winner === 3
          ? 'A draw — nobody has three boards in a row.'
          : g.winner === you || mode === 'two'
            ? `🏆 ${mode === 'bot' ? 'You win' : `${marks[g.winner - 1]} wins`} — three boards in a row!`
            : 'The computer has three boards in a row.',
      )
      return
    }
    const where = g.next < 0 ? 'anywhere' : `the ${PLACE[g.next]} board`
    const took =
      g.boards[Math.floor(g.last / 9)] && g.boards[Math.floor(g.last / 9)] !== 3
        ? `${nameOf(by)} ${by === you && mode === 'bot' ? 'take' : 'takes'} the ${PLACE[Math.floor(g.last / 9)]} board. `
        : ''
    setLine(
      `${took}${mode === 'bot' ? (g.turn === you ? `Your move — ${where}.` : 'The computer is thinking…') : `${marks[g.turn - 1]} to play — ${where}.`}`,
    )
  }
  const tap = (i: number) => {
    if (!legal.has(i) || thinking || (mode === 'bot' && game.turn !== you)) return
    afterMove(play(game, i), game.turn)
  }

  useEffect(() => {
    if (!computerTurn) return
    setThinking(true)
    // a moment for the page to show "thinking" before the search takes the main thread
    const t = window.setTimeout(() => {
      const m = choose(game, level)
      setThinking(false)
      afterMove(play(game, m), game.turn)
    }, 350)
    return () => window.clearTimeout(t)
    // the game and whose turn it is are what start the computer's move
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [computerTurn, game])

  const fresh = (m: Mode = mode, lv: Level = saved.level) => {
    const nextYou: Who = game.cells.some((c) => c) && m === mode ? (you === 1 ? 2 : 1) : 1
    recorded.current = false
    setMode(m)
    setLevel(lv)
    setYou(nextYou)
    setThinking(false)
    setGame(newGame())
    setLine(
      m === 'two'
        ? `${marks[0]} first — play anywhere.`
        : nextYou === 1
          ? 'You move first. Play anywhere.'
          : 'The computer moves first this time…',
    )
  }

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const d: Record<string, [number, number]> = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
    }
    if (!d[e.key]) return
    e.preventDefault()
    e.stopPropagation()
    const r = Math.max(0, Math.min(8, rowOf(cursor) + d[e.key][0]))
    const c = Math.max(0, Math.min(8, colOf(cursor) + d[e.key][1]))
    const next = indexAt(r, c)
    setCursor(next)
    refs.current[next]?.focus()
  }

  const record = saved.record[saved.level]
  return (
    <div className={`lab-keys ut-room is-${saved.theme}`}>
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
                  if (!game.cells.some((c) => c) || game.winner) fresh(mode, l)
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
      <p className="mc-line" aria-live="polite">
        {line}
      </p>

      <div
        className="ut-big"
        role="grid"
        aria-label="Nine boards. Arrow keys move, Enter plays."
        onKeyDown={onKey}
      >
        {Array.from({ length: 9 }, (_, b) => {
          const won = game.boards[b]
          const open =
            saved.guide &&
            !game.winner &&
            Array.from({ length: 9 }, (_, s) => legal.has(b * 9 + s)).some(Boolean)
          return (
            <div
              key={b}
              role="row"
              className={`ut-small${open ? ' is-open' : ''}${won ? ` is-won is-${won === 3 ? 'full' : `p${won}`}` : ''}`}
              aria-label={`The ${PLACE[b]} board${won === 1 || won === 2 ? `, taken by ${marks[won - 1]}` : won === 3 ? ', full' : ''}`}
            >
              {Array.from({ length: 9 }, (_, s) => {
                const i = b * 9 + s
                const c = game.cells[i]
                return (
                  <div role="gridcell" key={s}>
                    <button
                      ref={(el) => {
                        refs.current[i] = el
                      }}
                      className={`ut-cell${c ? ` is-p${c}` : ''}${game.last === i ? ' is-last' : ''}`}
                      tabIndex={i === cursor ? 0 : -1}
                      aria-label={`${PLACE[b]} board, ${PLACE[s]} square: ${c ? marks[c - 1] : legal.has(i) ? 'empty, playable' : 'empty'}`}
                      aria-disabled={!legal.has(i)}
                      onFocus={() => setCursor(i)}
                      onClick={() => {
                        setCursor(i)
                        tap(i)
                      }}
                    >
                      <span aria-hidden>{c ? marks[c - 1] : ''}</span>
                    </button>
                  </div>
                )
              })}
              {(won === 1 || won === 2) && (
                <span className="ut-claim" aria-hidden>
                  {marks[won - 1]}
                </span>
              )}
            </div>
          )
        })}
      </div>
      {mode === 'bot' && (
        <p className="sun-reading">
          <span className="muted">
            On {LEVEL_NAMES[saved.level]}: won {record.won}, lost {record.lost}
            {record.drawn ? `, drawn ${record.drawn}` : ''} · you are {marks[you - 1]}
          </span>
        </p>
      )}
      {mode === 'bot' && game.cells.some((c) => c) && !game.winner && level !== saved.level && (
        <p className="muted mc-note">The new level starts with the next game.</p>
      )}

      <div className="fw-panel">
        <section aria-label="Looks">
          <h3 className="fw-h">Marks</h3>
          <div className="lab-controls" role="group" aria-label="Marks">
            {(Object.keys(MARK_SETS) as MarkSet[]).map((m) => (
              <button
                key={m}
                className="btn btn-ghost"
                aria-pressed={saved.marks === m}
                onClick={() => setSaved((s) => ({ ...s, marks: m }))}
              >
                {MARK_SETS[m].join(' ')} <span className="sr-only">{MARK_NAMES[m]}</span>
              </button>
            ))}
          </div>
          <h3 className="fw-h">Board</h3>
          <div className="lab-controls" role="group" aria-label="Board">
            {THEMES.map((t) => (
              <button
                key={t}
                className="btn btn-ghost"
                aria-pressed={saved.theme === t}
                onClick={() => setSaved((s) => ({ ...s, theme: t }))}
              >
                {THEME_NAMES[t]}
              </button>
            ))}
            <button
              className="btn btn-ghost"
              aria-pressed={saved.guide}
              onClick={() => setSaved((s) => ({ ...s, guide: !s.guide }))}
            >
              Light up where to play
            </button>
          </div>
        </section>
      </div>
      <p className="muted lab-hint">
        Nine small boards make one big one. Three in a row on a small board wins it; three small
        boards in a row wins the game. The twist: the square you play in sends the other player to
        the matching board — play the top-right square of any board and they must play next in the
        top-right board. Sent to a board that is already won or full, they may play anywhere. Easy
        grabs small boards; Fair and Hard play out thousands of random games from each move (1,500
        and 12,000) and steer toward the ones they keep winning. Keys: arrows move across all 81
        squares, Enter plays.
      </p>
    </div>
  )
}
