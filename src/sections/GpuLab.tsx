import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import {
  COUNTS,
  DEFAULT_COUNT,
  TOUCH_CEILING,
  countLabel,
  countsFor,
  stepSeconds,
  toWorld,
} from '../gpu/swarm'
import { createSwarm, type Swarm, type SwarmInput } from '../gpu/swarmEngine'
import { motionReduced, onMotionChange } from '../ui/motion'
import { touchOnly } from '../ui/pointerKind'
import '../gpu/lab.css'

/**
 * The Lab: experiments with WebGPU, starting with a swarm of particles carried by a current.
 *
 * ⚠️ EVERY WAY THIS CAN FAIL HAS ITS OWN SENTENCE, because they are different problems with
 * different fixes and "WebGPU unavailable" covers all of them badly. No `navigator.gpu` is the
 * browser; no adapter is the browser refusing THIS machine (a blocklisted driver, or a GPU
 * process that crashed earlier); a pipeline error is this code; a lost device is the OS or
 * the driver taking the GPU back, which is the one case worth a Try again button.
 */

type Phase =
  | { kind: 'starting' }
  | { kind: 'no-webgpu' }
  | { kind: 'no-adapter' }
  | { kind: 'running' }
  | { kind: 'failed'; why: string }
  | { kind: 'lost'; why: string }

/** What the adapter says about itself, kept for the "what your GPU reports" fold. */
type Report = {
  vendor: string
  architecture: string
  description: string
  software: boolean
  format: string
  features: string[]
  limits: [string, number][]
}

/** The limits worth showing — the ones that decide what a page like this can do. */
const SHOWN_LIMITS = [
  'maxBufferSize',
  'maxStorageBufferBindingSize',
  'maxComputeWorkgroupsPerDimension',
  'maxComputeInvocationsPerWorkgroup',
  'maxComputeWorkgroupStorageSize',
  'maxTextureDimension2D',
  'maxBindGroups',
] as const

const bytes = (n: number) =>
  n >= 1 << 30 ? `${n / (1 << 30)} GiB` : n >= 1 << 20 ? `${n / (1 << 20)} MiB` : `${n / 1024} KiB`
const shownLimit = (name: string, n: number) => (/Size$/.test(name) ? bytes(n) : n.toLocaleString())

function reportOf(adapter: GPUAdapter, format: string): Report {
  const info = adapter.info
  return {
    vendor: info.vendor || 'not said',
    architecture: info.architecture || 'not said',
    description: info.description,
    software: info.isFallbackAdapter ?? false,
    format,
    features: [...adapter.features].sort(),
    limits: SHOWN_LIMITS.map((k) => [k, adapter.limits[k]]),
  }
}

export function GpuLab() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const swarmRef = useRef<Swarm | null>(null)
  const [phase, setPhase] = useState<Phase>({ kind: 'starting' })
  const [report, setReport] = useState<Report | null>(null)
  /** bumped by Try again, which tears the device down and asks for a new one */
  const [boot, setBoot] = useState(0)

  const [counts, setCounts] = useState<number[]>([...COUNTS])
  const [count, setCount] = useState(DEFAULT_COUNT)
  const [flow, setFlow] = useState(1)
  const [direction, setDirection] = useState<1 | -1>(1)
  /* ⚠️ STILL UNTIL ASKED, under reduced motion. The whole room is motion, so it cannot simply
     paint once and stop the way the backdrop does — the picture would be all there is. It draws
     the scattered field still, and the Run button is somebody choosing to watch it move. */
  const [running, setRunning] = useState(() => !motionReduced())
  const [fps, setFps] = useState<number | null>(null)

  /* the loop reads these every frame; a re-render must not restart it */
  const input = useRef<SwarmInput>({ pointer: null, direction: 1, flow: 1 })
  input.current.direction = direction
  input.current.flow = flow
  const runningRef = useRef(running)
  runningRef.current = running
  const countRef = useRef(count)
  countRef.current = count

  useEffect(() => onMotionChange(() => motionReduced() && setRunning(false)), [])

  /* the device, the swarm, and the loop — one lifetime, torn down together */
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let cancelled = false
    /** set when the device reports an error: the veil is up, and the loop must stop feeding it */
    let broken = false
    let device: GPUDevice | null = null
    let context: GPUCanvasContext | null = null
    let raf = 0
    let observer: ResizeObserver | null = null

    const start = async () => {
      if (!('gpu' in navigator) || !navigator.gpu) {
        setPhase({ kind: 'no-webgpu' })
        return
      }
      const adapter = await navigator.gpu.requestAdapter()
      if (cancelled) return
      if (!adapter) {
        setPhase({ kind: 'no-adapter' })
        return
      }
      const format = navigator.gpu.getPreferredCanvasFormat()
      setReport(reportOf(adapter, format))

      const dev = await adapter.requestDevice()
      if (cancelled) {
        dev.destroy()
        return
      }
      device = dev
      /* the DEVICE's limits, which are what every buffer and dispatch is checked against — see
         countsFor */
      const offered = countsFor(dev.limits, touchOnly() ? TOUCH_CEILING : Infinity)
      setCounts(offered)
      const first = offered.includes(countRef.current) ? countRef.current : offered[0]
      if (first !== countRef.current) setCount(first)
      dev.lost.then((info) => {
        // 'destroyed' is this effect's own cleanup, not something to report
        if (cancelled || info.reason === 'destroyed') return
        broken = true
        setPhase({ kind: 'lost', why: info.message || 'the GPU was taken back' })
      })
      dev.addEventListener('uncapturederror', (e) => {
        if (cancelled || broken) return
        broken = true
        setPhase({ kind: 'failed', why: e.error.message })
      })

      context = canvas.getContext('webgpu')
      if (!context) {
        setPhase({ kind: 'failed', why: 'the canvas would not give a WebGPU context' })
        return
      }
      context.configure({ device: dev, format, alphaMode: 'opaque' })
      const swarm = await createSwarm(dev, context, format, canvas, first)
      if (cancelled) {
        swarm.destroy()
        return
      }
      swarmRef.current = swarm

      /* ⚠️ THE BACKING STORE FOLLOWS THE BOX, in device pixels, capped at 2× — a 3× phone would
         otherwise be filling nine pixels per CSS pixel with dots that are two CSS pixels wide.
         A still swarm repaints on resize, or a paused field would stretch until it was pressed. */
      observer = new ResizeObserver(() => {
        const dpr = Math.min(window.devicePixelRatio || 1, 2)
        const w = Math.max(1, Math.round(canvas.clientWidth * dpr))
        const h = Math.max(1, Math.round(canvas.clientHeight * dpr))
        if (canvas.width !== w || canvas.height !== h) {
          canvas.width = w
          canvas.height = h
          if (!runningRef.current) swarm.frame(0, input.current)
        }
      })
      observer.observe(canvas)

      let prev: number | null = null
      let frames = 0
      let since = performance.now()
      const tick = (now: number) => {
        if (cancelled || broken) return
        if (runningRef.current) {
          swarm.frame(stepSeconds(prev, now), input.current)
          prev = now
          frames++
          if (now - since >= 500) {
            setFps(Math.round((frames * 1000) / (now - since)))
            frames = 0
            since = now
          }
        } else {
          prev = null
          frames = 0
          since = now
        }
        raf = requestAnimationFrame(tick)
      }
      swarm.frame(0, input.current)
      setPhase({ kind: 'running' })
      raf = requestAnimationFrame(tick)
    }

    start().catch((err: unknown) => {
      if (!cancelled)
        setPhase({ kind: 'failed', why: err instanceof Error ? err.message : String(err) })
    })

    return () => {
      cancelled = true
      cancelAnimationFrame(raf)
      observer?.disconnect()
      swarmRef.current?.destroy()
      swarmRef.current = null
      // let go of the canvas's textures before the device that owns them goes
      context?.unconfigure()
      device?.destroy()
      setFps(null)
    }
  }, [boot])

  /* a new count is a new buffer; a still swarm shows the new scatter at once */
  useEffect(() => {
    const swarm = swarmRef.current
    if (!swarm) return
    swarm.setCount(count)
    if (!runningRef.current) swarm.frame(0, input.current)
  }, [count])

  const press = (e: PointerEvent<HTMLCanvasElement>) => {
    const c = e.currentTarget
    const r = c.getBoundingClientRect()
    input.current.pointer = toWorld(e.clientX - r.left, e.clientY - r.top, r.width, r.height)
  }
  const release = () => {
    input.current.pointer = null
  }

  const live = phase.kind === 'running'

  return (
    <div className="lab">
      <div className="lab-stage">
        <canvas
          ref={canvasRef}
          className="lab-canvas"
          role="img"
          aria-label="A field of glowing particles carried by a slow, swirling current"
          onPointerDown={(e) => {
            press(e)
            // the press is the point and capture is a nicety: it may refuse, and must not stop it
            try {
              e.currentTarget.setPointerCapture(e.pointerId)
            } catch {
              /* a pointer the browser no longer tracks */
            }
          }}
          onPointerMove={(e) => {
            if (input.current.pointer) press(e)
          }}
          onPointerUp={release}
          onPointerCancel={release}
        />
        {!live && (
          <div className="lab-veil">
            <Explain phase={phase} onRetry={() => setBoot((b) => b + 1)} />
          </div>
        )}
        {live && running && fps !== null && (
          <span className="lab-fps" aria-hidden>
            {fps} fps
          </span>
        )}
      </div>

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

      {report && <GpuReport report={report} />}
    </div>
  )
}

function Explain({ phase, onRetry }: { phase: Phase; onRetry: () => void }) {
  switch (phase.kind) {
    case 'starting':
      return <p className="muted">Asking for the GPU…</p>
    case 'no-webgpu':
      return (
        <p>
          This browser does not offer WebGPU. Recent Chrome, Edge and Safari do, and Firefox does on
          some systems — open this page in one of those to see it.
        </p>
      )
    case 'no-adapter':
      return (
        <p>
          This browser has WebGPU but would not hand over a GPU on this machine — usually a graphics
          driver it does not trust. Updating the driver, or turning hardware acceleration back on in
          the browser’s settings, is the usual fix.
        </p>
      )
    case 'lost':
      return (
        <>
          <p>The GPU was taken away mid-run ({phase.why}).</p>
          <button className="btn" onClick={onRetry}>
            Try again
          </button>
        </>
      )
    case 'failed':
      return (
        <>
          <p>Something went wrong setting it up: {phase.why}</p>
          <button className="btn btn-ghost" onClick={onRetry}>
            Try again
          </button>
        </>
      )
    case 'running':
      return null
  }
}

/** label and value for each row of the report, in the order they read best */
function facts(report: Report): [string, ReactNode][] {
  return [
    ['Vendor', report.vendor],
    ['Architecture', report.architecture],
    ...(report.description ? [['Description', report.description] as [string, ReactNode]] : []),
    ['Canvas format', <code>{report.format}</code>],
    ...report.limits.map(([name, n]): [string, ReactNode] => [name, shownLimit(name, n)]),
  ]
}

function GpuReport({ report }: { report: Report }) {
  return (
    <details className="lab-report">
      <summary>What your GPU reports</summary>
      {report.software && (
        <p className="lab-warn">
          This is a software renderer — the browser is imitating a GPU on the processor, so expect
          it to be slow. A real graphics card is usually being withheld for a driver reason.
        </p>
      )}
      <dl className="lab-facts">
        {facts(report).map(([name, value]) => (
          <div key={name} className="lab-fact">
            <dt>{name}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      <p className="muted lab-features-head">Optional features: {report.features.length}</p>
      {report.features.length > 0 ? (
        <ul className="lab-features">
          {report.features.map((f) => (
            <li key={f}>
              <code>{f}</code>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted">None beyond the core set.</p>
      )}
    </details>
  )
}
