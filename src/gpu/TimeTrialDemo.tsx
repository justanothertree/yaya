import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { CopyLink } from '../lab/CopyLink'
import { here } from '../lab/links'
import { daySeed } from './bricks'
import { CanvasStage } from './CanvasStage'
import {
  COLOURS,
  GHOST_HZ,
  TIMETRIAL_KEY,
  TRACKS,
  dailyTrack,
  drive,
  medals,
  newLap,
  onTrack,
  packGhost,
  goldLap,
  progress,
  readSaved,
  speedOf,
  startCar,
  unpackGhost,
  type Car,
  type Lap,
  type Track,
} from './timetrial'
import { motionReduced as reduced } from '../ui/motion'
import { useKept } from './kept'

type Phase = 'driving' | 'paused'
const COLOUR_NAMES = ['Red', 'Blue', 'Yellow', 'Green', 'Violet']
const fmt = (s: number) =>
  `${Math.floor(s / 60) ? `${Math.floor(s / 60)}:` : ''}${(s % 60).toFixed(2).padStart(Math.floor(s / 60) ? 5 : 1, '0')}`
const medalOf = (lap: number, pace: number) => {
  const m = medals(pace)
  return lap <= m.gold ? '🥇' : lap <= m.silver ? '🥈' : lap <= m.bronze ? '🥉' : ''
}

type Sample = { x: number; y: number; heading: number }
type Run = { car: Car; lap: Lap; time: number; samples: Sample[]; skids: Sample[] }
const freshRun = (t: Track): Run => ({
  car: startCar(t),
  lap: newLap(),
  time: 0,
  samples: [],
  skids: [],
})

function trackPath(t: Track) {
  const p = new Path2D()
  t.pts.forEach((q, i) => (i ? p.lineTo(q.x, q.y) : p.moveTo(q.x, q.y)))
  p.closePath()
  return p
}
function carShape(ctx: CanvasRenderingContext2D, s: Sample, colour: string, alpha: number) {
  ctx.save()
  ctx.translate(s.x, s.y)
  ctx.rotate(s.heading)
  ctx.globalAlpha = alpha
  ctx.fillStyle = colour
  ctx.beginPath()
  ctx.roundRect(-2.3, -1.05, 4.6, 2.1, 0.7)
  ctx.fill()
  ctx.fillStyle = 'rgba(20,24,40,0.85)'
  ctx.fillRect(0.2, -0.8, 1.1, 1.6)
  ctx.restore()
}

export function TimeTrialDemo() {
  const [saved, setSaved] = useKept(TIMETRIAL_KEY, readSaved)
  const [phase, setPhase] = useState<Phase>('paused')
  const day = daySeed(new Date())
  const today = useMemo(() => dailyTrack(day), [day])
  const track =
    saved.track === 'today' ? today : (TRACKS.find((t) => t.id === saved.track) ?? TRACKS[0])
  const pace = useMemo(() => goldLap(track), [track])
  const [hud, setHud] = useState({
    time: 0,
    last: null as number | null,
    speed: 0,
    grass: false,
    laps: 0,
  })
  const [said, setSaid] = useState(
    'Press Space or ▶ Drive, then go: the clock starts at the line.',
  )
  const [share, setShare] = useState('')
  const run = useRef<Run>(freshRun(track))
  const keys = useRef(new Set<string>())
  const held = useRef({ gas: false, brake: false, left: false, right: false })
  const steer = useRef(0)
  const phaseRef = useRef(phase)
  phaseRef.current = phase
  const savedRef = useRef(saved)
  savedRef.current = saved
  const trackRef = useRef(track)
  trackRef.current = track
  const paceRef = useRef(pace)
  paceRef.current = pace

  useEffect(() => {
    const hide = () => {
      if (document.hidden && phaseRef.current === 'driving') setPhase('paused')
    }
    document.addEventListener('visibilitychange', hide)
    return () => document.removeEventListener('visibilitychange', hide)
  }, [])

  const best = saved.best[track.id]
  const ghost = useMemo(() => unpackGhost(best?.ghost), [best?.ghost])
  const ghostRef = useRef(ghost)
  ghostRef.current = ghost

  const restart = (t: Track = track) => {
    run.current = freshRun(t)
    steer.current = 0
    setHud({ time: 0, last: null, speed: 0, grass: false, laps: 0 })
    setShare('')
  }
  const pickTrack = (id: string) => {
    const t = id === 'today' ? today : (TRACKS.find((x) => x.id === id) ?? TRACKS[0])
    setSaved((s) => ({ ...s, track: id }))
    restart(t)
    setPhase('paused')
    setSaid(`${t.name}: ${Math.round(t.length)} m a lap. Press Space or ▶ Drive.`)
  }

  const onLap = (lap: number, samples: Sample[]) => {
    const t = trackRef.current
    const s = savedRef.current
    const prev = s.best[t.id]?.lap
    const m = medalOf(lap, paceRef.current)
    if (prev === undefined || lap < prev) {
      setSaved((x) => ({ ...x, best: { ...x.best, [t.id]: { lap, ghost: packGhost(samples) } } }))
      setSaid(
        `${m ? `${m} ` : ''}Lap ${fmt(lap)} — your best here${prev !== undefined ? `, ${fmt(prev - lap)} quicker` : ''}. Your ghost now drives it.`,
      )
      if (t.id.startsWith('day-'))
        setShare(
          `I lapped today's Time trial track in ${fmt(lap)}${m ? ` ${m}` : ''}. Beat it:\n${here()}#lab?demo=timetrial`,
        )
    } else setSaid(`${m ? `${m} ` : ''}Lap ${fmt(lap)} — ${fmt(lap - prev)} off your best.`)
  }

  const onKey = (e: KeyboardEvent<HTMLDivElement>, down: boolean) => {
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'w', 'a', 's', 'd'].includes(k)) {
      e.preventDefault()
      e.stopPropagation()
      if (down) {
        keys.current.add(k)
        if (phaseRef.current === 'paused' && (k === 'ArrowUp' || k === 'w')) setPhase('driving')
      } else keys.current.delete(k)
      return
    }
    if (!down) return
    if (k === ' ') {
      e.preventDefault()
      setPhase((p) => (p === 'driving' ? 'paused' : 'driving'))
    } else if (k === 'r') {
      restart()
      setSaid('Back to the line.')
    }
  }
  /** a button held by a finger or a mouse, for each pedal and each way */
  const hold = (which: keyof typeof held.current) => ({
    onPointerDown: (e: PointerEvent<HTMLButtonElement>) => {
      held.current[which] = true
      if (phaseRef.current === 'paused' && which !== 'brake') setPhase('driving')
      try {
        e.currentTarget.setPointerCapture(e.pointerId)
      } catch {
        /* a pointer the browser no longer tracks */
      }
    },
    onPointerUp: () => (held.current[which] = false),
    onPointerCancel: () => (held.current[which] = false),
    onContextMenu: (e: { preventDefault(): void }) => e.preventDefault(),
  })

  const m = medals(pace)
  return (
    <div className="lab-keys tt-room">
      <div className="lab-controls">
        <div className="lab-group" role="group" aria-label="Track">
          {[
            ...TRACKS.map((t) => ({ id: t.id, name: t.name })),
            { id: 'today', name: "Today's track" },
          ].map((t) => (
            <button
              key={t.id}
              className="btn btn-ghost"
              aria-pressed={saved.track === t.id}
              onClick={() => pickTrack(t.id)}
            >
              {t.name}
            </button>
          ))}
        </div>
        <button
          className="btn"
          onClick={() => setPhase((p) => (p === 'driving' ? 'paused' : 'driving'))}
        >
          {phase === 'driving' ? '⏸ Pause' : '▶ Drive'}
        </button>
        <button
          className="btn btn-ghost"
          onClick={() => {
            restart()
            setSaid('Back to the line.')
          }}
        >
          ↻ Back to the line
        </button>
      </div>

      <div className="dice-scores tt-hud">
        <div className="dice-score">
          <span>This lap</span>
          <strong>{hud.laps || hud.time ? fmt(hud.time) : '—'}</strong>
        </div>
        <div className="dice-score">
          <span>Last lap</span>
          <strong>{hud.last !== null ? fmt(hud.last) : '—'}</strong>
        </div>
        <div className="dice-score">
          <span>Best</span>
          <strong>
            {best
              ? `${fmt(best.lap)}${medalOf(best.lap, pace) ? ` ${medalOf(best.lap, pace)}` : ''}`
              : '—'}
          </strong>
        </div>
        <div className="dice-score">
          <span>Speed</span>
          <strong>{Math.round(hud.speed * 3.6)}</strong>
          <span className="muted">{hud.grass ? 'on the grass!' : 'km/h'}</span>
        </div>
      </div>

      <div
        className={`tt-wrap${phase === 'driving' ? ' is-driving' : ''}`}
        tabIndex={0}
        role="group"
        aria-label="The track. Up or W to go, down or S to brake, left and right to steer; Space pauses, R goes back to the line."
        onKeyDown={(e) => onKey(e, true)}
        onKeyUp={(e) => onKey(e, false)}
        onBlur={() => keys.current.clear()}
      >
        <CanvasStage
          className="tt-stage"
          label={`${track.name}, seen from above. ${best ? `Best lap ${fmt(best.lap)}.` : 'No lap yet.'}`}
          make={(ctx, c) => {
            let path: { t: Track; p: Path2D } | null = null
            let hudKey = ''
            return {
              frame: (dt) => {
                const t = trackRef.current
                const s = savedRef.current
                const r = run.current
                const still = reduced()
                if (!path || path.t !== t) path = { t, p: trackPath(t) }
                if (phaseRef.current === 'driving' && dt > 0) {
                  const k = keys.current
                  const h = held.current
                  const left = k.has('ArrowLeft') || k.has('a') || h.left
                  const right = k.has('ArrowRight') || k.has('d') || h.right
                  // the wheel turns in over a moment and comes back the same, so a tap is a nudge
                  const want = (right ? 1 : 0) - (left ? 1 : 0)
                  steer.current += Math.max(-dt * 5, Math.min(dt * 5, want - steer.current))
                  const gas =
                    k.has('ArrowUp') || k.has('w') || h.gas || (s.autoGas && !h.brake) ? 1 : 0
                  const brake = k.has('ArrowDown') || k.has('s') || h.brake ? 1 : 0
                  const step = Math.min(dt, 0.05)
                  const next = drive(t, r.car, { gas, brake, steer: steer.current }, step)
                  r.time += step
                  const p = progress(t, r.lap, r.car, next, r.time)
                  if (p.lap.started !== r.lap.started) {
                    // over the line: a finished lap is scored, and a new one starts recording
                    if (p.done !== null) onLap(p.done, r.samples)
                    r.samples = []
                  }
                  r.lap = p.lap
                  r.car = next
                  if (r.lap.started !== null) {
                    const want2 = Math.floor((r.time - r.lap.started) * GHOST_HZ)
                    while (r.samples.length <= want2)
                      r.samples.push({ x: next.x, y: next.y, heading: next.heading })
                  }
                  // a hard slide leaves rubber on the road
                  const slide = Math.abs(
                    -next.vx * Math.sin(next.heading) + next.vy * Math.cos(next.heading),
                  )
                  if (!still && slide > 4 && onTrack(t, next)) {
                    r.skids.push({ x: next.x, y: next.y, heading: next.heading })
                    if (r.skids.length > 400) r.skids.shift()
                  }
                  const lapTime = r.lap.started !== null ? r.time - r.lap.started : 0
                  const hk = `${lapTime.toFixed(1)}|${Math.round(speedOf(next) * 3.6)}|${onTrack(t, next)}|${p.done ?? ''}`
                  if (hk !== hudKey) {
                    hudKey = hk
                    setHud((x) => ({
                      time: lapTime,
                      last: p.done ?? x.last,
                      speed: speedOf(next),
                      grass: !onTrack(t, next),
                      laps: x.laps + (p.done !== null ? 1 : 0),
                    }))
                  }
                }

                // the camera follows the car, a little ahead of it when it is quick
                const w = c.width
                const hgt = c.height
                const scale = Math.min(w, hgt) / 110
                const car = r.car
                const lead = still ? 0 : 0.35
                const cx = car.x + car.vx * lead
                const cy = car.y + car.vy * lead
                ctx.setTransform(1, 0, 0, 1, 0, 0)
                ctx.fillStyle = '#3f7d3a'
                ctx.fillRect(0, 0, w, hgt)
                ctx.setTransform(scale, 0, 0, scale, w / 2 - cx * scale, hgt / 2 - cy * scale)
                // kerbs, then the road, then its centre line
                ctx.lineJoin = 'round'
                ctx.strokeStyle = '#f2f2f2'
                ctx.lineWidth = t.width + 1.6
                ctx.stroke(path.p)
                ctx.strokeStyle = '#d93a3a'
                ctx.setLineDash([3, 3])
                ctx.stroke(path.p)
                ctx.setLineDash([])
                ctx.strokeStyle = '#4a4d55'
                ctx.lineWidth = t.width
                ctx.stroke(path.p)
                ctx.strokeStyle = 'rgba(255,255,255,0.35)'
                ctx.lineWidth = 0.3
                ctx.setLineDash([4, 6])
                ctx.stroke(path.p)
                ctx.setLineDash([])
                // the start line, chequered across the road
                const a = t.pts[0]
                const b = t.pts[1]
                const ang = Math.atan2(b.y - a.y, b.x - a.x)
                ctx.save()
                ctx.translate(a.x, a.y)
                ctx.rotate(ang)
                for (let k2 = 0; k2 < 8; k2++)
                  for (let j = 0; j < 2; j++) {
                    ctx.fillStyle = (k2 + j) % 2 ? '#111' : '#fff'
                    ctx.fillRect(j * 1.2 - 1.2, -t.width / 2 + (k2 * t.width) / 8, 1.2, t.width / 8)
                  }
                ctx.restore()
                ctx.fillStyle = 'rgba(20,20,20,0.35)'
                for (const k2 of r.skids) ctx.fillRect(k2.x - 0.4, k2.y - 0.4, 0.8, 0.8)
                // the ghost of the best lap, where it was at this point in its lap
                const g = ghostRef.current
                if (s.ghost && g.length && r.lap.started !== null) {
                  const gi = Math.min(g.length - 1, Math.floor((r.time - r.lap.started) * GHOST_HZ))
                  carShape(ctx, g[gi], '#ffffff', 0.45)
                }
                carShape(ctx, { x: car.x, y: car.y, heading: car.heading }, COLOURS[s.colour], 1)

                // the whole track in a corner, with the car on it
                ctx.setTransform(1, 0, 0, 1, 0, 0)
                const box = Math.min(w, hgt) * 0.26
                const pad = Math.min(w, hgt) * 0.03
                let minX = Infinity
                let maxX = -Infinity
                let minY = Infinity
                let maxY = -Infinity
                for (const q of t.pts) {
                  minX = Math.min(minX, q.x)
                  maxX = Math.max(maxX, q.x)
                  minY = Math.min(minY, q.y)
                  maxY = Math.max(maxY, q.y)
                }
                const ms = box / Math.max(maxX - minX, maxY - minY)
                ctx.fillStyle = 'rgba(0,0,0,0.35)'
                ctx.fillRect(w - box - pad * 2, pad, box + pad, (maxY - minY) * ms + pad)
                ctx.setTransform(
                  ms,
                  0,
                  0,
                  ms,
                  w - box - pad * 1.5 - minX * ms,
                  pad * 1.5 - minY * ms,
                )
                ctx.strokeStyle = 'rgba(255,255,255,0.8)'
                ctx.lineWidth = 2 / ms
                ctx.stroke(path.p)
                ctx.fillStyle = COLOURS[s.colour]
                ctx.beginPath()
                ctx.arc(car.x, car.y, 4 / ms, 0, Math.PI * 2)
                ctx.fill()
                ctx.setTransform(1, 0, 0, 1, 0, 0)

                if (phaseRef.current === 'paused') {
                  ctx.fillStyle = 'rgba(0,0,0,0.5)'
                  const bh = Math.max(40, hgt * 0.1)
                  ctx.fillRect(0, hgt / 2 - bh / 2, w, bh)
                  ctx.fillStyle = '#fff'
                  ctx.font = `700 ${Math.round(Math.max(14, Math.min(24, w * 0.035)))}px system-ui, sans-serif`
                  ctx.textAlign = 'center'
                  ctx.textBaseline = 'middle'
                  ctx.fillText(
                    r.time ? 'Paused — Space or ▶ to drive on' : 'Space or ▶ Drive to start',
                    w / 2,
                    hgt / 2,
                    w - 20,
                  )
                }
              },
            }
          }}
        />
      </div>
      <div className="tt-pads" role="group" aria-label="Pedals and wheel, for a touch screen">
        <button className="btn tt-pad" aria-label="Steer left" {...hold('left')}>
          ◀
        </button>
        <button className="btn tt-pad" aria-label="Brake" {...hold('brake')}>
          Brake
        </button>
        <button className="btn tt-pad" aria-label="Accelerate" {...hold('gas')}>
          Go
        </button>
        <button className="btn tt-pad" aria-label="Steer right" {...hold('right')}>
          ▶
        </button>
      </div>
      <p className="mc-line" aria-live="polite">
        {said}
      </p>
      {share && <CopyLink text={share} label="🔗 Copy my lap" />}
      <p className="sun-reading">
        <span className="muted">
          Medals on {track.name.toLowerCase()}: 🥇 {fmt(m.gold)} · 🥈 {fmt(m.silver)} · 🥉{' '}
          {fmt(m.bronze)} — gold is the computer's own lap
        </span>
      </p>

      <div className="fw-panel">
        <section aria-label="Car and help">
          <h3 className="fw-h">Car</h3>
          <div className="fw-swatches" role="group" aria-label="Car colour">
            {COLOURS.map((col, i) => (
              <button
                key={col}
                className="fw-swatch"
                style={{ background: col }}
                aria-pressed={saved.colour === i}
                aria-label={`${COLOUR_NAMES[i]} car`}
                onClick={() => setSaved((s) => ({ ...s, colour: i }))}
              />
            ))}
          </div>
          <div className="lab-controls">
            <button
              className="btn btn-ghost"
              aria-pressed={saved.ghost}
              onClick={() => setSaved((s) => ({ ...s, ghost: !s.ghost }))}
            >
              Race my best lap's ghost
            </button>
            <button
              className="btn btn-ghost"
              aria-pressed={saved.autoGas}
              onClick={() => setSaved((s) => ({ ...s, autoGas: !s.autoGas }))}
            >
              Hold the throttle for me
            </button>
          </div>
        </section>
      </div>
      <p className="muted lab-hint">
        Drive laps as fast as you can. Up or W goes, down or S brakes, left and right steer; on a
        touch screen, hold the buttons under the track — and "hold the throttle for me" leaves just
        the steering and the brake. The grass slows you right down, and a lap only counts if you
        drove all of it. Your best lap's ghost drives beside you, and the medals are set by a
        computer driver: gold matches its lap, silver is six per cent slower, bronze fifteen.
        Today's track is new each day and the same for everyone.
      </p>
    </div>
  )
}
