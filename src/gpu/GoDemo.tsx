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
import { useKept } from './kept'
import { goRules, type GoGame } from './goRoom'
import { useLabRoom } from '../lab/social/useLabRoom'
import { CallTable } from '../lab/social/CallTable'
import { tableSeats } from '../lab/social/table'
import { myTurn } from '../lab/social/room'
import { useLabMatch } from '../lab/matches/useLabMatch'
import { MatchBar, MatchSend } from '../lab/matches/MatchBar'
import { MatchChallenge } from '../lab/matches/MatchChallenge'
import { useSignedIn } from '../lab/matches/useSignedIn'
import { otherName } from '../lab/matches/words'

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
  const [saved, setSaved] = useKept(GO_KEY, readSaved)
  /** 'call': the room shared with friends in your call (src/lab/social/useLabRoom.ts) */
  const [mode, setMode] = useState<'bot' | 'call'>('bot')
  /** in a call, why a point was not played: the table speaks for the turn, this for the rules */
  const [note, setNote] = useState<string | null>(null)
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
  useEffect(() => () => window.clearTimeout(timer.current), [])

  /* ── a match by turns, when the address names one (src/lab/matches/useLabMatch.ts). It takes
     the board over whatever else was showing; leaving it puts the toy back as it was. A point or
     a pass shows at once and waits for Send; the server plays it and the board comes back. */
  const lm = useLabMatch('go')
  const inMatch = !!lm.id
  const signedIn = useSignedIn()
  const matchGame = inMatch ? (lm.shown as GoGame | null) : null

  /* ── the call's room: the game travels as its moves, replayed by goboard.ts itself */
  const lab = useLabRoom('go', goRules)
  const words = tableSeats(lab, goRules)
  const room = mode === 'call' && !inMatch ? lab.room : null
  /** shared with somebody, in a call or a match: the rules speak through the note, not the line */
  const shared = !!room || inMatch
  /** the game on screen: the match's, the call's in a call, else this one */
  const view = matchGame ? matchGame.g : room ? room.game.g : game
  /** the colour I play in a call: white only in seat 1 of a versus game */
  const mine: Who = room?.mode === 'versus' && words.mySeat === 1 ? 2 : 1
  const myMove = inMatch ? lm.canPlay : !!room && lab.live && myTurn(goRules, room)
  const nameOf = (w: Who) =>
    inMatch && lm.view
      ? lm.view.mode === 'together'
        ? w === 1
          ? 'You two'
          : 'The computer'
        : w - 1 === lm.view.you
          ? 'You'
          : otherName(lm.view)
      : room
        ? room.mode === 'together'
          ? w === 1
            ? 'Together'
            : 'The computer'
          : words.who(room.seats[w - 1])
        : w === you
          ? 'You'
          : 'The computer'
  /**
   * ⚠️ A SEATED PLAYER LEFT ALONE carries on against the computer from the board on screen,
   * keeping their colour — or starts a new game if that one was over.
   */
  const carryOn = () => {
    const r0 = room ?? lab.room
    setMode('bot')
    setNote(null)
    if (!r0 || r0.game.g.over) return fresh()
    window.clearTimeout(timer.current)
    youRef.current = mine
    levelRef.current = saved.level
    recorded.current = false
    setYou(mine)
    setLevel(saved.level)
    setEnd(null)
    setThinking(false)
    after(r0.game.g, 'Carrying on against the computer.')
  }

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
    if (shared) {
      // in the call the host decides, in a match the server: this asks, and the board comes back
      if (!myMove) return
      const why = whyNot(view, i)
      setNote(why)
      if (why) return
      if (inMatch) lm.play(i)
      else lab.act({ t: 'move', move: i })
      return
    }
    if (mode !== 'bot' || end || thinking || game.turn !== you) return
    const why = whyNot(game, i)
    if (why) return setLine(why)
    const next = play(game, i)!
    const caught = next.taken[you] - game.taken[you]
    after(
      next,
      caught
        ? `You take ${caught} ${caught === 1 ? 'stone' : 'stones'}!`
        : `You play ${pointName(i)}.`,
    )
  }
  const pass = () => {
    if (shared) {
      if (!myMove) return
      setNote(null)
      if (inMatch) lm.play(PASS)
      else lab.act({ t: 'move', move: PASS })
      return
    }
    if (end || thinking || game.turn !== you) return
    after(play(game, PASS)!, 'You pass.')
  }
  /** why a point cannot be played now, in the rules' own words, or null when it can */
  const whyNot = (g: Game, i: number) =>
    g.board[i]
      ? 'That point is taken.'
      : play(g, i)
        ? null
        : i === g.ko
          ? 'Ko: that stone cannot be taken straight back — play elsewhere first.'
          : 'No liberty there: a stone may not fill its own last breath unless it captures.'
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

  /* leaving a match, the toy starts afresh rather than playing on from somebody else's board */
  const wasInMatch = useRef(inMatch)
  useEffect(() => {
    if (wasInMatch.current && !inMatch) {
      setMode('bot')
      setNote(null)
      fresh()
    }
    wasInMatch.current = inMatch
    // only leaving the match starts a game
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inMatch])

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

  const s = score(view.board)
  const r = saved.record[saved.level]
  return (
    <div className={`lab-keys go-room is-${saved.board}`}>
      {inMatch && <MatchBar lm={lm} sides={['black', 'white']} />}
      <div className="lab-controls">
        {!inMatch && (lab.live || mode === 'call') && (
          <div className="lab-group" role="group" aria-label="Opponent">
            <button
              className="btn btn-ghost"
              aria-pressed={mode === 'bot'}
              onClick={() => {
                setMode('bot')
                setNote(null)
                fresh()
              }}
            >
              Against the computer
            </button>
            <button
              className="btn btn-ghost"
              aria-pressed={mode === 'call'}
              onClick={() => {
                window.clearTimeout(timer.current)
                setThinking(false)
                setMode('call')
              }}
            >
              👥 With the call
            </button>
          </div>
        )}
        {mode === 'bot' && !inMatch && (
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
        )}
        <button
          className="btn btn-ghost"
          onClick={pass}
          disabled={shared ? !myMove : mode !== 'bot' || !!end || thinking || game.turn !== you}
        >
          Pass
        </button>
        {mode === 'bot' && !inMatch && (
          <>
            <button className="btn btn-ghost" onClick={resign} disabled={!!end || game.moves === 0}>
              Resign
            </button>
            <button className="btn btn-ghost" onClick={() => fresh()}>
              ↻ New game
            </button>
            {signedIn && <MatchChallenge demo="go" settings={{}} levelNames={LEVEL_NAMES} />}
          </>
        )}
      </div>
      {mode === 'call' && !inMatch && (
        <CallTable
          table={lab}
          rules={goRules}
          sides={['Black', 'White']}
          levelNames={LEVEL_NAMES}
          score={(d) => {
            const c = score(d.g.board)
            return `, black ${c.black} to white ${c.white} with ${KOMI} komi`
          }}
          onCarryOn={carryOn}
        />
      )}
      <div className="dice-scores">
        {([1, 2] as Who[]).map((w) => (
          <div
            key={w}
            className={`dice-score${view.turn === w && !(shared ? view.over : end) ? ' is-up' : ''}`}
          >
            <span>
              {nameOf(w)} · {colourName(w)}
            </span>
            <strong>{w === 1 ? s.black : s.white}</strong>
            <span className="muted">
              {w === 2 ? `with ${KOMI} komi · ` : ''}took {view.taken[w]}
            </span>
          </div>
        ))}
      </div>
      {shared || mode === 'call' ? (
        note && (
          <p className="muted mc-note" aria-live="polite">
            {note}
          </p>
        )
      ) : (
        <p className="mc-line" aria-live="polite">
          {end ?? line}
        </p>
      )}

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
        {view.board.map((st, i) => (
          <button
            key={i}
            ref={(el) => {
              refs.current[i] = el
            }}
            role="gridcell"
            className={[
              'go-pt',
              st ? `is-s${st}` : '',
              view.last === i ? 'is-last' : '',
              saved.shade && !st && s.owner[i] ? `own-${s.owner[i]}` : '',
            ]
              .filter(Boolean)
              .join(' ')}
            style={{
              left: `${((i % N) + 0.5) * (100 / N)}%`,
              top: `${(Math.floor(i / N) + 0.5) * (100 / N)}%`,
            }}
            tabIndex={i === cursor ? 0 : -1}
            aria-label={`${pointName(i)}: ${st ? `${colourName(st as Who)} stone` : 'empty'}${view.last === i ? ', the last move' : ''}`}
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
      {inMatch && <MatchSend lm={lm} />}
      {mode === 'bot' && !inMatch && (
        <p className="sun-reading">
          <span className="muted">
            Against {LEVEL_NAMES[saved.level]}: won {r.won}, lost {r.lost} · you play{' '}
            {colourName(you)}, and swap each game
          </span>
        </p>
      )}
      {mode === 'bot' && !inMatch && level !== saved.level && game.moves > 0 && !end && (
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
