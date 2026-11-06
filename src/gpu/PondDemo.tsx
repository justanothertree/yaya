import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { touchOnly } from '../ui/pointerKind'
import { LabStage } from './LabStage'
import { FLOORS, FLOOR_IDS, raindrop, type Drop, type Floor } from './pond'
import { createPond, type PondView } from './pondEngine'

type Props = {
  running: boolean
  setRunning: (r: boolean | ((r: boolean) => boolean)) => void
  onAdapter: (adapter: GPUAdapter, format: GPUTextureFormat) => void
}

/** a cell of water is this many CSS pixels */
const CELL = 4
const STEPS = 2
const DEPTHS = { shallow: ['Shallow', 6], deep: ['Deep', 14] } as const
type Depth = keyof typeof DEPTHS

/** A pond seen from above: touch it and it ripples, and the ripples bend the light on the floor. */
export function PondDemo({ running, setRunning, onAdapter }: Props) {
  const [live, setLive] = useState(false)
  const [floor, setFloor] = useState<Floor>('tiles')
  const [depth, setDepth] = useState<Depth>('shallow')
  const [rain, setRain] = useState(false)
  const now = useRef({ floor, depth, rain })
  now.current = { floor, depth, rain }
  const runningRef = useRef(running)
  runningRef.current = running

  const pondRef = useRef<PondView | null>(null)
  const grid = useRef<[number, number]>([2, 2])
  const pending = useRef<Drop[]>([])
  const fingers = useRef(new Map<number, readonly [number, number]>())
  const clock = useRef(0)
  const redraw = useRef<() => void>(() => {})

  const drop = (d: Drop) => {
    pending.current.push(d)
    if (!runningRef.current) setRunning(true)
  }
  const splash = () => {
    const [w, h] = grid.current
    for (let k = 0; k < 6; k++) drop(raindrop(w, h, Math.random))
  }

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.target !== e.currentTarget) return
    const k = e.key.toLowerCase()
    if (k === ' ') setRunning((r) => !r)
    else if (k === 'r') setRain((r) => !r)
    else if (k === 'd') setDepth((d) => (d === 'shallow' ? 'deep' : 'shallow'))
    else if (k === 'x') splash()
    else if (/^[1-3]$/.test(k)) setFloor(FLOOR_IDS[Number(k) - 1])
    else return
    e.preventDefault()
  }

  const toCell = (e: PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const [w, h] = grid.current
    return [((e.clientX - r.left) / r.width) * w, ((e.clientY - r.top) / r.height) * h] as const
  }

  return (
    <div className="lab-keys" tabIndex={0} onKeyDown={onKey} aria-label="Pond">
      <LabStage
        label="A shallow pond seen from above, its ripples bending the light on the floor beneath"
        running={running}
        onAdapter={onAdapter}
        onLive={setLive}
        make={async ({ device, context, format, canvas }) => {
          const pond = await createPond(device, context, format)
          pondRef.current = pond
          const fit = () => {
            const w = Math.max(16, Math.round((canvas.clientWidth || canvas.width) / CELL))
            const h = Math.max(16, Math.round((canvas.clientHeight || canvas.height) / CELL))
            grid.current = [w, h]
            pond.fill(w, h)
          }
          fit()
          /* it opens with a few drops already spreading, so it is never a still blue card */
          splash()
          const draw = (steps: number) => {
            const n = now.current
            pond.frame({
              /* ⚠️ drops land on a step, so a frame that takes none must leave them waiting: the
                 first frame (dt 0) was emptying the queue and the opening splash vanished */
              drops: steps > 0 ? pending.current.splice(0) : [],
              steps,
              floor: n.floor,
              time: clock.current,
              depth: DEPTHS[n.depth][1],
            })
          }
          redraw.current = () => {
            if (!runningRef.current) draw(0)
          }
          return {
            frame: (dt) => {
              if (dt > 0) {
                clock.current += dt
                /* rain: about six drops a second, anywhere */
                if (now.current.rain && Math.random() < dt * 6) {
                  const [w, h] = grid.current
                  pending.current.push(raindrop(w, h, Math.random))
                }
              }
              draw(dt > 0 ? STEPS : 0)
            },
            resize: fit,
            destroy: () => {
              pond.destroy()
              pondRef.current = null
              redraw.current = () => {}
            },
          }
        }}
        onPointerDown={(e) => {
          const at = toCell(e)
          fingers.current.set(e.pointerId, at)
          drop({ x: at[0], y: at[1], r: 3, strength: 1.1 })
        }}
        onPointerMove={(e) => {
          const was = fingers.current.get(e.pointerId)
          if (!was) return
          const at = toCell(e)
          /* a moving finger leaves a wake: small drops every couple of cells along its path */
          const d = Math.hypot(at[0] - was[0], at[1] - was[1])
          if (d < 1.5) return
          const n = Math.min(4, Math.ceil(d / 2))
          for (let k = 1; k <= n; k++) {
            const t = k / n
            drop({
              x: was[0] + (at[0] - was[0]) * t,
              y: was[1] + (at[1] - was[1]) * t,
              r: 2,
              strength: 0.35,
            })
          }
          fingers.current.set(e.pointerId, at)
        }}
        onPointerUp={(e) => {
          fingers.current.delete(e.pointerId)
        }}
      />

      {live && (
        <div className="lab-controls">
          <button className="btn" onClick={() => setRunning((r) => !r)} aria-pressed={running}>
            {running ? '⏸ Pause' : '▶ Run'}
          </button>
          <button className="btn btn-ghost" aria-pressed={rain} onClick={() => setRain((r) => !r)}>
            🌧 Rain
          </button>
          <button className="btn btn-ghost" onClick={splash}>
            💦 Splash
          </button>
          <div className="lab-group" role="group" aria-label="Floor">
            {FLOOR_IDS.map((f) => (
              <button
                key={f}
                className="btn btn-ghost"
                aria-pressed={floor === f}
                onClick={() => {
                  setFloor(f)
                  redraw.current()
                }}
              >
                {FLOORS[f]}
              </button>
            ))}
          </div>
          <div className="lab-group" role="group" aria-label="Depth">
            {(Object.keys(DEPTHS) as Depth[]).map((d) => (
              <button
                key={d}
                className="btn btn-ghost"
                aria-pressed={depth === d}
                onClick={() => setDepth(d)}
              >
                {DEPTHS[d][0]}
              </button>
            ))}
          </div>
        </div>
      )}

      {live && (
        <p className="muted lab-hint">
          Touch the water; drag through it for a wake. The bright lines on the floor are the light
          itself, bent by the ripples and gathered where the surface curves — moved about, never
          made, so the floor is exactly as bright overall whatever the water does. Deep water brings
          them to a sharper focus.
          {!touchOnly() && ' Keys: R rain, X splash, D depth, 1–3 floors, Space pauses.'}
        </p>
      )}
    </div>
  )
}
