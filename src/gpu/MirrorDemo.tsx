import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { touchOnly } from '../ui/pointerKind'
import { LabStage } from './LabStage'
import {
  MAPS,
  MAP_IDS,
  delayMap,
  drawStandIn,
  historyFor,
  type Brush,
  type Dab,
  type MapId,
} from './mirror'
import { createMirror, type MirrorView } from './mirrorEngine'

type Props = {
  running: boolean
  setRunning: (r: boolean | ((r: boolean) => boolean)) => void
  onAdapter: (adapter: GPUAdapter, format: GPUTextureFormat) => void
}

type Camera = 'off' | 'asking' | 'on' | 'refused'
const BRUSHES: Record<Brush, string> = { slow: '🐢 Slow time', now: '⚡ Bring back' }

/** Your camera, with time you can paint: brush a part of the picture and it lags behind. */
export function MirrorDemo({ running, setRunning, onAdapter }: Props) {
  const [live, setLive] = useState(false)
  const [camera, setCamera] = useState<Camera>('off')
  const [brush, setBrush] = useState<Brush>('slow')
  const [map, setMap] = useState<MapId>('falling')
  const [tint, setTint] = useState(false)
  const now = useRef({ brush, tint })
  now.current = { brush, tint }
  const runningRef = useRef(running)
  runningRef.current = running
  const cameraRef = useRef(camera)
  cameraRef.current = camera
  const mapRef = useRef(map)
  mapRef.current = map

  const viewRef = useRef<MirrorView | null>(null)
  /** the picture each frame is drawn into, at the history's size, before it joins the past */
  const frameCanvas = useRef<HTMLCanvasElement | null>(null)
  const video = useRef<HTMLVideoElement | null>(null)
  const stream = useRef<MediaStream | null>(null)
  const fingers = useRef(new Map<number, readonly [number, number]>())
  const frameNo = useRef(0)
  const redraw = useRef<() => void>(() => {})

  const stopCamera = () => {
    stream.current?.getTracks().forEach((t) => t.stop())
    stream.current = null
    if (video.current) video.current.srcObject = null
  }
  /* the camera is let go of when the toy is left, whatever else happens: the light goes off */
  useEffect(() => stopCamera, [])

  const toggleCamera = async () => {
    if (camera === 'on') {
      stopCamera()
      setCamera('off')
      return
    }
    setCamera('asking')
    try {
      const s = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 } },
        audio: false,
      })
      stream.current = s
      const v = video.current ?? document.createElement('video')
      v.muted = true
      v.playsInline = true
      v.srcObject = s
      await v.play()
      video.current = v
      setCamera('on')
      if (!runningRef.current) setRunning(true)
    } catch {
      stopCamera()
      setCamera('refused')
    }
  }

  const reset = (id: MapId) => {
    setMap(id)
    const v = viewRef.current
    if (!v) return
    v.setDelay(delayMap(id, v.size[0], v.size[1]))
    redraw.current()
  }

  /** this frame's picture: the camera, mirrored and cropped to the history's shape, or the stand-in */
  const capture = () => {
    const c = frameCanvas.current
    const g = c?.getContext('2d')
    if (!c || !g) return null
    const v = video.current
    /* ⚠️ THE REF, NOT THE STATE: this runs inside the loop made once with the device, where
       `camera` would be the value from the first render — off, for ever */
    if (cameraRef.current === 'on' && v && v.videoWidth > 0) {
      const scale = Math.max(c.width / v.videoWidth, c.height / v.videoHeight)
      const dw = v.videoWidth * scale
      const dh = v.videoHeight * scale
      g.save()
      /* a mirror: what moves left on you moves left on screen */
      g.translate(c.width, 0)
      g.scale(-1, 1)
      g.drawImage(v, (c.width - dw) / 2, (c.height - dh) / 2, dw, dh)
      g.restore()
    } else drawStandIn(g, c.width, c.height, frameNo.current)
    frameNo.current++
    return c
  }

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.target !== e.currentTarget) return
    const k = e.key.toLowerCase()
    if (k === ' ') setRunning((r) => !r)
    else if (k === 's') setBrush('slow')
    else if (k === 'n') setBrush('now')
    else if (k === 't') setTint((t) => !t)
    else if (k === 'c') void toggleCamera()
    else if (/^[1-4]$/.test(k)) reset(MAP_IDS[Number(k) - 1])
    else return
    e.preventDefault()
  }

  const toTexel = (e: PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    const [w, h] = viewRef.current?.size ?? [1, 1]
    return [((e.clientX - r.left) / r.width) * w, ((e.clientY - r.top) / r.height) * h] as const
  }

  return (
    <div className="lab-keys" tabIndex={0} onKeyDown={onKey} aria-label="Mirror">
      <LabStage
        label="A mirror in which parts of the picture run behind time"
        running={running}
        onAdapter={onAdapter}
        onLive={setLive}
        make={async ({ device, context, format, canvas }) => {
          const size = historyFor(canvas.width / Math.max(1, canvas.height))
          const view = await createMirror(device, context, format, size)
          viewRef.current = view
          const c = document.createElement('canvas')
          frameCanvas.current = c
          const fit = () => {
            const s = historyFor(canvas.width / Math.max(1, canvas.height))
            c.width = s[0]
            c.height = s[1]
            if (view.size[0] !== s[0] || view.size[1] !== s[1]) view.resize(s)
            view.setDelay(delayMap(mapRef.current, s[0], s[1]))
            const g = c.getContext('2d')
            if (g) drawStandIn(g, s[0], s[1], frameNo.current)
            view.fill(c)
          }
          fit()
          const draw = (move: boolean) => {
            const n = now.current
            const r = Math.min(view.size[0], view.size[1]) * 0.12
            const dabs: Dab[] = [...fingers.current.values()].map(([x, y]) => ({
              x,
              y,
              r,
              brush: n.brush,
            }))
            view.frame({ source: move ? capture() : null, dabs, tint: n.tint })
          }
          redraw.current = () => {
            if (!runningRef.current) draw(false)
          }
          return {
            frame: (dt) => draw(dt > 0),
            resize: fit,
            destroy: () => {
              view.destroy()
              viewRef.current = null
              redraw.current = () => {}
            },
          }
        }}
        onPointerDown={(e) => {
          fingers.current.set(e.pointerId, toTexel(e))
          if (!running) setRunning(true)
        }}
        onPointerMove={(e) => {
          if (fingers.current.has(e.pointerId)) fingers.current.set(e.pointerId, toTexel(e))
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
          <button
            className="btn btn-ghost"
            aria-pressed={camera === 'on'}
            disabled={camera === 'asking'}
            onClick={() => void toggleCamera()}
          >
            {camera === 'on' ? '📷 Camera off' : '📷 Use my camera'}
          </button>
          <div className="lab-group" role="group" aria-label="Brush">
            {(Object.keys(BRUSHES) as Brush[]).map((b) => (
              <button
                key={b}
                className="btn btn-ghost"
                aria-pressed={brush === b}
                onClick={() => setBrush(b)}
              >
                {BRUSHES[b]}
              </button>
            ))}
          </div>
          <div className="lab-group" role="group" aria-label="Start from">
            {MAP_IDS.map((m) => (
              <button
                key={m}
                className="btn btn-ghost"
                aria-pressed={map === m}
                onClick={() => reset(m)}
              >
                {MAPS[m]}
              </button>
            ))}
          </div>
          <button
            className="btn btn-ghost"
            aria-pressed={tint}
            onClick={() => {
              setTint((t) => !t)
              redraw.current()
            }}
          >
            🎨 Show time
          </button>
        </div>
      )}

      {live && (
        <p className="muted lab-hint">
          {camera === 'refused'
            ? 'The camera was not available — the stand-in scene shows the same trick. '
            : camera === 'on'
              ? 'Wave. '
              : 'A stand-in scene until you turn the camera on. '}
          Paint over the picture and that part falls behind: 🐢 drags it up to two seconds into the
          past, ⚡ brings it back. The last 64 frames are kept on the GPU and every pixel picks its
          own moment. The camera stays on this device — nothing is sent or saved.
          {!touchOnly() &&
            ' Keys: C camera, S slow, N bring back, T show time, 1–4 start from, Space pauses.'}
        </p>
      )}
    </div>
  )
}
