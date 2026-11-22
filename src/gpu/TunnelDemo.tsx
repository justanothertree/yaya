import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { touchOnly } from '../ui/pointerKind'
import { LabStage } from './LabStage'
import { useKept } from './kept'
import {
  SPEEDS,
  SPEED_IDS,
  THEMES,
  THEME_IDS,
  TUNNEL_KEY,
  camera,
  fly,
  keptBest,
  readSaved,
  slower,
  takeOff,
  tiltStick,
  type Flight,
  type Speed,
  type Theme,
} from './tunnel'
import { createTunnel } from './tunnelEngine'

type Props = {
  running: boolean
  setRunning: (r: boolean | ((r: boolean) => boolean)) => void
  onAdapter: (adapter: GPUAdapter, format: GPUTextureFormat) => void
}

type Score = Pick<Flight, 'caught' | 'streak' | 'best'>

/** a drag this far from where it started is a full stick, as a share of the canvas's short side */
const STICK_REACH = 0.2

/** iOS asks before it hands over the phone's tilt; everything else just answers */
type AskingOrientation = typeof DeviceOrientationEvent & {
  requestPermission?: () => Promise<'granted' | 'denied'>
}
const canTilt = () => typeof window !== 'undefined' && 'DeviceOrientationEvent' in window

/** Fly down an endless tunnel, catching orbs. Drag to steer — or tilt the phone. */
export function TunnelDemo({ running, setRunning, onAdapter }: Props) {
  const [live, setLive] = useState(false)
  const [speed, pickSpeed] = useState<Speed>('cruise')
  const [saved, setSaved] = useKept(TUNNEL_KEY, readSaved)
  /** the slowest speed flown since take-off: what this flight's streak counts at */
  const slowest = useRef<Speed>(speed)
  const setSpeed = (v: Speed) => {
    pickSpeed(v)
    slowest.current = slower(slowest.current, v)
  }
  const [theme, setTheme] = useState<Theme>('neon')
  const [score, setScore] = useState<Score>({ caught: 0, streak: 0, best: 0 })
  const [tilt, setTilt] = useState<'off' | 'on' | 'refused' | 'silent'>('off')
  const speedRef = useRef(speed)
  speedRef.current = speed
  const themeRef = useRef(theme)
  themeRef.current = theme

  const flight = useRef<Flight>(takeOff())
  /** the stick, from whichever is steering: a finger, the keys, or the tilt */
  const drag = useRef<{ id: number; x0: number; y0: number; stick: [number, number] } | null>(null)
  const keys = useRef(new Set<string>())
  const tilted = useRef<[number, number]>([0, 0])
  const lean = useRef<[number, number]>([0, 0])
  const flash = useRef(0)
  const clock = useRef(0)

  const stick = (): [number, number] => {
    if (drag.current) return drag.current.stick
    const k = keys.current
    const kx = (k.has('right') ? 1 : 0) - (k.has('left') ? 1 : 0)
    const ky = (k.has('up') ? 1 : 0) - (k.has('down') ? 1 : 0)
    if (kx || ky) return [kx, ky]
    return tilted.current
  }

  /* the phone's tilt, measured from how it was held when tilt was turned on */
  useEffect(() => {
    if (tilt !== 'on') return
    let rest: { beta: number; gamma: number } | null = null
    const on = (e: DeviceOrientationEvent) => {
      if (e.beta == null || e.gamma == null) return
      rest ??= { beta: e.beta, gamma: e.gamma }
      tilted.current = tiltStick(e.beta, e.gamma, rest, screen.orientation?.angle ?? 0)
    }
    window.addEventListener('deviceorientation', on)
    /* a yes is not a tilt: a laptop, or a phone whose browser keeps its sensors to itself, says
       yes and then sends nothing — say so rather than leave steering silently dead */
    const quiet = window.setTimeout(() => rest ?? setTilt('silent'), 2000)
    return () => {
      window.clearTimeout(quiet)
      window.removeEventListener('deviceorientation', on)
      tilted.current = [0, 0]
    }
  }, [tilt])

  const toggleTilt = async () => {
    if (tilt === 'on' || tilt === 'silent') return setTilt('off')
    /* ⚠️ CALLED ON THE CLASS, never lifted off it: an unbound requestPermission throws "Illegal
       invocation", which the catch below would report as the phone refusing */
    const DOE = DeviceOrientationEvent as AskingOrientation
    try {
      /* only a 'denied' is a no: Chromium answers 'prompt' where it has nobody to ask, and the
         watchdog above catches a yes that never sends anything */
      setTilt(
        DOE.requestPermission && (await DOE.requestPermission()) === 'denied' ? 'refused' : 'on',
      )
    } catch {
      setTilt('refused')
    }
    if (!running) setRunning(true)
  }

  const restart = () => {
    flight.current = takeOff()
    slowest.current = speedRef.current
    setScore({ caught: 0, streak: 0, best: 0 })
  }

  const KEYS: Record<string, string> = {
    arrowleft: 'left',
    a: 'left',
    arrowright: 'right',
    d: 'right',
    arrowup: 'up',
    w: 'up',
    arrowdown: 'down',
    s: 'down',
  }
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.target !== e.currentTarget) return
    const k = e.key.toLowerCase()
    if (KEYS[k]) keys.current.add(KEYS[k])
    else if (k === ' ') setRunning((r) => !r)
    else if (/^[1-3]$/.test(k)) setSpeed(SPEED_IDS[Number(k) - 1])
    else if (k === 'c') setTheme((t) => THEME_IDS[(THEME_IDS.indexOf(t) + 1) % THEME_IDS.length])
    else if (k === 'r') restart()
    else return
    e.preventDefault()
  }
  const onKeyUp = (e: KeyboardEvent<HTMLDivElement>) => {
    const k = KEYS[e.key.toLowerCase()]
    if (k) keys.current.delete(k)
  }

  const toStick = (e: PointerEvent<HTMLCanvasElement>, d: { x0: number; y0: number }) => {
    const r = e.currentTarget.getBoundingClientRect()
    const reach = Math.min(r.width, r.height) * STICK_REACH
    const c = (v: number) => Math.max(-1, Math.min(1, v / reach))
    /* screen y runs down, the tunnel's up */
    return [c(e.clientX - d.x0), c(d.y0 - e.clientY)] as [number, number]
  }

  return (
    <div
      className="lab-keys"
      tabIndex={0}
      onKeyDown={onKey}
      onKeyUp={onKeyUp}
      onBlur={() => keys.current.clear()}
      aria-label="Tunnel"
    >
      <LabStage
        label="Flying down an endless glowing tunnel, steering to catch orbs of light"
        running={running}
        onAdapter={onAdapter}
        onLive={setLive}
        /* every pixel marches a ray up to 96 steps: a phone's 2× is four times the work for
           detail that a tunnel at speed does not show */
        maxDpr={touchOnly() ? 1 : 1.5}
        make={async ({ device, context, format, canvas }) => {
          const view = await createTunnel(device, context, format)
          return {
            frame: (dt) => {
              const s = stick()
              const v = SPEEDS[speedRef.current][1]
              if (dt > 0) {
                const before = flight.current
                const r = fly(before, dt, s, v)
                flight.current = r.f
                if (r.caught) flash.current = 1
                if (r.f.caught !== before.caught || r.f.missed !== before.missed) {
                  setScore({ caught: r.f.caught, streak: r.f.streak, best: r.f.best })
                  if (r.f.best > before.best) {
                    const at = slowest.current
                    setSaved((x) => keptBest(x, at, r.f.best))
                  }
                }
                flash.current = Math.max(0, flash.current - dt * 3)
                clock.current += dt
                const k = Math.min(1, dt * 6)
                lean.current = [
                  lean.current[0] + (s[0] - lean.current[0]) * k,
                  lean.current[1] + (s[1] - lean.current[1]) * k,
                ]
              }
              view.draw({
                cam: camera(flight.current, lean.current),
                time: clock.current,
                aspect: canvas.width / Math.max(1, canvas.height),
                speed: v,
                flash: flash.current,
                f: flight.current,
                theme: themeRef.current,
              })
            },
            destroy: () => view.destroy(),
          }
        }}
        onPointerDown={(e) => {
          drag.current = { id: e.pointerId, x0: e.clientX, y0: e.clientY, stick: [0, 0] }
          if (!running) setRunning(true)
        }}
        onPointerMove={(e) => {
          const d = drag.current
          if (d && d.id === e.pointerId) d.stick = toStick(e, d)
        }}
        onPointerUp={(e) => {
          if (drag.current?.id === e.pointerId) drag.current = null
        }}
      />

      {live && (
        <div className="lab-controls">
          <button className="btn" onClick={() => setRunning((r) => !r)} aria-pressed={running}>
            {running ? '⏸ Pause' : '▶ Fly'}
          </button>
          <span className="lab-score">
            ✨ {score.caught} · streak {score.streak} · best {score.best}
          </span>
          <button className="btn btn-ghost" onClick={restart}>
            ↺ Start over
          </button>
          <div className="lab-group" role="group" aria-label="Speed">
            {SPEED_IDS.map((s) => (
              <button
                key={s}
                className="btn btn-ghost"
                aria-pressed={speed === s}
                onClick={() => setSpeed(s)}
              >
                {SPEEDS[s][0]}
              </button>
            ))}
          </div>
          <div className="lab-group" role="group" aria-label="Colours">
            {THEME_IDS.map((t) => (
              <button
                key={t}
                className="btn btn-ghost"
                aria-pressed={theme === t}
                onClick={() => setTheme(t)}
              >
                {THEMES[t]}
              </button>
            ))}
          </div>
          {touchOnly() && canTilt() && (
            <button className="btn btn-ghost" aria-pressed={tilt === 'on'} onClick={toggleTilt}>
              📱 Tilt to steer
            </button>
          )}
        </div>
      )}

      {live && SPEED_IDS.some((v) => saved.best[v] > 0) && (
        <p className="sun-reading">
          <span className="muted">
            Longest streak without a miss:{' '}
            {SPEED_IDS.filter((v) => saved.best[v] > 0)
              .map((v) => `${saved.best[v]} at ${SPEEDS[v][0]}`)
              .join(', ')}
          </span>
        </p>
      )}
      {live && (
        <p className="muted lab-hint">
          {tilt === 'refused'
            ? 'The phone would not share its tilt — drag to steer instead. '
            : tilt === 'silent'
              ? 'No tilt is arriving from this device — drag to steer instead. '
              : tilt === 'on'
                ? 'Tilt the phone to steer, from however you were holding it when you turned tilt on. '
                : 'Press and drag to steer, like a stick: the further from where you pressed, the harder you turn. '}
          Fly through the orbs to catch them. The tunnel has no geometry at all — every pixel feels
          its way along a ray until it touches a wall.
          {!touchOnly() &&
            ' Keys, once it has focus: arrows or WASD steer, Space pauses, 1–3 speed, C colours, R starts over.'}
        </p>
      )}
    </div>
  )
}
