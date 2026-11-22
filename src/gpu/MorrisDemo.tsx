import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import {
  BOARDS,
  LEVELS,
  MILLS,
  MORRIS_KEY,
  NEIGHBOURS,
  PIECES,
  choose,
  count,
  moves,
  newGame,
  other,
  play,
  readSaved,
  type Game,
  type Level,
  type Move,
  type Saved,
  type Who,
} from './morris'
import { useKept } from './kept'
import { morrisRules, type MorrisGame } from './morrisRoom'
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
const BOARD_NAMES: Record<Saved['board'], string> = {
  wood: 'Wood',
  slate: 'Slate',
  garden: 'Garden',
}
const PIECE_NAMES: Record<Saved['pieces'], string> = {
  stones: 'Stones',
  coins: 'Coins',
  gems: 'Gems',
}
const SIDE = ['', 'light', 'dark']

/** where each point sits, as fractions of the board: a ring's eight points clockwise from top-left */
const SPOT = [
  [0, 0],
  [0.5, 0],
  [1, 0],
  [1, 0.5],
  [1, 1],
  [0.5, 1],
  [0, 1],
  [0, 0.5],
]
const POINT = Array.from({ length: 24 }, (_, p) => {
  const inset = Math.floor(p / 8) / 6
  const [x, y] = SPOT[p % 8]
  return { x: inset + x * (1 - 2 * inset), y: inset + y * (1 - 2 * inset) }
})
const NAMES = [
  'top left',
  'top middle',
  'top right',
  'right middle',
  'bottom right',
  'bottom middle',
  'bottom left',
  'left middle',
]
const RINGS = ['outer', 'middle', 'inner']
const pointName = (p: number) => `${RINGS[Math.floor(p / 8)]} ${NAMES[p % 8]}`

/**
 * Where an arrow key goes from a point: along a line to the next point when there is one that way,
 * and otherwise to the nearest point in that direction, so every point is reachable from every other.
 */
function stepFrom(p: number, dx: number, dy: number): number {
  let best = p
  let bd = Infinity
  for (let q = 0; q < 24; q++) {
    const ax = POINT[q].x - POINT[p].x
    const ay = POINT[q].y - POINT[p].y
    const along = ax * dx + ay * dy
    const across = Math.abs(ax * dy - ay * dx)
    if (along <= 0.001 || across > along) continue
    // a point straight along a line from here always beats one off to the side
    const d = (NEIGHBOURS[p].includes(q) && across < 0.001 ? 0 : 10) + along + across * 2
    if (d < bd) {
      bd = d
      best = q
    }
  }
  return best
}

export function MorrisDemo() {
  const [saved, setSaved] = useKept(MORRIS_KEY, readSaved)
  const [mode, setMode] = useState<Mode>('bot')
  const [game, setGame] = useState<Game>(newGame)
  const [you, setYou] = useState<Who>(1)
  const [level, setLevel] = useState<Level>(saved.level)
  const [picked, setPicked] = useState<number | null>(null)
  /** a move waiting for its taking: the mill is made, now choose which of theirs goes */
  const [pending, setPending] = useState<Move | null>(null)
  const [last, setLast] = useState<Move | null>(null)
  const [line, setLine] = useState('You play light and go first. Put a man on any point.')
  const [cursor, setCursor] = useState(0)
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const recorded = useRef(false)

  /* ── a match by turns, when the address names one (src/lab/matches/useLabMatch.ts). It takes
     the board over whatever else was showing; leaving it puts the toy back as it was. A move
     shows at once and waits for Send; the server plays it and the board comes back. */
  const lm = useLabMatch('morris')
  const inMatch = !!lm.id
  const signedIn = useSignedIn()
  const matchGame = inMatch ? (lm.shown as MorrisGame | null) : null

  /* ── the call's room: the game travels as its moves, replayed by morris.ts itself */
  const lab = useLabRoom('morris', morrisRules)
  const words = tableSeats(lab, morrisRules)
  const room = mode === 'call' && !inMatch ? lab.room : null
  /** the side I move for: the first in seat 0 and together, the second in seat 1 */
  const mySide: Who = room && room.mode === 'versus' && words.mySeat === 1 ? 2 : 1
  /** the board on screen: the call's in a call, else this one */
  const view = matchGame ? matchGame.g : room ? room.game.g : game
  const viewLast = matchGame ? matchGame.last : room ? room.game.last : last

  const all = moves(view)
  const yours = inMatch
    ? lm.canPlay
    : room
      ? lab.live && myTurn(morrisRules, room)
      : mode !== 'call' && !game.winner && (mode === 'two' || game.turn === you)
  const computerTurn = mode === 'bot' && !inMatch && !game.winner && game.turn !== you
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
        : mode === 'bot'
          ? w === you
            ? 'You'
            : 'The computer'
          : w === 1
            ? 'Light'
            : 'Dark'
  const placing = view.hand[view.turn] > 0
  const flying = !placing && count(view, view.turn) === 3

  const apply = (m: Move) => {
    const by = game.turn
    const g = play(game, m)
    setGame(g)
    setLast(m)
    setPicked(null)
    setPending(null)
    if (g.winner) {
      if (mode === 'bot' && !recorded.current) {
        recorded.current = true
        const r = g.winner === 3 ? 'drawn' : g.winner === you ? 'won' : 'lost'
        setSaved((s) => ({
          ...s,
          record: { ...s.record, [level]: { ...s.record[level], [r]: s.record[level][r] + 1 } },
        }))
      }
      setLine(
        g.winner === 3
          ? `A draw — no man taken in fifty moves.`
          : `${g.winner === you || mode === 'two' ? '🏆 ' : ''}${nameOf(g.winner as Who)} ${nameOf(g.winner as Who) === 'You' ? 'win' : 'wins'} — ${count(g, other(g.winner as Who)) < 3 ? 'down to two men' : 'no move left'}.`,
      )
      return
    }
    const took =
      m.take >= 0
        ? `${nameOf(by)} ${nameOf(by) === 'You' ? 'make' : 'makes'} a mill and ${nameOf(by) === 'You' ? 'take' : 'takes'} a man. `
        : ''
    setLine(
      `${took}${mode === 'bot' ? (g.turn === you ? 'Your move.' : 'The computer is thinking…') : `${nameOf(g.turn)} to move.`}${g.hand[g.turn] > 0 ? ` (${g.hand[g.turn]} to place)` : count(g, g.turn) === 3 ? ' Down to three: fly anywhere.' : ''}`,
    )
  }

  /** a whole move, made: here, or in the call, where the host decides and the board comes back */
  const make = (m: Move) => {
    if (inMatch) {
      setPicked(null)
      setPending(null)
      return void lm.play(m)
    }
    if (!room) return apply(m)
    setPicked(null)
    setPending(null)
    lab.act({ t: 'move', move: m })
  }
  const tap = (p: number) => {
    if (!yours) return
    if (pending) {
      const m = all.find((x) => x.from === pending.from && x.to === pending.to && x.take === p)
      if (m) make(m)
      return
    }
    const from = placing ? -1 : picked
    if (!placing && view.board[p] === view.turn) {
      setPicked(p === picked ? null : p)
      return
    }
    if (from === null) return
    const options = all.filter((x) => x.from === from && x.to === p)
    if (!options.length) return
    if (options[0].take < 0) make(options[0])
    else {
      setPending({ from, to: p, take: -1 })
      setLine('A mill! Pick one of their men to take.')
    }
  }
  /**
   * ⚠️ A SEATED PLAYER LEFT ALONE carries on against the computer from the board on screen,
   * keeping their colour — or starts a new game if that one was over.
   */
  const carryOn = () => {
    const r = room ?? lab.room
    if (!r || r.game.g.winner) return fresh('bot')
    recorded.current = false
    setMode('bot')
    setLevel(saved.level)
    setYou(mySide)
    setGame(r.game.g)
    setLast(r.game.last)
    setPicked(null)
    setPending(null)
    setLine(r.game.g.turn === mySide ? 'Your move.' : 'The computer is thinking…')
  }

  useEffect(() => {
    if (!computerTurn) return
    const t = window.setTimeout(() => apply(choose(game, level)), 550)
    return () => window.clearTimeout(t)
    // the game is what starts the computer's move
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [computerTurn, game])

  const fresh = (m: Mode = mode, lv: Level = saved.level) => {
    const nextYou: Who = game.board.some((x) => x) && m === mode ? (you === 1 ? 2 : 1) : 1
    recorded.current = false
    setMode(m)
    setLevel(lv)
    setYou(nextYou)
    setGame(newGame())
    setPicked(null)
    setPending(null)
    setLast(null)
    setLine(
      m === 'two'
        ? 'Light first — put a man on any point.'
        : nextYou === 1
          ? 'You play light and go first.'
          : 'You play dark; the computer goes first…',
    )
  }

  // which points light up: where a picked man may go, or which men a mill may take (not while
  // placing, when every empty point is a place to go and lighting them all says nothing)
  const lit = new Set<number>()
  if (saved.hints && yours) {
    if (!pending && picked !== null)
      all.filter((x) => x.from === picked).forEach((x) => lit.add(x.to))
  }
  if (pending)
    all
      .filter((x) => x.from === pending.from && x.to === pending.to)
      .forEach((x) => lit.add(x.take))

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const d: Record<string, [number, number]> = {
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
    }
    if (!d[e.key]) return
    e.preventDefault()
    e.stopPropagation()
    const next = stepFrom(cursor, ...d[e.key])
    setCursor(next)
    refs.current[next]?.focus()
  }

  /* leaving a match, the toy starts afresh rather than playing on from somebody else's board */
  const wasInMatch = useRef(inMatch)
  useEffect(() => {
    if (wasInMatch.current && !inMatch) fresh('bot')
    wasInMatch.current = inMatch
  })

  const record = saved.record[saved.level]
  /** what the line says: the toy's own words, or in a call only a mill's question */
  const lead =
    mode === 'call' || inMatch ? (pending ? 'A mill! Pick one of their men to take.' : '') : line
  /** where you are in your move, when it is yours */
  const stage =
    yours && !pending && !view.winner
      ? placing
        ? 'placing'
        : flying
          ? 'flying'
          : picked === null
            ? 'pick a man to move'
            : 'now where it goes'
      : null
  return (
    <div className={`lab-keys mo-room is-${saved.board} pieces-${saved.pieces}`}>
      {inMatch && <MatchBar lm={lm} sides={['light', 'dark']} />}
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
                  setPending(null)
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
                    if (!game.board.some((x) => x) || game.winner) fresh(mode, l)
                  }}
                >
                  {LEVEL_NAMES[l]}
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
            <MatchChallenge demo="morris" settings={{}} levelNames={LEVEL_NAMES} />
          )}
        </div>
      )}
      {mode === 'call' && !inMatch && (
        <CallTable
          table={lab}
          rules={morrisRules}
          sides={['Light', 'Dark']}
          levelNames={LEVEL_NAMES}
          score={(d) =>
            d.g.winner === 1 || d.g.winner === 2
              ? count(d.g, d.g.winner === 1 ? 2 : 1) < 3
                ? ' — down to two men'
                : ' — no move left'
              : null
          }
          onCarryOn={carryOn}
        />
      )}

      <div className="dice-scores">
        {([1, 2] as Who[]).map((w) => (
          <div key={w} className={`dice-score${view.turn === w && !view.winner ? ' is-up' : ''}`}>
            <span>
              {nameOf(w)} · {SIDE[w]}
            </span>
            <strong>{view.board.filter((x) => x === w).length}</strong>
            <span className="muted">
              {view.hand[w] ? `on the board, ${view.hand[w]} to place` : 'on the board'}
            </span>
          </div>
        ))}
      </div>
      <p className="mc-line" aria-live="polite">
        {lead}
        {stage && (
          <span className="muted">
            {/* in a call the table says whose turn it is, so this may be all the line holds */}
            {lead ? ` · ${stage}` : stage[0].toUpperCase() + stage.slice(1)}
          </span>
        )}
      </p>

      <div
        className="mo-board"
        role="group"
        aria-label="The board. Arrow keys move between points, Enter acts."
        onKeyDown={onKey}
      >
        <svg viewBox="-0.06 -0.06 1.12 1.12" aria-hidden className="mo-lines">
          {[0, 1, 2].map((s) => {
            const a = s / 6
            const b = 1 - a
            return <rect key={s} x={a} y={a} width={b - a} height={b - a} />
          })}
          {[1, 3, 5, 7].map((k) => (
            <line
              key={k}
              x1={POINT[k].x}
              y1={POINT[k].y}
              x2={POINT[16 + k].x}
              y2={POINT[16 + k].y}
            />
          ))}
          {viewLast &&
            MILLS.filter(
              (m) =>
                m.includes(viewLast.to) &&
                m.every((q) => view.board[q] === view.board[viewLast.to] && view.board[q]),
            ).map((m, i) => (
              <line
                key={`m${i}`}
                className="mo-mill"
                x1={POINT[m[0]].x}
                y1={POINT[m[0]].y}
                x2={POINT[m[2]].x}
                y2={POINT[m[2]].y}
              />
            ))}
        </svg>
        {POINT.map((pt, p) => {
          const man = view.board[p]
          const isLast =
            viewLast && (viewLast.to === p || viewLast.take === p || viewLast.from === p)
          return (
            <button
              key={p}
              ref={(el) => {
                refs.current[p] = el
              }}
              className={`mo-point${man ? ` is-p${man}` : ''}${picked === p ? ' is-picked' : ''}${lit.has(p) ? ' is-lit' : ''}${isLast ? ' is-last' : ''}`}
              style={{
                left: `${((pt.x + 0.06) / 1.12) * 100}%`,
                top: `${((pt.y + 0.06) / 1.12) * 100}%`,
              }}
              tabIndex={p === cursor ? 0 : -1}
              aria-label={`${pointName(p)}: ${man ? `${SIDE[man]} man` : 'empty'}${lit.has(p) ? (pending ? ', can be taken' : ', you can go here') : ''}${picked === p ? ', picked' : ''}`}
              onFocus={() => setCursor(p)}
              onClick={() => {
                setCursor(p)
                tap(p)
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
            {record.drawn ? `, drawn ${record.drawn}` : ''}
          </span>
        </p>
      )}

      <div className="fw-panel">
        <section aria-label="Looks">
          <h3 className="fw-h">Board and men</h3>
          <div className="lab-controls" role="group" aria-label="Board">
            {BOARDS.map((b) => (
              <button
                key={b}
                className="btn btn-ghost"
                aria-pressed={saved.board === b}
                onClick={() => setSaved((s) => ({ ...s, board: b }))}
              >
                {BOARD_NAMES[b]}
              </button>
            ))}
          </div>
          <div className="lab-controls" role="group" aria-label="Men">
            {PIECES.map((p) => (
              <button
                key={p}
                className="btn btn-ghost"
                aria-pressed={saved.pieces === p}
                onClick={() => setSaved((s) => ({ ...s, pieces: p }))}
              >
                {PIECE_NAMES[p]}
              </button>
            ))}
            <button
              className="btn btn-ghost"
              aria-pressed={saved.hints}
              onClick={() => setSaved((s) => ({ ...s, hints: !s.hints }))}
            >
              Show where a man can go
            </button>
          </div>
        </section>
      </div>
      <p className="muted lab-hint">
        Each side has nine men. First take turns putting them on empty points; then take turns
        moving one along a line to the next point. Three of yours in a row along a line is a mill,
        and a mill takes one of their men — any not in a mill of their own, unless every one of
        theirs is. Down to three men, you may fly to any empty point. Fewer than three, or nowhere
        to move, and you have lost; fifty moves without a man taken is a draw. Easy looks one move
        ahead, Fair two, Hard four. Who goes first swaps each game. Keys: arrows move between
        points, Enter places, picks or moves.
      </p>
    </div>
  )
}
