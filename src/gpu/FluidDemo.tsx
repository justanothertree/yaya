import { useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { touchOnly } from '../ui/pointerKind'
import { LabStage } from './LabStage'
import { bloom, dragForce, gridSize, hue, isTap, SIM_LONG } from './fluid'
import { createFluid, type FluidInput, type FluidSim, type Splat } from './fluidEngine'

type Props = {
  running: boolean
  setRunning: (r: boolean | ((r: boolean) => boolean)) => void
  onAdapter: (adapter: GPUAdapter, format: GPUTextureFormat) => void
}

/** what a stroke is painted in: a hue that wanders, or a fixed one */
const PALETTES = {
  rainbow: { name: 'Rainbow', at: (t: number) => hue(t * 0.15) },
  fire: { name: 'Fire', at: (t: number) => hue(0.02 + 0.08 * (0.5 + 0.5 * Math.sin(t * 2))) },
  sea: { name: 'Sea', at: (t: number) => hue(0.5 + 0.12 * (0.5 + 0.5 * Math.sin(t * 1.5))) },
  ink: { name: 'Ink', at: () => [0.8, 0.8, 0.85] as [number, number, number] },
} as const
type Palette = keyof typeof PALETTES

/** how much a drag covers per frame at its centre: a few frames in one place and it is solid */
const DRAG_INK = 0.35

/** Colour pushed through a fluid: drag to stir it, and it swirls, spreads and fades. */
export function FluidDemo({ running, setRunning, onAdapter }: Props) {
  const simRef = useRef<FluidSim | null>(null)
  const [live, setLive] = useState(false)
  const [palette, setPalette] = useState<Palette>('rainbow')
  const [swirl, setSwirl] = useState(20)
  const [fade, setFade] = useState(0.25)
  const runningRef = useRef(running)
  runningRef.current = running

  const input = useRef<FluidInput>({ splat: null, swirl: 20, fade: 0.25 })
  input.current.swirl = swirl
  input.current.fade = fade
  /** splats waiting their turn — the uniform holds one a frame */
  const queue = useRef<Splat[]>([])
  /**
   * ⚠️ ONE ENTRY PER FINGER, keyed by pointerId. With a single "last position", a second finger
   * on a phone took over the first one's stroke: every move measured its push from wherever the
   * OTHER finger had been, so two fingers made one stroke that jumped between them and flung the
   * fluid across the gap. Now each finger remembers itself.
   */
  const fingers = useRef(
    new Map<number, { x: number; y: number; t: number; x0: number; y0: number; t0: number }>(),
  )
  /** each finger's newest stroke, waiting for a frame; frames take them in turn */
  const strokes = useRef(new Map<number, Splat>())
  const colorOf = (t: number) => PALETTES[palette].at(t)

  /** a handful of bursts from random points in random directions */
  const splash = (n = 6) => {
    const now = performance.now() / 1000
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2
      queue.current.push({
        point: [0.15 + Math.random() * 0.7, 0.15 + Math.random() * 0.7],
        force: [Math.cos(a) * 900, Math.sin(a) * 900],
        color: colorOf(now + i * 1.3),
        ink: 0.9,
      })
    }
    if (!runningRef.current) setRunning(true)
  }

  const move = (e: PointerEvent<HTMLCanvasElement>) => {
    const prev = fingers.current.get(e.pointerId)
    if (!prev) return
    const r = e.currentTarget.getBoundingClientRect()
    const x = e.clientX - r.left
    const y = e.clientY - r.top
    const t = performance.now() / 1000
    const sim = gridSize(r.width, r.height, SIM_LONG)
    /* a finger that moves twice before its turn comes adds its push rather than losing it */
    const force = dragForce(x - prev.x, y - prev.y, Math.max(t - prev.t, 1 / 240), r.width, sim.w)
    const held = strokes.current.get(e.pointerId)
    strokes.current.set(e.pointerId, {
      point: [x / r.width, y / r.height],
      force: held ? [held.force[0] + force[0], held.force[1] + force[1]] : force,
      color: colorOf(t),
      ink: DRAG_INK,
    })
    fingers.current.set(e.pointerId, { ...prev, x, y, t })
  }

  const lift = (e: PointerEvent<HTMLCanvasElement>) => {
    const f = fingers.current.get(e.pointerId)
    fingers.current.delete(e.pointerId)
    if (!f) return
    const r = e.currentTarget.getBoundingClientRect()
    const moved = Math.hypot(f.x - f.x0, f.y - f.y0)
    if (isTap(moved, (performance.now() / 1000 - f.t0) * 1000))
      queue.current.push(...bloom([f.x0 / r.width, f.y0 / r.height], colorOf(f.t0)))
  }

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.target !== e.currentTarget) return
    const k = e.key.toLowerCase()
    const palettes = Object.keys(PALETTES) as Palette[]
    if (k === ' ') setRunning((r) => !r)
    else if (k === 's') splash()
    else if (k === 'c') simRef.current?.clear()
    else if (/^[1-4]$/.test(k)) setPalette(palettes[Number(k) - 1])
    else return
    e.preventDefault()
  }

  return (
    <div className="lab-keys" tabIndex={0} onKeyDown={onKey} aria-label="Fluid painting">
      <LabStage
        label="A dark pool of fluid that swirls coloured ink wherever it is stirred"
        running={running}
        onAdapter={onAdapter}
        onLive={setLive}
        make={async ({ device, context, format, canvas }) => {
          const sim = await createFluid(device, context, format, canvas)
          simRef.current = sim
          splash(5)
          return {
            frame: (dt) => {
              /* fingers first, in turn, so two of them stir at once; then any burst queued */
              const next = strokes.current.keys().next()
              if (!next.done) {
                input.current.splat = strokes.current.get(next.value) ?? null
                strokes.current.delete(next.value)
              } else if (queue.current.length) input.current.splat = queue.current.shift() ?? null
              sim.frame(dt, input.current)
            },
            resize: () => sim.resize(),
            destroy: () => {
              sim.destroy()
              simRef.current = null
            },
          }
        }}
        onPointerDown={(e) => {
          const r = e.currentTarget.getBoundingClientRect()
          const x = e.clientX - r.left
          const y = e.clientY - r.top
          const t = performance.now() / 1000
          fingers.current.set(e.pointerId, { x, y, t, x0: x, y0: y, t0: t })
          if (!runningRef.current) setRunning(true)
        }}
        onPointerMove={move}
        onPointerUp={lift}
      />

      {live && (
        <div className="lab-controls">
          <button className="btn" onClick={() => setRunning((r) => !r)} aria-pressed={running}>
            {running ? '⏸ Pause' : '▶ Run'}
          </button>
          <button className="btn btn-ghost" onClick={() => splash()}>
            💦 Splash
          </button>
          <button className="btn btn-ghost" onClick={() => simRef.current?.clear()}>
            Clear
          </button>
          <div className="lab-group" role="group" aria-label="Colour">
            {(Object.keys(PALETTES) as Palette[]).map((p) => (
              <button
                key={p}
                className="btn btn-ghost"
                aria-pressed={palette === p}
                onClick={() => setPalette(p)}
              >
                {PALETTES[p].name}
              </button>
            ))}
          </div>
          <label className="appearance-slider lab-flow">
            <span className="muted">Swirl</span>
            <input
              type="range"
              min={0}
              max={50}
              step={1}
              value={swirl}
              onChange={(e) => setSwirl(Number(e.target.value))}
            />
            <span className="appearance-slider-val">{swirl}</span>
          </label>
          <label className="appearance-slider lab-flow">
            <span className="muted">Fade</span>
            <input
              type="range"
              min={0}
              max={3}
              step={0.05}
              value={fade}
              onChange={(e) => setFade(Number(e.target.value))}
            />
            <span className="appearance-slider-val">{fade.toFixed(2)}</span>
          </label>
        </div>
      )}

      {live && (
        <p className="muted lab-hint">
          Drag through it to stir colour in — the faster you move, the harder it pushes — or tap for
          a blossom. {touchOnly() ? 'Several fingers stir at once. ' : ''}Swirl feeds the small
          eddies; Fade is how quickly the colour goes.
          {!touchOnly() &&
            ' Keys, once it has focus: Space pauses, S splashes, C clears, 1–4 pick a colour.'}
        </p>
      )}
    </div>
  )
}
