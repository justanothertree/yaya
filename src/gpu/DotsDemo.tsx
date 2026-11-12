import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { CanvasStage } from './CanvasStage'
import {
  COLOURS,
  DOTS_KEY,
  FILLS,
  LEVELS,
  SIZES,
  choose,
  ends,
  lineCount,
  newGame,
  over,
  play,
  readSaved,
  recordGame,
  type Game,
  type Level,
  type Player,
  type Saved,
} from './dots'
import { motionReduced as reduced } from '../ui/motion'
import { useKept } from './kept'

type Mode = 'bot' | 'two'

const LEVEL_NAMES: Record<Level, string> = { easy: 'Easy', fair: 'Fair', hard: 'Hard' }
const FILL_NAMES: Record<Saved['fill'], string> = {
  solid: 'Solid',
  initial: 'Initials',
  stripes: 'Stripes',
}
const COLOUR_NAMES = ['Red', 'Blue', 'Green', 'Orange', 'Violet', 'Pink']

/** a line's midpoint, in dot units */
const mid = (g: Game, l: number) => {
  const [r0, c0, r1, c1] = ends(g.b, l)
  return { x: (c0 + c1) / 2, y: (r0 + r1) / 2 }
}

/** the nearest line in a direction, for walking the board with the arrow keys */
function stepTo(g: Game, from: number, dx: number, dy: number): number {
  const a = mid(g, from)
  let best = from
  let bd = Infinity
  for (let l = 0; l < lineCount(g.b); l++) {
    const m = mid(g, l)
    const along = (m.x - a.x) * dx + (m.y - a.y) * dy
    const across = Math.abs((m.x - a.x) * dy - (m.y - a.y) * dx)
    if (along <= 0 || across > along) continue
    const d = along + across * 2
    if (d < bd) {
      bd = d
      best = l
    }
  }
  return best
}

type Look = {
  g: Game
  colours: [string, string]
  letters: [string, string]
  fill: Saved['fill']
  /** the line under the pointer or the keyboard cursor, drawn faintly in the mover's colour */
  ghost: number | null
  /** the last line drawn and how far it has grown in (0–1); boxes it closed fade in with it */
  last: number | null
  grow: number
}
type View = { s: number; ox: number; oy: number }
function draw(ctx: CanvasRenderingContext2D, w: number, h: number, k: Look): View {
  const { g } = k
  const pad = Math.min(w, h) * 0.08
  const s = Math.min((w - pad * 2) / g.b.cols, (h - pad * 2) / g.b.rows)
  const ox = (w - g.b.cols * s) / 2
  const oy = (h - g.b.rows * s) / 2
  const X = (c: number) => ox + c * s
  const Y = (r: number) => oy + r * s
  ctx.fillStyle = '#fbf8f1'
  ctx.fillRect(0, 0, w, h)

  // boxes
  const lastBoxes = k.last !== null ? g.b.boxesOf[k.last] : []
  for (let b = 0; b < g.owner.length; b++) {
    const who = g.owner[b]
    if (who < 0) continue
    const r = Math.floor(b / g.b.cols)
    const c = b % g.b.cols
    const x = X(c)
    const y = Y(r)
    ctx.globalAlpha = lastBoxes.includes(b) ? Math.min(1, k.grow) : 1
    const col = k.colours[who]
    if (k.fill === 'stripes') {
      ctx.save()
      ctx.beginPath()
      ctx.rect(x, y, s, s)
      ctx.clip()
      ctx.strokeStyle = col
      ctx.globalAlpha *= 0.55
      ctx.lineWidth = Math.max(2, s * 0.06)
      for (let t = -s; t < s * 2; t += s * 0.2) {
        ctx.beginPath()
        ctx.moveTo(x + t, y)
        ctx.lineTo(x + t - s, y + s)
        ctx.stroke()
      }
      ctx.restore()
    } else {
      ctx.fillStyle = col
      ctx.globalAlpha *= k.fill === 'solid' ? 0.55 : 0.18
      ctx.fillRect(x, y, s, s)
    }
    ctx.globalAlpha = lastBoxes.includes(b) ? Math.min(1, k.grow) : 1
    if (k.fill === 'initial') {
      ctx.fillStyle = col
      ctx.font = `800 ${Math.round(s * 0.5)}px system-ui, sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(k.letters[who], x + s / 2, y + s / 2 + s * 0.03)
    }
    ctx.globalAlpha = 1
  }

  // lines
  const lw = Math.max(3, s * 0.07)
  ctx.lineCap = 'round'
  const stroke = (l: number, colour: string, width: number, part = 1, dash = false) => {
    const [r0, c0, r1, c1] = ends(g.b, l)
    ctx.strokeStyle = colour
    ctx.lineWidth = width
    ctx.setLineDash(dash ? [width * 1.2, width * 1.4] : [])
    ctx.beginPath()
    ctx.moveTo(X(c0), Y(r0))
    ctx.lineTo(X(c0 + (c1 - c0) * part), Y(r0 + (r1 - r0) * part))
    ctx.stroke()
    ctx.setLineDash([])
  }
  if (k.ghost !== null && !g.drawn[k.ghost]) {
    ctx.globalAlpha = 0.6
    stroke(k.ghost, k.colours[g.turn], lw, 1, true)
    ctx.globalAlpha = 1
  }
  for (let l = 0; l < g.drawn.length; l++) {
    if (!g.drawn[l]) continue
    const col = k.colours[g.by[l]]
    if (l === k.last) {
      ctx.globalAlpha = 0.25
      stroke(l, col, lw * 2.4, Math.min(1, k.grow))
      ctx.globalAlpha = 1
      stroke(l, col, lw, Math.min(1, k.grow))
    } else stroke(l, col, lw)
  }
  if (k.ghost !== null && g.drawn[k.ghost]) {
    // the keyboard cursor resting on a drawn line still shows where it is
    ctx.globalAlpha = 0.5
    stroke(k.ghost, '#111', lw * 0.4, 1, true)
    ctx.globalAlpha = 1
  }

  // dots last, over the ends of the lines
  ctx.fillStyle = '#23262d'
  const dr = Math.max(3.5, s * 0.075)
  for (let r = 0; r <= g.b.rows; r++)
    for (let c = 0; c <= g.b.cols; c++) {
      ctx.beginPath()
      ctx.arc(X(c), Y(r), dr, 0, Math.PI * 2)
      ctx.fill()
    }
  return { s, ox, oy }
}

/* ---------------------------------------------------------------------------- the room */

export function DotsDemo() {
  const [saved, setSaved] = useKept(DOTS_KEY, readSaved)
  const [mode, setMode] = useState<Mode>('bot')
  /** the game itself lives in a ref and is drawn from there; `tick` re-renders the page around it */
  const game = useRef<Game>(newGame(saved.size, saved.size, 0))
  const meta = useRef({ level: saved.level, first: 0 as Player, recorded: false })
  const [, setTick] = useState(0)
  const bump = () => setTick((t) => t + 1)
  const [line, setLine] = useState('Your turn — draw a line between two dots.')
  const ghost = useRef<number | null>(null)
  const cursor = useRef(0)
  const last = useRef<{ l: number | null; at: number }>({ l: null, at: 0 })
  const view = useRef<View | null>(null)
  const timer = useRef(0)
  const savedRef = useRef(saved)
  savedRef.current = saved
  const modeRef = useRef(mode)
  modeRef.current = mode
  useEffect(() => () => window.clearTimeout(timer.current), [])

  const g = game.current
  const names = mode === 'bot' ? ['You', 'The computer'] : ['Player 1', 'Player 2']
  const computerTurn = mode === 'bot' && g.turn === 1 && !over(g)

  const finish = () => {
    const gm = game.current
    const [a, b] = gm.score
    if (modeRef.current === 'bot' && !meta.current.recorded) {
      meta.current.recorded = true
      const lv = meta.current.level
      setSaved((s) => ({ ...s, record: { ...s.record, [lv]: recordGame(s.record[lv], a, b) } }))
    }
    const nm = modeRef.current === 'bot' ? ['You', 'The computer'] : ['Player 1', 'Player 2']
    setLine(
      a === b
        ? `A draw, ${a} boxes each.`
        : a > b
          ? `🏆 ${modeRef.current === 'bot' ? 'You win' : `${nm[0]} wins`}, ${a} to ${b}!`
          : `${nm[1]} wins, ${b} to ${a}.`,
    )
  }

  const draw1 = (l: number) => {
    const gm = game.current
    if (gm.drawn[l] || over(gm)) return
    const who = gm.turn
    const closed = play(gm, l)
    last.current = { l, at: performance.now() }
    const nm = modeRef.current === 'bot' ? ['You', 'The computer'] : ['Player 1', 'Player 2']
    if (over(gm)) finish()
    else if (closed.length)
      setLine(
        `${nm[who]} ${who === 0 && modeRef.current === 'bot' ? 'close' : 'closes'} ${closed.length === 2 ? 'two boxes' : 'a box'} — ${modeRef.current === 'bot' && who === 0 ? 'go again' : 'and goes again'}.`,
      )
    else
      setLine(
        modeRef.current === 'bot'
          ? gm.turn === 0
            ? 'Your turn.'
            : 'The computer is thinking…'
          : `${nm[gm.turn]}’s turn.`,
      )
    bump()
  }

  // the computer draws its lines, a beat apart so each one can be seen
  useEffect(() => {
    if (!computerTurn) return
    timer.current = window.setTimeout(
      () => draw1(choose(game.current, meta.current.level)),
      last.current.l !== null && game.current.by[last.current.l] === 1 ? 380 : 600,
    )
    return () => window.clearTimeout(timer.current)
  })

  const fresh = (m: Mode = mode, size: number = saved.size, level: Level = saved.level) => {
    window.clearTimeout(timer.current)
    const first: Player =
      over(game.current) || m !== mode ? (meta.current.first === 0 ? 1 : 0) : meta.current.first
    game.current = newGame(size, size, first)
    meta.current = { level, first, recorded: false }
    last.current = { l: null, at: 0 }
    ghost.current = null
    cursor.current = 0
    setMode(m)
    setLine(
      m === 'bot'
        ? first === 0
          ? 'Your turn — draw a line between two dots.'
          : 'The computer goes first this time…'
        : `${first === 0 ? 'Player 1' : 'Player 2'} first.`,
    )
    bump()
  }
  const started = g.moves > 0
  const change = (p: Partial<Saved>) => {
    setSaved((s) => ({ ...s, ...p }))
    if ((p.size !== undefined || p.level !== undefined) && (!started || over(g)))
      fresh(mode, p.size ?? saved.size, p.level ?? saved.level)
  }

  /** the nearest line to a point, within a third of a box */
  const nearest = (e: PointerEvent<HTMLCanvasElement>): number | null => {
    const v = view.current
    if (!v) return null
    const c = e.currentTarget
    const r = c.getBoundingClientRect()
    const px = ((e.clientX - r.left) / r.width) * c.width
    const py = ((e.clientY - r.top) / r.height) * c.height
    const x = (px - v.ox) / v.s
    const y = (py - v.oy) / v.s
    const gm = game.current
    let best: number | null = null
    let bd = 0.36
    for (let l = 0; l < lineCount(gm.b); l++) {
      const m = mid(gm, l)
      const d = Math.hypot(m.x - x, m.y - y)
      if (d < bd) {
        bd = d
        best = l
      }
    }
    return best
  }
  const yours = () => !over(game.current) && !(modeRef.current === 'bot' && game.current.turn === 1)

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const dirs: Record<string, [number, number]> = {
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
    }
    if (dirs[e.key]) {
      e.preventDefault()
      e.stopPropagation()
      if (ghost.current === null) ghost.current = cursor.current
      else cursor.current = stepTo(game.current, cursor.current, ...dirs[e.key])
      ghost.current = cursor.current
      bump()
    } else if ((e.key === 'Enter' || e.key === ' ') && ghost.current !== null) {
      e.preventDefault()
      if (yours()) draw1(cursor.current)
    }
  }

  const record = saved.record[saved.level]
  const [r0, c0, r1, c1] = ends(g.b, cursor.current)
  const cursorSays = `${r0 === r1 ? 'Across' : 'Down'} from row ${r0 + 1}, column ${c0 + 1} to row ${r1 + 1}, column ${c1 + 1}${g.drawn[cursor.current] ? ', already drawn' : ''}`
  const colourGroup = (which: 'mine' | 'theirs') => (
    <div
      className="fw-swatches"
      role="group"
      aria-label={which === 'mine' ? `${names[0]}’s colour` : `${names[1]}’s colour`}
    >
      <span className="fw-label">{which === 'mine' ? names[0] : names[1]}</span>
      {COLOURS.map((c, i) => (
        <button
          key={c}
          className="fw-swatch"
          style={{ background: c }}
          aria-label={`${COLOUR_NAMES[i]} for ${which === 'mine' ? names[0] : names[1]}`}
          aria-pressed={saved[which] === i}
          disabled={saved[which === 'mine' ? 'theirs' : 'mine'] === i}
          onClick={() => setSaved((s) => ({ ...s, [which]: i }))}
        />
      ))}
    </div>
  )

  return (
    <div className="lab-keys db-room">
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
        <div className="lab-group" role="group" aria-label="Board size">
          {SIZES.map((n) => (
            <button
              key={n}
              className="btn btn-ghost"
              aria-pressed={saved.size === n}
              aria-label={`${n} by ${n} boxes`}
              onClick={() => change({ size: n })}
            >
              {n}×{n}
            </button>
          ))}
        </div>
        <button className="btn btn-ghost" onClick={() => fresh()}>
          ↻ New game
        </button>
      </div>

      <div className="dice-scores">
        {names.map((nm, i) => (
          <div
            key={nm}
            className={`dice-score${g.turn === i && !over(g) ? ' is-up' : ''}`}
            style={{ borderLeft: `6px solid ${COLOURS[i === 0 ? saved.mine : saved.theirs]}` }}
          >
            <span>{nm}</span>
            <strong>{g.score[i]}</strong>
          </div>
        ))}
      </div>

      <div
        className="db-wrap"
        tabIndex={0}
        role="group"
        aria-label={`The board. Arrow keys move between lines, Enter draws one. Now on: ${cursorSays}.`}
        onKeyDown={onKey}
        onBlur={() => {
          ghost.current = null
          bump()
        }}
      >
        <CanvasStage
          className="db-stage"
          label={`Dots and boxes, ${g.b.rows} by ${g.b.cols}. ${names[0]} ${g.score[0]}, ${names[1]} ${g.score[1]}.`}
          onPointerMove={(e) => {
            if (e.pointerType !== 'mouse') return
            const l = yours() ? nearest(e) : null
            if (l !== ghost.current) {
              ghost.current = l
              bump()
            }
          }}
          onPointerDown={(e) => {
            const l = nearest(e)
            if (l === null) return
            cursor.current = l
            if (yours()) draw1(l)
            ghost.current = null
          }}
          make={(ctx, c) => {
            let key = ''
            return {
              frame: () => {
                const s = savedRef.current
                const gm = game.current
                const grow = reduced()
                  ? 1
                  : Math.min(1, (performance.now() - last.current.at) / 180)
                const k = `${c.width}x${c.height}|${gm.moves}|${ghost.current}|${s.mine}${s.theirs}${s.fill}${s.initial}${s.initial2}|${modeRef.current}|${grow}`
                if (k === key) return
                key = k
                view.current = draw(ctx, c.width, c.height, {
                  g: gm,
                  colours: [COLOURS[s.mine], COLOURS[s.theirs]],
                  letters: [s.initial, modeRef.current === 'bot' ? '🤖' : s.initial2],
                  fill: s.fill,
                  ghost: ghost.current,
                  last: last.current.l,
                  grow,
                })
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
            {record.best > 0 && <> · widest win {record.best} boxes</>}
          </span>
        </p>
      )}
      {started &&
        !over(g) &&
        (g.b.rows !== saved.size || (mode === 'bot' && meta.current.level !== saved.level)) && (
          <p className="muted mc-note">Your changes start with the next game.</p>
        )}

      <div className="fw-panel">
        <section aria-label="Colours">
          <h3 className="fw-h">Colours</h3>
          {colourGroup('mine')}
          {colourGroup('theirs')}
        </section>
        <section aria-label="Boxes">
          <h3 className="fw-h">Boxes</h3>
          <div className="lab-controls" role="group" aria-label="How a box is filled">
            {FILLS.map((f) => (
              <button
                key={f}
                className="btn btn-ghost"
                aria-pressed={saved.fill === f}
                onClick={() => setSaved((s) => ({ ...s, fill: f }))}
              >
                {FILL_NAMES[f]}
              </button>
            ))}
          </div>
          <div className="lab-controls">
            <label className="db-initial">
              <span>{names[0]}’s letter</span>
              <input
                value={saved.initial}
                maxLength={4}
                onChange={(e) => {
                  const ch = [...e.target.value.trim()].pop()
                  if (ch) setSaved((s) => ({ ...s, initial: ch }))
                }}
              />
            </label>
            {mode === 'two' && (
              <label className="db-initial">
                <span>{names[1]}’s letter</span>
                <input
                  value={saved.initial2}
                  maxLength={4}
                  onChange={(e) => {
                    const ch = [...e.target.value.trim()].pop()
                    if (ch) setSaved((s) => ({ ...s, initial2: ch }))
                  }}
                />
              </label>
            )}
          </div>
        </section>
      </div>
      <p className="muted lab-hint">
        Take turns drawing a line between two dots that sit side by side. Draw the fourth side of a
        box and it is yours — and you draw again, so one line can start a run. The trick is never to
        draw a box’s third side if you can help it, and at the end, when every line gives something
        away, to give the least. Easy grabs boxes and draws almost anywhere; Fair never gives a box
        away when it can avoid it; Hard plays the endgame out line by line, and will leave you two
        boxes to keep hold of a longer run. Keys on the board: arrows move between lines, Enter
        draws.
      </p>
    </div>
  )
}
