import { useEffect, useRef, useState, type PointerEventHandler } from 'react'
import { stepSeconds } from './swarm'

/**
 * The part of every Lab demo that is not the demo: asking for a GPU, saying why there is none,
 * sizing the canvas, running the loop, counting frames, and tearing all of it down together.
 *
 * ⚠️ EVERY WAY THIS CAN FAIL HAS ITS OWN SENTENCE, because they are different problems with
 * different fixes and "WebGPU unavailable" covers all of them badly. No `navigator.gpu` is the
 * browser; no adapter is the browser refusing THIS machine (a blocklisted driver, or a GPU
 * process that crashed earlier); a pipeline error is the demo's code; a lost device is the OS or
 * the driver taking the GPU back, which is the one case worth a Try again button.
 *
 * ⚠️ ONE DEVICE PER DEMO, NOT ONE FOR THE ROOM. Switching demo unmounts this and asks for a new
 * device. Sharing one would save ~100ms on a switch and cost a demo's leaked buffer or error
 * scope landing on the next one — and a lost device would take every demo down at once.
 */

export type Phase =
  | { kind: 'starting' }
  | { kind: 'no-webgpu' }
  | { kind: 'no-adapter' }
  | { kind: 'running' }
  | { kind: 'failed'; why: string }
  | { kind: 'lost'; why: string }

/** What a demo is given to build itself on. */
export type Gpu = {
  adapter: GPUAdapter
  device: GPUDevice
  context: GPUCanvasContext
  format: GPUTextureFormat
  canvas: HTMLCanvasElement
}

/** What a demo hands back: something to draw a frame and something to let go. */
export type Running = {
  /** advance by `dt` seconds and draw; 0 draws where it stands */
  frame(dt: number): void
  /** the canvas changed size (its width and height are already the new ones) */
  resize?(): void
  destroy(): void
}

type Props = {
  /** builds the demo once per device; the latest one is used, so it need not be stable */
  make: (gpu: Gpu) => Promise<Running>
  /** advancing, or only drawing when something changes */
  running: boolean
  label: string
  onAdapter?: (adapter: GPUAdapter, format: GPUTextureFormat) => void
  /** whether a demo is up and drawing — its controls have nothing to control until it is */
  onLive?: (live: boolean) => void
  onPointerDown?: PointerEventHandler<HTMLCanvasElement>
  onPointerMove?: PointerEventHandler<HTMLCanvasElement>
  onPointerUp?: PointerEventHandler<HTMLCanvasElement>
  /** how many backing pixels per CSS pixel at most; the default caps a 3× phone at 2× */
  maxDpr?: number
}

export function LabStage({
  make,
  running,
  label,
  onAdapter,
  onLive,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  maxDpr = 2,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [phase, setPhase] = useState<Phase>({ kind: 'starting' })
  const [boot, setBoot] = useState(0)
  const [fps, setFps] = useState<number | null>(null)

  /* the loop reads these every frame; a re-render must not restart it */
  const makeRef = useRef(make)
  makeRef.current = make
  const onAdapterRef = useRef(onAdapter)
  onAdapterRef.current = onAdapter
  const runningRef = useRef(running)
  runningRef.current = running
  const demoRef = useRef<Running | null>(null)
  const onLiveRef = useRef(onLive)
  onLiveRef.current = onLive
  const live = phase.kind === 'running'
  useEffect(() => onLiveRef.current?.(live), [live])

  /* a pause shows the frame it stopped on; draw it, since nothing else will */
  useEffect(() => {
    if (!running) demoRef.current?.frame(0)
  }, [running])

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
      onAdapterRef.current?.(adapter, format)

      const dev = await adapter.requestDevice()
      if (cancelled) {
        dev.destroy()
        return
      }
      device = dev
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

      /* ⚠️ SIZED BEFORE THE DEMO IS BUILT, so a demo that sizes a grid or a texture from the
         canvas reads the real box rather than the 300×150 default every canvas starts at. */
      const fit = () => {
        const dpr = Math.min(window.devicePixelRatio || 1, maxDpr)
        const w = Math.max(1, Math.round(canvas.clientWidth * dpr))
        const h = Math.max(1, Math.round(canvas.clientHeight * dpr))
        if (canvas.width === w && canvas.height === h) return false
        canvas.width = w
        canvas.height = h
        return true
      }
      fit()

      const demo = await makeRef.current({ adapter, device: dev, context, format, canvas })
      if (cancelled) {
        demo.destroy()
        return
      }
      demoRef.current = demo

      /* the backing store follows the box; a still demo repaints, or it would stretch */
      observer = new ResizeObserver(() => {
        if (!fit()) return
        demo.resize?.()
        if (!runningRef.current) demo.frame(0)
      })
      observer.observe(canvas)

      let prev: number | null = null
      let frames = 0
      let since = performance.now()
      const tick = (now: number) => {
        if (cancelled || broken) return
        if (runningRef.current) {
          demo.frame(stepSeconds(prev, now))
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
      demo.frame(0)
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
      demoRef.current?.destroy()
      demoRef.current = null
      // let go of the canvas's textures before the device that owns them goes
      context?.unconfigure()
      device?.destroy()
      setFps(null)
      setPhase({ kind: 'starting' })
    }
  }, [boot, maxDpr])

  return (
    <div className="lab-stage">
      <canvas
        ref={canvasRef}
        className="lab-canvas"
        role="img"
        aria-label={label}
        onPointerDown={(e) => {
          onPointerDown?.(e)
          // the press is the point and capture is a nicety: it may refuse, and must not stop it
          try {
            e.currentTarget.setPointerCapture(e.pointerId)
          } catch {
            /* a pointer the browser no longer tracks */
          }
        }}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
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
