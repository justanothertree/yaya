import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { sharedCtx } from '../audio/context'
import { CanvasStage } from './CanvasStage'
import {
  CORNER_R,
  GOAL_W,
  HOCKEY_KEY,
  LEVELS,
  MATCH,
  PADDLE_COLOURS,
  PADDLE_R,
  PUCK_R,
  SKILL,
  TABLES,
  TABLE_H,
  TABLE_W,
  YOUR_SPEED,
  advance,
  brain,
  clampToHalf,
  newTable,
  readSaved,
  recordMatch,
  type Event,
  type Level,
  type Saved,
  type Side,
  type Table,
  type Vec,
} from './hockey'
import { motionReduced as reduced } from '../ui/motion'

type Phase = 'ready' | 'play' | 'paused' | 'over'

const load = (): Saved => {
  try {
    return readSaved(localStorage.getItem(HOCKEY_KEY))
  } catch {
    return readSaved(null)
  }
}

const LEVEL_NAMES: Record<Level, string> = { rookie: 'Rookie', club: 'Club', pro: 'Pro' }
const TABLE_NAMES: Record<Saved['table'], string> = {
  arcade: 'Arcade',
  classic: 'Classic',
  ice: 'Ice',
}
const COLOUR_NAMES = ['Pink', 'Cyan', 'Yellow', 'Green', 'Violet', 'Orange']
type Look = { felt: string; line: string; line2: string; edge: string; puck: string; glow: boolean }
const LOOKS: Record<Saved['table'], Look> = {
  arcade: {
    felt: '#0b1530',
    line: '#21d4fd',
    line2: '#ff3d7f',
    edge: '#1d2a55',
    puck: '#f5f7ff',
    glow: true,
  },
  classic: {
    felt: '#f4f6f8',
    line: '#d7263d',
    line2: '#1b4fd8',
    edge: '#2b2f36',
    puck: '#16181d',
    glow: false,
  },
  ice: {
    felt: '#e4f1fb',
    line: '#c0392b',
    line2: '#2e86de',
    edge: '#7f9bb3',
    puck: '#1c2733',
    glow: false,
  },
}

/* ---------------------------------------------------------------------------- sound */

function blip(freq: number, length: number, volume: number, type: OscillatorType = 'triangle') {
  try {
    const ctx = sharedCtx()
    const at = ctx.currentTime
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = type
    osc.frequency.setValueAtTime(freq, at)
    osc.frequency.exponentialRampToValueAtTime(freq * 0.6, at + length)
    gain.gain.setValueAtTime(volume, at)
    gain.gain.exponentialRampToValueAtTime(0.0001, at + length)
    osc.connect(gain).connect(ctx.destination)
    osc.start(at)
    osc.stop(at + length + 0.02)
    // a finished voice lets go of its nodes; the shared context itself is never closed
    osc.onended = () => {
      osc.disconnect()
      gain.disconnect()
    }
  } catch {
    /* no audio here: the game plays on in silence */
  }
}
function soundOf(events: Event[]) {
  const hit = events.find((e) => e.kind === 'paddle')
  const goal = events.find((e) => e.kind === 'goal')
  const wall = events.find((e) => e.kind === 'wall')
  if (goal) {
    blip(goal.scorer === 0 ? 660 : 330, 0.35, 0.12, 'square')
    blip(goal.scorer === 0 ? 990 : 247, 0.5, 0.08, 'triangle')
  } else if (hit && hit.kind === 'paddle') blip(260 + hit.speed * 120, 0.09, 0.14)
  else if (wall && wall.kind === 'wall' && wall.speed > 0.4) blip(180, 0.05, 0.05, 'sine')
}

/* ---------------------------------------------------------------------------- drawing */

type View = { s: number; ox: number; oy: number }
function fit(w: number, h: number): View {
  const pad = Math.min(w, h) * 0.03
  const s = Math.min((w - pad * 2) / TABLE_W, (h - pad * 2) / TABLE_H)
  return { s, ox: (w - TABLE_W * s) / 2, oy: (h - TABLE_H * s) / 2 }
}

type Scene = {
  t: Table
  look: Look
  mine: string
  theirs: string
  trail: Vec[]
  flash: number
  phase: Phase
  line: string
}
function draw(ctx: CanvasRenderingContext2D, w: number, h: number, sc: Scene) {
  const v = fit(w, h)
  const X = (x: number) => v.ox + x * v.s
  const Y = (y: number) => v.oy + y * v.s
  const { look, t } = sc
  ctx.fillStyle = look.edge
  ctx.fillRect(0, 0, w, h)
  // the felt, with its rounded corners
  const r = CORNER_R * v.s
  ctx.fillStyle = look.felt
  ctx.beginPath()
  ctx.roundRect(X(0), Y(0), TABLE_W * v.s, TABLE_H * v.s, r)
  ctx.fill()
  if (sc.flash > 0) {
    ctx.fillStyle = `rgba(255, 220, 80, ${sc.flash * 0.25})`
    ctx.fill()
  }
  ctx.save()
  ctx.clip()
  const lw = Math.max(1.5, v.s * 0.006)
  if (look.glow) {
    ctx.shadowBlur = v.s * 0.03
  }
  // the centre line and circle, and a crease in front of each goal
  ctx.lineWidth = lw
  ctx.strokeStyle = look.line
  ctx.shadowColor = look.line
  ctx.beginPath()
  ctx.moveTo(X(0), Y(TABLE_H / 2))
  ctx.lineTo(X(TABLE_W), Y(TABLE_H / 2))
  ctx.stroke()
  ctx.beginPath()
  ctx.arc(X(0.5), Y(TABLE_H / 2), 0.14 * v.s, 0, Math.PI * 2)
  ctx.stroke()
  ctx.strokeStyle = look.line2
  ctx.shadowColor = look.line2
  for (const [y, dir] of [
    [0, 1],
    [TABLE_H, -1],
  ] as const) {
    ctx.beginPath()
    ctx.arc(
      X(0.5),
      Y(y),
      (GOAL_W / 2 + 0.04) * v.s,
      dir > 0 ? 0 : Math.PI,
      dir > 0 ? Math.PI : Math.PI * 2,
    )
    ctx.stroke()
  }
  ctx.shadowBlur = 0
  ctx.restore()
  // the goal mouths, cut into each end
  ctx.fillStyle = '#05070c'
  const gw = GOAL_W * v.s
  ctx.fillRect(X(0.5) - gw / 2, Y(0) - v.s * 0.025, gw, v.s * 0.03)
  ctx.fillRect(X(0.5) - gw / 2, Y(TABLE_H) - v.s * 0.005, gw, v.s * 0.03)

  // the puck's trail, then the puck
  sc.trail.forEach((p, i) => {
    ctx.fillStyle = look.glow ? 'rgba(245, 247, 255, 0.5)' : 'rgba(20, 24, 30, 0.35)'
    ctx.globalAlpha = ((i + 1) / sc.trail.length) * 0.35
    ctx.beginPath()
    ctx.arc(
      X(p.x),
      Y(p.y),
      PUCK_R * v.s * (0.5 + (0.5 * (i + 1)) / sc.trail.length),
      0,
      Math.PI * 2,
    )
    ctx.fill()
  })
  ctx.globalAlpha = 1
  const disc = (p: Vec, rad: number, fill: string, ring: string | null) => {
    if (look.glow) {
      ctx.shadowColor = fill
      ctx.shadowBlur = v.s * 0.04
    }
    ctx.fillStyle = fill
    ctx.beginPath()
    ctx.arc(X(p.x), Y(p.y), rad * v.s, 0, Math.PI * 2)
    ctx.fill()
    ctx.shadowBlur = 0
    if (ring) {
      ctx.strokeStyle = ring
      ctx.lineWidth = Math.max(2, rad * v.s * 0.22)
      ctx.beginPath()
      ctx.arc(X(p.x), Y(p.y), rad * v.s * 0.55, 0, Math.PI * 2)
      ctx.stroke()
    }
  }
  disc(t.puck, PUCK_R, look.puck, null)
  disc(t.paddles[1], PADDLE_R, sc.theirs, 'rgba(0,0,0,0.25)')
  disc(t.paddles[0], PADDLE_R, sc.mine, 'rgba(0,0,0,0.25)')

  if (sc.phase !== 'play' && sc.line) {
    ctx.fillStyle = 'rgba(0, 0, 0, 0.55)'
    const bh = Math.max(44, v.s * 0.16)
    ctx.fillRect(0, h / 2 - bh / 2, w, bh)
    ctx.fillStyle = '#fff'
    ctx.font = `700 ${Math.round(Math.max(15, Math.min(26, v.s * 0.055)))}px system-ui, sans-serif`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(sc.line, w / 2, h / 2, w - 24)
  }
  return v
}

/* ---------------------------------------------------------------------------- the room */

export function HockeyDemo() {
  const [saved, setSaved] = useState<Saved>(load)
  const [phase, setPhase] = useState<Phase>('ready')
  const [score, setScore] = useState<[number, number]>([0, 0])
  const [said, setSaid] = useState('')
  /** the match in progress: its table, the computer, and the level and length it began with */
  const game = useRef({
    t: newTable(0),
    cpu: brain(1, saved.level, Math.random),
    level: saved.level,
    to: saved.to,
    server: 0 as Side,
    /** seconds of play so far, pauses left out */
    played: 0,
  })
  const want = useRef<Vec>({ x: 0.5, y: TABLE_H - 0.16 })
  const keys = useRef(new Set<string>())
  const phaseRef = useRef(phase)
  phaseRef.current = phase
  const savedRef = useRef(saved)
  savedRef.current = saved
  const view = useRef<View | null>(null)

  useEffect(() => {
    try {
      localStorage.setItem(HOCKEY_KEY, JSON.stringify(saved))
    } catch {
      /* private mode: kept for this visit */
    }
  }, [saved])
  // a hidden tab pauses the match, so nobody comes back to a lost game
  useEffect(() => {
    const hide = () => {
      if (document.hidden && phaseRef.current === 'play') setPhase('paused')
    }
    document.addEventListener('visibilitychange', hide)
    return () => document.removeEventListener('visibilitychange', hide)
  }, [])

  const fresh = (level = saved.level, to = saved.to) => {
    const server: Side = game.current.server === 0 ? 1 : 0
    game.current = {
      t: newTable(server),
      cpu: brain(1, level, Math.random),
      level,
      to,
      server,
      played: 0,
    }
    want.current = { x: 0.5, y: TABLE_H - 0.16 }
    setScore([0, 0])
    setSaid('')
    setPhase('ready')
  }
  const go = () => {
    if (phase === 'over') {
      fresh()
      return
    }
    if (savedRef.current.sound) void sharedCtx().resume()
    setPhase((p) => (p === 'play' ? 'paused' : 'play'))
  }

  const onGoal = (scorer: Side, t: Table) => {
    const sc: [number, number] = [t.score[0], t.score[1]]
    setScore(sc)
    const g = game.current
    if (Math.max(...sc) >= g.to) {
      setPhase('over')
      setSaved((s) => ({
        ...s,
        record: {
          ...s.record,
          [g.level]: recordMatch(s.record[g.level], sc[0], sc[1], g.played),
        },
      }))
      setSaid(
        sc[0] > sc[1]
          ? `🏆 You win the match, ${sc[0]} to ${sc[1]}!`
          : `The computer wins the match, ${sc[1]} to ${sc[0]}.`,
      )
    } else
      setSaid(
        `${scorer === 0 ? 'Goal! ' : 'The computer scores. '}You ${sc[0]}, computer ${sc[1]}.`,
      )
  }

  const toTable = (e: PointerEvent<HTMLCanvasElement>): Vec | null => {
    const c = e.currentTarget
    const v = view.current
    if (!v) return null
    const r = c.getBoundingClientRect()
    const px = ((e.clientX - r.left) / r.width) * c.width
    const py = ((e.clientY - r.top) / r.height) * c.height
    return { x: (px - v.ox) / v.s, y: (py - v.oy) / v.s }
  }
  const onPointer = (e: PointerEvent<HTMLCanvasElement>) => {
    if (e.pointerType !== 'mouse' && e.type === 'pointermove' && e.buttons === 0) return
    const p = toTable(e)
    if (p) want.current = clampToHalf(0, p)
  }

  const onKey = (e: KeyboardEvent<HTMLDivElement>, down: boolean) => {
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'w', 'a', 's', 'd'].includes(k)) {
      e.preventDefault()
      e.stopPropagation()
      if (down) keys.current.add(k)
      else keys.current.delete(k)
      return
    }
    if (!down) return
    if (k === ' ' || k === 'Enter') {
      e.preventDefault()
      go()
    } else if (k === 'Escape' && phase === 'play') setPhase('paused')
  }

  const setLevel = (l: Level) => {
    setSaved((s) => ({ ...s, level: l }))
    if (phase !== 'play' && phase !== 'paused') fresh(l, saved.to)
    else if (score[0] + score[1] === 0) fresh(l, saved.to)
  }
  const setTo = (n: Saved['to']) => {
    setSaved((s) => ({ ...s, to: n }))
    if (score[0] + score[1] === 0 || phase === 'over') fresh(saved.level, n)
  }

  const g = game.current
  const record = saved.record[saved.level]
  const pending = g.level !== saved.level || g.to !== saved.to

  return (
    <div className="lab-keys hk-room">
      <div className="lab-controls">
        <div className="lab-group" role="group" aria-label="How well the computer plays">
          {LEVELS.map((l) => (
            <button
              key={l}
              className="btn btn-ghost"
              aria-pressed={saved.level === l}
              onClick={() => setLevel(l)}
            >
              {LEVEL_NAMES[l]}
            </button>
          ))}
        </div>
        <div className="lab-group" role="group" aria-label="First to">
          {MATCH.map((n) => (
            <button
              key={n}
              className="btn btn-ghost"
              aria-pressed={saved.to === n}
              aria-label={`First to ${n}`}
              onClick={() => setTo(n)}
            >
              To {n}
            </button>
          ))}
        </div>
        <button className="btn" onClick={go}>
          {phase === 'play' ? '⏸ Pause' : phase === 'over' ? '↻ Play again' : '▶ Play'}
        </button>
        <button className="btn btn-ghost" onClick={() => fresh()}>
          New match
        </button>
      </div>

      <div className="dice-scores">
        <div className="dice-score">
          <span>You</span>
          <strong>{score[0]}</strong>
        </div>
        <div className="dice-score">
          <span>The computer · {LEVEL_NAMES[g.level]}</span>
          <strong>{score[1]}</strong>
        </div>
      </div>

      <div
        className={`hk-wrap${phase === 'play' ? ' is-playing' : ''}`}
        tabIndex={0}
        role="group"
        aria-label="The table. Move your paddle with the mouse, a finger, or the arrow keys; Space plays and pauses."
        onKeyDown={(e) => onKey(e, true)}
        onKeyUp={(e) => onKey(e, false)}
        onBlur={() => keys.current.clear()}
      >
        <CanvasStage
          className="hk-stage"
          label={`An air hockey table. You ${score[0]}, the computer ${score[1]}, first to ${g.to}.`}
          onPointerDown={(e) => {
            onPointer(e)
            if (phaseRef.current !== 'play') go()
          }}
          onPointerMove={onPointer}
          make={(ctx, c) => {
            const trail: Vec[] = []
            let flash = 0
            let last = ''
            return {
              frame: (dt) => {
                const s = savedRef.current
                const gm = game.current
                const ph = phaseRef.current
                const still = reduced()
                if (ph === 'play' && dt > 0) {
                  gm.played += dt
                  // the keys move where you want the paddle, at a steady pace
                  const k = keys.current
                  if (k.size) {
                    const dx =
                      (k.has('ArrowRight') || k.has('d') ? 1 : 0) -
                      (k.has('ArrowLeft') || k.has('a') ? 1 : 0)
                    const dy =
                      (k.has('ArrowDown') || k.has('s') ? 1 : 0) -
                      (k.has('ArrowUp') || k.has('w') ? 1 : 0)
                    const p = gm.t.paddles[0]
                    const n = Math.hypot(dx, dy) || 1
                    // a steady 3.6 table units a second: quick enough to strike, slow enough to steer
                    want.current = clampToHalf(0, {
                      x: p.x + (dx / n) * 3.6 * dt,
                      y: p.y + (dy / n) * 3.6 * dt,
                    })
                  }
                  const cpuWant = gm.cpu(gm.t, dt)
                  const { events } = advance(
                    gm.t,
                    dt,
                    [want.current, cpuWant],
                    [YOUR_SPEED, SKILL[gm.level].speed],
                  )
                  if (s.sound && events.length) soundOf(events)
                  const goal = events.find((e) => e.kind === 'goal')
                  if (goal && goal.kind === 'goal') {
                    if (!still) flash = 1
                    trail.length = 0
                    onGoal(goal.scorer, gm.t)
                  }
                  if (s.trail && !still) {
                    trail.push({ x: gm.t.puck.x, y: gm.t.puck.y })
                    if (trail.length > 10) trail.shift()
                  } else trail.length = 0
                  flash = Math.max(0, flash - dt * 2)
                }
                // held still, a frame is drawn only when something in it changed
                const key = `${c.width}x${c.height}|${ph}|${s.table}|${s.colour}|${gm.t.puck.x},${gm.t.puck.y},${gm.t.paddles[0].x},${gm.t.paddles[0].y},${gm.t.paddles[1].x},${gm.t.paddles[1].y}|${flash > 0}`
                if (key === last && ph !== 'play') return
                last = key
                view.current = draw(ctx, c.width, c.height, {
                  t: gm.t,
                  look: LOOKS[s.table],
                  mine: PADDLE_COLOURS[s.colour],
                  theirs: PADDLE_COLOURS[(s.colour + 3) % PADDLE_COLOURS.length],
                  trail,
                  flash,
                  phase: ph,
                  line: phaseLine(ph, gm.t),
                })
              },
            }
          }}
        />
      </div>
      <p className="mc-line" aria-live="polite">
        {said || (phase === 'ready' ? 'Your serve is waiting on your side of the table.' : '')}
      </p>
      <p className="sun-reading">
        <span className="muted">
          Against {LEVEL_NAMES[saved.level]}: won {record.won}, lost {record.lost}
          {record.bestStreak > 1 && <> · best run {record.bestStreak} in a row</>}
          {record.streak > 1 && <> · on a run of {record.streak}</>}
          {record.best > 0 && <> · widest win by {record.best}</>}
          {record.fastest > 0 && <> · fastest win {record.fastest} s</>}
        </span>
      </p>
      {pending && phase !== 'over' && (
        <p className="muted mc-note">Your changes start with the next match.</p>
      )}

      <div className="fw-panel">
        <section aria-label="The table">
          <h3 className="fw-h">The table</h3>
          <div className="lab-controls" role="group" aria-label="Table">
            {TABLES.map((tb) => (
              <button
                key={tb}
                className="btn btn-ghost"
                aria-pressed={saved.table === tb}
                onClick={() => setSaved((s) => ({ ...s, table: tb }))}
              >
                {TABLE_NAMES[tb]}
              </button>
            ))}
          </div>
          <div className="lab-controls">
            <button
              className="btn btn-ghost"
              aria-pressed={saved.trail}
              onClick={() => setSaved((s) => ({ ...s, trail: !s.trail }))}
            >
              Puck trail
            </button>
            <button
              className="btn btn-ghost"
              aria-pressed={saved.sound}
              onClick={() => setSaved((s) => ({ ...s, sound: !s.sound }))}
            >
              Sound
            </button>
          </div>
        </section>
        <section aria-label="Your paddle">
          <h3 className="fw-h">Your paddle</h3>
          <div className="fw-swatches" role="group" aria-label="Paddle colour">
            {PADDLE_COLOURS.map((c, i) => (
              <button
                key={c}
                className="fw-swatch"
                style={{ background: c }}
                aria-label={`${COLOUR_NAMES[i]} paddle`}
                aria-pressed={saved.colour === i}
                onClick={() => setSaved((s) => ({ ...s, colour: i }))}
              />
            ))}
          </div>
          <p className="muted mc-note">
            The computer plays in the colour across the wheel from yours.
          </p>
        </section>
      </div>
      <p className="muted lab-hint">
        Your paddle follows the mouse, or your finger on the table; the arrow keys or WASD move it
        too. Keep to your half, hit the puck into the slot at the far end, and keep it out of yours.
        Rookie is slow and reads the puck late; Club is quicker and goes for the corners; Pro is
        fast, reads every bank and plays shots off the side walls. The corners are rounded, as a
        real table’s are, so a puck pinned in one slips out.
      </p>
    </div>
  )
}

function phaseLine(ph: Phase, t: Table) {
  if (ph === 'ready') return 'Tap or press Space to face off'
  if (ph === 'paused') return 'Paused — tap or press Space'
  if (ph === 'over')
    return `${t.score[0] > t.score[1] ? 'You win' : 'The computer wins'} ${t.score[0]}–${t.score[1]} · tap for another`
  return ''
}
