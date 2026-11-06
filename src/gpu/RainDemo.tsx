import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { readLevel } from '../audio/audioTap'
import { localMicOn, startLocalMic, stopLocalMic } from '../audio/localMic'
import { touchOnly } from '../ui/pointerKind'
import { LabStage } from './LabStage'
import {
  CLING,
  MAX_DROPS,
  blurStreet,
  breathFrom,
  packDrops,
  paintStreet,
  raindrop,
  stepDrops,
  wipeDrops,
  type Drop,
  type Wipe,
} from './rain'
import { createRain, type RainView } from './rainEngine'

type Props = {
  running: boolean
  setRunning: (r: boolean | ((r: boolean) => boolean)) => void
  onAdapter: (adapter: GPUAdapter, format: GPUTextureFormat) => void
}

type V2 = [number, number]
type Tool = 'wipe' | 'drop' | 'tilt'
const TOOLS: Record<Tool, string> = { wipe: '☝️ Wipe', drop: '💧 Drip', tilt: '↻ Tilt' }
const TOOL_IDS = Object.keys(TOOLS) as Tool[]
/** gravity, in CSS px a second² */
const G = 900
/** a finger's half-width, in CSS px */
const BRUSH = 16
/** drops a second, from a drizzle to a downpour, on a slider of 0..1 */
const rainRate = (x: number) => 60 * x * x
/** how much of the window fogs back over in a second when nobody is breathing on it */
const REGROW = 0.025
type Orientation = typeof DeviceOrientationEvent & { requestPermission?: () => Promise<string> }
const canTilt = () => typeof window !== 'undefined' && 'DeviceOrientationEvent' in window

/**
 * A rainy window at dusk. Rain lands, clings, gathers and runs; drag a finger through the mist,
 * breathe on the glass (with the mic, or by holding 🌬) to fog it again, and tilt it to make the
 * water run another way.
 */
export function RainDemo({ running, setRunning, onAdapter }: Props) {
  const [live, setLive] = useState(false)
  const [tool, setTool] = useState<Tool>('wipe')
  const [rain, setRain] = useState(0.45)
  const [micOn, setMicOn] = useState(localMicOn)
  const [note, setNote] = useState<string | null>(null)
  const [tilting, setTilting] = useState(false)
  const [tiltRefused, setTiltRefused] = useState(false)
  const now = useRef({ tool, rain, micOn, running })
  now.current = { tool, rain, micOn, running }

  const engine = useRef<RainView | null>(null)
  const drops = useRef<Drop[]>([])
  const wipes = useRef<Wipe[]>([])
  /** which way is down on the glass, as an angle from straight down */
  const angle = useRef(0)
  const breath = useRef(0)
  const holding = useRef(false)
  const finger = useRef<V2 | null>(null)
  const ids = useRef(0)
  const redraw = useRef<() => void>(() => {})
  const size = useRef<V2>([1, 1])

  /** false once the toy has unmounted, so a prompt that resolves late cannot leave the mic on */
  const here = useRef(true)
  /* the mic goes when you do — the rule every Lab toy with a microphone keeps */
  useEffect(
    () => () => {
      here.current = false
      stopLocalMic()
    },
    [],
  )

  /* tilting the phone turns which way the water runs: it always runs downhill */
  useEffect(() => {
    if (!tilting) return
    const on = (e: DeviceOrientationEvent) => {
      if (e.gamma === null) return
      angle.current = Math.max(-1.4, Math.min(1.4, (-e.gamma * Math.PI) / 180))
    }
    window.addEventListener('deviceorientation', on)
    return () => window.removeEventListener('deviceorientation', on)
  }, [tilting])

  const toggleTilt = async () => {
    if (tilting) return setTilting(false)
    const O = DeviceOrientationEvent as Orientation
    const answer = O.requestPermission
      ? await O.requestPermission().catch(() => 'denied')
      : 'granted'
    setTiltRefused(answer !== 'granted')
    if (answer === 'granted') {
      setTilting(true)
      if (!running) setRunning(true)
    }
  }

  const toggleMic = async () => {
    if (localMicOn()) {
      stopLocalMic()
      setMicOn(false)
      return
    }
    const ok = await startLocalMic()
    if (!here.current) {
      stopLocalMic()
      return
    }
    setMicOn(ok)
    setNote(ok ? null : 'The microphone was not allowed, or there is not one — hold 🌬 instead.')
    if (ok && !running) setRunning(true)
  }

  const clearAll = () => {
    drops.current = []
    engine.current?.fogAll(0)
    redraw.current()
  }
  const fogAll = () => {
    engine.current?.fogAll(0.9)
    redraw.current()
  }

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.target !== e.currentTarget) return
    const k = e.key.toLowerCase()
    if (k === 'arrowleft' || k === 'arrowright')
      angle.current = Math.max(
        -1.4,
        Math.min(1.4, angle.current + (k === 'arrowleft' ? 0.2 : -0.2)),
      )
    else if (k === 'arrowdown') angle.current = 0
    else if (k === 'arrowup' || k === '-' || k === '=' || k === '+')
      setRain((r) => Math.max(0, Math.min(1, r + (k === '-' ? -0.1 : 0.1))))
    else if (k === 'f') fogAll()
    else if (k === 'c') clearAll()
    else if (/^[1-3]$/.test(k)) setTool(TOOL_IDS[Number(k) - 1])
    else if (k === ' ') setRunning((r) => !r)
    else return
    e.preventDefault()
  }

  const at = (e: PointerEvent<HTMLCanvasElement>): V2 => {
    const r = e.currentTarget.getBoundingClientRect()
    return [e.clientX - r.left, e.clientY - r.top]
  }
  /* a drag with Tilt turns the glass: down is wherever the finger is from the middle */
  const tiltTo = (p: V2) => {
    const [w, h] = size.current
    angle.current = Math.max(
      -1.4,
      Math.min(1.4, Math.atan2(-(p[0] - w / 2), Math.max(1, p[1] - h / 3))),
    )
  }
  const drip = (p: V2, r: number) => {
    if (drops.current.length < MAX_DROPS)
      drops.current.push({ x: p[0], y: p[1], r, vx: 0, vy: 0, run: 0, id: ids.current++ })
  }

  return (
    <div className="lab-keys" tabIndex={0} onKeyDown={onKey} aria-label="Rain on glass">
      <LabStage
        label="A misted window with rain running down it, and a city at dusk blurred behind"
        running={running}
        onAdapter={onAdapter}
        onLive={setLive}
        maxDpr={1.5}
        make={async ({ device, context, format, canvas }) => {
          const v = await createRain(device, context, format, canvas)
          engine.current = v
          const scale = () => canvas.width / Math.max(1, canvas.clientWidth || canvas.width)
          const paint = () => {
            size.current = [
              canvas.clientWidth || canvas.width,
              canvas.clientHeight || canvas.height,
            ]
            const street = paintStreet(Math.max(1, canvas.width), Math.max(1, canvas.height))
            v.street(street, blurStreet(street, 9 * scale()))
          }
          paint()
          const scratch = new Uint8Array(4096)
          const draw = (dt: number) => {
            const [w, h] = size.current
            const g: V2 = [-Math.sin(angle.current) * G, Math.cos(angle.current) * G]
            if (dt > 0) {
              const n = rainRate(now.current.rain) * dt
              const fall = Math.floor(n) + (Math.random() < n % 1 ? 1 : 0)
              for (let k = 0; k < fall && drops.current.length < MAX_DROPS; k++)
                drops.current.push(raindrop(w, h, Math.random, ids.current++))
              drops.current = stepDrops(
                drops.current,
                g,
                dt,
                w,
                h,
                Math.random,
                () => ids.current++,
              )
              const level = now.current.micOn ? readLevel('local', scratch) : 0
              breath.current = breathFrom(holding.current ? 0.7 : level, breath.current, dt)
            }
            const s = scale()
            const wiped = wipes.current
            wipes.current = []
            if (wiped.length) drops.current = wipeDrops(drops.current, wiped, BRUSH)
            v.frame(
              packDrops(drops.current, s),
              drops.current.length,
              wiped.map((x) => x.map((c) => c * s) as unknown as Wipe),
              {
                fall: [g[0] / G, g[1] / G],
                dt,
                regrow: REGROW,
                breath: breath.current,
                brush: BRUSH * s,
              },
            )
          }
          redraw.current = () => {
            /* paused, a stroke still shows: the frame is drawn with no time passing. Read from the
               ref — `make` runs once, and `running` here would be whatever it was then */
            if (!now.current.running) draw(0)
          }
          return {
            frame: draw,
            resize: () => {
              v.resize()
              paint()
            },
            destroy: () => {
              v.destroy()
              engine.current = null
              redraw.current = () => {}
            },
          }
        }}
        onPointerDown={(e) => {
          const p = at(e)
          finger.current = p
          const t = now.current.tool
          if (t === 'wipe') wipes.current.push([p[0], p[1], p[0], p[1]])
          else if (t === 'drop') drip(p, CLING * 1.9)
          else tiltTo(p)
          redraw.current()
        }}
        onPointerMove={(e) => {
          const from = finger.current
          if (!from) return
          const p = at(e)
          const t = now.current.tool
          if (t === 'wipe') wipes.current.push([from[0], from[1], p[0], p[1]])
          else if (t === 'drop') {
            /* a line of water, a drop every few px, that gathers into one and runs */
            if (Math.hypot(p[0] - from[0], p[1] - from[1]) < 6) return
            drip(p, CLING * 0.9)
          } else tiltTo(p)
          finger.current = p
          redraw.current()
        }}
        onPointerUp={() => {
          finger.current = null
        }}
      />

      {live && (
        <div className="lab-controls">
          <button className="btn" onClick={() => setRunning((r) => !r)} aria-pressed={running}>
            {running ? '⏸ Pause' : '▶ Run'}
          </button>
          <div className="lab-group" role="group" aria-label="What a finger does">
            {TOOL_IDS.map((t) => (
              <button
                key={t}
                className="btn btn-ghost"
                aria-pressed={tool === t}
                onClick={() => setTool(t)}
              >
                {TOOLS[t]}
              </button>
            ))}
          </div>
          <button
            className="btn btn-ghost"
            onPointerDown={(e) => {
              /* held, not toggled: a breath lasts as long as you keep blowing */
              e.currentTarget.setPointerCapture?.(e.pointerId)
              holding.current = true
              if (!running) setRunning(true)
            }}
            onPointerUp={() => {
              holding.current = false
            }}
            onPointerCancel={() => {
              holding.current = false
            }}
            onKeyDown={(e) => {
              if (e.key === ' ' || e.key === 'Enter') holding.current = true
            }}
            onKeyUp={() => {
              holding.current = false
            }}
          >
            🌬 Hold to breathe
          </button>
          <button className="btn btn-ghost" aria-pressed={micOn} onClick={() => void toggleMic()}>
            🎤 {micOn ? 'Blowing into the mic' : 'Blow into the mic'}
          </button>
          {touchOnly() && canTilt() && (
            <button
              className="btn btn-ghost"
              aria-pressed={tilting}
              onClick={() => void toggleTilt()}
            >
              📱 Tilt
            </button>
          )}
          <label className="appearance-slider lab-flow">
            <span className="muted">Rain</span>
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={rain}
              onChange={(e) => setRain(Number(e.target.value))}
            />
            <span className="appearance-slider-val">
              {rain === 0 ? 'none' : rain < 0.35 ? 'drizzle' : rain < 0.75 ? 'rain' : 'downpour'}
            </span>
          </label>
          <button className="btn btn-ghost" onClick={fogAll}>
            Fog it
          </button>
          <button className="btn btn-ghost" onClick={clearAll}>
            Dry it
          </button>
          {tiltRefused && (
            <span className="muted">Tilt isn’t allowed here — drag with ↻ Tilt instead.</span>
          )}
        </div>
      )}

      {live && (
        <p className="muted lab-hint" aria-live="polite">
          {note && <>{note} </>}
          Write in the mist with ☝️ Wipe; it fogs slowly back. Breathe on it — hold 🌬, or blow into
          the mic — and it mists over where your face would be. Drops cling until enough rain has
          joined them, then run, leaving a clean trail and a line of droplets; 💧 Drip adds your
          own. Turn the glass with ↻ Tilt{touchOnly() && canTilt() ? ' or 📱 Tilt' : ''} and the
          water runs the new way. Each drop is a bump in a field the GPU sums, so drops that touch
          become one shape, and each pixel of water bends the street behind it like a lens. The mic
          is only listened to for loudness, and nothing leaves this device.
          {!touchOnly() &&
            ' Keys, once it has focus: ← → turn the glass, ↓ straightens it, − + rain, F fog, C dry, 1–3 tool, Space pause.'}
        </p>
      )}
    </div>
  )
}
