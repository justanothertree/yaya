import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import {
  BREAKTHROUGH_KEY,
  LEVELS,
  LOOKS,
  SIZES,
  advance,
  choose,
  count,
  moves,
  newGame,
  play,
  readSaved,
  type Game,
  type Level,
  type Move,
  type Saved,
  type Side,
  type Size,
} from './breakthrough'

type Mode = 'bot' | 'two'
const load = (): Saved => {
  try {
    return readSaved(localStorage.getItem(BREAKTHROUGH_KEY))
  } catch {
    return readSaved(null)
  }
}
const LEVEL_NAMES: Record<Level, string> = { easy: 'Easy', fair: 'Fair', hard: 'Hard' }
const LOOK_NAMES: Record<Saved['look'], string> = { stone: 'Stone', garden: 'Garden', neon: 'Neon' }
/** each look names its two sides */
const SIDES: Record<Saved['look'], [string, string]> = {
  stone: ['White', 'Black'],
  garden: ['Daisies', 'Beetles'],
  neon: ['Cyan', 'Magenta'],
}
const FILES = 'abcdefgh'
const squareName = (n: number, i: number) => `${FILES[i % n]}${n - Math.floor(i / n)}`

export function BreakthroughDemo() {
  const [saved, setSaved] = useState<Saved>(load)
  const [mode, setMode] = useState<Mode>('bot')
  const [level, setLevel] = useState<Level>(saved.level)
  const [game, setGame] = useState<Game>(() => newGame(saved.size, 1))
  const [picked, setPicked] = useState<number | null>(null)
  const [last, setLast] = useState<Move | null>(null)
  const [line, setLine] = useState(
    'You play from the bottom and move first. Get one pawn to the far row, or take them all.',
  )
  const [cursor, setCursor] = useState(() => saved.size * (saved.size - 2))
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const recorded = useRef(false)
  /** who moved first in the game being played, so the next game can give the first move away */
  const firstRef = useRef<Side>(1)
  useEffect(() => {
    try {
      localStorage.setItem(BREAKTHROUGH_KEY, JSON.stringify(saved))
    } catch {
      /* private mode: kept for this visit */
    }
  }, [saved])

  const n = game.board.n
  const sides = SIDES[saved.look]
  const all = moves(game)
  const yours = !game.winner && (mode === 'two' || game.turn === 1)
  const computerTurn = mode === 'bot' && !game.winner && game.turn === 2
  const nameOf = (s: Side) => (mode === 'bot' ? (s === 1 ? 'You' : 'The computer') : sides[s - 1])
  const targets = picked === null ? [] : all.filter((m) => m.from === picked)
  const lit = new Set(targets.map((m) => m.to))
  const movable = new Set(all.map((m) => m.from))

  const apply = (m: Move) => {
    const by = game.turn
    const g = play(game, m)
    setGame(g)
    setLast(m)
    setPicked(null)
    if (g.winner) {
      const w = g.winner
      const how =
        advance(n, m.to, by) === n - 1 ? 'a pawn through to the far row' : 'every pawn taken'
      if (mode === 'bot' && !recorded.current) {
        recorded.current = true
        const yourMoves = Math.ceil(g.plies / 2)
        setSaved((s) => {
          const t = s.record[level]
          return {
            ...s,
            record: {
              ...s.record,
              [level]: {
                won: t.won + (w === 1 ? 1 : 0),
                lost: t.lost + (w === 2 ? 1 : 0),
                fastest: w === 1 && (!t.fastest || yourMoves < t.fastest) ? yourMoves : t.fastest,
              },
            },
          }
        })
      }
      setLine(
        mode === 'bot'
          ? w === 1
            ? `🏆 You win — ${how}, in ${Math.ceil(g.plies / 2)} moves.`
            : `The computer wins — ${how}.`
          : `🏆 ${sides[w - 1]} win — ${how}.`,
      )
      return
    }
    const took = m.take
      ? `${nameOf(by)} ${by === 1 && mode === 'bot' ? 'take' : 'takes'} on ${squareName(n, m.to)}. `
      : ''
    // a pawn one step from home is a threat that must be answered at once
    const near = g.board.cells.some((p, i) => p === by && advance(n, i, by) === n - 2)
    const warn = near
      ? ` ${by === 1 && mode === 'bot' ? 'Your' : `${nameOf(by)}’s`} pawn is one step from home!`
      : ''
    setLine(
      `${took}${mode === 'bot' ? (g.turn === 1 ? `Your move.${warn}` : `The computer is thinking…${warn}`) : `${sides[g.turn - 1]} to move.${warn}`}`,
    )
  }

  useEffect(() => {
    if (!computerTurn) return
    // a beat first, so "thinking" is on the screen before Hard's look holds the page
    const t = window.setTimeout(() => apply(choose(game, level)), 450)
    return () => window.clearTimeout(t)
    // the game is what starts the computer's move
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [computerTurn, game])

  const fresh = (m: Mode = mode, lv: Level = saved.level, size: Size = saved.size) => {
    recorded.current = false
    // against the computer the first move alternates, game by game
    const first: Side = m === 'bot' && last && m === mode ? (firstRef.current === 1 ? 2 : 1) : 1
    firstRef.current = first
    setMode(m)
    setLevel(lv)
    setGame(newGame(size, first))
    setPicked(null)
    setLast(null)
    setCursor(size * (size - 2))
    setLine(
      m === 'two'
        ? `${SIDES[saved.look][0]} move first, up the board.`
        : first === 1
          ? 'You play from the bottom and move first.'
          : 'You play from the bottom; the computer moves first this time…',
    )
  }

  const tap = (i: number) => {
    if (!yours) return
    if (game.board.cells[i] === game.turn) {
      setPicked(picked === i ? null : i)
      return
    }
    const m = targets.find((x) => x.to === i)
    if (m) apply(m)
    else setPicked(null)
  }
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const r = Math.floor(cursor / n)
    const c = cursor % n
    let next = -1
    if (e.key === 'ArrowLeft') next = r * n + Math.max(0, c - 1)
    else if (e.key === 'ArrowRight') next = r * n + Math.min(n - 1, c + 1)
    else if (e.key === 'ArrowUp') next = Math.max(0, r - 1) * n + c
    else if (e.key === 'ArrowDown') next = Math.min(n - 1, r + 1) * n + c
    else if (e.key === 'Escape') setPicked(null)
    else return
    e.preventDefault()
    e.stopPropagation()
    if (next < 0) return
    setCursor(next)
    refs.current[next]?.focus()
  }

  const describe = (i: number) => {
    const p = game.board.cells[i]
    const what = p ? `${sides[p - 1].toLowerCase()} pawn` : 'empty'
    const extra = [
      picked === i ? 'picked' : '',
      lit.has(i) ? (p ? 'can be taken' : 'can go here') : '',
      last && (last.from === i || last.to === i) ? 'last move' : '',
    ].filter(Boolean)
    return `${squareName(n, i)}: ${what}${extra.length ? `, ${extra.join(', ')}` : ''}`
  }

  const furthest = (s: Side) =>
    game.board.cells.reduce((m, p, i) => (p === s ? Math.max(m, advance(n, i, s)) : m), 0)
  const record = saved.record[saved.level]
  const untouched = !last
  return (
    <div className={`lab-keys bt-room is-${saved.look}`}>
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
                  if (untouched || game.winner) fresh(mode, l)
                }}
              >
                {LEVEL_NAMES[l]}
              </button>
            ))}
          </div>
        )}
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
        <button className="btn btn-ghost" onClick={() => fresh()}>
          ↻ New game
        </button>
      </div>

      <div className="dice-scores">
        {([1, 2] as Side[]).map((s) => (
          <div key={s} className={`dice-score${game.turn === s && !game.winner ? ' is-up' : ''}`}>
            <span>
              {nameOf(s)} · {sides[s - 1].toLowerCase()}
            </span>
            <strong>{count(game.board, s)}</strong>
            <span className="muted">
              furthest {furthest(s)} of {n - 1} rows up
            </span>
          </div>
        ))}
      </div>
      <p className="mc-line" aria-live="polite">
        {line}
      </p>

      <div
        className={`bt-board${computerTurn ? ' is-thinking' : ''}`}
        style={{ ['--bt-n' as string]: n }}
        role="group"
        aria-label={`The board, ${n} by ${n}, your pawns at the bottom. Arrow keys move, Enter picks a pawn and then its square, Escape lets go.`}
        onKeyDown={onKey}
      >
        {Array.from({ length: n * n }, (_, i) => {
          const p = game.board.cells[i]
          const dark = (Math.floor(i / n) + (i % n)) % 2 === 1
          return (
            <button
              key={i}
              ref={(el) => {
                refs.current[i] = el
              }}
              className={[
                'bt-sq',
                dark ? 'is-dark' : '',
                p ? `is-p${p}` : '',
                picked === i ? 'is-picked' : '',
                lit.has(i) && saved.hints ? 'is-lit' : '',
                last && (last.from === i || last.to === i) ? 'is-last' : '',
                saved.hints && yours && picked === null && movable.has(i) ? 'can-move' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              tabIndex={i === cursor ? 0 : -1}
              aria-label={describe(i)}
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
      {mode === 'bot' && (
        <p className="sun-reading">
          <span className="muted">
            On {LEVEL_NAMES[saved.level]}: won {record.won}, lost {record.lost}
            {record.fastest ? ` · your quickest win ${record.fastest} moves` : ''}
          </span>
        </p>
      )}
      {mode === 'bot' && last && !game.winner && level !== saved.level && (
        <p className="muted mc-note">The new level starts with the next game.</p>
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
            <button
              className="btn btn-ghost"
              aria-pressed={saved.hints}
              onClick={() => setSaved((s) => ({ ...s, hints: !s.hints }))}
            >
              Show where pawns can go
            </button>
          </div>
        </section>
      </div>
      <p className="muted lab-hint">
        A pawn steps one square forward — straight ahead or diagonally — onto an empty square, and
        takes only diagonally, never straight ahead. Get one pawn to the far row, or take every pawn
        the other side has, to win; there are no draws. A pawn guarded by a friend diagonally behind
        it costs the other side a pawn to take. Easy looks one move ahead, Fair three plies and Hard
        four or five. Keys: arrows move, Enter picks a pawn and then its square, Escape lets go.
      </p>
    </div>
  )
}
