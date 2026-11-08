import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { LabStage } from './LabStage'
import {
  DT,
  GLIDE_KEY,
  SPEED,
  TASKS,
  launch,
  par,
  readSaved,
  stars,
  step,
  vario,
  type End,
  type Glider,
  type Saved,
} from './glide'
import { createGlide, type GlideView } from './glideEngine'

type Props = {
  running: boolean
  setRunning: (r: boolean | ((r: boolean) => boolean)) => void
  onAdapter: (adapter: GPUAdapter, format: GPUTextureFormat) => void
}

const kmh = (v: number) => Math.round(v * 3.6)
/** flight seconds as m:ss or h:mm:ss */
const clock = (s: number) => {
  const t = Math.round(s)
  const [h, m, sec] = [Math.floor(t / 3600), Math.floor((t % 3600) / 60), t % 60]
  return h
    ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`
    : `${m}:${String(sec).padStart(2, '0')}`
}
const ratio = (r: number) =>
  Number.isFinite(r) && r > 0 ? `1 in ${r < 100 ? r.toFixed(0) : '99+'}` : 'climbing'

const load = (): Saved => {
  try {
    return readSaved(localStorage.getItem(GLIDE_KEY))
  } catch {
    return {}
  }
}

type Shown = { h: number; x: number; vario: number; need: number; getting: number; time: number }

export function GlideDemo({ running, setRunning, onAdapter }: Props) {
  const [live, setLive] = useState(false)
  const [which, setWhich] = useState(0)
  const task = TASKS[which]
  const [bests, setBests] = useState<Saved>(load)
  const [speed, setSpeed] = useState(25) // m/s, 90 km/h
  const [circling, setCircling] = useState(false)
  const [warp, setWarp] = useState<1 | 3>(1)
  const [shown, setShown] = useState<Shown | null>(null)
  const [outcome, setOutcome] = useState<string | null>(null)
  /** the flight waits for you: nothing moves until a first press, so the task can be read first */
  const [started, setStarted] = useState(false)
  const pars = useRef(new Map<string, number | null>())
  const parOf = (id: string) => {
    if (!pars.current.has(id))
      pars.current.set(id, par(TASKS.find((t) => t.id === id)!)?.time ?? null)
    return pars.current.get(id) ?? null
  }

  useEffect(() => {
    try {
      localStorage.setItem(GLIDE_KEY, JSON.stringify(bests))
    } catch {
      /* private mode: kept for this visit */
    }
  }, [bests])

  const glider = useRef<Glider>(launch(task))
  const ended = useRef<End>('flying')
  const trail = useRef<[number, number][]>([])
  const acc = useRef(0)
  const steps = useRef(0)
  const now = useRef({ task, speed, circling, warp, started })
  now.current = { task, speed, circling, warp, started }
  const go = () => {
    setStarted(true)
    if (!running) setRunning(true)
  }

  const restart = (k = which) => {
    glider.current = launch(TASKS[k])
    ended.current = 'flying'
    trail.current = [[0, TASKS[k].start]]
    acc.current = 0
    setCircling(false)
    setOutcome(null)
    setShown(null)
    setStarted(false)
  }
  useEffect(() => {
    trail.current = [[0, task.start]]
  }, [task])

  /** the flight is over: say how it went, and keep a best */
  const finish = (e: End) => {
    const g = glider.current
    const t = now.current.task
    if (e === 'finished') {
      const p = parOf(t.id)
      const n = p ? stars(g.t, p) : 1
      setOutcome(
        `✨ Home in ${clock(g.t)}${p ? ` — par ${clock(p)}` : ''}. ${'★'.repeat(n)}${'☆'.repeat(3 - n)}${bests[t.id] === undefined || g.t < bests[t.id] ? ' Your best.' : ''}`,
      )
      setBests((b) =>
        b[t.id] !== undefined && b[t.id] <= g.t ? b : { ...b, [t.id]: Math.round(g.t) },
      )
    } else
      setOutcome(
        `🌾 Landed out ${(g.x / 1000).toFixed(1)} km along, ${((t.finish - g.x) / 1000).toFixed(1)} km short. ${t.hint}`,
      )
  }
  const finishRef = useRef(finish)
  finishRef.current = finish

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.metaKey || e.ctrlKey || e.target !== e.currentTarget) return
    if (e.key === 'ArrowUp') setSpeed((s) => Math.min(SPEED.max, s + 5 / 3.6))
    else if (e.key === 'ArrowDown') setSpeed((s) => Math.max(SPEED.min, s - 5 / 3.6))
    else if (e.key === ' ' || e.key === 'c') setCircling((c) => !c)
    else return
    e.preventDefault()
    go()
  }

  const s = shown
  const label = outcome
    ? `Soaring, ${task.name}: ${outcome}`
    : s
      ? `Soaring, ${task.name}: ${Math.round(s.h)} m up, ${((task.finish - s.x) / 1000).toFixed(1)} km to go, ${s.vario >= 0 ? 'climbing' : 'sinking'} ${Math.abs(s.vario).toFixed(1)} m/s${circling ? ', circling' : `, at ${kmh(speed)} km/h`}.`
      : `Soaring, ${task.name}. ${task.hint}`

  return (
    <div className="lab-keys glide-room" tabIndex={0} onKeyDown={onKey} aria-label="Soaring">
      <LabStage
        label={label}
        running={running}
        onAdapter={onAdapter}
        onLive={setLive}
        maxDpr={2}
        make={async ({ device, context, format, canvas }) => {
          const v: GlideView = await createGlide(device, context, format, canvas)
          let time = 0
          let since = 0
          return {
            frame: (dt: number) => {
              time += dt
              const n = now.current
              const g = glider.current
              if (n.started && ended.current === 'flying' && dt > 0) {
                acc.current += Math.min(dt, 0.1) * n.warp
                while (acc.current >= DT && ended.current === 'flying') {
                  acc.current -= DT
                  g.v = n.speed
                  g.circling = n.circling
                  const e = step(n.task, g)
                  if (++steps.current % 25 === 0) trail.current.push([g.x, g.h])
                  if (trail.current.length > 400) trail.current.splice(0, 100)
                  if (e !== 'flying') {
                    ended.current = e
                    trail.current.push([g.x, Math.max(0, g.h)])
                    finishRef.current(e)
                  }
                }
                since += dt
                if (since > 0.1) {
                  since = 0
                  const vs = vario(n.task, g)
                  setShown({
                    h: g.h,
                    x: g.x,
                    vario: vs,
                    need: (n.task.finish - g.x) / Math.max(1, g.h),
                    getting: g.circling ? NaN : g.v / -vs,
                    time: g.t,
                  })
                }
              }
              v.frame({
                task: n.task,
                glider: { x: g.x, h: Math.max(0, g.h), circling: g.circling },
                trail: trail.current,
                time,
              })
            },
            destroy: () => v.destroy(),
          }
        }}
      />

      {live && (
        <>
          <div className="lab-controls">
            <label className="studio-pick">
              <span className="sr-only">Task</span>
              <select
                value={which}
                onChange={(e) => {
                  const k = Number(e.target.value)
                  setWhich(k)
                  restart(k)
                }}
              >
                {TASKS.map((t, i) => (
                  <option key={t.id} value={i}>
                    {bests[t.id] !== undefined ? '✓ ' : ''}
                    {i + 1}. {t.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="btn"
              aria-pressed={circling}
              aria-keyshortcuts="Space"
              disabled={!!outcome}
              onClick={() => {
                setCircling((c) => !c)
                go()
              }}
            >
              {circling ? '🌀 Circling — tap to fly on' : '🌀 Circle here'}
            </button>
            <button
              className="btn btn-ghost"
              aria-pressed={warp === 3}
              onClick={() => setWarp((w) => (w === 1 ? 3 : 1))}
            >
              ⏩ ×3
            </button>
            {!started && !outcome && (
              <button className="btn" onClick={go}>
                ▶ Fly
              </button>
            )}
            <button className="btn btn-ghost" onClick={() => restart()}>
              ↺ Restart
            </button>
          </div>
          <div className="sun-sliders">
            <label>
              <span>Airspeed {kmh(speed)} km/h</span>
              <input
                type="range"
                min={SPEED.min}
                max={SPEED.max}
                step={5 / 3.6}
                value={speed}
                onChange={(e) => {
                  setSpeed(Number(e.target.value))
                  go()
                }}
              />
            </label>
          </div>
          <p className="sun-reading glide-instruments">
            {outcome ? (
              <strong>{outcome}</strong>
            ) : s ? (
              <>
                <span>
                  <strong>{Math.round(s.h)} m</strong> up
                </span>
                <span className={s.vario >= 0 ? 'glide-up' : 'glide-down'}>
                  {s.vario >= 0 ? '▲' : '▼'} {Math.abs(s.vario).toFixed(1)} m/s
                </span>
                <span>{((task.finish - s.x) / 1000).toFixed(1)} km to go</span>
                <span>
                  need <strong>{ratio(s.need)}</strong>
                </span>
                <span>{circling ? 'circling' : <>getting {ratio(s.getting)}</>}</span>
                <span className="muted">{clock(s.time)}</span>
              </>
            ) : (
              <>
                <strong>{task.name}.</strong> {task.hint}
              </>
            )}
          </p>
          <p className="muted lab-hint">
            Set your airspeed and decide when to circle. Under a cloud the air rises: circle there
            to climb, then fly on. “Need” is the glide you must make to reach the finish from here;
            “getting” is the glide you are making now — when getting beats need, you can go home.
            The gliding rule (MacCready): fly faster through sinking air and slower in rising air,
            and only stop for a thermal stronger than you expect the next to be. Keys: ↑ ↓ airspeed,
            Space circles. A toy model of a two-seat trainer, with time sped up; heights are drawn
            far taller than distances.
            {bests[task.id] !== undefined ? ` Your best here: ${clock(bests[task.id])}.` : ''}
          </p>
        </>
      )}
    </div>
  )
}
