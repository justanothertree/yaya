import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { readLevel } from '../audio/audioTap'
import { localMicOn, startLocalMic, stopLocalMic } from '../audio/localMic'
import { touchOnly } from '../ui/pointerKind'
import { LabStage } from './LabStage'
import {
  EDGE,
  SPEEDS,
  WEATHERS,
  breathFrom,
  planeToCell,
  stepsFor,
  type Speed,
  type WeatherId,
} from './snowflake'
import { createSnowflake, type SnowflakeView } from './snowflakeEngine'

type Props = {
  running: boolean
  setRunning: (r: boolean | ((r: boolean) => boolean)) => void
  onAdapter: (adapter: GPUAdapter, format: GPUTextureFormat) => void
}

const WEATHER_IDS = Object.keys(WEATHERS) as WeatherId[]
const SPEED_IDS = Object.keys(SPEEDS) as Speed[]

/**
 * A snow crystal growing from a speck of ice. Blow on the microphone and the air grows damper and
 * it grows faster and wilder; hold a finger to breathe on one part of it; change the weather and
 * the next one grows as a plate, a star or a fern.
 */
export function SnowflakeDemo({ running, setRunning, onAdapter }: Props) {
  const [live, setLive] = useState(false)
  const [weather, setWeather] = useState<WeatherId>('star')
  const [speed, setSpeed] = useState<Speed>('brisk')
  const [sym, setSym] = useState(true)
  const [mic, setMic] = useState(localMicOn)
  const [note, setNote] = useState<string | null>(null)
  const [breathShown, setBreathShown] = useState(0)
  const now = useRef({ weather, speed, sym, mic })
  now.current = { weather, speed, sym, mic }

  const engine = useRef<SnowflakeView | null>(null)
  /** the finger breathing on it, in axial cells from the middle */
  const finger = useRef<readonly [number, number] | null>(null)
  const redraw = useRef<() => void>(() => {})

  /* leaving the toy turns the microphone off: the browser's recording light must not outlive it */
  useEffect(() => () => stopLocalMic(), [])

  const fresh = (id = now.current.weather) => {
    setWeather(id)
    engine.current?.reset(WEATHERS[id].beta)
    redraw.current()
  }

  const toggleMic = async () => {
    if (localMicOn()) {
      stopLocalMic()
      setMic(false)
      return
    }
    const ok = await startLocalMic()
    setMic(ok)
    setNote(
      ok ? null : 'The microphone was not allowed, or there is not one — a finger breathes too.',
    )
    if (ok && !running) setRunning(true)
  }

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.target !== e.currentTarget) return
    const k = e.key.toLowerCase()
    if (k === ' ') setRunning((r) => !r)
    else if (k === 'n') fresh()
    else if (k === 'm') void toggleMic()
    else if (k === 'x') setSym((s) => !s)
    else if (/^[1-4]$/.test(k)) fresh(WEATHER_IDS[Number(k) - 1])
    else return
    e.preventDefault()
  }

  /** where a pointer is, in axial cells from the middle — the same fit the shader draws with */
  const toCell = (e: PointerEvent<HTMLCanvasElement>): readonly [number, number] => {
    const r = e.currentTarget.getBoundingClientRect()
    const aspect = r.width / r.height
    const fit = (EDGE + 4) * (aspect < 1 ? 1 / aspect : 1)
    const x = (((e.clientX - r.left) / r.width) * 2 - 1) * aspect * fit
    const y = (((e.clientY - r.top) / r.height) * 2 - 1) * fit
    return planeToCell(x, y)
  }

  return (
    <div className="lab-keys" tabIndex={0} onKeyDown={onKey} aria-label="Snowflake">
      <LabStage
        label="A snow crystal growing six feathered arms in the dark"
        running={running}
        onAdapter={onAdapter}
        onLive={setLive}
        maxDpr={1.5}
        make={async ({ device, context, format, canvas }) => {
          const v = await createSnowflake(device, context, format)
          engine.current = v
          v.reset(WEATHERS[now.current.weather].beta)
          const scratch = new Uint8Array(2048)
          let breath = 0
          let shown = 0
          let carry = 0
          const draw = (dt: number) => {
            const n = now.current
            const [steps, left] = stepsFor(WEATHERS[n.weather].pace, SPEEDS[n.speed][1], dt, carry)
            carry = left
            if (n.mic) {
              breath = breathFrom(breath, readLevel('local', scratch), dt)
              /* the meter only redraws when it moves by a step a person could see */
              const step = Math.round(breath * 10)
              if (step !== shown) {
                shown = step
                setBreathShown(step / 10)
              }
            } else breath = 0
            v.frame(
              {
                w: canvas.width,
                h: canvas.height,
                weather: WEATHERS[n.weather],
                breath,
                finger: finger.current,
                sym: n.sym,
              },
              steps,
            )
          }
          redraw.current = () => draw(0)
          return {
            frame: draw,
            destroy: () => {
              v.destroy()
              engine.current = null
              redraw.current = () => {}
            },
          }
        }}
        onPointerDown={(e) => {
          finger.current = toCell(e)
          if (!running) setRunning(true)
        }}
        onPointerMove={(e) => {
          if (finger.current) finger.current = toCell(e)
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
          <button className="btn btn-ghost" onClick={() => fresh()}>
            ↺ New flake
          </button>
          <button className="btn btn-ghost" aria-pressed={mic} onClick={() => void toggleMic()}>
            🎤 Breathe
          </button>
          <div className="lab-group" role="group" aria-label="Weather">
            {WEATHER_IDS.map((w) => (
              <button
                key={w}
                className="btn btn-ghost"
                aria-pressed={weather === w}
                onClick={() => fresh(w)}
              >
                {WEATHERS[w].name}
              </button>
            ))}
          </div>
          <div className="lab-group" role="group" aria-label="How fast it grows">
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
          <button className="btn btn-ghost" aria-pressed={sym} onClick={() => setSym((s) => !s)}>
            ❄ Six-fold
          </button>
          {mic && (
            <span className="muted" aria-live="off">
              Breath {'▮'.repeat(Math.round(breathShown * 5)).padEnd(5, '▯')}
            </span>
          )}
          {note && <span className="muted">{note}</span>}
        </div>
      )}

      {live && (
        <p className="muted lab-hint">
          A speck of ice in cold, damp air. Every cell of the air passes its water to its
          neighbours, and the ice takes what reaches it — so the tips, reaching furthest into the
          damp, grow fastest, and branch. Nobody tells it to be six-sided: ice is, and the air round
          it is the same on every side. Blow on the microphone with 🎤 Breathe and the air grows
          damper; hold a finger on it to breathe on one spot — with ❄ Six-fold on, the breath lands
          six ways round, as still air round a real crystal does; turn it off and see how lopsided
          one breath makes it. The weather decides the shape: plates in some, stars in others, ferns
          in the dampest.
          {!touchOnly() &&
            ' Keys, once it has focus: Space pauses, N new flake, M breathe, X six-fold, 1–4 weather.'}
        </p>
      )}
    </div>
  )
}
