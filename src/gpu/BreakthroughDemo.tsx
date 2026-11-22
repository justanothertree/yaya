import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
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
import { useKept } from './kept'
import { breakthroughRules, type BreakthroughGame } from './breakthroughRoom'
import { useLabRoom } from '../lab/social/useLabRoom'
import { CallTable } from '../lab/social/CallTable'
import { tableSeats } from '../lab/social/table'
import { myTurn } from '../lab/social/room'
import { useLabMatch } from '../lab/matches/useLabMatch'
import { MatchBar, MatchSend } from '../lab/matches/MatchBar'
import { MatchChallenge } from '../lab/matches/MatchChallenge'
import { useSignedIn } from '../lab/matches/useSignedIn'
import { otherName } from '../lab/matches/words'

/** 'call': the room shared with friends in your call (src/lab/social/useLabRoom.ts) */
type Mode = 'bot' | 'two' | 'call'
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
  const [saved, setSaved] = useKept(BREAKTHROUGH_KEY, readSaved)
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

  /* ── a match by turns, when the address names one (src/lab/matches/useLabMatch.ts). It takes
     the board over whatever else was showing; leaving it puts the toy back as it was. A move
     shows at once and waits for Send; the server plays it and the board comes back. */
  const lm = useLabMatch('breakthrough')
  const inMatch = !!lm.id
  const signedIn = useSignedIn()
  const matchGame = inMatch ? (lm.shown as BreakthroughGame | null) : null

  /* ── the call's room: the host's size starts each game, which travels as its moves */
  const roomRules = useMemo(() => breakthroughRules(saved.size), [saved.size])
  const lab = useLabRoom('breakthrough', roomRules)
  const words = tableSeats(lab, roomRules)
  const room = mode === 'call' && !inMatch ? lab.room : null
  /** the toy's own controls: alone or two on one screen, neither in a call nor in a match */
  const local = mode !== 'call' && !inMatch
  /**
   * The board turned round for whoever plays the far side in a call, so their pawns are at the
   * bottom as the board's own label promises: square n²-1-k is drawn where k would be.
   */
  const flip = inMatch
    ? lm.view?.mode === 'versus' && lm.view.you === 1
    : room?.mode === 'versus' && words.mySeat === 1
  /** the game on screen: the match's, the call's in a call, else this one */
  const view = matchGame ? matchGame.g : room ? room.game.g : game
  const viewLast = matchGame ? matchGame.last : room ? room.game.last : last

  const n = view.board.n
  const sides = SIDES[saved.look]
  const all = moves(view)
  const yours = inMatch
    ? lm.canPlay
    : room
      ? lab.live && myTurn(roomRules, room)
      : mode !== 'call' && !game.winner && (mode === 'two' || game.turn === 1)
  const computerTurn = mode === 'bot' && !inMatch && !game.winner && game.turn === 2
  const nameOf = (s: Side) =>
    inMatch && lm.view
      ? lm.view.mode === 'together'
        ? s === 1
          ? 'You two'
          : 'The computer'
        : s - 1 === lm.view.you
          ? 'You'
          : otherName(lm.view)
      : room
        ? room.mode === 'together'
          ? s === 1
            ? 'Together'
            : 'The computer'
          : words.who(room.seats[s - 1])
        : mode === 'bot'
          ? s === 1
            ? 'You'
            : 'The computer'
          : sides[s - 1]
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
  /* leaving a match, the toy starts afresh rather than playing on from somebody else's board */
  const wasInMatch = useRef(inMatch)
  useEffect(() => {
    if (wasInMatch.current && !inMatch) fresh('bot')
    wasInMatch.current = inMatch
  })

  const tap = (i: number) => {
    if (!yours) return
    if (view.board.cells[i] === view.turn) {
      setPicked(picked === i ? null : i)
      return
    }
    const m = targets.find((x) => x.to === i)
    if (m && inMatch) {
      setPicked(null)
      lm.play(m)
    } else if (m && room) {
      // in the call the host decides: this asks it, and the board comes back with everybody's
      setPicked(null)
      lab.act({ t: 'move', move: m })
    } else if (m) apply(m)
    else setPicked(null)
  }
  /**
   * ⚠️ A SEATED PLAYER LEFT ALONE carries on against the computer, which always plays the far
   * side: the board on screen comes with you when yours is the near side, else a new game.
   */
  const carryOn = () => {
    const r = room ?? lab.room
    if (!r || r.game.g.winner || flip) return fresh('bot')
    recorded.current = false
    setMode('bot')
    setLevel(saved.level)
    setGame(r.game.g)
    setLast(r.game.last)
    setPicked(null)
    setLine(r.game.g.turn === 1 ? 'Your move.' : 'The computer is thinking…')
  }
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const r = Math.floor(cursor / n)
    const c = cursor % n
    // on a turned board every arrow means its opposite in the board's own squares
    const key = flip
      ? ({
          ArrowLeft: 'ArrowRight',
          ArrowRight: 'ArrowLeft',
          ArrowUp: 'ArrowDown',
          ArrowDown: 'ArrowUp',
        }[e.key] ?? e.key)
      : e.key
    let next = -1
    if (key === 'ArrowLeft') next = r * n + Math.max(0, c - 1)
    else if (key === 'ArrowRight') next = r * n + Math.min(n - 1, c + 1)
    else if (key === 'ArrowUp') next = Math.max(0, r - 1) * n + c
    else if (key === 'ArrowDown') next = Math.min(n - 1, r + 1) * n + c
    else if (e.key === 'Escape') setPicked(null)
    else return
    e.preventDefault()
    e.stopPropagation()
    if (next < 0) return
    setCursor(next)
    refs.current[next]?.focus()
  }

  const describe = (i: number) => {
    const p = view.board.cells[i]
    const what = p ? `${sides[p - 1].toLowerCase()} pawn` : 'empty'
    const extra = [
      picked === i ? 'picked' : '',
      lit.has(i) ? (p ? 'can be taken' : 'can go here') : '',
      viewLast && (viewLast.from === i || viewLast.to === i) ? 'last move' : '',
    ].filter(Boolean)
    return `${squareName(n, i)}: ${what}${extra.length ? `, ${extra.join(', ')}` : ''}`
  }

  const furthest = (s: Side) =>
    view.board.cells.reduce((m, p, i) => (p === s ? Math.max(m, advance(n, i, s)) : m), 0)
  const record = saved.record[saved.level]
  const untouched = !last
  return (
    <div className={`lab-keys bt-room is-${saved.look}`}>
      {inMatch && <MatchBar lm={lm} sides={['first', 'second']} />}
      {!inMatch && (
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
                onClick={() => {
                  setMode('call')
                  setPicked(null)
                }}
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
                    if (untouched || game.winner) fresh(mode, l)
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
          {signedIn && mode !== 'call' && (
            <MatchChallenge
              demo="breakthrough"
              settings={{ size: saved.size }}
              levelNames={LEVEL_NAMES}
            />
          )}
        </div>
      )}
      {mode === 'call' && !inMatch && (
        <CallTable
          table={lab}
          rules={roomRules}
          sides={sides}
          levelNames={LEVEL_NAMES}
          score={(d) =>
            d.g.winner
              ? count(d.g.board, d.g.winner === 1 ? 2 : 1)
                ? ' — a pawn through to the far row'
                : ' — every pawn taken'
              : null
          }
          onCarryOn={carryOn}
        />
      )}

      <div className="dice-scores">
        {([1, 2] as Side[]).map((s) => (
          <div key={s} className={`dice-score${view.turn === s && !view.winner ? ' is-up' : ''}`}>
            <span>
              {nameOf(s)} · {sides[s - 1].toLowerCase()}
            </span>
            <strong>{count(view.board, s)}</strong>
            <span className="muted">
              furthest {furthest(s)} of {n - 1} rows up
            </span>
          </div>
        ))}
      </div>
      {local && (
        <p className="mc-line" aria-live="polite">
          {line}
        </p>
      )}

      <div
        className={`bt-board${computerTurn ? ' is-thinking' : ''}`}
        style={{ ['--bt-n' as string]: n }}
        role="group"
        aria-label={`The board, ${n} by ${n}, your pawns at the bottom. Arrow keys move, Enter picks a pawn and then its square, Escape lets go.`}
        onKeyDown={onKey}
      >
        {Array.from({ length: n * n }, (_, k) => {
          const i = flip ? n * n - 1 - k : k
          const p = view.board.cells[i]
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
                viewLast && (viewLast.from === i || viewLast.to === i) ? 'is-last' : '',
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
      {inMatch && <MatchSend lm={lm} />}
      {mode === 'bot' && !inMatch && (
        <p className="sun-reading">
          <span className="muted">
            On {LEVEL_NAMES[saved.level]}: won {record.won}, lost {record.lost}
            {record.fastest ? ` · your quickest win ${record.fastest} moves` : ''}
          </span>
        </p>
      )}
      {mode === 'bot' && !inMatch && last && !game.winner && level !== saved.level && (
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
