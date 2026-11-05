import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { touchOnly } from '../ui/pointerKind'
import { isTap } from './fluid'
import { LabStage } from './LabStage'
import {
  MAX_SHAPES,
  SCENES,
  SCENE_IDS,
  box,
  drifted,
  hitTest,
  lamp,
  toWorld,
  type SceneId,
  type Shape,
} from './light'
import { createLight, type LightRoom } from './lightEngine'

type Props = {
  running: boolean
  setRunning: (r: boolean | ((r: boolean) => boolean)) => void
  onAdapter: (adapter: GPUAdapter, format: GPUTextureFormat) => void
}

type Pt = readonly [number, number]
const EXPOSURE = 1.6
const MAX_LAMPS = 6
/** a still picture this many frames gathered is as settled as it will look: stop working */
const SETTLED = 600
/** a still redraw gathers this many frames at once, so a paused room is never left grainy */
const STILL_PASSES = 24

/** A dark room lit by lamps you move: the light, its soft shadows and its colours work themselves out. */
export function LightDemo({ running, setRunning, onAdapter }: Props) {
  const [live, setLive] = useState(false)
  const [sceneId, setSceneId] = useState<SceneId>('pillars')
  const [drift, setDrift] = useState(false)
  const [count, setCount] = useState(0)
  const driftRef = useRef(drift)
  driftRef.current = drift
  const runningRef = useRef(running)
  runningRef.current = running

  const shapes = useRef<Shape[]>([])
  const roomRef = useRef<LightRoom | null>(null)
  const aspect = useRef(1.5)
  const clock = useRef(0)
  /** each finger: what it holds (or -1), where it went down, and when */
  const fingers = useRef(new Map<number, { held: number; off: Pt; at: Pt; from: Pt; t0: number }>())
  const lastTap = useRef({ t: 0, held: -1 })
  const lastTouched = useRef(-1)
  const wrap = useRef<HTMLDivElement | null>(null)

  const changed = (moving: boolean) => {
    setCount(shapes.current.length)
    const room = roomRef.current
    if (!room) return
    room.set(
      driftRef.current
        ? shapes.current.map((s, i) => drifted(s, i, clock.current))
        : shapes.current,
      moving,
    )
    if (!runningRef.current) room.draw(STILL_PASSES, EXPOSURE)
  }
  const open = (id: SceneId) => {
    setSceneId(id)
    shapes.current = SCENES[id].make(aspect.current)
    changed(false)
  }
  const add = (s: Shape) => {
    if (shapes.current.length >= MAX_SHAPES) return
    shapes.current = [...shapes.current, s]
    lastTouched.current = shapes.current.length - 1
    changed(false)
  }
  const turn = (by: number) => {
    const i = lastTouched.current
    const s = shapes.current[i]
    if (!s || s.kind !== 'box') return
    shapes.current = shapes.current.map((t, k) => (k === i ? { ...t, angle: t.angle + by } : t))
    changed(true)
  }
  useEffect(() => {
    if (!drift) changed(false)
  }, [drift])

  /* a wheel turns the wall under the pointer; it must be able to refuse the page's own scroll */
  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      const c = el.querySelector('canvas')
      if (!c || e.target !== c) return
      const r = c.getBoundingClientRect()
      const at = toWorld(e.clientX - r.left, e.clientY - r.top, r.width, r.height)
      const i = hitTest(shapes.current, ...at)
      if (i < 0 || shapes.current[i].kind !== 'box') return
      e.preventDefault()
      lastTouched.current = i
      turn(e.deltaY * 0.002)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- turn reads refs only
  }, [live])

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.target !== e.currentTarget) return
    const k = e.key.toLowerCase()
    if (k === ' ') setRunning((r) => !r)
    else if (k === 'w') add(box(0, 0, 0.25, 0.035, Math.random() * Math.PI))
    else if (k === 'l') add(lamp(0, 0, shapes.current.length))
    else if (k === 'q') turn(-0.15)
    else if (k === 'e') turn(0.15)
    else if (k === 'd') setDrift((d) => !d)
    else if (/^[1-3]$/.test(k)) open(SCENE_IDS[Number(k) - 1])
    else return
    e.preventDefault()
  }

  const point = (e: PointerEvent<HTMLCanvasElement>): Pt => {
    const r = e.currentTarget.getBoundingClientRect()
    return toWorld(e.clientX - r.left, e.clientY - r.top, r.width, r.height)
  }
  const lamps = shapes.current.filter((s) => s.kind === 'lamp').length

  return (
    <div ref={wrap} className="lab-keys" tabIndex={0} onKeyDown={onKey} aria-label="Light">
      <LabStage
        label="A dark room lit by coloured lamps, with soft shadows behind pillars and walls"
        running={running}
        onAdapter={onAdapter}
        onLive={setLive}
        make={async ({ device, context, format, canvas }) => {
          const room = await createLight(device, context, format, canvas)
          roomRef.current = room
          aspect.current = canvas.width / Math.max(1, canvas.height)
          if (!shapes.current.length) shapes.current = SCENES[sceneId].make(aspect.current)
          changed(false)
          return {
            frame: (dt) => {
              if (dt > 0) {
                clock.current += dt
                const held = [...fingers.current.values()].some((f) => f.held >= 0)
                if (driftRef.current)
                  room.set(
                    shapes.current.map((s, i) => drifted(s, i, clock.current)),
                    true,
                  )
                /* a settled room has nothing left to gather; a moving one always has */
                const work = driftRef.current || held || room.frame < SETTLED
                room.draw(work ? 1 : 0, EXPOSURE)
              } else room.draw(STILL_PASSES, EXPOSURE)
            },
            resize: () => {
              const was = aspect.current
              aspect.current = canvas.width / Math.max(1, canvas.height)
              /* keep everything where it was across the room: x is measured in heights */
              shapes.current = shapes.current.map((s) => ({
                ...s,
                x: (s.x * aspect.current) / was,
              }))
              room.resize()
              changed(false)
            },
            destroy: () => {
              room.destroy()
              roomRef.current = null
            },
          }
        }}
        onPointerDown={(e) => {
          const at = point(e)
          const others = [...fingers.current.values()]
          let held = hitTest(shapes.current, ...at)
          /* a second finger while a wall is held turns it, wherever the finger lands */
          if (others.some((f) => f.held >= 0 && shapes.current[f.held]?.kind === 'box')) held = -2
          else if (held < 0 && lamps < MAX_LAMPS) {
            add(lamp(at[0], at[1], shapes.current.length))
            held = shapes.current.length - 1
          }
          const s = shapes.current[held]
          const off: Pt = s ? [s.x - at[0], s.y - at[1]] : [0, 0]
          if (held >= 0) lastTouched.current = held
          fingers.current.set(e.pointerId, { held, off, at, from: at, t0: performance.now() })
          if (!running) setRunning(true)
        }}
        onPointerMove={(e) => {
          const f = fingers.current.get(e.pointerId)
          if (!f) return
          const at = point(e)
          if (f.held === -2) {
            /* turning: by how far this finger has swung round the one holding the wall */
            const holder = [...fingers.current.values()].find((g) => g.held >= 0)
            const s = holder && shapes.current[holder.held]
            if (holder && s) {
              const before = Math.atan2(f.at[1] - s.y, f.at[0] - s.x)
              const now = Math.atan2(at[1] - s.y, at[0] - s.x)
              lastTouched.current = holder.held
              turn(now - before)
            }
          } else if (f.held >= 0) {
            shapes.current = shapes.current.map((s, i) =>
              i === f.held ? { ...s, x: at[0] + f.off[0], y: at[1] + f.off[1] } : s,
            )
            changed(true)
          }
          fingers.current.set(e.pointerId, { ...f, at })
        }}
        onPointerUp={(e) => {
          const f = fingers.current.get(e.pointerId)
          fingers.current.delete(e.pointerId)
          if (!f) return
          const now = performance.now()
          const moved = Math.hypot(f.at[0] - f.from[0], f.at[1] - f.from[1]) * 200
          /* a second tap on the same thing, soon: take it away */
          if (f.held >= 0 && isTap(moved, now - f.t0)) {
            if (now - lastTap.current.t < 350 && lastTap.current.held === f.held) {
              shapes.current = shapes.current.filter((_, i) => i !== f.held)
              lastTap.current = { t: 0, held: -1 }
              lastTouched.current = -1
            } else lastTap.current = { t: now, held: f.held }
          }
          changed(false)
        }}
      />

      {live && (
        <div className="lab-controls">
          <button className="btn" onClick={() => setRunning((r) => !r)} aria-pressed={running}>
            {running ? '⏸ Pause' : '▶ Run'}
          </button>
          <button
            className="btn btn-ghost"
            aria-pressed={drift}
            onClick={() => setDrift((d) => !d)}
          >
            🌀 Drift
          </button>
          <button
            className="btn btn-ghost"
            disabled={count >= MAX_SHAPES}
            onClick={() => add(box(0, 0, 0.25, 0.035, Math.random() * Math.PI))}
          >
            + Wall
          </button>
          <button
            className="btn btn-ghost"
            disabled={count >= MAX_SHAPES}
            onClick={() =>
              add({ kind: 'disc', x: 0, y: 0, r: 0.1, h: 0, angle: 0, colour: [0, 0, 0], power: 0 })
            }
          >
            + Pillar
          </button>
          <div className="lab-group" role="group" aria-label="Room">
            {SCENE_IDS.map((id) => (
              <button
                key={id}
                className="btn btn-ghost"
                aria-pressed={sceneId === id}
                onClick={() => open(id)}
              >
                {SCENES[id].name}
              </button>
            ))}
          </div>
        </div>
      )}

      {live && (
        <p className="muted lab-hint">
          Drag the lamps, pillars and walls about; tap an empty spot for a new lamp (up to six),
          double-tap anything to take it away.{' '}
          {touchOnly()
            ? 'Hold a wall and swing a second finger round it to turn it.'
            : 'Scroll over a wall to turn it.'}{' '}
          Nothing draws the shadows: every point sends rays out and counts the light that comes
          back, and the picture settles as the counts add up.
          {!touchOnly() && ' Keys: L lamp, W wall, Q and E turn, D drift, 1–3 rooms, Space pauses.'}
        </p>
      )}
    </div>
  )
}
