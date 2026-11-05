import { useEffect, useRef, useState, type PointerEvent } from 'react'
import { touchOnly } from '../ui/pointerKind'
import { LabStage } from './LabStage'
import { COUNTS, DEFAULT_COUNT, TOUCH_CEILING, countLabel, countsFor, toWorld } from './swarm'
import { createSwarm, type Swarm, type SwarmInput } from './swarmEngine'

type Props = {
  running: boolean
  setRunning: (r: boolean | ((r: boolean) => boolean)) => void
  onAdapter: (adapter: GPUAdapter, format: GPUTextureFormat) => void
}

/** the colourings on offer, in the order of `palette` in swarm-types.wgsl */
const PALETTES = ['Speed', 'Rainbow', 'Fire'] as const

/** Particles carried by a swirling current; a press pulls them in or pushes them away. */
export function SwarmDemo({ running, setRunning, onAdapter }: Props) {
  const swarmRef = useRef<Swarm | null>(null)
  const [live, setLive] = useState(false)
  const [counts, setCounts] = useState<number[]>([...COUNTS])
  const [count, setCount] = useState(DEFAULT_COUNT)
  const [flow, setFlow] = useState(1)
  const [direction, setDirection] = useState<1 | -1>(1)
  const [palette, setPalette] = useState(0)

  const input = useRef<SwarmInput>({ pointer: null, direction: 1, flow: 1, palette: 0 })
  input.current.direction = direction
  input.current.flow = flow
  input.current.palette = palette
  const countRef = useRef(count)
  countRef.current = count
  const runningRef = useRef(running)
  runningRef.current = running

  /* a new count is a new buffer; a still swarm shows the new scatter at once */
  useEffect(() => {
    const swarm = swarmRef.current
    if (!swarm) return
    swarm.setCount(count)
    if (!runningRef.current) swarm.frame(0, input.current)
  }, [count])

  const press = (e: PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    input.current.pointer = toWorld(e.clientX - r.left, e.clientY - r.top, r.width, r.height)
  }

  return (
    <>
      <LabStage
        label="A field of glowing particles carried by a slow, swirling current"
        running={running}
        onAdapter={onAdapter}
        onLive={setLive}
        make={async ({ device, context, format, canvas }) => {
          /* the DEVICE's limits, which are what every buffer and dispatch is checked against —
             see countsFor */
          const offered = countsFor(device.limits, touchOnly() ? TOUCH_CEILING : Infinity)
          setCounts(offered)
          const first = offered.includes(countRef.current) ? countRef.current : offered[0]
          if (first !== countRef.current) setCount(first)
          const swarm = await createSwarm(device, context, format, canvas, first)
          swarmRef.current = swarm
          return {
            frame: (dt) => swarm.frame(dt, input.current),
            destroy: () => {
              swarm.destroy()
              swarmRef.current = null
            },
          }
        }}
        onPointerDown={press}
        onPointerMove={(e) => {
          if (input.current.pointer) press(e)
        }}
        onPointerUp={() => {
          input.current.pointer = null
        }}
      />

      {live && (
        <div className="lab-controls">
          <button className="btn" onClick={() => setRunning((r) => !r)} aria-pressed={running}>
            {running ? '⏸ Pause' : '▶ Run'}
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => {
              swarmRef.current?.scatter()
              if (!running) swarmRef.current?.frame(0, input.current)
            }}
          >
            ↺ Scatter
          </button>

          <div className="lab-group" role="group" aria-label="What a press does">
            <button
              className="btn btn-ghost"
              aria-pressed={direction === 1}
              onClick={() => setDirection(1)}
            >
              Pull
            </button>
            <button
              className="btn btn-ghost"
              aria-pressed={direction === -1}
              onClick={() => setDirection(-1)}
            >
              Push
            </button>
          </div>

          <div className="lab-group" role="group" aria-label="Colour">
            {PALETTES.map((name, i) => (
              <button
                key={name}
                className="btn btn-ghost"
                aria-pressed={palette === i}
                onClick={() => {
                  setPalette(i)
                  input.current.palette = i
                  if (!runningRef.current) swarmRef.current?.frame(0, input.current)
                }}
              >
                {name}
              </button>
            ))}
          </div>

          <div className="lab-group" role="group" aria-label="How many particles">
            {counts.map((n) => (
              <button
                key={n}
                className="btn btn-ghost"
                aria-pressed={count === n}
                onClick={() => setCount(n)}
              >
                {countLabel(n)}
              </button>
            ))}
          </div>

          <label className="appearance-slider lab-flow">
            <span className="muted">Current</span>
            <input
              type="range"
              min={0}
              max={2}
              step={0.05}
              value={flow}
              onChange={(e) => setFlow(Number(e.target.value))}
            />
            <span className="appearance-slider-val">{flow.toFixed(2)}×</span>
          </label>
        </div>
      )}

      {live && (
        <p className="muted lab-hint">
          {direction === 1
            ? 'Press and drag to pull them in.'
            : 'Press and drag to push them away.'}{' '}
          {countLabel(count)} particles, every one moved by your graphics card each frame — the page
          itself never touches them.
        </p>
      )}
    </>
  )
}
