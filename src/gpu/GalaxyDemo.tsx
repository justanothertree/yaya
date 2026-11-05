import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { touchOnly } from '../ui/pointerKind'
import { createEar } from './ear'
import { STAR_COUNTS, STAR_TOUCH_CEILING, dragView } from './galaxy'
import { createGalaxy, type GalaxyInput } from './galaxyEngine'
import { LabStage } from './LabStage'
import { countLabel } from './swarm'

type Props = {
  running: boolean
  setRunning: (r: boolean | ((r: boolean) => boolean)) => void
  onAdapter: (adapter: GPUAdapter, format: GPUTextureFormat) => void
}

/** A spiral galaxy that breathes with the music. Drag to turn it and tilt it. */
export function GalaxyDemo({ running, setRunning, onAdapter }: Props) {
  const [live, setLive] = useState(false)
  const offered = STAR_COUNTS.filter((n) => !touchOnly() || n <= STAR_TOUCH_CEILING)
  const [count, setCount] = useState<number>(1 << 17)
  const [spin, setSpin] = useState(1)
  const [twist, setTwist] = useState(7)
  const [listen, setListen] = useState(true)
  const listenRef = useRef(listen)
  listenRef.current = listen
  const runningRef = useRef(running)
  runningRef.current = running

  const input = useRef<GalaxyInput>({
    count: 1 << 17,
    spin: 1,
    twist: 7,
    tilt: 0.55,
    turn: 0,
    pulse: 0,
    kick: 0,
  })
  const i = input.current
  i.count = count
  i.spin = spin
  i.twist = twist
  const redraw = useRef<() => void>(() => {})
  const drags = useRef(new Map<number, { x: number; y: number }>())

  const look = (turn: number, tilt: number) => {
    i.turn = turn
    i.tilt = tilt
    redraw.current()
  }

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.target !== e.currentTarget) return
    const k = e.key.toLowerCase()
    const step = (dx: number, dy: number) => {
      const v = dragView(i, dx, dy, 360, 360)
      look(v.turn, v.tilt)
    }
    if (k === ' ') setRunning((r) => !r)
    else if (k === 'l') setListen((v) => !v)
    else if (k === '0') look(i.turn, 0)
    else if (k === 'arrowleft') step(-10, 0)
    else if (k === 'arrowright') step(10, 0)
    else if (k === 'arrowup') step(0, -10)
    else if (k === 'arrowdown') step(0, 10)
    else return
    e.preventDefault()
  }

  return (
    <div className="lab-keys" tabIndex={0} onKeyDown={onKey} aria-label="Galaxy">
      <LabStage
        label="A spiral galaxy of glowing stars, turning slowly and pulsing with the music"
        running={running}
        onAdapter={onAdapter}
        onLive={setLive}
        make={async ({ device, context, format, canvas }) => {
          const g = await createGalaxy(device, context, format, canvas)
          const ear = createEar()
          redraw.current = () => {
            if (!runningRef.current) g.frame(0, i)
          }
          return {
            frame: (dt) => {
              /* listening: it swells with the loudness and flares on every kick; deaf, it rests */
              const heard = listenRef.current ? ear.hear(dt) : null
              i.pulse = heard ? Math.min(1, heard.level * 2) : 0
              i.kick = heard?.hit ? 1 : i.kick * Math.exp(-dt * 5)
              g.frame(dt, i)
            },
            destroy: () => {
              g.destroy()
              redraw.current = () => {}
            },
          }
        }}
        onPointerDown={(e: PointerEvent<HTMLCanvasElement>) => {
          drags.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
        }}
        onPointerMove={(e) => {
          const d = drags.current.get(e.pointerId)
          if (!d) return
          const r = e.currentTarget.getBoundingClientRect()
          const v = dragView(i, e.clientX - d.x, e.clientY - d.y, r.width, r.height)
          drags.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
          look(v.turn, v.tilt)
        }}
        onPointerUp={(e) => {
          drags.current.delete(e.pointerId)
        }}
      />

      {live && (
        <div className="lab-controls">
          <button className="btn" onClick={() => setRunning((r) => !r)} aria-pressed={running}>
            {running ? '⏸ Pause' : '▶ Run'}
          </button>
          <button
            className="btn btn-ghost"
            aria-pressed={listen}
            onClick={() => setListen((v) => !v)}
          >
            🎵 Listen
          </button>
          <button className="btn btn-ghost" onClick={() => look(i.turn, 0)}>
            Face on
          </button>
          <div className="lab-group" role="group" aria-label="How many stars">
            {offered.map((n) => (
              <button
                key={n}
                className="btn btn-ghost"
                aria-pressed={count === n}
                onClick={() => {
                  setCount(n)
                  i.count = n
                  redraw.current()
                }}
              >
                {countLabel(n)}
              </button>
            ))}
          </div>
          <label className="appearance-slider lab-flow">
            <span className="muted">Spin</span>
            <input
              type="range"
              min={0}
              max={3}
              step={0.05}
              value={spin}
              onChange={(e) => setSpin(Number(e.target.value))}
            />
            <span className="appearance-slider-val">{spin.toFixed(2)}×</span>
          </label>
          <label className="appearance-slider lab-flow">
            <span className="muted">Arms</span>
            <input
              type="range"
              min={0}
              max={14}
              step={0.5}
              value={twist}
              onChange={(e) => {
                setTwist(Number(e.target.value))
                i.twist = Number(e.target.value)
                redraw.current()
              }}
            />
            <span className="appearance-slider-val">{twist === 0 ? 'bar' : twist.toFixed(1)}</span>
          </label>
        </div>
      )}

      {live && (
        <p className="muted lab-hint">
          Drag across to turn it, up and down to tilt it. {countLabel(count)} stars, each one worked
          out on the GPU from nothing but its own number. The arms are not made of stars — every
          star moves through them, and Arms at 0 shows the bar they come from. With 🎵 Listen on it
          breathes with whatever this site is playing and every kick flares the stars: start a song
          in Music and come back.
          {!touchOnly() &&
            ' Keys, once it has focus: Space pauses, arrows turn and tilt, 0 faces it on, L listens.'}
        </p>
      )}
    </div>
  )
}
