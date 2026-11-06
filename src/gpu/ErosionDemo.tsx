import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { touchOnly } from '../ui/pointerKind'
import { LANDS, N, TOOLS, landFor, orbitCamera, rayAt, type LandKind, type Tool } from './erosion'
import { createErosion, type ErosionView } from './erosionEngine'
import { LabStage } from './LabStage'

type Props = {
  running: boolean
  setRunning: (r: boolean | ((r: boolean) => boolean)) => void
  onAdapter: (adapter: GPUAdapter, format: GPUTextureFormat) => void
}

type Pt = [number, number]
const TOOL_IDS = Object.keys(TOOLS) as Tool[]
const LAND_IDS = Object.keys(LANDS) as LandKind[]
/** simulation steps a frame: a minute or two of rain to cut a valley */
const STEPS = 4
const DIST = [140, 520] as const
const PITCH = [0.15, 1.35] as const

/**
 * A landscape that rain carves. Rain on it with a finger and streams gather, cut valleys and
 * spread fans of sand where they slow; raise mountains or dig channels and watch the water find
 * its way. Two fingers (or Turn) look round it.
 */
export function ErosionDemo({ running, setRunning, onAdapter }: Props) {
  const [live, setLive] = useState(false)
  const [tool, setTool] = useState<Tool>('rain')
  const [land, setLand] = useState<LandKind>('ridge')
  const [storm, setStorm] = useState(false)
  const [open, setOpen] = useState(true)
  const now = useRef({ tool, storm, open })
  now.current = { tool, storm, open }
  const runningRef = useRef(running)
  runningRef.current = running

  const view = useRef({ yaw: 0.7, pitch: 0.55, dist: 330 })
  /** fingers in screen units (−1..1, y up) */
  const fingers = useRef(new Map<number, { at: Pt; last: Pt }>())
  const pinch = useRef<number | null>(null)
  const engine = useRef<ErosionView | null>(null)
  const wrap = useRef<HTMLDivElement | null>(null)
  const redraw = useRef<() => void>(() => {})

  const orbit = (dx: number, dy: number) => {
    const v = view.current
    v.yaw -= dx * 2.2
    v.pitch = Math.min(PITCH[1], Math.max(PITCH[0], v.pitch - dy * 1.4))
    redraw.current()
  }
  const zoom = (k: number) => {
    const v = view.current
    v.dist = Math.min(DIST[1], Math.max(DIST[0], v.dist * k))
    redraw.current()
  }
  const newLand = (kind: LandKind) => {
    setLand(kind)
    engine.current?.load(landFor(kind, N, Math.floor(Math.random() * 1e6)))
    redraw.current()
  }

  /* the wheel comes closer or backs off; it must be able to refuse the page's own scroll */
  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!(e.target instanceof HTMLCanvasElement)) return
      e.preventDefault()
      zoom(Math.exp(e.deltaY * 0.001))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [live])

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.target !== e.currentTarget) return
    const k = e.key.toLowerCase()
    const keys: Record<string, Tool> = { r: 'rain', u: 'raise', d: 'dig', t: 'turn' }
    if (k in keys) setTool(keys[k])
    else if (k === ' ') setRunning((r) => !r)
    else if (k === 's') setStorm((s) => !s)
    else if (k === 'e') setOpen((o) => !o)
    else if (k === 'arrowleft' || k === 'arrowright') orbit(k === 'arrowleft' ? -0.05 : 0.05, 0)
    else if (k === 'arrowup' || k === 'arrowdown') orbit(0, k === 'arrowup' ? -0.05 : 0.05)
    else if (k === '+' || k === '=' || k === '-') zoom(k === '-' ? 1.1 : 0.9)
    else if (/^[1-3]$/.test(k)) newLand(LAND_IDS[Number(k) - 1])
    else return
    e.preventDefault()
  }

  const toScreen = (e: PointerEvent<HTMLCanvasElement>): Pt => {
    const r = e.currentTarget.getBoundingClientRect()
    return [((e.clientX - r.left) / r.width) * 2 - 1, 1 - ((e.clientY - r.top) / r.height) * 2]
  }
  const spread = () => {
    const [a, b] = [...fingers.current.values()]
    return Math.hypot(a.at[0] - b.at[0], a.at[1] - b.at[1])
  }
  /** the one finger working the land, if that is what it is doing */
  const working = () =>
    fingers.current.size === 1 && now.current.tool !== 'turn'
      ? [...fingers.current.values()][0].at
      : null

  return (
    <div ref={wrap} className="lab-keys" tabIndex={0} onKeyDown={onKey} aria-label="Erosion">
      <LabStage
        label="A landscape of hills and valleys, being carved by rain into rivers and lakes"
        running={running}
        onAdapter={onAdapter}
        onLive={setLive}
        maxDpr={1.5}
        make={async ({ device, context, format, canvas }) => {
          const v = await createErosion(device, context, format)
          engine.current = v
          v.load(landFor(land, N, 1))
          let step = 0
          const draw = (steps: number) => {
            const n = now.current
            const o = view.current
            const cam = orbitCamera(o.yaw, o.pitch, o.dist, canvas.width / canvas.height)
            const at = working()
            v.frame(
              {
                cam,
                ray: at ? rayAt(cam, at[0], at[1]) : null,
                tool: n.tool,
                rain: n.storm ? 1 : 0,
                step,
                radius: 7,
                open: n.open,
              },
              steps,
            )
            step += steps
          }
          redraw.current = () => {
            if (!runningRef.current) draw(0)
          }
          return {
            frame: (dt) => draw(dt > 0 ? STEPS : 0),
            destroy: () => {
              v.destroy()
              engine.current = null
              redraw.current = () => {}
            },
          }
        }}
        onPointerDown={(e) => {
          const at = toScreen(e)
          fingers.current.set(e.pointerId, { at, last: at })
          if (fingers.current.size === 2) pinch.current = spread()
          if (!running) setRunning(true)
        }}
        onPointerMove={(e) => {
          const f = fingers.current.get(e.pointerId)
          if (!f) return
          const at = toScreen(e)
          f.last = f.at
          f.at = at
          const turning = fingers.current.size >= 2 || now.current.tool === 'turn'
          if (turning) {
            /* two fingers: both move the view, half each, and their spread zooms */
            const share = 1 / fingers.current.size
            orbit((at[0] - f.last[0]) * share, (at[1] - f.last[1]) * share)
            if (fingers.current.size === 2 && pinch.current) {
              const s = spread()
              zoom(pinch.current / Math.max(0.01, s))
              pinch.current = s
            }
          }
        }}
        onPointerUp={(e) => {
          fingers.current.delete(e.pointerId)
          if (fingers.current.size < 2) pinch.current = null
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
            aria-pressed={storm}
            onClick={() => {
              setStorm((s) => !s)
              if (!running) setRunning(true)
            }}
          >
            ⛈ Storm
          </button>
          <div className="lab-group" role="group" aria-label="New land">
            {LAND_IDS.map((l) => (
              <button
                key={l}
                className="btn btn-ghost"
                aria-pressed={land === l}
                onClick={() => newLand(l)}
              >
                {LANDS[l]}
              </button>
            ))}
          </div>
          <button className="btn btn-ghost" aria-pressed={open} onClick={() => setOpen((o) => !o)}>
            🌊 Drains to the sea
          </button>
        </div>
      )}

      {live && (
        <p className="muted lab-hint">
          Rain on the mountains and watch it gather into streams, cut valleys into the slopes and
          drop fans of sand where it slows; raise a ridge across a river and it pools into a lake
          until it spills. Nobody draws a river: {N * N} cells each pass water to their neighbours
          through pipes, and fast water carries the ground away. Drains to the sea lets water off
          the edges; without it the land fills like a basin.{' '}
          {touchOnly()
            ? 'Two fingers turn and zoom.'
            : 'Turn, two fingers or the wheel to look round.'}
          {!touchOnly() &&
            ' Keys, once it has focus: R rain, U raise, D dig, T turn, S storm, E edges, 1–3 new land, arrows turn, + − zoom, Space pauses.'}
        </p>
      )}
    </div>
  )
}
