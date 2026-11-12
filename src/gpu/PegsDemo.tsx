import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import {
  BOARDS,
  LOOKS,
  PEGS_KEY,
  jump,
  layout,
  left,
  moves,
  newGame,
  over,
  perfect,
  readSaved,
  solve,
  undo,
  type BoardKind,
  type Game,
  type Saved,
} from './pegs'
import { motionReduced as reduced } from '../ui/motion'

const load = (): Saved => {
  try {
    return readSaved(localStorage.getItem(PEGS_KEY))
  } catch {
    return readSaved(null)
  }
}
const BOARD_NAMES: Record<BoardKind, string> = { english: 'Cross (33)', triangle: 'Triangle (15)' }
const LOOK_NAMES: Record<Saved['look'], string> = { marble: 'Marbles', wood: 'Wood', glow: 'Glow' }
/** how long the solver takes over a hint before it owns up, in positions */
const HINT_BUDGET = 150_000

/** where a hole is drawn, as fractions of the board's square */
function placeOf(kind: BoardKind, r: number, c: number) {
  if (kind === 'triangle') {
    const h = Math.sqrt(3) / 2
    return { x: (c - r / 2 + 2.5) / 5, y: (r * h + 0.75) / (4 * h + 1.5) }
  }
  return { x: (c + 0.5) / 7, y: (r + 0.5) / 7 }
}
const name = (kind: BoardKind, i: number) => {
  const h = layout(kind).holes[i]
  return `row ${h.r + 1}, ${kind === 'triangle' ? 'hole' : 'column'} ${h.c + 1}`
}

export function PegsDemo() {
  const [saved, setSaved] = useState<Saved>(load)
  const [game, setGame] = useState<Game>(() => newGame(saved.board))
  const [picked, setPicked] = useState<number | null>(null)
  const [hint, setHint] = useState<[number, number, number] | null>(null)
  const [choosing, setChoosing] = useState(false)
  const [showing, setShowing] = useState(false)
  const [cursor, setCursor] = useState(() => layout(saved.board).start)
  const [line, setLine] = useState(
    'Jump a peg over its neighbour into an empty hole, and the one jumped over comes off. Finish with one peg.',
  )
  const refs = useRef<(HTMLButtonElement | null)[]>([])
  const timer = useRef<number | null>(null)
  const recorded = useRef(false)
  useEffect(() => {
    try {
      localStorage.setItem(PEGS_KEY, JSON.stringify(saved))
    } catch {
      /* private mode: kept for this visit */
    }
  }, [saved])
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current)
    },
    [],
  )

  const L = layout(game.kind)
  const all = moves(game)
  const targets = picked === null ? [] : all.filter((m) => m[0] === picked)
  const lit = new Set(targets.map((m) => m[2]))
  const done = over(game) && game.history.length > 0

  const stopShowing = () => {
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = null
    setShowing(false)
  }
  /** after any change of position: the end, if it is one, and the record */
  const settle = (g: Game) => {
    setGame(g)
    setPicked(null)
    setHint(null)
    if (!over(g)) {
      setLine(`${left(g)} pegs left.`)
      return
    }
    const n = left(g)
    const best = perfect(g)
    setLine(
      best
        ? '🏆 Perfect — one peg, in the hole that started empty.'
        : n === 1
          ? '🎉 One peg left! For a perfect game, finish in the hole that started empty.'
          : `No jumps left: ${n} pegs. Undo, or start again.`,
    )
    if (!recorded.current) {
      recorded.current = true
      setSaved((s) => ({
        ...s,
        best: { ...s.best, [g.kind]: s.best[g.kind] ? Math.min(s.best[g.kind], n) : n },
        perfects: { ...s.perfects, [g.kind]: s.perfects[g.kind] + (best ? 1 : 0) },
      }))
    }
  }

  const fresh = (kind: BoardKind = game.kind, start?: number) => {
    stopShowing()
    recorded.current = false
    const g = newGame(kind, start)
    setGame(g)
    setPicked(null)
    setHint(null)
    setChoosing(false)
    setCursor(g.start)
    setLine(
      start === undefined
        ? 'Jump a peg over its neighbour into an empty hole, and the one jumped over comes off. Finish with one peg.'
        : `The empty hole is ${name(kind, g.start)}. A perfect game ends there.`,
    )
  }

  const tap = (i: number) => {
    if (showing) return
    if (choosing) {
      fresh(game.kind, i)
      return
    }
    if (game.pegs[i]) {
      const can = all.some((m) => m[0] === i)
      setPicked(picked === i || !can ? null : i)
      if (!can) setLine(`That peg has no jump from ${name(game.kind, i)}.`)
      return
    }
    const m = targets.find((x) => x[2] === i)
    if (m) settle(jump(game, m))
    else setPicked(null)
  }

  const askHint = () => {
    if (showing || done) return
    const home = solve(game, true, HINT_BUDGET)
    if (typeof home === 'object') {
      const m = home.moves[0]
      setHint(m)
      setPicked(null)
      setLine(`Try ${name(game.kind, m[0])} over ${name(game.kind, m[1])}.`)
      return
    }
    // no way home, or none found in time: one peg anywhere is still worth pointing at
    const any = solve(game, false, HINT_BUDGET)
    if (typeof any === 'object') {
      setHint(any.moves[0])
      setLine(
        `${home === 'none' ? 'A perfect finish is out of reach from here' : 'I can’t see a way home quickly'}, but one peg is still possible: try ${name(game.kind, any.moves[0][0])}.`,
      )
    } else if (any === 'none' && home === 'none')
      setLine('There is no way to one peg from here. Undo a jump or two and look again.')
    else setLine('I can’t see a way through quickly from here — it may still be there.')
  }

  /** the solver plays the rest out, a jump at a time */
  const showMe = () => {
    if (showing) {
      stopShowing()
      return
    }
    const s = solve(game, true, HINT_BUDGET)
    const any = typeof s === 'object' ? s : solve(game, false, HINT_BUDGET)
    if (typeof any !== 'object') {
      setLine(
        any === 'none'
          ? 'There is no way to one peg from here — undo, or start again, and I’ll show you.'
          : 'I can’t find a way through quickly from here. From a fresh board I can.',
      )
      return
    }
    setShowing(true)
    setPicked(null)
    setHint(null)
    recorded.current = true // a game the computer finished is not yours to keep
    let g = game
    const steps = any.moves.slice()
    const next = () => {
      const m = steps.shift()
      if (!m) {
        timer.current = null
        setShowing(false)
        setLine(
          perfect(g)
            ? 'There — one peg, home. Start again and it’s your turn.'
            : 'There — one peg. Start again and it’s your turn.',
        )
        return
      }
      g = jump(g, m)
      setGame(g)
      setLine(`${left(g)} pegs left…`)
      timer.current = window.setTimeout(next, reduced() ? 700 : 450)
    }
    next()
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
      // the nearest hole that way, so the triangle's slanting rows can be walked too
      const here = L.holes[cursor]
      const p0 = placeOf(game.kind, here.r, here.c)
      let best = -1
      let bd = Infinity
      L.holes.forEach((h, i) => {
        const p = placeOf(game.kind, h.r, h.c)
        const dx = p.x - p0.x
        const dy = p.y - p0.y
        const along = dx * d[0] + dy * d[1]
        if (along <= 0.01) return
        const dist = along + Math.abs(dx * d[1] + dy * d[0]) * 2
        if (dist < bd) {
          bd = dist
          best = i
        }
      })
      if (best >= 0) {
        setCursor(best)
        refs.current[best]?.focus()
      }
    } else if (e.key === 'u' || e.key === 'U') {
      if (game.history.length && !showing) {
        recorded.current = false
        settle(undo(game))
      }
    } else if (e.key === 'h' || e.key === 'H') askHint()
    else if (e.key === 'Escape') setPicked(null)
    else return
    e.preventDefault()
    e.stopPropagation()
  }

  const describe = (i: number) => {
    const bits = [
      game.pegs[i] ? 'peg' : 'empty',
      picked === i ? 'picked' : '',
      lit.has(i) ? 'can land here' : '',
      hint && hint[0] === i ? 'hint: jump from here' : '',
      hint && hint[2] === i ? 'hint: land here' : '',
      i === game.start ? 'started empty' : '',
    ].filter(Boolean)
    return `${name(game.kind, i)}: ${bits.join(', ')}`
  }
  const size = game.kind === 'triangle' ? 15 : 11.5
  return (
    <div className={`lab-keys ps-room is-${saved.look}`}>
      <div className="lab-controls">
        <div className="lab-group" role="group" aria-label="Board">
          {BOARDS.map((b) => (
            <button
              key={b}
              className="btn btn-ghost"
              aria-pressed={game.kind === b}
              onClick={() => {
                setSaved((s) => ({ ...s, board: b }))
                fresh(b)
              }}
            >
              {BOARD_NAMES[b]}
            </button>
          ))}
        </div>
        <button className="btn btn-ghost" onClick={() => fresh(game.kind, game.start)}>
          ↻ Start again
        </button>
        <button
          className="btn btn-ghost"
          aria-pressed={choosing}
          disabled={showing}
          onClick={() => {
            setChoosing((c) => !c)
            setLine(
              choosing
                ? `${left(game)} pegs left.`
                : 'Tap the hole you want to start empty — the board resets with it.',
            )
          }}
        >
          ◌ Choose the empty hole
        </button>
      </div>
      <div className="dice-scores">
        <div className="dice-score is-up">
          <span>Pegs left</span>
          <strong>{left(game)}</strong>
          <span className="muted">
            {game.history.length} jump{game.history.length === 1 ? '' : 's'}
          </span>
        </div>
        <div className="dice-score">
          <span>Your best</span>
          <strong>{saved.best[game.kind] || '—'}</strong>
          <span className="muted">
            {saved.perfects[game.kind] ? `${saved.perfects[game.kind]} perfect` : 'no perfect yet'}
          </span>
        </div>
      </div>
      <p className="mc-line" aria-live="polite">
        {line}
      </p>

      <div
        className={`ps-board is-${game.kind}${choosing ? ' is-choosing' : ''}`}
        role="group"
        aria-label="The board. Arrow keys move between holes, Enter picks a peg and then the hole to land in, U undoes, H asks for a hint."
        onKeyDown={onKey}
      >
        {L.holes.map((h, i) => {
          const p = placeOf(game.kind, h.r, h.c)
          return (
            <button
              key={i}
              ref={(el) => {
                refs.current[i] = el
              }}
              className={[
                'ps-hole',
                game.pegs[i] ? 'has-peg' : '',
                picked === i ? 'is-picked' : '',
                lit.has(i) ? 'is-lit' : '',
                hint && (hint[0] === i || hint[2] === i) ? 'is-hint' : '',
                i === game.start ? 'is-home' : '',
              ]
                .filter(Boolean)
                .join(' ')}
              style={{
                left: `${p.x * 100}%`,
                top: `${p.y * 100}%`,
                width: `${size}%`,
                height: `${size}%`,
              }}
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
      <div className="lab-controls">
        <button
          className="btn btn-ghost"
          disabled={!game.history.length || showing}
          onClick={() => {
            recorded.current = false
            settle(undo(game))
          }}
        >
          ↶ Undo
        </button>
        <button className="btn btn-ghost" disabled={showing || done} onClick={askHint}>
          💡 Hint
        </button>
        <button className="btn btn-ghost" disabled={done && !showing} onClick={showMe}>
          {showing ? '⏹ Stop' : '▶ Show me'}
        </button>
      </div>

      <div className="fw-panel">
        <section aria-label="Look">
          <h3 className="fw-h">Pegs</h3>
          <div className="lab-controls" role="group" aria-label="Which pegs">
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
        Pick a peg, then the empty hole two along to jump into — straight across or down on the
        cross, and along the slants too on the triangle. The peg jumped over comes off. Finish with
        one peg; finish with it in the hole that started empty for a perfect game. Undo as often as
        you like. A hint comes from a solver that looks for a way home from where you are, and says
        so when it can’t tell quickly; Show me lets it play the rest out. Keys: arrows move between
        holes, Enter picks and jumps, U undoes, H asks for a hint.
      </p>
    </div>
  )
}
