import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { noteOff, noteOn } from '../audio/synth'
import { LabStage } from './LabStage'
import {
  LEVELS,
  MU,
  ORBIT_KEY,
  elements,
  fly,
  launch,
  met,
  predict,
  readBests,
  scene,
  stars,
  type Flight,
} from './orbit'
import { createOrbit, type OrbitView } from './orbitEngine'

type Props = {
  running: boolean
  setRunning: (r: boolean | ((r: boolean) => boolean)) => void
  onAdapter: (adapter: GPUAdapter, format: GPUTextureFormat) => void
}

/** simulated time per real second at ×1: about eight seconds an orbit at the starting height */
const PACE = 2.2
const WARPS = [1, 3, 8] as const
const f3 = (x: number) => (Number.isFinite(x) ? x.toFixed(2) : '∞')

const loadBests = () => {
  try {
    return readBests(localStorage.getItem(ORBIT_KEY))
  } catch {
    return {}
  }
}

export function OrbitDemo({ running, setRunning, onAdapter }: Props) {
  const [live, setLive] = useState(false)
  const [level, setLevel] = useState(0)
  const l = LEVELS[level]
  const [bests, setBests] = useState<Record<string, number>>(loadBests)
  const [warp, setWarp] = useState<(typeof WARPS)[number]>(1)
  const [shown, setShown] = useState({ peri: 0, apo: 0, fuel: l.fuel, spent: 0, met: false })
  const [outcome, setOutcome] = useState<string | null>(null)
  const [sound, setSound] = useState(true)

  const flight = useRef<Flight>(launch(l))
  const burn = useRef<-1 | 0 | 1>(0)
  const engine = useRef<OrbitView | null>(null)
  const clock = useRef(0)
  const voice = useRef<string | null>(null)
  const timers = useRef<number[]>([])
  const now = useRef({ l, warp, sound })
  now.current = { l, warp, sound }

  useEffect(() => {
    try {
      localStorage.setItem(ORBIT_KEY, JSON.stringify(bests))
    } catch {
      /* private mode: kept for this visit */
    }
  }, [bests])

  /* the engine's hum: one held note while a burn lasts, let go the moment it stops or the toy goes */
  const hum = (on: boolean) => {
    if (on && !voice.current && now.current.sound) {
      voice.current = `orbit-${performance.now()}`
      noteOn(voice.current, 'pad', 40)
    } else if (!on && voice.current) {
      noteOff(voice.current)
      voice.current = null
    }
  }
  // leaving mid-chord lets every note go and every timer with it
  useEffect(
    () => () => {
      hum(false)
      for (const t of timers.current) window.clearTimeout(t)
      for (const m of [72, 76, 79]) noteOff(`orbit-win-${m}`)
    },
    [],
  )

  const restart = (k = level) => {
    burn.current = 0
    by.current = null
    hum(false)
    flight.current = launch(LEVELS[k])
    setOutcome(null)
  }
  const go = (k: number) => {
    const n = Math.max(0, Math.min(LEVELS.length - 1, k))
    setLevel(n)
    restart(n)
  }

  /** what started the burn going on now: a pointer on a button, a key on a button, or a key on
   *  the stage. ⚠️ Each stops only its own — a pointer leaving a button used to stop any burn the
   *  same way, so the page shifting under a still mouse cut off a burn somebody was holding → for */
  const by = useRef<'pointer' | 'button' | 'key' | null>(null)
  const setBurn = (b: -1 | 0 | 1, source: 'pointer' | 'button' | 'key' = 'key') => {
    if (flight.current.outcome !== 'flying') return
    if (b === 0 && by.current !== source) return
    by.current = b ? source : null
    burn.current = b
    hum(b !== 0)
    if (b && !running) setRunning(true)
  }

  /** a flight has ended: say what happened, and keep a best */
  const finish = (f: Flight) => {
    hum(false)
    burn.current = 0
    by.current = null
    const lv = f.level
    if (f.outcome === 'done') {
      const n = stars(lv, f.ship.spent)
      setOutcome(
        `✨ ${lv.goal.kind === 'escape' ? 'Away — it will never come back' : 'In orbit'}: Δv ${f.ship.spent.toFixed(3)}, where the least possible is ${lv.least.toFixed(3)}. ${'★'.repeat(n)}${'☆'.repeat(3 - n)}`,
      )
      setBests((b) =>
        b[lv.name] !== undefined && b[lv.name] <= f.ship.spent
          ? b
          : { ...b, [lv.name]: f.ship.spent },
      )
      if (now.current.sound) {
        ;[72, 76, 79].forEach((m, i) => {
          const id = `orbit-win-${m}`
          timers.current.push(
            window.setTimeout(() => noteOn(id, 'bell', m), i * 140),
            window.setTimeout(() => noteOff(id), i * 140 + 800),
          )
        })
      }
    } else if (f.outcome === 'crashed')
      setOutcome('💥 Down on the planet. Restart and try a smaller burn.')
    else
      setOutcome(
        'Out of fuel, and not on the orbit asked for. Restart and try burning at a different point.',
      )
  }
  const finishNow = useRef(finish)
  finishNow.current = finish

  const onKey = (e: KeyboardEvent<HTMLDivElement>, down: boolean) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.target !== e.currentTarget) return
    if (e.key === 'ArrowRight') setBurn(down ? 1 : 0, 'key')
    else if (e.key === 'ArrowLeft') setBurn(down ? -1 : 0, 'key')
    else if (down && e.key.toLowerCase() === 'r') restart()
    else if (down && e.key.toLowerCase() === 'w')
      setWarp((w) => WARPS[(WARPS.indexOf(w) + 1) % WARPS.length])
    else return
    e.preventDefault()
  }

  /** a button held down is a burn for as long as it is held — by pointer, Enter or Space */
  const hold = (b: -1 | 1) => ({
    onPointerDown: () => setBurn(b, 'pointer'),
    onPointerUp: () => setBurn(0, 'pointer'),
    onPointerLeave: () => setBurn(0, 'pointer'),
    onPointerCancel: () => setBurn(0, 'pointer'),
    onKeyDown: (e: KeyboardEvent<HTMLButtonElement>) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        setBurn(b, 'button')
      }
    },
    onKeyUp: (e: KeyboardEvent<HTMLButtonElement>) => {
      if (e.key === 'Enter' || e.key === ' ') setBurn(0, 'button')
    },
    onBlur: () => setBurn(0, 'button'),
  })

  const g = l.goal
  const goalText =
    g.kind === 'ring'
      ? `a round orbit at ${g.r} (± ${g.tol})`
      : g.kind === 'ellipse'
        ? `an orbit from ${g.peri} out to ${g.apo} (± ${g.tol})`
        : 'escape: an orbit that never comes back'
  const best = bests[l.name]
  return (
    <div
      className="lab-keys"
      tabIndex={0}
      onKeyDown={(e) => onKey(e, true)}
      onKeyUp={(e) => onKey(e, false)}
      aria-label="Orbit"
    >
      <LabStage
        label={`Orbit, level ${level + 1}: ${l.name}. Your orbit goes from ${f3(shown.peri)} to ${f3(shown.apo)}; the goal is ${goalText}. Δv left ${shown.fuel.toFixed(3)}.`}
        running={running}
        onAdapter={onAdapter}
        onLive={setLive}
        maxDpr={2}
        make={async ({ device, context, format, canvas }) => {
          const v = await createOrbit(device, context, format, canvas)
          engine.current = v
          let since = 0
          return {
            frame: (dt: number) => {
              clock.current += dt
              const f = flight.current
              const b = burn.current
              if (f.outcome === 'flying' && dt > 0) {
                // a burn runs at ×1 whatever the warp: a tap at ×8 would be eight times the burn
                // and at half pace: the burn a level needs is a held second, not a twitch
                const step = Math.min(dt, 0.05) * PACE * (b ? 0.5 : now.current.warp)
                fly(f, b, step)
                if (b && f.ship.fuel <= 0) {
                  burn.current = 0
                  by.current = null
                  hum(false)
                }
                if (f.outcome !== 'flying') finishNow.current(f)
              }
              // the path ahead: one whole orbit, or a long look outward when it is escaping
              const el = elements(f.ship)
              const a = el.energy < 0 ? -MU / (2 * el.energy) : 0
              const horizon = a ? Math.min(60, 2 * Math.PI * Math.sqrt(a ** 3 / MU)) : 30
              const ahead = f.outcome === 'flying' ? predict(f.ship, horizon, 200) : []
              v.frame({
                level: f.level,
                lines: scene(f, ahead, b),
                time: clock.current,
                met: met(f.level, f.ship),
              })
              // the words under the stage, a few times a second rather than every frame
              since += dt
              if (since > 0.15 || dt === 0) {
                since = 0
                setShown({
                  peri: el.peri,
                  apo: el.apo,
                  fuel: f.ship.fuel,
                  spent: f.ship.spent,
                  met: met(f.level, f.ship),
                })
              }
            },
            destroy: () => {
              hum(false)
              v.destroy()
              engine.current = null
            },
          }
        }}
      />

      {live && (
        <div className="lab-controls">
          <button
            className="btn btn-ghost"
            aria-label="Previous level"
            disabled={level === 0}
            onClick={() => go(level - 1)}
          >
            ‹
          </button>
          <label className="studio-pick">
            <span className="sr-only">Level</span>
            <select value={level} onChange={(e) => go(Number(e.target.value))}>
              {LEVELS.map((q, i) => (
                <option key={q.name} value={i}>
                  {i + 1}. {q.name}
                  {bests[q.name] !== undefined ? ` ${'★'.repeat(stars(q, bests[q.name]))}` : ''}
                </option>
              ))}
            </select>
          </label>
          <button
            className="btn btn-ghost"
            aria-label="Next level"
            disabled={level === LEVELS.length - 1}
            onClick={() => go(level + 1)}
          >
            ›
          </button>
          <button className="btn btn-ghost" onClick={() => restart()}>
            ↺ Restart
          </button>
          <button
            className="btn btn-ghost"
            aria-label={`Time: ${warp} times`}
            onClick={() => setWarp((w) => WARPS[(WARPS.indexOf(w) + 1) % WARPS.length])}
          >
            ⏩ {warp}×
          </button>
          <button
            className="btn btn-ghost"
            aria-pressed={sound}
            onClick={() => setSound((s) => !s)}
          >
            {sound ? '🔔 Sound' : '🔕 Muted'}
          </button>
        </div>
      )}
      {live && (
        <div className="lab-controls orbit-burn">
          <button className="btn" aria-keyshortcuts="ArrowLeft" {...hold(-1)}>
            ◀ Slow down
          </button>
          <span className="lab-score" aria-live="off">
            Δv left {shown.fuel.toFixed(3)} · orbit {f3(shown.peri)}–{f3(shown.apo)}
            {shown.met ? ' · on target' : ''}
          </span>
          <button className="btn" aria-keyshortcuts="ArrowRight" {...hold(1)}>
            Speed up ▶
          </button>
        </div>
      )}
      {live && (
        <p className="muted lab-hint" aria-live="polite">
          {outcome && <strong>{outcome} </strong>}
          {outcome?.startsWith('✨') && level < LEVELS.length - 1 && (
            <>
              <button className="btn" onClick={() => go(level + 1)}>
                Next level ›
              </button>{' '}
            </>
          )}
          Goal: {goalText}. <em>{l.hint}</em> Hold a button to burn — the dotted line is where that
          leaves you. It counts once you are on the goal with the engine off.
          {best !== undefined && ` Your best here: Δv ${best.toFixed(3)}.`} Keys: hold ← or →, W
          time, R restart.
        </p>
      )}
    </div>
  )
}
