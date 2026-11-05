import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { touchOnly } from '../ui/pointerKind'
import { GLAZES, GLAZE_IDS, TOOLS, orbit, rayThrough, type Glaze, type Tool } from './clay'
import { createClay, type ClayView } from './clayEngine'
import { LabStage } from './LabStage'

type Props = {
  running: boolean
  setRunning: (r: boolean | ((r: boolean) => boolean)) => void
  onAdapter: (adapter: GPUAdapter, format: GPUTextureFormat) => void
}

const SIZES = { small: ['S', 0.07], medium: ['M', 0.11], large: ['L', 0.16] } as const
type Size = keyof typeof SIZES
const ICONS: Record<Tool, string> = { add: '➕', carve: '➖', smooth: '〰', turn: '🔄' }
type Pt = readonly [number, number]

/** A lump of clay to sculpt: add, carve and smooth it with a finger, and turn it round to see. */
export function ClayDemo({ running, setRunning, onAdapter }: Props) {
  const [live, setLive] = useState(false)
  const [tool, setTool] = useState<Tool>('add')
  const [size, setSize] = useState<Size>('medium')
  const [glaze, setGlaze] = useState<Glaze>('terracotta')
  const [mirror, setMirror] = useState(true)
  const [spin, setSpin] = useState(true)
  const now = useRef({ tool, size, glaze, mirror, spin })
  now.current = { tool, size, glaze, mirror, spin }
  const runningRef = useRef(running)
  runningRef.current = running

  const viewRef = useRef<ClayView | null>(null)
  const cam = useRef({ yaw: 0.4, pitch: 0.25, dist: 2.2 })
  /** fingers, in the canvas's -1..1 (y up); two of them, or the Turn tool, move the camera */
  const fingers = useRef(new Map<number, { at: Pt; last: Pt }>())
  const wrap = useRef<HTMLDivElement | null>(null)
  const redraw = useRef<() => void>(() => {})

  /* the wheel comes closer or backs off; it must be able to refuse the page's own scroll */
  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!(e.target instanceof HTMLCanvasElement)) return
      e.preventDefault()
      cam.current.dist = Math.min(4, Math.max(1.4, cam.current.dist * Math.exp(e.deltaY * 0.001)))
      redraw.current()
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [live])

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.target !== e.currentTarget) return
    const k = e.key.toLowerCase()
    const tools: Record<string, Tool> = { a: 'add', c: 'carve', s: 'smooth', t: 'turn' }
    if (k in tools) setTool(tools[k])
    else if (k === ' ') setRunning((r) => !r)
    else if (k === 'm') setMirror((m) => !m)
    else if (k === 'w') setSpin((s) => !s)
    else if (k === 'r') {
      viewRef.current?.reset()
      redraw.current()
    } else if (k === '[' || k === ']') {
      const order: Size[] = ['small', 'medium', 'large']
      setSize((s) => order[Math.max(0, Math.min(2, order.indexOf(s) + (k === ']' ? 1 : -1)))])
    } else if (/^[1-3]$/.test(k)) setGlaze(GLAZE_IDS[Number(k) - 1])
    else return
    e.preventDefault()
  }

  const toNdc = (e: PointerEvent<HTMLCanvasElement>): Pt => {
    const r = e.currentTarget.getBoundingClientRect()
    return [((e.clientX - r.left) / r.width) * 2 - 1, 1 - ((e.clientY - r.top) / r.height) * 2]
  }
  const turning = () => now.current.tool === 'turn' || fingers.current.size >= 2

  return (
    <div ref={wrap} className="lab-keys" tabIndex={0} onKeyDown={onKey} aria-label="Clay">
      <LabStage
        label="A lump of glazed clay being sculpted and turned on a wheel"
        running={running}
        onAdapter={onAdapter}
        onLive={setLive}
        /* every pixel marches through the volume: a 3× phone's extra pixels are not worth it */
        maxDpr={1.5}
        make={async ({ device, context, format, canvas }) => {
          const view = await createClay(device, context, format)
          viewRef.current = view
          const draw = (dt: number) => {
            const n = now.current
            const c = cam.current
            /* the turntable: it turns slowly while nobody is turning it by hand */
            if (dt > 0 && n.spin && !turning()) c.yaw += dt * 0.3
            const camera = orbit(c.yaw, c.pitch, c.dist)
            const aspect = canvas.width / Math.max(1, canvas.height)
            const f = [...fingers.current.values()][0]
            /* sculpting needs a frame that moves: a still picture is only drawn */
            const ray =
              f && dt > 0 && !turning()
                ? {
                    o: camera.eye,
                    d: rayThrough(camera, f.at[0], f.at[1], aspect),
                    radius: SIZES[n.size][1],
                  }
                : null
            view.frame({ cam: camera, aspect, ray, tool: n.tool, mirror: n.mirror, glaze: n.glaze })
          }
          redraw.current = () => {
            if (!runningRef.current) draw(0)
          }
          return {
            frame: draw,
            destroy: () => {
              view.destroy()
              viewRef.current = null
              redraw.current = () => {}
            },
          }
        }}
        onPointerDown={(e) => {
          const at = toNdc(e)
          fingers.current.set(e.pointerId, { at, last: at })
          if (!running) setRunning(true)
        }}
        onPointerMove={(e) => {
          const f = fingers.current.get(e.pointerId)
          if (!f) return
          const at = toNdc(e)
          if (turning()) {
            const all = [...fingers.current.values()]
            if (all.length >= 2) {
              /* two fingers: their midpoint turns it, their spread brings it closer */
              const [a, b] = [all[0], all[1]]
              const before = Math.hypot(a.last[0] - b.last[0], a.last[1] - b.last[1])
              fingers.current.set(e.pointerId, { at, last: at })
              const [a2, b2] = [...fingers.current.values()]
              const after = Math.hypot(a2.at[0] - b2.at[0], a2.at[1] - b2.at[1])
              if (before > 0.01 && after > 0.01)
                cam.current.dist = Math.min(4, Math.max(1.4, (cam.current.dist * before) / after))
              cam.current.yaw -= (at[0] - f.last[0]) * 0.5 * 1.6
              cam.current.pitch = Math.max(
                -1.2,
                Math.min(1.2, cam.current.pitch - (at[1] - f.last[1]) * 0.5 * 1.6),
              )
              return
            }
            cam.current.yaw -= (at[0] - f.last[0]) * 1.6
            cam.current.pitch = Math.max(
              -1.2,
              Math.min(1.2, cam.current.pitch - (at[1] - f.last[1]) * 1.6),
            )
            redraw.current()
          }
          fingers.current.set(e.pointerId, { at, last: at })
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
          <div className="lab-group" role="group" aria-label="Tool">
            {(Object.keys(TOOLS) as Tool[]).map((t) => (
              <button
                key={t}
                className="btn btn-ghost"
                aria-pressed={tool === t}
                onClick={() => setTool(t)}
              >
                {ICONS[t]} {TOOLS[t]}
              </button>
            ))}
          </div>
          <div className="lab-group" role="group" aria-label="Brush size">
            {(Object.keys(SIZES) as Size[]).map((s) => (
              <button
                key={s}
                className="btn btn-ghost"
                aria-pressed={size === s}
                aria-label={`${s} brush`}
                onClick={() => setSize(s)}
              >
                {SIZES[s][0]}
              </button>
            ))}
          </div>
          <button
            className="btn btn-ghost"
            aria-pressed={mirror}
            onClick={() => setMirror((m) => !m)}
          >
            🪞 Mirror
          </button>
          <button className="btn btn-ghost" aria-pressed={spin} onClick={() => setSpin((s) => !s)}>
            🏺 Wheel
          </button>
          <button
            className="btn btn-ghost"
            onClick={() => {
              viewRef.current?.reset()
              redraw.current()
            }}
          >
            ↺ New lump
          </button>
          <div className="lab-group" role="group" aria-label="Glaze">
            {GLAZE_IDS.map((g) => (
              <button
                key={g}
                className="btn btn-ghost"
                aria-pressed={glaze === g}
                onClick={() => {
                  setGlaze(g)
                  redraw.current()
                }}
              >
                {GLAZES[g]}
              </button>
            ))}
          </div>
        </div>
      )}

      {live && (
        <p className="muted lab-hint">
          Hold a finger on the clay and it grows there (➕), hollows (➖) or smooths (〰); 🪞 Mirror
          does both sides at once, and the 🏺 wheel turns it slowly.{' '}
          {touchOnly()
            ? 'Two fingers turn it and pinch to come closer.'
            : 'Turn it with 🔄 or a drag in Turn; scroll to come closer.'}{' '}
          The clay is a distance field in a 64³ block of the GPU&rsquo;s memory, and even where your
          finger meets it is found on the GPU.
          {!touchOnly() &&
            ' Keys: A, C, S, T tools, [ and ] brush, M mirror, W wheel, R new lump, 1–3 glaze.'}
        </p>
      )}
    </div>
  )
}
