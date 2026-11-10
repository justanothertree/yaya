import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { CanvasStage } from './CanvasStage'
import {
  BALL_R,
  BOWLING_KEY,
  HEAD_PIN,
  LANE_HALF,
  LANES,
  LEVELS,
  OIL,
  PIT,
  bowl,
  card,
  needle,
  next,
  plan,
  rack,
  readSaved,
  score,
  strayFor,
  wobble,
  type Level,
  type Roll,
  type Saved,
  type Shot,
} from './bowling'

const load = (): Saved => {
  try {
    return readSaved(localStorage.getItem(BOWLING_KEY))
  } catch {
    return readSaved(null)
  }
}
const reduced = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
const LEVEL_NAMES: Record<Level, string> = { easy: 'Easy', fair: 'Fair', hard: 'Hard' }
const LOOK: Record<
  Saved['lane'],
  {
    name: string
    wood: [string, string]
    gutter: string
    back: string
    pin: string
    neck: string
    ball: string
    you: string
  }
> = {
  maple: {
    name: 'Maple',
    wood: ['#e9c48d', '#d9ad6f'],
    gutter: '#3b3f46',
    back: '#14161a',
    pin: '#fbfbf7',
    neck: '#d1312b',
    ball: '#2a5bd7',
    you: '#ffd34d',
  },
  neon: {
    name: 'Neon',
    wood: ['#1d2a4a', '#152038'],
    gutter: '#0a0f1e',
    back: '#05060d',
    pin: '#e8fbff',
    neck: '#ff3d81',
    ball: '#2ef2c7',
    you: '#ff3d81',
  },
  retro: {
    name: 'Retro',
    wood: ['#f2dfb4', '#e6cd96'],
    gutter: '#6b2a2a',
    back: '#2a1a12',
    pin: '#fff8ea',
    neck: '#2f7d6a',
    ball: '#c2410c',
    you: '#2f7d6a',
  },
}
const ALL = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
const ARROWS = 4.6
const HOOKS = [
  { v: 0, name: 'Straight' },
  { v: 0.5, name: 'Some hook' },
  { v: 1, name: 'Big hook' },
]
const SPEEDS = [
  { v: 6.6, name: 'Gentle' },
  { v: 7.6, name: 'Medium' },
  { v: 8.6, name: 'Fast' },
]
/** the 39 boards across a lane, counted from the right for a right-hander */
const board = (x: number) => Math.round(((LANE_HALF - x) / (LANE_HALF * 2)) * 39 + 0.5)
const mark = (rolls: number[], i: number, inFrame: number) => {
  const r = rolls[i]
  if (r === undefined) return ''
  if (r === 10 && (inFrame === 0 || rolls[i - 1] === 10 || inFrame === 2)) return 'X'
  if (inFrame > 0 && rolls[i - 1] !== 10 && rolls[i - 1] + r === 10) return '/'
  return r === 0 ? '–' : String(r)
}
type Side = 0 | 1
type Show = { roll: Roll; who: Side; t: number; after: () => void }

export function BowlingDemo() {
  const [saved, setSaved] = useState<Saved>(load)
  const [level, setLevel] = useState<Level>(saved.level)
  const [shot, setShot] = useState<Shot>(saved.stance)
  const [rolls, setRolls] = useState<[number[], number[]]>([[], []])
  const [up, setUp] = useState<Side>(0)
  const [standing, setStanding] = useState<number[]>(ALL)
  const [busy, setBusy] = useState(false)
  const [line, setLine] = useState('Set your shot below, then hold Bowl and let go in the green.')
  const shotRef = useRef(shot)
  shotRef.current = shot
  const savedRef = useRef(saved)
  savedRef.current = saved
  const standingRef = useRef(standing)
  standingRef.current = standing
  const show = useRef<Show | null>(null)
  const swing = useRef<number>(0)
  /** whether the swing was started by a key, which a blur should cancel, or by a press */
  const swingByKey = useRef(false)
  const view = useRef<{ w: number; h: number } | null>(null)
  const timers = useRef<number[]>([])
  const recorded = useRef(false)
  const [, redraw] = useState(0)
  useEffect(() => {
    try {
      localStorage.setItem(BOWLING_KEY, JSON.stringify(saved))
    } catch {
      /* private mode: kept for this visit */
    }
  }, [saved])
  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), [])
  const later = (ms: number, f: () => void) => timers.current.push(window.setTimeout(f, ms))

  const mirror = saved.left ? -1 : 1
  const over = next(rolls[0]).over && next(rolls[1]).over
  /** the frame loop is made once, so it reads whether the game is over by ref */
  const overRef = useRef(over)
  overRef.current = over

  /** play a ball's frames on the canvas, or jump to where everything lies under reduced motion */
  const animate = (roll: Roll, who: Side, after: () => void) => {
    if (reduced()) {
      show.current = {
        roll: { ...roll, frames: roll.frames.slice(-1) },
        who,
        t: 0,
        after: () => {},
      }
      later(350, () => {
        show.current = null
        after()
      })
    } else
      show.current = {
        roll,
        who,
        t: 0,
        after: () => {
          show.current = null
          after()
        },
      }
  }

  /** a ball has been bowled: score it, and say whose ball is next */
  const land = (
    who: Side,
    felled: number[],
    gutter: boolean,
    all: [number[], number[]],
    stand: number[],
  ) => {
    const mine = [...all[who], felled.length]
    const nextRolls: [number[], number[]] = who === 0 ? [mine, all[1]] : [all[0], mine]
    setRolls(nextRolls)
    const n = next(mine)
    const fresh = n.fresh
    const left = fresh ? ALL : stand.filter((p) => !felled.includes(p))
    const strike = felled.length === 10 && stand.length === 10
    const spare = !strike && left.length === 0 && stand.length < 10
    if (who === 0 && strike)
      setSaved((s) => ({
        ...s,
        record: {
          ...s.record,
          [level]: { ...s.record[level], strikes: s.record[level].strikes + 1 },
        },
      }))
    const said = gutter
      ? 'Gutter ball.'
      : strike
        ? 'STRIKE!'
        : spare
          ? 'Spare!'
          : felled.length === 0
            ? 'Nothing down.'
            : `${felled.length} down${fresh ? '' : `, ${stand.length - felled.length} standing (${stand.filter((p) => !felled.includes(p)).join(', ')})`}.`
    // the frame is over when the rack is fresh again, or the game is
    const frameOver = n.over || fresh
    if (who === 0) {
      setLine(
        `You: ${said}${frameOver && !next(nextRolls[1]).over ? ' The computer bowls…' : frameOver ? '' : ' Your next ball.'}`,
      )
      setStanding(frameOver ? ALL : left)
      if (frameOver && !next(nextRolls[1]).over) later(900, () => computerFrame(nextRolls))
      else {
        setBusy(false)
        if (n.over && next(nextRolls[1]).over) finish(nextRolls)
      }
    } else {
      setLine(`The computer: ${said}`)
      if (!frameOver) later(700, () => computerBall(nextRolls, left))
      else {
        setStanding(ALL)
        setUp(0)
        setBusy(false)
        if (next(nextRolls[0]).over) finish(nextRolls)
        else setLine((l) => `${l} Your frame.`)
      }
    }
  }
  const computerBall = (all: [number[], number[]], stand: number[]) => {
    setStanding(stand)
    standingRef.current = stand
    const s = wobble(plan(stand, level, Math.random), level, Math.random)
    const roll = bowl(stand, s, true)
    animate(roll, 1, () => land(1, roll.felled, roll.gutter, all, stand))
  }
  const computerFrame = (all: [number[], number[]]) => {
    setUp(1)
    setStanding(ALL)
    computerBall(all, ALL)
  }
  const finish = (all: [number[], number[]]) => {
    if (recorded.current) return
    recorded.current = true
    const you = score(all[0])
    const cpu = score(all[1])
    setSaved((s) => {
      const t = s.record[level]
      return {
        ...s,
        record: {
          ...s.record,
          [level]: {
            ...t,
            won: t.won + (you > cpu ? 1 : 0),
            lost: t.lost + (you < cpu ? 1 : 0),
            best: Math.max(t.best, you),
          },
        },
      }
    })
    setLine(
      `${you > cpu ? '🏆 You win' : you < cpu ? 'The computer wins' : 'A tie'}, ${you} to ${cpu}.${you > savedRef.current.record[level].best ? ' Your best game on ' + LEVEL_NAMES[level] + '!' : ''}`,
    )
  }

  /** let the ball go: the needle's place strays the line */
  const release = () => {
    if (!swing.current || busy || up !== 0 || over) return
    const t = (performance.now() - swing.current) / 1000
    swing.current = 0
    const at = needle(t)
    const s = { ...shot, hook: shot.hook * mirror, angle: shot.angle + strayFor(at) }
    setSaved((x) => ({ ...x, stance: shot }))
    setBusy(true)
    const stand = standing
    const roll = bowl(stand, s, true)
    if (Math.abs(at) > 0.6) setLine(`Let go ${at > 0 ? 'late' : 'early'} — the line strays.`)
    animate(roll, 0, () => land(0, roll.felled, roll.gutter, rolls, stand))
  }
  const startSwing = (byKey = false) => {
    if (busy || up !== 0 || over || swing.current) return
    swing.current = performance.now()
    swingByKey.current = byKey
    redraw((n) => n + 1)
  }

  const fresh = (lv: Level = saved.level) => {
    timers.current.forEach((t) => window.clearTimeout(t))
    timers.current = []
    show.current = null
    recorded.current = false
    setLevel(lv)
    setRolls([[], []])
    setStanding(ALL)
    setUp(0)
    setBusy(false)
    setLine('A new game. Your frame first.')
  }

  /* -------------------------------------------------------------------- the lane in perspective */

  const project = (w: number, h: number) => {
    // a camera well back from the foul line: a flatter view, so the pins are not specks and the
    // ball at your feet is not the size of the lane
    const D = 9
    const horizon = h * 0.06
    const K = (h * 0.97 - horizon) * D
    const F = (w * 0.66 * D) / (LANE_HALF * 2)
    const s = (y: number) => 1 / (y + D)
    return {
      X: (x: number, y: number) => w / 2 + x * F * s(y),
      Y: (y: number) => horizon + K * s(y),
      size: (r: number, y: number) => r * F * s(y),
      // back from the screen to the lane, for a tap
      toLane: (px: number, py: number) => {
        const y = K / (py - horizon) - D
        return { x: ((px - w / 2) * (y + D)) / F, y }
      },
    }
  }
  const onDown = (e: PointerEvent<HTMLCanvasElement>) => {
    if (busy || up !== 0 || over || !view.current) return
    const c = e.currentTarget
    const r = c.getBoundingClientRect()
    const k = c.width / r.width
    const P = project(c.width, c.height)
    const lane = P.toLane((e.clientX - r.left) * k, (e.clientY - r.top) * k)
    if (!Number.isFinite(lane.y)) return
    const x = Math.max(-LANE_HALF + 0.08, Math.min(LANE_HALF - 0.08, lane.x))
    if (lane.y < 2) setShot((s) => ({ ...s, x }))
    else {
      // the line from the stance through the tapped point
      const angle = Math.atan2(x - shot.x, Math.max(1, lane.y - 0.3))
      setShot((s) => ({ ...s, angle: Math.max(-0.05, Math.min(0.05, angle)) }))
    }
  }
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault()
      if (!e.repeat) startSwing(true)
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      const d = e.key === 'ArrowLeft' ? -1 : 1
      if (e.shiftKey)
        setShot((s) => ({ ...s, angle: Math.max(-0.05, Math.min(0.05, s.angle + d * 0.002)) }))
      else setShot((s) => ({ ...s, x: Math.max(-0.45, Math.min(0.45, s.x + d * 0.027)) }))
      e.preventDefault()
    } else return
    e.stopPropagation()
  }
  const onKeyUp = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault()
      release()
    }
  }

  const arrowsBoard = board(shot.x + Math.tan(shot.angle) * (ARROWS - 0.3))
  const c0 = card(rolls[0])
  const c1 = card(rolls[1])
  const rec = saved.record[saved.level]
  const untouched = rolls[0].length === 0 && rolls[1].length === 0

  return (
    <div className={`lab-keys bw-room is-${saved.lane}`}>
      <div className="lab-controls">
        <div className="lab-group" role="group" aria-label="How well the computer bowls">
          {LEVELS.map((l) => (
            <button
              key={l}
              className="btn btn-ghost"
              aria-pressed={saved.level === l}
              onClick={() => {
                setSaved((s) => ({ ...s, level: l }))
                if (untouched || over) fresh(l)
              }}
            >
              {LEVEL_NAMES[l]}
            </button>
          ))}
        </div>
        <button className="btn btn-ghost" onClick={() => fresh()}>
          ↻ New game
        </button>
      </div>

      <div className="bw-card-wrap">
        <table className="bw-card">
          <caption className="sr-only">Scorecard</caption>
          <thead>
            <tr>
              <th scope="col">
                <span className="sr-only">Who</span>
              </th>
              {Array.from({ length: 10 }, (_, f) => (
                <th key={f} scope="col">
                  {f + 1}
                </th>
              ))}
              <th scope="col">Total</th>
            </tr>
          </thead>
          <tbody>
            {([0, 1] as Side[]).map((w) => {
              const cards = w === 0 ? c0 : c1
              const rs = rolls[w]
              let i = 0
              return (
                <tr key={w} className={up === w && !over ? 'is-up' : ''}>
                  <th scope="row">{w === 0 ? 'You' : LEVEL_NAMES[level]}</th>
                  {cards.map((f, k) => {
                    const marks = f.rolls.map((_, j) => mark(rs, i + j, j))
                    i += f.rolls.length
                    return (
                      <td key={k}>
                        <span className="bw-marks">{marks.join(' ') || ' '}</span>
                        <span className="bw-total">{f.total ?? ' '}</span>
                      </td>
                    )
                  })}
                  <td className="bw-sum">{score(rs)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="mc-line" aria-live="polite">
        {line}
      </p>

      <div
        className="bw-wrap"
        tabIndex={0}
        role="group"
        aria-label="The lane. Left and right move where you stand; with Shift they turn your line. Hold Space and let go as the needle crosses the middle. Tap low on the lane to stand there, higher up to aim through that point."
        onKeyDown={onKey}
        onKeyUp={onKeyUp}
        onBlur={() => {
          // pressing the Bowl button moves focus off the lane: that must not cancel its own swing
          if (swingByKey.current) swing.current = 0
        }}
      >
        <CanvasStage
          className="bw-stage"
          label={`A bowling lane. Standing: ${standing.join(', ')}. ${line}`}
          onPointerDown={onDown}
          make={(ctx, c) => {
            let last = ''
            return {
              frame: (dt) => {
                const sh = show.current
                if (sh) {
                  sh.t += dt * 60
                  if (sh.t >= sh.roll.frames.length - 1) sh.after()
                }
                const sv = savedRef.current
                const st = shotRef.current
                const L = LOOK[sv.lane]
                const f = sh
                  ? sh.roll.frames[Math.min(sh.roll.frames.length - 1, Math.floor(sh.t))]
                  : null
                const swingT = swing.current ? (performance.now() - swing.current) / 1000 : -1
                const key = `${c.width}x${c.height}|${sv.lane}|${sv.left}|${st.x},${st.angle},${st.hook},${st.speed}|${standingRef.current.join()}|${f ? f.ball.join() + f.pins.map((p) => p.join()).join() : ''}|${swingT >= 0 ? swingT.toFixed(3) : ''}`
                if (key === last) return
                last = key
                const w = c.width
                const h = c.height
                view.current = { w, h }
                const P = project(w, h)
                ctx.setTransform(1, 0, 0, 1, 0, 0)
                ctx.fillStyle = L.back
                ctx.fillRect(0, 0, w, h)
                const quad = (x0: number, x1: number, y0: number, y1: number, fill: string) => {
                  ctx.fillStyle = fill
                  ctx.beginPath()
                  ctx.moveTo(P.X(x0, y0), P.Y(y0))
                  ctx.lineTo(P.X(x1, y0), P.Y(y0))
                  ctx.lineTo(P.X(x1, y1), P.Y(y1))
                  ctx.lineTo(P.X(x0, y1), P.Y(y1))
                  ctx.fill()
                }
                quad(-LANE_HALF - 0.12, -LANE_HALF, 0, PIT, L.gutter)
                quad(LANE_HALF, LANE_HALF + 0.12, 0, PIT, L.gutter)
                for (let b = 0; b < 13; b++) {
                  const x0 = -LANE_HALF + (b * LANE_HALF * 2) / 13
                  quad(x0, x0 + (LANE_HALF * 2) / 13, 0, PIT, L.wood[b % 2])
                }
                // the oil's end and the aiming arrows
                ctx.strokeStyle = 'rgba(0,0,0,0.12)'
                ctx.lineWidth = 1
                ctx.beginPath()
                ctx.moveTo(P.X(-LANE_HALF, OIL), P.Y(OIL))
                ctx.lineTo(P.X(LANE_HALF, OIL), P.Y(OIL))
                ctx.stroke()
                ctx.fillStyle = 'rgba(0,0,0,0.35)'
                for (let a = -3; a <= 3; a++) {
                  const ax = a * 0.135
                  const ay = ARROWS + Math.abs(a) * 0.3
                  const tip = P.size(0.05, ay)
                  ctx.beginPath()
                  ctx.moveTo(P.X(ax, ay + 0.25), P.Y(ay + 0.25))
                  ctx.lineTo(P.X(ax, ay) - tip, P.Y(ay))
                  ctx.lineTo(P.X(ax, ay) + tip, P.Y(ay))
                  ctx.fill()
                }
                // the foul line
                ctx.fillStyle = '#d1312b'
                ctx.fillRect(
                  P.X(-LANE_HALF, 0),
                  P.Y(0) - 2,
                  P.X(LANE_HALF, 0) - P.X(-LANE_HALF, 0),
                  3,
                )
                // pins, back to front so nearer ones are drawn over farther ones
                const pins = f
                  ? f.pins.map(([x, y, down], i) => ({
                      x,
                      y,
                      down,
                      n: rack(standingRef.current)[i]?.n ?? 0,
                    }))
                  : rack(standingRef.current).map((p) => ({ ...p, down: false }))
                for (const p of [...pins].sort((a, b) => b.y - a.y)) {
                  if (p.y > PIT) continue
                  const px = P.X(p.x, p.y)
                  const py = P.Y(p.y)
                  const r = Math.max(1.5, P.size(0.06, p.y))
                  const tall = r * 6
                  ctx.globalAlpha = p.down ? 0.45 : 1
                  ctx.fillStyle = L.pin
                  ctx.beginPath()
                  if (p.down) ctx.ellipse(px, py - r, tall * 0.5, r, 0.4, 0, Math.PI * 2)
                  else ctx.ellipse(px, py - tall * 0.5, r, tall * 0.5, 0, 0, Math.PI * 2)
                  ctx.fill()
                  if (!p.down) {
                    ctx.fillStyle = L.neck
                    ctx.fillRect(px - r * 0.8, py - tall * 0.78, r * 1.6, Math.max(1, r * 0.5))
                  }
                  ctx.globalAlpha = 1
                }
                // the ball, and before it goes the line it will be sent along
                const ball = f ? { x: f.ball[0], y: f.ball[1] } : { x: st.x, y: 0.3 }
                if (!f && !overRef.current) {
                  ctx.strokeStyle = 'rgba(255,255,255,0.7)'
                  ctx.setLineDash([6, 6])
                  ctx.lineWidth = 2
                  ctx.beginPath()
                  ctx.moveTo(P.X(st.x, 0.3), P.Y(0.3))
                  const yEnd = OIL
                  ctx.lineTo(P.X(st.x + Math.tan(st.angle) * (yEnd - 0.3), yEnd), P.Y(yEnd))
                  ctx.stroke()
                  ctx.setLineDash([])
                }
                if (ball.y < PIT) {
                  const br = P.size(BALL_R, ball.y)
                  ctx.fillStyle = sh?.who === 1 ? '#7a7a7a' : L.ball
                  ctx.beginPath()
                  ctx.arc(P.X(ball.x, ball.y), P.Y(ball.y) - br, br, 0, Math.PI * 2)
                  ctx.fill()
                }
                // the pin chart, top down, in the corner
                const cs = Math.min(w, h) * 0.035
                const ox = w - cs * 4.5
                const oy = cs * 1.2
                const chart = rack()
                for (const p of chart) {
                  const still = f
                    ? !pins.find((q) => q.n === p.n)?.down && pins.some((q) => q.n === p.n)
                    : standingRef.current.includes(p.n)
                  ctx.fillStyle = still ? '#fff' : 'rgba(255,255,255,0.18)'
                  ctx.beginPath()
                  ctx.arc(
                    ox + (p.x / 0.3048) * cs * 1.1,
                    oy + ((HEAD_PIN + 0.8 - p.y) / 0.264) * cs * 0.95,
                    cs * 0.42,
                    0,
                    Math.PI * 2,
                  )
                  ctx.fill()
                }
                // the release meter, while you hold
                if (swingT >= 0) {
                  const at = needle(swingT)
                  const bw = w * 0.6
                  const bx = (w - bw) / 2
                  const by = h * 0.86
                  ctx.fillStyle = 'rgba(0,0,0,0.55)'
                  ctx.fillRect(bx, by, bw, 12)
                  ctx.fillStyle = 'rgba(126,231,135,0.85)'
                  ctx.fillRect(bx + bw / 2 - bw * 0.08, by, bw * 0.16, 12)
                  ctx.fillStyle = '#fff'
                  ctx.fillRect(bx + bw / 2 + at * (bw / 2) - 2, by - 5, 4, 22)
                }
              },
            }
          }}
        />
      </div>

      <div className="bw-panel">
        <div className="lab-controls" role="group" aria-label="Where you stand">
          <button
            className="btn btn-ghost"
            aria-label="Stand further left"
            onClick={() => setShot((s) => ({ ...s, x: Math.max(-0.45, s.x - 0.027) }))}
          >
            ◀
          </button>
          <span className="bw-read">Stand on board {board(shot.x)}</span>
          <button
            className="btn btn-ghost"
            aria-label="Stand further right"
            onClick={() => setShot((s) => ({ ...s, x: Math.min(0.45, s.x + 0.027) }))}
          >
            ▶
          </button>
        </div>
        <div className="lab-controls" role="group" aria-label="Your line">
          <button
            className="btn btn-ghost"
            aria-label="Aim further left"
            onClick={() => setShot((s) => ({ ...s, angle: Math.max(-0.05, s.angle - 0.002) }))}
          >
            ◀
          </button>
          <span className="bw-read">Over board {arrowsBoard} at the arrows</span>
          <button
            className="btn btn-ghost"
            aria-label="Aim further right"
            onClick={() => setShot((s) => ({ ...s, angle: Math.min(0.05, s.angle + 0.002) }))}
          >
            ▶
          </button>
        </div>
        <div className="lab-controls" role="group" aria-label="Hook">
          {HOOKS.map((k) => (
            <button
              key={k.v}
              className="btn btn-ghost"
              aria-pressed={shot.hook === k.v}
              onClick={() => setShot((s) => ({ ...s, hook: k.v }))}
            >
              {k.name}
            </button>
          ))}
        </div>
        <div className="lab-controls" role="group" aria-label="Speed">
          {SPEEDS.map((k) => (
            <button
              key={k.v}
              className="btn btn-ghost"
              aria-pressed={shot.speed === k.v}
              onClick={() => setShot((s) => ({ ...s, speed: k.v }))}
            >
              {k.name}
            </button>
          ))}
        </div>
        <div className="lab-controls">
          <button
            className="btn bw-bowl"
            disabled={busy || up !== 0 || over}
            onPointerDown={(e) => {
              startSwing()
              try {
                e.currentTarget.setPointerCapture(e.pointerId)
              } catch {
                /* the swing still works; capture only keeps a slipping thumb on the button */
              }
            }}
            onPointerUp={release}
            onPointerCancel={() => (swing.current = 0)}
            onKeyDown={(e) => {
              if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) {
                e.preventDefault()
                startSwing(true)
              }
            }}
            onKeyUp={(e) => {
              if (e.key === ' ' || e.key === 'Enter') {
                e.preventDefault()
                release()
              }
            }}
          >
            🎳 Hold to swing, let go to bowl
          </button>
          {over && (
            <button className="btn" onClick={() => fresh()}>
              ↻ Play again
            </button>
          )}
        </div>
      </div>

      <p className="sun-reading">
        <span className="muted">
          Against {LEVEL_NAMES[saved.level]}: won {rec.won}, lost {rec.lost}
          {rec.best ? ` · best game ${rec.best}` : ''}
          {rec.strikes ? ` · strikes ${rec.strikes}` : ''}
        </span>
      </p>
      {level !== saved.level && !untouched && !over && (
        <p className="muted mc-note">The new level starts with the next game.</p>
      )}
      <div className="fw-panel">
        <section aria-label="Lane">
          <h3 className="fw-h">Lane</h3>
          <div className="lab-controls" role="group" aria-label="Look">
            {LANES.map((l) => (
              <button
                key={l}
                className="btn btn-ghost"
                aria-pressed={saved.lane === l}
                onClick={() => setSaved((s) => ({ ...s, lane: l }))}
              >
                {LOOK[l].name}
              </button>
            ))}
            <button
              className="btn btn-ghost"
              aria-pressed={saved.left}
              onClick={() => setSaved((s) => ({ ...s, left: !s.left }))}
            >
              Bowl left-handed
            </button>
          </div>
        </section>
      </div>
      <p className="muted lab-hint">
        Ten frames, two balls a frame to knock all ten down — a strike scores ten and your next two
        balls, a spare ten and your next one, and the tenth frame gives bonus balls for either. Set
        where you stand and the line you send the ball along (the dotted line runs to the end of the
        oil), how much it hooks after that, and how fast. Then hold Bowl: a needle swings across a
        meter, and where it is when you let go strays your line — not at all in the green, most at
        the ends. Tap low on the lane to stand there, higher to aim through that point. Strikes come
        from the pocket, just beside the head pin; straight at it tends to leave a split. You and
        the computer take turns, a frame each. Easy bowls straight and loose, Hard hooks into the
        pocket with a steady hand and picks up spares with a straight ball.
      </p>
    </div>
  )
}
