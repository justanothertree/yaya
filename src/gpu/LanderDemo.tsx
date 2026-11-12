import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { CopyLink } from '../lab/CopyLink'
import { hashParam, here } from '../lab/links'
import { daySeed } from './bricks'
import { CanvasStage } from './CanvasStage'
import {
  CRAFTS,
  FOOT_X,
  FOOT_Y,
  IDLE,
  LANDER_KEY,
  LEVELS,
  LOOKS,
  SAFE_TILT,
  SAFE_VX,
  SAFE_VY,
  STEP,
  WORLD_H,
  autoland,
  fly,
  ground,
  launch,
  makeWorld,
  pilot,
  readSaved,
  step,
  type Craft,
  type Input,
  type Level,
  type Pilot,
  type Saved,
  type World,
} from './lander'
import { motionReduced as reduced } from '../ui/motion'

const load = (): Saved => {
  try {
    return readSaved(localStorage.getItem(LANDER_KEY))
  } catch {
    return readSaved(null)
  }
}
const LEVEL_NAMES: Record<Level, string> = { easy: 'Easy', fair: 'Fair', hard: 'Hard' }
const LOOK: Record<
  Saved['look'],
  { name: string; sky: [string, string]; ground: string; rim: string; pad: string }
> = {
  moon: {
    name: 'Moon',
    sky: ['#05060d', '#141a2e'],
    ground: '#8d8f96',
    rim: '#c9cbd2',
    pad: '#ffd34d',
  },
  mars: {
    name: 'Mars',
    sky: ['#2a0f12', '#7a3b2a'],
    ground: '#a8492b',
    rim: '#e08a5c',
    pad: '#7ef0ff',
  },
  ice: {
    name: 'Ice',
    sky: ['#020a1a', '#0d2f52'],
    ground: '#cfe6f5',
    rim: '#ffffff',
    pad: '#ff6ad5',
  },
}
const CRAFT: Record<Saved['craft'], { name: string; body: string; trim: string }> = {
  silver: { name: 'Silver', body: '#d9dde3', trim: '#5b6470' },
  gold: { name: 'Gold', body: '#f2c14e', trim: '#7a5a12' },
  teal: { name: 'Teal', body: '#3fd0c0', trim: '#11605a' },
}
const today = () => daySeed(new Date())
type Phase = 'ready' | 'flying' | 'done'
type Gauges = { alt: number; vx: number; vy: number; tilt: number; fuel: number }

export function LanderDemo() {
  const [saved, setSaved] = useState<Saved>(load)
  const linked = useMemo(() => {
    const t = Number(hashParam('terrain'))
    return Number.isInteger(t) && t > 0 ? t : null
  }, [])
  const [terrain, setTerrain] = useState<number>(() => linked ?? today())
  const world = useMemo(() => makeWorld(terrain), [terrain])
  const [level, setLevel] = useState<Level>(saved.level)
  const toBeat = useMemo(() => autoland(world, level).done?.score ?? 0, [world, level])
  const [phase, setPhase] = useState<Phase>('ready')
  const [result, setResult] = useState<Craft['done']>(null)
  const [line, setLine] = useState(
    'Land gently and upright on a pad. Press a control, or Launch, to begin.',
  )
  const [gauges, setGauges] = useState<Gauges>({ alt: 0, vx: 0, vy: 0, tilt: 0, fuel: 1 })

  const sim = useRef<{
    world: World
    you: Craft
    ghost: Craft
    pilot: Pilot
    acc: number
    phase: Phase
    level: Level
  }>({
    world,
    you: launch(world),
    ghost: launch(world),
    pilot: pilot(world, level),
    acc: 0,
    phase: 'ready',
    level,
  })
  const keys = useRef<Input>({ ...IDLE })
  const buttons = useRef<Input>({ ...IDLE })
  const savedRef = useRef(saved)
  savedRef.current = saved
  useEffect(() => {
    try {
      localStorage.setItem(LANDER_KEY, JSON.stringify(saved))
    } catch {
      /* private mode: kept for this visit */
    }
  }, [saved])

  const reset = (w: World = world, lv: Level = saved.level) => {
    sim.current = {
      world: w,
      you: launch(w),
      ghost: launch(w),
      pilot: pilot(w, lv),
      acc: 0,
      phase: 'ready',
      level: lv,
    }
    keys.current = { ...IDLE }
    buttons.current = { ...IDLE }
    setLevel(lv)
    setPhase('ready')
    setResult(null)
    setLine('Land gently and upright on a pad. Press a control, or Launch, to begin.')
  }
  // a new terrain or level starts a new flight
  useEffect(() => {
    reset(world, level)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [world])

  const begin = () => {
    if (sim.current.phase !== 'ready') return
    sim.current.phase = 'flying'
    setPhase('flying')
    setLine('Flying. Upright, slow, and over a pad.')
  }
  const finish = (c: Craft) => {
    const d = c.done!
    sim.current.phase = 'done'
    setPhase('done')
    setResult(d)
    const lv = sim.current.level
    const beat = d.landed && d.score > toBeat
    setSaved((s) => {
      const t = s.record[lv]
      return {
        ...s,
        record: {
          ...s.record,
          [lv]: {
            landed: t.landed + (d.landed ? 1 : 0),
            crashed: t.crashed + (d.landed ? 0 : 1),
            beat: t.beat + (beat ? 1 : 0),
            best: Math.max(t.best, d.score),
          },
        },
      }
    })
    setLine(
      d.landed
        ? `${beat ? '🏆 ' : ''}Landed ${d.why} for ${d.score}${beat ? ` — beating the ${LEVEL_NAMES[lv]} autopilot's ${toBeat}` : d.score === toBeat ? ' — level with the autopilot' : `; the ${LEVEL_NAMES[lv]} autopilot scores ${toBeat}`}.`
        : `Crashed ${d.why}. The ${LEVEL_NAMES[lv]} autopilot scores ${toBeat} here.`,
    )
  }

  /** the frame loop is made once, so it reaches the latest finish (and its score to beat) by ref */
  const finishRef = useRef(finish)
  finishRef.current = finish

  const control = (): Input => ({
    left: keys.current.left || buttons.current.left,
    right: keys.current.right || buttons.current.right,
    thrust: keys.current.thrust || buttons.current.thrust,
  })
  const keyOf = (k: string): keyof Input | null =>
    k === 'ArrowLeft' || k === 'a' || k === 'A'
      ? 'left'
      : k === 'ArrowRight' || k === 'd' || k === 'D'
        ? 'right'
        : k === 'ArrowUp' || k === 'w' || k === 'W' || k === ' '
          ? 'thrust'
          : null
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const k = keyOf(e.key)
    if (!k) {
      if (e.key === 'Enter' && sim.current.phase === 'done') reset()
      return
    }
    e.preventDefault()
    e.stopPropagation()
    keys.current = { ...keys.current, [k]: true }
    begin()
  }
  const onKeyUp = (e: KeyboardEvent<HTMLDivElement>) => {
    const k = keyOf(e.key)
    if (!k) return
    e.preventDefault()
    keys.current = { ...keys.current, [k]: false }
  }
  /** a hold-down button: the control is on while a pointer is down on it */
  const holdable = (k: keyof Input) => ({
    onPointerDown: (e: PointerEvent<HTMLButtonElement>) => {
      buttons.current = { ...buttons.current, [k]: true }
      begin()
      try {
        e.currentTarget.setPointerCapture(e.pointerId)
      } catch {
        /* the control still works; capture only stops a slipping thumb losing it */
      }
    },
    onPointerUp: () => (buttons.current = { ...buttons.current, [k]: false }),
    onPointerCancel: () => (buttons.current = { ...buttons.current, [k]: false }),
    onLostPointerCapture: () => (buttons.current = { ...buttons.current, [k]: false }),
    onContextMenu: (e: { preventDefault(): void }) => e.preventDefault(),
  })

  const lastGauge = useRef(0)
  const rec = saved.record[saved.level]
  const fmt = (v: number) => (v * 100).toFixed(1)
  const share = result?.landed
    ? `I landed for ${result.score} on Lander terrain ${terrain}. Beat it:\n${here()}#lab?demo=lander&terrain=${terrain}`
    : `Try this Lander terrain:\n${here()}#lab?demo=lander&terrain=${terrain}`

  return (
    <div className={`lab-keys ld-room is-${saved.look}`}>
      <div className="lab-controls">
        <div className="lab-group" role="group" aria-label="Which autopilot to beat">
          {LEVELS.map((l) => (
            <button
              key={l}
              className="btn btn-ghost"
              aria-pressed={saved.level === l}
              onClick={() => {
                setSaved((s) => ({ ...s, level: l }))
                if (phase !== 'flying') reset(world, l)
              }}
            >
              {LEVEL_NAMES[l]}
            </button>
          ))}
        </div>
        <div className="lab-group" role="group" aria-label="Terrain">
          <button
            className="btn btn-ghost"
            aria-pressed={terrain === today()}
            onClick={() => setTerrain(today())}
          >
            Today’s
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => setTerrain(1 + Math.floor(Math.random() * 999_999))}
          >
            ⟳ New terrain
          </button>
        </div>
      </div>
      <div className="dice-scores">
        <div className="dice-score">
          <span>To beat · {LEVEL_NAMES[level]} autopilot</span>
          <strong>{toBeat}</strong>
          <span className="muted">terrain {terrain}</span>
        </div>
        <div className="dice-score">
          <span>Your best on {LEVEL_NAMES[saved.level]}</span>
          <strong>{rec.best || '—'}</strong>
          <span className="muted">
            landed {rec.landed} · crashed {rec.crashed}
          </span>
        </div>
      </div>
      <p className="mc-line" aria-live="polite">
        {line}
      </p>

      <div
        className="ld-wrap"
        tabIndex={0}
        role="group"
        aria-label="The landing. Left and right arrows (or A and D) lean the craft, up or Space fires the engine; Enter flies again."
        onKeyDown={onKeyDown}
        onKeyUp={onKeyUp}
        onBlur={() => (keys.current = { ...IDLE })}
      >
        <CanvasStage
          className="ld-stage"
          label={`A landing on terrain ${terrain}: pads paying five, three and two times. ${line}`}
          make={(ctx, c) => {
            // stars for the sky, fixed for the session
            const stars = Array.from({ length: 70 }, (_, i) => ({
              x: (Math.sin(i * 12.9898) * 43758.5453) % 1,
              y: (Math.sin(i * 78.233) * 12345.678) % 1,
            })).map((p) => ({ x: Math.abs(p.x), y: Math.abs(p.y) }))
            return {
              frame: (dt) => {
                const S = sim.current
                if (S.phase === 'flying') {
                  S.acc = Math.min(0.25, S.acc + dt)
                  const input = control()
                  while (S.acc >= STEP) {
                    S.acc -= STEP
                    if (!S.you.done) S.you = step(S.world, S.you, input)
                    if (!S.ghost.done) {
                      const f = fly(S.world, S.ghost, S.pilot)
                      S.pilot = f.pilot
                      S.ghost = step(S.world, S.ghost, f.input)
                    }
                    if (S.you.done) break
                  }
                  if (S.you.done) finishRef.current(S.you)
                  const now = performance.now()
                  if (now - lastGauge.current > 200) {
                    lastGauge.current = now
                    const y = S.you
                    setGauges({
                      alt: y.y - FOOT_Y - ground(S.world, y.x),
                      vx: y.vx,
                      vy: y.vy,
                      tilt: y.a,
                      fuel: y.fuel,
                    })
                  }
                }
                const sv = savedRef.current
                const look = LOOK[sv.look]
                const craft = CRAFT[sv.craft]
                const w = c.width
                const h = c.height
                const s = Math.min(w, h / WORLD_H)
                const ox = (w - s) / 2
                const oy = (h - s * WORLD_H) / 2
                const X = (x: number) => ox + x * s
                const Y = (y: number) => oy + (WORLD_H - y) * s
                ctx.setTransform(1, 0, 0, 1, 0, 0)
                const sky = ctx.createLinearGradient(0, 0, 0, h)
                sky.addColorStop(0, look.sky[0])
                sky.addColorStop(1, look.sky[1])
                ctx.fillStyle = sky
                ctx.fillRect(0, 0, w, h)
                ctx.fillStyle = 'rgba(255,255,255,0.7)'
                for (const st of stars)
                  ctx.fillRect(X(st.x), oy + st.y * s * WORLD_H * 0.7, 1.5, 1.5)
                // the ground
                const W2 = S.world
                ctx.fillStyle = look.ground
                ctx.beginPath()
                ctx.moveTo(X(0), Y(0))
                for (let i = 0; i < W2.heights.length; i++)
                  ctx.lineTo(X(i / (W2.heights.length - 1)), Y(W2.heights[i]))
                ctx.lineTo(X(1), Y(0))
                ctx.fill()
                ctx.strokeStyle = look.rim
                ctx.lineWidth = Math.max(1, s * 0.003)
                ctx.beginPath()
                for (let i = 0; i < W2.heights.length; i++) {
                  const px = X(i / (W2.heights.length - 1))
                  const py = Y(W2.heights[i])
                  if (i) ctx.lineTo(px, py)
                  else ctx.moveTo(px, py)
                }
                ctx.stroke()
                ctx.font = `700 ${Math.max(11, s * 0.026)}px system-ui, sans-serif`
                ctx.textAlign = 'center'
                for (const p of W2.pads) {
                  ctx.strokeStyle = look.pad
                  ctx.lineWidth = Math.max(3, s * 0.007)
                  ctx.beginPath()
                  ctx.moveTo(X(p.from), Y(p.y))
                  ctx.lineTo(X(p.to), Y(p.y))
                  ctx.stroke()
                  ctx.fillStyle = look.pad
                  ctx.fillText(
                    `×${p.times}`,
                    X((p.from + p.to) / 2),
                    Y(p.y) + Math.max(14, s * 0.035),
                  )
                }
                const drawCraft = (cr: Craft, ghost: boolean) => {
                  const cx = X(cr.x)
                  const cy = Y(cr.y)
                  const k = s
                  ctx.save()
                  ctx.translate(cx, cy)
                  ctx.rotate(cr.a)
                  ctx.globalAlpha = ghost ? 0.35 : 1
                  if (cr.done && !cr.done.landed) {
                    // wreckage: a few struts at angles, still — no explosion to flash
                    ctx.strokeStyle = craft.body
                    ctx.lineWidth = Math.max(2, k * 0.004)
                    for (let i = 0; i < 5; i++) {
                      const ang = i * 1.3 + 0.4
                      ctx.beginPath()
                      ctx.moveTo(0, 0)
                      ctx.lineTo(Math.cos(ang) * k * 0.02, Math.sin(ang) * k * 0.012)
                      ctx.stroke()
                    }
                    ctx.restore()
                    return
                  }
                  if (cr.thrusting) {
                    const flick = reduced() ? 1 : 0.8 + Math.random() * 0.4
                    ctx.fillStyle = '#ffb000'
                    ctx.beginPath()
                    ctx.moveTo(-k * 0.006, k * FOOT_Y * 0.6)
                    ctx.lineTo(0, k * (FOOT_Y + 0.02 * flick))
                    ctx.lineTo(k * 0.006, k * FOOT_Y * 0.6)
                    ctx.fill()
                  }
                  ctx.strokeStyle = craft.trim
                  ctx.lineWidth = Math.max(1.5, k * 0.003)
                  ctx.beginPath()
                  ctx.moveTo(-k * 0.006, k * 0.004)
                  ctx.lineTo(-k * FOOT_X, k * FOOT_Y)
                  ctx.moveTo(k * 0.006, k * 0.004)
                  ctx.lineTo(k * FOOT_X, k * FOOT_Y)
                  ctx.stroke()
                  ctx.fillStyle = craft.body
                  ctx.beginPath()
                  ctx.roundRect(-k * 0.009, -k * 0.012, k * 0.018, k * 0.017, k * 0.005)
                  ctx.fill()
                  ctx.strokeStyle = craft.trim
                  ctx.stroke()
                  ctx.fillStyle = craft.trim
                  ctx.beginPath()
                  ctx.arc(0, -k * 0.005, k * 0.0035, 0, Math.PI * 2)
                  ctx.fill()
                  ctx.restore()
                }
                if (sv.ghost && S.phase !== 'ready') drawCraft(S.ghost, true)
                drawCraft(S.you, false)
                // the fuel, along the top
                ctx.fillStyle = 'rgba(0,0,0,0.45)'
                ctx.fillRect(X(0.02), oy + s * 0.02, s * 0.3, s * 0.014)
                ctx.fillStyle = S.you.fuel < 0.2 ? '#ff6b4a' : '#7ee787'
                ctx.fillRect(X(0.02), oy + s * 0.02, s * 0.3 * S.you.fuel, s * 0.014)
              },
            }
          }}
        />
      </div>

      <div className="ld-gauges" aria-hidden={phase === 'ready'}>
        <span className={Math.abs(gauges.vx) <= SAFE_VX ? 'is-safe' : 'is-risk'}>
          Across <strong>{fmt(gauges.vx)}</strong>
        </span>
        <span className={-gauges.vy <= SAFE_VY ? 'is-safe' : 'is-risk'}>
          {gauges.vy > 0 ? 'Up' : 'Down'} <strong>{fmt(Math.abs(gauges.vy))}</strong>
        </span>
        <span className={Math.abs(gauges.tilt) <= SAFE_TILT ? 'is-safe' : 'is-risk'}>
          Tilt <strong>{Math.round((gauges.tilt * 180) / Math.PI)}°</strong>
        </span>
        <span>
          Height <strong>{fmt(Math.max(0, gauges.alt))}</strong>
        </span>
        <span>
          Fuel <strong>{Math.round(gauges.fuel * 100)}%</strong>
        </span>
      </div>

      <div className="ld-pad" role="group" aria-label="Controls to hold down">
        <button className="btn ld-hold" aria-label="Lean left" {...holdable('left')}>
          ⟲ Lean
        </button>
        <button
          className="btn ld-hold is-thrust"
          aria-label="Fire the engine"
          {...holdable('thrust')}
        >
          🔥 Thrust
        </button>
        <button className="btn ld-hold" aria-label="Lean right" {...holdable('right')}>
          Lean ⟳
        </button>
      </div>
      <div className="lab-controls">
        {phase === 'ready' && (
          <button className="btn" onClick={begin}>
            🚀 Launch
          </button>
        )}
        {phase === 'done' && (
          <button className="btn" onClick={() => reset()}>
            ↻ Fly again
          </button>
        )}
        <CopyLink
          text={share}
          label={result?.landed ? 'Copy a challenge link' : 'Copy a link to this terrain'}
        />
      </div>
      {linked !== null && terrain === linked && (
        <p className="muted mc-note">A terrain someone sent you. Today’s is a tap away.</p>
      )}

      <div className="fw-panel">
        <section aria-label="Looks">
          <h3 className="fw-h">Look</h3>
          <div className="lab-controls" role="group" aria-label="World">
            {LOOKS.map((l) => (
              <button
                key={l}
                className="btn btn-ghost"
                aria-pressed={saved.look === l}
                onClick={() => setSaved((s) => ({ ...s, look: l }))}
              >
                {LOOK[l].name}
              </button>
            ))}
          </div>
          <div className="lab-controls" role="group" aria-label="Craft">
            {CRAFTS.map((k) => (
              <button
                key={k}
                className="btn btn-ghost"
                aria-pressed={saved.craft === k}
                onClick={() => setSaved((s) => ({ ...s, craft: k }))}
              >
                {CRAFT[k].name} craft
              </button>
            ))}
            <button
              className="btn btn-ghost"
              aria-pressed={saved.ghost}
              onClick={() => setSaved((s) => ({ ...s, ghost: !s.ghost }))}
            >
              Show the autopilot’s ghost
            </button>
          </div>
        </section>
      </div>
      <p className="muted lab-hint">
        Lean the craft and fire the engine to bring it down onto a pad — slowly, upright, with both
        feet on it. The gauges turn green when each is safe: across no faster than {fmt(SAFE_VX)},
        down no faster than {fmt(SAFE_VY)}, and leaning no more than{' '}
        {Math.round((SAFE_TILT * 180) / Math.PI)}°. You score 50 and a point for every per cent of
        fuel left, times the pad: the narrow one pays five. An autopilot flies the same terrain as a
        faint ghost; its score is the one to beat — Easy aims for the wide pad, Hard for the narrow
        one. Keys: left and right (or A and D) lean, up or Space fires. On a touch screen, hold the
        buttons. Today’s terrain is the same for everyone; send a link to race someone on yours.
      </p>
    </div>
  )
}
