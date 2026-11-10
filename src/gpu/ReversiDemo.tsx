import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { CanvasStage } from './CanvasStage'
import {
  BOARDS,
  DISCS,
  LEVELS,
  REVERSI_KEY,
  SIZES,
  choose,
  count,
  flips,
  moves,
  nextTurn,
  other,
  place,
  readSaved,
  recordGame,
  start,
  type Board,
  type Level,
  type Saved,
  type Who,
} from './reversi'

type Mode = 'bot' | 'two'
const load = (): Saved => {
  try {
    return readSaved(localStorage.getItem(REVERSI_KEY))
  } catch {
    return readSaved(null)
  }
}
const reduced = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches

const LEVEL_NAMES: Record<Level, string> = { easy: 'Easy', fair: 'Fair', hard: 'Hard' }
const BOARD_NAMES: Record<Saved['board'], string> = { felt: 'Felt', wood: 'Wood', slate: 'Slate' }
const DISC_NAMES: Record<Saved['discs'], string> = {
  classic: 'Classic',
  sunset: 'Sunset',
  ocean: 'Ocean',
  candy: 'Candy',
}
const FELT: Record<Saved['board'], { bg: string; line: string }> = {
  felt: { bg: '#1f7a4a', line: '#145234' },
  wood: { bg: '#c08a52', line: '#8a5a2b' },
  slate: { bg: '#3c4650', line: '#242b31' },
}
/** dark's colour, then light's */
const INK: Record<Saved['discs'], [string, string]> = {
  classic: ['#17191e', '#f4f3ee'],
  sunset: ['#6a1b4d', '#ffb347'],
  ocean: ['#0b3d91', '#8fe9f5'],
  candy: ['#d93a72', '#a6efcf'],
}
const FLIP = 0.32

type Look = {
  b: Board
  turn: Who | null
  board: Saved['board']
  discs: Saved['discs']
  hints: number[]
  ghost: number | null
  cursor: number | null
  last: number | null
  /** when each disc began turning over, for the flip; empty under reduced motion */
  turning: Map<number, number>
  now: number
}
type View = { s: number; ox: number; oy: number }

function draw(ctx: CanvasRenderingContext2D, w: number, h: number, k: Look): View {
  const { b } = k
  const pad = Math.min(w, h) * 0.04
  const s = Math.min((w - pad * 2) / b.n, (h - pad * 2) / b.n)
  const ox = (w - b.n * s) / 2
  const oy = (h - b.n * s) / 2
  const felt = FELT[k.board]
  ctx.fillStyle = '#1b1d22'
  ctx.fillRect(0, 0, w, h)
  ctx.fillStyle = felt.bg
  ctx.fillRect(ox, oy, s * b.n, s * b.n)
  ctx.strokeStyle = felt.line
  ctx.lineWidth = Math.max(1, s * 0.03)
  for (let i = 0; i <= b.n; i++) {
    ctx.beginPath()
    ctx.moveTo(ox + i * s, oy)
    ctx.lineTo(ox + i * s, oy + b.n * s)
    ctx.moveTo(ox, oy + i * s)
    ctx.lineTo(ox + b.n * s, oy + i * s)
    ctx.stroke()
  }
  const [darkInk, lightInk] = INK[k.discs]
  const centre = (i: number) => [ox + (i % b.n) * s + s / 2, oy + Math.floor(i / b.n) * s + s / 2]
  const r = s * 0.4
  const disc = (i: number, colour: string, squash = 1, alpha = 1) => {
    const [x, y] = centre(i)
    ctx.globalAlpha = alpha
    ctx.fillStyle = 'rgba(0,0,0,0.3)'
    ctx.beginPath()
    ctx.ellipse(x + s * 0.03, y + s * 0.04, Math.max(0.5, r * squash), r, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = colour
    ctx.beginPath()
    ctx.ellipse(x, y, Math.max(0.5, r * squash), r, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.globalAlpha = 1
  }
  const flipping = k.ghost !== null && k.turn ? flips(b, k.ghost, k.turn) : []
  for (let i = 0; i < b.cells.length; i++) {
    const c = b.cells[i]
    if (!c) continue
    const ink = c === 1 ? darkInk : lightInk
    const t0 = k.turning.get(i)
    if (t0 !== undefined && k.now - t0 < FLIP * 1000) {
      // turning over: thin to an edge in the old colour, then open in the new one
      const p = (k.now - t0) / (FLIP * 1000)
      const was = c === 1 ? lightInk : darkInk
      disc(i, p < 0.5 ? was : ink, Math.abs(Math.cos(p * Math.PI)))
    } else disc(i, ink)
    if (flipping.includes(i)) {
      const [x, y] = centre(i)
      ctx.strokeStyle = k.turn === 1 ? darkInk : lightInk
      ctx.lineWidth = Math.max(2, s * 0.06)
      ctx.beginPath()
      ctx.arc(x, y, r * 0.55, 0, Math.PI * 2)
      ctx.stroke()
    }
  }
  if (k.last !== null) {
    const [x, y] = centre(k.last)
    ctx.fillStyle = '#e63946'
    ctx.beginPath()
    ctx.arc(x, y, Math.max(2.5, s * 0.07), 0, Math.PI * 2)
    ctx.fill()
  }
  if (k.turn) {
    const ink = k.turn === 1 ? darkInk : lightInk
    for (const i of k.hints) {
      const [x, y] = centre(i)
      ctx.fillStyle = ink
      ctx.globalAlpha = 0.45
      ctx.beginPath()
      ctx.arc(x, y, Math.max(3, s * 0.1), 0, Math.PI * 2)
      ctx.fill()
      ctx.globalAlpha = 1
    }
    if (k.ghost !== null && flipping.length) disc(k.ghost, ink, 1, 0.55)
  }
  if (k.cursor !== null) {
    const x = ox + (k.cursor % b.n) * s
    const y = oy + Math.floor(k.cursor / b.n) * s
    ctx.strokeStyle = '#ffd34d'
    ctx.lineWidth = Math.max(2.5, s * 0.07)
    ctx.strokeRect(x + 2, y + 2, s - 4, s - 4)
  }
  return { s, ox, oy }
}

/* ---------------------------------------------------------------------------- the room */

export function ReversiDemo() {
  const [saved, setSaved] = useState<Saved>(load)
  const [mode, setMode] = useState<Mode>('bot')
  const game = useRef({
    b: start(saved.size),
    turn: 1 as Who | null,
    level: saved.level,
    you: saved.side,
    moves: 0,
    recorded: false,
    last: null as number | null,
  })
  const [, setTick] = useState(0)
  const bump = () => setTick((t) => t + 1)
  const [line, setLine] = useState(
    saved.side === 1 ? 'You play dark and go first.' : 'The computer plays dark and goes first…',
  )
  const ghost = useRef<number | null>(null)
  const cursor = useRef<number | null>(null)
  const turning = useRef(new Map<number, number>())
  const view = useRef<View | null>(null)
  const timer = useRef(0)
  const savedRef = useRef(saved)
  savedRef.current = saved
  const modeRef = useRef(mode)
  modeRef.current = mode
  useEffect(() => () => window.clearTimeout(timer.current), [])
  useEffect(() => {
    try {
      localStorage.setItem(REVERSI_KEY, JSON.stringify(saved))
    } catch {
      /* private mode: kept for this visit */
    }
  }, [saved])

  const g = game.current
  const nameOf = (w: Who) =>
    modeRef.current === 'bot'
      ? w === game.current.you
        ? 'You'
        : 'The computer'
      : w === 1
        ? 'Dark'
        : 'Light'
  const computerTurn = mode === 'bot' && g.turn !== null && g.turn !== g.you

  const playAt = (i: number) => {
    const gm = game.current
    const who = gm.turn
    if (!who || !flips(gm.b, i, who).length) return
    const f = flips(gm.b, i, who)
    gm.b = place(gm.b, i, who)
    gm.moves++
    gm.last = i
    if (!reduced()) {
      const now = performance.now()
      f.forEach((k, j) => turning.current.set(k, now + j * 40))
    }
    const next = nextTurn(gm.b, who)
    gm.turn = next
    const [d, l] = count(gm.b)
    if (next === null) {
      const you = modeRef.current === 'bot' ? (gm.you === 1 ? d : l) : d
      const them = modeRef.current === 'bot' ? (gm.you === 1 ? l : d) : l
      if (modeRef.current === 'bot' && !gm.recorded) {
        gm.recorded = true
        const lv = gm.level
        setSaved((s) => ({
          ...s,
          record: { ...s.record, [lv]: recordGame(s.record[lv], you, them) },
        }))
      }
      setLine(
        d === l
          ? `A draw, ${d} discs each.`
          : modeRef.current === 'bot'
            ? you > them
              ? `🏆 You win, ${you} to ${them}!`
              : `The computer wins, ${them} to ${you}.`
            : `🏆 ${d > l ? 'Dark' : 'Light'} wins, ${Math.max(d, l)} to ${Math.min(d, l)}.`,
      )
    } else if (next === who)
      setLine(
        `${nameOf(other(who))} ${nameOf(other(who)) === 'You' ? 'have' : 'has'} no move and must pass. ${nameOf(who)} again.`,
      )
    else
      setLine(
        `${nameOf(who)} turned over ${f.length}. ${nameOf(next) === 'The computer' ? 'The computer is thinking…' : `${nameOf(next)} to play.`}`,
      )
    bump()
  }

  // the computer's move, after a beat so you can see what you did
  useEffect(() => {
    if (!computerTurn) return
    timer.current = window.setTimeout(() => {
      const gm = game.current
      if (gm.turn) playAt(choose(gm.b, gm.turn, gm.level))
    }, 550)
    return () => window.clearTimeout(timer.current)
  })

  const fresh = (m: Mode = mode, size = saved.size, level = saved.level, side = saved.side) => {
    window.clearTimeout(timer.current)
    game.current = {
      b: start(size),
      turn: 1,
      level,
      you: side,
      moves: 0,
      recorded: false,
      last: null,
    }
    turning.current.clear()
    ghost.current = null
    cursor.current = null
    setMode(m)
    setLine(
      m === 'two'
        ? 'Dark goes first.'
        : side === 1
          ? 'You play dark and go first.'
          : 'The computer plays dark and goes first…',
    )
    bump()
  }
  const started = g.moves > 0
  const change = (p: Partial<Saved>) => {
    setSaved((s) => ({ ...s, ...p }))
    if ((p.size || p.level || p.side) && (!started || g.turn === null))
      fresh(mode, p.size ?? saved.size, p.level ?? saved.level, p.side ?? saved.side)
  }
  const yours = () => {
    const gm = game.current
    return gm.turn !== null && (modeRef.current === 'two' || gm.turn === gm.you)
  }

  const cellAt = (e: PointerEvent<HTMLCanvasElement>): number | null => {
    const v = view.current
    if (!v) return null
    const c = e.currentTarget
    const rect = c.getBoundingClientRect()
    const x = (((e.clientX - rect.left) / rect.width) * c.width - v.ox) / v.s
    const y = (((e.clientY - rect.top) / rect.height) * c.height - v.oy) / v.s
    const n = game.current.b.n
    if (x < 0 || y < 0 || x >= n || y >= n) return null
    return Math.floor(y) * n + Math.floor(x)
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
      const cur = cursor.current ?? moves(game.current.b, game.current.turn ?? 1)[0] ?? 0
      const r = Math.max(
        0,
        Math.min(n - 1, Math.floor(cur / n) + (cursor.current === null ? 0 : step[e.key][0])),
      )
      const c = Math.max(
        0,
        Math.min(n - 1, (cur % n) + (cursor.current === null ? 0 : step[e.key][1])),
      )
      cursor.current = r * n + c
      ghost.current = cursor.current
      bump()
    } else if ((e.key === 'Enter' || e.key === ' ') && cursor.current !== null) {
      e.preventDefault()
      if (yours()) playAt(cursor.current)
    }
  }

  const [d, l] = count(g.b)
  const record = saved.record[saved.level]
  const hints = saved.hints && yours() ? moves(g.b, g.turn ?? 1) : []
  const cur = cursor.current
  const cursorSays =
    cur === null
      ? 'no square chosen yet'
      : `row ${Math.floor(cur / g.b.n) + 1}, column ${(cur % g.b.n) + 1}, ${
          g.b.cells[cur] === 1
            ? 'dark'
            : g.b.cells[cur] === 2
              ? 'light'
              : g.turn && flips(g.b, cur, g.turn).length
                ? `a move turning over ${flips(g.b, cur, g.turn).length}`
                : 'empty'
        }`
  const scoreNames: [string, string] =
    mode === 'bot'
      ? g.you === 1
        ? ['You · dark', 'Computer · light']
        : ['Computer · dark', 'You · light']
      : ['Dark', 'Light']

  return (
    <div className="lab-keys rv-room">
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
              {LEVELS.map((lv) => (
                <button
                  key={lv}
                  className="btn btn-ghost"
                  aria-pressed={saved.level === lv}
                  onClick={() => change({ level: lv })}
                >
                  {LEVEL_NAMES[lv]}
                </button>
              ))}
            </div>
            <div className="lab-group" role="group" aria-label="Your colour">
              <button
                className="btn btn-ghost"
                aria-pressed={saved.side === 1}
                onClick={() => change({ side: 1 })}
              >
                Play dark (first)
              </button>
              <button
                className="btn btn-ghost"
                aria-pressed={saved.side === 2}
                onClick={() => change({ side: 2 })}
              >
                Play light
              </button>
            </div>
          </>
        )}
        <button className="btn btn-ghost" onClick={() => fresh()}>
          ↻ New game
        </button>
      </div>

      <div className="dice-scores">
        {([1, 2] as Who[]).map((w, i) => (
          <div
            key={w}
            className={`dice-score${g.turn === w ? ' is-up' : ''}`}
            style={{ borderLeft: `6px solid ${INK[saved.discs][i]}` }}
          >
            <span>{scoreNames[i]}</span>
            <strong>{i === 0 ? d : l}</strong>
          </div>
        ))}
      </div>

      <div
        className="rv-wrap"
        tabIndex={0}
        role="group"
        aria-label={`The board. Arrow keys move, Enter places a disc. Now on ${cursorSays}.`}
        onKeyDown={onKey}
        onBlur={() => {
          cursor.current = null
          ghost.current = null
          bump()
        }}
      >
        <CanvasStage
          className="rv-stage"
          label={`A reversi board, ${g.b.n} by ${g.b.n}: dark ${d}, light ${l}.`}
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
            if (i === null) return
            if (yours()) playAt(i)
            ghost.current = null
          }}
          make={(ctx, c) => {
            let key = ''
            return {
              frame: () => {
                const s = savedRef.current
                const gm = game.current
                const now = performance.now()
                let moving = false
                for (const [i, t0] of turning.current) {
                  if (now - t0 >= FLIP * 1000) turning.current.delete(i)
                  else moving = true
                }
                const ours = gm.turn !== null && (modeRef.current === 'two' || gm.turn === gm.you)
                const k = `${c.width}x${c.height}|${gm.moves}|${ghost.current}|${cursor.current}|${s.board}${s.discs}${s.hints}|${ours}`
                if (!moving && k === key) return
                key = moving ? '' : k
                view.current = draw(ctx, c.width, c.height, {
                  b: gm.b,
                  turn: gm.turn,
                  board: s.board,
                  discs: s.discs,
                  hints: s.hints && ours ? moves(gm.b, gm.turn ?? 1) : [],
                  ghost: ours ? ghost.current : null,
                  cursor: cursor.current,
                  last: gm.last,
                  turning: turning.current,
                  now,
                })
              },
            }
          }}
        />
      </div>
      <p className="mc-line" aria-live="polite">
        {line}
        {hints.length > 0 && <span className="muted"> · {hints.length} possible moves</span>}
      </p>
      {mode === 'bot' && (
        <p className="sun-reading">
          <span className="muted">
            On {LEVEL_NAMES[saved.level]}: won {record.won}, lost {record.lost}
            {record.drawn ? `, drawn ${record.drawn}` : ''}
            {record.best > 0 && <> · widest win {record.best} discs</>}
          </span>
        </p>
      )}
      {started &&
        g.turn !== null &&
        (g.b.n !== saved.size ||
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
                aria-label={`${n} by ${n} squares`}
                onClick={() => change({ size: n })}
              >
                {n}×{n}
              </button>
            ))}
          </div>
          <div className="lab-controls" role="group" aria-label="Board">
            {BOARDS.map((bd) => (
              <button
                key={bd}
                className="btn btn-ghost"
                aria-pressed={saved.board === bd}
                onClick={() => setSaved((s) => ({ ...s, board: bd }))}
              >
                {BOARD_NAMES[bd]}
              </button>
            ))}
          </div>
          <div className="lab-controls">
            <button
              className="btn btn-ghost"
              aria-pressed={saved.hints}
              onClick={() => setSaved((s) => ({ ...s, hints: !s.hints }))}
            >
              Show possible moves
            </button>
          </div>
        </section>
        <section aria-label="Discs">
          <h3 className="fw-h">Discs</h3>
          <div className="lab-controls" role="group" aria-label="Disc colours">
            {DISCS.map((ds) => (
              <button
                key={ds}
                className="btn btn-ghost rv-discs"
                aria-pressed={saved.discs === ds}
                onClick={() => setSaved((s) => ({ ...s, discs: ds }))}
              >
                <span aria-hidden style={{ background: INK[ds][0] }} />
                <span aria-hidden style={{ background: INK[ds][1] }} />
                {DISC_NAMES[ds]}
              </button>
            ))}
          </div>
        </section>
      </div>
      <p className="muted lab-hint">
        Place a disc so that it traps a straight line of your opponent’s discs — across, down or
        diagonally — between it and another of yours, and every disc in that line turns over to your
        colour. No move that traps anything? You pass. When neither side can move, the most discs
        wins. Corners can never be turned back, which is why every computer wants them; Easy grabs
        whatever turns over the most, Fair looks two moves ahead, and Hard looks further and plays
        the last ten or so squares out perfectly. Hovering shows what a move would turn over. Keys
        on the board: arrows move, Enter places.
      </p>
    </div>
  )
}
