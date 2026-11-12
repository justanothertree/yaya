import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { CanvasStage } from './CanvasStage'
import {
  CLOTHS,
  LEVELS,
  POCKETS,
  POCKET,
  POOL_KEY,
  R,
  TH,
  TW,
  aimLine,
  canPlace,
  groupOf,
  newGame,
  place,
  plan,
  readSaved,
  shoot,
  targets,
  type Game,
  type Level,
  type Saved,
  type ShotLog,
} from './pool'
import { motionReduced as reduced } from '../ui/motion'
import { useKept } from './kept'

type Phase = 'aim' | 'rolling' | 'cpu' | 'over'
const LEVEL_NAMES: Record<Level, string> = { easy: 'Easy', fair: 'Fair', hard: 'Hard' }
const CLOTH: Record<Saved['cloth'], { cloth: string; name: string }> = {
  green: { cloth: '#1f7a4a', name: 'Green' },
  blue: { cloth: '#1f5b9a', name: 'Blue' },
  red: { cloth: '#8e2433', name: 'Red' },
}
const BALL_COLOURS = [
  '#f8f6ee',
  '#f2c12e',
  '#2a5bd7',
  '#d8342b',
  '#6a2c91',
  '#f07c1b',
  '#1f8a4c',
  '#7a2a1e',
  '#111111',
]
const colourOf = (n: number) => BALL_COLOURS[n === 8 ? 8 : n > 8 ? n - 8 : n]
const RAIL = 0.09

type View = { s: number; ox: number; oy: number }
function fit(w: number, h: number): View {
  const s = Math.min(w / (TW + RAIL * 2), h / (TH + RAIL * 2))
  return { s, ox: (w - TW * s) / 2, oy: (h - TH * s) / 2 }
}

export function PoolDemo() {
  const [saved, setSaved] = useKept(POOL_KEY, readSaved)
  const [level, setLevel] = useState<Level>(saved.level)
  const [game, setGame] = useState<Game>(() => newGame((Math.random() * 2 ** 31) | 0, 0))
  const [phase, setPhase] = useState<Phase>('aim')
  const [line, setLine] = useState(
    'Your break. Drag back from anywhere on the table — like a slingshot — and let go.',
  )
  const gameRef = useRef(game)
  gameRef.current = game
  const phaseRef = useRef(phase)
  phaseRef.current = phase
  const savedRef = useRef(saved)
  savedRef.current = saved
  /** the aim as an angle and a strength, set by a drag or by the keys */
  const aim = useRef({ angle: 0, power: 0, dragging: false, from: { x: 0, y: 0 } })
  /** a shot being shown: its frames, and how far through them */
  const show = useRef<{ frames: number[][]; t: number; after: () => void } | null>(null)
  const view = useRef<View | null>(null)
  const timers = useRef<number[]>([])
  const [, redraw] = useState(0)
  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), [])
  const later = (ms: number, f: () => void) => timers.current.push(window.setTimeout(f, ms))

  const settle = (g: Game, by: 0 | 1) => {
    setGame(g)
    if (g.winner !== null) {
      const won = g.winner === 0
      setSaved((s) => ({
        ...s,
        record: {
          ...s.record,
          [level]: {
            won: s.record[level].won + (won ? 1 : 0),
            lost: s.record[level].lost + (won ? 0 : 1),
          },
        },
      }))
      setLine(`${won ? '🏆 You win' : 'The computer wins'}. ${g.said}`)
      setPhase('over')
      return
    }
    const who = by === 0 ? 'You' : 'The computer'
    const next =
      g.turn === 0
        ? g.inHand
          ? 'Your shot, with the ball in hand: tap where to put it.'
          : 'Your shot.'
        : 'The computer to shoot…'
    setLine(`${who}: ${g.said} ${next}`)
    if (g.turn === 1) {
      setPhase('cpu')
      later(700, () => computer(g))
    } else setPhase('aim')
  }
  /** play a shot and show it rolling, then hand the table on */
  const run = (g: Game, angle: number, power: number) => {
    const by = g.turn
    const { game: after, log } = shoot(g, angle, power, true)
    const done = () => {
      show.current = null
      settle(after, by)
    }
    setPhase(by === 0 ? 'rolling' : 'cpu')
    if (reduced()) {
      // no rolling to watch: the balls are where they stop
      show.current = { frames: [log.frames[log.frames.length - 1]], t: 0, after: done }
      later(250, done)
    } else show.current = { frames: (log as ShotLog).frames, t: 0, after: done }
  }
  const computer = (g: Game) => {
    let base = g
    // the break: firmly up the table into the rack
    if (!base.broken) return run(base, (Math.random() - 0.5) * 0.04, 1)
    const p = plan(base, level)
    if (p.place) base = place(base, p.place.x, p.place.y)
    setGame(base)
    later(350, () => run(base, p.angle, p.power))
  }

  const fresh = (lv: Level = saved.level) => {
    timers.current.forEach((t) => window.clearTimeout(t))
    timers.current = []
    show.current = null
    setLevel(lv)
    const first = game.broken && game.turn === 0 ? 1 : 0
    const g = newGame((Math.random() * 2 ** 31) | 0, first as 0 | 1)
    setGame(g)
    aim.current.power = 0
    if (first === 0) {
      setPhase('aim')
      setLine('Your break. Drag back from anywhere on the table and let go.')
    } else {
      setLine('The computer breaks…')
      setPhase('cpu')
      later(700, () => computer(g))
    }
  }

  const toTable = (e: PointerEvent<HTMLCanvasElement>) => {
    const c = e.currentTarget
    const v = view.current
    if (!v) return null
    const r = c.getBoundingClientRect()
    const px = ((e.clientX - r.left) / r.width) * c.width
    const py = ((e.clientY - r.top) / r.height) * c.height
    return { x: (px - v.ox) / v.s, y: (py - v.oy) / v.s }
  }
  const myTurn = () => phaseRef.current === 'aim' && gameRef.current.turn === 0
  const onDown = (e: PointerEvent<HTMLCanvasElement>) => {
    if (!myTurn()) return
    const p = toTable(e)
    if (!p) return
    const g = gameRef.current
    if (g.inHand) {
      if (canPlace(g, p.x, p.y)) {
        setGame({ ...place(g, p.x, p.y), inHand: false })
        setLine('Placed. Now drag back to aim and let go to shoot.')
      } else setLine('Not there — it would touch a ball or the cushion.')
      return
    }
    aim.current = { ...aim.current, dragging: true, from: p, power: 0 }
  }
  const onMove = (e: PointerEvent<HTMLCanvasElement>) => {
    if (!aim.current.dragging) return
    const p = toTable(e)
    if (!p) return
    const dx = aim.current.from.x - p.x
    const dy = aim.current.from.y - p.y
    const d = Math.hypot(dx, dy)
    // pulled back, so the shot goes the opposite way to the drag
    if (d > 0.01) aim.current.angle = Math.atan2(dy, dx)
    aim.current.power = Math.min(1, d / 0.7)
  }
  const onUp = () => {
    if (!aim.current.dragging) return
    aim.current.dragging = false
    if (aim.current.power > 0.03 && myTurn())
      run(gameRef.current, aim.current.angle, aim.current.power)
  }

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!myTurn()) return
    const g = gameRef.current
    const fine = e.shiftKey ? 0.2 : 1
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) {
      e.preventDefault()
      e.stopPropagation()
      if (g.inHand) {
        // with the ball in hand the arrows carry it, and Enter puts it down
        const cue = g.balls.find((b) => b.n === 0)!
        const step = 0.03 * fine
        const nx = cue.x + (e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0)
        const ny = cue.y + (e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0)
        if (nx > R && nx < TW - R && ny > R && ny < TH - R)
          setGame({ ...g, balls: g.balls.map((b) => (b.n === 0 ? { ...b, x: nx, y: ny } : b)) })
        return
      }
      if (e.key === 'ArrowLeft') aim.current.angle -= 0.03 * fine
      if (e.key === 'ArrowRight') aim.current.angle += 0.03 * fine
      if (e.key === 'ArrowUp') aim.current.power = Math.min(1, aim.current.power + 0.05 * fine)
      if (e.key === 'ArrowDown') aim.current.power = Math.max(0, aim.current.power - 0.05 * fine)
      redraw((n) => n + 1)
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      if (g.inHand) {
        const cue = g.balls.find((b) => b.n === 0)!
        if (canPlace({ ...g, balls: g.balls.filter((b) => b.n !== 0) }, cue.x, cue.y)) {
          setGame({ ...g, inHand: false })
          setLine('Placed. Arrows aim and set the strength; Space shoots.')
        } else setLine('Not there — it touches another ball.')
      } else if (aim.current.power > 0.03) run(g, aim.current.angle, aim.current.power)
      else setLine('Set some strength first: the up arrow.')
    }
  }

  const g = game
  const mine = g.groups[0]
  const left = (grp: 'solids' | 'stripes' | null) =>
    g.balls.filter((b) => !b.down && grp && groupOf(b.n) === grp).map((b) => b.n)
  const r = saved.record[saved.level]
  return (
    <div className="lab-keys pl-room">
      <div className="lab-controls">
        <div className="lab-group" role="group" aria-label="How well the computer plays">
          {LEVELS.map((l) => (
            <button
              key={l}
              className="btn btn-ghost"
              aria-pressed={saved.level === l}
              onClick={() => {
                setSaved((s) => ({ ...s, level: l }))
                if (!g.broken || phase === 'over') fresh(l)
              }}
            >
              {LEVEL_NAMES[l]}
            </button>
          ))}
        </div>
        <button className="btn btn-ghost" onClick={() => fresh()}>
          ↻ New rack
        </button>
      </div>
      <div className="dice-scores">
        {([0, 1] as const).map((w) => (
          <div key={w} className={`dice-score${g.turn === w && phase !== 'over' ? ' is-up' : ''}`}>
            <span>
              {w === 0 ? 'You' : 'The computer'} · {g.groups[w] ?? 'open table'}
            </span>
            <strong className="pl-left">
              {g.groups[w]
                ? left(g.groups[w]).map((n) => (
                    <span
                      key={n}
                      className="pl-mini"
                      style={{ background: colourOf(n) }}
                      aria-hidden
                    />
                  ))
                : '—'}
              {g.groups[w] && !left(g.groups[w]).length ? ' the black next' : ''}
            </strong>
            {g.groups[w] && <span className="muted">{left(g.groups[w]).length} left</span>}
          </div>
        ))}
      </div>
      <div
        className={`pl-wrap${phase === 'aim' && g.turn === 0 ? ' is-aiming' : ''}`}
        tabIndex={0}
        role="group"
        aria-label="The table. Drag back from anywhere and let go to shoot; with the keys, left and right aim, up and down set the strength, Space shoots. With the ball in hand, tap or use the arrows to place it."
        onKeyDown={onKey}
      >
        <CanvasStage
          className="pl-stage"
          label={`A pool table. ${mine ? `You have ${mine}, ${left(mine).length} left.` : 'The table is open.'} ${line}`}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          make={(ctx, c) => {
            let last = ''
            return {
              frame: (dt) => {
                const sh = show.current
                const gm = gameRef.current
                const s = savedRef.current
                let pos: number[] | null = null
                if (sh) {
                  sh.t += dt * 60
                  const k = Math.min(sh.frames.length - 1, Math.floor(sh.t))
                  pos = sh.frames[k]
                  if (sh.t >= sh.frames.length - 1 && sh.frames.length > 1) {
                    show.current = null
                    sh.after()
                  }
                }
                const a = aim.current
                const key = `${c.width}x${c.height}|${pos ? pos.join(',') : ''}|${gm.balls.map((b) => `${b.x.toFixed(4)},${b.y.toFixed(4)},${b.down}`).join(';')}|${a.angle.toFixed(4)}|${a.power.toFixed(3)}|${a.dragging}|${phaseRef.current}|${s.cloth}|${s.guide}|${gm.inHand}`
                if (key === last) return
                last = key
                const v = fit(c.width, c.height)
                view.current = v
                const X = (x: number) => v.ox + x * v.s
                const Y = (y: number) => v.oy + y * v.s
                ctx.setTransform(1, 0, 0, 1, 0, 0)
                ctx.clearRect(0, 0, c.width, c.height)
                ctx.fillStyle = '#4a2a14'
                ctx.beginPath()
                ctx.roundRect(
                  X(-RAIL),
                  Y(-RAIL),
                  (TW + RAIL * 2) * v.s,
                  (TH + RAIL * 2) * v.s,
                  RAIL * v.s * 0.6,
                )
                ctx.fill()
                ctx.fillStyle = CLOTH[s.cloth].cloth
                ctx.fillRect(X(0), Y(0), TW * v.s, TH * v.s)
                // the head string, where the break is taken from
                ctx.strokeStyle = 'rgba(255,255,255,0.18)'
                ctx.lineWidth = 1
                ctx.beginPath()
                ctx.moveTo(X(TW * 0.25), Y(0))
                ctx.lineTo(X(TW * 0.25), Y(TH))
                ctx.stroke()
                ctx.fillStyle = '#050505'
                for (const p of POCKETS) {
                  ctx.beginPath()
                  ctx.arc(X(p.x), Y(p.y), POCKET * v.s * 1.05, 0, Math.PI * 2)
                  ctx.fill()
                }
                const balls = gm.balls.map((b, i) =>
                  pos ? { ...b, x: pos[i * 3], y: pos[i * 3 + 1], down: pos[i * 3 + 2] === 1 } : b,
                )
                // the aim: a guide to the first ball and where it goes, then the cue itself
                const cue = balls.find((b) => b.n === 0)!
                const aiming = !pos && phaseRef.current === 'aim' && gm.turn === 0 && !gm.inHand
                if (aiming && (a.power > 0 || a.dragging)) {
                  if (s.guide) {
                    const l = aimLine(balls, a.angle)
                    ctx.strokeStyle = 'rgba(255,255,255,0.65)'
                    ctx.setLineDash([6, 6])
                    ctx.lineWidth = Math.max(1, v.s * 0.004)
                    ctx.beginPath()
                    ctx.moveTo(X(cue.x), Y(cue.y))
                    ctx.lineTo(X(l.x), Y(l.y))
                    ctx.stroke()
                    ctx.setLineDash([])
                    ctx.beginPath()
                    ctx.arc(X(l.x), Y(l.y), R * v.s, 0, Math.PI * 2)
                    ctx.stroke()
                    if (l.sends !== null) {
                      const o = balls.find((b) => b.n === l.hit)!
                      ctx.strokeStyle = targets(gm, 0).includes(l.hit)
                        ? 'rgba(140,255,170,0.85)'
                        : 'rgba(255,120,120,0.85)'
                      ctx.beginPath()
                      ctx.moveTo(X(o.x), Y(o.y))
                      ctx.lineTo(
                        X(o.x + Math.cos(l.sends) * 0.25),
                        Y(o.y + Math.sin(l.sends) * 0.25),
                      )
                      ctx.stroke()
                    }
                  }
                  const back = 0.06 + a.power * 0.25
                  ctx.strokeStyle = '#d9b27c'
                  ctx.lineCap = 'round'
                  ctx.lineWidth = Math.max(3, v.s * 0.014)
                  ctx.beginPath()
                  ctx.moveTo(
                    X(cue.x - Math.cos(a.angle) * back),
                    Y(cue.y - Math.sin(a.angle) * back),
                  )
                  ctx.lineTo(
                    X(cue.x - Math.cos(a.angle) * (back + 0.9)),
                    Y(cue.y - Math.sin(a.angle) * (back + 0.9)),
                  )
                  ctx.stroke()
                  ctx.lineCap = 'butt'
                }
                for (const b of balls) {
                  if (b.down) continue
                  const x = X(b.x)
                  const y = Y(b.y)
                  const rr = R * v.s
                  ctx.fillStyle = colourOf(b.n)
                  ctx.beginPath()
                  ctx.arc(x, y, rr, 0, Math.PI * 2)
                  ctx.fill()
                  if (b.n > 8) {
                    // a stripe: white top and bottom, the colour across the middle
                    ctx.save()
                    ctx.beginPath()
                    ctx.arc(x, y, rr, 0, Math.PI * 2)
                    ctx.clip()
                    ctx.fillStyle = '#f8f6ee'
                    ctx.fillRect(x - rr, y - rr, rr * 2, rr * 0.55)
                    ctx.fillRect(x - rr, y + rr * 0.45, rr * 2, rr * 0.55)
                    ctx.restore()
                  }
                  if (b.n) {
                    ctx.fillStyle = '#fff'
                    ctx.beginPath()
                    ctx.arc(x, y, rr * 0.48, 0, Math.PI * 2)
                    ctx.fill()
                    ctx.fillStyle = '#111'
                    ctx.font = `700 ${Math.round(rr * 0.75)}px system-ui, sans-serif`
                    ctx.textAlign = 'center'
                    ctx.textBaseline = 'middle'
                    ctx.fillText(String(b.n), x, y + 0.5)
                  }
                  ctx.fillStyle = 'rgba(255,255,255,0.35)'
                  ctx.beginPath()
                  ctx.arc(x - rr * 0.35, y - rr * 0.35, rr * 0.25, 0, Math.PI * 2)
                  ctx.fill()
                }
                if (gm.inHand && gm.turn === 0 && !pos) {
                  ctx.strokeStyle = '#ffd34d'
                  ctx.setLineDash([4, 4])
                  ctx.lineWidth = 2
                  ctx.beginPath()
                  ctx.arc(X(cue.x), Y(cue.y), R * v.s * 1.6, 0, Math.PI * 2)
                  ctx.stroke()
                  ctx.setLineDash([])
                }
                if (aiming && (a.dragging || a.power > 0)) {
                  // the strength, as a bar along the bottom rail
                  ctx.fillStyle = 'rgba(0,0,0,0.4)'
                  ctx.fillRect(X(0.1), Y(TH + RAIL * 0.35), (TW - 0.2) * v.s, RAIL * 0.3 * v.s)
                  ctx.fillStyle = a.power > 0.8 ? '#ff6b4a' : '#ffd34d'
                  ctx.fillRect(
                    X(0.1),
                    Y(TH + RAIL * 0.35),
                    (TW - 0.2) * a.power * v.s,
                    RAIL * 0.3 * v.s,
                  )
                }
              },
            }
          }}
        />
      </div>
      <p className="mc-line" aria-live="polite">
        {line}
      </p>
      <p className="sun-reading">
        <span className="muted">
          Against {LEVEL_NAMES[saved.level]}: won {r.won}, lost {r.lost}
        </span>
      </p>
      {level !== saved.level && g.broken && phase !== 'over' && (
        <p className="muted mc-note">The new level starts with the next rack.</p>
      )}
      <div className="fw-panel">
        <section aria-label="Table">
          <h3 className="fw-h">Table</h3>
          <div className="lab-controls" role="group" aria-label="Cloth">
            {CLOTHS.map((cl) => (
              <button
                key={cl}
                className="btn btn-ghost"
                aria-pressed={saved.cloth === cl}
                onClick={() => setSaved((s) => ({ ...s, cloth: cl }))}
              >
                {CLOTH[cl].name}
              </button>
            ))}
            <button
              className="btn btn-ghost"
              aria-pressed={saved.guide}
              onClick={() => setSaved((s) => ({ ...s, guide: !s.guide }))}
            >
              Show the line
            </button>
          </div>
        </section>
      </div>
      <p className="muted lab-hint">
        Eight-ball. Pot one of a kind after the break and that is your group — solids or stripes —
        and the other is the computer's. Hit one of your own first, and pot one or send a ball to a
        cushion, or it is a foul and the other side has the ball in hand to place anywhere. Pot one
        of yours and you shoot again. Clear your group, then pot the black to win — pot it early, or
        on a foul, and you lose. To shoot, drag back from anywhere on the table and let go: the
        further you pull, the harder. The line shows where the cue ball meets its first ball, green
        if it is one you may hit. Easy, Fair and Hard plan the same way and differ in how steady the
        cue is and how many shots they try.
      </p>
    </div>
  )
}
