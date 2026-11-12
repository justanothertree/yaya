import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import {
  HALMA_KEY,
  HOLES,
  HOME,
  LEVELS,
  LOOKS,
  choose,
  goalOf,
  moves,
  newGame,
  play,
  readSaved,
  type Game,
  type Level,
  type Move,
  type Saved,
  type Side,
} from './halma'

type Mode = 'bot' | 'two'
const load = (): Saved => {
  try {
    return readSaved(localStorage.getItem(HALMA_KEY))
  } catch {
    return readSaved(null)
  }
}
const LEVEL_NAMES: Record<Level, string> = { easy: 'Easy', fair: 'Fair', hard: 'Hard' }
const LOOK_NAMES: Record<Saved['look'], string> = { wood: 'Wood', marble: 'Marble', night: 'Night' }
const SIDES: Record<Saved['look'], [string, string]> = {
  wood: ['Red', 'Blue'],
  marble: ['Gold', 'Jade'],
  night: ['Cyan', 'Magenta'],
}
/** a hole's place on the board, as fractions: the star is 13 holes across and about 15 high */
const H = Math.sqrt(3) / 2
const place = (i: number) => {
  const h = HOLES[i]
  return { x: (h.q + h.r / 2 + 6.5) / 13, y: (h.r * H + 7.43) / 14.86 }
}
const holeName = (i: number) => {
  const h = HOLES[i]
  return `row ${h.r + 9}, ${h.q + 9}`
}

export function HalmaDemo() {
  const [saved, setSaved] = useState<Saved>(load)
  const [mode, setMode] = useState<Mode>('bot')
  const [level, setLevel] = useState<Level>(saved.level)
  const [game, setGame] = useState<Game>(() => newGame(1))
  const [picked, setPicked] = useState<number | null>(null)
  const [last, setLast] = useState<Move | null>(null)
  const [cursor, setCursor] = useState(HOME[1][0])
  const [line, setLine] = useState(
    'Race your ten pegs into the far point. Step to a hole beside you, or hop over any peg — as many hops in a row as you can.',
  )
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const recorded = useRef(false)
  const firstRef = useRef<Side>(1)
  useEffect(() => {
    try {
      localStorage.setItem(HALMA_KEY, JSON.stringify(saved))
    } catch {
      /* private mode: kept for this visit */
    }
  }, [saved])

  const sides = SIDES[saved.look]
  const all = moves(game)
  const yours = !game.winner && (mode === 'two' || game.turn === 1)
  const computerTurn = mode === 'bot' && !game.winner && game.turn === 2
  const nameOf = (s: Side) => (mode === 'bot' ? (s === 1 ? 'You' : 'The computer') : sides[s - 1])
  const targets = picked === null ? [] : all.filter((m) => m.from === picked)
  const lit = new Map(targets.map((m) => [m.to, m]))
  const inGoal = (s: Side) => goalOf(s).filter((i) => game.cells[i] === s).length

  const apply = (m: Move) => {
    const by = game.turn
    const g = play(game, m)
    setGame(g)
    setLast(m)
    setPicked(null)
    if (g.winner) {
      const yourMoves = Math.ceil(g.plies / 2)
      if (mode === 'bot' && !recorded.current) {
        recorded.current = true
        setSaved((s) => {
          const t = s.record[level]
          const w = g.winner === 1
          return {
            ...s,
            record: {
              ...s.record,
              [level]: {
                won: t.won + (w ? 1 : 0),
                lost: t.lost + (w ? 0 : 1),
                fewest: w && (!t.fewest || yourMoves < t.fewest) ? yourMoves : t.fewest,
              },
            },
          }
        })
      }
      setLine(
        mode === 'bot'
          ? g.winner === 1
            ? `🏆 Home in ${yourMoves} moves — you win!`
            : 'The computer fills your old corner first. It wins.'
          : `🏆 ${sides[g.winner - 1]} win.`,
      )
      return
    }
    const hops = m.path.length - 1
    const what = hops > 1 ? `${hops} hops` : isStep(m) ? 'a step' : 'a hop'
    setLine(
      mode === 'bot'
        ? by === 1
          ? 'The computer is thinking…'
          : `The computer moves — ${what}. Your move.`
        : `${sides[g.turn - 1]} to move.`,
    )
  }

  useEffect(() => {
    if (!computerTurn) return
    const t = window.setTimeout(() => apply(choose(game, level)), 450)
    return () => window.clearTimeout(t)
    // the game is what starts the computer's move
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [computerTurn, game])

  const fresh = (m: Mode = mode, lv: Level = saved.level) => {
    recorded.current = false
    const first: Side = m === 'bot' && last && m === mode ? (firstRef.current === 1 ? 2 : 1) : 1
    firstRef.current = first
    setMode(m)
    setLevel(lv)
    setGame(newGame(first))
    setPicked(null)
    setLast(null)
    setLine(
      m === 'two'
        ? `${SIDES[saved.look][0]} moves first, from the bottom point.`
        : first === 1
          ? 'You start from the bottom point and move first.'
          : 'You start from the bottom point; the computer moves first this time…',
    )
  }

  const tap = (i: number) => {
    if (!yours) return
    if (game.cells[i] === game.turn) {
      setPicked(picked === i ? null : i)
      return
    }
    const m = lit.get(i)
    if (m) apply(m)
    else setPicked(null)
  }
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const dirs: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    }
    const d = dirs[e.key]
    if (d) {
      // the nearest hole that way, so the slanting rows can be walked with four keys
      const p0 = place(cursor)
      let best = -1
      let bd = Infinity
      HOLES.forEach((_, i) => {
        const p = place(i)
        const dx = p.x - p0.x
        const dy = p.y - p0.y
        const along = dx * d[0] + dy * d[1]
        if (along <= 0.01) return
        const dist = along + Math.abs(dx * d[1] + dy * d[0]) * 2.2
        if (dist < bd) {
          bd = dist
          best = i
        }
      })
      if (best >= 0) {
        setCursor(best)
        refs.current[best]?.focus()
      }
    } else if (e.key === 'Escape') setPicked(null)
    else return
    e.preventDefault()
    e.stopPropagation()
  }

  const trail = new Set(last ? last.path : [])
  const describe = (i: number) => {
    const p = game.cells[i]
    const bits = [
      p ? `${sides[p - 1].toLowerCase()} peg` : 'empty',
      picked === i ? 'picked' : '',
      lit.has(i) ? 'can go here' : '',
      HOME[2].includes(i) ? `${sides[0].toLowerCase()}’s goal` : '',
      HOME[1].includes(i) ? `${sides[1].toLowerCase()}’s goal` : '',
      last && last.to === i ? 'last move' : '',
    ].filter(Boolean)
    return `${holeName(i)}: ${bits.join(', ')}`
  }
  const record = saved.record[saved.level]
  return (
    <div className={`lab-keys hm-room is-${saved.look}`}>
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
                  if (!last || game.winner) fresh(mode, l)
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
          <div key={s} className={`dice-score${game.turn === s && !game.winner ? ' is-up' : ''}`}>
            <span>
              {nameOf(s)} · {sides[s - 1].toLowerCase()}
            </span>
            <strong>{inGoal(s)} / 10</strong>
            <span className="muted">home</span>
          </div>
        ))}
      </div>
      <p className="mc-line" aria-live="polite">
        {line}
      </p>

      <div
        className="hm-board"
        role="group"
        aria-label="The star. Arrow keys move between holes, Enter picks a peg and then where it goes, Escape lets go."
        onKeyDown={onKey}
      >
        {HOLES.map((_, i) => {
          const p = place(i)
          const peg = game.cells[i]
          return (
            <button
              key={i}
              ref={(el) => {
                refs.current[i] = el
              }}
              className={[
                'hm-hole',
                peg ? `is-p${peg}` : '',
                HOME[2].includes(i) ? 'is-goal1' : '',
                HOME[1].includes(i) ? 'is-goal2' : '',
                picked === i ? 'is-picked' : '',
                lit.has(i) && saved.hints ? 'is-lit' : '',
                trail.has(i) ? 'is-trail' : '',
                saved.hints &&
                yours &&
                picked === null &&
                peg === game.turn &&
                all.some((m) => m.from === i)
                  ? 'can-move'
                  : '',
              ]
                .filter(Boolean)
                .join(' ')}
              style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%` }}
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
            {record.fewest ? ` · home in ${record.fewest} moves at best` : ''}
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
              Show where pegs can go
            </button>
          </div>
        </section>
      </div>
      <p className="muted lab-hint">
        Chinese checkers for two. Move one peg a turn: a step to an empty hole beside it, or a hop
        over a peg beside it — yours or the other side’s — to the empty hole straight beyond, and on
        from there as many hops as there are. Nothing is taken. Fill the far point first; a side
        that leaves pegs in its own corner cannot stop you, since a point full of pegs with at least
        one of yours in it counts. The dots show the last move’s hops. Keys: arrows move between
        holes, Enter picks a peg and then where it goes, Escape lets go.
      </p>
    </div>
  )
}

/** a move to a hole right beside where it started */
function isStep(m: Move) {
  const a = HOLES[m.from]
  const b = HOLES[m.to]
  return Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r), Math.abs(a.s - b.s)) === 1
}
