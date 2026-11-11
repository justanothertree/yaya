import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { CanvasStage } from './CanvasStage'
import {
  HEX_KEY,
  LEVELS,
  SIZES,
  THEMES,
  chain,
  choose,
  empty,
  other,
  place,
  readSaved,
  recordGame,
  swap,
  winner,
  type Board,
  type Level,
  type Player,
  type Saved,
} from './hex'

type Mode = 'bot' | 'two'
const load = (): Saved => {
  try {
    return readSaved(localStorage.getItem(HEX_KEY))
  } catch {
    return readSaved(null)
  }
}
const LEVEL_NAMES: Record<Level, string> = { easy: 'Easy', fair: 'Fair', hard: 'Hard' }
const THEME_NAMES: Record<Saved['theme'], string> = {
  classic: 'Classic',
  night: 'Night',
  paper: 'Paper',
}
type Look = { bg: string; cell: string; edge: string; red: string; blue: string; text: string }
const LOOKS: Record<Saved['theme'], Look> = {
  classic: {
    bg: '#f4ead7',
    cell: '#fbf6ea',
    edge: '#b7a789',
    red: '#d7263d',
    blue: '#1b5fd6',
    text: '#222',
  },
  night: {
    bg: '#0d1020',
    cell: '#1a1f38',
    edge: '#2c3561',
    red: '#ff3d7f',
    blue: '#21d4fd',
    text: '#eef',
  },
  paper: {
    bg: '#ffffff',
    cell: '#ffffff',
    edge: '#9aa0a6',
    red: '#c0392b',
    blue: '#2c3e50',
    text: '#222',
  },
}
const SQ3 = Math.sqrt(3)
const ROWS = 'ABCDEFGHIJK'

type View = { R: number; ox: number; oy: number }
function geometry(n: number, w: number, h: number): View {
  const R = Math.min(w / (SQ3 * (1.5 * n + 0.5) + 2), h / (1.5 * n + 1.5))
  const bw = SQ3 * R * (n - 1 + (n - 1) / 2)
  const bh = 1.5 * R * (n - 1)
  return { R, ox: (w - bw) / 2, oy: (h - bh) / 2 }
}
const centre = (v: View, n: number, i: number) => {
  const r = Math.floor(i / n)
  const c = i % n
  return [v.ox + SQ3 * v.R * (c + r / 2), v.oy + 1.5 * v.R * r]
}

function draw(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  b: Board,
  look: Look,
  ghost: number | null,
  ghostBy: Player | null,
  cursor: number | null,
  last: number | null,
  path: number[] | null,
): View {
  const { n } = b
  const v = geometry(n, w, h)
  ctx.fillStyle = look.bg
  ctx.fillRect(0, 0, w, h)
  // each side's two edges, as wide coloured bands just outside the board
  const band = (from: number, to: number, dx: number, dy: number, colour: string) => {
    const [x0, y0] = centre(v, n, from)
    const [x1, y1] = centre(v, n, to)
    ctx.strokeStyle = colour
    ctx.lineWidth = v.R * 0.55
    ctx.lineCap = 'round'
    ctx.beginPath()
    ctx.moveTo(x0 + dx * v.R, y0 + dy * v.R)
    ctx.lineTo(x1 + dx * v.R, y1 + dy * v.R)
    ctx.stroke()
  }
  band(0, n - 1, 0, -1.25, look.red)
  band(n * (n - 1), n * n - 1, 0, 1.25, look.red)
  band(0, n * (n - 1), -1.15, 0, look.blue)
  band(n - 1, n * n - 1, 1.15, 0, look.blue)
  const hexPath = (x: number, y: number, r: number) => {
    ctx.beginPath()
    for (let k = 0; k < 6; k++) {
      const a = Math.PI / 6 + (k * Math.PI) / 3
      const px = x + Math.cos(a) * r
      const py = y + Math.sin(a) * r
      if (k) ctx.lineTo(px, py)
      else ctx.moveTo(px, py)
    }
    ctx.closePath()
  }
  const onPath = new Set(path ?? [])
  for (let i = 0; i < n * n; i++) {
    const [x, y] = centre(v, n, i)
    hexPath(x, y, v.R * 0.98)
    ctx.fillStyle = look.cell
    ctx.fill()
    ctx.strokeStyle = look.edge
    ctx.lineWidth = Math.max(1, v.R * 0.06)
    ctx.stroke()
    const s = b.cells[i]
    if (s) {
      ctx.fillStyle = s === 1 ? look.red : look.blue
      ctx.beginPath()
      ctx.arc(x, y, v.R * 0.68, 0, Math.PI * 2)
      ctx.fill()
      if (onPath.has(i)) {
        ctx.strokeStyle = '#ffd34d'
        ctx.lineWidth = Math.max(2, v.R * 0.16)
        ctx.stroke()
      }
    } else if (i === ghost && ghostBy) {
      ctx.globalAlpha = 0.4
      ctx.fillStyle = ghostBy === 1 ? look.red : look.blue
      ctx.beginPath()
      ctx.arc(x, y, v.R * 0.62, 0, Math.PI * 2)
      ctx.fill()
      ctx.globalAlpha = 1
    }
    if (i === last) {
      ctx.fillStyle = '#ffffff'
      ctx.beginPath()
      ctx.arc(x, y, Math.max(2, v.R * 0.16), 0, Math.PI * 2)
      ctx.fill()
    }
    if (i === cursor) {
      hexPath(x, y, v.R * 0.9)
      ctx.strokeStyle = '#ffd34d'
      ctx.lineWidth = Math.max(2.5, v.R * 0.14)
      ctx.stroke()
    }
  }
  return v
}

export function HexDemo() {
  const [saved, setSaved] = useState<Saved>(load)
  const [mode, setMode] = useState<Mode>('bot')
  const game = useRef({
    b: empty(saved.size),
    turn: 1 as Player,
    you: saved.side,
    level: saved.level,
    swapRule: saved.swap,
    moves: 0,
    last: null as number | null,
    over: false,
  })
  const [, setTick] = useState(0)
  const bump = () => setTick((t) => t + 1)
  const [line, setLine] = useState(
    saved.side === 1
      ? 'You are red: join the top to the bottom. You go first.'
      : 'You are blue: join left to right. The computer goes first…',
  )
  const ghost = useRef<number | null>(null)
  const cursor = useRef<number | null>(null)
  const view = useRef<View | null>(null)
  const timer = useRef(0)
  const savedRef = useRef(saved)
  savedRef.current = saved
  useEffect(() => () => window.clearTimeout(timer.current), [])
  useEffect(() => {
    try {
      localStorage.setItem(HEX_KEY, JSON.stringify(saved))
    } catch {
      /* private mode: kept for this visit */
    }
  }, [saved])

  const g = game.current
  const computerTurn = mode === 'bot' && !g.over && g.turn !== g.you
  const canSwap = g.swapRule && g.moves === 1 && !g.over && (mode === 'two' || g.turn === g.you)
  const after = (p: Player) => {
    const gm = game.current
    const w = winner(gm.b)
    if (w) {
      gm.over = true
      if (mode === 'bot') {
        const won = w === gm.you
        const lv = gm.level
        setSaved((s) => ({ ...s, record: { ...s.record, [lv]: recordGame(s.record[lv], won) } }))
        setLine(
          won
            ? `🏆 You joined your sides in ${Math.ceil(gm.moves / 2)} moves!`
            : 'The computer joined its sides.',
        )
      } else setLine(`🏆 ${w === 1 ? 'Red' : 'Blue'} wins!`)
    } else {
      gm.turn = other(p)
      setLine(
        mode === 'bot'
          ? gm.turn === gm.you
            ? 'Your move.'
            : 'The computer is thinking…'
          : `${gm.turn === 1 ? 'Red' : 'Blue'} to move.`,
      )
    }
    bump()
  }
  const playAt = (i: number) => {
    const gm = game.current
    if (gm.over || gm.b.cells[i]) return
    const p = gm.turn
    gm.b = place(gm.b, i, p)
    gm.moves++
    gm.last = i
    after(p)
  }
  const doSwap = () => {
    const gm = game.current
    gm.b = swap(gm.b)
    gm.moves++
    gm.last = gm.b.cells.findIndex((c) => c)
    after(gm.turn)
  }

  // the computer's move: a beat to show what you did, then it thinks
  useEffect(() => {
    if (!computerTurn) return
    timer.current = window.setTimeout(() => {
      const gm = game.current
      if (gm.over || gm.turn === gm.you) return
      // with the swap rule, take a strong first stone rather than answer it
      if (gm.swapRule && gm.moves === 1) {
        const at = gm.b.cells.findIndex((c) => c)
        const r = Math.floor(at / gm.b.n)
        const c = at % gm.b.n
        const mid = (gm.b.n - 1) / 2
        if (Math.abs(r - mid) + Math.abs(c - mid) <= gm.b.n / 3) {
          doSwap()
          setLine('The computer took the swap: your stone is now its own. Your move.')
          return
        }
      }
      playAt(choose(gm.b, gm.turn, gm.level))
    }, 450)
    return () => window.clearTimeout(timer.current)
  })

  const fresh = (m: Mode = mode, s: Saved = saved) => {
    window.clearTimeout(timer.current)
    game.current = {
      b: empty(s.size),
      turn: 1,
      you: s.side,
      level: s.level,
      swapRule: s.swap,
      moves: 0,
      last: null,
      over: false,
    }
    ghost.current = null
    cursor.current = null
    setMode(m)
    setLine(
      m === 'two'
        ? 'Red joins top to bottom, blue left to right. Red first.'
        : s.side === 1
          ? 'You are red: join the top to the bottom. You go first.'
          : 'You are blue: join left to right. The computer goes first…',
    )
    bump()
  }
  const change = (p: Partial<Saved>) => {
    const s = { ...saved, ...p }
    setSaved(s)
    if (g.moves === 0 || g.over) fresh(mode, s)
  }
  const yours = () => {
    const gm = game.current
    return !gm.over && (mode === 'two' || gm.turn === gm.you)
  }
  const cellAt = (e: PointerEvent<HTMLCanvasElement>): number | null => {
    const v = view.current
    if (!v) return null
    const c = e.currentTarget
    const rect = c.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * c.width
    const y = ((e.clientY - rect.top) / rect.height) * c.height
    const n = game.current.b.n
    let best: number | null = null
    let bd = v.R
    for (let i = 0; i < n * n; i++) {
      const [cx, cy] = centre(v, n, i)
      const d = Math.hypot(cx - x, cy - y)
      if (d < bd) {
        bd = d
        best = i
      }
    }
    return best
  }
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const n = game.current.b.n
    const step: Record<string, [number, number]> = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
    }
    if (step[e.key]) {
      e.preventDefault()
      e.stopPropagation()
      const cur = cursor.current ?? Math.floor((n * n) / 2)
      const moved = cursor.current === null ? [0, 0] : step[e.key]
      const r = Math.max(0, Math.min(n - 1, Math.floor(cur / n) + moved[0]))
      const c = Math.max(0, Math.min(n - 1, (cur % n) + moved[1]))
      cursor.current = r * n + c
      ghost.current = cursor.current
      bump()
    } else if ((e.key === 'Enter' || e.key === ' ') && cursor.current !== null) {
      e.preventDefault()
      if (yours()) playAt(cursor.current)
    }
  }

  const record = saved.record[saved.level]
  const w = g.over ? winner(g.b) : null
  const path = w ? chain(g.b.cells, g.b.n, w) : null
  const cur = cursor.current
  const cursorSays =
    cur === null
      ? 'no cell chosen yet'
      : `${ROWS[Math.floor(cur / g.b.n)]}${(cur % g.b.n) + 1}, ${g.b.cells[cur] === 1 ? 'red' : g.b.cells[cur] === 2 ? 'blue' : 'empty'}`

  return (
    <div className="lab-keys hx-room">
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
          <>
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
            <div className="lab-group" role="group" aria-label="Your side">
              <button
                className="btn btn-ghost"
                aria-pressed={saved.side === 1}
                onClick={() => change({ side: 1 })}
              >
                Play red (first)
              </button>
              <button
                className="btn btn-ghost"
                aria-pressed={saved.side === 2}
                onClick={() => change({ side: 2 })}
              >
                Play blue
              </button>
            </div>
          </>
        )}
        <button className="btn btn-ghost" onClick={() => fresh()}>
          ↻ New game
        </button>
        {canSwap && (
          <button className="btn" onClick={doSwap}>
            ⇄ Swap — take that stone
          </button>
        )}
      </div>

      <div
        className="hx-wrap"
        tabIndex={0}
        role="group"
        aria-label={`The board. Arrow keys move, Enter places a stone. Now on ${cursorSays}.`}
        onKeyDown={onKey}
        onBlur={() => {
          cursor.current = null
          ghost.current = null
          bump()
        }}
      >
        <CanvasStage
          className="hx-stage"
          label={`A hex board, ${g.b.n} by ${g.b.n}. Red joins top and bottom, blue left and right.`}
          onPointerMove={(e) => {
            if (e.pointerType !== 'mouse') return
            const i = yours() ? cellAt(e) : null
            if (i !== ghost.current) {
              ghost.current = i
              bump()
            }
          }}
          onPointerDown={(e) => {
            const i = cellAt(e)
            if (i !== null && yours()) playAt(i)
            ghost.current = null
          }}
          make={(ctx, c) => {
            let key = ''
            return {
              frame: () => {
                const gm = game.current
                const s = savedRef.current
                const k = `${c.width}x${c.height}|${gm.moves}|${ghost.current}|${cursor.current}|${s.theme}|${gm.over}`
                if (k === key) return
                key = k
                const wn = gm.over ? winner(gm.b) : null
                view.current = draw(
                  ctx,
                  c.width,
                  c.height,
                  gm.b,
                  LOOKS[s.theme],
                  ghost.current,
                  gm.over ? null : gm.turn,
                  cursor.current,
                  gm.last,
                  wn ? chain(gm.b.cells, gm.b.n, wn) : null,
                )
              },
            }
          }}
        />
      </div>
      <p className="mc-line" aria-live="polite">
        {line}
        {path && <span className="muted"> · the winning chain is {path.length} stones</span>}
      </p>
      {mode === 'bot' && (
        <p className="sun-reading">
          <span className="muted">
            Against {LEVEL_NAMES[saved.level]}: won {record.won}, lost {record.lost}
            {record.best > 1 && <> · best run {record.best} in a row</>}
          </span>
        </p>
      )}
      {g.moves > 0 &&
        !g.over &&
        (g.b.n !== saved.size ||
          g.swapRule !== saved.swap ||
          (mode === 'bot' && (g.level !== saved.level || g.you !== saved.side))) && (
          <p className="muted mc-note">Your changes start with the next game.</p>
        )}

      <div className="fw-panel">
        <section aria-label="The board">
          <h3 className="fw-h">The board</h3>
          <div className="lab-controls" role="group" aria-label="Board size">
            {SIZES.map((n) => (
              <button
                key={n}
                className="btn btn-ghost"
                aria-pressed={saved.size === n}
                aria-label={`${n} by ${n}`}
                onClick={() => change({ size: n })}
              >
                {n}×{n}
              </button>
            ))}
          </div>
          <div className="lab-controls" role="group" aria-label="Colours">
            {THEMES.map((t) => (
              <button
                key={t}
                className="btn btn-ghost"
                aria-pressed={saved.theme === t}
                onClick={() => setSaved((s) => ({ ...s, theme: t }))}
              >
                <span className="rv-discs">
                  <span aria-hidden style={{ background: LOOKS[t].red }} />
                  <span aria-hidden style={{ background: LOOKS[t].blue }} />
                  {THEME_NAMES[t]}
                </span>
              </button>
            ))}
          </div>
          <div className="lab-controls">
            <button
              className="btn btn-ghost"
              aria-pressed={saved.swap}
              onClick={() => change({ swap: !saved.swap })}
            >
              Swap rule
            </button>
          </div>
        </section>
      </div>
      <p className="muted lab-hint">
        Take turns putting a stone on any empty cell. Red wins by joining the top edge to the bottom
        with a chain of touching red stones, blue by joining left to right — and since the board can
        never fill up without one of them doing it, there are no draws. Two stones with two empty
        cells between them are as good as joined (a bridge): if one cell is taken, take the other.
        With the swap rule, after the first stone the second player may take it as their own instead
        of answering it, which keeps the first move honest. Easy and Fair judge a cell by filling
        the board at random hundreds of times; Hard grows a tree of thousands of games and reads a
        fight several moves deep. Keys on the board: arrows move, Enter places.
      </p>
    </div>
  )
}
