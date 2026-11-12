import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { CanvasStage } from './CanvasStage'
import {
  COLOUR_COUNTS,
  COLS,
  GUN,
  HEIGHT,
  LINE_Y,
  LOOKS,
  MIN_AIM,
  POPPER_KEY,
  ROWS,
  WIDTH,
  centre,
  flight,
  newGame,
  readSaved,
  rowAt,
  shoot,
  swap,
  width,
  type Game,
  type Landing,
  type Pt,
  type Saved,
} from './popper'

const load = (): Saved => {
  try {
    return readSaved(localStorage.getItem(POPPER_KEY))
  } catch {
    return readSaved(null)
  }
}
const reduced = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
const LOOK_NAMES: Record<Saved['look'], string> = { candy: 'Candy', gems: 'Gems', night: 'Night' }
type Look = { bg: string; line: string; ink: string; glow: boolean; colours: string[] }
const PALETTES: Record<Saved['look'], Look> = {
  candy: {
    bg: '#fff7fb',
    line: '#e3a6c3',
    ink: '#5a2a44',
    glow: false,
    colours: ['#ff5d8f', '#ffb000', '#3cc47c', '#3a8dff', '#a855f7', '#00b8c4'],
  },
  gems: {
    bg: '#1b1f2e',
    line: '#566087',
    ink: '#e8ecff',
    glow: false,
    colours: ['#e0245e', '#f5a623', '#17bf63', '#1d9bf0', '#9b51e0', '#e8e8e8'],
  },
  night: {
    bg: '#07070f',
    line: '#3b3b6b',
    ink: '#d9d9ff',
    glow: true,
    colours: ['#ff3df0', '#ffe14d', '#3dff8b', '#3dd5ff', '#b06bff', '#ff8a3d'],
  },
}
/** a mark in each colour too, so no colour has to be told from another by its hue alone */
const MARKS = ['●', '▲', '■', '◆', '★', '✚']
const COLOUR_NAMES = ['pink', 'yellow', 'green', 'blue', 'violet', 'teal']
const COUNT_NAMES: Record<number, string> = { 4: 'Four', 5: 'Five', 6: 'Six' }
const STEP = (2 * Math.PI) / 180
/** how fast a shot flies, in bubble radii a second */
const SPEED = 60
const deg = (a: number) => Math.round((a * 180) / Math.PI)

type Flying = { path: Pt[]; length: number; t: number; colour: number; after: () => void }
type Bit = { x: number; y: number; vy: number; colour: number; fell: boolean; t: number }

export function PopperDemo() {
  const [saved, setSaved] = useState<Saved>(load)
  const [game, setGame] = useState<Game>(() => newGame(saved.colours, Date.now() >>> 0))
  const [aim, setAim] = useState(Math.PI / 2)
  const [busy, setBusy] = useState(false)
  const [line, setLine] = useState(
    'Aim and fire: three or more of a colour touching pop, and whatever hangs from them falls.',
  )
  const gameRef = useRef(game)
  gameRef.current = game
  const aimRef = useRef(aim)
  aimRef.current = aim
  const savedRef = useRef(saved)
  savedRef.current = saved
  const flying = useRef<Flying | null>(null)
  const bits = useRef<Bit[]>([])
  const drag = useRef(false)
  useEffect(() => {
    try {
      localStorage.setItem(POPPER_KEY, JSON.stringify(saved))
    } catch {
      /* private mode: kept for this visit */
    }
  }, [saved])

  const best = saved.best[saved.colours]
  /**
   * The shot has landed. Called from the frame loop, perhaps renders after it was fired, so it reads
   * the game it was fired from and what is kept through refs, never through this render's values
   */
  const settle = (l: Landing, before: Game) => {
    setGame(l.game)
    setBusy(false)
    if (!reduced())
      bits.current.push(
        ...l.gone.map((b) => ({
          x: b.at.x,
          y: b.at.y,
          vy: 0,
          colour: b.colour,
          fell: b.fell,
          t: 0,
        })),
      )
    if (l.game.over) {
      const record = l.game.score > savedRef.current.best[savedRef.current.colours]
      setSaved((s) => ({
        ...s,
        games: s.games + 1,
        best: { ...s.best, [s.colours]: Math.max(s.best[s.colours], l.game.score) },
      }))
      setLine(
        `Past the line — game over with ${l.game.score.toLocaleString()} points${record && l.game.score ? ', your best with this many colours!' : '.'}`,
      )
      return
    }
    const parts = [
      l.popped.length ? `${l.popped.length} popped` : '',
      l.fell.length ? `${l.fell.length} fell` : '',
    ].filter(Boolean)
    setLine(
      [
        parts.length ? `${parts.join(', ')}: +${l.gained}.` : 'No pop.',
        l.game.cleared > before.cleared ? 'Board cleared — a fresh one!' : '',
        l.newRow ? 'A new row comes down.' : '',
      ]
        .filter(Boolean)
        .join(' '),
    )
  }
  const fire = (angle = aimRef.current) => {
    const g = gameRef.current
    if (g.over || flying.current) return
    const l = shoot(g, angle)
    if (!l.cell) return
    if (reduced()) {
      settle(l, g)
      return
    }
    const { path } = flight(g, angle)
    let length = 0
    for (let i = 1; i < path.length; i++)
      length += Math.hypot(path[i].x - path[i - 1].x, path[i].y - path[i - 1].y)
    setBusy(true)
    flying.current = { path, length, t: 0, colour: g.now, after: () => settle(l, g) }
  }
  const fresh = (colours = saved.colours) => {
    flying.current = null
    bits.current = []
    setBusy(false)
    setGame(newGame(colours, (Math.random() * 2 ** 31) >>> 0))
    setLine('A fresh board. Aim and fire.')
  }
  const turn = (by: number) => setAim((a) => Math.min(Math.PI - MIN_AIM, Math.max(MIN_AIM, a + by)))

  const toField = (e: PointerEvent<HTMLCanvasElement>): Pt => {
    const r = e.currentTarget.getBoundingClientRect()
    const s = r.width / WIDTH
    return { x: (e.clientX - r.left) / s, y: (e.clientY - r.top) / s }
  }
  const aimAt = (p: Pt) => {
    // below the gun means nothing: lifting a finger there takes the shot back
    if (p.y > GUN.y - 0.5) return false
    setAim(Math.min(Math.PI - MIN_AIM, Math.max(MIN_AIM, Math.atan2(GUN.y - p.y, p.x - GUN.x))))
    return true
  }
  const onDown = (e: PointerEvent<HTMLCanvasElement>) => {
    drag.current = true
    aimAt(toField(e))
  }
  const onMove = (e: PointerEvent<HTMLCanvasElement>) => {
    // a mouse aims as it moves; a finger only while it is down
    if (drag.current || e.pointerType === 'mouse') aimAt(toField(e))
  }
  const onUp = (e: PointerEvent<HTMLCanvasElement>) => {
    if (!drag.current) return
    drag.current = false
    if (e.type === 'pointercancel') return
    const p = toField(e)
    if (aimAt(p))
      fire(Math.min(Math.PI - MIN_AIM, Math.max(MIN_AIM, Math.atan2(GUN.y - p.y, p.x - GUN.x))))
  }
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const fine = e.shiftKey ? 0.25 : 1
    if (e.key === 'ArrowLeft') turn(STEP * fine)
    else if (e.key === 'ArrowRight') turn(-STEP * fine)
    else if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowUp') fire()
    else if (e.key === 's' || e.key === 'S') {
      if (!flying.current) setGame((g) => swap(g))
    } else return
    e.preventDefault()
    e.stopPropagation()
  }

  const toGo = Math.max(0, rowAt(game.shots) - game.misses)
  return (
    <div className={`lab-keys bp-room is-${saved.look}`}>
      <div className="lab-controls">
        <div className="lab-group" role="group" aria-label="Colours">
          {COLOUR_COUNTS.map((n) => (
            <button
              key={n}
              className="btn btn-ghost"
              aria-pressed={saved.colours === n}
              onClick={() => {
                setSaved((s) => ({ ...s, colours: n }))
                fresh(n)
              }}
            >
              {COUNT_NAMES[n]} colours
            </button>
          ))}
        </div>
        <button className="btn btn-ghost" onClick={() => fresh()}>
          ↻ New game
        </button>
      </div>
      <div className="dice-scores">
        <div className="dice-score is-up">
          <span>Score</span>
          <strong>{game.score.toLocaleString()}</strong>
          <span className="muted">
            {game.shots} shot{game.shots === 1 ? '' : 's'}
            {game.cleared ? `, ${game.cleared} cleared` : ''}
          </span>
        </div>
        <div className="dice-score">
          <span>Best</span>
          <strong>{Math.max(best, game.over ? game.score : 0).toLocaleString()}</strong>
          <span className="muted">{COUNT_NAMES[saved.colours].toLowerCase()} colours</span>
        </div>
        <div className="dice-score">
          <span>New row in</span>
          <strong>{toGo}</strong>
          <span className="muted">a miss counts two</span>
        </div>
      </div>
      <p className="mc-line" aria-live="polite">
        {line}
      </p>

      <div
        className="bp-wrap"
        tabIndex={0}
        role="group"
        aria-label="The board. Move the pointer or drag a finger to aim, and click or lift to fire. Keys: left and right aim (with Shift, finely), Space fires, S swaps the two bubbles."
        onKeyDown={onKey}
      >
        <CanvasStage
          className="bp-stage"
          label={`Aimed ${deg(aim)}° from flat. Ready: ${COLOUR_NAMES[game.now - 1]} ${MARKS[game.now - 1]}; next: ${COLOUR_NAMES[game.next - 1]} ${MARKS[game.next - 1]}. ${line}`}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          make={(ctx, c) => {
            let last = ''
            let lastGame: Game | null = null
            return {
              frame: (dt) => {
                const fl = flying.current
                if (fl) {
                  fl.t += dt * SPEED
                  if (fl.t >= fl.length) {
                    flying.current = null
                    fl.after()
                  }
                }
                const live = bits.current
                for (const b of live) {
                  b.t += dt
                  if (b.fell) {
                    b.vy += 60 * dt
                    b.y += b.vy * dt
                  }
                }
                bits.current = live.filter((b) => (b.fell ? b.y < HEIGHT + 2 : b.t < 0.25))
                const g = gameRef.current
                const sv = savedRef.current
                const a = aimRef.current
                const key = `${c.width}x${c.height}|${sv.look}|${sv.guide}|${a}|${fl ? fl.t.toFixed(2) : ''}|${bits.current.length ? performance.now() : ''}`
                // a game is replaced, never changed, so the object itself says whether it moved
                if (key === last && g === lastGame) return
                last = key
                lastGame = g
                const L = PALETTES[sv.look]
                const s = c.width / WIDTH
                ctx.setTransform(1, 0, 0, 1, 0, 0)
                ctx.fillStyle = L.bg
                ctx.fillRect(0, 0, c.width, c.height)
                ctx.setTransform(s, 0, 0, s, 0, 0)
                // the line past which a bubble ends the game
                ctx.strokeStyle = L.line
                ctx.lineWidth = 0.08
                ctx.setLineDash([0.4, 0.3])
                ctx.beginPath()
                ctx.moveTo(0, LINE_Y)
                ctx.lineTo(WIDTH, LINE_Y)
                ctx.stroke()
                ctx.setLineDash([])
                const bubble = (x: number, y: number, colour: number, r = 0.94, alpha = 1) => {
                  const hue = L.colours[colour - 1] ?? L.ink
                  ctx.globalAlpha = alpha
                  if (L.glow) {
                    ctx.shadowColor = hue
                    ctx.shadowBlur = 0.6 * s
                  }
                  const grad = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r)
                  grad.addColorStop(0, '#ffffffcc')
                  grad.addColorStop(0.35, hue)
                  grad.addColorStop(1, hue)
                  ctx.fillStyle = grad
                  ctx.beginPath()
                  ctx.arc(x, y, r, 0, Math.PI * 2)
                  ctx.fill()
                  ctx.shadowBlur = 0
                  ctx.fillStyle = 'rgba(0,0,0,0.38)'
                  ctx.font = `${r * 0.95}px system-ui, sans-serif`
                  ctx.textAlign = 'center'
                  ctx.textBaseline = 'middle'
                  ctx.fillText(MARKS[colour - 1] ?? '', x, y + r * 0.06)
                  ctx.globalAlpha = 1
                }
                for (let r = 0; r <= ROWS; r++)
                  for (let col = 0; col < width(g.shift, r); col++) {
                    const v = g.cells[r * COLS + col]
                    if (!v) continue
                    const p = centre(g.shift, r, col)
                    bubble(p.x, p.y, v)
                  }
                for (const b of bits.current)
                  if (b.fell) bubble(b.x, b.y, b.colour, 0.94, 0.85)
                  else bubble(b.x, b.y, b.colour, 0.94 * (1 + b.t * 2), 1 - b.t / 0.25)
                // the guide: the path the shot would take, to where it would settle
                if (!fl && !g.over && sv.guide) {
                  const { path } = flight(g, a)
                  ctx.strokeStyle = L.ink
                  ctx.globalAlpha = 0.45
                  ctx.lineWidth = 0.12
                  ctx.setLineDash([0.25, 0.45])
                  ctx.beginPath()
                  path.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)))
                  ctx.stroke()
                  ctx.setLineDash([])
                  const end = path[path.length - 1]
                  ctx.lineWidth = 0.1
                  ctx.beginPath()
                  ctx.arc(end.x, end.y, 0.94, 0, Math.PI * 2)
                  ctx.stroke()
                  ctx.globalAlpha = 1
                }
                // the gun: a barrel along the aim, the bubble ready in it, the next one beside it
                ctx.strokeStyle = L.ink
                ctx.lineWidth = 0.5
                ctx.lineCap = 'round'
                ctx.beginPath()
                ctx.moveTo(GUN.x, GUN.y)
                ctx.lineTo(GUN.x + Math.cos(a) * 2.6, GUN.y - Math.sin(a) * 2.6)
                ctx.stroke()
                if (fl) {
                  // along the path by distance flown
                  let left = fl.t
                  let p = fl.path[fl.path.length - 1]
                  for (let i = 1; i < fl.path.length; i++) {
                    const p0 = fl.path[i - 1]
                    const p1 = fl.path[i]
                    const seg = Math.hypot(p1.x - p0.x, p1.y - p0.y)
                    if (left <= seg) {
                      p = {
                        x: p0.x + ((p1.x - p0.x) * left) / seg,
                        y: p0.y + ((p1.y - p0.y) * left) / seg,
                      }
                      break
                    }
                    left -= seg
                  }
                  bubble(p.x, p.y, fl.colour)
                } else if (!g.over) bubble(GUN.x, GUN.y, g.now)
                if (!g.over) {
                  bubble(GUN.x + 4.2, GUN.y + 0.1, g.next, 0.7)
                  ctx.fillStyle = L.ink
                  ctx.globalAlpha = 0.7
                  ctx.font = '0.75px system-ui, sans-serif'
                  ctx.textAlign = 'center'
                  ctx.fillText('next', GUN.x + 4.2, GUN.y + 1.3)
                  ctx.globalAlpha = 1
                }
              },
            }
          }}
        />
      </div>
      <div className="lab-controls">
        <button className="btn btn-ghost" aria-label="Aim left" onClick={() => turn(STEP)}>
          ◀
        </button>
        <button className="btn btn-ghost" onClick={() => fire()} disabled={busy || game.over}>
          Fire
        </button>
        <button className="btn btn-ghost" aria-label="Aim right" onClick={() => turn(-STEP)}>
          ▶
        </button>
        <button
          className="btn btn-ghost"
          onClick={() => setGame((g) => swap(g))}
          disabled={busy || game.over}
        >
          ⇄ Swap
        </button>
      </div>
      <p className="sun-reading">
        <span className="muted">Games played: {saved.games}</span>
      </p>
      <div className="fw-panel">
        <section aria-label="Look">
          <h3 className="fw-h">Bubbles</h3>
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
              aria-pressed={saved.guide}
              onClick={() => setSaved((s) => ({ ...s, guide: !s.guide }))}
            >
              Aim line
            </button>
          </div>
        </section>
      </div>
      <p className="muted lab-hint">
        Fire bubbles up into the ceiling: a shot flies straight, bounces off the walls, and sticks
        where it touches. Three or more of one colour touching pop for ten points each, and any
        bubbles left hanging from nothing fall for twenty each — doubled for every five that fall
        together. Each shot counts towards a new row coming down: one if it popped something, two if
        it did not, and the count needed shrinks as the game goes on. A bubble past the dashed line
        ends the game; clear the board for a bonus and a fresh one. Every colour carries its own
        mark too. Keys: left and right aim, Space fires, S swaps.
      </p>
    </div>
  )
}
