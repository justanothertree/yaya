import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { touchOnly } from '../ui/pointerKind'
import { isTap } from './fluid'
import { LabStage } from './LabStage'
import { countLabel } from './swarm'
import {
  FISH_COUNTS,
  FISH_TOUCH_CEILING,
  MAX_PELLETS,
  stepPellets,
  toTank,
  type Pellet,
} from './tank'
import { createAquarium, type Aquarium } from './tankEngine'

type Props = {
  running: boolean
  setRunning: (r: boolean | ((r: boolean) => boolean)) => void
  onAdapter: (adapter: GPUAdapter, format: GPUTextureFormat) => void
}

/** A tank of fish that school with their own kind: tap to feed them, drag to be the shark. */
export function AquariumDemo({ running, setRunning, onAdapter }: Props) {
  const aqRef = useRef<Aquarium | null>(null)
  const [live, setLive] = useState(false)
  const offered = FISH_COUNTS.filter((n) => !touchOnly() || n <= FISH_TOUCH_CEILING)
  const [count, setCount] = useState<number>(1536)
  const countRef = useRef(count)
  countRef.current = count

  const pellets = useRef<Pellet[]>([])
  /** each finger: where it went down, when, and where it is — a tap feeds, a drag hunts */
  const fingers = useRef(
    new Map<
      number,
      { x0: number; y0: number; t0: number; at: readonly [number, number]; hunting: boolean }
    >(),
  )
  const shark = useRef<readonly [number, number] | null>(null)

  const feed = (at: readonly [number, number]) => {
    /* the oldest pellet makes way: a tank is not a feeding trough */
    pellets.current = [...pellets.current, { x: at[0], y: at[1], left: 1 }].slice(-MAX_PELLETS)
    if (!running) setRunning(true)
  }
  const restock = (n: number) => {
    setCount(n)
    aqRef.current?.restock(n)
  }

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.target !== e.currentTarget) return
    const k = e.key.toLowerCase()
    if (k === ' ') setRunning((r) => !r)
    else if (k === 'f') feed([(Math.random() * 2 - 1) * 1.2, Math.random() * 1.2 - 0.9])
    else if (k === 'r') restock(countRef.current)
    else return
    e.preventDefault()
  }

  const point = (e: PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    return toTank(e.clientX - r.left, e.clientY - r.top, r.width, r.height)
  }

  return (
    <div className="lab-keys" tabIndex={0} onKeyDown={onKey} aria-label="Aquarium">
      <LabStage
        label="An aquarium of fish in three colours, each schooling with its own kind"
        running={running}
        onAdapter={onAdapter}
        onLive={setLive}
        make={async ({ device, context, format, canvas }) => {
          const aq = await createAquarium(device, context, format, canvas, countRef.current)
          aqRef.current = aq
          return {
            frame: (dt) => {
              pellets.current = stepPellets(pellets.current, dt)
              aq.frame(dt, { shark: shark.current, pellets: pellets.current })
            },
            destroy: () => {
              aq.destroy()
              aqRef.current = null
            },
          }
        }}
        onPointerDown={(e) => {
          const at = point(e)
          fingers.current.set(e.pointerId, {
            x0: e.clientX,
            y0: e.clientY,
            t0: performance.now(),
            at,
            hunting: false,
          })
        }}
        onPointerMove={(e) => {
          const f = fingers.current.get(e.pointerId)
          if (!f) return
          const at = point(e)
          /* the moment a press moves further than a tap, it is the shark — and stays the shark */
          const hunting = f.hunting || !isTap(Math.hypot(e.clientX - f.x0, e.clientY - f.y0), 0)
          fingers.current.set(e.pointerId, { ...f, at, hunting })
          if (hunting) shark.current = at
        }}
        onPointerUp={(e) => {
          const f = fingers.current.get(e.pointerId)
          fingers.current.delete(e.pointerId)
          if (!f) return
          if (f.hunting) shark.current = null
          else if (isTap(Math.hypot(e.clientX - f.x0, e.clientY - f.y0), performance.now() - f.t0))
            feed(f.at)
        }}
      />

      {live && (
        <div className="lab-controls">
          <button className="btn" onClick={() => setRunning((r) => !r)} aria-pressed={running}>
            {running ? '⏸ Pause' : '▶ Run'}
          </button>
          <button className="btn btn-ghost" onClick={() => restock(count)}>
            🐟 Restock
          </button>
          <div className="lab-group" role="group" aria-label="How many fish">
            {offered.map((n) => (
              <button
                key={n}
                className="btn btn-ghost"
                aria-pressed={count === n}
                onClick={() => restock(n)}
              >
                {n >= 1024 ? countLabel(n) : n}
              </button>
            ))}
          </div>
        </div>
      )}

      {live && (
        <p className="muted lab-hint">
          Tap to drop food; drag through the water and you are the shark. Three kinds of fish, and
          each schools only with its own — every fish looks at every other one, every frame, on the
          GPU.
          {!touchOnly() && ' Keys, once it has focus: Space pauses, F feeds, R restocks.'}
        </p>
      )}
    </div>
  )
}
