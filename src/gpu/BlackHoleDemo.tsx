import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { touchOnly } from '../ui/pointerKind'
import { MASS, SKIES, SKY_IDS, flingFrom, glide, type Sky } from './blackhole'
import { createBlackHole, type BlackHoleView } from './blackholeEngine'
import { LabStage } from './LabStage'

type Props = {
  running: boolean
  setRunning: (r: boolean | ((r: boolean) => boolean)) => void
  onAdapter: (adapter: GPUAdapter, format: GPUTextureFormat) => void
}

type Pt = [number, number]
const DEG = Math.PI / 180
/** how far above the disk the eye can be: a little below it, to straight down on it */
const TILT = [-20, 85] as const
/** how quickly a held hole catches up with the finger, per second */
const FOLLOW = 14

/** the orientation API, with the permission request only iOS Safari has */
type Orientation = typeof DeviceOrientationEvent & { requestPermission?: () => Promise<string> }
const canTilt = () => typeof window !== 'undefined' && 'DeviceOrientationEvent' in window

/**
 * A black hole to drag across the sky. Every pixel follows its own ray of light past it, so the
 * stars behind bend round it, the disk's far side shows over the top, and a thrown hole drags the
 * whole sky with it as it glides. Pinch or scroll for its mass; tilt the phone to look at the disk
 * from above or edge on.
 */
export function BlackHoleDemo({ running, setRunning, onAdapter }: Props) {
  const [live, setLive] = useState(false)
  const [sky, setSky] = useState<Sky>('stars')
  const [disk, setDisk] = useState(true)
  const [tilt, setTilt] = useState(8)
  const [tilting, setTilting] = useState(false)
  const [tiltRefused, setTiltRefused] = useState(false)
  const now = useRef({ sky, disk, tilt, running })
  now.current = { sky, disk, tilt, running }

  /* the hole's place and drift, its mass and the phone's roll: changed every frame, so not state */
  const hole = useRef({ at: [0, 0] as Pt, vel: [0, 0] as Pt, mass: 1, roll: 0 })
  /** fingers in screen units (y −1..1 up, x scaled by the aspect) */
  const fingers = useRef(new Map<number, Pt>())
  const pinch = useRef<{ d: number; mass: number } | null>(null)
  /** once two fingers have pinched, neither moves the hole until both are up */
  const pinched = useRef(false)
  /** the dragging finger's recent positions, to throw with */
  const trail = useRef<{ x: number; y: number; t: number }[]>([])
  const aspect = useRef(1)
  const viewRef = useRef<BlackHoleView | null>(null)
  const wrap = useRef<HTMLDivElement | null>(null)
  const redraw = useRef<() => void>(() => {})

  const setMass = (m: number) => {
    hole.current.mass = Math.min(MASS[1], Math.max(MASS[0], m))
    redraw.current()
  }

  /* the wheel makes it heavier or lighter; it must be able to refuse the page's own scroll */
  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!(e.target instanceof HTMLCanvasElement)) return
      e.preventDefault()
      setMass(hole.current.mass * Math.exp(-e.deltaY * 0.001))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [live])

  /* tilting the phone: up and down looks down on the disk or along it; side to side rolls it.
     Measured from however it was held when Tilt was turned on, so any comfortable hold works */
  useEffect(() => {
    if (!tilting) return
    const h = hole.current
    let base: { beta: number; gamma: number; tilt: number } | null = null
    const on = (e: DeviceOrientationEvent) => {
      if (e.beta === null || e.gamma === null) return
      base ??= { beta: e.beta, gamma: e.gamma, tilt: now.current.tilt }
      setTilt(Math.round(Math.min(TILT[1], Math.max(TILT[0], base.tilt + (e.beta - base.beta)))))
      h.roll = Math.min(40, Math.max(-40, (e.gamma - base.gamma) * 0.6)) * DEG
      redraw.current()
    }
    window.addEventListener('deviceorientation', on)
    return () => {
      window.removeEventListener('deviceorientation', on)
      h.roll = 0
      redraw.current()
    }
  }, [tilting])

  const toggleTilt = async () => {
    if (tilting) return setTilting(false)
    const O = DeviceOrientationEvent as Orientation
    /* iOS asks, and only from a tap — and Chromium has the same question now, which answers
       'prompt' when it has not decided. Only a 'granted' turns it on; anything else is said, and
       the button stays, because 'not yet' is not 'no' */
    const answer = O.requestPermission
      ? await O.requestPermission().catch(() => 'denied')
      : 'granted'
    setTiltRefused(answer !== 'granted')
    if (answer === 'granted') setTilting(true)
  }

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.target !== e.currentTarget) return
    const k = e.key.toLowerCase()
    if (k === ' ') setRunning((r) => !r)
    else if (k === 'arrowup' || k === 'arrowdown')
      setTilt((t) => Math.min(TILT[1], Math.max(TILT[0], t + (k === 'arrowup' ? 5 : -5))))
    else if (k === '+' || k === '=' || k === '-')
      setMass(hole.current.mass * (k === '-' ? 0.9 : 1.1))
    else if (k === 'd') setDisk((d) => !d)
    else if (k === 'c') {
      hole.current.at = [0, 0]
      hole.current.vel = [0, 0]
      redraw.current()
    } else if (/^[1-3]$/.test(k)) setSky(SKY_IDS[Number(k) - 1])
    else return
    e.preventDefault()
  }

  const toScreen = (e: PointerEvent<HTMLCanvasElement>): Pt => {
    const r = e.currentTarget.getBoundingClientRect()
    aspect.current = r.width / r.height
    return [
      (((e.clientX - r.left) / r.width) * 2 - 1) * aspect.current,
      1 - ((e.clientY - r.top) / r.height) * 2,
    ]
  }
  const spread = () => {
    const [a, b] = [...fingers.current.values()]
    return Math.hypot(a[0] - b[0], a[1] - b[1])
  }

  return (
    <div ref={wrap} className="lab-keys" tabIndex={0} onKeyDown={onKey} aria-label="Black hole">
      <LabStage
        label="A black hole bending the light of the stars behind it, ringed by a glowing disk"
        running={running}
        onAdapter={onAdapter}
        onLive={setLive}
        maxDpr={1}
        make={async ({ device, context, format, canvas }) => {
          const v = await createBlackHole(device, context, format, canvas)
          viewRef.current = v
          let time = 0
          const draw = () => {
            const n = now.current
            const h = hole.current
            v.frame({
              time,
              at: h.at,
              mass: h.mass,
              tilt: n.tilt * DEG,
              roll: h.roll,
              sky: n.sky,
              disk: n.disk,
            })
          }
          redraw.current = () => {
            if (!now.current.running) draw()
          }
          return {
            frame: (dt) => {
              time += dt
              const h = hole.current
              aspect.current = canvas.width / canvas.height
              const held =
                fingers.current.size === 1 && !pinched.current
                  ? [...fingers.current.values()][0]
                  : null
              if (held) {
                /* held: it follows the finger closely */
                const k = 1 - Math.exp(-FOLLOW * dt)
                h.at = [h.at[0] + (held[0] - h.at[0]) * k, h.at[1] + (held[1] - h.at[1]) * k]
              } else if (fingers.current.size === 0) {
                const g = glide(h.at, h.vel, dt, aspect.current)
                h.at = g.at
                h.vel = g.vel
              }
              draw()
            },
            destroy: () => {
              v.destroy()
              viewRef.current = null
              redraw.current = () => {}
            },
          }
        }}
        onPointerDown={(e) => {
          const at = toScreen(e)
          fingers.current.set(e.pointerId, at)
          hole.current.vel = [0, 0]
          trail.current = [{ x: at[0], y: at[1], t: e.timeStamp }]
          if (fingers.current.size === 2) {
            pinched.current = true
            pinch.current = { d: spread(), mass: hole.current.mass }
          }
          if (!running) setRunning(true)
        }}
        onPointerMove={(e) => {
          if (!fingers.current.has(e.pointerId)) return
          const at = toScreen(e)
          fingers.current.set(e.pointerId, at)
          if (fingers.current.size === 1)
            trail.current = [
              ...trail.current.filter((s) => e.timeStamp - s.t < 200),
              { x: at[0], y: at[1], t: e.timeStamp },
            ]
          if (fingers.current.size === 2 && pinch.current)
            setMass(pinch.current.mass * (spread() / Math.max(0.01, pinch.current.d)))
        }}
        onPointerUp={(e) => {
          fingers.current.delete(e.pointerId)
          if (fingers.current.size < 2) pinch.current = null
          if (fingers.current.size > 0) return
          /* let go: thrown as fast as the finger was going — unless it was pinching */
          hole.current.vel = pinched.current ? [0, 0] : flingFrom(trail.current, e.timeStamp)
          pinched.current = false
          trail.current = []
        }}
      />

      {live && (
        <div className="lab-controls">
          <button className="btn" onClick={() => setRunning((r) => !r)} aria-pressed={running}>
            {running ? '⏸ Pause' : '▶ Run'}
          </button>
          <button className="btn btn-ghost" aria-pressed={disk} onClick={() => setDisk((d) => !d)}>
            💫 Disk
          </button>
          {touchOnly() && canTilt() && (
            <button className="btn btn-ghost" aria-pressed={tilting} onClick={toggleTilt}>
              📱 Tilt
            </button>
          )}
          <div className="lab-group" role="group" aria-label="Sky">
            {SKY_IDS.map((s) => (
              <button
                key={s}
                className="btn btn-ghost"
                aria-pressed={sky === s}
                onClick={() => setSky(s)}
              >
                {SKIES[s]}
              </button>
            ))}
          </div>
          <label className="appearance-slider lab-flow">
            <span className="muted">View</span>
            <input
              type="range"
              min={TILT[0]}
              max={TILT[1]}
              step={1}
              value={tilt}
              disabled={tilting}
              onChange={(e) => setTilt(Number(e.target.value))}
            />
            <span className="appearance-slider-val">
              {tilt < 3 && tilt > -3 ? 'edge on' : `${tilt}°`}
            </span>
          </label>
          {tiltRefused && (
            <span className="muted">Tilt isn’t allowed here — View does the same.</span>
          )}
        </div>
      )}

      {live && (
        <p className="muted lab-hint">
          Drag the black hole about and throw it — the stars behind it bend round it, and the
          glowing disk's far side shows over the top, lifted by gravity. Nothing is painted on:
          every pixel follows its own ray of light past the hole, as general relativity bends it, to
          the sky, the disk, or nothing. Light aimed closer than 2.6 times the hole's own size never
          comes out, and that is the shadow. {touchOnly() ? 'Pinch' : 'Scroll'} to make it heavier;{' '}
          {touchOnly() && canTilt() ? 'tilt the phone with 📱 Tilt on, or use View, ' : 'View '}
          to look down on the disk or along it. The Grid sky shows the bending plainly.
          {!touchOnly() &&
            ' Keys, once it has focus: Space pauses, ↑ ↓ view, + − mass, D disk, C centre, 1–3 sky.'}
        </p>
      )}
    </div>
  )
}
