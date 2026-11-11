import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import {
  BOARDS,
  GO_KEY,
  KOMI,
  LEVELS,
  N,
  PASS,
  choose,
  newGame,
  play,
  readSaved,
  score,
  winner,
  type Game,
  type Level,
  type Saved,
  type Who,
} from './goboard'

const load = (): Saved => {
  try {
    return readSaved(localStorage.getItem(GO_KEY))
  } catch {
    return readSaved(null)
  }
}
const LEVEL_NAMES: Record<Level, string> = { easy: 'Easy', fair: 'Fair', hard: 'Hard' }
const BOARD_NAMES: Record<Saved['board'], string> = {
  kaya: 'Kaya wood',
  slate: 'Slate',
  bamboo: 'Bamboo',
}
/** the usual coordinates: columns A–J leaving out I, rows 9 at the top to 1 */
const COLS = 'ABCDEFGHJ'
const pointName = (i: number) => `${COLS[i % N]}${N - Math.floor(i / N)}`
const STARS = new Set([2 * N + 2, 2 * N + 6, 6 * N + 2, 6 * N + 6, 4 * N + 4])
const colourName = (w: Who) => (w === 1 ? 'black' : 'white')

export function GoDemo() {
  const [saved, setSaved] = useState<Saved>(load)
  const [level, setLevel] = useState<Level>(saved.level)
  const [you, setYou] = useState<Who>(1)
  const [game, setGame] = useState<Game>(newGame)
  const [thinking, setThinking] = useState(false)
  const [line, setLine] = useState('You play black and move first. Tap a point to place a stone.')
  const [end, setEnd] = useState<string | null>(null)
  const [cursor, setCursor] = useState(40)
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const timer = useRef(0)
  // read by the computer's reply, which runs from a timer an earlier render set
  const youRef = useRef(you)
  const levelRef = useRef(level)
  const recorded = useRef(false)
  useEffect(() => {
    try {
      localStorage.setItem(GO_KEY, JSON.stringify(saved))
    } catch {
      /* private mode: kept for this visit */
    }
  }, [saved])
  useEffect(() => () => window.clearTimeout(timer.current), [])

  const finish = (g: Game, resigned?: Who) => {
    const s = score(g.board)
    const w = resigned ? (resigned === 1 ? 2 : 1) : winner(g)
    if (!recorded.current) {
      recorded.current = true
      const lv = levelRef.current
      const won = w === youRef.current
      setSaved((x) => ({
        ...x,
        record: {
          ...x.record,
          [lv]: { won: x.record[lv].won + (won ? 1 : 0), lost: x.record[lv].lost + (won ? 0 : 1) },
        },
      }))
    }
    const margin = Math.abs(s.black - s.white)
    setEnd(
      resigned
        ? `${resigned === youRef.current ? 'You resigned' : 'The computer resigned'} — ${colourName(w)} wins.`
        : `Black ${s.black}, white ${s.white} (with ${KOMI} for moving second) — ${w === youRef.current ? '🏆 you win' : 'the computer wins'} by ${margin}.`,
    )
  }

  const after = (g: Game, said: string) => {
    setGame(g)
    if (g.over) return finish(g)
    if (g.turn !== youRef.current) {
      setThinking(true)
      setLine(`${said} The computer is thinking…`)
      // a moment for the board to show your stone before the search takes the page
      timer.current = window.setTimeout(() => {
        const m = choose(g, levelRef.current)
        const next = play(g, m) ?? play(g, PASS)!
        setThinking(false)
        setGame(next)
        if (next.over) return finish(next)
        const them: Who = youRef.current === 1 ? 2 : 1
        const caught = next.taken[them] - g.taken[them]
        setLine(
          m === PASS
            ? 'The computer passes. Pass too to end the game and count.'
            : `The computer plays ${pointName(m)}.${caught ? ` It takes ${caught} ${caught === 1 ? 'stone' : 'stones'}!` : ''} Your move.`,
        )
      }, 60)
    } else setLine(`${said} Your move.`)
  }

  const tap = (i: number) => {
    if (end || thinking || game.turn !== you) return
    if (game.board[i]) return setLine('That point is taken.')
    const next = play(game, i)
    if (!next)
      return setLine(
        i === game.ko
          ? 'Ko: that stone cannot be taken straight back — play elsewhere first.'
          : 'No liberty there: a stone may not fill its own last breath unless it captures.',
      )
    const caught = next.taken[you] - game.taken[you]
    after(
      next,
      caught
        ? `You take ${caught} ${caught === 1 ? 'stone' : 'stones'}!`
        : `You play ${pointName(i)}.`,
    )
  }
  const pass = () => {
    if (end || thinking || game.turn !== you) return
    after(play(game, PASS)!, 'You pass.')
  }
  const resign = () => {
    if (end || game.moves === 0) return
    window.clearTimeout(timer.current)
    setThinking(false)
    finish(game, you)
  }
  const fresh = (lv: Level = saved.level) => {
    window.clearTimeout(timer.current)
    const side: Who = game.moves > 0 ? (you === 1 ? 2 : 1) : you
    youRef.current = side
    levelRef.current = lv
    recorded.current = false
    setYou(side)
    setLevel(lv)
    setEnd(null)
    setThinking(false)
    const g = newGame()
    setGame(g)
    if (side === 2) after(g, 'You play white this time.')
    else setLine('You play black and move first.')
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
    const r = Math.max(0, Math.min(N - 1, Math.floor(cursor / N) + d[e.key][0]))
    const c = Math.max(0, Math.min(N - 1, (cursor % N) + d[e.key][1]))
    setCursor(r * N + c)
    refs.current[r * N + c]?.focus()
  }

  const s = score(game.board)
  const r = saved.record[saved.level]
  return (
    <div className={`lab-keys go-room is-${saved.board}`}>
      <div className="lab-controls">
        <div className="lab-group" role="group" aria-label="How well the computer plays">
          {LEVELS.map((l) => (
            <button
              key={l}
              className="btn btn-ghost"
              aria-pressed={saved.level === l}
              onClick={() => {
                setSaved((x) => ({ ...x, level: l }))
                if (game.moves === 0 || end) fresh(l)
              }}
            >
              {LEVEL_NAMES[l]}
            </button>
          ))}
        </div>
        <button
          className="btn btn-ghost"
          onClick={pass}
          disabled={!!end || thinking || game.turn !== you}
        >
          Pass
        </button>
        <button className="btn btn-ghost" onClick={resign} disabled={!!end || game.moves === 0}>
          Resign
        </button>
        <button className="btn btn-ghost" onClick={() => fresh()}>
          ↻ New game
        </button>
      </div>
      <div className="dice-scores">
        {([1, 2] as Who[]).map((w) => (
          <div key={w} className={`dice-score${game.turn === w && !end ? ' is-up' : ''}`}>
            <span>
              {w === you ? 'You' : 'The computer'} · {colourName(w)}
            </span>
            <strong>{w === 1 ? s.black : s.white}</strong>
            <span className="muted">
              {w === 2 ? `with ${KOMI} komi · ` : ''}took {game.taken[w]}
            </span>
          </div>
        ))}
      </div>
      <p className="mc-line" aria-live="polite">
        {end ?? line}
      </p>

      <div
        className="go-board"
        role="grid"
        aria-label="The board, nine by nine. Arrow keys move between points, Enter plays."
        onKeyDown={onKey}
      >
        <svg className="go-lines" viewBox={`-0.5 -0.5 ${N} ${N}`} aria-hidden>
          {Array.from({ length: N }, (_, k) => (
            <g key={k}>
              <line x1={0} y1={k} x2={N - 1} y2={k} />
              <line x1={k} y1={0} x2={k} y2={N - 1} />
            </g>
          ))}
          {[...STARS].map((i) => (
            <circle key={i} cx={i % N} cy={Math.floor(i / N)} r={0.09} />
          ))}
        </svg>
        {game.board.map((st, i) => (
          <button
            key={i}
            ref={(el) => {
              refs.current[i] = el
            }}
            role="gridcell"
            className={[
              'go-pt',
              st ? `is-s${st}` : '',
              game.last === i ? 'is-last' : '',
              saved.shade && !st && s.owner[i] ? `own-${s.owner[i]}` : '',
            ]
              .filter(Boolean)
              .join(' ')}
            style={{
              left: `${((i % N) + 0.5) * (100 / N)}%`,
              top: `${(Math.floor(i / N) + 0.5) * (100 / N)}%`,
            }}
            tabIndex={i === cursor ? 0 : -1}
            aria-label={`${pointName(i)}: ${st ? `${colourName(st as Who)} stone` : 'empty'}${game.last === i ? ', the last move' : ''}`}
            onFocus={() => setCursor(i)}
            onClick={() => {
              setCursor(i)
              tap(i)
            }}
          >
            <span aria-hidden />
          </button>
        ))}
      </div>
      <p className="sun-reading">
        <span className="muted">
          Against {LEVEL_NAMES[saved.level]}: won {r.won}, lost {r.lost} · you play{' '}
          {colourName(you)}, and swap each game
        </span>
      </p>
      {level !== saved.level && game.moves > 0 && !end && (
        <p className="muted mc-note">The new level starts with the next game.</p>
      )}
      <div className="fw-panel">
        <section aria-label="Looks">
          <h3 className="fw-h">Board</h3>
          <div className="lab-controls" role="group" aria-label="Board">
            {BOARDS.map((b) => (
              <button
                key={b}
                className="btn btn-ghost"
                aria-pressed={saved.board === b}
                onClick={() => setSaved((x) => ({ ...x, board: b }))}
              >
                {BOARD_NAMES[b]}
              </button>
            ))}
            <button
              className="btn btn-ghost"
              aria-pressed={saved.shade}
              onClick={() => setSaved((x) => ({ ...x, shade: !x.shade }))}
            >
              Shade who owns each point
            </button>
          </div>
        </section>
      </div>
      <p className="muted lab-hint">
        Take turns placing stones on the points. A group of stones with no empty point beside it is
        taken off. You may not play where your stone would have no liberty unless it captures, nor
        take back a single stone at once in a ko. When both pass, the game is counted: every stone
        on the board and every empty area surrounded by one colour is that colour's, and white gets
        {` ${KOMI}`} for moving second. The count takes the board as it stands, so capture any
        stones that are dead before you pass. Easy, Fair and Hard play out 250, 1,200 and 2,500
        random games before each move and play the one that won most. Keys: arrows move between
        points, Enter plays.
      </p>
    </div>
  )
}
