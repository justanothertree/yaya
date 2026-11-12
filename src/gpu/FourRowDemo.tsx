import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { CanvasStage } from './CanvasStage'
import {
  DISC_SETS,
  FOUR_KEY,
  FRAMES,
  LEVELS,
  SIZES,
  choose,
  drop,
  full,
  lineAt,
  newGrid,
  other,
  readSaved,
  recordGame,
  type Grid,
  type Level,
  type Saved,
  type Size,
  type Who,
} from './fourrow'
import { motionReduced as reduced } from '../ui/motion'

type Mode = 'bot' | 'two'
const load = (): Saved => {
  try {
    return readSaved(localStorage.getItem(FOUR_KEY))
  } catch {
    return readSaved(null)
  }
}

const LEVEL_NAMES: Record<Level, string> = { easy: 'Easy', fair: 'Fair', hard: 'Hard' }
const SIZE_NAMES: Record<Size, string> = {
  small: 'Small 6×5',
  classic: 'Classic 7×6',
  wide: 'Wide 9×7',
}
const DISC_NAMES: Record<Saved['discs'], string> = {
  classic: 'Classic',
  sunset: 'Sunset',
  ocean: 'Ocean',
  candy: 'Candy',
}
const FRAME_NAMES: Record<Saved['frame'], string> = { blue: 'Blue', wood: 'Wood', night: 'Night' }
const INK: Record<Saved['discs'], [string, string]> = {
  classic: ['#e63946', '#f4c430'],
  sunset: ['#c2185b', '#ff9e40'],
  ocean: ['#0b5394', '#38d9a9'],
  candy: ['#ff5d8f', '#7b6cff'],
}
const FRAME: Record<Saved['frame'], { body: string; hole: string; bg: string }> = {
  blue: { body: '#1f4fbf', hole: '#f3f6fb', bg: '#e6edf9' },
  wood: { body: '#9c6a3c', hole: '#f6efe3', bg: '#efe6d6' },
  night: { body: '#232845', hole: '#0b0e1c', bg: '#0b0e1c' },
}

type View = { s: number; ox: number; oy: number }
type Falling = { col: number; row: number; who: Who; at: number }

function draw(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  g: Grid,
  saved: Saved,
  hover: number | null,
  turn: Who | null,
  falling: Falling | null,
  line: number[] | null,
  now: number,
): View {
  const s = Math.min(w / (g.cols + 0.6), h / (g.rows + 1.6))
  const ox = (w - g.cols * s) / 2
  const oy = (h - g.rows * s) / 2 + s * 0.45
  const fr = FRAME[saved.frame]
  const ink = INK[saved.discs]
  ctx.fillStyle = fr.bg
  ctx.fillRect(0, 0, w, h)
  const X = (c: number) => ox + c * s + s / 2
  const Y = (r: number) => oy + (g.rows - 1 - r) * s + s / 2
  const r = s * 0.4
  // the disc waiting above the column you are pointing at
  if (hover !== null && turn && !falling && g.heights[hover] < g.rows) {
    ctx.fillStyle = ink[turn - 1]
    ctx.globalAlpha = 0.75
    ctx.beginPath()
    ctx.arc(X(hover), oy - s * 0.55, r * 0.9, 0, Math.PI * 2)
    ctx.fill()
    ctx.globalAlpha = 1
  }
  // discs behind the frame, then the frame with its holes cut out over them
  const disc = (x: number, y: number, colour: string) => {
    ctx.fillStyle = colour
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = 'rgba(255,255,255,0.18)'
    ctx.beginPath()
    ctx.arc(x - r * 0.25, y - r * 0.25, r * 0.45, 0, Math.PI * 2)
    ctx.fill()
  }
  for (let i = 0; i < g.cells.length; i++) {
    const c = g.cells[i]
    if (!c) continue
    const col = i % g.cols
    const row = Math.floor(i / g.cols)
    if (falling && falling.col === col && falling.row === row) continue
    disc(X(col), Y(row), ink[c - 1])
  }
  if (falling) {
    const t = Math.min(1, (now - falling.at) / 380)
    const y0 = oy - s * 0.55
    const y1 = Y(falling.row)
    disc(X(falling.col), y0 + (y1 - y0) * t * t, ink[falling.who - 1])
  }
  ctx.save()
  ctx.beginPath()
  ctx.roundRect(ox - s * 0.15, oy - s * 0.1, g.cols * s + s * 0.3, g.rows * s + s * 0.25, s * 0.25)
  for (let c = 0; c < g.cols; c++)
    for (let rr = 0; rr < g.rows; rr++) {
      ctx.moveTo(X(c) + r * 1.04, Y(rr))
      ctx.arc(X(c), Y(rr), r * 1.04, 0, Math.PI * 2, true)
    }
  ctx.fillStyle = fr.body
  ctx.fill('evenodd')
  ctx.restore()
  // empty holes show the background through them
  ctx.fillStyle = fr.hole
  ctx.globalAlpha = 0.35
  for (let i = 0; i < g.cells.length; i++)
    if (!g.cells[i]) {
      ctx.beginPath()
      ctx.arc(X(i % g.cols), Y(Math.floor(i / g.cols)), r, 0, Math.PI * 2)
      ctx.fill()
    }
  ctx.globalAlpha = 1
  if (hover !== null && turn && !falling) {
    ctx.strokeStyle = '#ffd34d'
    ctx.lineWidth = Math.max(2, s * 0.05)
    ctx.strokeRect(ox + hover * s + 2, oy - s * 0.05, s - 4, g.rows * s + s * 0.1)
  }
  if (line && !falling) {
    ctx.strokeStyle = '#ffffff'
    ctx.lineWidth = Math.max(3, s * 0.1)
    for (const i of line) {
      ctx.beginPath()
      ctx.arc(X(i % g.cols), Y(Math.floor(i / g.cols)), r * 0.55, 0, Math.PI * 2)
      ctx.stroke()
    }
  }
  return { s, ox, oy }
}

export function FourRowDemo() {
  const [saved, setSaved] = useState<Saved>(load)
  const [mode, setMode] = useState<Mode>('bot')
  const game = useRef({
    g: newGrid(saved.size, saved.need),
    turn: 1 as Who | null,
    you: 1 as Who,
    level: saved.level,
    moves: 0,
    yourMoves: 0,
    line: null as number[] | null,
    falling: null as Falling | null,
  })
  const [, setTick] = useState(0)
  const bump = () => setTick((t) => t + 1)
  const [line, setLine] = useState('Your turn — drop a disc in any column.')
  const hover = useRef<number | null>(null)
  const view = useRef<View | null>(null)
  const timer = useRef(0)
  const savedRef = useRef(saved)
  savedRef.current = saved
  useEffect(() => () => window.clearTimeout(timer.current), [])
  useEffect(() => {
    try {
      localStorage.setItem(FOUR_KEY, JSON.stringify(saved))
    } catch {
      /* private mode: kept for this visit */
    }
  }, [saved])

  const g = game.current
  const nameOf = (w: Who) =>
    mode === 'bot' ? (w === g.you ? 'You' : 'The computer') : w === 1 ? 'Player 1' : 'Player 2'
  const computerTurn = mode === 'bot' && g.turn !== null && g.turn !== g.you && !g.falling

  const dropIn = (col: number) => {
    const gm = game.current
    const who = gm.turn
    if (!who || gm.falling || gm.g.heights[col] >= gm.g.rows) return
    const row = gm.g.heights[col]
    gm.g = drop(gm.g, col, who)
    gm.moves++
    if (who === gm.you) gm.yourMoves++
    const won = lineAt(gm.g, col)
    const settle = () => {
      gm.falling = null
      if (won) {
        gm.line = won
        gm.turn = null
        if (mode === 'bot') {
          const result = who === gm.you ? 'won' : 'lost'
          const lv = gm.level
          const moves = gm.yourMoves
          setSaved((s) => ({
            ...s,
            record: { ...s.record, [lv]: recordGame(s.record[lv], result, moves) },
          }))
          setLine(
            result === 'won'
              ? `🏆 Four in a row — you win in ${moves} moves!`
              : 'The computer made its line.',
          )
        } else setLine(`🏆 ${who === 1 ? 'Player 1' : 'Player 2'} wins!`)
      } else if (full(gm.g)) {
        gm.turn = null
        if (mode === 'bot') {
          const lv = gm.level
          setSaved((s) => ({
            ...s,
            record: { ...s.record, [lv]: recordGame(s.record[lv], 'drawn', 0) },
          }))
        }
        setLine('The grid is full — a draw.')
      } else {
        gm.turn = other(who)
        setLine(
          mode === 'bot'
            ? gm.turn === gm.you
              ? 'Your turn.'
              : 'The computer is thinking…'
            : `${gm.turn === 1 ? 'Player 1' : 'Player 2'}’s turn.`,
        )
      }
      bump()
    }
    if (reduced()) settle()
    else {
      gm.falling = { col, row, who, at: performance.now() }
      bump()
      timer.current = window.setTimeout(settle, 400)
    }
  }

  useEffect(() => {
    if (!computerTurn) return
    const t = window.setTimeout(() => {
      const gm = game.current
      if (gm.turn && gm.turn !== gm.you) dropIn(choose(gm.g, gm.turn, gm.level))
    }, 500)
    return () => window.clearTimeout(t)
  })

  const fresh = (m: Mode = mode, s: Saved = saved) => {
    window.clearTimeout(timer.current)
    // whoever went second last time goes first this time
    const you: Who = g.moves && m === mode ? other(g.you) : 1
    game.current = {
      g: newGrid(s.size, s.need),
      turn: 1,
      you,
      level: s.level,
      moves: 0,
      yourMoves: 0,
      line: null,
      falling: null,
    }
    hover.current = null
    setMode(m)
    setLine(
      m === 'two'
        ? 'Player 1 first.'
        : you === 1
          ? 'Your turn — drop a disc in any column.'
          : 'The computer goes first this time…',
    )
    bump()
  }
  const change = (p: Partial<Saved>) => {
    const s = { ...saved, ...p }
    if (s.size === 'small' && s.need === 5) s.need = 4
    setSaved(s)
    if (g.moves === 0 || g.turn === null) fresh(mode, s)
  }
  const yours = () => {
    const gm = game.current
    return gm.turn !== null && !gm.falling && (mode === 'two' || gm.turn === gm.you)
  }
  const colAt = (e: PointerEvent<HTMLCanvasElement>) => {
    const v = view.current
    if (!v) return null
    const c = e.currentTarget
    const rect = c.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * c.width
    const col = Math.floor((x - v.ox) / v.s)
    return col >= 0 && col < game.current.g.cols ? col : null
  }
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const cols = game.current.g.cols
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault()
      e.stopPropagation()
      const cur = hover.current ?? Math.floor(cols / 2)
      hover.current =
        hover.current === null
          ? cur
          : Math.max(0, Math.min(cols - 1, cur + (e.key === 'ArrowLeft' ? -1 : 1)))
      bump()
    } else if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      e.stopPropagation()
      if (hover.current !== null && yours()) dropIn(hover.current)
    } else {
      const n = Number(e.key)
      if (Number.isInteger(n) && n >= 1 && n <= cols && yours()) {
        e.preventDefault()
        hover.current = n - 1
        dropIn(n - 1)
      }
    }
  }

  const record = saved.record[saved.level]
  const ink = INK[saved.discs]
  const pending =
    g.moves > 0 &&
    g.turn !== null &&
    (g.g.cols !== SIZES[saved.size][0] ||
      g.g.need !== saved.need ||
      (mode === 'bot' && g.level !== saved.level))

  return (
    <div className="lab-keys f4-room">
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
                onClick={() => change({ level: l })}
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
          <div
            key={w}
            className={`dice-score${g.turn === w ? ' is-up' : ''}`}
            style={{ borderLeft: `6px solid ${ink[w - 1]}` }}
          >
            <span>{nameOf(w)}</span>
            <strong>{w === 1 ? 'First' : 'Second'}</strong>
          </div>
        ))}
      </div>

      <div
        className="f4-wrap"
        tabIndex={0}
        role="group"
        aria-label={`The grid. Left and right choose a column, Down or Enter drops; or press 1 to ${g.g.cols}.${hover.current !== null ? ` Column ${hover.current + 1}${g.g.heights[hover.current] >= g.g.rows ? ', full' : ''}.` : ''}`}
        onKeyDown={onKey}
        onBlur={() => {
          hover.current = null
          bump()
        }}
      >
        <CanvasStage
          className="f4-stage"
          label={`A grid of ${g.g.cols} columns and ${g.g.rows} rows; ${g.moves} discs dropped.`}
          onPointerMove={(e) => {
            if (e.pointerType !== 'mouse') return
            const c = yours() ? colAt(e) : null
            if (c !== hover.current) {
              hover.current = c
              bump()
            }
          }}
          onPointerDown={(e) => {
            const c = colAt(e)
            if (c !== null && yours()) dropIn(c)
          }}
          make={(ctx, c) => {
            let key = ''
            return {
              frame: () => {
                const gm = game.current
                const s = savedRef.current
                const now = performance.now()
                const k = `${c.width}x${c.height}|${gm.moves}|${hover.current}|${s.discs}${s.frame}|${gm.turn}|${gm.line?.length}|${gm.falling ? now : ''}`
                if (k === key) return
                key = k
                view.current = draw(
                  ctx,
                  c.width,
                  c.height,
                  gm.g,
                  s,
                  hover.current,
                  gm.turn !== null && (mode === 'two' || gm.turn === gm.you) ? gm.turn : null,
                  gm.falling,
                  gm.line,
                  now,
                )
              },
            }
          }}
        />
      </div>
      <p className="mc-line" aria-live="polite">
        {line}
      </p>
      {mode === 'bot' && (
        <p className="sun-reading">
          <span className="muted">
            On {LEVEL_NAMES[saved.level]}: won {record.won}, lost {record.lost}
            {record.drawn ? `, drawn ${record.drawn}` : ''}
            {record.fastest > 0 && <> · quickest win {record.fastest} moves</>}
          </span>
        </p>
      )}
      {pending && <p className="muted mc-note">Your changes start with the next game.</p>}

      <div className="fw-panel">
        <section aria-label="The grid">
          <h3 className="fw-h">The grid</h3>
          <div className="lab-controls" role="group" aria-label="Grid size">
            {(Object.keys(SIZES) as Size[]).map((z) => (
              <button
                key={z}
                className="btn btn-ghost"
                aria-pressed={saved.size === z}
                onClick={() => change({ size: z })}
              >
                {SIZE_NAMES[z]}
              </button>
            ))}
          </div>
          <div className="lab-controls" role="group" aria-label="In a row to win">
            <button
              className="btn btn-ghost"
              aria-pressed={saved.need === 4}
              onClick={() => change({ need: 4 })}
            >
              Four to win
            </button>
            <button
              className="btn btn-ghost"
              aria-pressed={saved.need === 5}
              disabled={saved.size === 'small'}
              onClick={() => change({ need: 5 })}
            >
              Five to win
            </button>
          </div>
          <div className="lab-controls" role="group" aria-label="Frame">
            {FRAMES.map((f) => (
              <button
                key={f}
                className="btn btn-ghost"
                aria-pressed={saved.frame === f}
                onClick={() => setSaved((s) => ({ ...s, frame: f }))}
              >
                {FRAME_NAMES[f]}
              </button>
            ))}
          </div>
        </section>
        <section aria-label="Discs">
          <h3 className="fw-h">Discs</h3>
          <div className="lab-controls" role="group" aria-label="Disc colours">
            {DISC_SETS.map((d) => (
              <button
                key={d}
                className="btn btn-ghost"
                aria-pressed={saved.discs === d}
                onClick={() => setSaved((s) => ({ ...s, discs: d }))}
              >
                <span className="rv-discs">
                  <span aria-hidden style={{ background: INK[d][0] }} />
                  <span aria-hidden style={{ background: INK[d][1] }} />
                  {DISC_NAMES[d]}
                </span>
              </button>
            ))}
          </div>
        </section>
      </div>
      <p className="muted lab-hint">
        Take turns dropping a disc into a column; it falls to the lowest free space. Line up four of
        yours — across, up and down, or diagonally — before the other player does. A full grid with
        no line is a draw. Easy looks one move ahead and sometimes plays anywhere safe; Fair three;
        Hard six, eight on the small grid. Who goes first swaps every game. Keys on the grid: left
        and right choose a column, Down or Enter drops, or press its number.
      </p>
    </div>
  )
}
