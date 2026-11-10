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

type Mode = 'bot' | 'two'
const load = (): Saved => {
  try {
    return readSaved(localStorage.getItem(MORRIS_KEY))
  } catch {
    return readSaved(null)
  }
}
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
  const [saved, setSaved] = useState<Saved>(load)
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
  useEffect(() => {
    try {
      localStorage.setItem(MORRIS_KEY, JSON.stringify(saved))
    } catch {
      /* private mode: kept for this visit */
    }
  }, [saved])

  const all = moves(game)
  const yours = !game.winner && (mode === 'two' || game.turn === you)
  const computerTurn = mode === 'bot' && !game.winner && game.turn !== you
  const nameOf = (w: Who) =>
    mode === 'bot' ? (w === you ? 'You' : 'The computer') : w === 1 ? 'Light' : 'Dark'
  const placing = game.hand[game.turn] > 0
  const flying = !placing && count(game, game.turn) === 3

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

  const tap = (p: number) => {
    if (!yours) return
    if (pending) {
      const m = all.find((x) => x.from === pending.from && x.to === pending.to && x.take === p)
      if (m) apply(m)
      return
    }
    const from = placing ? -1 : picked
    if (!placing && game.board[p] === game.turn) {
      setPicked(p === picked ? null : p)
      return
    }
    if (from === null) return
    const options = all.filter((x) => x.from === from && x.to === p)
    if (!options.length) return
    if (options[0].take < 0) apply(options[0])
    else {
      setPending({ from, to: p, take: -1 })
      setLine('A mill! Pick one of their men to take.')
    }
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

  const record = saved.record[saved.level]
  return (
    <div className={`lab-keys mo-room is-${saved.board} pieces-${saved.pieces}`}>
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
                  if (!game.board.some((x) => x) || game.winner) fresh(mode, l)
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
        {([1, 2] as Who[]).map((w) => (
          <div key={w} className={`dice-score${game.turn === w && !game.winner ? ' is-up' : ''}`}>
            <span>
              {nameOf(w)} · {SIDE[w]}
            </span>
            <strong>{game.board.filter((x) => x === w).length}</strong>
            <span className="muted">
              {game.hand[w] ? `on the board, ${game.hand[w]} to place` : 'on the board'}
            </span>
          </div>
        ))}
      </div>
      <p className="mc-line" aria-live="polite">
        {line}
        {yours && !pending && !game.winner && (
          <span className="muted">
            {' '}
            ·{' '}
            {placing
              ? 'placing'
              : flying
                ? 'flying'
                : picked === null
                  ? 'pick a man to move'
                  : 'now where it goes'}
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
          {last &&
            MILLS.filter(
              (m) =>
                m.includes(last.to) &&
                m.every((q) => game.board[q] === game.board[last.to] && game.board[q]),
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
          const man = game.board[p]
          const isLast = last && (last.to === p || last.take === p || last.from === p)
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
