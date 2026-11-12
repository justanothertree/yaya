import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { CanvasStage } from './CanvasStage'
import {
  BALLS,
  FIELDS,
  H,
  HIGH,
  JOINS,
  KEEPY_KEY,
  R,
  W,
  ZONE,
  kickLowest,
  newWorld,
  readSaved,
  step,
  tap,
  type BallKind,
  type Kick,
  type Saved,
  type World,
} from './keepy'
import { motionReduced as reduced } from '../ui/motion'

const load = (): Saved => {
  try {
    return readSaved(localStorage.getItem(KEEPY_KEY))
  } catch {
    return readSaved(null)
  }
}
const BALL_NAMES: Record<BallKind, string> = {
  balloon: '🎈 Balloon',
  beach: '🏖️ Beach ball',
  football: '⚽ Football',
}
const FIELD_LOOK: Record<
  Saved['field'],
  { name: string; sky: [string, string]; ground: string; line: string }
> = {
  park: { name: 'Park', sky: ['#8fd3ff', '#e3f5ff'], ground: '#5aa645', line: 'rgba(0,0,0,0.28)' },
  beach: {
    name: 'Beach',
    sky: ['#ffb36b', '#ffe7c2'],
    ground: '#ecd28e',
    line: 'rgba(0,0,0,0.28)',
  },
  night: {
    name: 'Floodlit',
    sky: ['#060b1c', '#1d2b55'],
    ground: '#1f5e33',
    line: 'rgba(255,255,255,0.35)',
  },
}
type Phase = 'ready' | 'playing' | 'paused' | 'over'
type Burst = { x: number; y: number; t: number; points: number }

export function KeepyDemo() {
  const [saved, setSaved] = useState<Saved>(load)
  const [phase, setPhase] = useState<Phase>('ready')
  const [score, setScore] = useState(0)
  const [balls, setBalls] = useState(1)
  const [line, setLine] = useState(
    'Tap the ball as it comes down to kick it back up. Don’t let it touch the ground.',
  )
  const world = useRef<World>(newWorld(saved.ball, saved.breeze, 1))
  const phaseRef = useRef(phase)
  phaseRef.current = phase
  const savedRef = useRef(saved)
  savedRef.current = saved
  const bursts = useRef<Burst[]>([])
  const lean = useRef({ left: false, right: false })
  const misses = useRef<{ x: number; y: number; t: number }[]>([])
  useEffect(() => {
    try {
      localStorage.setItem(KEEPY_KEY, JSON.stringify(saved))
    } catch {
      /* private mode: kept for this visit */
    }
  }, [saved])

  const best = saved.best[saved.ball][saved.breeze ? 'breezy' : 'calm']
  const fresh = (kind: BallKind = saved.ball, breeze = saved.breeze) => {
    world.current = newWorld(kind, breeze, (Math.random() * 2 ** 31) >>> 0)
    bursts.current = []
    setScore(0)
    setBalls(1)
    setPhase('ready')
    setLine('Ready — tap the ball, press Space, or press Start, and it drops.')
  }
  const start = () => {
    if (phaseRef.current === 'over') fresh()
    setPhase('playing')
    setLine('Kick it as it comes down. A kick above the dashed line at the top scores double.')
  }
  /** the ball is down: the score, and the best kept */
  const finish = (w: World) => {
    setPhase('over')
    const s = savedRef.current
    const key = s.breeze ? 'breezy' : 'calm'
    const old = s.best[s.ball][key]
    setSaved({
      ...s,
      played: s.played + 1,
      best: { ...s.best, [s.ball]: { ...s.best[s.ball], [key]: Math.max(old, w.score) } },
    })
    setLine(
      w.score > old
        ? `🏆 Down — but ${w.score} points is your best with the ${BALL_NAMES[s.ball].split(' ').slice(1).join(' ').toLowerCase()}${s.breeze ? ' in the breeze' : ''}!`
        : `The ball’s down: ${w.score} points, in ${w.kicks} kicks. Your best is ${old}.`,
    )
  }
  const finishRef = useRef(finish)
  finishRef.current = finish

  const kicked = (k: Kick) => {
    if (!k) return false
    world.current = k.world
    const b = k.world.balls[k.ball]
    if (!reduced()) bursts.current.push({ x: b.x, y: b.y, t: performance.now(), points: k.points })
    setScore(k.world.score)
    if (k.world.balls.length !== balls) {
      setBalls(k.world.balls.length)
      setLine(`Another ball! ${k.world.balls.length} in the air now.`)
    }
    return true
  }

  const toWorld = (e: PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const s = r.width / W
    return { x: (e.clientX - r.left) / s, y: H - (e.clientY - r.top) / s }
  }
  const onDown = (e: PointerEvent<HTMLCanvasElement>) => {
    const at = toWorld(e)
    if (phase === 'ready' || phase === 'over') {
      start()
      return
    }
    if (phase !== 'playing') return
    if (!kicked(tap(world.current, at)) && !reduced())
      misses.current.push({ ...at, t: performance.now() })
  }
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowLeft') lean.current.left = true
    else if (e.key === 'ArrowRight') lean.current.right = true
    else if (e.key === ' ' || e.key === 'Enter') {
      if (e.repeat) {
        /* a held key kicks once */
      } else if (phase === 'playing')
        kicked(
          kickLowest(world.current, (lean.current.right ? 1 : 0) - (lean.current.left ? 1 : 0)),
        )
      else if (phase === 'paused') setPhase('playing')
      else start()
    } else if (e.key === 'p' || e.key === 'P') {
      if (phase === 'playing') setPhase('paused')
      else if (phase === 'paused') setPhase('playing')
    } else return
    e.preventDefault()
    e.stopPropagation()
  }
  const onKeyUp = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowLeft') lean.current.left = false
    else if (e.key === 'ArrowRight') lean.current.right = false
  }

  return (
    <div className={`lab-keys kp-room is-${saved.field}`}>
      <div className="lab-controls">
        <div className="lab-group" role="group" aria-label="Which ball">
          {BALLS.map((k) => (
            <button
              key={k}
              className="btn btn-ghost"
              aria-pressed={saved.ball === k}
              onClick={() => {
                setSaved((s) => ({ ...s, ball: k }))
                fresh(k)
              }}
            >
              {BALL_NAMES[k]}
            </button>
          ))}
        </div>
        <button
          className="btn btn-ghost"
          aria-pressed={saved.breeze}
          onClick={() => {
            setSaved((s) => ({ ...s, breeze: !s.breeze }))
            fresh(saved.ball, !saved.breeze)
          }}
        >
          🍃 Breeze
        </button>
      </div>
      <div className="dice-scores">
        <div className="dice-score is-up">
          <span>Score</span>
          <strong>{score}</strong>
          <span className="muted">
            {balls} ball{balls === 1 ? '' : 's'} up
          </span>
        </div>
        <div className="dice-score">
          <span>Best</span>
          <strong>{best || '—'}</strong>
          <span className="muted">
            {BALL_NAMES[saved.ball].split(' ').slice(1).join(' ').toLowerCase()}
            {saved.breeze ? ', breezy' : ''}
          </span>
        </div>
      </div>
      <p className="mc-line" aria-live="polite">
        {line}
      </p>

      <div
        className="kp-wrap"
        tabIndex={0}
        role="group"
        aria-label="The field. Tap a ball as it falls to kick it up; where you tap steers it. Keys: Space kicks the lowest ball inside the kick zone at the bottom, hold left or right to lean the kick, P pauses."
        onKeyDown={onKey}
        onKeyUp={onKeyUp}
        onBlur={() => {
          lean.current = { left: false, right: false }
          if (phaseRef.current === 'playing') setPhase('paused')
        }}
      >
        <CanvasStage
          className="kp-stage"
          label={`Keepy-up: ${score} points, ${balls} ball${balls === 1 ? '' : 's'}. ${line}`}
          onPointerDown={onDown}
          make={(ctx, c) => ({
            frame: (dt) => {
              const ph = phaseRef.current
              let w = world.current
              // once down, the world stands still until React has caught up with the phase
              if (ph === 'playing' && !w.over) {
                // small steps, so a fast ball meets its wall and its neighbours properly
                const n = Math.max(1, Math.ceil(dt / (1 / 240)))
                for (let i = 0; i < n && !w.over; i++) w = step(w, dt / n)
                world.current = w
                if (w.over) finishRef.current(w)
              }
              const sv = savedRef.current
              const L = FIELD_LOOK[sv.field]
              const cw = c.width
              const ch = c.height
              const s = cw / W
              const X = (x: number) => x * s
              const Y = (y: number) => ch - y * s
              ctx.setTransform(1, 0, 0, 1, 0, 0)
              const sky = ctx.createLinearGradient(0, 0, 0, ch)
              sky.addColorStop(0, L.sky[0])
              sky.addColorStop(1, L.sky[1])
              ctx.fillStyle = sky
              ctx.fillRect(0, 0, cw, ch)
              ctx.fillStyle = L.ground
              ctx.fillRect(0, Y(0.04), cw, ch)
              // the double-points line and the keyboard's kick zone
              ctx.strokeStyle = L.line
              ctx.lineWidth = Math.max(1, s * 0.004)
              ctx.setLineDash([s * 0.02, s * 0.02])
              ctx.beginPath()
              ctx.moveTo(0, Y(HIGH))
              ctx.lineTo(cw, Y(HIGH))
              ctx.moveTo(0, Y(ZONE))
              ctx.lineTo(cw, Y(ZONE))
              ctx.stroke()
              ctx.setLineDash([])
              ctx.fillStyle = L.line
              ctx.font = `${Math.round(s * 0.035)}px system-ui, sans-serif`
              ctx.textBaseline = 'bottom'
              ctx.fillText('×2', s * 0.015, Y(HIGH) - s * 0.006)
              ctx.fillText('kick zone (Space)', s * 0.015, Y(ZONE) - s * 0.006)
              // the balls
              const still = reduced()
              for (const b of w.balls)
                drawBall(ctx, sv.ball, X(b.x), Y(b.y), R * s, still ? 0 : b.spin)
              // where kicks landed, and taps that missed
              const now = performance.now()
              bursts.current = bursts.current.filter((k) => now - k.t < 450)
              for (const k of bursts.current) {
                const a = (now - k.t) / 450
                ctx.strokeStyle = `rgba(255,255,255,${1 - a})`
                ctx.lineWidth = Math.max(2, s * 0.006)
                ctx.beginPath()
                ctx.arc(X(k.x), Y(k.y), R * s * (1 + a * 1.6), 0, Math.PI * 2)
                ctx.stroke()
                if (k.points > 1) {
                  ctx.fillStyle = `rgba(255,215,0,${1 - a})`
                  ctx.font = `bold ${Math.round(s * 0.05)}px system-ui, sans-serif`
                  ctx.fillText('×2', X(k.x) + R * s * 1.4, Y(k.y) - a * s * 0.05)
                }
              }
              misses.current = misses.current.filter((m) => now - m.t < 300)
              for (const m of misses.current) {
                ctx.strokeStyle = `rgba(0,0,0,${0.35 * (1 - (now - m.t) / 300)})`
                ctx.lineWidth = Math.max(1, s * 0.004)
                ctx.beginPath()
                ctx.arc(X(m.x), Y(m.y), R * s * 0.6, 0, Math.PI * 2)
                ctx.stroke()
              }
              if (ph !== 'playing') {
                ctx.fillStyle = 'rgba(0,0,0,0.38)'
                ctx.fillRect(0, ch * 0.42, cw, s * 0.12)
                ctx.fillStyle = '#fff'
                ctx.textAlign = 'center'
                ctx.textBaseline = 'middle'
                ctx.font = `bold ${Math.round(s * 0.055)}px system-ui, sans-serif`
                ctx.fillText(
                  ph === 'paused' ? 'Paused' : ph === 'over' ? 'Tap to go again' : 'Tap to start',
                  cw / 2,
                  ch * 0.42 + s * 0.06,
                )
                ctx.textAlign = 'start'
              }
            },
          })}
        />
      </div>
      <div className="lab-controls">
        {phase === 'playing' ? (
          <button className="btn btn-ghost" onClick={() => setPhase('paused')}>
            Pause
          </button>
        ) : (
          <button
            className="btn"
            onClick={() => (phase === 'paused' ? setPhase('playing') : start())}
          >
            {phase === 'paused' ? '▶ Carry on' : phase === 'over' ? '↻ Again' : '▶ Start'}
          </button>
        )}
      </div>

      <p className="sun-reading">
        <span className="muted">
          Games played: {saved.played} · another ball joins at {JOINS.join(' and ')} kicks
        </span>
      </p>
      <div className="fw-panel">
        <section aria-label="Look">
          <h3 className="fw-h">Field</h3>
          <div className="lab-controls" role="group" aria-label="Which field">
            {FIELDS.map((f) => (
              <button
                key={f}
                className="btn btn-ghost"
                aria-pressed={saved.field === f}
                onClick={() => setSaved((s) => ({ ...s, field: f }))}
              >
                {FIELD_LOOK[f].name}
              </button>
            ))}
          </div>
        </section>
      </div>
      <p className="muted lab-hint">
        Tap a ball as it comes down and it is kicked back up — tap its left side and it goes right,
        its right side and it goes left. A ball can only be kicked on its way down. Every kick
        scores a point, and a kick above the dashed line at the top scores two. Another ball joins
        at 15 kicks and a third at 40, and the game ends the moment any ball touches the ground. The
        balloon floats down slowly; the football drops fast. The breeze wanders from side to side
        and pushes a light ball most. With the keyboard, Space kicks the lowest ball inside the kick
        zone; hold left or right to lean the kick, and P pauses.
      </p>
    </div>
  )
}

function drawBall(
  ctx: CanvasRenderingContext2D,
  kind: BallKind,
  x: number,
  y: number,
  r: number,
  spin: number,
) {
  ctx.save()
  ctx.translate(x, y)
  if (kind === 'balloon') {
    // a balloon on its short string, which does not spin
    ctx.strokeStyle = 'rgba(0,0,0,0.45)'
    ctx.lineWidth = Math.max(1, r * 0.06)
    ctx.beginPath()
    ctx.moveTo(0, r * 1.1)
    ctx.quadraticCurveTo(r * 0.3, r * 1.6, 0, r * 2.1)
    ctx.stroke()
    ctx.fillStyle = '#e8384f'
    ctx.beginPath()
    ctx.ellipse(0, 0, r * 0.92, r * 1.08, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#b5192f'
    ctx.beginPath()
    ctx.moveTo(-r * 0.15, r * 1.12)
    ctx.lineTo(r * 0.15, r * 1.12)
    ctx.lineTo(0, r * 0.98)
    ctx.fill()
  } else if (kind === 'beach') {
    ctx.rotate(spin)
    const colours = ['#ff4d4d', '#ffffff', '#ffd23f', '#ffffff', '#3fa7ff', '#ffffff']
    colours.forEach((col, i) => {
      ctx.fillStyle = col
      ctx.beginPath()
      ctx.moveTo(0, 0)
      ctx.arc(0, 0, r, (i / 6) * Math.PI * 2, ((i + 1) / 6) * Math.PI * 2)
      ctx.fill()
    })
    ctx.fillStyle = '#fff'
    ctx.beginPath()
    ctx.arc(0, 0, r * 0.2, 0, Math.PI * 2)
    ctx.fill()
  } else {
    ctx.rotate(spin)
    ctx.fillStyle = '#fafafa'
    ctx.beginPath()
    ctx.arc(0, 0, r, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#1d1d1d'
    const patch = (px: number, py: number, pr: number) => {
      ctx.beginPath()
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2 - Math.PI / 2
        ctx.lineTo(px + Math.cos(a) * pr, py + Math.sin(a) * pr)
      }
      ctx.fill()
    }
    patch(0, 0, r * 0.32)
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2 + Math.PI / 2
      patch(Math.cos(a) * r * 0.82, Math.sin(a) * r * 0.82, r * 0.22)
    }
  }
  ctx.restore()
  ctx.strokeStyle = 'rgba(0,0,0,0.35)'
  ctx.lineWidth = Math.max(1, r * 0.06)
  ctx.beginPath()
  if (kind === 'balloon') ctx.ellipse(x, y, r * 0.92, r * 1.08, 0, 0, Math.PI * 2)
  else ctx.arc(x, y, r, 0, Math.PI * 2)
  ctx.stroke()
}
