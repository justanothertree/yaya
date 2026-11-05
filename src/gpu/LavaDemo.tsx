import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { touchOnly } from '../ui/pointerKind'
import { LabStage } from './LabStage'
import { blobAt, fill, stepLamp, type Blob } from './lava'
import { createLavaLamp } from './lavaEngine'

type Props = {
  running: boolean
  setRunning: (r: boolean | ((r: boolean) => boolean)) => void
  onAdapter: (adapter: GPUAdapter, format: GPUTextureFormat) => void
}

/** the colour schemes, in the order of `scheme` in lava.wgsl */
const SCHEMES = ['Classic', 'Ocean', 'Slime', 'Neon'] as const
const AMOUNTS = { Little: 6, Some: 10, Lots: 16 } as const
type Amount = keyof typeof AMOUNTS

/** A lava lamp: wax heated by the bulb rises, cools at the top and sinks. Reach in and stir. */
export function LavaDemo({ running, setRunning, onAdapter }: Props) {
  const [live, setLive] = useState(false)
  const [scheme, setScheme] = useState(0)
  const [power, setPower] = useState(1)
  const [amount, setAmount] = useState<Amount>('Some')
  const schemeRef = useRef(scheme)
  schemeRef.current = scheme
  const powerRef = useRef(power)
  powerRef.current = power
  const runningRef = useRef(running)
  runningRef.current = running

  const blobs = useRef<Blob[]>(fill(AMOUNTS.Some))
  const time = useRef(0)
  const redraw = useRef<() => void>(() => {})
  /** the blob a finger is holding, and where the finger was, for the fling on letting go */
  const grabbed = useRef(
    new Map<number, { i: number; x: number; y: number; t: number; vx: number; vy: number }>(),
  )
  const aspect = useRef(1)

  const refill = (a: Amount) => {
    setAmount(a)
    blobs.current = fill(AMOUNTS[a])
    grabbed.current.clear()
    redraw.current()
  }
  const shake = () => {
    for (const b of blobs.current) {
      b.vx += (Math.random() - 0.5) * 0.8
      b.vy += (Math.random() - 0.5) * 0.8
    }
    if (!runningRef.current) setRunning(true)
  }

  const at = (e: PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height }
  }

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.target !== e.currentTarget) return
    const k = e.key.toLowerCase()
    if (k === ' ') setRunning((r) => !r)
    else if (k === 'k') shake()
    else if (/^[1-4]$/.test(k)) setScheme(Number(k) - 1)
    else return
    e.preventDefault()
  }

  return (
    <div className="lab-keys" tabIndex={0} onKeyDown={onKey} aria-label="Lava lamp">
      <LabStage
        label="A lava lamp: glowing wax rising from the bulb, cooling at the top and sinking again"
        running={running}
        onAdapter={onAdapter}
        onLive={setLive}
        make={async ({ device, context, format, canvas }) => {
          const lamp = await createLavaLamp(device, context, format, canvas)
          const draw = () => lamp.draw(blobs.current, time.current, schemeRef.current)
          redraw.current = () => {
            if (!runningRef.current) draw()
          }
          return {
            frame: (dt) => {
              aspect.current = canvas.width / canvas.height
              time.current += dt
              /* a held blob goes where the finger is, and the lamp carries on round it */
              stepLamp(blobs.current, dt, {
                aspect: aspect.current,
                power: powerRef.current,
                time: time.current,
              })
              for (const g of grabbed.current.values()) {
                const b = blobs.current[g.i]
                if (b) [b.x, b.y, b.vx, b.vy] = [g.x, g.y, 0, 0]
              }
              draw()
            },
            destroy: () => {
              lamp.destroy()
              redraw.current = () => {}
            },
          }
        }}
        onPointerDown={(e) => {
          const p = at(e)
          const i = blobAt(blobs.current, p.x, p.y, aspect.current)
          if (i < 0) return
          /* a touch warms the wax it lands on, so a tap sends a blob up */
          blobs.current[i].heat = Math.min(1, blobs.current[i].heat + 0.5)
          grabbed.current.set(e.pointerId, { i, ...p, t: performance.now() / 1000, vx: 0, vy: 0 })
          if (!runningRef.current) setRunning(true)
        }}
        onPointerMove={(e) => {
          const g = grabbed.current.get(e.pointerId)
          if (!g) return
          const p = at(e)
          const t = performance.now() / 1000
          const dt = Math.max(t - g.t, 1 / 240)
          /* the finger's own speed, kept for the fling on letting go */
          grabbed.current.set(e.pointerId, {
            ...g,
            ...p,
            t,
            vx: (p.x - g.x) / dt,
            vy: (p.y - g.y) / dt,
          })
          if (!runningRef.current) {
            const b = blobs.current[g.i]
            if (b) [b.x, b.y] = [p.x, p.y]
            redraw.current()
          }
        }}
        onPointerUp={(e) => {
          const g = grabbed.current.get(e.pointerId)
          grabbed.current.delete(e.pointerId)
          const b = g && blobs.current[g.i]
          if (!g || !b) return
          /* a fling, not a launch: a flick of the wrist should not fire wax through the glass */
          const v = Math.hypot(g.vx, g.vy)
          const k = v > 1.5 ? 1.5 / v : 1
          ;[b.vx, b.vy] = [g.vx * k, g.vy * k]
        }}
      />

      {live && (
        <div className="lab-controls">
          <button className="btn" onClick={() => setRunning((r) => !r)} aria-pressed={running}>
            {running ? '⏸ Pause' : '▶ Run'}
          </button>
          <button className="btn btn-ghost" onClick={shake}>
            🫨 Shake
          </button>
          <div className="lab-group" role="group" aria-label="Colour">
            {SCHEMES.map((name, i) => (
              <button
                key={name}
                className="btn btn-ghost"
                aria-pressed={scheme === i}
                onClick={() => {
                  setScheme(i)
                  schemeRef.current = i
                  redraw.current()
                }}
              >
                {name}
              </button>
            ))}
          </div>
          <div className="lab-group" role="group" aria-label="How much wax">
            {(Object.keys(AMOUNTS) as Amount[]).map((a) => (
              <button
                key={a}
                className="btn btn-ghost"
                aria-pressed={amount === a}
                onClick={() => refill(a)}
              >
                {a}
              </button>
            ))}
          </div>
          <label className="appearance-slider lab-flow">
            <span className="muted">Heat</span>
            <input
              type="range"
              min={0}
              max={2}
              step={0.05}
              value={power}
              onChange={(e) => setPower(Number(e.target.value))}
            />
            <span className="appearance-slider-val">{power === 0 ? 'off' : power.toFixed(2)}</span>
          </label>
        </div>
      )}

      {live && (
        <p className="muted lab-hint">
          The bulb heats the wax at the bottom; warm wax rises, cools at the top and sinks. Tap a
          blob to warm it, or grab one and fling it. Turn the heat off and it all settles.
          {!touchOnly() && ' Keys, once it has focus: Space pauses, K shakes, 1–4 pick a colour.'}
        </p>
      )}
    </div>
  )
}
